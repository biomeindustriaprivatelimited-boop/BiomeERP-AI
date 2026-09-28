import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { saveGoogleKeys, storedGoogleKeys, clearGoogleKeys } from "@/lib/aiKeys";
import { googleConfig } from "@/lib/cloud/googleDrive";
import { recordAudit } from "@/lib/audit";

/**
 * Google Drive OAuth client from the app (Settings → Cloud) instead of
 * editing .env.local. `settings` permission. The secret is stored
 * encrypted and never sent back — only whether one is saved.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fromEnv = () => Boolean((process.env.GOOGLE_CLIENT_ID || "").trim());

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const c = googleConfig();
  const s = storedGoogleKeys();
  return NextResponse.json({
    source: fromEnv() ? "env" : s.clientId ? "app" : "none",
    clientId: c.clientId,
    hasSecret: Boolean(c.clientSecret),
    redirectUri: c.redirectUri,
    updatedAt: s.updatedAt,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const b = await req.json().catch(() => ({}));
  const clientId = String(b.clientId || "").trim();
  const clientSecret = String(b.clientSecret || "").trim();
  const redirectUri = String(b.redirectUri || "").trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
    return NextResponse.json({ error: "The Client ID ends with .apps.googleusercontent.com — copy it again from Google Cloud Console." }, { status: 400 });
  }
  if (!clientSecret && !storedGoogleKeys().clientSecret) {
    return NextResponse.json({ error: "Paste the Client Secret." }, { status: 400 });
  }
  if (!/^https?:\/\/[^\s]+\/api\/cloud\/callback$/.test(redirectUri)) {
    return NextResponse.json({ error: "The redirect URI must end with /api/cloud/callback, exactly as registered in Google." }, { status: 400 });
  }
  saveGoogleKeys({ clientId, clientSecret, redirectUri });
  recordAudit({ action: "GOOGLE_CLIENT_SAVED", userId: user.id, userName: user.name, role: user.role, detail: `Drive OAuth client saved from Settings (${clientId.slice(0, 12)}…)` });
  return NextResponse.json({ ok: true, envOverrides: fromEnv() });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  clearGoogleKeys();
  recordAudit({ action: "GOOGLE_CLIENT_CLEARED", userId: user.id, userName: user.name, role: user.role });
  return NextResponse.json({ ok: true });
}
