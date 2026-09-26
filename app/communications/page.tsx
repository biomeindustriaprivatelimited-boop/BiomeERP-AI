"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Search, Loader2, Mail, ListChecks, AlertTriangle, Users, FileText, Copy, Cpu } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * COMMUNICATION CENTER — search a vendor, transporter, client or employee
 * and see everything the company has exchanged with them across
 * channels, plus what is pending and a ready-to-paste reply.
 * Sources: outbound mail log, audit trail, Work tasks, issues, meetings,
 * registration documents received. WhatsApp document arrivals appear
 * through the filed supply sets they belong to.
 */

const ICON: Record<string, React.ReactNode> = { email: <Mail size={12} />, "task-open": <ListChecks size={12} />, task: <ListChecks size={12} />, issue: <AlertTriangle size={12} />, meeting: <Users size={12} />, document: <FileText size={12} />, system: <Cpu size={12} /> };
const TONE: Record<string, string> = { email: "text-sky-500", "task-open": "text-amber-500", task: "text-emerald-500", issue: "text-rose-500", meeting: "text-violet-500", document: "text-biome-leafBright", system: "text-biome-muted" };

export default function CommunicationsPage() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await fetch(`/api/timeline?q=${encodeURIComponent(q)}`, { cache: "no-store" }); setData(await r.json()); } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const items = (data?.items || []).filter((i: any) => filter === "all" || i.channel === filter || (filter === "task" && i.channel.startsWith("task")));
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
        <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Communications<span className="text-biome-leafBright">.</span></h1>
        <p className="mt-2 text-[12px] text-biome-muted">One timeline per party — emails sent, tasks, issues, meetings, documents received — and what still needs a reply.</p>
      </header>

      <div className="relative">
        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-biome-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, transporter, client, employee, email…" className="bmx-input w-full rounded-2xl border border-biome-line bg-biome-bg py-3.5 pl-11 pr-4 text-[13px] text-biome-text outline-none" />
        {busy && <Loader2 size={14} className="bmx-spin absolute right-4 top-1/2 -translate-y-1/2 text-biome-muted" />}
      </div>

      {!q && data && (
        <GlassCard className="p-5">
          <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Directory</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{data.parties.slice(0, 60).map((p: any) => <button key={p.type + p.name} onClick={() => setQ(p.name)} className="bmx-chip rounded-full border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text">{p.name} <span className="text-[9px] opacity-60">{p.type}</span></button>)}</div>
        </GlassCard>
      )}

      {q && data && (
        <div className="grid gap-3 lg:grid-cols-[1.3fr,1fr]">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">{["all", "email", "task", "issue", "meeting", "document", "system"].map((f) => <button key={f} onClick={() => setFilter(f)} className={`bmx-chip rounded-full border px-3 py-1.5 text-[10.5px] font-semibold ${filter === f ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}>{f}</button>)}</div>
            <div className="space-y-1.5">
              {items.length === 0 && <GlassCard className="p-6"><p className="text-[11.5px] text-biome-muted">No communication on record for "{q}".</p></GlassCard>}
              {items.map((i: any, idx: number) => (
                <Link key={idx} href={i.href} className="bmx-card flex items-start gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-2.5">
                  <span className={`mt-0.5 ${TONE[i.channel] || "text-biome-muted"}`}>{ICON[i.channel] || <MessageSquare size={12} />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-biome-text">{i.title}</span><span className="block truncate text-[10.5px] text-biome-muted">{i.detail}</span></span>
                  <span className="shrink-0 text-[9.5px] text-biome-muted">{new Date(i.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Pending replies · follow-ups</p>
            {data.pending.length === 0 && <GlassCard className="p-5"><p className="text-[11.5px] text-biome-muted">Nothing pending with this party.</p></GlassCard>}
            {data.pending.map((p: any, i: number) => (
              <GlassCard key={i} className="p-4">
                <p className="text-[12px] font-semibold text-biome-text">{p.title}</p>
                <p className="mt-0.5 text-[10.5px] text-biome-muted">Due {p.dueOn}{p.followupStep ? ` · cadence step ${p.followupStep}` : ""} · {p.nextAction}</p>
                <div className="mt-2 rounded-xl border border-biome-leaf/30 bg-biome-leaf/[.06] px-3 py-2">
                  <p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-leafBright">Suggested reply</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-biome-text">{p.suggestion}</p>
                  <button onClick={() => navigator.clipboard?.writeText(p.suggestion)} className="mt-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-biome-leafBright"><Copy size={11} /> Copy — paste into WhatsApp or email</button>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
