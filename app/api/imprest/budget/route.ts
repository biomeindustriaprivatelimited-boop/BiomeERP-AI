import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { loadEntries, loadPeople, personForUser, IMPREST_CATEGORIES } from "@/lib/imprest";
import { loadEmployees } from "@/lib/payroll";
import {
  loadBudgets, saveBudgets, makeBudget, usageForMonth, validateBudget, keyFor, makeLookup,
  visibleBudgets, isBudgetAuthority,
  BUDGET_SCOPES, BUDGET_PERIODS, SCOPE_FIELDS, BudgetScope, BudgetPeriod, BudgetMatch, ImprestBudget,
} from "@/lib/imprestBudget";
import { recordAudit } from "@/lib/audit";

/**
 * Imprest budgets.
 *
 * Anyone who can see imprest can READ the budgets that apply to them — a
 * holder who cannot see what is left has no way to spend inside it. Only
 * the admin or the developer sets them (and passes over-budget entries,
 * see ./approval).
 */
function livePlants() { return plantOptions().map((p) => ({ code: p.code, label: p.label })); }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPE_IDS = Object.keys(SCOPE_FIELDS) as BudgetScope[];
const PERIOD_IDS: BudgetPeriod[] = ["monthly", "quarterly", "yearly", "custom"];

function scopeOf(v: unknown): BudgetScope {
  return SCOPE_IDS.includes(v as BudgetScope) ? (v as BudgetScope) : "head";
}
function periodOf(v: unknown): BudgetPeriod {
  return PERIOD_IDS.includes(v as BudgetPeriod) ? (v as BudgetPeriod) : "monthly";
}

const PERIOD_WORD: Record<BudgetPeriod, string> = {
  monthly: "a month", quarterly: "a quarter", yearly: "a year", custom: "for the period",
};

/** Human label from the match: "Ramesh Kumar · Fuel & diesel". */
function labelFor(match: BudgetMatch, scope: BudgetScope): string {
  const parts: string[] = [];
  if (match.personId) parts.push(loadPeople().find((p) => p.id === match.personId)?.name || "Holder");
  if (match.plant) parts.push(livePlants().find((p) => p.code === match.plant)?.label || match.plant);
  if (match.designation) parts.push(match.designation);
  if (match.department) parts.push(`${match.department} dept.`);
  if (match.category) parts.push(match.category);
  return parts.join(" · ") || (scope === "all" ? "Whole company" : "Budget");
}

function readMatch(body: any): BudgetMatch {
  const src = body?.match && typeof body.match === "object" ? body.match : body || {};
  const out: BudgetMatch = {};
  for (const k of ["personId", "plant", "category", "designation", "department"] as (keyof BudgetMatch)[]) {
    const v = String(src[k] ?? "").trim();
    if (v) out[k] = v.slice(0, 120);
  }
  // Older screens sent { scope, key }.
  if (!body?.match && body?.key) {
    const scope = scopeOf(body.scope);
    if (scope === "head") out.category = String(body.key);
    if (scope === "plant") out.plant = String(body.key);
    if (scope === "person") out.personId = String(body.key);
  }
  return out;
}

/** Same subject, same period, both live → they would both claim the same spend. */
function clashWith(budgets: ImprestBudget[], b: ImprestBudget): ImprestBudget | undefined {
  return budgets.find(
    (x) =>
      x.id !== b.id && x.active && b.active && x.scope === b.scope && x.key === b.key && x.period === b.period &&
      (b.period !== "custom" || (x.startDate <= b.endDate && x.endDate >= b.startDate))
  );
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const entries = loadEntries();
  const people = loadPeople();
  const employees = loadEmployees();
  const lookup = makeLookup(people, employees);
  const authority = isBudgetAuthority(user.role);
  const seeAll = authority || hasPermission(user.role, "imprest.viewAll") || hasPermission(user.role, "imprest.approve");
  const plantView = hasPermission(user.role, "imprest.viewPlant") && auth.session.plant ? auth.session.plant : null;
  const me = personForUser(user.id);
  const all = loadBudgets();
  const budgets = visibleBudgets(all, {
    all: seeAll, personId: me?.id ?? null, plantView, sessionPlant: auth.session.plant || null, lookup,
  });

  const designations = [...new Set([
    ...people.map((p) => p.designation),
    ...employees.filter((e) => e.active).map((e) => e.designation),
  ].map((d) => String(d || "").trim()).filter(Boolean))].sort();
  const departments = [...new Set(employees.filter((e) => e.active).map((e) => String(e.department || "").trim()).filter(Boolean))].sort();

  return NextResponse.json({
    month,
    // Every budget, including those switched off or not in force this
    // month, so the admin can find and edit them.
    budgets: authority ? all : budgets,
    usage: usageForMonth(budgets, month, entries, lookup),
    scopes: BUDGET_SCOPES,
    scopeFields: SCOPE_FIELDS,
    periods: BUDGET_PERIODS,
    categories: IMPREST_CATEGORIES,
    people: authority ? people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, code: p.code, plant: p.plant, designation: p.designation })) : [],
    designations,
    departments,
    // The plant list comes from the plant master, not from whoever happens
    // to hold an imprest float. Anything typed into a holder record that is
    // not in the master is added on the end rather than dropped.
    plants: [
      ...livePlants(),
      ...[...new Set(people.map((p) => p.plant).filter(Boolean))]
        .filter((code) => !livePlants().some((p) => p.code === code))
        .map((code) => ({ code, label: code })),
    ],
    canManage: authority,
    heldCount: authority ? entries.filter((e) => e.status === "pending_budget_approval").length : 0,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!isBudgetAuthority(user.role)) {
    return NextResponse.json({ error: "Only the admin or the developer can set an imprest budget." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const scope = scopeOf(body?.scope);
  const match = readMatch(body);
  const period = periodOf(body?.period);

  const budget = makeBudget({
    scope, match, period,
    label: String(body?.label ?? "").trim() || labelFor(match, scope),
    amount: Math.round(Number(body?.amount) || 0),
    fromMonth: String(body?.fromMonth ?? ""),
    toMonth: String(body?.toMonth ?? ""),
    startDate: String(body?.startDate ?? ""),
    endDate: String(body?.endDate ?? ""),
    enforce: body?.enforce !== false,
    note: String(body?.note ?? ""),
    by: user.id,
  });
  const problem = validateBudget(budget);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const budgets = loadBudgets();
  const clash = clashWith(budgets, budget);
  if (clash) {
    return NextResponse.json(
      { error: `There is already a ${clash.period} budget on ${clash.label}. Edit that one instead of adding a second.` },
      { status: 409 }
    );
  }

  saveBudgets([...budgets, budget]);
  recordAudit({
    action: "IMPREST_BUDGET_SET",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "imprest_budget", targetId: budget.id, targetLabel: budget.label,
    detail: `₹${budget.amount.toLocaleString("en-IN")} ${PERIOD_WORD[budget.period]}${budget.enforce ? " · hard limit" : " · warn only"}`,
  });

  return NextResponse.json({ budget }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!isBudgetAuthority(user.role)) {
    return NextResponse.json({ error: "Only the admin or the developer can change an imprest budget." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which budget?" }, { status: 400 });

  const budgets = loadBudgets();
  const index = budgets.findIndex((b) => b.id === body.id);
  if (index === -1) return NextResponse.json({ error: "That budget no longer exists." }, { status: 404 });

  const before = budgets[index];
  const str = (k: string, len: number) => (body[k] !== undefined ? String(body[k]).slice(0, len) : (before as any)[k]);
  const updated: ImprestBudget = {
    ...before,
    amount: body.amount !== undefined ? Math.max(0, Math.round(Number(body.amount) || 0)) : before.amount,
    label: body.label !== undefined ? String(body.label).trim().slice(0, 160) || before.label : before.label,
    period: body.period !== undefined ? periodOf(body.period) : before.period,
    fromMonth: str("fromMonth", 7),
    toMonth: str("toMonth", 7),
    startDate: str("startDate", 10),
    endDate: str("endDate", 10),
    note: str("note", 300),
    enforce: body.enforce !== undefined ? body.enforce !== false : before.enforce,
    active: body.active !== undefined ? body.active !== false : before.active,
    updatedAt: new Date().toISOString(),
  };
  updated.key = keyFor(updated.match);
  const problem = validateBudget(updated);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const clash = clashWith(budgets, updated);
  if (clash) return NextResponse.json({ error: `That would duplicate the budget on ${clash.label}.` }, { status: 409 });

  budgets[index] = updated;
  saveBudgets(budgets);

  const changes: string[] = [];
  if (before.amount !== updated.amount) changes.push(`₹${before.amount.toLocaleString("en-IN")} → ₹${updated.amount.toLocaleString("en-IN")}`);
  if (before.active !== updated.active) changes.push(updated.active ? "switched on" : "switched off");
  if (before.enforce !== updated.enforce) changes.push(updated.enforce ? "hard limit" : "warn only");
  if (before.period !== updated.period) changes.push(`${before.period} → ${updated.period}`);
  recordAudit({
    action: "IMPREST_BUDGET_CHANGED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "imprest_budget", targetId: updated.id, targetLabel: updated.label,
    detail: changes.join(", ") || "edited",
  });

  return NextResponse.json({ budget: updated });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!isBudgetAuthority(user.role)) {
    return NextResponse.json({ error: "Only the admin or the developer can remove an imprest budget." }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id") || "";
  const budgets = loadBudgets();
  const budget = budgets.find((b) => b.id === id);
  if (!budget) return NextResponse.json({ error: "That budget no longer exists." }, { status: 404 });

  saveBudgets(budgets.filter((b) => b.id !== id));
  recordAudit({
    action: "IMPREST_BUDGET_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "imprest_budget", targetId: budget.id, targetLabel: budget.label,
    detail: `Was ₹${budget.amount.toLocaleString("en-IN")} ${PERIOD_WORD[budget.period]}.`,
  });

  return NextResponse.json({ ok: true });
}
