import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recoveryQuestions, setRecoveryQuestions } from "@/lib/devRecovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The developer's own three recovery questions (Settings). Developer only. */
async function developerOnly(req: NextRequest) {
  const auth = await requirePermission(req, "developer" as any);
  if ("response" in auth) return auth;
  if (findById(auth.session.uid)?.role !== "developer") {
    return { response: NextResponse.json({ error: "Developer only." }, { status: 403 }) };
  }
  return auth;
}

export async function GET(req: NextRequest) {
  const auth = await developerOnly(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json(recoveryQuestions());
}

export async function POST(req: NextRequest) {
  const auth = await developerOnly(req);
  if ("response" in auth) return auth.response;
  const b = await req.json().catch(() => ({} as any));
  const q1 = String(b.q1 || "").trim(), a1 = String(b.a1 || "").trim();
  const q2 = String(b.q2 || "").trim(), a2 = String(b.a2 || "").trim();
  const q3 = String(b.q3 || "").trim(), a3 = String(b.a3 || "").trim();
  if (q1.length < 5 || q2.length < 5 || q3.length < 5) return NextResponse.json({ error: "Write all three questions." }, { status: 400 });
  if (a1.length < 2 || a2.length < 2 || a3.length < 2) return NextResponse.json({ error: "Write all three answers." }, { status: 400 });
  setRecoveryQuestions(q1, a1, q2, a2, q3, a3);
  return NextResponse.json({ ok: true });
}
