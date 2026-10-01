import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SERVER_PC_HEADER, isServerPcRequest, verifySession } from "@/lib/authToken";
import { clearServerOwner } from "@/lib/serverOwner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // The developer signing out AT THE SERVER PC takes the server offline for
  // clients — that is the rule: the server is the PC where the developer is
  // signed in.
  if (await isServerPcRequest(req.headers.get(SERVER_PC_HEADER))) {
    const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (s && s.role === "developer") clearServerOwner(s.uid);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
