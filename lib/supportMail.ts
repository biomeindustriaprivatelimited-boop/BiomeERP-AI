/**
 * Biome Platform — telling people their case moved
 * -------------------------------------------------------------------
 * A helpdesk dies from silence. Somebody raises a query, hears nothing for
 * three days, and goes back to catching the accountant in the corridor —
 * at which point the app has made things worse, not better, because now
 * there is a record that says "submitted" and a conversation nobody wrote
 * down.
 *
 * So: an email on the raise, and an email on every movement after it.
 * Both directions — the person who raised it hears when it moves, and the
 * desk hears when something new lands.
 *
 * TWO RULES WORTH KEEPING:
 *
 * 1. **Email failure never blocks the action.** The ticket is saved first,
 *    always; this runs afterwards and its result is recorded on the
 *    ticket. A query that could not be raised because the SMTP password
 *    had expired would be the worst possible failure for this module.
 *
 * 2. **Nobody is emailed about their own action.** The person who just
 *    pressed Resolve does not need an email telling them it was resolved,
 *    and a desk that mails itself teaches everyone to filter the address.
 *    One exception: whoever RAISES a case gets "your case has been
 *    registered" with the case number, because that number is what they
 *    quote later.
 */

import { loadUsers, User } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { effectivePermissions } from "@/lib/access";
import { sendMail } from "@/lib/mailer";

export type TicketEvent = "raised" | "reply" | "status" | "reopened" | "resolved";

export interface MailOutcome {
  to: string;
  name: string;
  ok: boolean;
  error: string;
  at: string;
}

/**
 * The email for a login.
 *
 * The user record's own `email` (set in Users & Access) comes first. Older
 * accounts that have none fall back to the employee record with the same
 * name. A user with neither has no address — reported on the ticket and in
 * the server log, never silently skipped, because "everyone was told" must
 * not quietly mean "everyone we happened to have an address for".
 */
export function emailFor(user: Pick<User, "name"> & { email?: string }): string {
  const own = String(user.email || "").trim();
  if (own) return own;
  try {
    const employees = loadEmployees();
    const match = employees.find(
      (e) => e.email && e.name.trim().toLowerCase() === user.name.trim().toLowerCase()
    );
    return match?.email || "";
  } catch {
    return "";
  }
}

/** Who runs the desk — everyone who can see other people's tickets. */
function deskUsers(): User[] {
  return loadUsers().filter((u) => u.active && !u.deleted && effectivePermissions(u.role, u.access).includes("support.manage"));
}

interface TicketLike {
  id: string;
  ref: string;
  subject: string;
  status: string;
  urgency: string;
  raisedBy: string;
  raisedByName: string;
  onBehalfOfName?: string;
  outcome?: string;
  reopenCount?: number;
}

function subjectLine(t: TicketLike, event: TicketEvent, toRaiser = false): string {
  if (event === "raised" && toRaiser) return `Your case has been registered · ${t.ref} · ${t.subject}`;
  const label =
    event === "raised" ? "New query"
    : event === "reopened" ? "Reopened"
    : event === "resolved" ? "Resolved"
    : event === "status" ? "Update"
    : "Reply";
  const urgent = t.urgency === "urgent" && event === "raised" ? "URGENT — " : "";
  return `${urgent}${label} · ${t.ref} · ${t.subject}`;
}

function bodyFor(t: TicketLike, event: TicketEvent, note: string, actorName: string, forName: string, toRaiser = false): string {
  const lines: string[] = [`${forName},`, ""];

  if (event === "raised" && toRaiser) {
    lines.push(
      `Your case has been registered. Your case number is ${t.ref}.`,
      "",
      `Subject: ${t.subject}`,
      "",
      "The admin and the developer have received it. You will get an email and an in-app update every time it moves or someone replies.",
      "To add anything — a message or a file — open Help & support in the Biome app and write on this same case.",
      "",
      "— Biome Industria Private Limited"
    );
    return lines.join("\n");
  }

  if (event === "raised") {
    lines.push(
      t.onBehalfOfName
        ? `${actorName} has raised a query on behalf of ${t.onBehalfOfName}.`
        : `${actorName} has raised a query.`
    );
  } else if (event === "reopened") {
    // The important sentence in the whole file. A reopened case is not a
    // new case, and the person reading this needs to know the earlier
    // answer did not work.
    lines.push(
      `${actorName} has reopened ${t.ref} — the earlier answer did not resolve it.` +
        (t.reopenCount && t.reopenCount > 1 ? ` This is the ${ordinal(t.reopenCount)} time it has come back.` : "")
    );
  } else if (event === "resolved") {
    lines.push(`${t.ref} has been marked ${t.status}.`);
  } else if (event === "status") {
    lines.push(`${t.ref} has moved to "${t.status}".`);
  } else {
    lines.push(`${actorName} has replied on ${t.ref}.`);
  }

  lines.push("", `Subject: ${t.subject}`);
  if (note) lines.push("", note);
  if (event === "resolved" && t.outcome) lines.push("", `Outcome: ${t.outcome}`);

  if (event === "resolved") {
    lines.push(
      "",
      "If this has not actually sorted the problem, open the message in the app and reply — it reopens and comes straight back to us. Please do not raise a fresh one; the history is worth keeping together."
    );
  }

  lines.push("", "— Biome Industria Private Limited", "Open the Biome Platform to see the full history.");
  return lines.join("\n");
}

function ordinal(n: number): string {
  if (n === 2) return "second";
  if (n === 3) return "third";
  if (n === 4) return "fourth";
  return `${n}th`;
}

/**
 * Send the notice for one movement.
 *
 * Returns what happened per recipient so the ticket can carry it — "did
 * she get told?" then has an answer instead of a shrug.
 */
export async function notifyTicket(
  ticket: TicketLike,
  event: TicketEvent,
  actor: { id: string; name: string },
  note = ""
): Promise<MailOutcome[]> {
  const users = loadUsers();
  const raiser = users.find((u) => u.id === ticket.raisedBy);

  // Who hears about it: the person who raised it, plus the desk. Minus
  // whoever just did the thing — except that the raiser always gets the
  // "your case has been registered" confirmation with the case number.
  const recipients: { user: User; toRaiser: boolean }[] = [];
  if (raiser && raiser.active && !raiser.deleted && (raiser.id !== actor.id || event === "raised")) {
    recipients.push({ user: raiser, toRaiser: true });
  }
  for (const u of deskUsers()) {
    if (u.id === actor.id) continue;
    if (recipients.some((r) => r.user.id === u.id)) continue;
    recipients.push({ user: u, toRaiser: false });
  }

  const results: MailOutcome[] = [];
  for (const { user: u, toRaiser } of recipients) {
    const to = emailFor(u);
    if (!to) {
      // Skipped, not failed: the action itself went through. Logged so the
      // developer can see on the server who never gets these emails.
      console.warn(`[support] ${ticket.ref}: no email address for ${u.name} (@${u.username}) — ${event} notice not emailed.`);
      results.push({
        to: "", name: u.name, ok: false,
        error: "No email address on their user account.",
        at: new Date().toISOString(),
      });
      continue;
    }
    const sent = await sendMail({
      to,
      subject: subjectLine(ticket, event, toRaiser),
      text: bodyFor(ticket, event, note, actor.name, u.name, toRaiser),
    });
    if (!sent.ok) console.warn(`[support] ${ticket.ref}: email to ${to} failed — ${sent.error || "send failed"}`);
    results.push({
      to, name: u.name, ok: sent.ok,
      error: sent.ok ? "" : sent.error || "Send failed.",
      at: new Date().toISOString(),
    });
  }
  return results;
}
