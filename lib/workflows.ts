/**
 * Biome AI OS — No-code workflows (server only)
 * -------------------------------------------------------------------
 * WHEN a task event happens → IF conditions hold → THEN act.
 *
 * Runs inside the Work Engine on every autopilot pass over every OPEN
 * task, so a rule written today applies to the backlog too. Actions are
 * deliberately bounded to things that are safe to automate: reprioritise,
 * hand to a role, mark for decision, bump escalation. Sending anything
 * stays a button a person presses.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import type { WorkTask, TaskPriority } from "@/lib/work";

export type Trigger = "task_created" | "task_open" | "task_overdue";
export type CondField = "module" | "priority" | "amount" | "kind" | "plant" | "overdueDays";
export type CondOp = "is" | "is_not" | "gt" | "lt" | "contains";
export type ActionKind = "set_priority" | "assign_role" | "mark_decision" | "escalate" | "add_note";

export interface WorkflowRule {
  id: string;
  name: string;
  enabled: boolean;
  when: Trigger;
  if: { field: CondField; op: CondOp; value: string }[];
  then: { kind: ActionKind; value: string }[];
  createdAt: string;
  /** Times it fired — the "is this rule doing anything" number. */
  fired: number;
  lastFiredAt: string | null;
}

interface RulesFile { rules: WorkflowRule[] }
const file = () => path.join(paths.root, "work", "workflows.json");

export function loadRules(): WorkflowRule[] {
  return readJson<RulesFile>(file(), { rules: [] }).rules || [];
}
export function saveRules(rules: WorkflowRule[]) {
  ensureDir(path.dirname(file()));
  writeJsonAtomic(file(), { rules });
}

export function newRule(partial: Partial<WorkflowRule>): WorkflowRule {
  return {
    id: crypto.randomUUID(), name: partial.name || "Untitled rule", enabled: partial.enabled ?? true,
    when: partial.when || "task_open", if: partial.if || [], then: partial.then || [],
    createdAt: new Date().toISOString(), fired: 0, lastFiredAt: null,
  };
}

function fieldValue(t: WorkTask, f: CondField, todayStr: string): string | number {
  switch (f) {
    case "module": return t.module;
    case "priority": return t.priority;
    case "amount": return t.amount ?? 0;
    case "kind": return t.kind;
    case "plant": return t.plant ?? "";
    case "overdueDays": return Math.max(0, Math.floor((new Date(todayStr).getTime() - new Date(t.dueOn).getTime()) / 86400000));
  }
}

function holds(c: WorkflowRule["if"][number], t: WorkTask, todayStr: string): boolean {
  const v = fieldValue(t, c.field, todayStr);
  const want = c.value;
  switch (c.op) {
    case "is": return String(v).toLowerCase() === want.toLowerCase();
    case "is_not": return String(v).toLowerCase() !== want.toLowerCase();
    case "contains": return String(v).toLowerCase().includes(want.toLowerCase());
    case "gt": return Number(v) > Number(want);
    case "lt": return Number(v) < Number(want);
  }
}

const PRIORITIES: TaskPriority[] = ["critical", "urgent", "followup", "normal"];

/**
 * Applies every enabled rule to the task. Returns the notes it added so
 * the caller can log them. Idempotent per run: a rule that already left
 * its mark on the task does not fire again.
 */
export function applyRules(task: WorkTask, opts: { justCreated: boolean; todayStr: string }): string[] {
  const rules = loadRules();
  const notes: string[] = [];
  let changed = false;
  for (const r of rules) {
    if (!r.enabled) continue;
    const trig = r.when === "task_created" ? opts.justCreated
      : r.when === "task_overdue" ? task.dueOn < opts.todayStr
      : true;
    if (!trig) continue;
    if (!r.if.every((c) => holds(c, task, opts.todayStr))) continue;
    const mark = `Rule: ${r.name}`;
    if (task.evidence.includes(mark)) continue;

    for (const a of r.then) {
      switch (a.kind) {
        case "set_priority":
          if (PRIORITIES.includes(a.value as TaskPriority)) task.priority = a.value as TaskPriority;
          break;
        case "assign_role":
          if (a.value && !task.ownerRoles.includes(a.value)) task.ownerRoles = [a.value, ...task.ownerRoles];
          break;
        case "mark_decision":
          task.kind = "approval";
          break;
        case "escalate":
          task.escalation = Math.max(task.escalation, Math.min(3, Number(a.value) || 2)) as WorkTask["escalation"];
          break;
        case "add_note":
          if (a.value) task.evidence.push(a.value);
          break;
      }
    }
    task.evidence.push(mark);
    notes.push(`${r.name} → ${task.title.slice(0, 60)}`);
    r.fired += 1; r.lastFiredAt = new Date().toISOString();
    changed = true;
  }
  if (changed) saveRules(rules);
  return notes;
}
