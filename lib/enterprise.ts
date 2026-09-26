/**
 * Biome AI OS — Enterprise layer (server only)
 * -------------------------------------------------------------------
 * The premium management experience, built as aggregation over engines
 * that already exist (Work, Intelligence, PO, Ops, Audit) — not as new
 * data sources. Everything here answers one of three questions:
 * what needs attention, why, and what to do about it.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadWork, saveWork, visibleTasks, planner, decisions, daysBetween, today, type WorkTask } from "@/lib/work";
import { healthScore, anomalies, predictions, expenseControl, performanceScores, rootCauses, workloads } from "@/lib/intelligence";
import { computeAll as computePos } from "@/lib/po";
import { loadIssues } from "@/lib/ops";
import { loadTrips, derivedStatus, gapsFor as tripGaps, type Trip } from "@/lib/coordination";
import { loadPartners, gapsFor } from "@/lib/partners";
import { loadEmployees } from "@/lib/payroll";
import { readAudit } from "@/lib/audit";
import { loadBackups } from "@/lib/backup";
import { readHandshake } from "@/lib/whatsappAgent";
import { readMailLog } from "@/lib/mailer";
import { remember } from "@/lib/enterprise2";

type User = { id: string; role: string; plant?: string | null; name?: string };

/* ------------------------------------------------------------------ */
/* Health trends (Business Health Index) — daily snapshots             */
/* ------------------------------------------------------------------ */

interface HealthSnap { date: string; overall: number; areas: Record<string, number> }
const snapFile = () => path.join(paths.root, "work", "health-history.json");

export function healthWithTrend() {
  const h = healthScore();
  const hist = readJson<{ snaps: HealthSnap[] }>(snapFile(), { snaps: [] }).snaps;
  const t0 = today();
  if (!hist.some((s) => s.date === t0)) {
    hist.push({ date: t0, overall: h.overall, areas: Object.fromEntries(h.areas.map((a) => [a.key, a.score])) });
    ensureDir(path.dirname(snapFile())); writeJsonAtomic(snapFile(), { snaps: hist.slice(-120) });
  }
  const at = (daysAgo: number) => { const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10); return [...hist].reverse().find((s) => s.date <= d) || null; };
  const lastWeek = at(7), lastMonth = at(30);
  const improving: string[] = [], declining: string[] = [];
  for (const a of h.areas) {
    const prev = lastWeek?.areas[a.key];
    if (prev === undefined) continue;
    if (a.score - prev >= 5) improving.push(`${a.label} +${a.score - prev}`);
    if (prev - a.score >= 5) declining.push(`${a.label} −${prev - a.score}`);
  }
  return { ...h, trend: { thisWeek: h.overall, lastWeek: lastWeek?.overall ?? null, thisMonth: h.overall, lastMonth: lastMonth?.overall ?? null }, improving, declining, history: hist.slice(-30) };
}

/* ------------------------------------------------------------------ */
/* SLA & escalation engine                                              */
/* ------------------------------------------------------------------ */

export interface SlaRule { kind: string; label: string; hours: number; warnAtPct: number; escalateAfterHours: number }
const slaFile = () => path.join(paths.root, "work", "sla.json");
export const DEFAULT_SLA: SlaRule[] = [
  { kind: "approval", label: "Approvals (imprest, leave, activation)", hours: 24, warnAtPct: 75, escalateAfterHours: 30 },
  { kind: "missing_document", label: "Missing document follow-up", hours: 72, warnAtPct: 75, escalateAfterHours: 96 },
  { kind: "operations", label: "Operational issues / receivings", hours: 48, warnAtPct: 75, escalateAfterHours: 60 },
  { kind: "finance", label: "Finance reviews", hours: 24, warnAtPct: 75, escalateAfterHours: 36 },
  { kind: "expiry", label: "Document renewals", hours: 168, warnAtPct: 80, escalateAfterHours: 200 },
];
export function loadSla(): SlaRule[] { return readJson<{ rules: SlaRule[] }>(slaFile(), { rules: DEFAULT_SLA }).rules; }
export function saveSla(rules: SlaRule[]) { ensureDir(path.dirname(slaFile())); writeJsonAtomic(slaFile(), { rules }); }

export function slaOf(t: WorkTask, rules = loadSla()) {
  const r = rules.find((x) => x.kind === t.kind);
  if (!r || t.status !== "open") return null;
  const ageH = (Date.now() - new Date(t.createdAt).getTime()) / 3600000;
  const pct = Math.round((ageH / r.hours) * 100);
  const state: "ok" | "warning" | "breach" | "escalate" = ageH >= r.escalateAfterHours ? "escalate" : ageH >= r.hours ? "breach" : pct >= r.warnAtPct ? "warning" : "ok";
  return { rule: r.label, hours: r.hours, ageHours: Math.round(ageH), pct, state };
}

export function slaAnalytics(tasks: WorkTask[]) {
  const rules = loadSla();
  const out = rules.map((r) => {
    const mine = tasks.filter((t) => t.kind === r.kind);
    const done = mine.filter((t) => (t.status === "done" || t.status === "auto_resolved") && t.resolvedAt);
    const within = done.filter((t) => (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600000 <= r.hours).length;
    const open = mine.filter((t) => t.status === "open");
    const breached = open.filter((t) => (Date.now() - new Date(t.createdAt).getTime()) / 3600000 >= r.hours).length;
    return { ...r, resolved: done.length, withinSlaPct: done.length ? Math.round((within / done.length) * 100) : null, openBreached: breached, open: open.length };
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Risk radar — per entity, explained                                   */
/* ------------------------------------------------------------------ */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
const level = (score: number): RiskLevel => (score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW");

export interface EntityRisk { type: "vendor" | "client" | "transporter" | "employee" | "plant"; name: string; key: string; overall: RiskLevel; parts: { label: string; level: RiskLevel; why: string }[]; why: string }

export function riskRadar(): EntityRisk[] {
  const out: EntityRisk[] = [];
  const trips = safeTrips();
  const perf = performanceScores();
  const { pos } = computePos();
  const tasks = loadWork().tasks.filter((t) => t.status === "open");
  const issues = loadIssues().filter((i) => i.status === "open" || i.status === "investigating");

  for (const p of loadPartners()) {
    const g = gapsFor(p);
    const docScore = Math.min(100, g.expired.length * 40 + g.missing.length * 20 + g.expiringSoon.length * 10);
    const pf = perf.find((x) => x.party === p.name || x.party === p.code);
    const opScore = pf ? Math.max(0, 100 - pf.score) : 0;
    const myPos = pos.filter((x) => x.type === "vendor" && (x.partyKey === p.code || x.partyName === p.name));
    const finScore = myPos.some((x) => x.effectiveStatus === "exhausted") ? 60 : myPos.some((x) => x.effectiveStatus === "low_balance") ? 30 : 0;
    const issueScore = Math.min(100, issues.filter((i) => i.party === p.name).length * 25);
    const parts = [
      { label: "Document risk", level: level(docScore), why: [g.expired.length ? `${g.expired.length} expired` : "", g.missing.length ? `${g.missing.length} missing` : "", g.expiringSoon.length ? `${g.expiringSoon.length} expiring` : ""].filter(Boolean).join(", ") || "all papers in order" },
      { label: "Operational risk", level: level(opScore), why: pf ? `performance ${pf.score}/100 over ${pf.trips} trips` : "no trips on record" },
      { label: "Financial / PO risk", level: level(finScore), why: myPos.length ? myPos.map((x) => `${x.poNumber} ${x.effectiveStatus} (${x.utilisationPct}%)`).join("; ") : "no PO tracked" },
      { label: "Issue risk", level: level(issueScore), why: issueScore ? `${issueScore / 25} open issue(s)` : "no open issues" },
    ];
    const overallScore = docScore * 0.35 + opScore * 0.3 + finScore * 0.2 + issueScore * 0.15;
    out.push({ type: p.kind === "transporter" ? "transporter" : "vendor", name: p.name, key: p.code || p.name, overall: level(overallScore), parts, why: parts.filter((x) => x.level !== "LOW").map((x) => `${x.label}: ${x.why}`).join(" · ") || "Nothing flagged." });
  }
  for (const c of new Set(trips.map((t) => t.client).filter(Boolean))) {
    const pf = perf.find((x) => x.role === "client" && x.party === c);
    const opScore = pf ? Math.max(0, 100 - pf.score) : 0;
    const myPos = pos.filter((x) => x.type === "client" && x.partyName === c);
    const poScore = myPos.some((x) => x.effectiveStatus === "exhausted" || x.effectiveStatus === "expired") ? 70 : myPos.some((x) => x.effectiveStatus === "low_balance") ? 35 : 0;
    const openTasks = tasks.filter((t) => t.title.includes(c)).length;
    const parts = [
      { label: "Operational risk", level: level(opScore), why: pf ? `${pf.parts.map((x) => x.value).join("; ")}` : "no data" },
      { label: "PO risk", level: level(poScore), why: myPos.length ? myPos.map((x) => `${x.poNumber} ${x.effectiveStatus} (${x.utilisationPct}%)`).join("; ") : "no PO tracked" },
      { label: "Follow-up load", level: level(Math.min(100, openTasks * 20)), why: `${openTasks} open task(s)` },
    ];
    const s = opScore * 0.5 + poScore * 0.35 + Math.min(100, openTasks * 20) * 0.15;
    out.push({ type: "client", name: c, key: c, overall: level(s), parts, why: parts.filter((x) => x.level !== "LOW").map((x) => `${x.label}: ${x.why}`).join(" · ") || "Nothing flagged." });
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return out.sort((a, b) => order[a.overall] - order[b.overall]);
}

/* ------------------------------------------------------------------ */
/* Early warnings — trend over the last 30 vs the previous 30 days       */
/* ------------------------------------------------------------------ */

export interface Warning { title: string; current: string; trend: string; predicted: RiskLevel; action: string }

export function earlyWarnings(): Warning[] {
  const out: Warning[] = [];
  const t0 = today();
  const trips = safeTrips();
  const win = (from: number, to: number) => trips.filter((t) => t.vehicleEntryDate && daysBetween(t.vehicleEntryDate, t0) > from && daysBetween(t.vehicleEntryDate, t0) <= to);
  const shortRate = (ts: Trip[]) => (ts.length ? ts.filter((t) => { try { return derivedStatus(t) === "shortage"; } catch { return false; } }).length / ts.length : 0);
  const cur = win(0, 30), prev = win(30, 60);
  if (cur.length >= 3 && prev.length >= 3) {
    const a = shortRate(cur), b = shortRate(prev);
    if (a > b + 0.1) out.push({ title: "Weight discrepancies increasing", current: `${Math.round(a * 100)}% of loads short (last 30 days)`, trend: `up from ${Math.round(b * 100)}%`, predicted: a > 0.4 ? "HIGH" : "MEDIUM", action: "Open Root Cause in Insights; weigh the top vendor's loads at our kanta." });
  }
  for (const e of expenseControl()) if (e.changePct >= 18 && e.thisMonth > 5000) out.push({ title: `${e.category} expenses trending above normal`, current: `₹${Math.round(e.thisMonth).toLocaleString("en-IN")} this month`, trend: `+${e.changePct}% vs last month`, predicted: e.changePct >= 40 ? "HIGH" : "MEDIUM", action: "Review the entries under this head; set a budget in Imprest." });
  for (const p of predictions()) if (p.risk !== "LOW") out.push({ title: p.title, current: p.value, trend: p.basis, predicted: p.risk, action: p.key.startsWith("vendor") ? "Weigh before dispatch; consider a second vendor." : p.key.startsWith("late") ? "Escalate with the client gate; keep vehicles from waiting." : "Line up collections / defer non-critical spend." });
  const { pos } = computePos();
  for (const p of pos) if (p.predictedExhaustionDays !== null && p.predictedExhaustionDays <= 10 && p.effectiveStatus !== "exhausted") out.push({ title: `${p.type === "vendor" ? "Vendor" : "Client"} PO ${p.poNumber} (${p.partyName}) nearing exhaustion`, current: `${Math.round(p.remainingKg / 1000)} MT remaining`, trend: `~${Math.round((p.avgDailyKg || 0) / 1000)} MT/day → ${p.predictedExhaustionDays} day(s) (estimate, ${p.predictionConfidence})`, predicted: p.predictedExhaustionDays <= 3 ? "HIGH" : "MEDIUM", action: "Initiate new PO / extension from PO Control." });
  const wl = workloads();
  for (const w of wl.people) if (w.load === "heavy" && !w.name.startsWith("(")) out.push({ title: `${w.name}'s workload continuously above normal`, current: `${w.open} open, ${w.overdue} overdue`, trend: "heavy", predicted: "MEDIUM", action: wl.suggestion || "Delegate from the Work planner." });
  return out;
}

/* ------------------------------------------------------------------ */
/* Data quality guardian                                                */
/* ------------------------------------------------------------------ */

export interface DataIssue { problem: string; records: string[]; fix: string; confidence: number; href: string }

export function dataQuality(): DataIssue[] {
  const out: DataIssue[] = [];
  const partners = loadPartners();
  const byGstin = new Map<string, string[]>();
  for (const p of partners) if (p.gstin) byGstin.set(p.gstin.toUpperCase(), [...(byGstin.get(p.gstin.toUpperCase()) || []), p.name]);
  for (const [g, names] of byGstin) if (names.length > 1) out.push({ problem: `Same GSTIN ${g} on ${names.length} registrations`, records: names, fix: "Merge the duplicate registration or correct the GSTIN.", confidence: 95, href: "/partners" });
  for (const p of partners) { const miss = gapsFor(p).missingFields; if (miss.length) out.push({ problem: `${p.name}: missing ${miss.join(", ")}`, records: [p.name], fix: "Complete the registration record.", confidence: 100, href: "/partners" }); }
  const trips = safeTrips();
  const active = trips.filter((t) => { try { return ["planned", "dispatched"].includes(derivedStatus(t)); } catch { return false; } });
  const byVeh = new Map<string, Trip[]>();
  for (const t of active) if (t.vehicleNumber) byVeh.set(t.vehicleNumber, [...(byVeh.get(t.vehicleNumber) || []), t]);
  for (const [v, ts] of byVeh) if (ts.length > 1) out.push({ problem: `Vehicle ${v} is on ${ts.length} active trips at once`, records: ts.map((t) => t.ourDocNo || t.id.slice(0, 8)), fix: "Close or correct the older trip.", confidence: 85, href: "/coordination" });
  for (const t of trips) {
    const inv = (t as any).billing?.invoiceDate;
    if (inv && t.vehicleEntryDate && inv < t.vehicleEntryDate) out.push({ problem: `Invoice dated ${inv} before vehicle entry ${t.vehicleEntryDate}`, records: [t.ourDocNo || t.vehicleNumber], fix: "Check the invoice date or the entry date.", confidence: 90, href: "/coordination" });
    if (t.receivingDate && t.vehicleEntryDate && t.receivingDate < t.vehicleEntryDate) out.push({ problem: `Receiving ${t.receivingDate} before dispatch ${t.vehicleEntryDate}`, records: [t.ourDocNo || t.vehicleNumber], fix: "One of the two dates is wrong.", confidence: 95, href: "/coordination" });
  }
  const { pos } = computePos();
  for (const p of pos) if (p.linkedTrips === 0 && p.effectiveStatus === "active" && daysBetween(p.startDate || p.poDate, today()) > 14) out.push({ problem: `PO ${p.poNumber} (${p.partyName}) active for ${daysBetween(p.startDate || p.poDate, today())} days with no supply linked`, records: [p.poNumber], fix: "Link supplies to it in Coordination, or close it.", confidence: 70, href: "/po" });
  try {
    const emps = loadEmployees().filter((e) => e.active);
    const byCode = new Map<string, number>(); for (const e of emps) byCode.set(e.code, (byCode.get(e.code) || 0) + 1);
    for (const [c, n] of byCode) if (n > 1) out.push({ problem: `Employee code ${c} used ${n} times`, records: [c], fix: "Give each employee a unique code.", confidence: 100, href: "/employees" });
  } catch { /* none */ }
  return out;
}

/* ------------------------------------------------------------------ */
/* Audit intelligence                                                   */
/* ------------------------------------------------------------------ */

export function auditIntelligence() {
  const events = (() => { try { return readAudit({}).events; } catch { return [] as any[]; } })();
  const t0 = today();
  const recent = events.filter((e) => daysBetween(e.at.slice(0, 10), t0) <= 7);
  const findings: { title: string; detail: string; href: string }[] = [];
  const byTarget = new Map<string, any[]>();
  for (const e of recent) if (e.targetType && e.targetId && /update|adjust|edit|status|put/i.test(e.action)) byTarget.set(`${e.targetType}:${e.targetId}`, [...(byTarget.get(`${e.targetType}:${e.targetId}`) || []), e]);
  for (const [k, es] of byTarget) if (es.length >= 3) findings.push({ title: `${es[0].targetLabel || k} modified ${es.length} times in 7 days`, detail: `${[...new Set(es.map((e) => e.userName))].join(", ")} · ${[...new Set(es.map((e) => e.action))].join(", ")}`, href: "/audit" });
  const sensitive = recent.filter((e) => /bank|gstin|password|override|delete|cancel|po\.adjust|payroll\.unlock|users\./i.test(e.action + " " + (e.detail || "")));
  if (sensitive.length) findings.push({ title: `${sensitive.length} sensitive action(s) this week`, detail: [...new Set(sensitive.map((e) => e.action))].slice(0, 6).join(", "), href: "/audit" });
  const failed = recent.filter((e) => e.outcome === "failed");
  if (failed.length >= 3) findings.push({ title: `${failed.length} failed actions this week`, detail: [...new Set(failed.map((e) => e.action))].slice(0, 5).join(", "), href: "/audit" });
  const byUser = new Map<string, number>(); for (const e of recent) byUser.set(e.userName, (byUser.get(e.userName) || 0) + 1);
  const top = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 200) findings.push({ title: `Unusually high activity: ${top[0]} (${top[1]} actions in 7 days)`, detail: "Could be a script, a bulk correction, or a shared login.", href: "/audit" });
  return { findings, eventsThisWeek: recent.length };
}

/* ------------------------------------------------------------------ */
/* Insights feed — proactive observations                                */
/* ------------------------------------------------------------------ */

export function insightsFeed() {
  const feed: { text: string; evidence: string; impact: string; action: string; tone: "good" | "bad" | "neutral" }[] = [];
  const h = healthWithTrend();
  for (const s of h.improving) feed.push({ text: `${s.split(" ")[0]} score improved this week`, evidence: s, impact: "Fewer open problems in that area.", action: "Keep the cadence.", tone: "good" });
  for (const s of h.declining) feed.push({ text: `${s.split(" ")[0]} score declined this week`, evidence: s, impact: "More open or overdue work.", action: "Open Command Center → that section.", tone: "bad" });
  for (const p of performanceScores().slice(0, 3)) feed.push({ text: `${p.party} is the weakest ${p.role} on record`, evidence: p.parts.map((x) => x.value).join("; "), impact: `Score ${p.score}/100 over ${p.trips} trips.`, action: p.role === "vendor" ? "Weigh loads before dispatch; review the contract." : "Escalate gate delays; verify their weighbridge.", tone: "bad" });
  for (const e of expenseControl().slice(0, 2)) feed.push({ text: `${e.category} spend ${e.changePct >= 0 ? "up" : "down"} ${Math.abs(e.changePct)}% month-on-month`, evidence: `₹${Math.round(e.thisMonth).toLocaleString("en-IN")} vs ₹${Math.round(e.lastMonth).toLocaleString("en-IN")}`, impact: e.changePct >= 15 ? "Budget pressure." : "Within range.", action: e.changePct >= 15 ? "Review entries under this head." : "None.", tone: e.changePct >= 15 ? "bad" : e.changePct <= -15 ? "good" : "neutral" });
  const w = loadWork();
  const auto7 = w.tasks.filter((t) => t.status === "auto_resolved" && t.resolvedAt && daysBetween(t.resolvedAt.slice(0, 10), today()) <= 7).length;
  if (auto7) feed.push({ text: `${auto7} task(s) closed themselves this week`, evidence: "Conditions cleared before anyone acted.", impact: "Time saved on follow-up.", action: "None.", tone: "good" });
  const mails = readMailLog().filter((m) => daysBetween(m.at.slice(0, 10), today()) <= 7);
  if (mails.length) feed.push({ text: `${mails.length} email(s) sent this week`, evidence: `${mails.filter((m) => !m.ok).length} failed`, impact: mails.some((m) => !m.ok) ? "Some notices did not reach." : "All delivered.", action: mails.some((m) => !m.ok) ? "Check SMTP in Settings." : "None.", tone: mails.some((m) => !m.ok) ? "bad" : "neutral" });
  return feed;
}

/* ------------------------------------------------------------------ */
/* Supply lifecycle                                                      */
/* ------------------------------------------------------------------ */

export function lifecycleOf(t: Trip) {
  let status = "planned"; try { status = derivedStatus(t); } catch { /* keep */ }
  const gaps = (() => { try { return tripGaps(t); } catch { return [] as string[]; } })();
  const b = (t as any).billing || {};
  const stages = [
    { key: "created", label: "Created", done: true, when: t.ourDocDate || (t as any).createdAt?.slice(0, 10) || "" },
    { key: "dispatched", label: "Dispatched", done: Boolean(t.vehicleEntryDate) && status !== "planned", when: t.vehicleEntryDate },
    { key: "documents", label: "Documents received", done: gaps.length === 0, when: "" , note: gaps.length ? `Missing: ${gaps.join(", ")}` : "" },
    { key: "receiving", label: "Receiving matched", done: Boolean(t.receivingDate && t.receivingQty), when: t.receivingDate },
    { key: "weight", label: "Weight verified", done: Boolean(t.receivingQty) && status !== "shortage", when: "", note: status === "shortage" ? "Shortage beyond tolerance — dispute or accept" : "" },
    { key: "billing", label: "Billing ready", done: gaps.length === 0 && Boolean(t.receivingQty) && status !== "shortage", when: "" },
    { key: "invoiced", label: "Invoiced", done: Boolean(b.invoiceDate), when: b.invoiceDate || "" },
    { key: "payment", label: "Payment", done: Boolean(b.paidAt || b.paymentDate), when: b.paidAt || b.paymentDate || "", note: b.invoiceDate && !(b.paidAt || b.paymentDate) ? "Track in Tally / Payments" : "" },
  ];
  const bottleneck = stages.find((s) => !s.done);
  return { status, stages, bottleneck: bottleneck ? `${bottleneck.label} pending${bottleneck.note ? ` — ${bottleneck.note}` : ""}` : "Complete", gaps };
}

export function bottleneckAnalytics() {
  const trips = safeTrips();
  const durations: Record<string, number[]> = { "dispatch→receiving": [], "receiving→invoice": [], "entry→invoice": [] };
  for (const t of trips) {
    const b = (t as any).billing || {};
    if (t.vehicleEntryDate && t.receivingDate) durations["dispatch→receiving"].push(daysBetween(t.vehicleEntryDate, t.receivingDate));
    if (t.receivingDate && b.invoiceDate) durations["receiving→invoice"].push(daysBetween(t.receivingDate, b.invoiceDate));
    if (t.vehicleEntryDate && b.invoiceDate) durations["entry→invoice"].push(daysBetween(t.vehicleEntryDate, b.invoiceDate));
  }
  const stat = (a: number[]) => (a.length ? { avg: Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10, max: Math.max(...a), n: a.length } : null);
  const waiting = trips.filter((t) => { try { return derivedStatus(t) === "dispatched"; } catch { return false; } }).length;
  const docWait = trips.filter((t) => { try { return tripGaps(t).length > 0 && t.receivingDate; } catch { return false; } }).length;
  return { steps: Object.fromEntries(Object.entries(durations).map(([k, v]) => [k, stat(v)])), waitingForReceiving: waiting, waitingForDocuments: docWait, longestDelay: docWait > waiting ? "Document verification" : "Receiving from client" };
}

/* ------------------------------------------------------------------ */
/* Entity 360 + graph search                                             */
/* ------------------------------------------------------------------ */

export function entity360(type: string, key: string, user: User) {
  const q = key.toLowerCase();
  const trips = safeTrips();
  const hit = (s: any) => String(s || "").toLowerCase().includes(q);
  const tasks = visibleTasks(loadWork().tasks, user).filter((t) => hit(t.title) || hit(t.why) || hit(t.evidence.join(" ")));
  const issues = loadIssues().filter((i) => hit(i.title) || hit(i.party) || hit(i.description));
  const { pos } = computePos();
  const mine = trips.filter((t) => type === "supply" ? hit(t.ourDocNo) || hit((t as any).reference) : type === "vehicle" ? hit(t.vehicleNumber) : type === "client" ? hit(t.client) : hit(t.supplier) || hit(t.supplierCode));
  const partner = loadPartners().find((p) => hit(p.name) || (p.code && p.code.toLowerCase() === q));
  const risk = riskRadar().find((r) => hit(r.name) || r.key.toLowerCase() === q);
  const perf = performanceScores().find((p) => hit(p.party));
  const myPos = pos.filter((p) => hit(p.partyName) || p.partyKey.toLowerCase() === q);
  const timeline: { at: string; what: string; by: string; kind: string }[] = [];
  try { for (const e of readAudit({}).events) if (hit(e.targetLabel) || hit(e.detail)) timeline.push({ at: e.at, what: e.action.replace(/\./g, " · ") + (e.detail ? ` — ${e.detail}` : ""), by: e.userName, kind: e.userName === "Autopilot" || e.userId === "system" ? "automation" : "human" }); } catch { /* none */ }
  for (const m of readMailLog()) if (hit(m.to) || hit(m.subject)) timeline.push({ at: m.at, what: `Email: ${m.subject}`, by: "system", kind: "communication" });
  for (const t of tasks) timeline.push({ at: t.createdAt, what: `Task: ${t.title}`, by: t.source === "auto" ? "Autopilot" : "user", kind: t.source === "auto" ? "ai" : "human" });
  timeline.sort((a, b) => b.at.localeCompare(a.at));
  return {
    type, key, partner: partner ? { ...partner, gaps: gapsFor(partner) } : null, risk: risk || null, performance: perf || null, pos: myPos,
    supplies: mine.slice(0, 50).map((t) => ({ id: t.id, ourDocNo: t.ourDocNo, client: t.client, supplier: t.supplier, vehicle: t.vehicleNumber, entry: t.vehicleEntryDate, receiving: t.receivingDate, qty: t.vendorChallanWeight, received: t.receivingQty, lifecycle: lifecycleOf(t) })),
    tasks: tasks.filter((t) => t.status === "open").slice(0, 20), issues: issues.slice(0, 20), timeline: timeline.slice(0, 80),
    financial: { pendingTasksAmount: tasks.filter((t) => t.status === "open").reduce((s, t) => s + (t.amount || 0), 0) },
  };
}

export function graphSearch(q: string, user: User) {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const hit = (v: any) => String(v || "").toLowerCase().includes(s);
  const out: { type: string; title: string; detail: string; href: string }[] = [];
  for (const t of safeTrips()) if (hit(t.ourDocNo) || hit((t as any).reference) || hit(t.vehicleNumber) || hit(t.vendorInvoiceNo)) out.push({ type: "supply", title: `${t.ourDocNo || "Supply"} · ${t.vehicleNumber || ""}`, detail: `${t.supplier || t.supplierCode} → ${t.client} · ${t.vehicleEntryDate || ""}`, href: `/entity?type=supply&key=${encodeURIComponent(t.ourDocNo || t.vehicleNumber)}` });
  for (const p of loadPartners()) if (hit(p.name) || hit(p.code) || hit(p.gstin)) out.push({ type: p.kind === "transporter" ? "transporter" : "vendor", title: p.name, detail: `${p.code || ""} ${p.gstin || ""} · ${p.status}`, href: `/entity?type=vendor&key=${encodeURIComponent(p.name)}` });
  for (const c of new Set(safeTrips().map((t) => t.client))) if (hit(c)) out.push({ type: "client", title: c, detail: "client", href: `/entity?type=client&key=${encodeURIComponent(c)}` });
  for (const p of computePos().pos) if (hit(p.poNumber) || hit(p.partyName)) out.push({ type: "po", title: `PO ${p.poNumber} · ${p.partyName}`, detail: `${p.effectiveStatus} · ${p.utilisationPct}% used`, href: "/po" });
  for (const t of visibleTasks(loadWork().tasks, user)) if (hit(t.title)) out.push({ type: "task", title: t.title, detail: `${t.priority} · ${t.status}`, href: "/work" });
  for (const i of loadIssues()) if (hit(i.title) || hit(i.party)) out.push({ type: "issue", title: i.title, detail: `${i.kind} · ${i.status}`, href: "/issues" });
  try { for (const e of loadEmployees()) if (hit(e.name) || hit(e.code)) out.push({ type: "employee", title: e.name, detail: `${e.code} · ${e.designation || ""} · ${e.plant || ""}`, href: `/entity?type=employee&key=${encodeURIComponent(e.name)}` }); } catch { /* none */ }
  return out.slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* System health (business continuity)                                  */
/* ------------------------------------------------------------------ */

export function systemHealth() {
  const backups = (() => { try { return loadBackups(); } catch { return [] as any[]; } })();
  const lastBackup = backups.map((b: any) => b.createdAt || b.at).filter(Boolean).sort().reverse()[0] || null;
  const backupAge = lastBackup ? daysBetween(lastBackup.slice(0, 10), today()) : null;
  let free = 0, size = 0;
  try { const st = (fs as any).statfsSync?.(paths.root); if (st) { free = Number(st.bavail) * Number(st.bsize); size = Number(st.blocks) * Number(st.bsize); } } catch { /* unsupported */ }
  const agent = readHandshake();
  const mem = os.freemem() / os.totalmem();
  return {
    server: { status: "healthy", uptimeHours: Math.round(os.uptime() / 3600), freeMemPct: Math.round(mem * 100) },
    backup: { status: backupAge === null ? "never" : backupAge > 7 ? "warning" : "completed", lastBackup, daysAgo: backupAge, guidance: backupAge === null || backupAge > 7 ? "Take a backup now: Settings → Backup, or Google Drive sync." : "OK" },
    storage: size ? { status: free / size < 0.1 ? "warning" : "healthy", freeGb: Math.round(free / 1e9), totalGb: Math.round(size / 1e9), guidance: free / size < 0.1 ? "Less than 10% disk free on the data drive — archive old documents or add storage." : "OK" } : { status: "unknown", freeGb: null, totalGb: null, guidance: "Disk statistics unavailable on this platform." },
    whatsappAgent: { status: agent ? "healthy" : "down", guidance: agent ? "OK" : "The agent process is not running — restart the desktop app; check WhatsApp Documents → Connection." },
    tally: { status: "check", guidance: "Verify from Ledgers / Reports; Tally must be open with the company loaded on the server PC." },
    mail: { status: readMailLog().some((m) => !m.ok && daysBetween(m.at.slice(0, 10), today()) <= 1) ? "warning" : "healthy", guidance: "Recent failures → check SMTP in Settings → Mail." },
  };
}

/* ------------------------------------------------------------------ */
/* Command Center + briefing + chief of staff                            */
/* ------------------------------------------------------------------ */

export function commandCenter(user: User) {
  const w = loadWork();
  const tasks = visibleTasks(w.tasks, user);
  const p = planner(tasks); const dec = decisions(tasks);
  const { pos } = computePos();
  const an = anomalies();
  const sla = loadSla();
  const open = p.tasks;
  const bucket = (mods: string[]) => open.filter((t) => mods.includes(t.module)).map((t) => ({ ...t, sla: slaOf(t, sla) }));
  const poAlerts = pos.flatMap((po) => po.alerts.map((a) => ({ ...a, poId: po.id, party: po.partyName, poNumber: po.poNumber, href: "/po" })));
  const financial = { tasks: bucket(["Imprest", "Month-end", "Inbox", "PO Control"]), anomalies: an.filter((a) => a.kind === "duplicate_expense" || a.kind === "unusual_amount"), poAlerts: poAlerts.filter((a) => a.level === "critical" || a.level === "high") };
  const operational = { tasks: bucket(["Coordination", "WhatsApp Documents", "Issues", "Meetings", "Forms"]), anomalies: an.filter((a) => a.kind === "weight_variance" || a.kind === "duplicate_trip") };
  const compliance = { tasks: bucket(["Registration", "Company Documents"]), data: dataQuality().slice(0, 10) };
  const workforce = { tasks: bucket(["Leave", "Employees", "Attendance"]), workloads: workloads() };
  const auto7 = w.tasks.filter((t) => t.status === "auto_resolved" && t.resolvedAt && daysBetween(t.resolvedAt.slice(0, 10), today()) <= 7).length;
  return {
    counts: { critical: p.counts.critical, decisions: dec.length, followups: p.counts.followup + p.counts.normal, automated: auto7 + (w.runs[0]?.created || 0) },
    financial, operational, compliance, workforce, decisions: dec.slice(0, 10), poAlerts,
    health: healthWithTrend(), warnings: earlyWarnings().slice(0, 8), feed: insightsFeed().slice(0, 8), system: systemHealth(), lastRun: w.runs[0] || null,
  };
}

export function chiefOfStaff(user: User) {
  const tasks = visibleTasks(loadWork().tasks, user);
  const mine = tasks.filter((t) => t.status === "open" && (t.assigneeId === user.id || t.ownerRoles.includes(user.role)));
  const t0 = today();
  const dec = decisions(mine);
  const overdueApprovals = dec.filter((d) => d.overdueDays > 0).length;
  const followups = mine.filter((t) => t.followupStep >= 2).slice(0, 3);
  const cash = predictions().find((p) => p.key === "cash15");
  const lines = [
    `You have ${dec.length} decision${dec.length === 1 ? "" : "s"} waiting${dec.filter((d) => d.risk === "HIGH").length ? ` (${dec.filter((d) => d.risk === "HIGH").length} high-risk)` : ""}.`,
    overdueApprovals ? `${overdueApprovals} approval${overdueApprovals === 1 ? " is" : "s are"} overdue.` : "",
    ...followups.map((f) => `${f.title.split(":")[0]} requires follow-up (${["", "day 1", "day 3", "day 5", "day 7 — escalate"][f.followupStep]}).`),
    cash && cash.risk !== "LOW" ? `Cash position needs attention: ${cash.value} required in the next 15 days.` : "",
    mine.filter((t) => t.dueOn < t0).length ? `${mine.filter((t) => t.dueOn < t0).length} of your tasks are overdue.` : "",
  ].filter(Boolean);
  return { lines, decisions: dec.slice(0, 5), doNow: mine.filter((t) => t.priority === "critical" || t.dueOn <= t0).slice(0, 6) };
}

export function briefing(user: User) {
  const cc = commandCenter(user);
  const { pos } = computePos();
  const trips = safeTrips();
  const active = trips.filter((t) => { try { return ["planned", "dispatched"].includes(derivedStatus(t)); } catch { return false; } }).length;
  const delayed = cc.operational.tasks.filter((t) => t.module === "Coordination").length;
  const partners = loadPartners();
  const compliant = partners.length ? Math.round((partners.filter((p) => !gapsFor(p).missing.length && !gapsFor(p).expired.length).length / partners.length) * 100) : 100;
  const status = cc.health.overall >= 80 ? "HEALTHY" : cc.health.overall >= 60 ? "NEEDS ATTENTION" : "AT RISK";
  const cash = predictions().find((p) => p.key === "cash15");
  return {
    generatedAt: new Date().toISOString(), status, health: cc.health.overall,
    financial: { pendingApprovalsAmount: cc.financial.tasks.reduce((s, t) => s + (t.amount || 0), 0), cashNeed15d: cash?.value || "—", exhaustedPos: pos.filter((p) => p.effectiveStatus === "exhausted").length, lowPos: pos.filter((p) => p.effectiveStatus === "low_balance").length },
    operations: { activeSupplies: active, delayed, incompleteSets: cc.operational.tasks.filter((t) => t.module === "WhatsApp Documents").length },
    documents: { compliancePct: compliant, expiring: cc.compliance.tasks.filter((t) => t.kind === "expiry").length },
    risk: { high: cc.warnings.filter((w) => w.predicted === "HIGH" || w.predicted === "CRITICAL").length, anomalies: cc.financial.anomalies.length + cc.operational.anomalies.length },
    decisions: cc.decisions.slice(0, 5).map((d) => ({ title: d.task.title, risk: d.risk, recommendation: d.recommendation })),
    highlights: cc.feed.slice(0, 4).map((f) => f.text),
  };
}

export function briefingText(b: ReturnType<typeof briefing>) {
  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  return [
    `GOOD MORNING — BIOME AI OS EXECUTIVE BRIEFING (${new Date(b.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })})`, "",
    `BUSINESS STATUS: ${b.status} · Health ${b.health}/100`, "",
    `Financial: ${inr(b.financial.pendingApprovalsAmount)} awaiting approval · cash need next 15 days ${b.financial.cashNeed15d} · POs exhausted ${b.financial.exhaustedPos}, low ${b.financial.lowPos}`,
    `Operations: ${b.operations.activeSupplies} active supplies · ${b.operations.delayed} delayed · ${b.operations.incompleteSets} incomplete document sets`,
    `Documents: ${b.documents.compliancePct}% partner compliance · ${b.documents.expiring} expiring`,
    `Risk: ${b.risk.high} high-priority warnings · ${b.risk.anomalies} anomalies`, "",
    `TODAY'S DECISIONS (${b.decisions.length}):`, ...b.decisions.map((d, i) => `${i + 1}. [${d.risk}] ${d.title} — ${d.recommendation}`), "",
    ...(b.highlights.length ? ["HIGHLIGHTS:", ...b.highlights.map((h) => `• ${h}`)] : []),
    "", "— Generated automatically. Figures come from the app's own records; predictions are estimates.",
  ].join("\n");
}

function safeTrips(): Trip[] { try { return loadTrips(); } catch { return []; } }

/** Decision Room actions on top of the Work task store. */
export function decide(taskId: string, action: "approve" | "reject" | "send_back" | "request_info", note: string, user: User & { name: string }) {
  const w = loadWork(); const t = w.tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const now = new Date().toISOString();
  if (action === "approve") { t.status = "done"; t.resolvedAt = now; t.evidence.push(`Approved by ${user.name}${note ? `: ${note}` : ""}`); }
  if (action === "reject") { t.status = "dismissed"; t.resolvedAt = now; t.evidence.push(`Rejected by ${user.name}${note ? `: ${note}` : ""}`); }
  if (action === "send_back") { t.status = "snoozed"; t.snoozedUntil = new Date(Date.now() + 86400000).toISOString().slice(0, 10); t.evidence.push(`Sent back by ${user.name}${note ? `: ${note}` : ""}`); }
  if (action === "request_info") { t.priority = t.priority === "critical" ? "critical" : "urgent"; t.evidence.push(`Information requested by ${user.name}${note ? `: ${note}` : ""}`); }
  t.updatedAt = now; saveWork(w);
  // Business memory: decisions are the most valuable context the AI can carry forward.
  try { remember({ kind: "decision", text: `${action.replace("_", " ")}: ${t.title}${note ? ` — ${note}` : ""} (${t.module})`, source: "Decision Room", createdBy: user.name }); } catch { /* memory is optional */ }
  return t;
}
