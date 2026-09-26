"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ManualClassify from "@/components/whatsapp/ManualClassify";
import { AlertTriangle, CheckCircle2, FileSearch, RefreshCw, Loader2 } from "lucide-react";
import GlassCard from "@/components/GlassCard";

interface Doc { id: string; originalName?: string; bucket?: string; extracted?: { documentType?: string; confidence?: number; clientName?: string; vehicleNo?: string }; aiMessage?: string; }

export default function ReviewQueuePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Doc | null>(null);
  async function load() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/whatsapp/documents", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load review queue");
      setDocs((j.documents || []).filter((d: Doc) => d.bucket === "unmatched" || d.bucket === "_Staged"));
    } catch (e: any) { setError(e?.message || "Review queue unavailable"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  return <div className="mx-auto max-w-6xl space-y-5 pb-10">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 font-display text-xl font-semibold text-biome-text"><FileSearch size={20} className="text-biome-bolt" /> Review Queue</h1><p className="mt-1 text-xs text-biome-muted">Low-confidence or unmatched WhatsApp documents wait here instead of being silently filed.</p></div>
      <button onClick={load} disabled={loading} className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-biome-muted">{loading ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Refresh</button>
    </div>
    {error && <GlassCard className="border-red-400/25 p-4 text-xs text-red-300"><AlertTriangle size={14} className="mr-2 inline"/>{error}</GlassCard>}
    {!loading && !docs.length && <GlassCard className="flex flex-col items-center justify-center p-12 text-center"><CheckCircle2 size={28} className="text-biome-leafBright"/><p className="mt-3 text-sm font-medium text-biome-text">Review queue is clear</p><p className="mt-1 text-xs text-biome-muted">No unmatched documents are waiting for manual verification.</p></GlassCard>}
    <div className="space-y-2">{docs.map(d => <GlassCard key={d.id} className="flex flex-wrap items-center gap-3 p-4"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-biome-bolt/10 text-biome-bolt"><AlertTriangle size={16}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-biome-text">{d.originalName || d.id}</p><p className="mt-0.5 text-[10.5px] text-biome-muted">{d.extracted?.documentType || "Unclassified"} · {d.extracted?.clientName || "Client unknown"} · {d.extracted?.vehicleNo || "Vehicle unknown"}</p></div><span className="rounded-full border border-biome-bolt/25 px-2 py-1 text-[10px] text-biome-bolt">{d.extracted?.confidence ?? 0}% confidence</span><button onClick={() => setActive(d)} className="rounded-lg bg-biome-leaf/15 px-3 py-1.5 text-[11px] font-medium text-biome-leafBright hover:bg-biome-leaf/25">Review & File</button><Link href="/whatsapp" className="rounded-lg border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted hover:text-biome-text">Open WhatsApp</Link></GlassCard>)}</div>
    {active && <ManualClassify doc={active as any} onClose={() => setActive(null)} onSaved={() => { setActive(null); load(); }} />}
  </div>;
}
