import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, verifyPassword } from "@/lib/authServer";
import { mpinProblem, setMpin, clearMpin, setAutoLock, hasMpin, autoLockFor, rememberOnDevice } from "@/lib/mpin";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in person's own MPIN and auto-lock. Every change needs the password, except auto-lock. */
async function me(req: NextRequest) {
  const s = await getSession(req);
  const u = s ? findById(s.uid) : undefined;
  return u && u.active ? u : null;
}

export async function GET(req: NextRequest) {
  const u = await me(req);
  if (!u) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.json({ hasMpin: hasMpin(u as any), autoLockMinutes: autoLockFor(u as any), role: u.role });
}

export async function POST(req: NextRequest) {
  const u = await me(req);
  if (!u) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));

  if (b.action === "autoLock") {
    const minutes = Number(b.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) return NextResponse.json({ error: "Choose a time." }, { status: 400 });
    // The developer account can never switch auto-lock off: the server PC
    // is shared and unattended.
    if (u.role === "developer" && minutes === 0) {
      return NextResponse.json({ error: "Auto-lock cannot be switched off for the developer account." }, { status: 400 });
    }
    setAutoLock(u.id, minutes);
    return NextResponse.json({ ok: true, autoLockMinutes: autoLockFor(findById(u.id) as any) });
  }

  if (!verifyPassword(String(b.password || ""), u)) {
    return NextResponse.json({ error: "Your password is not correct." }, { status: 401 });
  }

  if (b.action === "setMpin") {
    const mpin = String(b.mpin || "").trim();
    const problem = mpinProblem(mpin);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    setMpin(u.id, mpin);
    recordAudit({ action: "MPIN_SET", userId: u.id, userName: u.name, role: u.role });
    const res = NextResponse.json({ ok: true, hasMpin: true });
    // This device knows the person with the NEW MPIN version.
    await rememberOnDevice(req, res, u.id);
    return res;
  }

  if (b.action === "removeMpin") {
    clearMpin(u.id);
    recordAudit({ action: "MPIN_REMOVED", userId: u.id, userName: u.name, role: u.role });
    return NextResponse.json({ ok: true, hasMpin: false });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
