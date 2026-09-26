"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Gavel, Loader2, Check, X, Undo2, UserPlus, MessageCircleQuestion, ArrowRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * DECISION ROOM — only decisions that need a human. Each card: context,
 * financial and operational impact, risk, evidence, AI recommendation,
 * and the actions: Approve · Reject · Send back · Assign review ·
 * Request more information. Every action is audited.
 */
const RISK: Record<string, string> = { LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-600", HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-500" };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function DecisionsPage() {
  const [d, setD] = useState<any>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await fetch("/api/work", { cache: "no-store" }); setD(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: string) {
    await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id, decision, note: note[id] || "" }) });
    await load();
  }
  async function assign(id: string) {
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delegates", id }) });
    const j = await r.json(); const list = j.delegates || [];
    const pick = window.prompt(`Assign review to (type a number):\n${list.map((u: any, i: number) => `${i + 1}. ${u.name} (${u.role})`).join("\n")}`);
    const who = list[Number(pick) - 1]; if (!who) return;
    await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign", id, assigneeId: who.id }) });
    await load();
  }

  if (!d) return <div className="flex justify-center py-24"><Loader2 size={24} className="bmx-spin text-biome-muted" /></div>;
  const list: any[] = d.decisions || [];
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
        <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Decision Room<span className="text-biome-leafBright">.</span></h1>
        <p className="mt-2 text-[12px] text-biome-muted">Only what needs a human. The AI prepares the decision; you make it. Nothing sensitive is ever approved silently.</p>
      </header>
      {list.length === 0 && <GlassCard className="p-10 text-center"><Gavel size={26} className="mx-auto text-emerald-500" /><p className="mt-2 text-[13px] font-bold text-biome-text">No decisions waiting</p></GlassCard>}
      <div className="space-y-2">
        {list.map(({ task: t, risk, overdueDays, recommendation }: any, i: number) => (
          <div key={t.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-[14px] font-bold text-biome-text">{i + 1}. {t.title}</p><p className="mt-0.5 text-[10.5px] text-biome-muted">{t.module}{overdueDays ? ` · ${overdueDays} day(s) overdue` : ""}{t.assigneeName ? ` · reviewer ${t.assigneeName}` : ""}</p></div>
              <span className={`rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[.1em] ${RISK[risk]}`}>Risk {risk}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              {[["Context", t.why], ["Financial impact", t.amount ? inr(t.amount) : "No direct amount"], ["Operational impact", t.nextAction], ["Supporting evidence", t.evidence.join(" · ") || "—"]].map(([l, v]) => <div key={l}><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l}</p><p className="mt-1 text-[11.5px] leading-relaxed text-biome-text">{v}</p></div>)}
            </div>
            <div className="mt-3 rounded-xl border border-biome-leaf/30 bg-biome-leaf/[.06] px-3 py-2"><p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-leafBright">AI recommendation</p><p className="mt-0.5 text-[12px] font-semibold text-biome-text">{recommendation}</p><p className="mt-0.5 text-[10px] text-biome-muted">Based on the task's own evidence and its overdue state; confidence reflects data on record, not certainty.</p></div>
            <input value={note[t.id] || ""} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} placeholder="Note (goes into the audit trail)" className="bmx-input mt-3 w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link href={t.href} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Open {t.module} <ArrowRight size={11} /></Link>
              <button onClick={() => decide(t.id, "approve")} className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white"><Check size={12} /> Approve</button>
              <button onClick={() => decide(t.id, "reject")} className="bmx-chip flex items-center gap-1 rounded-xl border border-rose-500/40 px-3 py-2 text-[11px] font-semibold text-rose-500"><X size={12} /> Reject</button>
              <button onClick={() => decide(t.id, "send_back")} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><Undo2 size={12} /> Send back</button>
              <button onClick={() => assign(t.id)} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><UserPlus size={12} /> Assign review</button>
              <button onClick={() => decide(t.id, "request_info")} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><MessageCircleQuestion size={12} /> Request more information</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
