"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2, Sparkles, ArrowRight, Radar, Activity, ShieldCheck, Mail, Download, Search, Server, AlertTriangle, ListChecks, Gavel, RefreshCcw, Eye } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * BIOME COMMAND CENTER — open the app, understand the business in 60
 * seconds. What needs attention (financial / operational / compliance /
 * workforce) as PROBLEM → CONTEXT → IMPACT → ACTION, your day (chief of
 * staff), the health index with trends, the executive briefing, the risk
 * radar and early warnings, data quality, SLA, system health.
 * Executive mode (toggle) hides everything but the essentials.
 */

const RISK: Record<string, string> = { LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-600", HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-500", CRITICAL: "border-rose-600/50 bg-rose-600/15 text-rose-500" };
const PRI: Record<string, string> = { critical: "bg-rose-500", urgent: "bg-orange-500", followup: "bg-amber-400", normal: "bg-sky-400" };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function CommandPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"attention" | "briefing" | "risk" | "quality" | "sla" | "system">("attention");
  const [exec, setExec] = useState(false);
  const [extra, setExtra] = useState<Record<string, any>>({});
  const [q, setQ] = useState(""); const [results, setResults] = useState<any[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/command?view=command", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (["briefing", "risk", "quality", "sla", "system"].includes(tab) && !extra[tab]) fetch(`/api/command?view=${tab}`).then((r) => r.json()).then((j) => setExtra((x) => ({ ...x, [tab]: j }))); }, [tab, extra]);
  useEffect(() => { if (!q.trim()) { setResults(null); return; } const t = setTimeout(async () => { const r = await fetch(`/api/entity?q=${encodeURIComponent(q)}`); const j = await r.json(); setResults(j.results || []); }, 300); return () => clearTimeout(t); }, [q]);

  async function act(body: Record<string, any>) {
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await load();
  }
  async function emailBriefing() {
    const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "email-briefing" }) });
    const j = await r.json().catch(() => ({})); setNote(!r.ok ? j.error || "Failed." : j.failed?.length ? `Briefing emailed to ${j.sent} recipient(s). Not sent — ${j.failed.join(" · ")}` : `Briefing emailed to ${j.sent} recipient(s).`);
  }
  function downloadBriefing() {
    const text = extra.briefing?.text || ""; const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<pre style="font-family:Segoe UI,Arial;font-size:13px;white-space:pre-wrap;padding:32px">${text.replace(/</g, "&lt;")}</pre>`); w.document.close(); w.print();
  }

  if (err) return <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{err}</p>;
  if (!d) return <div className="flex justify-center py-24"><Loader2 size={24} className="bmx-spin text-biome-muted" /></div>;

  const Section = ({ title, tone, items, extraItems }: { title: string; tone: string; items: any[]; extraItems?: { title: string; detail: string; href: string; level?: string }[] }) => (
    <GlassCard className="p-4">
      <p className={`text-[9.5px] font-bold uppercase tracking-[.16em] ${tone}`}>{title} · {items.length + (extraItems?.length || 0)}</p>
      <div className="mt-2 space-y-1.5">
        {items.length === 0 && !extraItems?.length && <p className="text-[11px] text-biome-muted">Nothing needs attention.</p>}
        {items.slice(0, exec ? 3 : 8).map((t: any) => (
          <div key={t.id} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
            <div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${PRI[t.priority]}`} /><p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-biome-text">{t.title}</p>{t.sla && t.sla.state !== "ok" && <span className={`rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold uppercase ${t.sla.state === "ok" ? "" : t.sla.state === "warning" ? RISK.MEDIUM : RISK.HIGH}`}>SLA {t.sla.state}</span>}</div>
            <p className="mt-0.5 text-[10.5px] text-biome-muted"><b>Context:</b> {t.why}</p>
            <p className="text-[10.5px] text-biome-muted"><b>Impact:</b> {t.amount ? `${inr(t.amount)} · ` : ""}{t.dueOn < d.lastRun?.at?.slice(0, 10) ? "overdue" : `due ${t.dueOn}`}{t.escalation ? ` · escalation L${t.escalation}` : ""}</p>
            <p className="text-[10.5px] text-biome-leafBright"><b>Action:</b> {t.nextAction}</p>
            {!exec && <div className="mt-1.5 flex flex-wrap gap-1">
              <Link href={t.href} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">Review</Link>
              <Link href="/decisions" className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">Assign</Link>
              <button onClick={() => act({ action: "done", id: t.id })} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">Approve / Done</button>
              <Link href={`/entity?type=supply&key=${encodeURIComponent(t.title.split(":")[0])}`} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">Investigate</Link>
              <button onClick={() => { const u = window.prompt("Snooze until (YYYY-MM-DD):"); if (u) act({ action: "snooze", id: t.id, until: u }); }} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">Snooze</button>
            </div>}
          </div>
        ))}
        {extraItems?.slice(0, 5).map((x, i) => (
          <Link key={i} href={x.href} className="block rounded-xl border border-amber-500/30 bg-amber-500/[.05] px-3 py-2"><p className="text-[12px] font-semibold text-biome-text">⚠ {x.title}</p><p className="text-[10.5px] text-biome-muted">{x.detail}</p></Link>
        ))}
      </div>
    </GlassCard>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[32px] leading-[1.05] text-biome-text">Command Center<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">{exec ? "Executive mode — only what matters." : "Everything that needs attention, from every module, as problem → context → impact → action."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setExec((v) => !v)} className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-semibold ${exec ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}><Eye size={13} /> Executive mode</button>
          <button onClick={load} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted"><RefreshCcw size={13} /> Refresh</button>
        </div>
      </header>

      {/* Business graph search */}
      {!exec && (
        <div className="relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search anything — BDC/786/MHI/44, a vendor, a vehicle, an employee, a PO…" className="bmx-input w-full rounded-2xl border border-biome-line bg-biome-bg py-3.5 pl-11 pr-4 text-[13px] text-biome-text outline-none" />
          {results && (
            <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-2xl border border-biome-line bg-biome-bgSoft p-1.5 shadow-xl">
              {results.length === 0 && <p className="px-3 py-2 text-[11px] text-biome-muted">No matches.</p>}
              {results.map((r, i) => <Link key={i} href={r.href} className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-biome-leaf/10"><span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase text-biome-muted">{r.type}</span><span className="min-w-0 flex-1 truncate text-[12px] text-biome-text">{r.title}</span><span className="truncate text-[10px] text-biome-muted">{r.detail}</span></Link>)}
            </div>
          )}
        </div>
      )}

      {/* Headline counts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["🔴 Critical business issues", d.counts.critical, "text-rose-500"], ["🟠 Important decisions", d.counts.decisions, "text-orange-500"], ["🟡 Pending follow-ups", d.counts.followups, "text-amber-500"], ["🟢 Completed automatically", d.counts.automated, "text-emerald-500"]].map(([l, v, c]) => (
          <motion.div key={l as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4"><p className="text-[10px] font-bold text-biome-muted">{l as string}</p><p className={`mt-1 font-mono text-[32px] font-semibold leading-none ${c as string}`}>{v as number}</p></motion.div>
        ))}
      </div>

      {/* Chief of staff + health */}
      <div className="grid gap-3 lg:grid-cols-[1.2fr,1fr]">
        <GlassCard className="p-5">
          <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted"><Sparkles size={12} /> Your day · {d.me.name}</p>
          <ul className="mt-2 space-y-1">{d.chief.lines.length === 0 && <li className="text-[12px] text-biome-muted">Nothing is waiting on you. Rare — enjoy it.</li>}{d.chief.lines.map((l: string, i: number) => <li key={i} className="text-[12.5px] text-biome-text">• {l}</li>)}</ul>
          {d.chief.doNow.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{d.chief.doNow.slice(0, 4).map((t: any) => <Link key={t.id} href={t.href} className="rounded-full border border-biome-leaf/30 bg-biome-leaf/[.08] px-3 py-1.5 text-[10.5px] font-semibold text-biome-leafBright">{t.title.slice(0, 48)} →</Link>)}</div>}
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center justify-between"><p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted"><Activity size={12} /> Business health index</p><p className={`font-mono text-[34px] font-semibold leading-none ${d.health.overall >= 80 ? "text-emerald-500" : d.health.overall >= 60 ? "text-amber-500" : "text-rose-500"}`}>{d.health.overall}<span className="text-[12px] text-biome-muted">/100</span></p></div>
          <div className="mt-2 grid grid-cols-5 gap-1">{d.health.areas.map((a: any) => <div key={a.key} className="text-center"><p className="font-mono text-[15px] font-semibold text-biome-text">{a.score}</p><p className="text-[8.5px] uppercase tracking-[.08em] text-biome-muted">{a.label}</p></div>)}</div>
          <p className="mt-2 text-[10.5px] text-biome-muted">This week {d.health.trend.thisWeek} · last week {d.health.trend.lastWeek ?? "—"} · last month {d.health.trend.lastMonth ?? "—"}</p>
          {(d.health.improving.length > 0 || d.health.declining.length > 0) && <p className="mt-1 text-[10.5px]"><span className="text-emerald-500">{d.health.improving.join(" · ")}</span> <span className="text-rose-500">{d.health.declining.join(" · ")}</span></p>}
          {d.health.areas.filter((a: any) => a.score < 80).slice(0, 2).map((a: any) => <p key={a.key} className="mt-1 text-[10.5px] text-biome-leafBright">→ {a.label}: {a.fix}</p>)}
        </GlassCard>
      </div>

      {/* Tabs */}
      {!exec && (
        <div className="flex flex-wrap gap-1.5">
          {([["attention", "Needs attention", <ListChecks size={12} key="1" />], ["briefing", "Morning briefing", <Mail size={12} key="2" />], ["risk", "Risk radar & warnings", <Radar size={12} key="3" />], ["quality", "Data quality & audit", <ShieldCheck size={12} key="4" />], ["sla", "SLA & bottlenecks", <AlertTriangle size={12} key="5" />], ["system", "System health", <Server size={12} key="6" />]] as const).map(([id, l, icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`bmx-chip flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-semibold ${tab === id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}>{icon} {l}</button>
          ))}
          <Link href="/decisions" className="bmx-chip ml-auto flex items-center gap-1.5 rounded-full border border-biome-leaf/40 bg-biome-leaf/[.08] px-3.5 py-2 text-[11px] font-bold text-biome-leafBright"><Gavel size={12} /> Decision Room · {d.decisions.length} <ArrowRight size={11} /></Link>
        </div>
      )}

      {(exec || tab === "attention") && (
        <div className="grid gap-3 md:grid-cols-2">
          <Section title="Financial attention" tone="text-rose-500" items={d.financial.tasks} extraItems={[...d.financial.anomalies.map((a: any) => ({ title: a.title, detail: `${a.detail} · confidence ${a.confidence}%`, href: a.href })), ...d.financial.poAlerts.map((a: any) => ({ title: a.title, detail: a.action, href: a.href }))]} />
          <Section title="Operational attention" tone="text-orange-500" items={d.operational.tasks} extraItems={d.operational.anomalies.map((a: any) => ({ title: a.title, detail: `${a.detail} · confidence ${a.confidence}%`, href: a.href }))} />
          <Section title="Compliance attention" tone="text-amber-500" items={d.compliance.tasks} extraItems={d.compliance.data.map((x: any) => ({ title: x.problem, detail: `${x.fix} · confidence ${x.confidence}%`, href: x.href }))} />
          <Section title="Workforce attention" tone="text-sky-500" items={d.workforce.tasks} extraItems={d.workforce.workloads.suggestion ? [{ title: "Workload imbalance", detail: d.workforce.workloads.suggestion, href: "/work?tab=mine" }] : []} />
        </div>
      )}

      {!exec && tab === "attention" && d.feed.length > 0 && (
        <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Proactive insights</p>
          <div className="mt-2 grid gap-1.5 md:grid-cols-2">{d.feed.map((f: any, i: number) => <div key={i} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2"><p className={`text-[11.5px] font-semibold ${f.tone === "good" ? "text-emerald-500" : f.tone === "bad" ? "text-rose-500" : "text-biome-text"}`}>{f.text}</p><p className="text-[10px] text-biome-muted">{f.evidence} · {f.impact} · {f.action}</p></div>)}</div></GlassCard>
      )}

      {exec && d.decisions.length > 0 && (
        <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Decisions required</p>
          <ul className="mt-2 space-y-1">{d.decisions.slice(0, 5).map((x: any, i: number) => <li key={x.task.id} className="flex items-center gap-2 text-[12px] text-biome-text"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${RISK[x.risk]}`}>{x.risk}</span>{i + 1}. {x.task.title} <span className="text-biome-muted">— {x.recommendation}</span></li>)}</ul>
          <Link href="/decisions" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-biome-leafBright">Open Decision Room <ArrowRight size={12} /></Link></GlassCard>
      )}

      {!exec && tab === "briefing" && (
        <GlassCard className="p-5">
          {!extra.briefing ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : (<>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Executive morning briefing · under 60 seconds</p><div className="flex gap-1.5"><button onClick={downloadBriefing} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted"><Download size={11} /> PDF / print</button><button onClick={emailBriefing} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted"><Mail size={11} /> Email to management</button></div></div>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-biome-text">{extra.briefing.text}</pre>
            {note && <p className="mt-2 text-[11px] text-biome-leafBright">{note}</p>}
          </>)}
        </GlassCard>
      )}

      {!exec && tab === "risk" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-1.5"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Risk radar</p>
            {!extra.risk ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : extra.risk.radar.length === 0 ? <GlassCard className="p-5"><p className="text-[11px] text-biome-muted">No entities yet.</p></GlassCard> : extra.risk.radar.slice(0, 20).map((r: any) => (
              <Link key={r.type + r.key} href={`/entity?type=${r.type === "transporter" ? "vendor" : r.type}&key=${encodeURIComponent(r.name)}`} className="bmx-card block rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-2.5">
                <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-biome-text">{r.name}</p><span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] uppercase text-biome-muted">{r.type}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${RISK[r.overall]}`}>{r.overall}</span></div>
                <p className="mt-0.5 text-[10.5px] text-biome-muted">{r.parts.map((p: any) => `${p.label.split(" ")[0]}: ${p.level}`).join(" · ")}</p>
                <p className="text-[10.5px] text-biome-text">Why: {r.why}</p>
              </Link>))}
          </div>
          <div className="space-y-1.5"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Early warnings</p>
            {extra.risk && extra.risk.warnings.length === 0 && <GlassCard className="p-5"><p className="text-[11px] text-biome-muted">No trends to warn about.</p></GlassCard>}
            {extra.risk?.warnings.map((w: any, i: number) => <div key={i} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3"><div className="flex items-center justify-between"><p className="text-[12.5px] font-semibold text-biome-text">⚠ {w.title}</p><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${RISK[w.predicted]}`}>{w.predicted}</span></div><p className="mt-0.5 text-[10.5px] text-biome-muted"><b>Current:</b> {w.current} · <b>Trend:</b> {w.trend}</p><p className="text-[10.5px] text-biome-leafBright">→ {w.action}</p></div>)}
          </div>
        </div>
      )}

      {!exec && tab === "quality" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-1.5"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Data quality guardian</p>
            {!extra.quality ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : extra.quality.data.length === 0 ? <GlassCard className="p-5"><p className="text-[11px] text-biome-muted">No data problems found.</p></GlassCard> : extra.quality.data.map((x: any, i: number) => <Link key={i} href={x.href} className="bmx-card block rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-2.5"><p className="text-[12px] font-semibold text-biome-text">⚠ {x.problem}</p><p className="text-[10.5px] text-biome-muted">Records: {x.records.join(", ")} · Fix: {x.fix} · confidence {x.confidence}%</p></Link>)}
          </div>
          <div className="space-y-1.5"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Audit intelligence · {extra.quality?.audit.eventsThisWeek ?? "—"} events this week</p>
            {extra.quality && extra.quality.audit.findings.length === 0 && <GlassCard className="p-5"><p className="text-[11px] text-biome-muted">Nothing unusual in the audit trail.</p></GlassCard>}
            {extra.quality?.audit.findings.map((f: any, i: number) => <Link key={i} href={f.href} className="bmx-card block rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-2.5"><p className="text-[12px] font-semibold text-biome-text">{f.title}</p><p className="text-[10.5px] text-biome-muted">{f.detail}</p></Link>)}
          </div>
        </div>
      )}

      {!exec && tab === "sla" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">SLA analytics</p>
            {!extra.sla ? <Loader2 size={18} className="bmx-spin mt-2 text-biome-muted" /> : <table className="mt-2 w-full text-left text-[11px]"><thead><tr className="text-[9px] uppercase tracking-[.1em] text-biome-muted"><th className="py-1">Process</th><th>SLA</th><th>Open</th><th>Breached</th><th>Within SLA</th></tr></thead><tbody>{extra.sla.analytics.map((r: any) => <tr key={r.kind} className="border-t border-biome-line/60 text-biome-text"><td className="py-1.5">{r.label}</td><td className="font-mono">{r.hours}h</td><td className="font-mono">{r.open}</td><td className={`font-mono ${r.openBreached ? "text-rose-500" : ""}`}>{r.openBreached}</td><td className="font-mono">{r.withinSlaPct === null ? "—" : `${r.withinSlaPct}%`}</td></tr>)}</tbody></table>}
            <p className="mt-2 text-[10px] text-biome-muted">Warning at 75% of the SLA, breach at 100%, escalation after the configured hours (Settings-level edit via API).</p>
          </GlassCard>
          <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Process bottlenecks</p>
            {extra.sla && <ul className="mt-2 space-y-1 text-[11.5px] text-biome-text">{Object.entries(extra.sla.bottlenecks.steps).map(([k, v]: any) => <li key={k} className="flex justify-between"><span>{k}</span><span className="font-mono text-biome-muted">{v ? `avg ${v.avg}d · max ${v.max}d · n=${v.n}` : "no data"}</span></li>)}<li className="mt-2 text-amber-600">Waiting for receiving: {extra.sla.bottlenecks.waitingForReceiving} · waiting for documents: {extra.sla.bottlenecks.waitingForDocuments}</li><li className="text-biome-leafBright">Longest delay: {extra.sla.bottlenecks.longestDelay}</li></ul>}
          </GlassCard>
        </div>
      )}

      {!exec && tab === "system" && extra.system && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(extra.system).map(([k, v]: any) => (
            <div key={k} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4"><div className="flex items-center justify-between"><p className="text-[12px] font-bold uppercase tracking-[.1em] text-biome-text">{k.replace(/([A-Z])/g, " $1")}</p><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${["healthy", "completed"].includes(v.status) ? RISK.LOW : v.status === "warning" || v.status === "check" ? RISK.MEDIUM : RISK.HIGH}`}>{v.status}</span></div><p className="mt-1 text-[10.5px] text-biome-muted">{Object.entries(v).filter(([kk]) => !["status", "guidance"].includes(kk)).map(([kk, vv]) => `${kk}: ${vv ?? "—"}`).join(" · ")}</p><p className="mt-1 text-[10.5px] text-biome-leafBright">{v.guidance}</p></div>
          ))}
        </div>
      )}
    </div>
  );
}
