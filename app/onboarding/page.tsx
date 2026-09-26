"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Loader2, CheckCircle2, Circle, BookOpen, HelpCircle, ArrowRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/** ONBOARDING & TRAINING — role-specific track: learn (SOP), practice (quiz), do (real action). Completion tracked per person. */
export default function OnboardingPage() {
  const [d, setD] = useState<any>(null); const [picked, setPicked] = useState<Record<string, number>>({}); const [feedback, setFeedback] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await fetch("/api/onboarding", { cache: "no-store" }); setD(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  async function complete(stepId: string, answer?: number) { const r = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepId, answer }) }); const j = await r.json(); if (j.correct === false) setFeedback({ ...feedback, [stepId]: "Not quite — read the SOP above and try again." }); else setFeedback({ ...feedback, [stepId]: "" }); await load(); }
  if (!d) return <div className="flex justify-center py-24"><Loader2 size={24} className="bmx-spin text-biome-muted" /></div>;
  const done = new Set<string>(d.progress.done); const pct = Math.round((done.size / d.track.steps.length) * 100);
  return (
    <div className="space-y-5">
      <header><p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p><h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">{d.track.title}<span className="text-biome-leafBright">.</span></h1><p className="mt-2 text-[12px] text-biome-muted">Learn the process, prove it, then do it for real. {pct}% complete.</p></header>
      <div className="h-2 overflow-hidden rounded-full bg-biome-line"><div className="h-full rounded-full bg-biome-leaf transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="space-y-2">{d.track.steps.map((s: any, i: number) => { const isDone = done.has(s.id); const sop = s.sopId ? d.sops[s.sopId] : null; return (
        <GlassCard key={s.id} className="p-4"><div className="flex items-start gap-3">{isDone ? <CheckCircle2 size={18} className="mt-0.5 text-emerald-500" /> : <Circle size={18} className="mt-0.5 text-biome-muted" />}<div className="min-w-0 flex-1"><p className="text-[12.5px] font-semibold text-biome-text">{i + 1}. {s.title} <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] uppercase text-biome-muted">{s.kind}</span></p>
          {s.kind === "learn" && sop && <><ol className="mt-2 space-y-0.5 text-[11px] text-biome-text">{sop.steps.map((x: string, j: number) => <li key={j}>{j + 1}. {x}</li>)}</ol><p className="mt-1 text-[10px] text-biome-muted"><BookOpen size={10} className="mr-1 inline" />{sop.who} · {sop.where}</p>{!isDone && <button onClick={() => complete(s.id)} className="bmx-btn mt-2 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white">I've read this</button>}</>}
          {s.kind === "practice" && <><div className="mt-2 space-y-1">{s.options.map((o: string, j: number) => <label key={j} className="flex items-center gap-2 text-[11.5px] text-biome-text"><input type="radio" name={s.id} checked={picked[s.id] === j} onChange={() => setPicked({ ...picked, [s.id]: j })} disabled={isDone} />{o}</label>)}</div>{!isDone && <button disabled={picked[s.id] === undefined} onClick={() => complete(s.id, picked[s.id])} className="bmx-btn mt-2 flex items-center gap-1 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-50"><HelpCircle size={12} /> Check answer</button>}{feedback[s.id] && <p className="mt-1 text-[10.5px] text-rose-500">{feedback[s.id]}</p>}</>}
          {s.kind === "do" && <><p className="mt-1 text-[11px] text-biome-muted">{s.action}</p><div className="mt-2 flex gap-1.5"><Link href={s.href} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Open <ArrowRight size={11} /></Link>{!isDone && <button onClick={() => complete(s.id)} className="bmx-btn rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white">Done it</button>}</div></>}
        </div></div></GlassCard>); })}</div>
      {d.summary.length > 0 && <GlassCard className="p-4"><p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted"><GraduationCap size={12} /> Team completion</p><ul className="mt-2 space-y-0.5 text-[11px] text-biome-text">{d.summary.map((s: any) => <li key={s.userId} className="flex justify-between"><span>{s.userId} · {s.role}</span><span className="font-mono text-biome-muted">{s.done}/{s.total}</span></li>)}</ul></GlassCard>}
    </div>);
}
