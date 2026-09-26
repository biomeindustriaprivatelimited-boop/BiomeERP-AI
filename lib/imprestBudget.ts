/**
 * Biome Platform — imprest budgets
 * -------------------------------------------------------------------
 * A monthly allocation against an expense head, a plant, or one holder.
 *
 * THE ONE IDEA THAT MAKES THIS USEFUL: money already approved and money
 * still waiting for a decision are counted SEPARATELY, and both are shown.
 *
 * A budget that only counts approved spend reads as ₹40,000 free on the
 * 28th while ₹38,000 of diesel bills sit unapproved in the queue — the
 * approver then passes them all and the head goes over without anyone
 * having made that decision. So: `spent` is settled, `committed` is in the
 * queue, and `remaining` is what is left after both.
 *
 * Nothing here blocks a spend. A hard block would only mean the entry gets
 * filed under a different head, and then the figures stop meaning anything.
 * It warns, it flags to the approver, and it records.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import type { ImprestEntry } from "@/lib/imprest";

export type BudgetScope = "head" | "plant" | "person";

export const BUDGET_SCOPES: { id: BudgetScope; label: string; help: string }[] = [
  { id: "head", label: "Expense head", help: "Diesel, repairs, freight — across everyone." },
  { id: "plant", label: "Plant", help: "Everything drawn against one site." },
  { id: "person", label: "Holder", help: "One person's monthly allocation." },
];

export interface ImprestBudget {
  id: string;
  scope: BudgetScope;
  /** The expense head, plant code, or holder id this covers. */
  key: string;
  /** Shown on screen — the holder's name rather than their id. */
  label: string;
  /** Rupees per month. */
  amount: number;
  /** First month it applies to, "2026-08". Empty means from the start. */
  fromMonth: string;
  /** Last month it applies to. Empty means it keeps running. */
  toMonth: string;
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

export function loadBudgets(): ImprestBudget[] {
  const f = readJson<BudgetFile>(file(), { budgets: [] });
  return Array.isArray(f.budgets) ? f.budgets : [];
}

export function saveBudgets(budgets: ImprestBudget[]): void {
  ensureDir(path.join(paths.root, "imprest"));
  writeJsonAtomic(file(), { budgets, updatedAt: new Date().toISOString() });
}

export function makeBudget(input: {
  scope: BudgetScope; key: string; label: string; amount: number;
  fromMonth?: string; toMonth?: string; note?: string; by: string;
}): ImprestBudget {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    scope: input.scope,
    key: String(input.key).trim(),
    label: String(input.label || input.key).trim(),
    amount: Math.max(0, Math.round(Number(input.amount) || 0)),
    fromMonth: (input.fromMonth || "").slice(0, 7),
    toMonth: (input.toMonth || "").slice(0, 7),
    note: String(input.note || "").slice(0, 300),
    active: true,
    createdBy: input.by,
    createdAt: now,
    updatedAt: now,
  };
}

/** Is this budget in force for the month being looked at? */
export function appliesTo(b: ImprestBudget, month: string): boolean {
  if (!b.active) return false;
  if (b.fromMonth && month < b.fromMonth) return false;
  if (b.toMonth && month > b.toMonth) return false;
  return true;
}

/** Does this entry fall under this budget? */
export function covers(b: ImprestBudget, entry: ImprestEntry): boolean {
  // Only spending counts. A top-up handed to a holder is not an expense
  // against a head — counting it would make every budget look breached the
  // moment cash was issued.
  if (entry.kind !== "expense") return false;
  if (b.scope === "head") return entry.category === b.key;
  if (b.scope === "plant") return (entry.plant || "") === b.key;
  return entry.personId === b.key;
}

export interface BudgetUsage {
  budget: ImprestBudget;
  month: string;
  /** Approved, settled. */
  spent: number;
  /** Filed and waiting for a decision — will land on this budget if passed. */
  committed: number;
  /** Allocation less both of the above. Negative means already over. */
  remaining: number;
  /** Of the allocation, how much is used or promised. 0-999. */
  pct: number;
  state: "clear" | "watch" | "tight" | "over";
  entries: number;
}

/**
 * Work out where a budget stands for one month.
 *
 * Pure, so the same numbers appear on the page, on the approval card and
 * in any report — a budget that disagrees with itself between two screens
 * is worse than no budget at all.
 */
export function usageFor(b: ImprestBudget, month: string, entries: ImprestEntry[]): BudgetUsage {
  let spent = 0, committed = 0, count = 0;
  for (const e of entries) {
    if (e.date.slice(0, 7) !== month) continue;
    if (!covers(b, e)) continue;
    if (e.status === "approved") { spent += e.amount; count += 1; }
    else if (e.status === "submitted") { committed += e.amount; count += 1; }
  }
  const used = spent + committed;
  const remaining = b.amount - used;
  const pct = b.amount > 0 ? Math.min(999, Math.round((used / b.amount) * 100)) : 0;
  const state: BudgetUsage["state"] =
    remaining < 0 ? "over" : pct >= 90 ? "tight" : pct >= 75 ? "watch" : "clear";
  return { budget: b, month, spent, committed, remaining, pct, state, entries: count };
}

export function usageForMonth(budgets: ImprestBudget[], month: string, entries: ImprestEntry[]): BudgetUsage[] {
  return budgets
    .filter((b) => appliesTo(b, month))
    .map((b) => usageFor(b, month, entries))
    .sort((a, b) => a.remaining - b.remaining);
}

export interface BudgetImpact {
  budgetId: string;
  label: string;
  scope: BudgetScope;
  amount: number;
  /** Where it stands WITHOUT this entry. */
  remainingBefore: number;
  /** Where it would stand once this entry is approved. */
  remainingAfter: number;
  /** How far past the allocation this entry takes it. 0 when still inside. */
  overBy: number;
}

/**
 * What one entry does to the budgets it touches.
 *
 * Written for the approval card: the useful sentence is not "diesel is at
 * 92%", it is "passing this takes diesel ₹4,300 past its month". The
 * entry's own amount is excluded from the "before" figure so the two
 * numbers read as a genuine before and after.
 */
export function impactOf(
  entry: ImprestEntry,
  budgets: ImprestBudget[],
  entries: ImprestEntry[]
): BudgetImpact[] {
  const month = entry.date.slice(0, 7);
  const others = entries.filter((e) => e.id !== entry.id);
  const out: BudgetImpact[] = [];

  for (const b of budgets) {
    if (!appliesTo(b, month) || !covers(b, entry)) continue;
    const before = usageFor(b, month, others);
    const remainingAfter = before.remaining - entry.amount;
    out.push({
      budgetId: b.id,
      label: b.label,
      scope: b.scope,
      amount: b.amount,
      remainingBefore: before.remaining,
      remainingAfter,
      overBy: remainingAfter < 0 ? Math.abs(remainingAfter) : 0,
    });
  }
  return out;
}

/**
 * The sentence to put in front of whoever is about to approve.
 * Empty when there is nothing worth saying.
 */
export function impactMessage(impacts: BudgetImpact[]): string {
  const breached = impacts.filter((i) => i.overBy > 0);
  if (breached.length) {
    return breached
      .map((i) => `Approving this takes ${i.label} ₹${Math.round(i.overBy).toLocaleString("en-IN")} past its monthly budget.`)
      .join(" ");
  }
  const tight = impacts.filter((i) => i.amount > 0 && i.remainingAfter <= i.amount * 0.1);
  if (tight.length) {
    return tight
      .map((i) => `${i.label} would have ₹${Math.round(i.remainingAfter).toLocaleString("en-IN")} left for the month.`)
      .join(" ");
  }
  return "";
}
