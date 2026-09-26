/**
 * Biome AI OS — Intelligence layer (server only)
 * -------------------------------------------------------------------
 * Phase 2 of the Business OS roadmap, built on data the app already
 * holds: the Work Engine's tasks, coordination trips, imprest entries,
 * partner registrations, payroll runs. Nothing here calls an external
 * model; every number is computed, every finding cites what it counted,
 * and every prediction carries a confidence and its basis — so the
 * management screen can say "here is why" rather than "trust me".
 *
 * Sections covered: 21 Health Score · 10 Anomaly detection · 22 Root
 * cause · 3 Prediction · 33 Expense control · 14 Performance score ·
 * 15 What-if · 25 Productivity insights · 26 Resource allocation.
 */

import { loadWork, daysBetween, today, type WorkTask } from "@/lib/work";
import { loadTrips, derivedStatus, shortageFor, gapsFor as tripGaps, DEFAULT_SHORTAGE_RULES, type Trip } from "@/lib/coordination";
import { loadEntries as loadImprestEntries, loadPeople as loadImprestPeople } from "@/lib/imprest";
import { loadPartners, gapsFor } from "@/lib/partners";
import { loadEmployees, loadRuns } from "@/lib/payroll";

const DAY = 86400000;
const ym = (d: string) => String(d || "").slice(0, 7);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * DAY).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

function safeTrips(): Trip[] { try { return loadTrips(); } catch { return []; } }

/* ------------------------------------------------------------------ */
/* 21 · Business Health Score                                          */
/* ------------------------------------------------------------------ */

export interface HealthScore {
  overall: number;
  areas: { key: string; label: string; score: number; reasons: string[]; fix: string }[];
}

export function healthScore(): HealthScore {
  const tasks = loadWork().tasks.filter((t) => t.status === "open");
  const t0 = today();
  const penalty = (mods: string[], perOpen = 6, perOverdue = 6, perCritical = 10) => {
    const mine = tasks.filter((t) => mods.includes(t.module));
    const overdue = mine.filter((t) => t.dueOn < t0).length;
    const crit = mine.filter((t) => t.priority === "critical").length;
    return { score: clamp(100 - mine.length * perOpen - overdue * perOverdue - crit * perCritical), mine, overdue, crit };
  };

  const fin = penalty(["Imprest", "Month-end"], 5, 8, 12);
  const ops = penalty(["Coordination", "WhatsApp Documents"], 4, 6, 10);
  const comp = penalty(["Registration", "Company Documents"], 6, 8, 15);
  const doc = (() => {
    const partners = loadPartners();
    const incomplete = partners.filter((p) => gapsFor(p).missing.length).length;
    const s = partners.length ? clamp(100 - pct(incomplete, partners.length) * 0.6) : 100;
    return { score: s, incomplete, total: partners.length };
  })();
  const hr = penalty(["Leave", "Employees", "Attendance"], 5, 7, 10);

  const areas = [
    { key: "finance", label: "Finance", score: fin.score, reasons: [`${fin.mine.length} open · ${fin.overdue} overdue · ${fin.crit} critical`], fix: "Clear pending imprest approvals; keep month-end moving." },
    { key: "operations", label: "Operations", score: ops.score, reasons: [`${ops.mine.length} open · ${ops.overdue} overdue`], fix: "Chase receivings older than 3 days; complete supply sets." },
    { key: "compliance", label: "Compliance", score: comp.score, reasons: [`${comp.mine.length} open · ${comp.crit} critical (expired papers)`], fix: "Renew expired documents first — they carry the biggest penalty." },
    { key: "documentation", label: "Documentation", score: doc.score, reasons: [`${doc.incomplete} of ${doc.total} registrations missing KYC`], fix: "Use 'Send registration email' to request the missing papers." },
    { key: "hr", label: "HR", score: hr.score, reasons: [`${hr.mine.length} open · ${hr.overdue} overdue`], fix: "Decide pending leave before it starts." },
  ];
  const weights = { finance: 0.3, operations: 0.25, compliance: 0.2, documentation: 0.1, hr: 0.15 } as Record<string, number>;
  const overall = clamp(areas.reduce((s, a) => s + a.score * weights[a.key], 0));
  return { overall, areas };
}

/* ------------------------------------------------------------------ */
/* 10 · Anomaly & fraud detection                                      */
/* ------------------------------------------------------------------ */

export interface Anomaly {
  id: string;
  kind: "duplicate_expense" | "duplicate_trip" | "weight_variance" | "unusual_amount" | "repeated_document";
  title: string;
  detail: string;
  confidence: number;
  amount: number | null;
  href: string;
  evidence: string[];
}

export function anomalies(): Anomaly[] {
  const out: Anomaly[] = [];

  // --- Duplicate expenses: same person, same amount, within 3 days.
  const entries = loadImprestEntries().filter((e) => e.kind === "expense" && e.status !== "rejected");
  const people = loadImprestPeople();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.personId !== b.personId || a.amount !== b.amount || a.amount < 200) continue;
      const gap = Math.abs(daysBetween(a.date, b.date));
      if (gap > 3) continue;
      const sameCat = (a.category || "") === (b.category || "");
      const who = people.find((p) => p.id === a.personId)?.name || "Holder";
      out.push({
        id: `dup-exp-${a.id}-${b.id}`, kind: "duplicate_expense",
        title: `Possible duplicate expense — ${who}, ₹${a.amount.toLocaleString("en-IN")}`,
        detail: `Two ${sameCat ? a.category + " " : ""}entries of the same amount ${gap === 0 ? "on the same day" : `${gap} day(s) apart`}.`,
        confidence: clamp(70 + (sameCat ? 15 : 0) + (gap === 0 ? 10 : 0)),
        amount: a.amount, href: "/imprest",
        evidence: [`${a.date}: ${a.description?.slice(0, 50) || "—"}`, `${b.date}: ${b.description?.slice(0, 50) || "—"}`],
      });
    }
  }

  // --- Unusual amounts: > 3× the holder's median expense.
  const byPerson = new Map<string, number[]>();
  for (const e of entries) byPerson.set(e.personId, [...(byPerson.get(e.personId) || []), e.amount]);
  for (const [pid, amounts] of byPerson) {
    if (amounts.length < 5) continue;
    const sorted = [...amounts].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const e of entries.filter((x) => x.personId === pid && x.amount > Math.max(3 * median, 5000))) {
      const who = people.find((p) => p.id === pid)?.name || "Holder";
      out.push({
        id: `big-exp-${e.id}`, kind: "unusual_amount",
        title: `Unusually large expense — ${who}, ₹${e.amount.toLocaleString("en-IN")}`,
        detail: `${Math.round(e.amount / median)}× this holder's usual expense (median ₹${median.toLocaleString("en-IN")}).`,
        confidence: clamp(55 + Math.min(30, (e.amount / median) * 3)), amount: e.amount, href: "/imprest",
        evidence: [`${e.date} · ${e.category} · ${e.description?.slice(0, 60) || "—"}`],
      });
    }
  }

  // --- Duplicate trips: same vehicle + client + entry date.
  const trips = safeTrips();
  const seen = new Map<string, Trip>();
  for (const t of trips) {
    const k = `${t.vehicleNumber}|${t.client}|${t.vehicleEntryDate}`;
    if (!t.vehicleNumber || !t.vehicleEntryDate) continue;
    const prev = seen.get(k);
    if (prev) {
      out.push({
        id: `dup-trip-${prev.id}-${t.id}`, kind: "duplicate_trip",
        title: `Same vehicle, same client, same day — ${t.vehicleNumber} → ${t.client}`,
        detail: "Two trips recorded for one vehicle on one date; one may be a duplicate entry or a genuine double load.",
        confidence: 80, amount: null, href: "/coordination",
        evidence: [`Docs ${prev.ourDocNo || "—"} and ${t.ourDocNo || "—"}`, `Entry date ${t.vehicleEntryDate}`],
      });
    } else seen.set(k, t);
  }

  // --- Weight variance: shortage far beyond tolerance.
  for (const t of trips) {
    try {
      const s = shortageFor(t as any, DEFAULT_SHORTAGE_RULES) as any;
      const dispatched = Number(t.vendorChallanWeight) || Number((t as any).billing?.invoiceWeightKg) || 0;
      const received = Number(t.receivingQty) || 0;
      if (!dispatched || !received) continue;
      const lossPct = ((dispatched - received) / dispatched) * 100;
      if (lossPct >= 5) {
        out.push({
          id: `wt-${t.id}`, kind: "weight_variance",
          title: `Abnormal weight loss ${lossPct.toFixed(1)}% — ${t.vehicleNumber || "vehicle"} (${t.supplier || t.supplierCode || "vendor"} → ${t.client})`,
          detail: `Dispatched ${dispatched.toLocaleString("en-IN")} kg, received ${received.toLocaleString("en-IN")} kg${s?.shortageKg ? `; ${Math.round(s.shortageKg).toLocaleString("en-IN")} kg beyond allowance` : ""}.`,
          confidence: clamp(60 + lossPct * 3), amount: null, href: "/coordination",
          evidence: [`Entry ${t.vehicleEntryDate || "—"}`, `Receiving ${t.receivingDate || "—"}`],
        });
      }
    } catch { /* shape mismatch on old trips */ }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/* ------------------------------------------------------------------ */
/* 22 · Root cause analysis (shortages)                                */
/* ------------------------------------------------------------------ */

export interface RootCause {
  problem: string;
  sample: number;
  findings: string[];
  recommendation: string;
}

export function rootCauses(): RootCause[] {
  const trips = safeTrips();
  const bad = trips.filter((t) => { try { return derivedStatus(t) === "shortage"; } catch { return false; } });
  if (bad.length < 3) return [];
  const conc = (key: (t: Trip) => string) => {
    const m = new Map<string, number>();
    for (const t of bad) { const k = key(t) || "—"; m.set(k, (m.get(k) || 0) + 1); }
    const [top, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return { top, share: pct(n, bad.length) };
  };
  const bySupplier = conc((t) => t.supplier || t.supplierCode);
  const byClient = conc((t) => t.client);
  const byVehicle = conc((t) => t.vehicleNumber);
  const dates = bad.map((t) => t.vehicleEntryDate).filter(Boolean).sort();
  const onset = dates[0];
  const recentShare = pct(bad.filter((t) => t.vehicleEntryDate >= monthsAgo(1)).length, bad.length);

  const findings: string[] = [];
  if (bySupplier.share >= 40) findings.push(`Vendor ${bySupplier.top} appears in ${bySupplier.share}% of shortage trips.`);
  if (byClient.share >= 50) findings.push(`${byClient.share}% of shortages are at ${byClient.top} — check their weighbridge calibration and the +allowance rule.`);
  if (byVehicle.share >= 30) findings.push(`Vehicle ${byVehicle.top} is involved in ${byVehicle.share}% of cases — route pilferage or tare drift.`);
  if (recentShare >= 60) findings.push(`${recentShare}% of shortages happened in the last 30 days — the problem is recent, not chronic.`);
  if (onset) findings.push(`First shortage on record: ${onset}.`);

  const recommendation =
    bySupplier.share >= 40 ? `Weigh ${bySupplier.top}'s next three loads at our own kanta before dispatch and compare.`
    : byClient.share >= 50 ? `Ask ${byClient.top} for their weighbridge calibration certificate; dispute with evidence.`
    : byVehicle.share >= 30 ? `Change the driver/vehicle on the route for two weeks and watch the variance.`
    : "Spread is even — tighten the shortage allowance and review weighing practice at loading.";

  return [{ problem: `Weight shortages beyond tolerance: ${bad.length} of ${trips.length} trips`, sample: bad.length, findings, recommendation }];
}

/* ------------------------------------------------------------------ */
/* 3 · Prediction & risk                                                */
/* ------------------------------------------------------------------ */

export interface Prediction {
  key: string;
  title: string;
  value: string;
  confidence: "low" | "medium" | "high";
  basis: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
}

export function predictions(): Prediction[] {
  const out: Prediction[] = [];

  // Cash need, next 15 days = imprest burn (avg of last 3 months, pro-rated) + payroll (last run) + pending imprest.
  const entries = loadImprestEntries();
  const since = monthsAgo(3);
  const spend = entries.filter((e) => e.kind === "expense" && e.status === "approved" && e.date >= since).reduce((s, e) => s + e.amount, 0);
  const burn15 = (spend / 90) * 15;
  const pending = entries.filter((e) => e.status === "submitted").reduce((s, e) => s + e.amount, 0);
  let payroll = 0, payrollBasis = "no payroll run yet";
  try {
    const runs = loadRuns();
    const last = [...runs].sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")))[0];
    if (last?.payslips?.length) {
      // All plants' runs for that month — payroll is company-wide cash.
      const sameMonth = runs.filter((r) => r.month === last.month);
      payroll = sameMonth.reduce((s, r) => s + r.payslips.reduce((x, p) => x + (Number(p.netPay) || 0), 0), 0);
      payrollBasis = `last run ${last.month}, ${sameMonth.length} plant run(s)`;
    }
  } catch { /* no payroll lib data */ }
  const dueSoon = new Date().getDate() >= 20; // payroll lands at month start
  const cash15 = burn15 + pending + (dueSoon ? payroll : 0);
  out.push({
    key: "cash15", title: "Cash requirement, next 15 days",
    value: `₹${Math.round(cash15).toLocaleString("en-IN")}`,
    confidence: spend > 0 && payroll > 0 ? "medium" : "low",
    basis: `Imprest burn ₹${Math.round(burn15).toLocaleString("en-IN")} (3-month average) + pending approvals ₹${Math.round(pending).toLocaleString("en-IN")}${dueSoon ? ` + payroll ₹${Math.round(payroll).toLocaleString("en-IN")} (${payrollBasis})` : ""}. Vendor payables need Tally.`,
    risk: cash15 > 1500000 ? "HIGH" : cash15 > 500000 ? "MEDIUM" : "LOW",
  });

  // Receiving delay risk per client from trips: avg days entry → receiving.
  const trips = safeTrips().filter((t) => t.vehicleEntryDate && t.receivingDate);
  const byClient = new Map<string, number[]>();
  for (const t of trips) byClient.set(t.client, [...(byClient.get(t.client) || []), daysBetween(t.vehicleEntryDate, t.receivingDate)]);
  for (const [client, ds] of byClient) {
    if (ds.length < 3) continue;
    const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
    const late = pct(ds.filter((d) => d > 3).length, ds.length);
    if (late >= 40) {
      out.push({
        key: `late-${client}`, title: `${client}: receivings arrive late`,
        value: `${late}% of loads take > 3 days (avg ${avg.toFixed(1)} d)`,
        confidence: ds.length >= 10 ? "high" : "medium",
        basis: `${ds.length} trips with both dates on record.`,
        risk: late >= 60 ? "HIGH" : "MEDIUM",
      });
    }
  }

  // Vendor risk: shortage rate per supplier.
  const all = safeTrips();
  const bySup = new Map<string, { n: number; bad: number }>();
  for (const t of all) {
    const k = t.supplier || t.supplierCode; if (!k) continue;
    const cur = bySup.get(k) || { n: 0, bad: 0 }; cur.n += 1;
    try { if (derivedStatus(t) === "shortage") cur.bad += 1; } catch { /* ignore */ }
    bySup.set(k, cur);
  }
  for (const [sup, s] of bySup) {
    if (s.n < 4) continue;
    const rate = pct(s.bad, s.n);
    if (rate >= 25) out.push({
      key: `vendor-${sup}`, title: `Vendor risk: ${sup}`, value: `${rate}% of loads short`,
      confidence: s.n >= 10 ? "high" : "medium", basis: `${s.bad} of ${s.n} trips beyond tolerance.`,
      risk: rate >= 40 ? "HIGH" : "MEDIUM",
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* 33 · Smart expense control                                           */
/* ------------------------------------------------------------------ */

export interface ExpenseFinding { category: string; thisMonth: number; lastMonth: number; changePct: number; note: string }

export function expenseControl(): ExpenseFinding[] {
  const entries = loadImprestEntries().filter((e) => e.kind === "expense" && e.status !== "rejected");
  const cur = ym(today());
  const prev = ym(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString());
  const cats = new Set(entries.map((e) => e.category || "Uncategorised"));
  const out: ExpenseFinding[] = [];
  for (const c of cats) {
    const a = entries.filter((e) => (e.category || "Uncategorised") === c && ym(e.date) === cur).reduce((s, e) => s + e.amount, 0);
    const b = entries.filter((e) => (e.category || "Uncategorised") === c && ym(e.date) === prev).reduce((s, e) => s + e.amount, 0);
    if (!a && !b) continue;
    const change = b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0;
    out.push({
      category: c, thisMonth: a, lastMonth: b, changePct: change,
      note: change >= 15 ? "Rising — check for one-off vs. recurring." : change <= -15 ? "Falling." : "Stable.",
    });
  }
  return out.sort((x, y) => Math.abs(y.changePct) - Math.abs(x.changePct));
}

/* ------------------------------------------------------------------ */
/* 14 · Client & vendor performance score                              */
/* ------------------------------------------------------------------ */

export interface PerformanceScore {
  party: string; role: "client" | "vendor"; score: number; trips: number;
  parts: { label: string; value: string; score: number }[];
}

export function performanceScores(): PerformanceScore[] {
  const trips = safeTrips();
  const out: PerformanceScore[] = [];
  const build = (role: "client" | "vendor", key: (t: Trip) => string) => {
    const groups = new Map<string, Trip[]>();
    for (const t of trips) { const k = key(t); if (k) groups.set(k, [...(groups.get(k) || []), t]); }
    for (const [party, ts] of groups) {
      if (ts.length < 2) continue;
      const short = ts.filter((t) => { try { return derivedStatus(t) === "shortage"; } catch { return false; } }).length;
      const withDates = ts.filter((t) => t.vehicleEntryDate && t.receivingDate);
      const lateN = withDates.filter((t) => daysBetween(t.vehicleEntryDate, t.receivingDate) > 3).length;
      const gapsN = ts.filter((t) => { try { return tripGaps(t).length > 0; } catch { return false; } }).length;
      const deliv = clamp(100 - pct(short, ts.length) * 1.2);
      const timely = withDates.length ? clamp(100 - pct(lateN, withDates.length)) : 70;
      const docs = clamp(100 - pct(gapsN, ts.length));
      const score = clamp(deliv * 0.45 + timely * 0.25 + docs * 0.3);
      out.push({
        party, role, score, trips: ts.length,
        parts: [
          { label: role === "vendor" ? "Weight delivery" : "Weight acceptance", value: `${pct(ts.length - short, ts.length)}% within tolerance`, score: deliv },
          { label: "Receiving timeliness", value: withDates.length ? `${pct(withDates.length - lateN, withDates.length)}% within 3 days` : "no data", score: timely },
          { label: "Document compliance", value: `${pct(ts.length - gapsN, ts.length)}% complete`, score: docs },
        ],
      });
    }
  };
  build("vendor", (t) => t.supplier || t.supplierCode);
  build("client", (t) => t.client);
  return out.sort((a, b) => a.score - b.score);
}

/* ------------------------------------------------------------------ */
/* 15 · What-if simulator                                               */
/* ------------------------------------------------------------------ */

export interface WhatIfInput { transportCostPct?: number; salesPct?: number; collectionDelayDays?: number }
export interface WhatIfResult {
  baseline: { monthlyRevenue: number; monthlyImprest: number; basis: string };
  revenueImpact: number; cashImpact: number; profitImpact: number; risk: "LOW" | "MEDIUM" | "HIGH"; explanation: string[];
}

export function whatIf(input: WhatIfInput): WhatIfResult {
  const trips = safeTrips().filter((t) => (t as any).billing?.taxableAmount && ym(((t as any).billing.invoiceDate || t.ourDocDate)) >= ym(monthsAgo(3)));
  const revenue3 = trips.reduce((s, t) => s + (Number((t as any).billing.taxableAmount) || 0), 0);
  const monthlyRevenue = revenue3 / 3;
  const imprest3 = loadImprestEntries().filter((e) => e.kind === "expense" && e.status === "approved" && e.date >= monthsAgo(3)).reduce((s, e) => s + e.amount, 0);
  const monthlyImprest = imprest3 / 3;
  const transport = monthlyImprest * 0.6; // transport dominates site imprest; stated as an assumption below

  const salesPct = Number(input.salesPct) || 0;
  const transportPct = Number(input.transportCostPct) || 0;
  const delay = Number(input.collectionDelayDays) || 0;

  const revenueImpact = monthlyRevenue * (salesPct / 100);
  const costImpact = transport * (transportPct / 100);
  const profitImpact = revenueImpact - costImpact;
  const cashImpact = profitImpact - (monthlyRevenue / 30) * delay;
  const risk: WhatIfResult["risk"] = cashImpact < -monthlyRevenue * 0.3 ? "HIGH" : cashImpact < -monthlyRevenue * 0.1 ? "MEDIUM" : "LOW";

  return {
    baseline: { monthlyRevenue, monthlyImprest, basis: `${trips.length} invoiced trips + approved imprest, last 3 months` },
    revenueImpact, cashImpact, profitImpact, risk,
    explanation: [
      salesPct ? `Sales ${salesPct > 0 ? "+" : ""}${salesPct}% → revenue ${revenueImpact >= 0 ? "+" : ""}₹${Math.round(revenueImpact).toLocaleString("en-IN")}/month` : "",
      transportPct ? `Transport ${transportPct > 0 ? "+" : ""}${transportPct}% → cost ${costImpact >= 0 ? "+" : ""}₹${Math.round(costImpact).toLocaleString("en-IN")}/month (assumes transport ≈ 60% of site imprest)` : "",
      delay ? `Collections ${delay} days later → ₹${Math.round((monthlyRevenue / 30) * delay).toLocaleString("en-IN")} more working capital tied up` : "",
    ].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* 25 · Productivity + 26 · Resource allocation                         */
/* ------------------------------------------------------------------ */

export interface Workload { name: string; role: string; open: number; overdue: number; doneLast30: number; avgDaysToDone: number | null; load: "light" | "ok" | "heavy" }

export function workloads(): { people: Workload[]; suggestion: string | null } {
  const tasks = loadWork().tasks;
  const t0 = today();
  const by = new Map<string, WorkTask[]>();
  for (const t of tasks) { const k = t.assigneeName || `(unassigned · ${t.ownerRoles[0] || "any"})`; by.set(k, [...(by.get(k) || []), t]); }
  const people: Workload[] = [];
  for (const [name, ts] of by) {
    const open = ts.filter((t) => t.status === "open").length;
    const overdue = ts.filter((t) => t.status === "open" && t.dueOn < t0).length;
    const done = ts.filter((t) => t.status === "done" && t.resolvedAt && daysBetween(t.resolvedAt.slice(0, 10), t0) <= 30);
    const avg = done.length ? done.reduce((s, t) => s + daysBetween(t.createdAt.slice(0, 10), (t.resolvedAt || t0).slice(0, 10)), 0) / done.length : null;
    people.push({ name, role: ts[0].ownerRoles[0] || "", open, overdue, doneLast30: done.length, avgDaysToDone: avg, load: open >= 8 ? "heavy" : open >= 3 ? "ok" : "light" });
  }
  people.sort((a, b) => b.open - a.open);
  const heavy = people.find((p) => p.load === "heavy" && !p.name.startsWith("("));
  const light = people.find((p) => p.load === "light" && !p.name.startsWith("("));
  const suggestion = heavy && light ? `${heavy.name} carries ${heavy.open} open tasks; ${light.name} has ${light.open}. Delegate ${Math.min(3, heavy.open - light.open)} from the Work planner.` : null;
  return { people, suggestion };
}

/* ------------------------------------------------------------------ */
/* One call for the screen and the assistant                            */
/* ------------------------------------------------------------------ */

export function insightsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    health: healthScore(),
    anomalies: anomalies().slice(0, 25),
    rootCauses: rootCauses(),
    predictions: predictions(),
    expenses: expenseControl().slice(0, 12),
    performance: performanceScores().slice(0, 20),
    workloads: workloads(),
    employees: (() => { try { return loadEmployees().filter((e) => e.active).length; } catch { return 0; } })(),
  };
}
