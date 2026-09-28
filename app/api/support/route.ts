import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
// A route file may not export anything but its handlers and config, so the
// ticket vocabulary now lives in lib. See lib/support.ts.
import { SUPPORT_TOPICS, STATUS_FLOW, Status, buildBoard, TicketAttachment, MAX_TICKET_ATTACHMENTS } from "@/lib/support";
import { notifyTicket, MailOutcome } from "@/lib/supportMail";
import { loadEmployees } from "@/lib/payroll";

type Urgency = "normal" | "urgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Reply {
  id: string;
  by: string;
  byName: string;
  byRole: string;
  message: string;
  at: string;
}

/** One movement of the ticket, kept for the tracker the raiser sees. */
interface StatusEvent {
  status: Status;
  at: string;
  byName: string;
  note: string;
}

interface Ticket {
  id: string;
  ref: string;
  subject: string;
  topic: string;
  message: string;
  urgency: Urgency;
  status: Status;
  raisedBy: string;
  raisedByName: string;
  raisedByRole: string;
  plant: string | null;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
  history: StatusEvent[];
  /** Photos or PDFs — a screenshot answers what four paragraphs cannot. */
  attachments?: TicketAttachment[];
  /** The final word — why it was resolved or declined. */
  outcome: string;
  closedAt: string | null;
  /**
   * Raised by someone else on this person's behalf — a plant manager for
   * one of their labourers, or accounts for a driver. The labour have no
   * login, and a query they cannot raise is a query that reaches nobody.
   */
  onBehalfOfId?: string;
  onBehalfOfName?: string;
  /** How many times the answer did not actually sort it. */
  reopenCount?: number;
  /** What was emailed, and to whom. Kept so "was she told?" has an answer. */
  mail?: MailOutcome[];
}

function file() { return path.join(paths.root, "support", "tickets.json"); }
function load(): Ticket[] {
  const f = readJson<{ tickets: Ticket[] }>(file(), { tickets: [] });
  return Array.isArray(f.tickets) ? f.tickets : [];
}
function save(tickets: Ticket[]) {
  ensureDir(path.join(paths.root, "support"));
  writeJsonAtomic(file(), { tickets, updatedAt: new Date().toISOString() });
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canManage = hasPermission(user.role, "support.manage");
  const all = load();

  // A person sees their own tickets. Only accounts and admin see everyone's
  // — a salary complaint is not something a colleague should be able to read.
  const tickets = canManage ? all : all.filter((t) => t.raisedBy === user.id);

  return NextResponse.json({
    tickets: [...tickets].sort((a, b) => {
      // Urgent and still open floats to the top; that is the whole point of
      // the flag. Everything else is newest first.
      const done = (x: Ticket) => x.status === "closed" || x.status === "resolved" || x.status === "rejected";
      const rank = (t: Ticket) => (!done(t) && t.urgency === "urgent" ? 0 : done(t) ? 2 : 1);
      return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
    }),
    canManage,
    // Only the admin may resolve or reject; accounts can accept and refer.
    canResolve: user.role === "admin" || user.role === "developer",
    // Admin and developer answer tickets; everyone else raises them.
    canRaise: user.role !== "admin" && user.role !== "developer",
    // After a case is completed or declined, only the developer moves it.
    canReopen: user.role === "developer",
    topics: SUPPORT_TOPICS,
    flow: STATUS_FLOW,
    urgentOpen: all.filter(
      (t) => t.urgency === "urgent" && !["closed", "resolved", "rejected"].includes(t.status)
    ).length,
    maxAttachments: MAX_TICKET_ATTACHMENTS,
    // People this user may raise a query for. A plant manager sees their
    // own site's staff and labour; accounts and admin see everyone. Empty
    // for anyone who may only speak for themselves.
    canRaiseFor: (canManage || user.role === "plant_manager")
      ? loadEmployees()
          .filter((e) => e.active)
          .filter((e) =>
            canManage || !auth.session.plant ? true : e.plant === auth.session.plant
          )
          .map((e) => ({ id: e.id, name: e.name, plant: e.plant, designation: e.designation }))
      : [],
    // The board is built over EVERY ticket, not the filtered view, and is
    // only sent to whoever runs the desk. A count of what is waiting is
    // meaningless if it only counts your own.
    board: canManage
      ? buildBoard(
          all.map((t) => ({
            status: t.status,
            urgency: t.urgency,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            raisedBy: t.raisedBy,
            raisedByName: t.raisedByName,
            // The last time somebody OTHER than the raiser wrote on it.
            // A person chasing their own ticket three times has still not
            // been answered, and the board must not pretend otherwise.
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
  // Tickets are raised by the people who USE the app; the admin and the
  // developer are the ones who answer them.
  if (user.role === "admin" || user.role === "developer") {
    return NextResponse.json({ error: "Admin and developer resolve tickets — they don't raise them." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const subject = String(body.subject || "").trim().slice(0, 140);
  const message = String(body.message || "").trim().slice(0, 4000);
  const topic = String(body.topic || "").trim();
  const urgency: Urgency = body.urgency === "urgent" ? "urgent" : "normal";

  if (!subject) return NextResponse.json({ error: "Give the message a subject." }, { status: 400 });

  /**
   * Raising it for somebody else.
   *
   * Labour have no login. A plant manager or accounts raising on their
   * behalf is the only way those queries reach anyone at all — but only
   * for their OWN people, so a manager cannot file a complaint under
   * another site's labourer's name.
   */
  let onBehalf: { id: string; name: string } | null = null;
  const behalfId = String(body.onBehalfOfId || "").trim();
  if (behalfId) {
    const canRaiseForOthers =
      hasPermission(user.role, "support.manage") || user.role === "plant_manager";
    if (!canRaiseForOthers) {
      return NextResponse.json({ error: "You can only raise a query for yourself." }, { status: 403 });
    }
    const employee = loadEmployees().find((e) => e.id === behalfId);
    if (!employee) return NextResponse.json({ error: "That person isn't on the employee list." }, { status: 404 });
    if (
      user.role === "plant_manager" &&
      auth.session.plant &&
      employee.plant !== auth.session.plant
    ) {
      return NextResponse.json(
        { error: `${employee.name} is not at your plant.` },
        { status: 403 }
      );
    }
    onBehalf = { id: employee.id, name: employee.name };
  }
  if (message.length < 10) {
    return NextResponse.json({ error: "Write a little more so it can be looked into properly." }, { status: 400 });
  }

  const all = load();
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: crypto.randomUUID(),
    // Short human reference so it can be quoted out loud or on paper.
    ref: `SUP-${String(all.length + 1).padStart(4, "0")}`,
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
    history: [{ status: "submitted", at: now, byName: user.name, note: "" }],
    outcome: "",
    closedAt: null,
  };

  // Saved first, emailed second, always. A query that could not be raised
  // because the mail password had expired is the worst failure this
  // module could have.
  save([...all, ticket]);

  const mail = await notifyTicket(ticket, "raised", { id: user.id, name: user.name }, message);
  ticket.mail = mail;
  save([...load().filter((t) => t.id !== ticket.id), ticket]);

  return NextResponse.json({ ticket, mail }, { status: 201 });
}

/** Reply, move the status on, or close. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canManage = hasPermission(user.role, "support.manage");
  // Resolve or decline: the admin or the developer.
  const canResolve = user.role === "admin" || user.role === "developer";
  const isDeveloper = user.role === "developer";

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  const all = load();
  const ticket = all.find((t) => t.id === body.id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isOwn = ticket.raisedBy === user.id;
  if (!isOwn && !canManage) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date().toISOString();
  const updated: Ticket = {
    ...ticket,
    history: Array.isArray(ticket.history) ? [...ticket.history] : [],
    outcome: ticket.outcome || "",
    updatedAt: now,
  };

  const message = String(body.message || "").trim().slice(0, 4000);
  if (message) {
    updated.replies = [
      ...ticket.replies,
      { id: crypto.randomUUID(), by: user.id, byName: user.name, byRole: user.role, message, at: now },
    ];
  }

  const nextStatus = body.status ? (String(body.status) as Status) : null;
  const settled = ["resolved", "rejected", "closed"].includes(ticket.status);
  // Once the admin or developer has completed or declined a case, only the
  // developer may reopen it or change its status. Anyone may still add a
  // reply — it is read, but it does not move the case.
  if (settled && nextStatus && !isDeveloper) {
    return NextResponse.json({ error: "This case is finished. Only the developer can reopen it or change its status." }, { status: 403 });
  }
  if (nextStatus === "reopened" && !isDeveloper) {
    return NextResponse.json({ error: "Only the developer can reopen a case." }, { status: 403 });
  }
  if (nextStatus) {
    if (!STATUS_FLOW.some((f) => f.id === nextStatus)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
    // Who may move it where. The raiser can only close their own once it
    // has been answered; everything else belongs to the people handling it.
    if (nextStatus === "resolved" || nextStatus === "rejected") {
      if (!canResolve) {
        return NextResponse.json(
          { error: "Only the admin or the developer can resolve or decline a case." },
          { status: 403 }
        );
      }
      // A decision without a reason is what makes a helpdesk resented.
      if (!message && !String(body.outcome || "").trim()) {
        return NextResponse.json(
          { error: "Write what was decided — the person needs to know why." },
          { status: 400 }
        );
      }
      updated.outcome = String(body.outcome || message).trim();
    } else if (nextStatus === "reopened") {
      updated.closedAt = null;
      updated.reopenCount = (ticket.reopenCount || 0) + 1;
    } else if (nextStatus === "closed") {
      if (!canManage && !isOwn) {
        return NextResponse.json({ error: "You can't close this." }, { status: 403 });
      }
      updated.closedAt = now;
    } else if (!canManage) {
      return NextResponse.json({ error: "Only accounts or the admin can move this on." }, { status: 403 });
    }

    updated.status = nextStatus;
    updated.history.push({ status: nextStatus, at: now, byName: user.name, note: message });
  } else if (message && isDeveloper && body.reopen === true && settled) {
    /**
     * The answer did not actually sort it.
     *
     * This is the case the business specifically asked for. It goes to
     * "reopened" rather than back to "accepted", for two reasons: the
     * person watching the tracker sees it move FORWARD rather than
     * appear to start again, and the desk can see at a glance which of
     * their answers did not work. The count is kept, because a case
     * coming back a third time is a different conversation from one
     * coming back once.
     */
    updated.status = "reopened";
    updated.closedAt = null;
    updated.reopenCount = (ticket.reopenCount || 0) + 1;
    updated.history.push({
      status: "reopened",
      at: now,
      byName: user.name,
      note: `Reopened — the earlier answer did not resolve it (time ${updated.reopenCount}).`,
    });
  }

  save(all.map((t) => (t.id === ticket.id ? updated : t)));

  // What kind of movement this was decides what the email says.
  const event =
    updated.status === "reopened" && ticket.status !== "reopened" ? "reopened"
    : nextStatus === "resolved" || nextStatus === "rejected" ? "resolved"
    : nextStatus ? "status"
    : "reply";

  const mail = await notifyTicket(updated, event, { id: user.id, name: user.name }, message);
  updated.mail = [...(ticket.mail || []), ...mail].slice(-50);
  save(load().map((t) => (t.id === ticket.id ? updated : t)));

  return NextResponse.json({ ticket: updated, mail });
}
