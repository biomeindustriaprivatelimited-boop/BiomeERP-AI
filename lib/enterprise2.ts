/**
 * Biome AI OS — Enterprise layer, part 2 (server only)
 * -------------------------------------------------------------------
 * The last engines of the premium roadmap:
 *   33 Contracts & obligations · 44 Business memory · 35 Onboarding
 *   41 AI agent registry · 12/13 Predictive cash flow + payment priority
 * Same rules as everything else: computed from existing data, explained,
 * audited, and human-approved where money or people are involved.
 */

import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadTrips, derivedStatus, type Trip } from "@/lib/coordination";
import { loadEntries as loadImprestEntries } from "@/lib/imprest";
import { loadRuns } from "@/lib/payroll";
import { computeAll as computePos } from "@/lib/po";
import { daysBetween, today } from "@/lib/work";
import { SOP_ENTRIES } from "@/lib/sopKnowledge";

function store<T>(name: string, empty: T) {
  const file = () => path.join(paths.root, "work", `${name}.json`);
  return { load: (): T => readJson<T>(file(), empty), save: (v: T) => { ensureDir(path.dirname(file())); writeJsonAtomic(file(), v); } };
}
const plus = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* 33 · Contracts & obligations                                         */
/* ------------------------------------------------------------------ */

export interface Obligation { id: string; text: string; dueOn: string; amount: number | null; done: boolean; doneAt: string | null }
export interface Contract {
  id: string; title: string; party: string; partyType: "vendor" | "client" | "transporter" | "other"; kind: "supply" | "transport" | "service" | "lease" | "other";
  startDate: string; expiryDate: string; value: number | null; renewalStatus: "not_started" | "in_progress" | "renewed" | "will_not_renew";
  obligations: Obligation[]; attachment: { name: string; file: string } | null; notes: string; createdBy: string; createdAt: string; updatedAt: string;
}
const contracts = store<{ contracts: Contract[] }>("contracts", { contracts: [] });
export const loadContracts = () => contracts.load().contracts;
export const saveContracts = (list: Contract[]) => contracts.save({ contracts: list });

export function contractView(c: Contract) {
  const t0 = today();
  const daysToExpiry = c.expiryDate ? daysBetween(t0, c.expiryDate) : null;
  const pending = c.obligations.filter((o) => !o.done);
  const overdue = pending.filter((o) => o.dueOn < t0);
  const commitments = pending.reduce((s, o) => s + (o.amount || 0), 0);
  const status = daysToExpiry !== null && daysToExpiry < 0 ? "expired" : daysToExpiry !== null && daysToExpiry <= 45 && c.renewalStatus === "not_started" ? "renewal_due" : "active";
  return { ...c, daysToExpiry, pendingObligations: pending.length, overdueObligations: overdue.length, commitments, status };
}

/** Detector for the Work Engine. */
export function contractCandidates() {
  const out: { key: string; title: string; why: string; nextAction: string; priority: "critical" | "urgent" | "followup"; dueOn: string; amount: number | null; evidence: string[] }[] = [];
  for (const c of loadContracts().map(contractView)) {
    if (c.status === "expired") out.push({ key: `contract:${c.id}:expired`, title: `${c.title} (${c.party}) has EXPIRED`, why: "Supplies or services continue without a valid agreement.", nextAction: "Renew, extend or close the contract.", priority: "critical", dueOn: today(), amount: c.value, evidence: [`Expired ${c.expiryDate}`] });
    else if (c.status === "renewal_due") out.push({ key: `contract:${c.id}:renewal`, title: `${c.title} (${c.party}) expires in ${c.daysToExpiry} day(s) — renewal not started`, why: "Renewal negotiations take weeks; starting late means supplying without cover.", nextAction: "Open Contracts → set renewal in progress; assign an owner.", priority: c.daysToExpiry! <= 15 ? "urgent" : "followup", dueOn: today(), amount: c.value, evidence: [`Expiry ${c.expiryDate}`, `${c.pendingObligations} pending obligations`] });
    for (const o of c.obligations.filter((o) => !o.done && daysBetween(today(), o.dueOn) <= 7))
      out.push({ key: `contract:${c.id}:ob:${o.id}`, title: `${c.party}: obligation "${o.text.slice(0, 50)}" due ${o.dueOn}`, why: `Part of ${c.title}.`, nextAction: "Complete and tick the obligation in Contracts.", priority: o.dueOn < today() ? "urgent" : "followup", dueOn: o.dueOn, amount: o.amount, evidence: [`Contract ${c.title}`] });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 44 · Business memory — reviewable, editable, expiring                */
/* ------------------------------------------------------------------ */

export type MemoryKind = "decision" | "pattern" | "preference" | "investigation" | "note";
export interface MemoryItem { id: string; kind: MemoryKind; text: string; source: string; roles: string[]; createdBy: string; createdAt: string; expiresAt: string; pinned: boolean }
const memory = store<{ items: MemoryItem[] }>("memory", { items: [] });
export const RETENTION_DAYS = 180;

export function loadMemory(): MemoryItem[] {
  const all = memory.load().items;
  const live = all.filter((m) => m.pinned || m.expiresAt >= today());
  if (live.length !== all.length) memory.save({ items: live }); // retention rule applied on read
  return live;
}
export function saveMemory(items: MemoryItem[]) { memory.save({ items }); }
export function remember(input: { kind: MemoryKind; text: string; source: string; roles?: string[]; createdBy: string; pinned?: boolean }): MemoryItem {
  const items = loadMemory();
  const dup = items.find((m) => m.kind === input.kind && m.text.trim().toLowerCase() === input.text.trim().toLowerCase());
  if (dup) return dup;
  const item: MemoryItem = { id: crypto.randomUUID(), kind: input.kind, text: input.text.slice(0, 600), source: input.source, roles: input.roles?.length ? input.roles : ["admin", "developer", "accounts", "coordinator", "plant_manager"], createdBy: input.createdBy, createdAt: new Date().toISOString(), expiresAt: plus(today(), RETENTION_DAYS), pinned: Boolean(input.pinned) };
  items.unshift(item); saveMemory(items); return item;
}
export function recallFor(role: string, query?: string): MemoryItem[] {
  const q = (query || "").toLowerCase();
  return loadMemory().filter((m) => m.roles.includes(role) || role === "developer" || role === "admin").filter((m) => !q || m.text.toLowerCase().includes(q) || m.kind.includes(q)).slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* 35 · Onboarding & training                                           */
/* ------------------------------------------------------------------ */

export interface TrackStep { id: string; title: string; kind: "learn" | "practice" | "do"; sopId?: string; question?: string; options?: string[]; answer?: number; action?: string; href?: string }
export interface Track { role: string; title: string; steps: TrackStep[] }

const q = (id: string, question: string, options: string[], answer: number): TrackStep => ({ id, title: question, kind: "practice", question, options, answer });
const learn = (sopId: string): TrackStep | null => { const e = SOP_ENTRIES.find((x) => x.id === sopId); return e ? { id: `learn-${sopId}`, title: e.title, kind: "learn", sopId } : null; };
const doIt = (id: string, title: string, href: string, action: string): TrackStep => ({ id, title, kind: "do", href, action });

export const TRACKS: Track[] = [
  { role: "coordinator", title: "Coordinator onboarding", steps: [learn("whatsapp-filing"), q("q-ref", "In BDC/786/MHI/44, what is 786?", ["The vendor's invoice number", "Our tax invoice / challan number", "The vehicle number", "The client's PO"], 1), learn("vendor-registration"), q("q-cat", "Who registers trading vendors?", ["Plant manager", "Coordinator", "Accounts", "Developer"], 1), doIt("do-coord", "Create a coordination trip with a client PO linked", "/coordination", "Open Coordination → New trip → pick the client PO"), doIt("do-work", "Open the Work planner and clear one follow-up", "/work", "Mark a task Done or Delegate it")].filter(Boolean) as TrackStep[] },
  { role: "accounts", title: "Accounts onboarding", steps: [learn("imprest-file"), learn("payroll-run"), learn("month-end"), q("q-imp", "An imprest float can be opened for…", ["Anyone with a phone", "Only people on the active employee rolls", "Only plant managers", "Vendors"], 1), q("q-po", "When is a PO marked EXHAUSTED?", ["When it expires", "When consumed quantity reaches the total", "When accounts closes it", "After 30 days"], 1), doIt("do-po", "Set PO exhaustion email recipients", "/po", "PO Control → Settings → recipients"), doIt("do-dec", "Decide one item in the Decision Room", "/decisions", "Approve, reject or send back with a note")].filter(Boolean) as TrackStep[] },
  { role: "plant_manager", title: "Plant manager onboarding", steps: [learn("attendance-mark"), learn("vendor-registration"), learn("leave-apply"), q("q-freeze", "How long can a plant manager edit a registration after submitting?", ["1 day", "7 days", "30 days", "Forever"], 1), q("q-cam", "To report damaged material from the field you use…", ["Email", "Issues → Camera to action", "Payroll", "Reports"], 1), doIt("do-att", "Mark today's attendance for your plant", "/attendance", "Use the picker: double-click a day")].filter(Boolean) as TrackStep[] },
  { role: "admin", title: "Admin onboarding", steps: [learn("approvals-who"), learn("backup"), q("q-server", "If the server PC is off, client PCs…", ["Work offline and sync later", "Block until the server answers", "Switch to cloud", "Keep old data"], 1), doIt("do-cmd", "Read today's Command Center and the morning briefing", "/command", "Command Center → Briefing tab"), doIt("do-backup", "Take a backup", "/settings", "Settings → Backup")].filter(Boolean) as TrackStep[] },
];

export interface Progress { userId: string; role: string; done: string[]; answers: Record<string, number>; updatedAt: string }
const onboarding = store<{ progress: Progress[] }>("onboarding", { progress: [] });
export function trackFor(role: string): Track { return TRACKS.find((t) => t.role === role) || TRACKS[0]; }
export function progressFor(userId: string, role: string): Progress {
  const all = onboarding.load().progress;
  return all.find((p) => p.userId === userId) || { userId, role, done: [], answers: {}, updatedAt: new Date().toISOString() };
}
export function saveProgress(p: Progress) {
  const all = onboarding.load().progress.filter((x) => x.userId !== p.userId);
  onboarding.save({ progress: [...all, { ...p, updatedAt: new Date().toISOString() }] });
}
export function onboardingSummary() {
  return onboarding.load().progress.map((p) => ({ userId: p.userId, role: p.role, done: p.done.length, total: trackFor(p.role).steps.length, updatedAt: p.updatedAt }));
}

/* ------------------------------------------------------------------ */
/* 41 · AI agent registry                                               */
/* ------------------------------------------------------------------ */

export interface AgentDef { id: string; name: string; scope: string; tools: string[]; roles: string[]; actions: "read" | "propose" }
export const AGENTS: AgentDef[] = [
  { id: "management", name: "Management Agent", scope: "Command Center, decisions, health, briefing, risks, PO status — the whole picture for management.", tools: ["get_work_planner", "get_business_insights", "get_po_status", "get_financial_summary", "get_supply_sets", "get_business_memory", "get_sop_guide"], roles: ["admin", "developer", "accounts"], actions: "propose" },
  { id: "document", name: "Document Agent", scope: "Supply documents, WhatsApp filing, classification, review queue.", tools: ["get_supply_sets", "search_documents", "get_agent_status", "list_vendors", "list_clients", "get_sop_guide"], roles: ["coordinator", "accounts", "admin", "developer"], actions: "read" },
  { id: "finance", name: "Finance Agent", scope: "Tally balances, party dues, transactions, imprest, PO balances, cash predictions.", tools: ["get_financial_summary", "find_party_balance", "get_transactions", "get_po_status", "get_business_insights", "get_work_planner"], roles: ["accounts", "admin", "developer"], actions: "propose" },
  { id: "operations", name: "Operations Agent", scope: "Supplies, vendors, clients, coordination, PO consumption, delays.", tools: ["get_supply_sets", "list_vendors", "list_clients", "get_po_status", "get_work_planner", "get_business_insights"], roles: ["coordinator", "plant_manager", "admin", "developer"], actions: "read" },
  { id: "compliance", name: "Compliance Agent", scope: "KYC, expiries, contracts, data quality, audit.", tools: ["list_vendors", "get_work_planner", "get_business_insights", "get_sop_guide", "get_business_memory"], roles: ["accounts", "admin", "developer"], actions: "read" },
  { id: "hr", name: "HR Agent", scope: "Attendance, leave, payroll processes, onboarding.", tools: ["get_sop_guide", "get_work_planner"], roles: ["plant_manager", "accounts", "admin", "developer"], actions: "read" },
];
export function agentFor(id: string | null | undefined, role: string): AgentDef | null {
  if (!id) return null;
  const a = AGENTS.find((x) => x.id === id);
  return a && (a.roles.includes(role) || role === "developer") ? a : null;
}

/* ------------------------------------------------------------------ */
/* 12 · Predictive cash flow · 13 · Payment priority                    */
/* ------------------------------------------------------------------ */

function safeTrips(): Trip[] { try { return loadTrips(); } catch { return []; } }

export function cashFlow() {
  const t0 = today();
  const trips = safeTrips();
  // Receivables: invoiced, not marked paid; expected on invoice date + 30 + client's typical lateness (estimate).
  const inflows: { on: string; amount: number; who: string; kind: "actual" | "estimate"; label: string }[] = [];
  const outflows: { on: string; amount: number; who: string; kind: "actual" | "estimate"; label: string }[] = [];
  for (const t of trips) {
    const b = t.billing || ({} as any);
    if (b.invoiceDate && b.totalAmount && !(b as any).paidAt && !(b as any).paymentDate) {
      const late = trips.filter((x) => x.client === t.client && x.vehicleEntryDate && x.receivingDate).map((x) => daysBetween(x.vehicleEntryDate, x.receivingDate));
      const lateAvg = late.length ? Math.max(0, late.reduce((a, c) => a + c, 0) / late.length - 2) : 0;
      inflows.push({ on: plus(b.invoiceDate, 30 + Math.round(lateAvg * 2)), amount: Number(b.totalAmount), who: t.client, kind: "estimate", label: `Invoice ${t.ourDocNo || ""} (30d terms + client pattern)` });
    }
    if (t.vendorChallanAmount && t.status !== "cancelled" && !(t as any).vendorPaidAt) {
      outflows.push({ on: plus(t.vendorChallanDate || t.vehicleEntryDate || t0, 15), amount: Number(t.vendorChallanAmount), who: t.supplier || t.supplierCode, kind: "estimate", label: `Vendor challan ${t.vendorChallanNo || ""} (15d terms)` });
    }
  }
  // Payroll: last run's net pay, on the 1st of each coming month (actual amount, estimated date).
  try {
    const runs = loadRuns(); const last = [...runs].sort((a, b) => b.month.localeCompare(a.month))[0];
    if (last) {
      const net = runs.filter((r) => r.month === last.month).reduce((s, r) => s + r.payslips.reduce((x, p) => x + (Number(p.netPay) || 0), 0), 0);
      for (let m = 1; m <= 2; m++) { const d = new Date(); d.setMonth(d.getMonth() + m, 1); outflows.push({ on: d.toISOString().slice(0, 10), amount: net, who: "Payroll", kind: "estimate", label: `Payroll (as per ${last.month})` }); }
    }
  } catch { /* none */ }
  // Imprest burn: 3-month average, spread daily.
  const spend = loadImprestEntries().filter((e) => e.kind === "expense" && e.status === "approved" && daysBetween(e.date, t0) <= 90).reduce((s, e) => s + e.amount, 0);
  const daily = spend / 90;
  // Contract commitments (actual amounts, due dates as recorded).
  for (const c of loadContracts()) for (const o of c.obligations) if (!o.done && o.amount && o.dueOn >= t0) outflows.push({ on: o.dueOn, amount: o.amount, who: c.party, kind: "actual", label: `Contract: ${o.text.slice(0, 40)}` });

  const horizons = [7, 15, 30, 60].map((h) => {
    const end = plus(t0, h);
    const inn = inflows.filter((x) => x.on <= end); const out = outflows.filter((x) => x.on <= end);
    const inSum = inn.reduce((s, x) => s + x.amount, 0); const outSum = out.reduce((s, x) => s + x.amount, 0) + daily * h;
    return { days: h, expectedIn: inSum, expectedOut: outSum, imprest: daily * h, net: inSum - outSum, shortage: Math.max(0, outSum - inSum), inflows: inn.slice(0, 12), outflows: out.slice(0, 12) };
  });
  const worst = horizons.find((h) => h.shortage > 0);
  const recommendation = !worst ? "Expected inflows cover expected outflows across all horizons (opening cash from Tally not included)." :
    `Potential shortage of ₹${Math.round(worst.shortage).toLocaleString("en-IN")} within ${worst.days} days: delay non-critical vendor payments or bring forward collection from ${[...new Set(worst.inflows.map((i) => i.who))].slice(0, 2).join(", ") || "the largest receivables"}.`;
  return { generatedAt: new Date().toISOString(), basis: "Receivables & payables from coordination billing (estimated dates), payroll from the last run, imprest from 3-month average, contract obligations as recorded. Opening cash/bank must be read from Tally.", horizons, recommendation };
}

export function paymentPriority() {
  const t0 = today();
  const trips = safeTrips();
  const { pos } = computePos();
  const byVendor = new Map<string, { vendor: string; due: number; overdueDays: number; trips: number; open: number }>();
  const totalTrips = trips.length || 1;
  for (const t of trips) {
    if (!t.vendorChallanAmount || t.status === "cancelled" || (t as any).vendorPaidAt) continue;
    const v = t.supplier || t.supplierCode; if (!v) continue;
    const due = plus(t.vendorChallanDate || t.vehicleEntryDate || t0, 15);
    const cur = byVendor.get(v) || { vendor: v, due: 0, overdueDays: 0, trips: trips.filter((x) => (x.supplier || x.supplierCode) === v).length, open: 0 };
    cur.due += Number(t.vendorChallanAmount); cur.open += 1; cur.overdueDays = Math.max(cur.overdueDays, daysBetween(due, t0));
    byVendor.set(v, cur);
  }
  const list = [...byVendor.values()].map((v) => {
    const importance = v.trips / totalTrips; // share of our business
    const dependency = pos.some((p) => p.type === "vendor" && (p.partyName === v.vendor || p.partyKey === v.vendor) && ["active", "low_balance"].includes(p.effectiveStatus));
    let score = 0; const reasons: string[] = [];
    if (v.overdueDays > 0) { score += Math.min(40, v.overdueDays * 4); reasons.push(`${v.overdueDays} day(s) overdue`); }
    if (importance >= 0.2) { score += 25; reasons.push(`${Math.round(importance * 100)}% of our trips`); }
    if (dependency) { score += 20; reasons.push("active PO — supply depends on them"); }
    if (v.due >= 500000) { score += 15; reasons.push(`₹${Math.round(v.due).toLocaleString("en-IN")} outstanding`); }
    const priority = score >= 60 ? "CRITICAL" : score >= 40 ? "HIGH" : score >= 20 ? "MEDIUM" : "LOW";
    return { ...v, priority, reasons: reasons.length ? reasons : ["within terms, small share"], score };
  }).sort((a, b) => b.score - a.score);
  return { list, basis: "Vendor dues from coordination challans not marked paid (15-day terms assumed), importance by trip share, dependency by active PO, overdue by due date. Mark payments in Payments/Tally to update." };
}
