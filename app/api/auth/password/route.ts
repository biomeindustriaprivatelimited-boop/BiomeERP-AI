import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  findById,
  loadUsers,
  saveUsers,
  verifyPassword,
  makeCredentials,
  signedOutResponse,
} from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anyone signed in can change their own password; nobody else's. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return signedOutResponse(req);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const current = String(body.currentPassword || "");
  const next = String(body.newPassword || "");

  if (next.length < 8) {
    return NextResponse.json(
      { error: "The new password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (next === current) {
    return NextResponse.json({ error: "The new password must be different." }, { status: 400 });
  }

  const user = findById(session.uid);
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (!verifyPassword(current, user)) {
    return NextResponse.json({ error: "Your current password is not correct." }, { status: 401 });
  }

  const { salt, hash } = makeCredentials(next);
  const users = loadUsers().map((u) =>
    u.id === user.id
      ? { ...u, salt, hash, mustChangePassword: false, updatedAt: new Date().toISOString() }
      : u
  );
  saveUsers(users);

  return NextResponse.json({ ok: true });
}
