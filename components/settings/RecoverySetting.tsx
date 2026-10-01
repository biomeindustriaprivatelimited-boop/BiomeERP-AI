"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Check, AlertCircle } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { useSession } from "@/lib/session";

/**
 * Developer recovery questions — developer only.
 *
 * If the developer forgets the password, the server PC's sign-in screen
 * offers "Forgot developer password?": these three answers reset it to the
 * default. Until set here, three built-in company questions are used.
 */
export default function RecoverySetting() {
  const { user } = useSession();
  const [cur, setCur] = useState<{ q1: string; q2: string; q3?: string; custom: boolean } | null>(null);
  const [f, setF] = useState({ q1: "", a1: "", q2: "", a2: "", q3: "", a3: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (user?.role !== "developer") return;
    fetch("/api/auth/security-questions", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j?.q1) { setCur(j); setF((x) => ({ ...x, q1: j.custom ? j.q1 : "", q2: j.custom ? j.q2 : "", q3: j.custom ? j.q3 || "" : "" })); }
    }).catch(() => {});
  }, [user?.role]);

  if (user?.role !== "developer") return null;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/auth/security-questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(j.error || "Could not save.");
      setCur({ q1: f.q1, q2: f.q2, q3: f.q3, custom: true });
      setF({ ...f, a1: "", a2: "", a3: "" });
      setMsg({ ok: true, text: "Saved. Remember these answers — they reset the developer password on the server PC." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none";
  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Developer password recovery</h2>
        <span className="rounded-full border border-violet-500/35 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-violet-500">Developer</span>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
        Forgot the developer password? On the <b>server PC</b> sign-in screen click “Forgot developer password?” and answer
        these three questions — the password goes back to the default and you set a new one. Works offline, only on the server PC.
        {cur && !cur.custom && <> Right now the three built-in company questions are used — set your own below.</>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} placeholder="Question 1" value={f.q1} onChange={(e) => setF({ ...f, q1: e.target.value })} />
        <input className={input} placeholder="Answer 1" value={f.a1} onChange={(e) => setF({ ...f, a1: e.target.value })} />
        <input className={input} placeholder="Question 2" value={f.q2} onChange={(e) => setF({ ...f, q2: e.target.value })} />
        <input className={input} placeholder="Answer 2" value={f.a2} onChange={(e) => setF({ ...f, a2: e.target.value })} />
        <input className={input} placeholder="Question 3" value={f.q3} onChange={(e) => setF({ ...f, q3: e.target.value })} />
        <input className={input} placeholder="Answer 3" value={f.a3} onChange={(e) => setF({ ...f, a3: e.target.value })} />
      </div>
      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 text-[11px] ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>
          {msg.ok ? <Check size={12} /> : <AlertCircle size={12} />} {msg.text}
        </p>
      )}
      <button onClick={save} disabled={busy || !f.q1 || !f.a1 || !f.q2 || !f.a2 || !f.q3 || !f.a3}
        className="bmx-btn mt-3 flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />} Save questions
      </button>
    </GlassCard>
  );
}
