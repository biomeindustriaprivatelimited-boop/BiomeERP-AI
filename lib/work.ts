/**
 * Biome AI OS — Work Engine (server only)
 * -------------------------------------------------------------------
 * The foundation Phase 1 of the "AI Business OS" roadmap sits on:
 *
 *   DATA → DETECT → TASK → ESCALATE → DECIDE → REPORT
 *
 * One task store, fed by DETECTORS that read the modules the app already
 * has (registration gaps, expiring papers, imprest approvals, leave
 * approvals, stuck trips, incomplete WhatsApp supply sets, month-end).
 * Every detector yields tasks with a stable `key`; the engine upserts —
 * a condition that appears creates the task, a condition that goes away
 * AUTO-RESOLVES it (that is the "Automated successfully" count). Nobody
 * creates routine tasks by hand.
 *
 * Escalation is a ladder, not a cliff: overdue → notify owner (day 1) →
 * notify manager (day 2) → escalate to admin (day 4). Follow-up tasks
 * carry the 1-3-5-7 cadence from the roadmap.
 *
 * Sends are drafted here and SENT by a person — consistent with every
 * other outbound action in this app. The engine's job is to make the
 * decision small, not to take it.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { recordAudit } from "@/lib/audit";
import { loadPartners, gapsFor } from "@/lib/partners";
import { loadEntries as loadImprestEntries, loadPeople as loadImprestPeople } from "@/lib/imprest";
import { loadLeave } from "@/lib/leave";
import { loadTrips, derivedStatus } from "@/lib/coordination";
import { loadEmployees } from "@/lib/payroll";
import { loadUsers } from "@/lib/authServer";
import { applyRules } from "@/lib/workflows";
import { computeAll as computePos } from "@/lib/po";
import { contractCandidates } from "@/lib/enterprise2";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TaskPriority = "critical" | "urgent" | "followup" | "normal";
export type TaskStatus = "open" | "done" | "snoozed" | "dismissed" | "auto_resolved";
export type TaskKind = "approval" | "followup" | "missing_document" | "expiry" | "operations" | "finance" | "month_end" | "escalation";

export interface WorkTask {
  id: string;
  /** Stable identity for upsert/auto-resolve: `<module>:<subject>:<condition>` */
  key: string;
  kind: TaskKind;
  module: string;
  title: string;
  /** Plain-language "why this matters" — the roadmap asks for it explicitly. */
  why: string;
  /** The one thing to do next. */
  nextAction: string;
  /** Deep link into the module that fixes it. */
  href: string;
  priority: TaskPriority;
  status: TaskStatus;
  source: "auto" | "manual";
  /** Role(s) who own this by default; a person can be assigned on top. */
  ownerRoles: string[];
  assigneeId: string | null;
  assigneeName: string | null;
  plant: string | null;
  dueOn: string; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  /** 0 none · 1 owner notified · 2 manager notified · 3 admin escalated */
  escalation: 0 | 1 | 2 | 3;
  /** Follow-up cadence step (day 1 / 3 / 5 / 7). */
  followupStep: 0 | 1 | 2 | 3 | 4;
  /** Money involved, if any — feeds the Decision Center. */
  amount: number | null;
  /** Free-form facts the detector saw, shown as evidence. */
  evidence: string[];
}

export interface AutopilotRun {
  at: string;
  created: number;
  autoResolved: number;
  escalated: number;
  followupsDue: number;
  byModule: Record<string, number>;
  agentStats: { documentsProcessed: number; setsComplete: number; setsIncomplete: number } | null;
  notes: string[];
}

interface WorkFile { tasks: WorkTask[]; runs: AutopilotRun[]; updatedAt?: string }

const MAX_RUNS = 60;

function file(): string { return path.join(paths.root, "work", "tasks.json"); }

export function loadWork(): WorkFile {
  return readJson<WorkFile>(file(), { tasks: [], runs: [] });
}
export function saveWork(w: WorkFile): void {
  ensureDir(path.dirname(file()));
  writeJsonAtomic(file(), { ...w, updatedAt: new Date().toISOString() });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;
export function today(): string { return new Date().toISOString().slice(0, 10); }
function plusDays(d: string, n: number): string {
  return new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}
function inr(n: number): string { return `₹${Math.round(n).toLocaleString("en-IN")}`; }

type Candidate = Omit<WorkTask, "id" | "status" | "source" | "assigneeId" | "assigneeName" | "createdAt" | "updatedAt" | "resolvedAt" | "snoozedUntil" | "escalation" | "followupStep">;

function cand(c: Candidate): Candidate { return c; }

/* ------------------------------------------------------------------ */
/* Detectors — one per module, each reading what the app already has   */
/* ------------------------------------------------------------------ */

function detectRegistration(): Candidate[] {
  const out: Candidate[] = [];
  for (const p of loadPartners()) {
    if (p.status === "blocked") continue;
    const gaps = gapsFor(p);
    const owner = p.category === "trading" ? ["coordinator"] : ["plant_manager", "accounts"];
    const ageDays = daysBetween(p.createdAt.slice(0, 10), today());

    if (gaps.missing.length) {
      const labels = gaps.missing.map((m) => m.label);
      out.push(cand({
        key: `partners:${p.id}:missing-docs`,
        kind: "missing_document", module: "Registration",
        title: `${p.name}: ${labels.length} KYC paper${labels.length === 1 ? "" : "s"} missing`,
        why: `Registration cannot be activated without ${labels.join(", ")}. Supplies against an inactive vendor cannot be papered correctly.`,
        nextAction: `Ask ${p.contactPerson || p.name} for ${labels[0]}${labels.length > 1 ? ` (+${labels.length - 1} more)` : ""} — use "Send registration email".`,
        href: "/partners", priority: ageDays > 14 ? "urgent" : "followup",
        ownerRoles: owner, plant: p.plants[0] || null,
        dueOn: plusDays(today(), ageDays > 14 ? 1 : 3), amount: null,
        evidence: [`Registered ${ageDays} day(s) ago`, `Missing: ${labels.join(", ")}`],
      }));
    }
    for (const e of gaps.expired) {
      out.push(cand({
        key: `partners:${p.id}:expired:${e.id}`,
        kind: "expiry", module: "Registration",
        title: `${p.name}: ${e.label} EXPIRED`,
        why: `An expired ${e.label} means every supply from ${p.name} since ${e.validTill} carries a compliance gap.`,
        nextAction: `Stop accepting supplies until a renewed ${e.label} is on file; request it today.`,
        href: "/partners", priority: "critical", ownerRoles: owner, plant: p.plants[0] || null,
        dueOn: today(), amount: null, evidence: [`Valid till ${e.validTill}`],
      }));
    }
    for (const e of gaps.expiringSoon) {
      out.push(cand({
        key: `partners:${p.id}:expiring:${e.id}`,
        kind: "expiry", module: "Registration",
        title: `${p.name}: ${e.label} expires in ${e.days} day(s)`,
        why: `Renewal takes time on the vendor's side; asking now avoids a supply stop on ${e.validTill}.`,
        nextAction: `Send a renewal reminder for the ${e.label}.`,
        href: "/partners", priority: e.days <= 7 ? "urgent" : "followup",
        ownerRoles: owner, plant: p.plants[0] || null,
        dueOn: plusDays(today(), Math.max(0, e.days - 7)), amount: null,
        evidence: [`Valid till ${e.validTill}`],
      }));
    }
    if (p.status === "draft" && !gaps.missing.length && gaps.missingFields.length === 0) {
      out.push(cand({
        key: `partners:${p.id}:activate`,
        kind: "approval", module: "Registration",
        title: `${p.name}: papers complete — activate the registration`,
        why: "Everything required is on file; the record is still a draft, so the vendor is invisible to supply matching.",
        nextAction: "Review and set status to Active; then send the registration email.",
        href: "/partners", priority: "followup", ownerRoles: ["accounts", "admin"], plant: p.plants[0] || null,
        dueOn: plusDays(today(), 2), amount: null, evidence: ["All required documents present"],
      }));
    }
    // Registered but never "Submit & freeze"d after 3 days — the owner
    // (coordinator for trading, plant manager for manufacturing) is chased.
    const openDays = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000);
    if (p.lockState === "open" && openDays >= 3) {
      out.push(cand({
        key: `partners:${p.id}:not-submitted`,
        kind: "followup", module: "Registration",
        title: `${p.name}: registration not submitted & frozen yet`,
        why: `Opened ${openDays} days ago and still editable.${gaps.missing.length || gaps.missingFields.length ? ` Still missing: ${[...gaps.missing.map((m) => m.label), ...gaps.missingFields].join(", ")}.` : ""}`,
        nextAction: "Upload the remaining KYC papers, check every field, then press Submit & freeze.",
        href: "/partners", priority: openDays >= 7 ? "urgent" : "normal",
        ownerRoles: [p.category === "trading" ? "coordinator" : "plant_manager"], plant: p.plants[0] || null,
        dueOn: today(), amount: null, evidence: [`Registered ${p.createdAt.slice(0, 10)} by ${p.registeredByName}`],
      }));
    }
  }
  return out;
}

function detectImprest(): Candidate[] {
  const out: Candidate[] = [];
  const people = loadImprestPeople();
  const pending = loadImprestEntries().filter((e) => e.status === "submitted");
  const byPerson = new Map<string, { count: number; amount: number; oldest: string; name: string }>();
  for (const e of pending) {
    const person = people.find((p) => p.id === e.personId);
    const cur = byPerson.get(e.personId) || { count: 0, amount: 0, oldest: e.date, name: person?.name || "Unknown" };
    cur.count += 1; cur.amount += Number(e.amount) || 0;
    if (e.date < cur.oldest) cur.oldest = e.date;
    byPerson.set(e.personId, cur);
  }
  for (const [personId, agg] of byPerson) {
    const waitDays = daysBetween(agg.oldest, today());
    out.push(cand({
      key: `imprest:${personId}:pending-approval`,
      kind: "approval", module: "Imprest",
      title: `${agg.name}: ${agg.count} imprest entr${agg.count === 1 ? "y" : "ies"} awaiting approval (${inr(agg.amount)})`,
      why: waitDays >= 3
        ? `Oldest entry has waited ${waitDays} days — the holder's in-hand balance is wrong until this is decided.`
        : "Undecided entries keep the float balance provisional.",
      nextAction: "Open Approvals, check bills, approve or reject with a note.",
      href: "/imprest", priority: waitDays >= 5 ? "urgent" : waitDays >= 3 ? "followup" : "normal",
      ownerRoles: ["accounts", "admin"], plant: null,
      dueOn: plusDays(agg.oldest, 3), amount: agg.amount,
      evidence: [`${agg.count} submitted`, `Oldest dated ${agg.oldest}`],
    }));
  }
  return out;
}

function detectLeave(): Candidate[] {
  const out: Candidate[] = [];
  for (const r of loadLeave().filter((x) => x.status === "pending")) {
    const startsIn = daysBetween(today(), r.fromDate);
    out.push(cand({
      key: `leave:${r.id}:pending`,
      kind: "approval", module: "Leave",
      title: `${r.employeeName}: ${r.days}-day ${r.type} leave from ${r.fromDate} awaiting decision`,
      why: startsIn <= 2
        ? `Leave starts in ${Math.max(0, startsIn)} day(s); an undecided request becomes an unplanned absence.`
        : "The person needs an answer to plan; attendance needs it to mark correctly.",
      nextAction: "Approve or reject in Leave.",
      href: "/leave", priority: startsIn <= 1 ? "urgent" : startsIn <= 3 ? "followup" : "normal",
      ownerRoles: ["plant_manager", "accounts", "admin"], plant: r.plant || null,
      dueOn: startsIn <= 1 ? today() : plusDays(today(), Math.min(2, Math.max(0, startsIn - 1))),
      amount: null, evidence: [`Raised ${r.raisedAt.slice(0, 10)}`, r.reason ? `Reason: ${r.reason.slice(0, 80)}` : "No reason given"],
    }));
  }
  return out;
}

function detectCoordination(): Candidate[] {
  const out: Candidate[] = [];
  let trips: ReturnType<typeof loadTrips> = [];
  try { trips = loadTrips(); } catch { return out; }
  for (const t of trips) {
    let status: string;
    try { status = derivedStatus(t); } catch { continue; }
    const dispatch = (t as any).vehicleEntryDate || (t as any).ourDocDate || "";
    if (status === "dispatched" && dispatch) {
      const days = daysBetween(dispatch, today());
      if (days >= 3) {
        out.push(cand({
          key: `coordination:${t.id}:no-receiving`,
          kind: "operations", module: "Coordination",
          title: `${t.vehicleNumber || "Vehicle"} → ${t.client}: dispatched ${days} day(s) ago, no receiving`,
          why: "A receiving that never comes is either a lost slip or a rejected load — both cost money the longer they wait.",
          nextAction: `Call the driver / client gate for the receiving weight; update the trip.`,
          href: "/coordination", priority: days >= 6 ? "urgent" : "followup",
          ownerRoles: ["coordinator"], plant: null,
          dueOn: today(), amount: null, evidence: [`Dispatched ${dispatch}`, `Supplier ${t.supplier || t.supplierCode || "—"}`],
        }));
      }
    }
    if (status === "shortage") {
      out.push(cand({
        key: `coordination:${t.id}:shortage`,
        kind: "finance", module: "Coordination",
        title: `${t.vehicleNumber || "Vehicle"} → ${t.client}: shortage outside tolerance`,
        why: "Shortages beyond tolerance are deducted from our invoice unless disputed with evidence within the client's window.",
        nextAction: "Compare our weight slip vs receiving; raise a dispute or accept the deduction.",
        href: "/coordination", priority: "urgent", ownerRoles: ["coordinator", "accounts"], plant: null,
        dueOn: plusDays(today(), 1), amount: null, evidence: ["Derived status: shortage"],
      }));
    }
  }
  return out;
}

function detectCompanyDocuments(): Candidate[] {
  const out: Candidate[] = [];
  try {
    const idx = readJson<{ documents: any[] }>(path.join(paths.configDir, "company-documents.json"), { documents: [] });
    for (const d of idx.documents || []) {
      if (!d.expiresOn) continue;
      const days = daysBetween(today(), d.expiresOn);
      if (days > 30) continue;
      out.push(cand({
        key: `company-documents:${d.id}:expiry`,
        kind: "expiry", module: "Company Documents",
        title: days < 0 ? `${d.title || d.name}: EXPIRED ${-days} day(s) ago` : `${d.title || d.name}: expires in ${days} day(s)`,
        why: "Company licences, insurance and certificates lapse silently; a client audit or a bank asks for the current one.",
        nextAction: days < 0 ? "Renew immediately and upload the new copy." : "Start the renewal; upload the new copy when it arrives.",
        href: "/company-documents", priority: days < 0 ? "critical" : days <= 7 ? "urgent" : "followup",
        ownerRoles: ["accounts", "admin"], plant: null,
        dueOn: days < 0 ? today() : plusDays(today(), Math.max(0, days - 7)), amount: null,
        evidence: [`Expires ${d.expiresOn}`],
      }));
    }
  } catch { /* vault absent */ }
  return out;
}

function detectEmployeeDocuments(): Candidate[] {
  const out: Candidate[] = [];
  try {
    for (const e of loadEmployees().filter((x) => x.active)) {
      const docs: any[] = (e as any).documents || [];
      for (const d of docs) {
        if (!d?.expiresOn) continue;
        const days = daysBetween(today(), d.expiresOn);
        if (days > 30) continue;
        out.push(cand({
          key: `employees:${e.id}:expiry:${d.id || d.type}`,
          kind: "expiry", module: "Employees",
          title: `${e.name}: ${d.label || d.type} ${days < 0 ? "expired" : `expires in ${days} day(s)`}`,
          why: "Expired employee papers (licences, medical, ID) are an HR compliance gap on site.",
          nextAction: "Collect the renewed document and upload it to the employee record.",
          href: "/employees", priority: days < 0 ? "urgent" : "followup",
          ownerRoles: ["accounts", "plant_manager"], plant: e.plant || null,
          dueOn: days < 0 ? today() : plusDays(today(), Math.max(0, days - 5)), amount: null,
          evidence: [`Expires ${d.expiresOn}`],
        }));
      }
    }
  } catch { /* shape may differ */ }
  return out;
}

function detectPurchaseOrders(): Candidate[] {
  const out: Candidate[] = [];
  try {
    for (const po of computePos().pos) {
      const top = po.alerts.find((a) => a.level === "critical") || po.alerts.find((a) => a.level === "high");
      if (!top) continue;
      out.push(cand({
        key: `po:${po.id}:${top.kind}`, kind: top.kind === "exhausted" || top.kind === "expiry" ? "finance" : "followup", module: "PO Control",
        title: top.title, why: top.detail, nextAction: top.action, href: "/po",
        priority: top.level === "critical" ? "critical" : "urgent", ownerRoles: po.type === "client" ? ["coordinator", "accounts", "admin"] : ["accounts", "admin"], plant: null,
        dueOn: today(), amount: null, evidence: [`${po.utilisationPct}% used`, `${Math.round(po.remainingKg / 1000)} MT remaining`, po.predictedExhaustionDays !== null ? `predicted exhaustion ${po.predictedExhaustionDays}d (estimate)` : ""].filter(Boolean),
      }));
    }
  } catch { /* PO store absent */ }
  return out;
}

function detectContracts(): Candidate[] {
  try {
    return contractCandidates().map((c) => cand({ key: c.key, kind: c.key.includes(":ob:") ? "followup" : "expiry", module: "Contracts", title: c.title, why: c.why, nextAction: c.nextAction, href: "/contracts", priority: c.priority, ownerRoles: ["accounts", "admin"], plant: null, dueOn: c.dueOn, amount: c.amount, evidence: c.evidence }));
  } catch { return []; }
}

function detectMonthEnd(): Candidate[] {
  const out: Candidate[] = [];
  const now = new Date();
  const dayOfMonth = now.getDate();
  // From the 25th, the month-end checklist becomes a task; closes itself
  // when the month is gone (the key changes with the month).
  if (dayOfMonth >= 25) {
    const month = now.toISOString().slice(0, 7);
    out.push(cand({
      key: `month-end:${month}:checklist`,
      kind: "month_end", module: "Month-end",
      title: `Month-end for ${month}: run the closing checklist`,
      why: "Attendance lock, payroll run, imprest settlement, GST and bank reconciliation all land in the same week.",
      nextAction: "Open the Month-end checklist in Work; close items as each module confirms them.",
      href: "/work?tab=monthend", priority: dayOfMonth >= 28 ? "urgent" : "followup",
      ownerRoles: ["accounts", "admin"], plant: null,
      dueOn: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10), amount: null,
      evidence: [`Day ${dayOfMonth} of the month`],
    }));
  }
  return out;
}

/** WhatsApp supply sets — via the agent, if it is up. Returns null when
 *  the agent cannot be reached so the run reports "unknown", not "zero". */
async function detectSupplySets(agentFetch: AgentFetch | null): Promise<{ cands: Candidate[]; stats: AutopilotRun["agentStats"] }> {
  const cands: Candidate[] = [];
  if (!agentFetch) return { cands, stats: null };
  try {
    const res = await agentFetch("/sets", { method: "GET", timeoutMs: 15000 });
    if (!res.ok) return { cands, stats: null };
    const json: any = await res.json();
    const sets: any[] = Array.isArray(json.sets) ? json.sets : [];
    let complete = 0, incomplete = 0, docs = 0;
    for (const s of sets) {
      docs += Array.isArray(s.documents) ? s.documents.length : 0;
      if (s.complete) { complete += 1; continue; }
      incomplete += 1;
      const missing: string[] = (s.missing || []).map((m: any) => m.label);
      const dsc: string[] = (s.dscMissing || []).map((m: any) => m.label);
      const ageDays = s.firstSeen ? daysBetween(String(s.firstSeen).slice(0, 10), today()) : 0;
      if (!missing.length && !dsc.length) continue;
      cands.push(cand({
        key: `whatsapp:${s.reference}:incomplete`,
        kind: "missing_document", module: "WhatsApp Documents",
        title: `${s.reference}${s.clientName ? ` (${s.clientName})` : ""}: ${[...missing, ...dsc.map((d) => `DSC on ${d}`)].join(", ")}`,
        why: "The client will not accept the supply, and the invoice cannot be raised cleanly, until the set is complete.",
        nextAction: missing.length
          ? `Ask the coordinator / vendor for ${missing[0]} on the sales group.`
          : `Get the digitally signed copy of ${dsc[0]}.`,
        href: "/whatsapp", priority: ageDays >= 5 ? "urgent" : ageDays >= 2 ? "followup" : "normal",
        ownerRoles: ["coordinator"], plant: null,
        dueOn: plusDays(today(), ageDays >= 5 ? 0 : 2), amount: null,
        evidence: [`First seen ${String(s.firstSeen || "").slice(0, 10)}`, `${s.satisfiedCount}/${s.requiredCount} collected`],
      }));
    }
    return { cands, stats: { documentsProcessed: docs, setsComplete: complete, setsIncomplete: incomplete } };
  } catch {
    return { cands, stats: null };
  }
}

export type AgentFetch = (route: string, init: { method: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }) => Promise<Response>;

/* ------------------------------------------------------------------ */
/* The run — upsert, auto-resolve, escalate, record                    */
/* ------------------------------------------------------------------ */

const ESCALATION_LADDER = [
  { afterDays: 1, level: 1 as const, note: "owner notified" },
  { afterDays: 2, level: 2 as const, note: "manager notified" },
  { afterDays: 4, level: 3 as const, note: "escalated to admin" },
];

export async function runAutopilot(opts: { agentFetch?: AgentFetch | null; actor?: { id: string; name: string; role: string } } = {}): Promise<AutopilotRun> {
  const w = loadWork();
  const now = new Date().toISOString();
  const notes: string[] = [];

  const detectors: [string, () => Candidate[]][] = [
    ["Registration", detectRegistration],
    ["Imprest", detectImprest],
    ["Leave", detectLeave],
    ["Coordination", detectCoordination],
    ["Company Documents", detectCompanyDocuments],
    ["Employees", detectEmployeeDocuments],
    ["Month-end", detectMonthEnd],
    ["PO Control", detectPurchaseOrders],
    ["Contracts", detectContracts],
  ];

  const candidates: Candidate[] = [];
  for (const [name, fn] of detectors) {
    try { candidates.push(...fn()); } catch (e) { notes.push(`${name} detector skipped: ${(e as Error).message}`); }
  }
  const sets = await detectSupplySets(opts.agentFetch ?? null);
  candidates.push(...sets.cands);
  if (!sets.stats) notes.push("WhatsApp agent not reachable — supply-set checks skipped this run.");

  // ---- Upsert ----
  const seen = new Set<string>();
  let created = 0;
  const byModule: Record<string, number> = {};
  for (const c of candidates) {
    seen.add(c.key);
    byModule[c.module] = (byModule[c.module] || 0) + 1;
    const existing = w.tasks.find((t) => t.key === c.key && t.status !== "dismissed");
    if (existing) {
      // Facts refresh; the person's own decisions (assignee, snooze, done)
      // stay, and so do marks left by workflow rules and the escalation
      // ladder — a detector re-reading the world must not undo them.
      const sticky = existing.evidence.filter((e) => e.startsWith("Rule:") || e.startsWith("Escalation:"));
      const order: Record<TaskPriority, number> = { critical: 0, urgent: 1, followup: 2, normal: 3 };
      const raised = sticky.length > 0 || existing.escalation > 0;
      Object.assign(existing, {
        title: c.title, why: c.why, nextAction: c.nextAction,
        priority: raised && order[existing.priority] < order[c.priority] ? existing.priority : c.priority,
        evidence: [...c.evidence, ...sticky], amount: c.amount,
        dueOn: existing.dueOn <= c.dueOn ? existing.dueOn : c.dueOn,
        updatedAt: now,
      });
      if (existing.status === "auto_resolved") { existing.status = "open"; existing.resolvedAt = null; }
      if (existing.status === "snoozed" && existing.snoozedUntil && existing.snoozedUntil <= today()) {
        existing.status = "open"; existing.snoozedUntil = null;
      }
      continue;
    }
    w.tasks.push({
      ...c, id: crypto.randomUUID(), status: "open", source: "auto",
      assigneeId: null, assigneeName: null, createdAt: now, updatedAt: now,
      resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0,
    });
    created += 1;
  }

  // ---- Auto-resolve: the condition is gone → the work is done ----
  let autoResolved = 0;
  for (const t of w.tasks) {
    if (t.source === "auto" && (t.status === "open" || t.status === "snoozed") && !seen.has(t.key)) {
      // Supply-set tasks are only resolved when the agent actually answered.
      if (t.module === "WhatsApp Documents" && !sets.stats) continue;
      t.status = "auto_resolved"; t.resolvedAt = now; t.updatedAt = now; autoResolved += 1;
    }
  }

  // ---- Escalation ladder for overdue open tasks ----
  let escalated = 0;
  const t0 = today();
  for (const t of w.tasks) {
    if (t.status !== "open") continue;
    const overdueDays = daysBetween(t.dueOn, t0);
    if (overdueDays < 1) continue;
    const step = [...ESCALATION_LADDER].reverse().find((s) => overdueDays >= s.afterDays);
    if (step && t.escalation < step.level) {
      t.escalation = step.level; t.updatedAt = now; escalated += 1;
      if (step.level === 3) t.priority = "critical";
      else if (step.level === 2 && t.priority !== "critical") t.priority = "urgent";
      t.evidence = [...t.evidence.filter((e) => !e.startsWith("Escalation:")), `Escalation: ${step.note} (${overdueDays}d overdue)`];
    }
  }

  // ---- Follow-up cadence (1 · 3 · 5 · 7) for follow-up-type tasks ----
  let followupsDue = 0;
  for (const t of w.tasks) {
    if (t.status !== "open") continue;
    if (!(t.kind === "missing_document" || t.kind === "followup" || t.kind === "expiry")) continue;
    const age = daysBetween(t.createdAt.slice(0, 10), t0);
    const step = age >= 7 ? 4 : age >= 5 ? 3 : age >= 3 ? 2 : age >= 1 ? 1 : 0;
    if (step > t.followupStep) { t.followupStep = step as WorkTask["followupStep"]; t.updatedAt = now; }
    if (step > 0 && step === t.followupStep) followupsDue += 1;
  }

  // ---- No-code workflows: WHEN → IF → THEN over every open task ----
  const createdKeys = new Set(w.tasks.filter((t) => t.createdAt === now).map((t) => t.key));
  let rulesFired = 0;
  for (const t of w.tasks) {
    if (t.status !== "open") continue;
    try {
      const fired = applyRules(t, { justCreated: createdKeys.has(t.key), todayStr: t0 });
      if (fired.length) { rulesFired += fired.length; t.updatedAt = now; }
    } catch (e) { notes.push(`Workflow error: ${(e as Error).message}`); }
  }
  if (rulesFired) notes.push(`${rulesFired} workflow rule(s) fired.`);

  // Documents → Google Drive, when the owner switched auto-mirror on.
  try {
    const { loadDrive } = await import("@/lib/gdrive");
    if ((loadDrive() as any).mirrorAuto) {
      const { mirrorDocuments } = await import("@/lib/gdriveMirror");
      const m = await mirrorDocuments({ maxFiles: 60 });
      if (m.uploaded || m.failed) notes.push(`Drive mirror: ${m.uploaded} uploaded, ${m.failed} failed.`);
    }
  } catch (e) { notes.push(`Drive mirror skipped: ${(e as Error).message}`); }

  const run: AutopilotRun = { at: now, created, autoResolved, escalated, followupsDue, byModule, agentStats: sets.stats, notes };
  w.runs = [run, ...w.runs].slice(0, MAX_RUNS);
  // Keep the store tidy: resolved/dismissed older than 45 days fall off.
  const cutoff = new Date(Date.now() - 45 * DAY).toISOString();
  w.tasks = w.tasks.filter((t) => t.status === "open" || t.status === "snoozed" || (t.updatedAt > cutoff));
  saveWork(w);

  if (opts.actor && (created || autoResolved || escalated)) {
    recordAudit({
      action: "work.autopilot.run", userId: opts.actor.id, userName: opts.actor.name, role: opts.actor.role,
      targetType: "work", targetId: now, detail: `created ${created}, auto-resolved ${autoResolved}, escalated ${escalated}`,
    });
  }
  return run;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export function visibleTasks(tasks: WorkTask[], user: { id: string; role: string; plant?: string | null }): WorkTask[] {
  const senior = user.role === "admin" || user.role === "developer" || user.role === "accounts";
  return tasks.filter((t) => {
    if (t.assigneeId === user.id) return true;
    if (senior) return true;
    if (!t.ownerRoles.includes(user.role)) return false;
    if (user.role === "plant_manager" && t.plant && user.plant && t.plant !== user.plant) return false;
    return true;
  });
}

export function planner(tasks: WorkTask[]) {
  const t0 = today();
  const open = tasks.filter((t) => t.status === "open");
  const counts = {
    critical: open.filter((t) => t.priority === "critical").length,
    urgent: open.filter((t) => t.priority === "urgent").length,
    followup: open.filter((t) => t.priority === "followup").length,
    normal: open.filter((t) => t.priority === "normal").length,
    overdue: open.filter((t) => t.dueOn < t0).length,
    dueToday: open.filter((t) => t.dueOn === t0).length,
    autoResolvedRecently: tasks.filter((t) => t.status === "auto_resolved" && t.resolvedAt && daysBetween(t.resolvedAt.slice(0, 10), t0) <= 7).length,
    canDelegate: open.filter((t) => !t.assigneeId && t.ownerRoles.length > 1).length,
  };
  const order: Record<TaskPriority, number> = { critical: 0, urgent: 1, followup: 2, normal: 3 };
  const sorted = [...open].sort((a, b) => order[a.priority] - order[b.priority] || a.dueOn.localeCompare(b.dueOn));
  return { counts, tasks: sorted };
}

/** The Decision Center: only what needs a human to choose. */
export function decisions(tasks: WorkTask[]) {
  const t0 = today();
  const open = tasks.filter((t) => t.status === "open");
  return open
    .filter((t) => t.kind === "approval" || t.escalation >= 2 || (t.kind === "finance") || (t.amount && t.amount >= 50000))
    .map((t) => {
      const overdue = Math.max(0, daysBetween(t.dueOn, t0));
      const risk: "LOW" | "MEDIUM" | "HIGH" =
        t.priority === "critical" || overdue >= 4 ? "HIGH" : t.priority === "urgent" || overdue >= 1 ? "MEDIUM" : "LOW";
      const recommendation =
        t.kind === "approval" && t.module === "Imprest"
          ? (t.amount && t.amount > 25000 ? "Check bills line by line before approving — amount is above the usual float." : "Safe to approve if bills are attached.")
          : t.kind === "approval" && t.module === "Leave"
            ? "Approve unless the plant is short-staffed on those dates."
            : t.kind === "approval" ? "Approve — prerequisites are complete." :
              t.escalation >= 2 ? "Assign an owner today; this has already escalated." : "Decide now to stop the clock.";
      return { task: t, risk, overdueDays: overdue, recommendation };
    })
    .sort((a, b) => (a.risk === b.risk ? b.overdueDays - a.overdueDays : a.risk === "HIGH" ? -1 : b.risk === "HIGH" ? 1 : a.risk === "MEDIUM" ? -1 : 1));
}

/** Who can be handed a task — active users whose role owns it. */
export function delegates(task: WorkTask) {
  return loadUsers()
    .filter((u) => u.active && (task.ownerRoles.includes(u.role) || u.role === "admin"))
    .map((u) => ({ id: u.id, name: u.name, role: u.role, plant: (u as any).plant ?? null }));
}
