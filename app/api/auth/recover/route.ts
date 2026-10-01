import { NextRequest, NextResponse } from "next/server";
import { SERVER_PC_HEADER, isServerPcRequest } from "@/lib/authToken";
import { recoveryQuestions, answersCorrect, resetDeveloper, DEFAULT_PASSWORD } from "@/lib/devRecovery";
import { lockedFor, noteFail, clearLock } from "@/lib/loginLock";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Forgot developer password?" — the server PC only.
 *
 * Refused from any other PC or phone, so nobody on the network or the
 * internet can even see the questions. Five wrong attempts lock recovery
 * for 15 minutes.
 */
const LOCK_KEY = "dev-recovery";

export async function GET(req: NextRequest) {
  if (!(await isServerPcRequest(req.headers.get(SERVER_PC_HEADER)))) {
    return NextResponse.json({ available: false });
  }
  const q = recoveryQuestions();
  return NextResponse.json({ available: true, q1: q.q1, q2: q.q2, q3: q.q3, custom: q.custom });
}

export async function POST(req: NextRequest) {
  if (!(await isServerPcRequest(req.headers.get(SERVER_PC_HEADER)))) {
    return NextResponse.json({ error: "Password recovery works only on the server PC itself." }, { status: 403 });
  }
  const wait = lockedFor(LOCK_KEY);
  if (wait > 0) {
    return NextResponse.json({ error: `Too many wrong answers. Try again in ${Math.ceil(wait / 60000)} minute(s).` }, { status: 429 });
  }
  const body = await req.json().catch(() => ({} as any));
  const username = String(body.username || "developer").trim();
  if (!answersCorrect(String(body.a1 || ""), String(body.a2 || ""), String(body.a3 || ""))) {
    noteFail(LOCK_KEY, 5);
    recordAudit({ action: "DEV_RECOVERY_FAILED", userId: "unknown", userName: username, role: "-", outcome: "failed", errorMessage: "Wrong answers" });
    return NextResponse.json({ error: "One or more answers are not correct." }, { status: 401 });
  }
  const r = resetDeveloper(username);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  clearLock(LOCK_KEY);
  clearLock(r.username.toLowerCase());
  recordAudit({
    action: "DEV_PASSWORD_RESET", userId: "-", userName: r.username, role: "developer",
    detail: r.created ? "Developer account created from the server PC recovery" : "Developer password reset from the server PC recovery",
  });
  return NextResponse.json({ ok: true, username: r.username, password: DEFAULT_PASSWORD, created: r.created });
}
