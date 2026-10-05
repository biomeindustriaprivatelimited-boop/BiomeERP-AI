/**
 * Plant sheets — submit, freeze and the approved edit window.
 * -------------------------------------------------------------------
 * Pure (no fs), so the grid and the API read the SAME rule.
 *
 * One row of the biomass or transport sheet is one consignment. Its life:
 *
 *   Draft      being entered; the plant manager edits freely.
 *   Submitted  the plant manager pressed Submit with every required field
 *              filled. Still editable for SHEET_FREEZE_DAYS days, so a
 *              typo found the next morning is not a ticket.
 *   Frozen     SHEET_FREEZE_DAYS after submission. The plant manager can
 *              no longer change or delete it; they ask, and someone who
 *              holds "plant.unlock" (accounts / admin / developer) decides.
 *   Unlocked   an approved request opened it for UNLOCK_HOURS, or until
 *              the plant manager submits it again — whichever comes first.
 *
 * The clock is the SUBMISSION, not the row's date: history imported today
 * gets the same five days to be checked as a row typed today.
 */

export const SHEET_FREEZE_DAYS = 5;
export const UNLOCK_HOURS = 24;

/** Fields the server owns. A browser's copy of them is never trusted. */
export const LOCK_META_KEYS = [
  "submittedAt", "submittedBy", "submittedByName", "resubmittedAt",
  "unlock", "importSource", "createdAt", "createdBy", "createdByName",
] as const;

export interface RowUnlock {
  until: string;
  by: string;
  byName: string;
  at: string;
  requestId: string;
  reason: string;
}

export type LockState = "draft" | "submitted" | "frozen" | "unlocked";

export interface LockInfo {
  state: LockState;
  /** When it froze / will freeze. Empty for a draft. */
  freezesAt: string;
  /** Whole days of editing left while submitted. */
  daysLeft: number;
  /** For an unlocked row: when the approval runs out. */
  unlockUntil: string;
  /** One line for a chip's tooltip. */
  label: string;
}

const DAY = 86400000;

export function lockInfo(row: Record<string, any> | null | undefined, now: Date = new Date()): LockInfo {
  const submittedAt = String(row?.submittedAt || "");
  if (!submittedAt || isNaN(Date.parse(submittedAt))) {
    return { state: "draft", freezesAt: "", daysLeft: 0, unlockUntil: "", label: "Draft — not submitted yet" };
  }
  const freezeMs = Date.parse(submittedAt) + SHEET_FREEZE_DAYS * DAY;
  const freezesAt = new Date(freezeMs).toISOString();
  if (now.getTime() < freezeMs) {
    const daysLeft = Math.max(1, Math.ceil((freezeMs - now.getTime()) / DAY));
    return {
      state: "submitted", freezesAt, daysLeft, unlockUntil: "",
      label: `Submitted — editable for ${daysLeft} more day${daysLeft === 1 ? "" : "s"} (freezes ${fmtDateTime(freezesAt)})`,
    };
  }
  const until = String(row?.unlock?.until || "");
  if (until && Date.parse(until) > now.getTime()) {
    return {
      state: "unlocked", freezesAt, daysLeft: 0, unlockUntil: until,
      label: `Unlocked by ${row?.unlock?.byName || "an approver"} until ${fmtDateTime(until)} — submit again when done`,
    };
  }
  return { state: "frozen", freezesAt, daysLeft: 0, unlockUntil: "", label: `Frozen since ${fmtDateTime(freezesAt)} — request an edit to change it` };
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** The values a person typed, normalised, for "did this frozen row change?". */
export function entrySignature(keys: string[], row: Record<string, any>): string {
  return keys
    .map((k) => {
      const v = row?.[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return String(v);
      const s = String(v).trim();
      // "28400" and "28400.00" are the same weight.
      return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
    })
    .join("\u0001");
}

export const LOCK_CHIP: Record<LockState, { text: string; cls: string }> = {
  draft: { text: "Draft", cls: "border-biome-line bg-biome-hover text-biome-muted" },
  submitted: { text: "Submitted", cls: "border-sky-500/35 bg-sky-500/10 text-sky-600" },
  frozen: { text: "Frozen", cls: "border-indigo-500/35 bg-indigo-500/10 text-indigo-500" },
  unlocked: { text: "Unlocked", cls: "border-amber-500/40 bg-amber-500/10 text-amber-600" },
};
