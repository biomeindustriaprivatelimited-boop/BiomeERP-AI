import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/authServer";
import { LOCK_COOKIE } from "@/lib/mpin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Locks THIS device's app: every page shows the lock screen and every API
 * answers 423 until the signed-in person enters their MPIN or password.
 * Only this browser/PC is locked — the server keeps serving every client.
 */
export async function POST(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const res = NextResponse.json({ ok: true, locked: true });
  res.cookies.set(LOCK_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 400 * 24 * 60 * 60 });
  return res;
}
