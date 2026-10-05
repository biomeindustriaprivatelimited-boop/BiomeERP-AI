import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requirePermission, findById } from "@/lib/authServer";
// A route file may not export anything but its handlers and config, so the
// ticket vocabulary now lives in lib. See lib/support.ts.
import {
  SUPPORT_TOPICS, STATUS_FLOW, Status, buildBoard,
  MAX_TICKET_ATTACHMENTS, MAX_FILES_PER_MESSAGE, MAX_TICKET_ATTACHMENT_MB,
} from "@/lib/support";
import { notifyTicket, emailFor, MailOutcome } from "@/lib/supportMail";
import { loadEmployees } from "@/lib/payroll";
import {
  Ticket, Urgency, loadTickets, saveTickets, saveTicket, rightsFor, canSeeTicket, touch, isUnreadFor,
} from "@/lib/supportStore";

/**
 * Help & support.
 *
 * Every rule about who may do what is checked HERE, on the server, from the
 * person's live permissions (lib/supportStore.ts → rightsFor). Hiding a
 * button is a courtesy; a plant manager who sends {status:"closed"} by hand
 * gets the same refusal as one who clicks.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTLED: Status[] = ["resolved", "rejected", "closed"];

/** What the browser is shown: no internal read-markers, mail log for the desk only. */
function forClient(t: Ticket, userId: string, canManage: boolean) {
  const { mail, seenBy, ...rest } = t;
  void seenBy;
  return { ...rest, unread: isUnreadFor(t, userId), ...(canManage ? { mail } : {}) };
}

/** The desk sees every delivery; anyone else only their own. */
function mailFor(mail: MailOutcome[], userName: string, canManage: boolean) {
  return canManage ? mail : mail.filter((m) => m.name === userName);
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const rights = rightsFor(user);
  const all = loadTickets();

  // A person sees their own tickets. Only the desk sees everyone's — a
  // salary complaint is not something a colleague should be able to read.
  const tickets = rights.canManage ? all : all.filter((t) => t.raisedBy === user.id);

  // The light poll the app shell makes (components/SupportUpdates.tsx):
  // just what is new for this person, nothing else.
  if (req.nextUrl.searchParams.get("summary") === "1") {
    const unread = tickets
      .filter((t) => isUnreadFor(t, user.id))
      .map((t) => ({
        id: t.id, ref: t.ref, subject: t.subject, status: t.status,
        at: t.lastActivity!.at, byName: t.lastActivity!.byName, text: t.lastActivity!.text,
      }));
    return NextResponse.json({ unread });
  }

  return NextResponse.json({
    tickets: [...tickets]
      .sort((a, b) => {
        // Urgent and still open floats to the top; that is the whole point
        // of the flag. Everything else is newest first.
        const done = (x: Ticket) => SETTLED.includes(x.status);
        const rank = (t: Ticket) => (!done(t) && t.urgency === "urgent" ? 0 : done(t) ? 2 : 1);
        return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
      })
      .map((t) => forClient(t, user.id, rights.canManage)),
    canManage: rights.canManage,
    // Accept, escalate, resolve, decline and close: the desk (admin and
    // developer by default). Everyone else raises and writes messages.
    canResolve: rights.canProcess,
    canProcess: rights.canProcess,
    canClose: rights.canProcess,
    canRaise: rights.canRaise,
    // After a case is completed or declined, only the developer moves it.
    canReopen: rights.canReopen,
    topics: SUPPORT_TOPICS,
    flow: STATUS_FLOW,
    urgentOpen: rights.canManage
      ? all.filter((t) => t.urgency === "urgent" && !SETTLED.includes(t.status)).length
      : 0,
    maxAttachments: MAX_TICKET_ATTACHMENTS,
    maxFilesPerMessage: MAX_FILES_PER_MESSAGE,
    maxFileMb: MAX_TICKET_ATTACHMENT_MB,
    // Where this person's updates go. Empty = in-app updates only, and the
    // page says so instead of letting them believe otherwise.
    myEmail: emailFor(user),
    // People this user may raise a query for. A plant manager sees their
    // own site's staff and labour; the desk sees everyone. Empty for anyone
    // who may only speak for themselves.
    canRaiseFor: (rights.canManage || user.role === "plant_manager")
      ? loadEmployees()
          .filter((e) => e.active)
          .filter((e) =>
            rights.canManage || !auth.session.plant ? true : e.plant === auth.session.plant
          )
          .map((e) => ({ id: e.id, name: e.name, plant: e.plant, designation: e.designation }))
      : [],
    // The board is built over EVERY ticket, not the filtered view, and is
    // only sent to whoever runs the desk.
    board: rights.canManage
      ? buildBoard(
          all.map((t) => ({
            status: t.status,
            urgency: t.urgency,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            raisedBy: t.raisedBy,
            raisedByName: t.raisedByName,
            // The last time somebody OTHER than the raiser wrote on it.
            lastReplyAt: [...t.replies].reverse().find((r) => r.by !== t.raisedBy)?.at || "",
            lastReplyBy: [...t.replies].reverse().find((r) => r.by !== t.raisedBy)?.byName || "",
          }))
        )
      : null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const rights = rightsFor(user);
  // Cases are raised by the people who USE the app; the desk answers them.
  if (!rights.canRaise) {
    return NextResponse.json({ error: "The admin and the developer answer cases — they don't raise them." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const subject = String(body.subject || "").trim().slice(0, 140);
  const message = String(body.message || "").trim().slice(0, 4000);
  const topic = String(body.topic || "").trim();
  const urgency: Urgency = body.urgency === "urgent" ? "urgent" : "normal";
  const withFiles = body.withAttachments === true;

  if (!subject) return NextResponse.json({ error: "Give the message a subject." }, { status: 400 });

  /**
   * Raising it for somebody else. Labour have no login; a plant manager
   * raising on their behalf is the only way those queries reach anyone —
   * but only for their OWN people.
   */
  let onBehalf: { id: string; name: string } | null = null;
  const behalfId = String(body.onBehalfOfId || "").trim();
  if (behalfId) {
    const canRaiseForOthers = rights.canManage || user.role === "plant_manager";
    if (!canRaiseForOthers) {
      return NextResponse.json({ error: "You can only raise a query for yourself." }, { status: 403 });
    }
    const employee = loadEmployees().find((e) => e.id === behalfId);
    if (!employee) return NextResponse.json({ error: "That person isn't on the employee list." }, { status: 404 });
    if (user.role === "plant_manager" && auth.session.plant && employee.plant !== auth.session.plant) {
      return NextResponse.json({ error: `${employee.name} is not at your plant.` }, { status: 403 });
    }
    onBehalf = { id: employee.id, name: employee.name };
  }
  // Files can say what words don't: a case sent with attachments only
  // needs a line, not a paragraph.
  if (message.length < (withFiles ? 2 : 10)) {
    return NextResponse.json({ error: "Write a little more so it can be looked into properly." }, { status: 400 });
  }

  const all = loadTickets();
  const now = new Date().toISOString();
  // Short human reference so it can be quoted out loud or on paper. Never
  // reused: the next number is one past the highest ever issued.
  const highest = all.reduce((m, t) => Math.max(m, Number(String(t.ref || "").replace(/\D/g, "")) || 0), 0);
  const ticket: Ticket = {
    id: crypto.randomUUID(),
    ref: `SUP-${String(highest + 1).padStart(4, "0")}`,
    subject,
    topic: SUPPORT_TOPICS.includes(topic as any) ? topic : "Something else",
    message,
    urgency,
    status: "submitted",
    raisedBy: user.id,
    raisedByName: user.name,
    raisedByRole: user.role,
    plant: auth.session.plant,
    createdAt: now,
    updatedAt: now,
    replies: [],
    attachments: [],
    onBehalfOfId: onBehalf?.id || "",
    onBehalfOfName: onBehalf?.name || "",
    reopenCount: 0,
    mail: [],
    history: [{ status: "submitted", at: now, byName: user.name, byId: user.id, note: "" }],
    outcome: "",
    closedAt: null,
  };
  touch(ticket, user, `New case: ${subject}`, now);

  // Saved first, emailed second, always. A query that could not be raised
  // because the mail password had expired is the worst failure this module
  // could have.
  saveTickets([...all, ticket]);

  // When files are coming, the page uploads them next and then calls
  // PUT {action:"notify"} — so the emails go once, after the files are on
  // the case, rather than before anyone can open them.
  if (withFiles) {
    return NextResponse.json({ ticket: forClient(ticket, user.id, false), mail: [], mailPending: true }, { status: 201 });
  }
  const mail = await notifyTicket(ticket, "raised", { id: user.id, name: user.name }, message);
  ticket.mail = mail;
  saveTicket(ticket);
  return NextResponse.json({ ticket: forClient(ticket, user.id, false), mail: mailFor(mail, user.name, false) }, { status: 201 });
}

/** Reply, move the status on, close — or mark a case as read. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const rights = rightsFor(user);

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  const all = loadTickets();
  const ticket = all.find((t) => t.id === body.id);
  if (!ticket || !canSeeTicket(user, ticket)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date().toISOString();

  // Opening a case marks it read for this person (the "new update" badge).
  if (body.action === "seen") {
    ticket.seenBy = { ...(ticket.seenBy || {}), [user.id]: now };
    saveTickets(all);
    return NextResponse.json({ ok: true });
  }

  // The emails for a case, or a message, whose files were uploaded after it.
  if (body.action === "notify") {
    const replyId = String(body.replyId || "");
    const isRaise = !replyId;
    if (isRaise && ticket.raisedBy !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const reply = replyId ? ticket.replies.find((r) => r.id === replyId && r.by === user.id) : null;
    if (replyId && !reply) return NextResponse.json({ error: "Not found." }, { status: 404 });
    // Once per case / message: a repeated call must not mail everyone again.
    const key = `notified:${replyId || "raise"}`;
    if ((ticket.mail || []).some((m) => m.error === key)) return NextResponse.json({ ok: true, mail: [] });
    const files = (ticket.attachments || []).filter((a) => (replyId ? a.replyId === replyId : !a.replyId)).length;
    const note = (isRaise ? ticket.message : reply!.message) +
      (files ? `\n\n(${files} file${files === 1 ? "" : "s"} attached — open the case in the app to see ${files === 1 ? "it" : "them"}.)` : "");
    const mail = await notifyTicket(ticket, isRaise ? "raised" : "reply", { id: user.id, name: user.name }, note);
    const fresh = loadTickets().find((t) => t.id === ticket.id) || ticket;
    fresh.mail = [...(fresh.mail || []), ...mail, { to: "", name: "", ok: true, error: key, at: now }].slice(-60);
    saveTicket(fresh);
    return NextResponse.json({ ok: true, mail: mailFor(mail, user.name, rights.canManage) });
  }

  const updated: Ticket = {
    ...ticket,
    history: Array.isArray(ticket.history) ? [...ticket.history] : [],
    outcome: ticket.outcome || "",
    updatedAt: now,
  };

  const message = String(body.message || "").trim().slice(0, 4000);
  const nextStatus = body.status ? (String(body.status) as Status) : null;
  const wantsReopen = body.reopen === true;
  const withFiles = body.withAttachments === true;
  const settled = SETTLED.includes(ticket.status);

  // ---- Who may move a case at all ------------------------------------
  // Everyone who is not on the desk may only WRITE on their own case.
  // Escalating, processing, resolving, declining, closing and reopening
  // belong to the admin and the developer (support.manage).
  if ((nextStatus || wantsReopen) && !rights.canProcess) {
    return NextResponse.json(
      { error: "Only the admin or the developer can change a case's status. You can still write a message on it.", code: "NOT_ALLOWED" },
      { status: 403 }
    );
  }
  if (!message && !nextStatus && !wantsReopen && !withFiles) {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }
  // Once a case is completed or declined, only the developer reopens it or
  // changes its status. Anyone may still write on it — it is read, but it
  // does not move the case.
  if (settled && (nextStatus || wantsReopen) && !rights.canReopen) {
    return NextResponse.json({ error: "This case is finished. Only the developer can reopen it or change its status." }, { status: 403 });
  }
  if (nextStatus === "reopened" && !rights.canReopen) {
    return NextResponse.json({ error: "Only the developer can reopen a case." }, { status: 403 });
  }
  if (nextStatus && !STATUS_FLOW.some((f) => f.id === nextStatus)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }
  if ((nextStatus === "resolved" || nextStatus === "rejected") && !message && !String(body.outcome || "").trim()) {
    // A decision without a reason is what makes a helpdesk resented.
    return NextResponse.json({ error: "Write what was decided — the person needs to know why." }, { status: 400 });
  }

  let replyId: string | null = null;
  const text = message || (withFiles ? "Attached file(s)." : "");
  if (text) {
    replyId = crypto.randomUUID();
    updated.replies = [
      ...ticket.replies,
      { id: replyId, by: user.id, byName: user.name, byRole: user.role, message: text, at: now },
    ];
  }

  if (nextStatus) {
    if (nextStatus === "resolved" || nextStatus === "rejected") {
      updated.outcome = String(body.outcome || message).trim();
      updated.closedAt = now;
    } else if (nextStatus === "reopened") {
      updated.closedAt = null;
      updated.reopenCount = (ticket.reopenCount || 0) + 1;
    } else if (nextStatus === "closed") {
      updated.closedAt = now;
    } else {
      updated.closedAt = null;
    }
    updated.status = nextStatus;
    updated.history.push({ status: nextStatus, at: now, byName: user.name, byId: user.id, note: message });
  } else if (wantsReopen && settled) {
    // Goes to "reopened" rather than back to "accepted": the tracker shows
    // it moving FORWARD, and the desk can see which answers did not work.
    updated.status = "reopened";
    updated.closedAt = null;
    updated.reopenCount = (ticket.reopenCount || 0) + 1;
    updated.history.push({
      status: "reopened", at: now, byName: user.name, byId: user.id,
      note: `Reopened — the earlier answer did not resolve it (time ${updated.reopenCount}).`,
    });
  }

  const label = STATUS_FLOW.find((f) => f.id === updated.status)?.label || updated.status;
  touch(
    updated, user,
    updated.status !== ticket.status ? `Status: ${label}${message ? ` — ${message}` : ""}` : text,
    now
  );
  saveTickets(all.map((t) => (t.id === ticket.id ? updated : t)));

  // A message whose files are still uploading is emailed afterwards
  // (action "notify"), so the email can say how many files came with it.
  if (withFiles && !nextStatus && !wantsReopen) {
    return NextResponse.json({ ticket: forClient(updated, user.id, rights.canManage), replyId, mail: [], mailPending: true });
  }

  const event =
    updated.status === "reopened" && ticket.status !== "reopened" ? "reopened"
    : nextStatus === "resolved" || nextStatus === "rejected" ? "resolved"
    : nextStatus ? "status"
    : "reply";

  const mail = await notifyTicket(updated, event, { id: user.id, name: user.name }, message);
  const fresh = loadTickets().find((t) => t.id === ticket.id) || updated;
  fresh.mail = [...(fresh.mail || []), ...mail].slice(-60);
  saveTicket(fresh);

  return NextResponse.json({ ticket: forClient(fresh, user.id, rights.canManage), replyId, mail: mailFor(mail, user.name, rights.canManage) });
}
