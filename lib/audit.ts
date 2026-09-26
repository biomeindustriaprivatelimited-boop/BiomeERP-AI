/**
 * Biome Platform — audit log (server only)
 * -------------------------------------------------------------------
 * Append-only. There is no update and no delete, deliberately: an audit
 * trail that can be edited is not an audit trail.
 *
 * The rule the business was explicit about, and the reason this file is
 * separate from every document store:
 *
 *   **Deleting a document must NEVER delete its history.**
 *
 * An invoice PDF can be removed and its Drive copy trashed, and the record
 * that it was created, read by OCR, approved, changed and finally deleted
 * still stands. Business documents, ERP records and activity are three
 * different things with three different lifetimes.
 *
 * Stored one file per month so a busy year never produces a single
 * unopenable JSON blob.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, ensureDir } from "@/lib/dataRoot";

export type AuditCategory =
  | "auth" | "users" | "imprest" | "payroll" | "employees" | "attendance"
  | "plant" | "documents" | "cloud" | "support" | "settings" | "tally";

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  category: AuditCategory;
  userId: string;
  userName: string;
  role: string;
  /** What was acted on, when there is one. */
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: string;
  plant?: string | null;
  /** Set when the action failed, so attempts are recorded as well as successes. */
  outcome: "ok" | "failed";
  errorMessage?: string;
}

/** Which category an action belongs to, inferred from its name. */
function categoryFor(action: string): AuditCategory {
  const a = action.toUpperCase();
  if (a.startsWith("CLOUD_") || a.startsWith("GOOGLE_DRIVE")) return "cloud";
  if (a.startsWith("LOGIN") || a.startsWith("LOGOUT") || a.includes("PASSWORD")) return "auth";
  if (a.startsWith("USER_")) return "users";
  if (a.startsWith("IMPREST_")) return "imprest";
  if (a.startsWith("PAYROLL_") || a.startsWith("PAYSLIP_")) return "payroll";
  if (a.startsWith("EMPLOYEE_") || a.startsWith("DOCUMENT_") || a.startsWith("LETTER_")) return "employees";
  if (a.startsWith("ATTENDANCE_")) return "attendance";
  if (a.startsWith("SHEET_") || a.startsWith("PLANT_") || a.startsWith("SLIP_")) return "plant";
  if (a.startsWith("SUPPORT_")) return "support";
  if (a.startsWith("TALLY_")) return "tally";
  return "settings";
}

function fileFor(month: string): string {
  return path.join(paths.root, "audit", `${month}.jsonl`);
}

/**
 * Record one event.
 *
 * Never throws. An audit write that could break the operation it is
 * describing would make the whole log a liability — callers would start
 * wrapping it in try/catch and then start skipping it.
 *
 * Written as JSON Lines and appended, so a crash mid-write costs one line
 * rather than the whole month.
 */
export function recordAudit(input: {
  action: string;
  userId: string;
  userName: string;
  role: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: string;
  plant?: string | null;
  outcome?: "ok" | "failed";
  errorMessage?: string;
}): void {
  try {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: input.action,
      category: categoryFor(input.action),
      userId: input.userId,
      userName: input.userName,
      role: input.role,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      detail: input.detail,
      plant: input.plant ?? null,
      outcome: input.outcome ?? "ok",
      errorMessage: input.errorMessage,
    };
    const month = event.at.slice(0, 7);
    ensureDir(path.join(paths.root, "audit"));
    fs.appendFileSync(fileFor(month), JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Swallowed on purpose — see the note above.
  }
}

export interface AuditQuery {
  month?: string;
  userId?: string;
  category?: AuditCategory | "all";
  action?: string;
  search?: string;
  outcome?: "all" | "ok" | "failed";
  limit?: number;
}

export function readAudit(q: AuditQuery = {}): { events: AuditEvent[]; months: string[]; total: number } {
  const dir = path.join(paths.root, "audit");
  let months: string[] = [];
  try {
    months = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", "")).sort().reverse();
  } catch {
    return { events: [], months: [], total: 0 };
  }

  const month = q.month && months.includes(q.month) ? q.month : months[0];
  if (!month) return { events: [], months, total: 0 };

  let events: AuditEvent[] = [];
  try {
    events = fs.readFileSync(fileFor(month), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line) as AuditEvent; } catch { return null; } })
      // One corrupt line must not hide the rest of the month.
      .filter((e): e is AuditEvent => Boolean(e));
  } catch {
    return { events: [], months, total: 0 };
  }

  const total = events.length;
  if (q.userId) events = events.filter((e) => e.userId === q.userId);
  if (q.category && q.category !== "all") events = events.filter((e) => e.category === q.category);
  if (q.action) events = events.filter((e) => e.action === q.action);
  if (q.outcome && q.outcome !== "all") events = events.filter((e) => e.outcome === q.outcome);
  if (q.search) {
    const needle = q.search.toLowerCase();
    events = events.filter((e) =>
      [e.userName, e.action, e.targetLabel, e.detail, e.role].filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }

  events.reverse(); // newest first
  return { events: events.slice(0, q.limit ?? 500), months, total };
}

/** Per-person activity counts, for the "who did what" view. */
export function auditSummary(month?: string) {
  const { events, months } = readAudit({ month, limit: 100_000 });
  const byUser = new Map<string, { userId: string; userName: string; role: string; count: number; failed: number; last: string }>();
  const byCategory = new Map<string, number>();

  for (const e of events) {
    const u = byUser.get(e.userId) || { userId: e.userId, userName: e.userName, role: e.role, count: 0, failed: 0, last: e.at };
    u.count += 1;
    if (e.outcome === "failed") u.failed += 1;
    if (e.at > u.last) u.last = e.at;
    byUser.set(e.userId, u);
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);
  }

  return {
    months,
    people: [...byUser.values()].sort((a, b) => b.count - a.count),
    categories: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    total: events.length,
  };
}
