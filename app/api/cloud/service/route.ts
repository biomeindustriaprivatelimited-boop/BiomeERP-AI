import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import {
  parseServiceAccountJson, encryptKey, decryptKey, saveServiceConnection,
  loadServiceConnection, clearServiceConnection, publicServiceConnection,
  checkFolderAccess, serviceAccessToken, folderIdFrom,
} from "@/lib/cloud/serviceAccount";
import { CLOUD_FOLDERS } from "@/lib/cloud/provider";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const connection = loadServiceConnection();
  if (!connection) return NextResponse.json({ connection: null });

  const key = JSON.parse(decryptKey(connection.keyEnc) || "{}");
  const check = await checkFolderAccess(key, connection.rootFolderId);

  return NextResponse.json({
    connection: publicServiceConnection(connection),
    ok: check.ok,
    error: check.error,
    folderName: check.name,
  });
}

/**
 * Connect using a service account key.
 *
 * No browser, no consent screen, no password — the business asked to
 * "just log in", and this is the closest Google permits. It is also more
 * robust for a server that runs unattended: an OAuth refresh token dies
 * when the admin changes their Google password; this does not.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.keyJson) return NextResponse.json({ error: "Paste or upload the service account JSON." }, { status: 400 });

  const parsed = parseServiceAccountJson(String(body.keyJson));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const folderId = folderIdFrom(String(body.folderId || ""));
  if (!folderId) {
    return NextResponse.json(
      { error: `Paste the Drive folder link or its id, and make sure ${parsed.key.client_email} has Editor access to it.` },
      { status: 400 }
    );
  }

  // Prove the key works AND the folder is reachable before storing
  // anything — a connection saved in a broken state is worse than none.
  try {
    await serviceAccessToken(parsed.key);
  } catch (err) {
    recordAudit({
      action: "GOOGLE_DRIVE_CONNECT_FAILED", userId: user.id, userName: user.name, role: user.role,
      outcome: "failed", errorMessage: (err as Error).message,
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const access = await checkFolderAccess(parsed.key, folderId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 400 });

  const connection = {
    provider: "google_drive_service" as const,
    clientEmail: parsed.key.client_email,
    projectId: parsed.key.project_id || "",
    keyEnc: encryptKey(JSON.stringify(parsed.key)),
    rootFolderId: folderId,
    rootFolderName: access.name || "BIOME ERP",
    connectedAt: new Date().toISOString(),
    connectedByName: user.name,
    lastError: null,
  };
  saveServiceConnection(connection);

  // Build the folder tree once, so the first upload doesn't have to.
  const created: string[] = [];
  try {
    const token = await serviceAccessToken(parsed.key);
    for (const name of CLOUD_FOLDERS) {
      const q = encodeURIComponent(
        `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      const found = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.json()).catch(() => ({}));
      if (found?.files?.length) continue;

      await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [folderId] }),
      });
      created.push(name);
    }
  } catch {
    // The connection stands even if the tree is incomplete — folders are
    // created on demand later. Failing the whole connect here would be
    // wrong.
  }

  recordAudit({
    action: "GOOGLE_DRIVE_CONNECTED", userId: user.id, userName: user.name, role: user.role,
    detail: `Service account ${connection.clientEmail} → folder "${connection.rootFolderName}"`,
  });

  return NextResponse.json({
    connection: publicServiceConnection(connection),
    foldersCreated: created.length,
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const existing = loadServiceConnection();
  clearServiceConnection();
  recordAudit({
    action: "GOOGLE_DRIVE_DISCONNECTED", userId: user.id, userName: user.name, role: user.role,
    detail: existing ? `Service account ${existing.clientEmail}` : "Nothing was connected",
  });
  return NextResponse.json({ ok: true });
}
