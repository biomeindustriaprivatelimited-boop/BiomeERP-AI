"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, ArrowRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * 360° ENTITY PROFILE + INVESTIGATION WORKSPACE + SUPPLY LIFECYCLE.
 * One screen for a vendor, client, vehicle, employee or supply reference:
 * overview, risk (why), performance, POs, supplies with their lifecycle
 * and bottleneck, open tasks, issues, and the unified activity timeline
 * (human / AI / automation / communication).
 */
const RISK: Record<string, string> = { LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-600", HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-500", CRITICAL: "border-rose-600/50 bg-rose-600/15 text-rose-500" };
const KIND: Record<string, string> = { human: "text-sky-500", ai: "text-violet-500", automation: "text-emerald-500", communication: "text-amber-500" };

export default function EntityPage() {
  const [type, setType] = useState("vendor"); const [key, setKey] = useState("");
  const [d, setD] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const p = new URLSearchParams(window.location.search); setType(p.get("type") || "vendor"); setKey(p.get("key") || ""); }, []);
  useEffect(() => { if (!key) { setD(null); return; } setBusy(true); fetch(`/api/entity?type=${type}&key=${encodeURIComponent(key)}`).then((r) => r.json()).then(setD).finally(() => setBusy(false)); }, [type, key]);
  const mt = (kg: number) => `${(kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} MT`;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS · 360°</p>
        <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">{key || "Entity"}<span className="text-biome-leafBright">.</span></h1>
        <p className="mt-2 text-[12px] text-biome-muted">Everything connected to one {type} — without opening five modules.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none">{["vendor", "client", "vehicle", "employee", "supply"].map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <div className="relative flex-1"><Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-biome-muted" /><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Name, code, vehicle number or BDC reference" className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg py-2.5 pl-10 pr-3 text-[12px] text-biome-text outline-none" /></div>
      </div>
      {busy && <Loader2 size={20} className="bmx-spin text-biome-muted" />}
      {d && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Overview</p>
              {d.partner ? <><p className="mt-1 text-[12.5px] font-semibold text-biome-text">{d.partner.name} <span className="text-[10px] text-biome-muted">{d.partner.code}</span></p><p className="text-[10.5px] text-biome-muted">{d.partner.kind} · {d.partner.category || ""} · {d.partner.status} · GSTIN {d.partner.gstin || "—"} · plants {d.partner.plants?.join(", ") || "all"}</p><p className="mt-1 text-[10.5px] text-biome-muted">Documents: {d.partner.documents?.length || 0} on file · {d.partner.gaps.missing.length} missing · {d.partner.gaps.expired.length} expired</p><Link href="/partners" className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-biome-leafBright">Registration <ArrowRight size={11} /></Link></> : <p className="mt-1 text-[11px] text-biome-muted">{d.supplies.length} supplies on record · {d.tasks.length} open tasks · {d.issues.length} issues</p>}
            </GlassCard>
            <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Risk</p>
              {d.risk ? <><span className={`mt-1 inline-block rounded-full border px-2.5 py-1 text-[10px] font-bold ${RISK[d.risk.overall]}`}>Overall {d.risk.overall}</span><ul className="mt-2 space-y-0.5">{d.risk.parts.map((p: any) => <li key={p.label} className="text-[10.5px] text-biome-text"><span className={`mr-1 rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold ${RISK[p.level]}`}>{p.level}</span>{p.label} — <span className="text-biome-muted">{p.why}</span></li>)}</ul></> : <p className="mt-1 text-[11px] text-biome-muted">Not scored (no registration / trips).</p>}
            </GlassCard>
            <GlassCard className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Performance & POs</p>
              {d.performance ? <p className="mt-1 text-[12.5px] font-semibold text-biome-text">Score {d.performance.score}/100 <span className="text-[10px] text-biome-muted">over {d.performance.trips} trips</span></p> : <p className="mt-1 text-[11px] text-biome-muted">No performance score yet.</p>}
              {d.pos.map((p: any) => <p key={p.id} className="mt-1 text-[10.5px] text-biome-text">PO {p.poNumber}: {p.utilisationPct}% used · {mt(p.remainingKg)} left · <span className="uppercase text-biome-muted">{p.effectiveStatus}</span></p>)}
              {d.financial.pendingTasksAmount > 0 && <p className="mt-1 text-[10.5px] text-amber-600">₹{Math.round(d.financial.pendingTasksAmount).toLocaleString("en-IN")} in pending approvals</p>}
            </GlassCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.3fr,1fr]">
            <div className="space-y-2">
              <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Supplies · lifecycle</p>
              {d.supplies.length === 0 && <GlassCard className="p-5"><p className="text-[11px] text-biome-muted">No supplies linked.</p></GlassCard>}
              {d.supplies.slice(0, 12).map((s: any) => (
                <div key={s.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-[12px] font-semibold text-biome-text">{s.ourDocNo || "—"} · {s.vehicle}</p><span className="text-[10px] text-biome-muted">{s.supplier} → {s.client} · {s.entry}</span><span className="ml-auto text-[10px] font-semibold text-amber-600">{s.lifecycle.bottleneck}</span></div>
                  <div className="mt-2 flex flex-wrap gap-1">{s.lifecycle.stages.map((st: any) => <span key={st.key} title={st.note || st.when} className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${st.done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-biome-line text-biome-muted"}`}>{st.done ? "✓" : "○"} {st.label}</span>)}</div>
                </div>
              ))}
              {d.tasks.length > 0 && <><p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Pending actions</p>{d.tasks.map((t: any) => <Link key={t.id} href={t.href} className="block rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2 text-[11.5px] text-biome-text">• {t.title} <span className="text-biome-muted">— {t.nextAction}</span></Link>)}</>}
              {d.issues.length > 0 && <><p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Related issues</p>{d.issues.map((i: any) => <Link key={i.id} href="/issues" className="block rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2 text-[11.5px] text-biome-text">• {i.title} <span className="text-biome-muted">— {i.status}</span></Link>)}</>}
            </div>
            <div><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Activity timeline</p>
              <div className="mt-2 space-y-1">{d.timeline.length === 0 && <p className="text-[11px] text-biome-muted">No activity recorded.</p>}{d.timeline.map((e: any, i: number) => <div key={i} className="flex gap-2 text-[10.5px]"><span className="w-28 shrink-0 text-biome-muted">{new Date(e.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span><span className={`w-20 shrink-0 font-bold uppercase ${KIND[e.kind] || "text-biome-muted"}`}>{e.kind}</span><span className="text-biome-text">{e.what} <span className="text-biome-muted">· {e.by}</span></span></div>)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
