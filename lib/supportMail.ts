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
 */

import { loadUsers, User } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { hasPermission } from "@/lib/permissions";
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
 * The work email for a login.
 *
 * It lives on the employee record, not the sign-in, so the two are matched
 * by name. A user with no matching employee has no address — reported,
 * never silently skipped, because "everyone was told" must not quietly
 * mean "everyone we happened to have an address for".
 */
function emailFor(user: Pick<User, "name">): string {
  const employees = loadEmployees();
  const match = employees.find(
    (e) => e.email && e.name.trim().toLowerCase() === user.name.trim().toLowerCase()
  );
  return match?.email || "";
}

/** Who runs the desk — everyone who can see other people's tickets. */
function deskUsers(): User[] {
  return loadUsers().filter((u) => u.active && hasPermission(u.role, "support.manage"));
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

function subjectLine(t: TicketLike, event: TicketEvent): string {
  const label =
    event === "raised" ? "New query"
    : event === "reopened" ? "Reopened"
    : event === "resolved" ? "Resolved"
    : event === "status" ? "Update"
    : "Reply";
  const urgent = t.urgency === "urgent" && event === "raised" ? "URGENT — " : "";
  return `${urgent}${label} · ${t.ref} · ${t.subject}`;
}

function bodyFor(t: TicketLike, event: TicketEvent, note: string, actorName: string, forName: string): string {
  const lines: string[] = [`${forName},`, ""];

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
  // whoever just did the thing.
  const recipients: User[] = [];
  if (raiser && raiser.id !== actor.id && raiser.active) recipients.push(raiser);
  for (const u of deskUsers()) {
    if (u.id === actor.id) continue;
    if (recipients.some((r) => r.id === u.id)) continue;
    recipients.push(u);
  }

  const results: MailOutcome[] = [];
  for (const u of recipients) {
    const to = emailFor(u);
    if (!to) {
      results.push({
        to: "", name: u.name, ok: false,
        error: "No email address on their employee record.",
        at: new Date().toISOString(),
      });
      continue;
    }
    const sent = await sendMail({
      to,
      subject: subjectLine(ticket, event),
      text: bodyFor(ticket, event, note, actor.name, u.name),
    });
    results.push({
      to, name: u.name, ok: sent.ok,
      error: sent.ok ? "" : sent.error || "Send failed.",
      at: new Date().toISOString(),
    });
  }
  return results;
}
