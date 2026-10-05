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
  { id: "submitted", label: "Received", detail: "Your case is registered and has reached the admin and the developer.", step: 1 },
  { id: "accepted", label: "Accepted", detail: "Someone has picked this up and is looking into it.", step: 2 },
  { id: "pending_admin", label: "Escalated", detail: "Escalated — waiting on a decision.", step: 3 },
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
/**
 * What may be attached, by file extension. The browser's MIME type is
 * checked too, but it is not trusted on its own: Windows often reports a
 * .csv as "application/vnd.ms-excel", a phone photo as "" and an old .doc
 * as "application/octet-stream". The extension decides the KIND; the
 * stored content type comes from this table, never from the browser, so a
 * file can never be served back as something it was not uploaded as.
 */
export const ATTACHMENT_KINDS: Record<string, { type: string; kind: "image" | "pdf" | "excel" | "word" }> = {
  jpg: { type: "image/jpeg", kind: "image" },
  jpeg: { type: "image/jpeg", kind: "image" },
  png: { type: "image/png", kind: "image" },
  webp: { type: "image/webp", kind: "image" },
  gif: { type: "image/gif", kind: "image" },
  heic: { type: "image/heic", kind: "image" },
  pdf: { type: "application/pdf", kind: "pdf" },
  xls: { type: "application/vnd.ms-excel", kind: "excel" },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "excel" },
  csv: { type: "text/csv", kind: "excel" },
  doc: { type: "application/msword", kind: "word" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "word" },
};

/** For the file picker's `accept` attribute. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_KINDS).map((e) => "." + e).join(",") + ",image/*,application/pdf";

export const MAX_TICKET_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_TICKET_ATTACHMENT_MB = 15;
/** Files in one message (the first message, or one follow-up). */
export const MAX_FILES_PER_MESSAGE = 10;
/** Files across the whole case. */
export const MAX_TICKET_ATTACHMENTS = 40;

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
  /** The follow-up message this file came with; absent = the first message. */
  replyId?: string;
}

export function attachmentExt(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,6})$/.exec(String(name || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/** Null when the file may be attached, otherwise the sentence to show. */
export function ticketAttachmentAllowed(name: string, size: number): string | null {
  const ext = attachmentExt(name);
  if (!ATTACHMENT_KINDS[ext]) {
    return `"${name}" can't be attached. Allowed: photos (JPG, PNG, WEBP, HEIC, GIF), PDF, Excel (XLS, XLSX, CSV) and Word (DOC, DOCX).`;
  }
  if (size <= 0) return `"${name}" is empty.`;
  if (size > MAX_TICKET_ATTACHMENT_BYTES) {
    return `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_TICKET_ATTACHMENT_MB} MB per file. Compress it, or split it into smaller files.`;
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
