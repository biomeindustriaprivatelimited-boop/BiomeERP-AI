import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import {
  buildAuthUrl, signState, isConfigured, loadConnection, clearConnection,
  getProvider, publicConnection,
} from "@/lib/cloud/googleDrive";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start the OAuth flow. Admin only — the connected Google account belongs
 * to the company, not to whoever happens to be signed in.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google credentials aren't set up yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to .env.local — see CLOUD-SETUP.md for the ten-minute walkthrough.",
        needsSetup: true,
      },
      { status: 409 }
    );
  }

  // The state carries who started this and when, signed, so the callback
  // can prove it came from us and isn't a replay.
  const state = signState(`${user.id}|${Date.now()}`);
  return NextResponse.json({ url: buildAuthUrl(state) });
}

/** Disconnect. The Drive files are left exactly where they are. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const existing = loadConnection();
  clearConnection();
  recordAudit({
    action: "GOOGLE_DRIVE_DISCONNECTED",
    userId: user.id, userName: user.name, role: user.role,
    detail: existing ? `Disconnected ${existing.accountEmail}` : "Nothing was connected",
  });

  return NextResponse.json({ ok: true, connection: null });
}

/** Test the stored credentials without changing anything. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const provider = getProvider();
  if (!provider) {
    return NextResponse.json({
      connection: publicConnection(loadConnection()),
      configured: isConfigured(),
      ok: false,
    });
  }
  const result = await provider.testConnection();
  return NextResponse.json({
    connection: publicConnection(loadConnection()),
    configured: true,
    ...result,
  });
}
