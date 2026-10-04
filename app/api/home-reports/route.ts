import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import type { Permission } from "@/lib/permissions";
import { visibleDatasets, runDataset, type ReportContext } from "@/lib/reportCatalog";
import { loadEmployees, loadRuns, isApprovedEmployee } from "@/lib/payroll";
import { plantOptions } from "@/lib/plants";
import { matchAll } from "@/lib/plantMatch";
import { withFlags } from "@/lib/matchFlags";

/**
 * Home page report cards — a summary of every report the signed-in person
 * may read, in one request.
 *
 * Module figures go through lib/reportCatalog.ts (`runDataset`), which
 * applies the same access rules as each module's own screen, so a card can
 * never show more than the person could open there. Only totals and the
 * top few groups come back — never the rows — so the home page stays fast.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "money" | "kg" | "count" | "pct" | "text";
interface Metric { label: string; value: number | string; kind: Kind; tone?: "good" | "warn" | "bad" }
interface Row { label: string; value: number; kind: Kind; sub?: string }
export interface HomeReportCard {
  id: string;
  title: string;
  module: string;
  href: string;
  reportHref?: string;
  metrics: Metric[];
  tableTitle?: string;
  rows?: Row[];
  series?: { label: string; value: number }[];
  seriesKind?: Kind;
  empty: boolean;
  note?: string;
}

/** Indian financial year start (1 April) for today. */
function fyStart(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}
const monthStart = () => new Date().toISOString().slice(0, 8) + "01";
const today = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const has = (p: Permission) => perms.includes(p);
  const ctx: ReportContext = { userId: user.id, userName: user.name, role: user.role, perms, plant: auth.session.plant || null };
  const datasets = has("reports") ? new Set(visibleDatasets(ctx).map((d) => d.id)) : new Set<string>();
  const run = (dataset: string, extra: Record<string, unknown> = {}) => {
    try { return datasets.has(dataset) ? runDataset(ctx, { dataset, ...extra } as any) : null; } catch { return null; }
  };
  const top = (groups: any[] | undefined, key: string, kind: Kind, n = 5): Row[] =>
    (groups || []).filter((g) => g.key !== "—").slice(0, n).map((g) => ({ label: g.key, value: key === "__count" ? g.count : g.sums[key] || 0, kind, sub: `${g.count} ${g.count === 1 ? "entry" : "entries"}` }));
  const months = (groups: any[] | undefined, key: string) =>
    (groups || []).filter((g) => /^\d{4}-\d{2}$/.test(g.key)).slice(-6).map((g) => ({ label: g.key, value: key === "__count" ? g.count : g.sums[key] || 0 }));
  const countOf = (groups: any[] | undefined, match: (k: string) => boolean) => (groups || []).filter((g) => match(String(g.key))).reduce((t, g) => t + g.count, 0);

  const cards: HomeReportCard[] = [];
  const from = fyStart();

  /* ---- Supply & dispatch (coordination register) ---- */
  for (const [id, title] of [["coordination_mfg", "Supply — manufacturing"], ["coordination_trading", "Supply — trading"]] as const) {
    const byClient = run(id, { from, groupBy: "client" });
    if (!byClient) continue;
    const byMonth = run(id, { from, groupBy: "__month" });
    const t = byClient.totals;
    cards.push({
      id, title, module: "Supply", href: "/coordination", reportHref: `/report-builder?dataset=${id}`,
      metrics: [
        { label: "Trips (this FY)", value: byClient.count, kind: "count" },
        { label: "Dispatched", value: t.dispatchedKg || 0, kind: "kg" },
        { label: "Short", value: t.shortKg || 0, kind: "kg", tone: (t.shortKg || 0) > 0 ? "warn" : "good" },
        { label: "Invoiced", value: t.invoiceAmount || 0, kind: "money" },
      ],
      tableTitle: "Top clients by dispatch",
      rows: top(byClient.groups, "dispatchedKg", "kg"),
      series: months(byMonth?.groups, "dispatchedKg"), seriesKind: "kg",
      empty: byClient.count === 0,
    });
  }

  /* ---- Plant dispatch sheet ---- */
  const transport = run("transport", { from, groupBy: "plantName" });
  if (transport) {
    const byMonth = run("transport", { from, groupBy: "__month" });
    cards.push({
      id: "transport", title: "Plant dispatch & freight", module: "Plant", href: "/transport", reportHref: "/report-builder?dataset=transport",
      metrics: [
        { label: "Vehicles out (FY)", value: transport.count, kind: "count" },
        { label: "Dispatch weight", value: transport.totals.weight || 0, kind: "kg" },
        { label: "Freight", value: transport.totals.amount || 0, kind: "money" },
      ],
      tableTitle: "By plant", rows: top(transport.groups, "weight", "kg"),
      series: months(byMonth?.groups, "weight"), seriesKind: "kg",
      empty: transport.count === 0,
    });
  }

  /* ---- Biomass purchase ---- */
  const biomass = run("biomass", { from, groupBy: "plantName" });
  if (biomass) {
    const byVendor = run("biomass", { from, groupBy: "vendor" });
    cards.push({
      id: "biomass", title: "Biomass purchase", module: "Plant", href: "/plants", reportHref: "/report-builder?dataset=biomass",
      metrics: [
        { label: "Slips (FY)", value: biomass.count, kind: "count" },
        { label: "Payable weight", value: biomass.totals.payableWeight || 0, kind: "kg" },
        { label: "Purchase value", value: biomass.totals.amount || 0, kind: "money" },
      ],
      tableTitle: "Top vendors / farmers", rows: top(byVendor?.groups, "amount", "money"),
      series: (biomass.groups || []).map((g: any) => ({ label: g.key, value: g.sums.amount || 0 })), seriesKind: "money",
      empty: biomass.count === 0,
    });
  }

  /* ---- PO consumption ---- */
  const po = run("po", { groupBy: "party" });
  if (po) {
    const byStatus = run("po", { groupBy: "status" });
    const used = po.totals.totalKg ? (po.totals.consumedKg / po.totals.totalKg) * 100 : 0;
    cards.push({
      id: "po", title: "Purchase orders", module: "Supply", href: "/po", reportHref: "/report-builder?dataset=po",
      metrics: [
        { label: "POs", value: po.count, kind: "count" },
        { label: "Consumed", value: po.totals.consumedKg || 0, kind: "kg" },
        { label: "Balance", value: po.totals.remainingKg || 0, kind: "kg" },
        { label: "Used", value: Math.round(used * 10) / 10, kind: "pct", tone: used > 90 ? "warn" : undefined },
      ],
      tableTitle: "Balance by party", rows: top(po.groups, "remainingKg", "kg"),
      series: (byStatus?.groups || []).map((g: any) => ({ label: g.key, value: g.count })), seriesKind: "count",
      empty: po.count === 0,
    });
  }

  /* ---- Plant stock ---- */
  const stock = run("stock_onhand", { groupBy: "plantName" });
  if (stock) {
    const byStatus = run("stock_onhand", { groupBy: "status" });
    const low = countOf(byStatus?.groups, (k) => k.startsWith("Low"));
    const out = countOf(byStatus?.groups, (k) => k === "Out");
    cards.push({
      id: "stock", title: "Plant stock (spares & stores)", module: "Plant", href: "/stock", reportHref: "/report-builder?dataset=stock_onhand",
      metrics: [
        { label: "Items", value: stock.count, kind: "count" },
        { label: "Stock value", value: stock.totals.value || 0, kind: "money" },
        { label: "Low — reorder", value: low, kind: "count", tone: low ? "warn" : "good" },
        { label: "Out of stock", value: out, kind: "count", tone: out ? "bad" : "good" },
      ],
      tableTitle: "Value by plant", rows: top(stock.groups, "value", "money"),
      empty: stock.count === 0,
    });
  }

  /* ---- Imprest & budgets ---- */
  const imprest = run("imprest", { from, groupBy: "holder" });
  if (imprest) {
    const byStatus = run("imprest", { from, groupBy: "status" });
    const month = run("imprest", { from: monthStart(), to: today() });
    const budget = run("imprest_budget", { from: monthStart(), to: today(), groupBy: "state" });
    const waiting = countOf(byStatus?.groups, (k) => /waiting|over budget/i.test(k));
    const metrics: Metric[] = [
      { label: "Spent this month", value: month?.totals.expense || 0, kind: "money" },
      { label: "Spent this FY", value: imprest.totals.expense || 0, kind: "money" },
      { label: "Waiting approval", value: waiting, kind: "count", tone: waiting ? "warn" : "good" },
    ];
    if (budget && budget.count) {
      const over = countOf(budget.groups, (k) => /over/i.test(k));
      metrics.push({ label: "Budgets over", value: over, kind: "count", tone: over ? "bad" : "good" });
    }
    const byMonth = run("imprest", { from, groupBy: "__month" });
    cards.push({
      id: "imprest", title: "Imprest & budgets", module: "Finance", href: "/imprest", reportHref: "/report-builder?dataset=imprest",
      metrics,
      tableTitle: "Expense by holder (FY)", rows: top(imprest.groups, "expense", "money"),
      series: months(byMonth?.groups, "expense"), seriesKind: "money",
      empty: imprest.count === 0 && !(budget && budget.count),
    });
  }

  /* ---- People: payroll, employees, leave ---- */
  if (has("payroll") || has("employee.view")) {
    const staff = loadEmployees().filter((e) => e.active && isApprovedEmployee(e));
    const pendingJoin = loadEmployees({ includeRequests: true }).filter((e) => e.approval?.status === "pending_approval").length;
    const byPlant = new Map<string, number>();
    for (const e of staff) byPlant.set(e.plant || "—", (byPlant.get(e.plant || "—") || 0) + 1);
    const plantName = (code: string) => plantOptions().find((p) => p.code === code)?.label || code;
    const metrics: Metric[] = [{ label: "Active employees", value: staff.length, kind: "count" }];
    let series: { label: string; value: number }[] = [];
    let note: string | undefined;
    if (has("payroll")) {
      const runs = loadRuns();
      const latestMonth = runs.map((r) => r.month).sort().pop();
      if (latestMonth) {
        const ofMonth = runs.filter((r) => r.month === latestMonth);
        const net = ofMonth.reduce((t, r) => t + (r.payslips || []).reduce((s, p) => s + (p.netPay || 0), 0), 0);
        metrics.push({ label: `Net pay ${latestMonth}`, value: Math.round(net), kind: "money" });
        note = `Payroll ${latestMonth}: ${ofMonth.map((r) => `${plantName(r.plant)} ${r.status}`).join(" · ")}`;
      }
      const monthsSeen = Array.from(new Set(runs.map((r) => r.month))).sort().slice(-6);
      series = monthsSeen.map((m) => ({ label: m, value: Math.round(runs.filter((r) => r.month === m).reduce((t, r) => t + (r.payslips || []).reduce((s, p) => s + (p.netPay || 0), 0), 0)) }));
    }
    const leave = run("leave", { groupBy: "status" });
    const pendingLeave = countOf(leave?.groups, (k) => k === "pending");
    if (leave) metrics.push({ label: "Leave pending", value: pendingLeave, kind: "count", tone: pendingLeave ? "warn" : "good" });
    if (pendingJoin) metrics.push({ label: "Joining approvals", value: pendingJoin, kind: "count", tone: "warn" });
    cards.push({
      id: "people", title: "People, payroll & leave", module: "People", href: has("payroll") ? "/payroll" : "/employees",
      reportHref: leave ? "/report-builder?dataset=leave" : undefined,
      metrics,
      tableTitle: "Employees by plant",
      rows: Array.from(byPlant.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: plantName(k), value: v, kind: "count" as Kind })),
      series, seriesKind: "money", note,
      empty: staff.length === 0 && series.length === 0,
    });
  }

  /* ---- Plant ↔ register mismatches ---- */
  if (has("reco")) {
    try {
      const plants = plantOptions();
      const pairs = withFlags(matchAll(plants.map((p) => p.code))).filter((p) => p.status !== "matched");
      const byPlant = new Map<string, number>();
      for (const p of pairs) byPlant.set(p.plant, (byPlant.get(p.plant) || 0) + 1);
      const flagged = pairs.filter((p) => p.flagged).length;
      cards.push({
        id: "mismatches", title: "Dispatch mismatches", module: "Documents", href: "/mismatches",
        metrics: [
          { label: "Open", value: pairs.length, kind: "count", tone: pairs.length ? "warn" : "good" },
          { label: "Red flags", value: flagged, kind: "count", tone: flagged ? "bad" : "good" },
          { label: "Explained", value: pairs.filter((p) => p.explained).length, kind: "count" },
        ],
        tableTitle: "Open by plant",
        rows: Array.from(byPlant.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: plants.find((p) => p.code === k)?.label || k, value: v, kind: "count" as Kind })),
        empty: false,
        note: pairs.length ? undefined : "Plant sheets and the coordination register agree.",
      });
    } catch { /* plant sheets unreadable — skip the card */ }
  }

  /* ---- Vendor & client registration ---- */
  const registry = run("registry", { groupBy: "kind" });
  if (registry) {
    const byStatus = run("registry", { groupBy: "status" });
    cards.push({
      id: "registry", title: "Vendor & client registration", module: "Partners", href: "/partners", reportHref: "/report-builder?dataset=registry",
      metrics: [
        { label: "Registered", value: registry.count, kind: "count" },
        ...(byStatus?.groups || []).slice(0, 3).map((g: any) => ({ label: g.key, value: g.count, kind: "count" as Kind })),
      ],
      tableTitle: "By type", rows: top(registry.groups, "__count", "count"),
      empty: registry.count === 0,
    });
  }

  return NextResponse.json({ cards, fyFrom: from, generatedAt: new Date().toISOString() });
}
