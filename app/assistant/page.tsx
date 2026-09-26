"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Sparkles, Database, MessageSquareText, ShieldCheck, Send, Loader2, Trash2 } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { getTallySettings } from "@/lib/preferences";

interface Msg { role: "user" | "assistant"; content: string; trace?: any[]; error?: boolean; }
const QUICK = [
  "August mein total sales aur purchase kitni hai?",
  "Kaunse supplies mein receiving missing hai?",
  "Top 10 vendor outstanding dikhao.",
  "Jhajjar Power ki pending documents batao.",
  "Tally mein debtors aur creditors ka running balance dikhao.",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setInput(""); setBusy(true);
    try {
      const t = getTallySettings();
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, history, tally: { host: t.host, port: t.port, company: t.companyName } }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      setMessages(prev => [...prev, { role: "assistant", content: json.reply || "No answer returned.", trace: json.trace || [] }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: e?.message || "Assistant request failed.", error: true }]);
    } finally { setBusy(false); }
  }, [busy, messages]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <div className="rounded-3xl border border-biome-line bg-gradient-to-br from-biome-leaf/12 via-transparent to-violet-500/10 p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-biome-leaf to-biome-leafBright shadow-lg"><Bot size={24} className="text-biome-text" /></div>
          <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-biome-leafBright">BIOME Intelligence</p><h1 className="mt-1 font-display text-2xl font-bold text-biome-text">Business AI Assistant</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-biome-muted">Ask about finance, supplies, WhatsApp documents, ledgers, vendors, clients and reconciliation. Answers are grounded in the application&apos;s connected data sources.</p></div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <GlassCard className="p-4"><Database size={17} className="text-biome-leafBright"/><p className="mt-2 text-xs font-semibold text-biome-text">Finance intelligence</p><p className="mt-1 text-[11px] text-biome-muted">Sales, purchase, cash, bank, debtors and creditors.</p></GlassCard>
        <GlassCard className="p-4"><MessageSquareText size={17} className="text-biome-skyBright"/><p className="mt-2 text-xs font-semibold text-biome-text">Operations intelligence</p><p className="mt-1 text-[11px] text-biome-muted">Supply sets, receiving, missing documents and WhatsApp status.</p></GlassCard>
        <GlassCard className="p-4"><ShieldCheck size={17} className="text-biome-bolt"/><p className="mt-2 text-xs font-semibold text-biome-text">Traceable answers</p><p className="mt-1 text-[11px] text-biome-muted">The assistant reports when a live source is unavailable instead of inventing figures.</p></GlassCard>
      </div>

      <GlassCard className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-biome-line px-4 py-3"><div className="flex items-center gap-2"><Sparkles size={15} className="text-biome-leafBright"/><span className="text-xs font-semibold text-biome-text">Live conversation</span></div>{messages.length > 0 && <button onClick={() => setMessages([])} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-biome-muted hover:text-biome-text"><Trash2 size={12}/> Clear</button>}</div>
        <div className="min-h-[360px] max-h-[560px] space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && <div className="grid gap-2 sm:grid-cols-2">{QUICK.map(q => <button key={q} onClick={() => send(q)} className="rounded-xl border border-biome-line p-3 text-left text-[11.5px] text-biome-muted hover:border-biome-leaf/40 hover:text-biome-text">{q}</button>)}</div>}
          {messages.map((m,i) => <div key={i} className={m.role === "user" ? "flex justify-end" : ""}><div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed ${m.role === "user" ? "bg-biome-leaf/12 text-biome-text" : m.error ? "border border-rose-400/30 bg-rose-400/5 text-rose-300" : "border border-biome-line bg-biome-hover text-biome-text"}`}>{m.content.split("\n").map((x,j)=><p key={j} className={j ? "mt-1.5" : ""}>{x}</p>)}{m.trace?.length ? <p className="mt-2 text-[9.5px] text-biome-muted">Sources checked: {m.trace.map((t:any)=>t.tool).join(", ")}</p> : null}</div></div>)}
          {busy && <div className="flex items-center gap-2 text-[11px] text-biome-muted"><Loader2 size={13} className="animate-spin text-biome-leafBright"/> Reading live data…</div>}
          <div ref={endRef}/>
        </div>
        <div className="border-t border-biome-line p-3"><div className="flex items-end gap-2"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input)}}} rows={2} placeholder="Ask about your business…" className="min-h-[46px] flex-1 resize-none rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5 text-[12px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"/><PremiumButton onClick={()=>send(input)} disabled={busy||!input.trim()}><Send size={13}/> Ask</PremiumButton></div></div>
      </GlassCard>
    </div>
  );
}
