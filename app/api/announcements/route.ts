import { NextRequest, NextResponse } from "next/server";
import { requirePermission, getSession, findById, loadUsers } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { sendMail } from "@/lib/mailer";
import {
  loadAnnouncements, saveAnnouncements, makeAnnouncement, unreadFor,
  isFor, emailText, ANNOUNCEMENT_KINDS, Announcement, AnnouncementKind, DeliveryRecord,
} from "@/lib/announcements";
import { ROLES, Role, PLANTS, hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

/**
 * Notices from the developer.
 *
 * GET is open to anyone signed in — everybody needs to see what is aimed
 * at them, and the filtering is done here rather than in the page so an
 * ordinary user reading the raw response still only sees their own.
 * Writing is `announce`, which only the developer holds.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function kindOf(v: unknown): AnnouncementKind {
  return ANNOUNCEMENT_KINDS.some((k) => k.id === v) ? (v as AnnouncementKind) : "info";
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });
  }

  const all = loadAnnouncements();
  const canWrite = hasPermission(user.role, "announce");

  return NextResponse.json({
    // Mine: what is aimed at me and I haven't dismissed.
    unread: unreadFor(all, { id: user.id, role: user.role, plants: user.plants }),
    mine: all.filter((a) => isFor(a, { id: user.id, role: user.role, plants: user.plants })),
    // The full list, with delivery results, is the sender's business only.
    all: canWrite ? [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [],
    canWrite,
    kinds: ANNOUNCEMENT_KINDS,
    roles: ROLES,
    plants: PLANTS,
    recipients: canWrite
      ? loadUsers().filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role, plants: u.plants }))
      : [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "announce");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? "").trim();
  const text = String(body?.body ?? "").trim();
  if (title.length < 3) return NextResponse.json({ error: "Give the notice a title." }, { status: 400 });
  if (text.length < 10) return NextResponse.json({ error: "Write the notice itself." }, { status: 400 });

  const roles = body?.audience?.roles === "all"
    ? "all"
    : (Array.isArray(body?.audience?.roles) ? body.audience.roles : []).filter((r: string) =>
        ROLES.some((x) => x.id === r)
      ) as Role[];

  const announcement = makeAnnouncement({
    kind: kindOf(body?.kind),
    title,
    body: text,
    audience: {
      roles: roles === "all" || roles.length ? roles : "all",
      plants: Array.isArray(body?.audience?.plants) ? body.audience.plants.map(String) : [],
      userIds: Array.isArray(body?.audience?.userIds) ? body.audience.userIds.map(String) : [],
    },
    pinned: Boolean(body?.pinned),
    expiresOn: String(body?.expiresOn ?? ""),
    by: { id: me.id, name: me.name },
  });

  // Stored first, emailed second, always. A notice that exists only in a
  // mail queue is a notice that disappears when the queue fails.
  saveAnnouncements([...loadAnnouncements(), announcement]);

  recordAudit({
    action: "ANNOUNCEMENT_POSTED",
    userId: me.id, userName: me.name, role: me.role,
    targetType: "announcement", targetId: announcement.id, targetLabel: announcement.title,
    detail: `${announcement.kind} · ${describeAudience(announcement)}`,
  });

  return NextResponse.json({ announcement }, { status: 201 });
}

/** Send it by email, or dismiss it, or withdraw it. */
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const me = findById(session.uid);
  if (!me || !me.active) return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const action = String(body?.action ?? "");

  const list = loadAnnouncements();
  const index = list.findIndex((a) => a.id === id);
  if (index === -1) return NextResponse.json({ error: "That notice no longer exists." }, { status: 404 });
  const announcement = list[index];

  // Dismissing is something anyone does to their own copy.
  if (action === "dismiss") {
    if (!announcement.readBy.includes(me.id)) {
      list[index] = { ...announcement, readBy: [...announcement.readBy, me.id] };
      saveAnnouncements(list);
    }
    return NextResponse.json({ ok: true });
  }

  if (!hasPermission(me.role, "announce")) {
    return NextResponse.json({ error: "Only the developer can send or withdraw a notice." }, { status: 403 });
  }

  if (action === "withdraw") {
    list[index] = { ...announcement, withdrawnAt: new Date().toISOString() };
    saveAnnouncements(list);
    recordAudit({
      action: "ANNOUNCEMENT_WITHDRAWN",
      userId: me.id, userName: me.name, role: me.role,
      targetType: "announcement", targetId: announcement.id, targetLabel: announcement.title,
    });
    return NextResponse.json({ announcement: list[index] });
  }

  if (action === "email") {
    const employees = loadEmployees();
    const targets = loadUsers().filter(
      (u) => u.active && isFor(announcement, { id: u.id, role: u.role, plants: u.plants })
    );

    const deliveries: DeliveryRecord[] = [];
    for (const u of targets) {
      // The work email lives on the employee record, not the login. A user
      // with no matching employee has no address, and that is reported
      // rather than silently skipped — otherwise "everyone was emailed"
      // quietly means "everyone we happened to have an address for".
      const employee = employees.find(
        (e) => e.name.trim().toLowerCase() === u.name.trim().toLowerCase() && e.email
      );
      const email = employee?.email || "";
      if (!email) {
        deliveries.push({
          userId: u.id, userName: u.name, email: "",
          emailed: false, error: "No email address on their employee record.",
          at: new Date().toISOString(),
        });
        continue;
      }

      const result = await sendMail({
        to: email,
        subject: `${announcement.title} — Biome Industria`,
        text: emailText(announcement, u.name),
      });
      deliveries.push({
        userId: u.id, userName: u.name, email,
        emailed: result.ok, error: result.ok ? "" : result.error || "Send failed.",
        at: new Date().toISOString(),
      });
    }

    list[index] = { ...announcement, deliveries: [...announcement.deliveries, ...deliveries] };
    saveAnnouncements(list);

    const sent = deliveries.filter((d) => d.emailed).length;
    recordAudit({
      action: "ANNOUNCEMENT_EMAILED",
      userId: me.id, userName: me.name, role: me.role,
      targetType: "announcement", targetId: announcement.id, targetLabel: announcement.title,
      detail: `${sent} of ${deliveries.length} delivered`,
      outcome: sent === deliveries.length ? "ok" : "failed",
    });

    return NextResponse.json({ announcement: list[index], sent, total: deliveries.length });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

function describeAudience(a: Announcement): string {
  if (a.audience.userIds.length) return `${a.audience.userIds.length} named people`;
  const roles = a.audience.roles === "all" ? "everyone" : a.audience.roles.join(", ");
  return a.audience.plants.length ? `${roles} at ${a.audience.plants.join(", ")}` : roles;
}
