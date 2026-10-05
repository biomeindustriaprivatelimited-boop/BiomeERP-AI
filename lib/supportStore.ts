/**
 * Biome Platform — the support desk's store and its rules (server only)
 * -------------------------------------------------------------------
 * Both support routes (tickets, attachments) read and write the same
 * tickets.json, and both need the same answer to "who may do what". It
 * used to be copied into each route; a rule kept in two places is a rule
 * that drifts, so it lives here once.
 *
 * WHO MAY DO WHAT — decided by PERMISSION, never by a role name, so a
 * role added next year follows the same rules without anyone remembering
 * to edit this file:
 *
 *   support.manage  → "runs the desk": sees every case, accepts, escalates,
 *                     resolves, declines and closes. Admin and developer by
 *                     default; the developer can grant it to anyone else.
 *   developer       → may also reopen or re-status a FINISHED case.
 *   support (only)  → may raise a case, write follow-up messages on their
 *                     OWN case and attach files to it. Nothing else — no
 *                     close button, and the server refuses the request even
 *                     if someone sends it by hand.
 *
 * NEVER import from a client component — it pulls in `fs`.
 */

import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { User } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import type { Permission } from "@/lib/permissions";
import type { Status, TicketAttachment } from "@/lib/support";
import type { MailOutcome } from "@/lib/supportMail";

export type Urgency = "normal" | "urgent";

export interface Reply {
  id: string;
  by: string;
  byName: string;
  byRole: string;
  message: string;
  at: string;
}

/** One movement of the ticket, kept for the tracker the raiser sees. */
export interface StatusEvent {
  status: Status;
  at: string;
  byName: string;
  byId?: string;
  note: string;
}

/** The latest thing that happened, so "new for you" needs no guessing. */
export interface Activity {
  at: string;
  by: string;
  byName: string;
  text: string;
}

export interface Ticket {
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
  attachments?: TicketAttachment[];
  outcome: string;
  closedAt: string | null;
  onBehalfOfId?: string;
  onBehalfOfName?: string;
  reopenCount?: number;
  mail?: MailOutcome[];
  lastActivity?: Activity;
  /** userId → when they last opened this case. Drives "new update" badges. */
  seenBy?: Record<string, string>;
}

export function ticketsFile() { return path.join(paths.root, "support", "tickets.json"); }
export function attachmentsDir() { return path.join(paths.root, "support", "attachments"); }

export function loadTickets(): Ticket[] {
  const f = readJson<{ tickets: Ticket[] }>(ticketsFile(), { tickets: [] });
  return Array.isArray(f.tickets) ? f.tickets : [];
}

export function saveTickets(tickets: Ticket[]) {
  ensureDir(path.join(paths.root, "support"));
  writeJsonAtomic(ticketsFile(), { tickets, updatedAt: new Date().toISOString() });
}

/** Saves one ticket against the CURRENT file, so a parallel save is not lost. */
export function saveTicket(ticket: Ticket) {
  const all = loadTickets();
  const i = all.findIndex((t) => t.id === ticket.id);
  if (i === -1) all.push(ticket);
  else all[i] = ticket;
  saveTickets(all);
}

/** Resolves a stored path, refusing anything that points outside the folder. */
export function resolveAttachment(relative: string): string | null {
  const base = path.resolve(attachmentsDir());
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export function userCan(user: User, permission: Permission): boolean {
  return effectivePermissions(user.role, user.access).includes(permission);
}

export interface SupportRights {
  /** Runs the desk: sees everyone's cases and moves them. */
  canManage: boolean;
  /** Accept, escalate, resolve, decline, close. Same people as the desk. */
  canProcess: boolean;
  /** Reopen or re-status a finished case. */
  canReopen: boolean;
  /** Raise a new case. The desk answers cases; it does not raise them. */
  canRaise: boolean;
}

export function rightsFor(user: User): SupportRights {
  const canManage = userCan(user, "support.manage");
  return {
    canManage,
    canProcess: canManage,
    canReopen: canManage && userCan(user, "developer"),
    canRaise: !canManage && userCan(user, "support"),
  };
}

/** May this person read (and write on) this case at all? */
export function canSeeTicket(user: User, ticket: Ticket): boolean {
  return ticket.raisedBy === user.id || rightsFor(user).canManage;
}

export function touch(ticket: Ticket, actor: { id: string; name: string }, text: string, at = new Date().toISOString()) {
  ticket.lastActivity = { at, by: actor.id, byName: actor.name, text: text.slice(0, 200) };
  ticket.seenBy = { ...(ticket.seenBy || {}), [actor.id]: at };
  ticket.updatedAt = at;
}

/** Something happened on this case since this person last opened it. */
export function isUnreadFor(ticket: Ticket, userId: string): boolean {
  const a = ticket.lastActivity;
  if (!a || a.by === userId) return false;
  const seen = ticket.seenBy?.[userId] || "";
  return a.at > seen;
}
