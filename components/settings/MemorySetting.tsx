"use client";
import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Trash2, Pin, Plus } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/** BUSINESS MEMORY — what the AI is allowed to remember: decisions, patterns, preferences, investigations. Reviewable, editable, deletable; retention applied automatically. */
export default function MemorySetting() {
  const [d, setD] = useState<any>(null); const [text, setText] = useState(""); const [kind, setKind] = useState("note");
  const load = useCallback(async () => { const r = await fetch("/api/memory", { cache: "no-store" }); if (r.ok) setD(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  async function post(body: any) { await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await load(); }
  if (!d) return null;
  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2"><Brain size={16} className="text-biome-leafBright" /><h2 className="font-display text-sm font-medium text-biome-text">Business memory</h2><span className="text-[9.5px] text-biome-muted">{d.items.length} items · retention {d.retentionDays} days (pinned items stay)</span></div>
      <p className="mb-3 text-[11px] leading-relaxed text-biome-muted">Decisions made in the Decision Room are remembered automatically; add patterns or preferences here. The assistant reads these through <code>get_business_memory</code>, respecting roles. Nothing sensitive should be stored.</p>
      <div className="flex gap-1.5"><select value={kind} onChange={(e) => setKind(e.target.value)} className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-2 py-2 text-[11px] text-biome-text outline-none">{["note", "decision", "pattern", "preference", "investigation"].map((k) => <option key={k}>{k}</option>)}</select><input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Prefer weighing ABC Traders' loads at our kanta before dispatch" className="bmx-input flex-1 rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none" /><button onClick={async () => { await post({ action: "add", kind, text }); setText(""); }} disabled={!text} className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"><Plus size={12} /> Remember</button></div>
      <ul className="mt-3 space-y-1">{d.items.map((m: any) => <li key={m.id} className="flex items-start gap-2 rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11px] text-biome-text"><span className="rounded-full border border-biome-line px-2 py-0.5 text-[8.5px] font-bold uppercase text-biome-muted">{m.kind}</span><span className="min-w-0 flex-1">{m.text}<span className="block text-[9.5px] text-biome-muted">{m.source} · {m.createdBy} · {m.createdAt.slice(0, 10)} · until {m.pinned ? "pinned" : m.expiresAt}</span></span><button onClick={() => post({ action: "edit", id: m.id, pinned: !m.pinned })} title="Pin" className={m.pinned ? "text-biome-leafBright" : "text-biome-muted"}><Pin size={12} /></button><button onClick={() => post({ action: "delete", id: m.id })} className="text-rose-500"><Trash2 size={12} /></button></li>)}</ul>
    </GlassCard>);
}
