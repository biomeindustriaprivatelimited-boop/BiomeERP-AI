import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadDrive, saveDrive, driveAuthUrl, driveRedirectUri } from "@/lib/gdrive";
import { encrypt } from "@/lib/mailer";

/**
 * Google Drive sync — status, credentials, connect URL, disconnect.
 * Settings-permission only: this decides where copies of ALL company
 * data go, which is not an everyone decision.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const cfg = loadDrive();
  return NextResponse.json({
    configured: Boolean(cfg.clientId && cfg.clientSecretEnc),
    connected: Boolean(cfg.refreshTokenEnc),
    accountEmail: cfg.accountEmail,
    lastBackupAt: cfg.lastBackupAt,
    lastBackupName: cfg.lastBackupName,
    redirectUri: driveRedirectUri(req.nextUrl.origin),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  const cfg = loadDrive();

  if (body?.action === "save-credentials") {
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: "Both the Client ID and the Client Secret are needed." }, { status: 400 });
    }
    saveDrive({ ...cfg, clientId, clientSecretEnc: encrypt(clientSecret) });
    return NextResponse.json({ ok: true });
  }

  if (body?.action === "connect-url") {
    if (!cfg.clientId) return NextResponse.json({ error: "Save the credentials first." }, { status: 400 });
    return NextResponse.json({ url: driveAuthUrl(cfg.clientId, driveRedirectUri(req.nextUrl.origin)) });
  }

  if (body?.action === "disconnect") {
    saveDrive({ ...cfg, refreshTokenEnc: "", accountEmail: "", connectedAt: "" });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
