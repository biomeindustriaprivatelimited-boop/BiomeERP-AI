"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, ListChecks, AlertCircle, Sparkles } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * INBOX — AI email priority. Reads the company mailbox (IMAP, same
 * account as Settings → Mail), sorts urgent / important / normal with the
 * words that decided it, the required action, deadline, related party.
 * "Create task" hands it to the Work Engine. The paste box classifies any
 * forwarded email text without a mailbox connection. Nothing is moved,
 * marked or deleted.
 */

const TONE = { urgent: "border-rose-500/40 bg-rose-500/10 text-rose-500", important: "border-orange-500/40 bg-orange-500/10 text-orange-500", normal: "border-amber-400/40 bg-amber-400/10 text-amber-600" } as const;
const DOT = { urgent: "🔴", important: "🟠", normal: "🟡" } as const;
type Pri = keyof typeof TONE;
const input = "bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";

export default function InboxPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState({ from: "", subject: "", text: "" });
  const [pasted, setPasted] = useState<any>(null);
  const [made, setMade] = useState<number[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await fetch("/api/inbox", { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error); setD(j); setErr(null); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function task(m: any) {
    const r = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "task", uid: m.uid, subject: m.subject, from: m.from, party: m.party?.name, deadline: m.deadline, actionText: m.action, priority: m.priority, snippet: m.snippet }) });
    if (r.ok) setMade((s) => [...s, m.uid]);
  }
  async function classifyPaste() {
    const r = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "classify", ...paste }) });
    const j = await r.json().catch(() => ({})); setPasted(j.result || null);
  }

  const counts: Record<Pri, number> = { urgent: 0, important: 0, normal: 0 };
  for (const m of d?.messages || []) counts[m.priority as Pri] += 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Inbox<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">Every incoming email sorted by what it needs from you. Nothing is moved, marked or deleted.</p>
        </div>
        <button onClick={load} disabled={busy} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted disabled:opacity-60">{busy ? <Loader2 size={13} className="bmx-spin" /> : <RefreshCcw size={13} />} Fetch mailbox</button>
      </header>

      {d && <div className="flex flex-wrap gap-2">{(["urgent", "important", "normal"] as Pri[]).map((p) => <span key={p} className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${TONE[p]}`}>{DOT[p]} {p[0].toUpperCase() + p.slice(1)}: {counts[p]}</span>)}</div>}

      {err && (
        <GlassCard className="p-5">
          <p className="flex items-center gap-1.5 text-[11.5px] text-rose-500"><AlertCircle size={13} /> {err}</p>
          <p className="mt-1 text-[10.5px] text-biome-muted">Gmail: enable IMAP in Gmail settings; the app password saved under Settings → Mail is reused. Other providers: IMAP host is derived from the SMTP host. Until then, paste an email below.</p>
        </GlassCard>
      )}

      {d && (
        <div className="space-y-1.5">
          {d.messages.length === 0 && <GlassCard className="p-6"><p className="text-[11.5px] text-biome-muted">Mailbox is empty.</p></GlassCard>}
          {d.messages.map((m: any) => (
            <div key={m.uid} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
              <div className="flex flex-wrap items-start gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${TONE[m.priority as Pri]}`}>{DOT[m.priority as Pri]} {m.priority}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-biome-text">{m.subject}</p>
                  <p className="text-[10.5px] text-biome-muted">{m.fromName} &lt;{m.from}&gt; · {new Date(m.date).toLocaleString("en-IN")}{m.party ? ` · ${m.party.type}: ${m.party.name}` : ""}</p>
                  <p className="mt-1 text-[11px] text-biome-text">{m.snippet}</p>
                  <p className="mt-1 text-[10.5px] text-biome-leafBright">→ {m.action}{m.deadline ? ` · deadline: ${m.deadline}` : ""}{m.reasons.length ? <span className="text-biome-muted"> · because {m.reasons.join(", ")}</span> : null}</p>
                </div>
                <button onClick={() => task(m)} disabled={made.includes(m.uid)} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted disabled:opacity-50"><ListChecks size={12} /> {made.includes(m.uid) ? "Task created" : "Create task"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <GlassCard className="p-5">
        <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted"><Sparkles size={12} /> Classify a pasted email</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={paste.from} onChange={(e) => setPaste({ ...paste, from: e.target.value })} placeholder="From (email)" className={input} /><input value={paste.subject} onChange={(e) => setPaste({ ...paste, subject: e.target.value })} placeholder="Subject" className={input} /></div>
        <textarea rows={4} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} placeholder="Paste the email body" className={`${input} mt-2 w-full resize-none`} />
        <button onClick={classifyPaste} disabled={!paste.text} className="bmx-btn mt-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">Classify</button>
        {pasted && <p className="mt-2 text-[11.5px] text-biome-text"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${TONE[pasted.priority as Pri]}`}>{pasted.priority}</span> → {pasted.action}{pasted.deadline ? ` · deadline ${pasted.deadline}` : ""}{pasted.party ? ` · ${pasted.party.type}: ${pasted.party.name}` : ""}{pasted.reasons.length ? ` · because ${pasted.reasons.join(", ")}` : ""}</p>}
      </GlassCard>
    </div>
  );
}
