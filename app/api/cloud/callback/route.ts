import { NextRequest, NextResponse } from "next/server";
import { findById } from "@/lib/authServer";
import {
  verifyState, exchangeCode, encryptSecret, saveConnection, loadConnection,
  GoogleDriveProvider, DEFAULT_ROOT_FOLDER,
} from "@/lib/cloud/googleDrive";
import { CLOUD_FOLDERS } from "@/lib/cloud/provider";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A finished page rather than JSON — Google redirects a browser here. */
function page(title: string, body: string, ok: boolean) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1418;color:#cfe3e8}
div{max-width:460px;text-align:center;padding:32px}
h1{font-size:20px;margin:0 0 10px;color:${ok ? "#4ade80" : "#fb7185"}}
p{font-size:13px;line-height:1.6;color:#8aa0a8;margin:0 0 22px}
a{color:#4ade80;text-decoration:none;font-size:13px}
</style></head><body><div><h1>${title}</h1><p>${body}</p>
<a href="/cloud">Back to Cloud Storage</a></div></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/**
 * Google's redirect lands here with the authorization code.
 *
 * The signed `state` is what proves this callback belongs to a flow we
 * started, and who started it — without it anyone could POST a code and
 * attach their own Drive to the company's ERP.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const error = p.get("error");
  if (error) {
    return page("Not connected", `Google returned: ${error}. Nothing was changed.`, false);
  }

  const code = p.get("code");
  const state = p.get("state");
  if (!code || !state) return page("Not connected", "The response from Google was incomplete.", false);

  const payload = verifyState(state);
  if (!payload) {
    return page(
      "Not connected",
      "That sign-in link is no longer valid — it may have expired or been reused. Start again from Cloud Storage.",
      false
    );
  }

  const [userId] = payload.split("|");
  const user = findById(userId);
  if (!user || !user.active) return page("Not connected", "The account that started this is no longer active.", false);

  try {
    const { refreshToken } = await exchangeCode(code);

    const existing = loadConnection();
    const connection = {
      provider: "google_drive" as const,
      accountEmail: "",
      accountName: "",
      refreshTokenEnc: encryptSecret(refreshToken),
      rootFolderId: null as string | null,
      rootFolderName: existing?.rootFolderName || DEFAULT_ROOT_FOLDER,
      connectedAt: new Date().toISOString(),
      connectedByName: user.name,
      lastError: null as string | null,
    };

    const provider = new GoogleDriveProvider(connection);
    const test = await provider.testConnection();
    if (!test.ok) throw new Error(test.error || "Couldn't read the account.");
    connection.accountEmail = test.account || "";

    // Build the folder tree once, on connect, so the first upload doesn't
    // have to. `ensureFolder` is idempotent — reconnecting reuses what is
    // already there instead of making a second "BIOME ERP".
    const rootId = await provider.ensureFolder(connection.rootFolderName, null);
    connection.rootFolderId = rootId;
    for (const folder of CLOUD_FOLDERS) {
      await provider.ensureFolder(folder, rootId);
    }

    saveConnection(connection);

    recordAudit({
      action: "GOOGLE_DRIVE_CONNECTED",
      userId: user.id, userName: user.name, role: user.role,
      detail: `Connected ${connection.accountEmail}, root folder "${connection.rootFolderName}"`,
    });

    return page(
      "Google Drive connected",
      `Signed in as ${connection.accountEmail}. The folder "${connection.rootFolderName}" is ready. You can close this window.`,
      true
    );
  } catch (err) {
    recordAudit({
      action: "GOOGLE_DRIVE_CONNECT_FAILED",
      userId: user.id, userName: user.name, role: user.role,
      outcome: "failed", errorMessage: (err as Error).message,
    });
    return page("Not connected", (err as Error).message, false);
  }
}
