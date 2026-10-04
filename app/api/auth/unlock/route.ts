import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, verifyPassword } from "@/lib/authServer";
import { LOCK_COOKIE, checkMpin, hasMpin, resetMpinFails } from "@/lib/mpin";
import { lockedFor, noteFail, clearLock } from "@/lib/loginLock";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unlock with the signed-in person's MPIN, or their password. */
export async function POST(req: NextRequest) {
  const s = await getSession(req);
  const u = s ? findById(s.uid) : undefined;
  if (!s || !u || !u.active) return NextResponse.json({ error: "Please sign in.", code: "SIGNED_OUT" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const key = "unlock:" + u.id;
  const wait = lockedFor(key);
  if (wait > 0) return NextResponse.json({ error: `Too many wrong tries. Try again in ${Math.ceil(wait / 60000)} minute(s).` }, { status: 429 });

  let ok = false;
  let message = "Not correct.";
  if (b.mpin) {
    if (!hasMpin(u as any)) return NextResponse.json({ error: "No MPIN is set — use your password." }, { status: 400 });
    const r = checkMpin(u.id, String(b.mpin).trim());
    ok = r.ok;
    if (!r.ok) message = r.blocked ? "MPIN blocked after too many wrong tries — use your password." : `Wrong MPIN. ${r.left} left.`;
  } else if (b.password) {
    ok = verifyPassword(String(b.password), u);
    if (ok) resetMpinFails(u.id);
    else message = "Wrong password.";
  }
  if (!ok) {
    noteFail(key, 8);
    recordAudit({ action: "UNLOCK_FAILED", userId: u.id, userName: u.name, role: u.role, outcome: "failed" });
    return NextResponse.json({ error: message }, { status: 401 });
  }
  clearLock(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
