/**
 * Biome Platform — leave, holidays and the attendance cut-off (server only)
 * -------------------------------------------------------------------
 * Everything about who is expected where, and what happens when they don't
 * mark it.
 *
 * A note on the holiday list, because getting this wrong costs someone a
 * day's pay: only the FIXED-DATE national holidays are seeded with
 * confidence — 26 January, 1 May, 15 August, 2 October are the same every
 * year. Festival dates move with the lunar calendar and are notified per
 * state each year, so those are seeded as a starting list and marked
 * `confirm: true`. The app says loudly that they must be checked against
 * the state gazette before the year is run. I am not going to quietly
 * invent a date that decides whether a plant is open.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { stateForPlant, STATES } from "@/lib/plants";

/* ------------------------------------------------------------------ */
/* Where a person's holidays come from                                 */
/* ------------------------------------------------------------------ */

/**
 * A state code. Deliberately a plain string rather than a fixed union: a
 * new plant in a new state must not require this file to be edited, and a
 * union would have silently pushed that plant's people onto the Delhi
 * calendar the moment someone added it.
 */
export type HolidayRegion = string;

const KNOWN_REGION_LABEL: Record<string, string> = {
  HR: "Haryana",
  MH: "Maharashtra",
  DL: "Delhi (head office)",
};

/** Kept for the screens that print a region against a holiday. */
export const REGION_LABEL: Record<string, string> = KNOWN_REGION_LABEL;

export function regionLabel(code: string): string {
  return KNOWN_REGION_LABEL[code] || STATES.find((s) => s.code === code)?.label || code;
}

/**
 * A plant follows its own state; office roles follow Delhi.
 *
 * This used to be `if (code === "REW") return "HR"`, which meant a third
 * plant added later would quietly follow Delhi's calendar — its people
 * marked absent on their own state's holidays, and paid for days their
 * state was shut. The state now lives on the plant record, so adding a
 * site is data, not a code change.
 */
export function regionForEmployee(plant: string | null | undefined): HolidayRegion {
  return stateForPlant(plant);
}

export interface Holiday {
  date: string;           // YYYY-MM-DD
  name: string;
  regions: HolidayRegion[];
  /** True where the date shifts year to year and must be verified. */
  confirm: boolean;
  /** Set when the developer/admin announced it (shown as "new" on the leave page). */
  announcedAt?: string;
  announcedBy?: string;
  /** "holiday" (default) or a plant "shutdown". */
  kind?: "holiday" | "shutdown";
  note?: string;
}

/**
 * Seeded list for 2026.
 *
 * The four with `confirm: false` are fixed by statute and safe. Everything
 * else is a starting point — the exact dates are notified by each state
 * and MUST be confirmed. The UI flags every unconfirmed entry.
 */
export const SEED_HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-26", name: "Republic Day", regions: ["HR", "MH", "DL"], confirm: false },
  { date: "2026-05-01", name: "Maharashtra Day / Labour Day", regions: ["MH"], confirm: false },
  { date: "2026-08-15", name: "Independence Day", regions: ["HR", "MH", "DL"], confirm: false },
  { date: "2026-10-02", name: "Gandhi Jayanti", regions: ["HR", "MH", "DL"], confirm: false },

  // --- movable: confirm against the state gazette before relying on them ---
  { date: "2026-03-04", name: "Holi", regions: ["HR", "DL"], confirm: true },
  { date: "2026-03-21", name: "Id-ul-Fitr", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-03-26", name: "Ram Navami", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-04-14", name: "Dr Ambedkar Jayanti", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-05-27", name: "Id-ul-Zuha (Bakrid)", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-08-26", name: "Ganesh Chaturthi", regions: ["MH"], confirm: true },
  { date: "2026-10-20", name: "Dussehra", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-11-08", name: "Diwali", regions: ["HR", "MH", "DL"], confirm: true },
  { date: "2026-11-09", name: "Govardhan Puja / Diwali (2nd day)", regions: ["HR", "DL"], confirm: true },
  { date: "2026-11-24", name: "Guru Nanak Jayanti", regions: ["HR", "DL"], confirm: true },
  { date: "2026-12-25", name: "Christmas", regions: ["HR", "MH", "DL"], confirm: true },
];

interface HolidayFile { holidays: Holiday[]; updatedAt?: string; }

function holidayFile() { return path.join(paths.configDir, "holidays.json"); }

export function loadHolidays(): Holiday[] {
  const f = readJson<HolidayFile>(holidayFile(), { holidays: [] });
  if (!Array.isArray(f.holidays) || f.holidays.length === 0) {
    saveHolidays(SEED_HOLIDAYS_2026);
    return SEED_HOLIDAYS_2026;
  }
  return f.holidays;
}

export function saveHolidays(holidays: Holiday[]): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(holidayFile(), { holidays, updatedAt: new Date().toISOString() });
}

export function isHoliday(date: string, region: HolidayRegion, holidays = loadHolidays()): Holiday | null {
  return holidays.find((h) => h.date === date && h.regions.includes(region)) ?? null;
}

/**
 * The weekly off. Sunday unless the developer changed it under
 * Attendance → Rules (stored in config/attendance-rules.json).
 */
export function isWeeklyOff(date: string, weekOffDays?: number[]): boolean {
  const days = weekOffDays ?? loadRules().weekOffDays;
  return days.includes(new Date(`${date}T00:00:00`).getDay());
}

/** A day nobody is expected to mark. */
export function isNonWorkingDay(
  date: string, region: HolidayRegion, holidays = loadHolidays(), weekOffDays?: number[]
): boolean {
  return isWeeklyOff(date, weekOffDays) || Boolean(isHoliday(date, region, holidays));
}

/* ------------------------------------------------------------------ */
/* Leave                                                               */
/* ------------------------------------------------------------------ */

export type LeaveType = "sick" | "medical" | "casual" | "earned" | "unpaid" | "comp_off";

export interface LeaveTypeSpec {
  id: LeaveType;
  label: string;
  /** Days allowed per month. Null = no monthly cap. */
  perMonth: number | null;
  /** Days allowed per year. Null = no annual cap. */
  perYear: number | null;
  paid: boolean;
  /** Proof expected before approval. */
  needsDocument: boolean;
  help: string;
}

/**
 * The entitlements the business set out: sick 2 days a month, medical 5.
 * The rest follow the usual shape of a small Indian factory and are here
 * so a genuine absence has somewhere to go — an employee with no suitable
 * type just marks nothing, and nothing is exactly what breaks payroll.
 */
export const LEAVE_TYPES: LeaveTypeSpec[] = [
  {
    id: "sick", label: "Sick leave", perMonth: 2, perYear: 24, paid: true, needsDocument: false,
    help: "Up to 2 days a month for short illness. No certificate needed.",
  },
  {
    id: "medical", label: "Medical leave", perMonth: 5, perYear: 30, paid: true, needsDocument: true,
    help: "Up to 5 days a month for a longer illness or a procedure. Attach the prescription or certificate.",
  },
  {
    id: "casual", label: "Casual leave", perMonth: 1, perYear: 12, paid: true, needsDocument: false,
    help: "One day a month for personal work. Apply in advance where you can.",
  },
  {
    id: "earned", label: "Earned leave", perMonth: null, perYear: 15, paid: true, needsDocument: false,
    help: "Accrued leave, usually taken as a longer break. Needs approval in advance.",
  },
  {
    id: "comp_off", label: "Compensatory off", perMonth: null, perYear: null, paid: true, needsDocument: false,
    help: "Against a Sunday or holiday already worked. Say which day it is against.",
  },
  {
    id: "unpaid", label: "Leave without pay", perMonth: null, perYear: null, paid: false, needsDocument: false,
    help: "When the entitlement is used up. The days are not paid.",
  },
];

export function leaveSpec(type: string): LeaveTypeSpec | undefined {
  return LEAVE_TYPES.find((t) => t.id === type);
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  plant: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  /** Working days actually being asked for, excluding offs and holidays. */
  days: number;
  reason: string;
  status: LeaveStatus;
  /** Attached certificate, where the type asks for one. */
  attachments: { id: string; name: string; file: string }[];
  raisedBy: string;
  raisedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface LeaveFile { requests: LeaveRequest[]; updatedAt?: string; }

function leaveFile() { return path.join(paths.root, "attendance", "leave.json"); }

export function loadLeave(): LeaveRequest[] {
  const f = readJson<LeaveFile>(leaveFile(), { requests: [] });
  return Array.isArray(f.requests) ? f.requests : [];
}

export function saveLeave(requests: LeaveRequest[]): void {
  ensureDir(path.join(paths.root, "attendance"));
  writeJsonAtomic(leaveFile(), { requests, updatedAt: new Date().toISOString() });
}

/** Every date between two, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // Local date, not toISOString(): on an IST machine local midnight is
    // 18:30 the previous day in UTC, which shifted every date back by one.
    out.push(localDate(d));
  }
  return out;
}

/**
 * Working days in a leave request.
 *
 * A Sunday inside a leave span is not leave — counting it would eat an
 * entitlement the person never used.
 */
export function workingDaysIn(from: string, to: string, region: HolidayRegion, holidays = loadHolidays()): number {
  const weekOff = loadRules().weekOffDays;
  return datesBetween(from, to).filter((d) => !isNonWorkingDay(d, region, holidays, weekOff)).length;
}

export interface LeaveBalance {
  type: LeaveType;
  label: string;
  usedThisMonth: number;
  usedThisYear: number;
  perMonth: number | null;
  perYear: number | null;
  monthRemaining: number | null;
  yearRemaining: number | null;
}

/** What is left, counting APPROVED and PENDING (a pending request holds the days). */
export function balancesFor(employeeId: string, month: string, requests = loadLeave()): LeaveBalance[] {
  const year = month.slice(0, 4);
  const mine = requests.filter(
    (r) => r.employeeId === employeeId && (r.status === "approved" || r.status === "pending")
  );

  return LEAVE_TYPES.map((spec) => {
    const usedThisMonth = mine
      .filter((r) => r.type === spec.id && r.fromDate.slice(0, 7) === month)
      .reduce((n, r) => n + r.days, 0);
    const usedThisYear = mine
      .filter((r) => r.type === spec.id && r.fromDate.slice(0, 4) === year)
      .reduce((n, r) => n + r.days, 0);
    return {
      type: spec.id,
      label: spec.label,
      usedThisMonth,
      usedThisYear,
      perMonth: spec.perMonth,
      perYear: spec.perYear,
      monthRemaining: spec.perMonth === null ? null : Math.max(0, spec.perMonth - usedThisMonth),
      yearRemaining: spec.perYear === null ? null : Math.max(0, spec.perYear - usedThisYear),
    };
  });
}

/**
 * Can this request be made?
 *
 * Refuses rather than silently trimming: an employee who asks for 3 sick
 * days and gets 2 without being told will believe they have 3.
 */
export function checkLeaveRequest(input: {
  employeeId: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  month: string;
  requests?: LeaveRequest[];
}): { ok: true } | { ok: false; error: string } {
  const spec = leaveSpec(input.type);
  if (!spec) return { ok: false, error: "Choose a leave type." };
  if (input.days <= 0) {
    return { ok: false, error: "That range has no working days in it — it is all weekly offs or holidays." };
  }

  const balances = balancesFor(input.employeeId, input.month, input.requests ?? loadLeave());
  const b = balances.find((x) => x.type === input.type)!;

  if (spec.perMonth !== null && b.usedThisMonth + input.days > spec.perMonth) {
    return {
      ok: false,
      error: `${spec.label} is limited to ${spec.perMonth} day(s) a month. You have used ${b.usedThisMonth} and are asking for ${input.days}. Apply for the balance as leave without pay, or speak to accounts.`,
    };
  }
  if (spec.perYear !== null && b.usedThisYear + input.days > spec.perYear) {
    return {
      ok: false,
      error: `${spec.label} is limited to ${spec.perYear} day(s) a year, and ${b.usedThisYear} are already used.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The daily cut-off                                                   */
/* ------------------------------------------------------------------ */

export interface AttendanceRules {
  /** Hour after which an employee can no longer mark their own day. */
  markByHour: number;
  /** Reminders start after this hour if nothing is marked. */
  remindAfterHour: number;
  /** How many reminders go out on the day. */
  reminderCount: number;
  /** Next-day hour after which silence becomes a warning. */
  warnNextDayHour: number;
  enabled: boolean;

  /* ---- Developer-controlled register rules (Attendance → Rules) ---- */
  /** Weekly off days, 0 = Sunday … 6 = Saturday. */
  weekOffDays: number[];
  /** Shown against the Late mark — "arrived after 09:30". */
  lateAfter: string;
  /** Every N Late marks in a month cut half a day's pay. 0 = never. */
  latesPerHalfDay: number;
  /** A plant manager may edit today and this many days back. */
  managerBackDays: number;
  /** Allow marks on days that have not happened yet (planned leave, etc.). */
  allowFutureMarks: boolean;
  /** Announced holidays are written into the register as H. */
  autoMarkHolidays: boolean;
  /** Blank weekly-off days are shown (and saved) as WO. */
  autoMarkWeekOff: boolean;
  /** Plant managers may raise leave on behalf of their plant's staff. */
  plantManagerLeave: boolean;
  updatedAt?: string;
  updatedByName?: string;
}

export const DEFAULT_RULES: AttendanceRules = {
  markByHour: 14,       // 2 PM — the business's own rule
  remindAfterHour: 15,  // 3 PM
  reminderCount: 3,
  warnNextDayHour: 13,  // 1 PM next day
  enabled: true,
  weekOffDays: [0],
  lateAfter: "09:30",
  latesPerHalfDay: 0,
  managerBackDays: 3,
  allowFutureMarks: false,
  autoMarkHolidays: true,
  autoMarkWeekOff: true,
  plantManagerLeave: true,
};

function rulesFile() { return path.join(paths.configDir, "attendance-rules.json"); }

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** Cleans a stored or submitted rule set — the file is hand-editable. */
export function cleanRules(raw: Partial<AttendanceRules> | null | undefined): AttendanceRules {
  const r = { ...DEFAULT_RULES, ...(raw || {}) };
  const week = Array.isArray(r.weekOffDays)
    ? [...new Set(r.weekOffDays.map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 6))].sort()
    : DEFAULT_RULES.weekOffDays;
  return {
    markByHour: clampInt(r.markByHour, 0, 23, DEFAULT_RULES.markByHour),
    remindAfterHour: clampInt(r.remindAfterHour, 0, 23, DEFAULT_RULES.remindAfterHour),
    reminderCount: clampInt(r.reminderCount, 0, 10, DEFAULT_RULES.reminderCount),
    warnNextDayHour: clampInt(r.warnNextDayHour, 0, 23, DEFAULT_RULES.warnNextDayHour),
    enabled: Boolean(r.enabled),
    weekOffDays: week.length < 7 ? week : DEFAULT_RULES.weekOffDays,
    lateAfter: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.lateAfter)) ? String(r.lateAfter) : DEFAULT_RULES.lateAfter,
    latesPerHalfDay: clampInt(r.latesPerHalfDay, 0, 31, 0),
    managerBackDays: clampInt(r.managerBackDays, 0, 62, DEFAULT_RULES.managerBackDays),
    allowFutureMarks: Boolean(r.allowFutureMarks),
    autoMarkHolidays: Boolean(r.autoMarkHolidays),
    autoMarkWeekOff: Boolean(r.autoMarkWeekOff),
    plantManagerLeave: Boolean(r.plantManagerLeave),
    updatedAt: r.updatedAt,
    updatedByName: r.updatedByName,
  };
}

export function loadRules(): AttendanceRules {
  return cleanRules(readJson<Partial<AttendanceRules>>(rulesFile(), {}));
}

export function saveRules(rules: AttendanceRules): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(rulesFile(), cleanRules(rules));
}

/** YYYY-MM-DD in the server's own clock (not UTC — 1 AM in India is today). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Whether a PLANT MANAGER (or anyone marking a team without approval
 * rights) may change a given day: today and `managerBackDays` before it.
 * Future days only when the developer allowed them.
 */
export function canManagerMark(date: string, now: Date, rules = loadRules()): { allowed: boolean; reason?: string } {
  const today = localDate(now);
  if (date > today) {
    return rules.allowFutureMarks ? { allowed: true } : { allowed: false, reason: "That day hasn't happened yet." };
  }
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - rules.managerBackDays);
  if (date < localDate(earliest)) {
    return {
      allowed: false,
      reason: `Only the last ${rules.managerBackDays} day(s) can be changed from here. Ask accounts to correct older days.`,
    };
  }
  return { allowed: true };
}

/**
 * Whether an EMPLOYEE may still mark a given day themselves.
 *
 * `now` is a parameter so this is testable and so a payroll recomputation
 * for an old month is judged by the rules of that moment, not today's.
 *
 * Note what this does NOT do: it never locks accounts or the admin out.
 * The cut-off is a discipline for the person marking their own attendance,
 * not a wall that stops the office correcting a mistake.
 */
export function canEmployeeMark(date: string, now: Date, rules = loadRules()): { allowed: boolean; reason?: string } {
  if (!rules.enabled) return { allowed: true };

  const today = now.toISOString().slice(0, 10);
  if (date > today) return { allowed: false, reason: "That day hasn't happened yet." };
  if (date < today) {
    return {
      allowed: false,
      reason: "The day is over. Ask accounts or the admin to correct it, or raise it under Help & Support.",
    };
  }
  if (now.getHours() >= rules.markByHour) {
    const h = rules.markByHour;
    const label = h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`;
    return {
      allowed: false,
      reason: `Attendance closes at ${label}. Ask accounts to mark it, or apply for leave if you were away.`,
    };
  }
  return { allowed: true };
}

export type ChaseStage = "none" | "reminder" | "warning";

/**
 * What, if anything, should be sent to someone who hasn't marked a day.
 *
 * Deliberately conservative about weekends and holidays — chasing somebody
 * on a day they were never expected to work is how a reminder system gets
 * ignored, and once it is ignored it is useless.
 */
export function chaseStageFor(input: {
  date: string;
  now: Date;
  region: HolidayRegion;
  hasAttendance: boolean;
  hasLeaveRequest: boolean;
  remindersSent: number;
  warningSent: boolean;
  rules?: AttendanceRules;
  holidays?: Holiday[];
}): { stage: ChaseStage; reason: string } {
  const rules = input.rules ?? loadRules();
  if (!rules.enabled) return { stage: "none", reason: "Chasing is switched off." };
  if (input.hasAttendance) return { stage: "none", reason: "Attendance is marked." };
  if (input.hasLeaveRequest) return { stage: "none", reason: "A leave request covers this day." };

  const holidays = input.holidays ?? loadHolidays();
  if (isNonWorkingDay(input.date, input.region, holidays, rules.weekOffDays)) {
    return { stage: "none", reason: "Not a working day for this person." };
  }

  const day = new Date(`${input.date}T00:00:00`);
  const now = input.now;
  const sameDay = now.toISOString().slice(0, 10) === input.date;
  const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
  const isNextDayOrLater = now >= nextDay;

  if (sameDay) {
    if (now.getHours() < rules.remindAfterHour) {
      return { stage: "none", reason: "Still before the reminder hour." };
    }
    if (input.remindersSent >= rules.reminderCount) {
      return { stage: "none", reason: "All reminders for the day have gone." };
    }
    return { stage: "reminder", reason: `Nothing marked after ${rules.remindAfterHour}:00.` };
  }

  if (isNextDayOrLater) {
    if (input.warningSent) return { stage: "none", reason: "A warning has already gone." };
    // Only after the next-day deadline, and only once.
    const deadline = new Date(nextDay);
    deadline.setHours(rules.warnNextDayHour, 0, 0, 0);
    if (now >= deadline) {
      return { stage: "warning", reason: `No response by ${rules.warnNextDayHour}:00 the next day.` };
    }
    return { stage: "none", reason: "Next-day deadline has not passed yet." };
  }

  return { stage: "none", reason: "Nothing due." };
}
