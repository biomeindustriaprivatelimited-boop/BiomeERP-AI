"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity, ShieldAlert, Search, TrendingUp, Wallet, Award, FlaskConical, Users, Loader2, ArrowRight, RefreshCcw,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * INSIGHTS — the intelligence screen (Phase 2 of the Business OS).
 * Health score · anomalies · root cause · predictions · expense control
 * · performance scores · what-if · workloads. Every number shows what it
 * was counted from; predictions carry a confidence and a basis.
 */

function inr(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")}`; }
const RISK = { LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-600", HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-500" };
const scoreTone = (s: number) => (s >= 80 ? "text-emerald-500" : s >= 60 ? "text-amber-500" : "text-rose-500");

export default function InsightsPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"health" | "anomalies" | "predict" | "expenses" | "performance" | "whatif" | "people" | "cashflow" | "payments">("health");
  const [cf, setCf] = useState<any>(null); const [pp, setPp] = useState<any>(null);
  useEffect(() => { if (tab === "cashflow" && !cf) fetch("/api/insights?view=cashflow").then((r) => r.json()).then(setCf); if (tab === "payments" && !pp) fetch("/api/insights?view=payments").then((r) => r.json()).then(setPp); }, [tab, cf, pp]);
  const [wi, setWi] = useState({ transportCostPct: 10, salesPct: -15, collectionDelayDays: 20 });
  const [wiRes, setWiRes] = useState<any>(null);
  const [wiBusy, setWiBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/insights", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setD(json); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function simulate() {
    setWiBusy(true);
    try {
      const res = await fetch("/api/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wi) });
      const json = await res.json().catch(() => ({}));
      setWiRes(json.result || null);
    } finally { setWiBusy(false); }
  }

  const tabs = [
    ["health", "Health score", <Activity size={12} key="1" />],
    ["anomalies", `Anomalies${d?.anomalies?.length ? ` · ${d.anomalies.length}` : ""}`, <ShieldAlert size={12} key="2" />],
    ["predict", "Predictions & root cause", <TrendingUp size={12} key="3" />],
    ["expenses", "Expense control", <Wallet size={12} key="4" />],
    ["performance", "Performance scores", <Award size={12} key="5" />],
    ["whatif", "What-if", <FlaskConical size={12} key="6" />],
    ["people", "Workloads", <Users size={12} key="7" />],
    ["cashflow", "Cash flow 7/15/30/60", <Wallet size={12} key="8" />],
    ["payments", "Payment priority", <Award size={12} key="9" />],
  ] as const;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Insights<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-biome-muted">
            Computed from the app&rsquo;s own data — trips, imprest, registrations, payroll, open work. Every finding names what it counted; nothing is estimated from thin air.
          </p>
        </div>
        <button onClick={load} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted"><RefreshCcw size={13} /> Recompute</button>
      </header>

      {err && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{err}</p>}
      {!d && !err && <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>}

      {d && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map(([id, label, icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`bmx-chip flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-semibold ${tab === id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                {icon} {label}
              </button>
            ))}
          </div>

          {/* ---- HEALTH ---- */}
          {tab === "health" && (
            <div className="grid gap-3 lg:grid-cols-[1fr,1.4fr]">
              <GlassCard className="p-6 text-center">
                <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Business health</p>
                <motion.p initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`mt-2 font-mono text-[64px] font-semibold leading-none ${scoreTone(d.health.overall)}`}>{d.health.overall}</motion.p>
                <p className="text-[11px] text-biome-muted">out of 100</p>
                <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-biome-line"><div className="h-full rounded-full bg-biome-leaf transition-all duration-700" style={{ width: `${d.health.overall}%` }} /></div>
              </GlassCard>
              <div className="space-y-2">
                {d.health.areas.map((a: any, i: number) => (
                  <motion.div key={a.key} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
                    <div className="flex items-center gap-3">
                      <p className={`w-12 font-mono text-[22px] font-semibold ${scoreTone(a.score)}`}>{a.score}</p>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-biome-text">{a.label}</p>
                        <p className="text-[10.5px] text-biome-muted">{a.reasons.join(" · ")}</p>
                        {a.score < 80 && <p className="mt-0.5 text-[10.5px] text-biome-leafBright">→ {a.fix}</p>}
                      </div>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-biome-line"><div className={`h-full rounded-full ${a.score >= 80 ? "bg-emerald-500" : a.score >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${a.score}%` }} /></div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ---- ANOMALIES ---- */}
          {tab === "anomalies" && (
            <div className="space-y-2">
              {d.anomalies.length === 0 && <GlassCard className="p-8 text-center"><p className="text-[12.5px] font-bold text-biome-text">No anomalies found</p><p className="mt-1 text-[11px] text-biome-muted">Duplicates, unusual amounts, double trips and abnormal weight loss are all checked.</p></GlassCard>}
              {d.anomalies.map((a: any) => (
                <div key={a.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-[12.5px] font-semibold text-biome-text">⚠ {a.title}</p><p className="mt-0.5 text-[11px] text-biome-muted">{a.detail}</p></div>
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[9.5px] font-bold text-amber-600">Confidence {a.confidence}%</span>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">{a.evidence.map((e: string, i: number) => <li key={i} className="text-[10.5px] text-biome-muted">· {e}</li>)}</ul>
                  <Link href={a.href} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-biome-leafBright">Investigate <ArrowRight size={12} /></Link>
                </div>
              ))}
            </div>
          )}

          {/* ---- PREDICTIONS + ROOT CAUSE ---- */}
          {tab === "predict" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Predictions</p>
                {d.predictions.map((p: any) => (
                  <div key={p.key} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="text-[12px] font-semibold text-biome-text">{p.title}</p><p className="mt-0.5 font-mono text-[18px] font-semibold text-biome-text">{p.value}</p></div>
                      <span className={`rounded-full border px-2.5 py-1 text-[9.5px] font-bold ${RISK[p.risk as keyof typeof RISK]}`}>{p.risk}</span>
                    </div>
                    <p className="mt-1.5 text-[10.5px] text-biome-muted">Basis: {p.basis}</p>
                    <p className="text-[10px] uppercase tracking-[.1em] text-biome-muted">confidence {p.confidence}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Root cause analysis</p>
                {d.rootCauses.length === 0 && <GlassCard className="p-6"><p className="text-[11.5px] text-biome-muted">Needs at least 3 shortage trips to find a pattern. Nothing repeating yet.</p></GlassCard>}
                {d.rootCauses.map((r: any, i: number) => (
                  <GlassCard key={i} className="p-4">
                    <p className="text-[12.5px] font-semibold text-biome-text">Problem: {r.problem}</p>
                    <ul className="mt-2 space-y-1">{r.findings.map((f: string, j: number) => <li key={j} className="text-[11px] text-biome-text">• {f}</li>)}</ul>
                    <p className="mt-2 rounded-xl border border-biome-leaf/30 bg-biome-leaf/[.08] px-3 py-2 text-[11px] font-semibold text-biome-leafBright">Recommendation: {r.recommendation}</p>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* ---- EXPENSES ---- */}
          {tab === "expenses" && (
            <GlassCard className="p-4">
              <table className="w-full text-left">
                <thead><tr className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted"><th className="py-2">Category</th><th>This month</th><th>Last month</th><th>Change</th><th>Note</th></tr></thead>
                <tbody>
                  {d.expenses.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[11px] text-biome-muted">No imprest expenses in the last two months.</td></tr>}
                  {d.expenses.map((e: any) => (
                    <tr key={e.category} className="border-t border-biome-line/60 text-[11.5px] text-biome-text">
                      <td className="py-2 font-semibold">{e.category}</td><td className="font-mono">{inr(e.thisMonth)}</td><td className="font-mono">{inr(e.lastMonth)}</td>
                      <td className={`font-mono font-semibold ${e.changePct >= 15 ? "text-rose-500" : e.changePct <= -15 ? "text-emerald-500" : "text-biome-muted"}`}>{e.changePct > 0 ? "+" : ""}{e.changePct}%</td>
                      <td className="text-[10.5px] text-biome-muted">{e.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          )}

          {/* ---- PERFORMANCE ---- */}
          {tab === "performance" && (
            <div className="grid gap-2 md:grid-cols-2">
              {d.performance.length === 0 && <GlassCard className="p-6 md:col-span-2"><p className="text-[11.5px] text-biome-muted">Scores appear once a party has 2+ trips on record.</p></GlassCard>}
              {d.performance.map((p: any) => (
                <div key={p.role + p.party} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                  <div className="flex items-center justify-between"><div><p className="text-[12.5px] font-semibold text-biome-text">{p.party}</p><p className="text-[10px] uppercase tracking-[.1em] text-biome-muted">{p.role} · {p.trips} trips</p></div><p className={`font-mono text-[26px] font-semibold ${scoreTone(p.score)}`}>{p.score}<span className="text-[11px] text-biome-muted">/100</span></p></div>
                  <ul className="mt-2 space-y-1">{p.parts.map((x: any) => <li key={x.label} className="flex justify-between text-[10.5px]"><span className="text-biome-muted">{x.label}</span><span className="text-biome-text">{x.value}</span></li>)}</ul>
                </div>
              ))}
            </div>
          )}

          {/* ---- WHAT-IF ---- */}
          {tab === "whatif" && (
            <div className="grid gap-3 lg:grid-cols-[1fr,1.2fr]">
              <GlassCard className="p-5">
                <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Scenario</p>
                {([["transportCostPct", "Transport cost change %"], ["salesPct", "Sales change %"], ["collectionDelayDays", "Collection delay (days)"]] as const).map(([k, label]) => (
                  <label key={k} className="mt-3 block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</span>
                    <input type="number" value={(wi as any)[k]} onChange={(e) => setWi({ ...wi, [k]: Number(e.target.value) })} className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 font-mono text-[12px] text-biome-text outline-none" /></label>
                ))}
                <button onClick={simulate} disabled={wiBusy} className="bmx-btn mt-4 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">{wiBusy ? <Loader2 size={13} className="bmx-spin" /> : <FlaskConical size={13} />} Simulate</button>
              </GlassCard>
              <GlassCard className="p-5">
                {!wiRes ? <p className="text-[11.5px] text-biome-muted">Set a scenario and simulate. Baseline comes from the last 3 months of invoiced trips and approved imprest.</p> : (
                  <>
                    <div className="flex items-center justify-between"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Impact per month</p><span className={`rounded-full border px-2.5 py-1 text-[9.5px] font-bold ${RISK[wiRes.risk as keyof typeof RISK]}`}>Risk {wiRes.risk}</span></div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {[["Revenue", wiRes.revenueImpact], ["Profit", wiRes.profitImpact], ["Cash", wiRes.cashImpact]].map(([l, v]) => (
                        <div key={l as string} className="rounded-xl border border-biome-line bg-biome-bg p-3"><p className="text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">{l as string}</p><p className={`mt-1 font-mono text-[15px] font-semibold ${(v as number) < 0 ? "text-rose-500" : "text-emerald-500"}`}>{(v as number) >= 0 ? "+" : ""}{inr(v as number)}</p></div>
                      ))}
                    </div>
                    <ul className="mt-3 space-y-1">{wiRes.explanation.map((x: string, i: number) => <li key={i} className="text-[11px] text-biome-text">• {x}</li>)}</ul>
                    <p className="mt-2 text-[10px] text-biome-muted">Baseline: revenue {inr(wiRes.baseline.monthlyRevenue)}/mo · imprest {inr(wiRes.baseline.monthlyImprest)}/mo ({wiRes.baseline.basis})</p>
                  </>
                )}
              </GlassCard>
            </div>
          )}

          {tab === "cashflow" && (!cf ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{cf.horizons.map((h: any) => <div key={h.days} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{h.days} days</p><p className={`mt-1 font-mono text-[22px] font-semibold ${h.net < 0 ? "text-rose-500" : "text-emerald-500"}`}>{h.net >= 0 ? "+" : ""}{inr(h.net)}</p><p className="text-[10px] text-biome-muted">in {inr(h.expectedIn)} · out {inr(h.expectedOut)} (imprest {inr(h.imprest)})</p>{h.shortage > 0 && <p className="text-[10.5px] font-semibold text-rose-500">Potential shortage {inr(h.shortage)}</p>}</div>)}</div>
              <GlassCard className="p-4"><p className="text-[12px] font-semibold text-biome-leafBright">AI recommendation: {cf.recommendation}</p><p className="mt-1 text-[10.5px] text-biome-muted">Basis: {cf.basis} Items marked "estimate" are projections; "actual" are recorded commitments.</p></GlassCard>
              <div className="grid gap-3 md:grid-cols-2">{[["Expected inflows · 60d", cf.horizons[3].inflows], ["Expected outflows · 60d", cf.horizons[3].outflows]].map(([l, list]) => <GlassCard key={l as string} className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l as string}</p><ul className="mt-1 space-y-0.5">{(list as any[]).length === 0 && <li className="text-[11px] text-biome-muted">None on record.</li>}{(list as any[]).map((x, i) => <li key={i} className="flex justify-between text-[11px] text-biome-text"><span>{x.on} · {x.who} <span className="text-biome-muted">({x.kind})</span></span><span className="font-mono">{inr(x.amount)}</span></li>)}</ul></GlassCard>)}</div>
            </div>))}
          {tab === "payments" && (!pp ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : (
            <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Payment priority</p>{pp.list.length === 0 && <p className="mt-2 text-[11px] text-biome-muted">No vendor dues on record.</p>}<ol className="mt-2 space-y-1.5">{pp.list.map((v: any, i: number) => <li key={v.vendor} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2"><div className="flex items-center gap-2"><span className="text-[12px] font-semibold text-biome-text">{i + 1}. {v.vendor}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${v.priority === "CRITICAL" || v.priority === "HIGH" ? RISK.HIGH : v.priority === "MEDIUM" ? RISK.MEDIUM : RISK.LOW}`}>{v.priority}</span><span className="ml-auto font-mono text-[11.5px] text-biome-text">{inr(v.due)}</span></div><p className="text-[10.5px] text-biome-muted">Why: {v.reasons.join(" · ")}</p></li>)}</ol><p className="mt-2 text-[10px] text-biome-muted">{pp.basis}</p></GlassCard>))}

          {/* ---- WORKLOADS ---- */}
          {tab === "people" && (
            <GlassCard className="p-4">
              {d.workloads.suggestion && <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/[.06] px-3 py-2 text-[11px] text-amber-600">⚠ {d.workloads.suggestion}</p>}
              <table className="w-full text-left">
                <thead><tr className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted"><th className="py-2">Person</th><th>Open</th><th>Overdue</th><th>Done · 30d</th><th>Avg days</th><th>Load</th></tr></thead>
                <tbody>
                  {d.workloads.people.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[11px] text-biome-muted">No tasks yet.</td></tr>}
                  {d.workloads.people.map((p: any) => (
                    <tr key={p.name} className="border-t border-biome-line/60 text-[11.5px] text-biome-text">
                      <td className="py-2">{p.name} <span className="text-[9.5px] text-biome-muted">{p.role}</span></td><td className="font-mono">{p.open}</td><td className={`font-mono ${p.overdue ? "text-rose-500" : ""}`}>{p.overdue}</td><td className="font-mono">{p.doneLast30}</td><td className="font-mono">{p.avgDaysToDone === null ? "—" : p.avgDaysToDone.toFixed(1)}</td>
                      <td><span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${p.load === "heavy" ? RISK.HIGH : p.load === "ok" ? RISK.MEDIUM : RISK.LOW}`}>{p.load}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-biome-muted">Not surveillance — this shows where work is blocked and who has room, nothing else.</p>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}
