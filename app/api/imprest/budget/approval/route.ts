import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadEntries, saveEntries, loadPeople, personForUser, event } from "@/lib/imprest";
import { loadEmployees } from "@/lib/payroll";
import { loadBudgets, impactOf, makeLookup, isBudgetAuthority } from "@/lib/imprestBudget";
import { recordAudit } from "@/lib/audit";

/**
 * Over-budget approvals.
 *
 * An expense that crossed an enforced budget is held with status
 * `pending_budget_approval`. Only the admin or the developer decides it:
 *
 *   approve → it becomes an ordinary claim (`submitted`) and goes through
 *             the normal accounts approval like any other entry;
 *   reject  → it is rejected, with the reason shown to the holder.
 *
 * Nobody passes their own entry, same rule as accounts approval.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!isBudgetAuthority(user.role)) {
    return NextResponse.json({ error: "Only the admin or the developer can see over-budget approvals." }, { status: 403 });
  }

  const all = loadEntries();
  const people = loadPeople();
  const lookup = makeLookup(people, loadEmployees());
  const budgets = loadBudgets();
  const me = personForUser(user.id);
  const nameOf = (id: string) => people.find((p) => p.id === id);

  const shape = (e: (typeof all)[number]) => ({
    ...e,
    holder: nameOf(e.personId)?.name || "—",
    holderCode: nameOf(e.personId)?.code || "",
    // Where the budgets stand NOW, not when it was filed.
    impacts: impactOf(e, budgets, all, lookup),
    own: !!me && e.personId === me.id,
  });

  const pending = all
    .filter((e) => e.status === "pending_budget_approval")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(shape);
  const decided = all
    .filter((e) => e.budgetHold && e.budgetHold.decision !== "pending")
    .sort((a, b) => String(b.budgetHold!.decidedAt).localeCompare(String(a.budgetHold!.decidedAt)))
    .slice(0, 40)
    .map(shape);

  return NextResponse.json({ pending, decided });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!isBudgetAuthority(user.role)) {
    return NextResponse.json({ error: "Only the admin or the developer can pass an over-budget entry." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : body.id ? [String(body.id)] : [];
  const decision = String(body.decision || "");
  const note = String(body.note || "").trim().slice(0, 500);

  if (!ids.length) return NextResponse.json({ error: "Which entries?" }, { status: 400 });
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Decision must be approve or reject." }, { status: 400 });
  }
  if (decision === "rejected" && !note) {
    return NextResponse.json({ error: "Give a reason so the person knows why it was refused." }, { status: 400 });
  }

  const all = loadEntries();
  const mine = personForUser(user.id);
  const now = new Date().toISOString();
  const results: { id: string; ok: boolean; reason?: string }[] = [];

  for (const id of ids) {
    const idx = all.findIndex((e) => e.id === id);
    if (idx === -1) { results.push({ id, ok: false, reason: "Not found." }); continue; }
    const entry = all[idx];
    if (entry.status !== "pending_budget_approval") {
      results.push({ id, ok: false, reason: "It is no longer waiting for budget approval." });
      continue;
    }
    if (mine && entry.personId === mine.id) {
      results.push({ id, ok: false, reason: "You can't pass your own over-budget entry. Ask the other admin or the developer." });
      continue;
    }

    const hold = {
      ...(entry.budgetHold || { at: now, breaches: [], overBy: 0, approvedAmount: null }),
      decision: decision as "approved" | "rejected",
      decidedBy: user.id,
      decidedByName: user.name,
      decidedAt: now,
      note: note || null,
      approvedAmount: decision === "approved" ? entry.amount : null,
    };

    all[idx] = decision === "approved"
      ? {
          ...entry,
          // Now an ordinary claim: it uses up the budget and goes to
          // accounts for the usual approval.
          status: "submitted",
          budgetHold: hold,
          updatedAt: now,
          history: [...entry.history, event(user.id, user.name, "over-budget approved", note || undefined)],
        }
      : {
          ...entry,
          status: "rejected",
          budgetHold: hold,
          decidedBy: user.id,
          decidedByName: user.name,
          decidedAt: now,
          decisionNote: `Over budget — ${note}`,
          updatedAt: now,
          history: [...entry.history, event(user.id, user.name, "over-budget rejected", note)],
        };

    recordAudit({
      action: decision === "approved" ? "IMPREST_BUDGET_OVERRUN_APPROVED" : "IMPREST_BUDGET_OVERRUN_REJECTED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "imprest_entry", targetId: entry.id,
      targetLabel: `${entry.description} · ₹${entry.amount.toLocaleString("en-IN")}`,
      detail: `Over by ₹${Math.round(entry.budgetHold?.overBy || 0).toLocaleString("en-IN")}${note ? ` — ${note}` : ""}`,
      plant: entry.plant || null,
    });
    results.push({ id, ok: true });
  }

  saveEntries(all);
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ updated: results.length - failed.length, failed });
}
