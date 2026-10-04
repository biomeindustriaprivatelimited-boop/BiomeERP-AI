/**
 * Biome Platform — imprest budgets
 * -------------------------------------------------------------------
 * A spending ceiling on imprest expenses, set by the admin or developer.
 *
 * WHAT A BUDGET COVERS (scope) — any one subject or a combination:
 *   all            every expense in the company
 *   head           one expense head (diesel, repairs …) across everyone
 *   plant          everything drawn against one site
 *   person         one holder (employee) — their personal allocation
 *   designation    every holder with that designation (e.g. "Driver")
 *   department     every holder whose employee record is in that department
 *   plant_head     one expense head at one plant
 *   person_head    one expense head for one holder
 *   designation_head  one expense head for a designation
 *
 * FOR WHICH PERIOD — monthly (calendar month), quarterly or yearly on the
 * Indian financial year (April–March), or a one-off custom date range.
 *
 * TWO NUMBERS, NOT ONE. Money already approved (`spent`) and money filed
 * and waiting for accounts (`committed`) are counted separately and both
 * use up the budget, so a head never reads "free" while its bills sit in
 * the queue.
 *
 * ENFORCEMENT (the business decision, Oct 2026). A budget marked `enforce`
 * is a hard ceiling: an expense that would take ANY enforced budget past
 * its amount is not filed as a normal claim. It is stored with status
 * `pending_budget_approval` and only an admin or the developer can let it
 * through (it then becomes an ordinary claim for accounts) or reject it.
 * Entries waiting on that decision do NOT use up the budget — nobody has
 * agreed to the extra spend yet.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import type { ImprestEntry, ImprestPerson } from "@/lib/imprest";
import { isSpend } from "@/lib/imprest";

export type BudgetScope =
  | "all" | "head" | "plant" | "person" | "designation" | "department"
  | "plant_head" | "person_head" | "designation_head";

export type BudgetPeriod = "monthly" | "quarterly" | "yearly" | "custom";

/** Which criteria a scope uses, in the order the form asks for them. */
export const SCOPE_FIELDS: Record<BudgetScope, (keyof BudgetMatch)[]> = {
  all: [],
  head: ["category"],
  plant: ["plant"],
  person: ["personId"],
  designation: ["designation"],
  department: ["department"],
  plant_head: ["plant", "category"],
  person_head: ["personId", "category"],
  designation_head: ["designation", "category"],
};

export const BUDGET_SCOPES: { id: BudgetScope; label: string; help: string }[] = [
  { id: "person", label: "Employee (holder)", help: "One person's allocation — every head together." },
  { id: "plant", label: "Plant", help: "Everything drawn against one site." },
  { id: "head", label: "Expense head", help: "Diesel, repairs, freight — across everyone." },
  { id: "plant_head", label: "Plant + expense head", help: "One head at one site, e.g. diesel at Rewari." },
  { id: "person_head", label: "Employee + expense head", help: "One head for one person, e.g. travel for a coordinator." },
  { id: "designation", label: "Designation", help: "Every holder with that designation, together." },
  { id: "designation_head", label: "Designation + expense head", help: "One head for a designation, e.g. fuel for drivers." },
  { id: "department", label: "Department", help: "Every holder in that department (from the employee master)." },
  { id: "all", label: "Whole company", help: "Total imprest spend across all plants and people." },
];

export const BUDGET_PERIODS: { id: BudgetPeriod; label: string; help: string }[] = [
  { id: "monthly", label: "Monthly", help: "Resets on the 1st of every calendar month." },
  { id: "quarterly", label: "Quarterly", help: "Financial-year quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar." },
  { id: "yearly", label: "Yearly (FY)", help: "April to March." },
  { id: "custom", label: "Custom dates", help: "One fixed date range — a project, a season, a shutdown." },
];

export interface BudgetMatch {
  personId?: string;
  plant?: string;
  category?: string;
  designation?: string;
  department?: string;
}

export interface ImprestBudget {
  id: string;
  scope: BudgetScope;
  /** Stable text form of `match`, used to spot duplicates. */
  key: string;
  /** Shown on screen — names rather than ids. */
  label: string;
  /** Rupees per period. */
  amount: number;
  period: BudgetPeriod;
  /** Recurring budgets: first and last month in force ("2026-08"). Blank = open. */
  fromMonth: string;
  toMonth: string;
  /** Custom budgets: the one date range ("2026-10-01" … "2026-12-15"). */
  startDate: string;
  endDate: string;
  match: BudgetMatch;
  /** Hard ceiling: crossing it needs admin approval. False = warn only. */
  enforce: boolean;
  note: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface BudgetFile { budgets: ImprestBudget[]; updatedAt?: string; }

function file(): string {
  return path.join(paths.root, "imprest", "budgets.json");
}

/** Who may set budgets and pass over-budget entries. */
export function isBudgetAuthority(role: string | null | undefined): boolean {
  return role === "admin" || role === "developer";
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const SCOPES = Object.keys(SCOPE_FIELDS) as BudgetScope[];

export function keyFor(match: BudgetMatch): string {
  return (["personId", "plant", "category", "designation", "department"] as (keyof BudgetMatch)[])
    .filter((k) => match[k])
    .map((k) => `${k}=${match[k]}`)
    .join("|") || "all";
}

/** Older files: monthly only, scope + key, no match block, advisory. */
function normalise(raw: any): ImprestBudget {
  const scope: BudgetScope = SCOPES.includes(raw.scope) ? raw.scope : "head";
  let match: BudgetMatch = raw.match && typeof raw.match === "object" ? raw.match : {};
  if (!raw.match) {
    if (scope === "head") match = { category: raw.key };
    else if (scope === "plant") match = { plant: raw.key };
    else if (scope === "person") match = { personId: raw.key };
  }
  return {
    id: raw.id,
    scope,
    key: raw.match ? raw.key || keyFor(match) : keyFor(match),
    label: raw.label || raw.key || "Budget",
    amount: Math.max(0, Number(raw.amount) || 0),
    period: (["monthly", "quarterly", "yearly", "custom"] as BudgetPeriod[]).includes(raw.period) ? raw.period : "monthly",
    fromMonth: String(raw.fromMonth || "").slice(0, 7),
    toMonth: String(raw.toMonth || "").slice(0, 7),
    startDate: String(raw.startDate || "").slice(0, 10),
    endDate: String(raw.endDate || "").slice(0, 10),
    match,
    // The business asked for budgets to be hard ceilings. A budget saved
    // before that decision follows it too unless someone switches it off.
    enforce: raw.enforce !== false,
    note: String(raw.note || ""),
    active: raw.active !== false,
    createdBy: raw.createdBy || "",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  };
}

export function loadBudgets(): ImprestBudget[] {
  const f = readJson<BudgetFile>(file(), { budgets: [] });
  return Array.isArray(f.budgets) ? f.budgets.map(normalise) : [];
}

export function saveBudgets(budgets: ImprestBudget[]): void {
  ensureDir(path.join(paths.root, "imprest"));
  writeJsonAtomic(file(), { budgets, updatedAt: new Date().toISOString() });
}

export function makeBudget(input: {
  scope: BudgetScope; match: BudgetMatch; label: string; amount: number;
  period?: BudgetPeriod; fromMonth?: string; toMonth?: string;
  startDate?: string; endDate?: string; enforce?: boolean; note?: string; by: string;
}): ImprestBudget {
  const now = new Date().toISOString();
  const match: BudgetMatch = {};
  for (const k of SCOPE_FIELDS[input.scope]) {
    const v = String(input.match[k] ?? "").trim();
    if (v) match[k] = v;
  }
  return {
    id: crypto.randomUUID(),
    scope: input.scope,
    key: keyFor(match),
    label: String(input.label || keyFor(match)).trim().slice(0, 160),
    amount: Math.max(0, Math.round(Number(input.amount) || 0)),
    period: input.period || "monthly",
    fromMonth: (input.fromMonth || "").slice(0, 7),
    toMonth: (input.toMonth || "").slice(0, 7),
    startDate: (input.startDate || "").slice(0, 10),
    endDate: (input.endDate || "").slice(0, 10),
    match,
    enforce: input.enforce !== false,
    note: String(input.note || "").slice(0, 300),
    active: true,
    createdBy: input.by,
    createdAt: now,
    updatedAt: now,
  };
}

/** What is missing from a budget before it can be saved. Null when fine. */
export function validateBudget(b: ImprestBudget): string | null {
  for (const k of SCOPE_FIELDS[b.scope]) {
    if (!b.match[k]) return "Choose what this budget covers.";
  }
  if (b.amount <= 0 && b.active) return "A budget needs an amount above zero.";
  if (b.period === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(b.endDate)) {
      return "A custom budget needs a start date and an end date.";
    }
    if (b.endDate < b.startDate) return "The end date is before the start date.";
  } else if (b.fromMonth && b.toMonth && b.toMonth < b.fromMonth) {
    return "\"Until\" is before \"Runs from\".";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Who an entry belongs to                                             */
/* ------------------------------------------------------------------ */

export interface HolderInfo { plant: string; designation: string; department: string; }
export type HolderLookup = (personId: string) => HolderInfo | undefined;

/**
 * Designation comes from the holder record; department from the employee
 * master (matched by code, then by name), because the holder register has
 * no department of its own.
 */
export function makeLookup(
  people: ImprestPerson[],
  employees: { code: string; name: string; department?: string; designation?: string }[] = []
): HolderLookup {
  const map = new Map<string, HolderInfo>();
  for (const p of people) {
    const emp =
      employees.find((e) => e.code && e.code.toUpperCase() === p.code.toUpperCase()) ||
      employees.find((e) => e.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    map.set(p.id, {
      plant: p.plant || "",
      designation: (p.designation || emp?.designation || "").trim(),
      department: (emp?.department || "").trim(),
    });
  }
  return (id) => map.get(id);
}

const same = (a: string | undefined, b: string | undefined) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** Does this entry fall under this budget? */
export function covers(b: ImprestBudget, entry: ImprestEntry, lookup?: HolderLookup): boolean {
  // Only spending counts. Cash handed to a holder or handed back is not an
  // expense against anything.
  if (!isSpend(entry)) return false;
  const m = b.match;
  const info = lookup?.(entry.personId);
  if (m.personId && entry.personId !== m.personId) return false;
  if (m.plant && (entry.plant || info?.plant || "") !== m.plant) return false;
  if (m.category && entry.category !== m.category) return false;
  if (m.designation && !same(info?.designation, m.designation)) return false;
  if (m.department && !same(info?.department, m.department)) return false;
  return true;
}

/**
 * Could this budget ever cover an expense filed by this holder? Category
 * is ignored — the holder can pick any head. Used to show a person the
 * budgets that apply to them and nobody else's.
 */
export function relevantTo(b: ImprestBudget, personId: string, info: HolderInfo | undefined, plant?: string | null): boolean {
  const m = b.match;
  if (m.personId && m.personId !== personId) return false;
  if (m.plant && m.plant !== (plant || info?.plant || "")) return false;
  if (m.designation && !same(info?.designation, m.designation)) return false;
  if (m.department && !same(info?.department, m.department)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export interface PeriodWindow { start: string; end: string; label: string; }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
function lastDay(y: number, m: number): string {
  // m is 1-12
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
const fyLabel = (startYear: number) => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/** The natural period (before clipping) that contains a date. */
function rawWindow(period: BudgetPeriod, date: string): PeriodWindow {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (period === "quarterly") {
    // Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
    const fyStart = m >= 4 ? y : y - 1;
    const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
    const sm = q === 4 ? 1 : 4 + (q - 1) * 3;
    const sy = q === 4 ? fyStart + 1 : fyStart;
    return { start: `${sy}-${pad(sm)}-01`, end: lastDay(sy, sm + 2), label: `Q${q} ${fyLabel(fyStart)}` };
  }
  if (period === "yearly") {
    const fyStart = m >= 4 ? y : y - 1;
    return { start: `${fyStart}-04-01`, end: lastDay(fyStart + 1, 3), label: fyLabel(fyStart) };
  }
  return { start: `${y}-${pad(m)}-01`, end: lastDay(y, m), label: `${MONTHS[m - 1]} ${y}` };
}

/**
 * The window of this budget that contains `date`, or null when the budget
 * is not in force on that day. Recurring windows are clipped to the
 * budget's from/until months.
 */
export function windowFor(b: ImprestBudget, date: string): PeriodWindow | null {
  if (!b.active || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const d = date.slice(0, 10);
  if (b.period === "custom") {
    if (!b.startDate || !b.endDate || d < b.startDate || d > b.endDate) return null;
    return { start: b.startDate, end: b.endDate, label: `${b.startDate} to ${b.endDate}` };
  }
  const month = d.slice(0, 7);
  if (b.fromMonth && month < b.fromMonth) return null;
  if (b.toMonth && month > b.toMonth) return null;
  const w = rawWindow(b.period, d);
  if (b.fromMonth && `${b.fromMonth}-01` > w.start) w.start = `${b.fromMonth}-01`;
  if (b.toMonth) {
    const end = lastDay(Number(b.toMonth.slice(0, 4)), Number(b.toMonth.slice(5, 7)));
    if (end < w.end) w.end = end;
  }
  return w;
}

/** Every window of a budget that overlaps [from, to] — used by reports. */
export function windowsBetween(b: ImprestBudget, from: string, to: string): PeriodWindow[] {
  if (b.period === "custom") {
    if (!b.startDate || !b.endDate || b.endDate < from || b.startDate > to) return [];
    return [{ start: b.startDate, end: b.endDate, label: `${b.startDate} to ${b.endDate}` }];
  }
  const out: PeriodWindow[] = [];
  let cursor = from.slice(0, 10);
  let guard = 0;
  while (cursor <= to && guard++ < 200) {
    const w = windowFor({ ...b, active: true }, cursor);
    const raw = rawWindow(b.period, cursor);
    if (w && !out.some((x) => x.start === w.start)) out.push(w);
    // step to the day after this natural period
    const next = new Date(raw.end + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */

export interface BudgetUsage {
  budget: ImprestBudget;
  /** Kept for older screens: the month the usage was asked for. */
  month: string;
  window: PeriodWindow;
  /** Approved, settled. */
  spent: number;
  /** Filed and waiting for accounts — will land on this budget if passed. */
  committed: number;
  /** Over-budget entries waiting for admin — NOT counted in remaining. */
  held: number;
  heldCount: number;
  /** Allocation less spent and committed. Negative means already over. */
  remaining: number;
  /** Of the allocation, how much is used or promised. 0-999. */
  pct: number;
  state: "clear" | "watch" | "tight" | "over";
  entries: number;
}

/** Pure: the same numbers appear on the page, the approval card and reports. */
export function usageIn(
  b: ImprestBudget, window: PeriodWindow, entries: ImprestEntry[], lookup?: HolderLookup
): BudgetUsage {
  let spent = 0, committed = 0, held = 0, heldCount = 0, count = 0;
  for (const e of entries) {
    if (e.date < window.start || e.date > window.end) continue;
    if (!covers(b, e, lookup)) continue;
    if (e.status === "approved") { spent += e.amount; count += 1; }
    else if (e.status === "submitted") { committed += e.amount; count += 1; }
    else if (e.status === "pending_budget_approval") { held += e.amount; heldCount += 1; }
  }
  const used = spent + committed;
  const remaining = Math.round((b.amount - used) * 100) / 100;
  const pct = b.amount > 0 ? Math.min(999, Math.round((used / b.amount) * 100)) : 0;
  const state: BudgetUsage["state"] =
    remaining < 0 ? "over" : pct >= 90 ? "tight" : pct >= 75 ? "watch" : "clear";
  return {
    budget: b, month: window.start.slice(0, 7), window,
    spent, committed, held, heldCount, remaining, pct, state, entries: count,
  };
}

/** Usage of every budget in force during a calendar month (YYYY-MM). */
export function usageForMonth(
  budgets: ImprestBudget[], month: string, entries: ImprestEntry[], lookup?: HolderLookup
): BudgetUsage[] {
  const today = new Date().toISOString().slice(0, 10);
  const first = `${month}-01`;
  const last = lastDay(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  // The current month is looked at "as of today"; any other month at its end.
  const ref = today >= first && today <= last ? today : last;
  const out: BudgetUsage[] = [];
  for (const b of budgets) {
    let w = windowFor(b, ref);
    if (!w && b.period === "custom" && b.active && b.startDate <= last && b.endDate >= first) {
      w = { start: b.startDate, end: b.endDate, label: `${b.startDate} to ${b.endDate}` };
    }
    if (!w && b.period !== "custom") w = windowFor(b, first);
    if (w) out.push(usageIn(b, w, entries, lookup));
  }
  return out.sort((a, b) => a.remaining - b.remaining);
}

export interface BudgetImpact {
  budgetId: string;
  label: string;
  scope: BudgetScope;
  period: BudgetPeriod;
  periodLabel: string;
  enforce: boolean;
  amount: number;
  /** Where it stands WITHOUT this entry. */
  remainingBefore: number;
  /** Where it would stand once this entry is passed. */
  remainingAfter: number;
  /** How far past the allocation this entry takes it. 0 when still inside. */
  overBy: number;
}

/**
 * What one expense does to the budgets it touches. The entry's own amount
 * is excluded from the "before" figure so the two read as before and after.
 */
export function impactOf(
  entry: ImprestEntry,
  budgets: ImprestBudget[],
  entries: ImprestEntry[],
  lookup?: HolderLookup
): BudgetImpact[] {
  const others = entries.filter((e) => e.id !== entry.id);
  const out: BudgetImpact[] = [];
  for (const b of budgets) {
    const w = windowFor(b, entry.date);
    if (!w || !covers(b, entry, lookup)) continue;
    const before = usageIn(b, w, others, lookup);
    const remainingAfter = Math.round((before.remaining - entry.amount) * 100) / 100;
    out.push({
      budgetId: b.id, label: b.label, scope: b.scope, period: b.period, periodLabel: w.label,
      enforce: b.enforce, amount: b.amount,
      remainingBefore: before.remaining, remainingAfter,
      overBy: remainingAfter < 0 ? Math.min(entry.amount, Math.abs(remainingAfter)) : 0,
    });
  }
  return out;
}

/** The enforced budgets this entry would break. Empty = file normally. */
export function breachesOf(impacts: BudgetImpact[]): BudgetImpact[] {
  return impacts.filter((i) => i.enforce && i.overBy > 0);
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Plain sentence for the person filing: what was blocked and why. */
export function breachMessage(breaches: BudgetImpact[]): string {
  return breaches
    .map((i) => `${i.label} (${i.periodLabel}): budget ${inr(i.amount)}, ${inr(Math.max(0, i.remainingBefore))} left, this entry goes ${inr(i.overBy)} over.`)
    .join(" ");
}

/** The sentence to put in front of whoever is about to approve. */
export function impactMessage(impacts: BudgetImpact[]): string {
  const breached = impacts.filter((i) => i.overBy > 0);
  if (breached.length) {
    return breached
      .map((i) => `Approving this takes ${i.label} ${inr(i.overBy)} past its budget for ${i.periodLabel}.`)
      .join(" ");
  }
  const tight = impacts.filter((i) => i.amount > 0 && i.remainingAfter <= i.amount * 0.1);
  if (tight.length) {
    return tight.map((i) => `${i.label} would have ${inr(i.remainingAfter)} left for ${i.periodLabel}.`).join(" ");
  }
  return "";
}

/** Kept for any caller that still thinks in months. */
export function appliesTo(b: ImprestBudget, month: string): boolean {
  return !!windowFor(b, `${month}-01`) || !!windowFor(b, lastDay(Number(month.slice(0, 4)), Number(month.slice(5, 7))));
}

/**
 * Which budgets a login may see.
 *
 *   admin / developer / accounts — all of them.
 *   plant manager — those tied to their plant or to a holder at it, plus
 *     every budget that would apply to their own entries.
 *   everyone else — only the budgets their own entries count against.
 *
 * A colleague's personal allocation is never shown to someone else.
 */
export function visibleBudgets(
  budgets: ImprestBudget[],
  opts: { all: boolean; personId: string | null; plantView: string | null; sessionPlant: string | null; lookup: HolderLookup }
): ImprestBudget[] {
  if (opts.all) return budgets;
  const myInfo = opts.personId ? opts.lookup(opts.personId) : undefined;
  return budgets.filter((b) => {
    if (opts.personId && relevantTo(b, opts.personId, myInfo, opts.sessionPlant)) return true;
    if (opts.plantView) {
      if (b.match.plant === opts.plantView) return true;
      if (b.match.personId && opts.lookup(b.match.personId)?.plant === opts.plantView) return true;
    }
    return false;
  });
}
