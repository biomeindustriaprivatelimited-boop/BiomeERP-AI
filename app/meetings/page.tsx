"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Square, Loader2, Sparkles, CheckCircle2, ListChecks, Trash2, Save } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { getLoadedAssistantModelId, loadAssistantEngine, DEFAULT_ASSISTANT_MODEL, isWebGpuSupported } from "@/lib/aiAssistant";

/**
 * MEETING ASSISTANT.
 *
 * Record: the browser's own speech recognition transcribes live (free,
 * Chrome/Edge, en-IN). Or paste minutes / a transcript from anywhere.
 * Extract: the free local model (if loaded) writes the summary,
 * decisions and action items; otherwise the deterministic extractor
 * does — every meeting gets a result, no model required.
 * Create: each action item becomes a Work task with owner and deadline.
 */

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<any[] | null>(null);
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState(new Date().toISOString().slice(0, 10));
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [ex, setEx] = useState<{ summary: string; decisions: string[]; actionItems: { owner: string; task: string; deadline: string | null }[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  const load = useCallback(async () => { const r = await fetch("/api/meetings", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setMeetings(j.meetings || []); }, []);
  useEffect(() => { load(); }, [load]);

  function toggleRecord() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setMsg("Live transcription needs Chrome or Edge. Paste the transcript instead."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR(); rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e: any) => { const chunk = Array.from(e.results).slice(e.resultIndex).map((r: any) => r[0].transcript).join(" "); setTranscript((t) => (t ? t + "\n" : "") + chunk.trim()); };
    rec.onend = () => { if (listening) try { rec.start(); } catch { setListening(false); } };
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }

  async function extract() {
    setExtracting(true); setMsg(null);
    try {
      // Floor: deterministic. Then, if the local model is available, let it refine.
      const r = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "extract", transcript }) });
      const j = await r.json(); let result = j.extracted;
      if (isWebGpuSupported() && getLoadedAssistantModelId()) {
        try {
          const engine = await loadAssistantEngine(getLoadedAssistantModelId() || DEFAULT_ASSISTANT_MODEL, () => {});
          const res = await engine.chat.completions.create({
            messages: [
              { role: "system", content: 'You summarise business meetings. Reply with ONE JSON object only: {"summary": "...", "decisions": ["..."], "actionItems": [{"owner": "Name", "task": "...", "deadline": "YYYY-MM-DD or null"}]}. Use the people and dates actually mentioned.' },
              { role: "user", content: transcript.slice(0, 6000) },
            ], temperature: 0.2, max_tokens: 700,
          });
          const raw = res.choices?.[0]?.message?.content || ""; const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
          if (s >= 0 && e > s) { const p = JSON.parse(raw.slice(s, e + 1)); if (p.summary) result = { summary: p.summary, decisions: p.decisions || result.decisions, actionItems: (p.actionItems || result.actionItems).map((a: any) => ({ owner: a.owner || "", task: a.task || "", deadline: a.deadline || null })) }; }
        } catch { /* keep the deterministic result */ }
      }
      setEx(result);
    } catch (e) { setMsg((e as Error).message); } finally { setExtracting(false); }
  }

  async function save(createTasks: boolean) {
    if (!ex) return; setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", title: title || "Meeting", heldOn, transcript, ...ex, createTasks }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(createTasks ? `Saved. ${j.meeting.actionItems.length} task(s) created in Work.` : "Saved.");
      setTitle(""); setTranscript(""); setEx(null); await load();
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  }

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  return (
    <div className="space-y-5">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
        <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Meetings<span className="text-biome-leafBright">.</span></h1>
        <p className="mt-2 text-[12px] text-biome-muted">Record or paste, extract decisions and action items, turn them into tasks with owners and deadlines.</p>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.1fr,1fr]">
        <GlassCard className="p-5">
          <div className="grid gap-2 sm:grid-cols-[1fr,auto]"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className={input} /><input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} className={input} /></div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={toggleRecord} className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-semibold ${listening ? "border-rose-500/50 bg-rose-500/10 text-rose-500 animate-pulse" : "border-biome-line text-biome-muted"}`}>{listening ? <Square size={12} /> : <Mic size={12} />} {listening ? "Stop recording" : "Record (live transcription)"}</button>
            <span className="text-[10px] text-biome-muted">or paste minutes below</span>
          </div>
          <textarea rows={10} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"Transcript / minutes…\ne.g. Ravi will follow up with Vendor ABC by Friday.\nAccounts to verify pending invoices.\nDecided: vendor must submit documents by Friday."} className={`${input} mt-2 resize-none font-mono text-[11px]`} />
          <button onClick={extract} disabled={extracting || transcript.trim().length < 20} className="bmx-btn mt-3 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">{extracting ? <Loader2 size={13} className="bmx-spin" /> : <Sparkles size={13} />} Extract summary &amp; action items</button>
          {msg && <p className="mt-2 text-[11px] text-biome-leafBright">{msg}</p>}
        </GlassCard>

        <GlassCard className="p-5">
          {!ex ? <p className="text-[11.5px] text-biome-muted">Extraction appears here — summary, decisions, and action items you can edit before creating tasks. With the local model loaded (assistant panel), the write-up is richer; without it, the deterministic extractor still finds "X will do Y by Friday".</p> : (
            <>
              <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Summary</p>
              <textarea rows={3} value={ex.summary} onChange={(e) => setEx({ ...ex, summary: e.target.value })} className={`${input} mt-1 resize-none`} />
              <p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Decisions</p>
              <ul className="mt-1 space-y-1">{ex.decisions.map((d, i) => <li key={i} className="flex items-center gap-2 text-[11.5px] text-biome-text"><CheckCircle2 size={12} className="shrink-0 text-emerald-500" /><input value={d} onChange={(e) => setEx({ ...ex, decisions: ex.decisions.map((x, j) => (j === i ? e.target.value : x)) })} className="w-full bg-transparent outline-none" /></li>)}{ex.decisions.length === 0 && <li className="text-[11px] text-biome-muted">None found.</li>}</ul>
              <p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Action items</p>
              <div className="mt-1 space-y-1.5">
                {ex.actionItems.map((a, i) => (
                  <div key={i} className="grid grid-cols-[110px,1fr,120px,auto] items-center gap-1.5">
                    <input value={a.owner} onChange={(e) => setEx({ ...ex, actionItems: ex.actionItems.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)) })} placeholder="Owner" className={`${input} py-1.5 text-[11px]`} />
                    <input value={a.task} onChange={(e) => setEx({ ...ex, actionItems: ex.actionItems.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)) })} className={`${input} py-1.5 text-[11px]`} />
                    <input type="date" value={a.deadline || ""} onChange={(e) => setEx({ ...ex, actionItems: ex.actionItems.map((x, j) => (j === i ? { ...x, deadline: e.target.value || null } : x)) })} className={`${input} py-1.5 text-[11px]`} />
                    <button onClick={() => setEx({ ...ex, actionItems: ex.actionItems.filter((_, j) => j !== i) })} className="text-rose-500"><Trash2 size={12} /></button>
                  </div>
                ))}
                <button onClick={() => setEx({ ...ex, actionItems: [...ex.actionItems, { owner: "", task: "", deadline: null }] })} className="text-[10.5px] font-semibold text-biome-leafBright">+ Add action item</button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => save(true)} disabled={saving} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">{saving ? <Loader2 size={13} className="bmx-spin" /> : <ListChecks size={13} />} Save &amp; create tasks</button>
                <button onClick={() => save(false)} disabled={saving} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted"><Save size={13} /> Save only</button>
              </div>
            </>
          )}
        </GlassCard>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Past meetings</p>
        {meetings?.length === 0 && <p className="text-[11px] text-biome-muted">None yet.</p>}
        {(meetings || []).map((m) => (
          <div key={m.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
            <div className="flex items-center justify-between"><p className="text-[12.5px] font-semibold text-biome-text">{m.title}</p><p className="text-[10px] text-biome-muted">{m.heldOn} · {m.createdBy}</p></div>
            <p className="mt-0.5 text-[11px] text-biome-muted">{m.summary}</p>
            {m.actionItems.length > 0 && <p className="mt-1 text-[10.5px] text-biome-text">{m.actionItems.map((a: any) => `✓ ${a.owner || "—"} – ${a.task}`).join(" · ")} {m.actionItems.some((a: any) => a.taskId) && <Link href="/work" className="font-semibold text-biome-leafBright">(in Work)</Link>}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
