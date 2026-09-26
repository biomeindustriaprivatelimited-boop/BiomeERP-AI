/**
 * Biome Platform — the support desk's vocabulary
 * -------------------------------------------------------------------
 * These three lived inside `app/api/support/route.ts`. A Next route file
 * may only export the request handlers and a small set of config keys, so
 * that one extra export made `next build` fail outright — which is why the
 * app ran under `npm run dev` but could not be packaged. Dev never checks;
 * the build does.
 *
 * They are plain data with no `fs` and no request object, so they belong
 * in lib anyway, where a page can import them without dragging a route
 * handler along.
 */

export const SUPPORT_TOPICS = [
  "Salary or payslip",
  "Imprest or reimbursement",
  "Attendance",
  "PF / ESIC",
  "Documents or KYC",
  "App not working",
  "Something else",
] as const;

/**
 * The life of a ticket, as the business described it.
 *
 * Every stage is recorded with who moved it and when, so the person who
 * raised it can see exactly where it has reached rather than wondering
 * whether anyone read it. "Accepted" exists on purpose: a message sitting
 * unacknowledged is the single thing that makes people stop using a
 * helpdesk.
 */
export type Status =
  | "submitted" | "accepted" | "pending_admin"
  // A case that was answered and came back. Deliberately its own status
  // rather than a return to "accepted": the tracker has to show it moving
  // FORWARD, and the desk has to be able to see at a glance which cases
  // their first answer did not actually fix.
  | "reopened"
  | "resolved" | "rejected" | "closed";

export const STATUS_FLOW: { id: Status; label: string; detail: string; step: number }[] = [
  { id: "submitted", label: "Received", detail: "Your message has reached accounts and the admin.", step: 1 },
  { id: "accepted", label: "Accepted", detail: "Someone has picked this up and is looking into it.", step: 2 },
  { id: "pending_admin", label: "With the admin", detail: "Referred upward — waiting on a decision.", step: 3 },
  { id: "reopened", label: "Reopened", detail: "The earlier answer did not sort it. Back with the desk.", step: 3 },
  { id: "resolved", label: "Resolved", detail: "Sorted, with the outcome written below.", step: 4 },
  { id: "rejected", label: "Not accepted", detail: "Looked at and declined, with the reason written below.", step: 4 },
  { id: "closed", label: "Closed", detail: "Finished. Raise a fresh message if it comes back.", step: 5 },
];

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

/**
 * A screenshot is worth four paragraphs.
 *
 * "The app is not working" is unanswerable; the same message with a photo
 * of the screen is usually answerable in one reply. The rules are the same
 * as imprest's bills, and for the same reason — the stored filename is
 * always generated, never the browser's, because an uploaded name can
 * contain path separators and walk out of the folder.
 */
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
]);

export const MAX_TICKET_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_TICKET_ATTACHMENTS = 5;

export interface TicketAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Path relative to the support attachments folder, never absolute. */
  file: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
}

export function ticketAttachmentAllowed(type: string, size: number): string | null {
  if (!ALLOWED_TYPES.has(type)) {
    return "Attach a photo (JPG, PNG, WEBP) or a PDF. A screenshot of the screen is usually the most useful thing.";
  }
  if (size > MAX_TICKET_ATTACHMENT_BYTES) {
    return "That file is over 12 MB. A phone photo of the screen is plenty.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The status board                                                    */
/* ------------------------------------------------------------------ */

export interface BoardTicket {
  status: Status;
  urgency: string;
  createdAt: string;
  updatedAt: string;
  raisedByName: string;
  /** When someone last WROTE on it, as opposed to it merely being touched. */
  lastReplyAt: string;
  lastReplyBy: string;
  raisedBy: string;
}

export interface BoardColumn {
  status: Status;
  label: string;
  detail: string;
  count: number;
  urgent: number;
  /** Open items nobody has answered in over two days. */
  stale: number;
  /** The oldest thing sitting in this column, in days. */
  oldestDays: number;
}

export interface BoardSummary {
  columns: BoardColumn[];
  open: number;
  urgentOpen: number;
  /** Raised and never replied to at all. The number that matters most. */
  unanswered: number;
  staleTotal: number;
  /** Median hours from raising to the first reply, over settled tickets. */
  medianFirstReplyHours: number | null;
}

const SETTLED: Status[] = ["resolved", "rejected", "closed"];

export function isOpen(status: Status): boolean {
  return !SETTLED.includes(status);
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(a).getTime(), t2 = new Date(b).getTime();
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.max(0, (t2 - t1) / 86400000);
}

/**
 * The board an admin opens first thing.
 *
 * Built around one question — what is waiting on US — rather than a count
 * of everything ever raised. So "stale" counts only OPEN tickets nobody
 * has answered in two days, and "unanswered" counts tickets that have
 * never had a single reply. A helpdesk dies from silence, not from volume.
 */
export function buildBoard(tickets: BoardTicket[], now: Date = new Date()): BoardSummary {
  const nowIso = now.toISOString();
  const columns: BoardColumn[] = STATUS_FLOW.map((s) => {
    const inColumn = tickets.filter((t) => t.status === s.id);
    const openOnes = inColumn.filter((t) => isOpen(t.status));
    return {
      status: s.id,
      label: s.label,
      detail: s.detail,
      count: inColumn.length,
      urgent: openOnes.filter((t) => t.urgency === "urgent").length,
      stale: openOnes.filter((t) => daysBetween(t.lastReplyAt || t.createdAt, nowIso) > 2).length,
      oldestDays: openOnes.length
        ? Math.floor(Math.max(...openOnes.map((t) => daysBetween(t.createdAt, nowIso))))
        : 0,
    };
  });

  const open = tickets.filter((t) => isOpen(t.status));
  const firstReplyHours = tickets
    .filter((t) => t.lastReplyAt)
    .map((t) => daysBetween(t.createdAt, t.lastReplyAt) * 24)
    .sort((a, b) => a - b);

  return {
    columns,
    open: open.length,
    urgentOpen: open.filter((t) => t.urgency === "urgent").length,
    unanswered: open.filter((t) => !t.lastReplyAt).length,
    staleTotal: open.filter((t) => daysBetween(t.lastReplyAt || t.createdAt, nowIso) > 2).length,
    medianFirstReplyHours: firstReplyHours.length
      ? Math.round(firstReplyHours[Math.floor(firstReplyHours.length / 2)] * 10) / 10
      : null,
  };
}
