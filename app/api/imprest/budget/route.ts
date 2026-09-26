import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission, PLANTS } from "@/lib/permissions";
import { loadEntries, loadPeople, IMPREST_CATEGORIES } from "@/lib/imprest";
import {
  loadBudgets, saveBudgets, makeBudget, usageForMonth,
  BUDGET_SCOPES, BudgetScope, ImprestBudget,
} from "@/lib/imprestBudget";
import { recordAudit } from "@/lib/audit";

/**
 * Monthly imprest allocations.
 *
 * Anyone who can see imprest can READ the budgets — a holder who cannot
 * see what is left has no way to spend inside it, which is the whole point.
 * Only an admin sets them.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManage(role: string): boolean {
  return hasPermission(role as any, "users");
}

function scopeOf(v: unknown): BudgetScope {
  return v === "plant" ? "plant" : v === "person" ? "person" : "head";
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const budgets = loadBudgets();
  const entries = loadEntries();
  const people = loadPeople();

  return NextResponse.json({
    month,
    budgets,
    usage: usageForMonth(budgets, month, entries),
    scopes: BUDGET_SCOPES,
    categories: IMPREST_CATEGORIES,
    people: people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, plant: p.plant })),
    // The plant list comes from the plant master, not from whoever happens
    // to hold an imprest float. Before this, a site with no imprest holder
    // simply did not appear in the picker — which is why only REW showed.
    // Anything typed into a holder record that is not in the master is
    // added on the end rather than dropped.
    plants: [
      ...PLANTS.map((p) => ({ code: p.code, label: p.label })),
      ...[...new Set(people.map((p) => p.plant).filter(Boolean))]
        .filter((code) => !PLANTS.some((p) => p.code === code))
        .map((code) => ({ code, label: code })),
    ],
    canManage: canManage(user.role),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canManage(user.role)) {
    return NextResponse.json({ error: "Only an admin can set an imprest budget." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const scope = scopeOf(body?.scope);
  const key = String(body?.key ?? "").trim();
  const amount = Math.round(Number(body?.amount) || 0);

  if (!key) return NextResponse.json({ error: "Choose what this budget covers." }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: "A budget needs an amount above zero." }, { status: 400 });

  const budgets = loadBudgets();
  // Two live budgets on the same thing would both claim the same spend and
  // both look breached. One per subject, edited rather than re-added.
  const clash = budgets.find((b) => b.active && b.scope === scope && b.key === key);
  if (clash) {
    return NextResponse.json(
      { error: `There is already a budget on ${clash.label}. Edit that one instead of adding a second.` },
      { status: 409 }
    );
  }

  const budget = makeBudget({
    scope, key,
    label: String(body?.label ?? "").trim() || key,
    amount,
    fromMonth: String(body?.fromMonth ?? ""),
    toMonth: String(body?.toMonth ?? ""),
    note: String(body?.note ?? ""),
    by: user.id,
  });

  saveBudgets([...budgets, budget]);
  recordAudit({
    action: "IMPREST_BUDGET_SET",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "imprest_budget", targetId: budget.id, targetLabel: budget.label,
    detail: `₹${budget.amount.toLocaleString("en-IN")} a month${budget.fromMonth ? ` from ${budget.fromMonth}` : ""}`,
  });

  return NextResponse.json({ budget }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canManage(user.role)) {
    return NextResponse.json({ error: "Only an admin can change an imprest budget." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which budget?" }, { status: 400 });

  const budgets = loadBudgets();
  const index = budgets.findIndex((b) => b.id === body.id);
  if (index === -1) return NextResponse.json({ error: "That budget no longer exists." }, { status: 404 });

  const before = budgets[index];
  const updated: ImprestBudget = {
    ...before,
    amount: body.amount !== undefined ? Math.max(0, Math.round(Number(body.amount) || 0)) : before.amount,
    label: body.label !== undefined ? String(body.label).trim() || before.label : before.label,
    fromMonth: body.fromMonth !== undefined ? String(body.fromMonth).slice(0, 7) : before.fromMonth,
    toMonth: body.toMonth !== undefined ? String(body.toMonth).slice(0, 7) : before.toMonth,
    note: body.note !== undefined ? String(body.note).slice(0, 300) : before.note,
    active: body.active !== undefined ? body.active !== false : before.active,
    updatedAt: new Date().toISOString(),
  };
  if (updated.amount <= 0 && updated.active) {
    return NextResponse.json({ error: "A live budget needs an amount above zero." }, { status: 400 });
  }

  budgets[index] = updated;
  saveBudgets(budgets);

  recordAudit({
    action: "IMPREST_BUDGET_CHANGED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "imprest_budget", targetId: updated.id, targetLabel: updated.label,
    detail: before.amount !== updated.amount
      ? `₹${before.amount.toLocaleString("en-IN")} → ₹${updated.amount.toLocaleString("en-IN")}`
      : before.active !== updated.active ? (updated.active ? "switched on" : "switched off") : "edited",
  });

  return NextResponse.json({ budget: updated });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canManage(user.role)) {
    return NextResponse.json({ error: "Only an admin can remove an imprest budget." }, { status: 403 });
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
    detail: `Was ₹${budget.amount.toLocaleString("en-IN")} a month.`,
  });

  return NextResponse.json({ ok: true });
}
