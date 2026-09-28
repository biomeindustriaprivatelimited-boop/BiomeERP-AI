import { NextRequest, NextResponse } from "next/server";
import { getSession, findById } from "@/lib/authServer";
import { loadAnnouncements, saveAnnouncements, unreadFor } from "@/lib/announcements";

/**
 * My notices — any signed-in user. The unread announcements aimed at me
 * (developer notices, mismatch warnings from accounts…) and dismissing
 * one. Writing notices stays behind /api/announcements ("announce").
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function me(req: NextRequest) {
  const session = await getSession(req);
  const user = session ? findById(session.uid) : null;
  return user && user.active ? user : null;
}

export async function GET(req: NextRequest) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const unread = unreadFor(loadAnnouncements(), { id: user.id, role: user.role, plants: user.plants });
  return NextResponse.json({
    notices: unread.slice(0, 5).map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, pinned: a.pinned, createdAt: a.createdAt, createdByName: a.createdByName })),
  });
}

export async function PUT(req: NextRequest) {
  const user = await me(req);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const list = loadAnnouncements();
  const i = list.findIndex((a) => a.id === String(body.id || ""));
  if (i === -1) return NextResponse.json({ error: "That notice no longer exists." }, { status: 404 });
  if (!list[i].readBy.includes(user.id)) {
    list[i] = { ...list[i], readBy: [...list[i].readBy, user.id] };
    saveAnnouncements(list);
  }
  return NextResponse.json({ ok: true });
}
