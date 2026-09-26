"use client";

import { useState } from "react";
import Portal from "@/components/Portal";
import { Megaphone, Loader2, Send, CheckCircle2, AlertCircle, X } from "lucide-react";

/**
 * "Announce a holiday / shutdown" — the manual, plant-wise notice.
 *
 * Manual on purpose: a wrong automated holiday email is a plant that
 * doesn't turn up. A person writes it, picks the plant, and sends it;
 * the result names anyone without a work email so the notice can reach
 * them another way.
 */
export default function HolidayAnnounce({ plants }: { plants: string[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ plant: "ALL", kind: "holiday", dates: "", reason: "", note: "" });

  async function send() {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/attendance/holiday-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      const parts = [`${json.sent} of ${json.total} emailed.`];
      if (json.failed?.length) parts.push(`Failed: ${json.failed.map((f: any) => f.name).join(", ")}.`);
      if (json.noEmail?.length) parts.push(`No work email — tell them another way: ${json.noEmail.join(", ")}.`);
      setResult(parts.join(" "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted transition-colors hover:text-biome-text">
        <Megaphone size={13} /> Announce holiday / shutdown
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="bmx-card w-full max-w-lg rounded-3xl border border-biome-line bg-biome-bgSoft p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-biome-text">
                <Megaphone size={16} className="text-biome-leafBright" /> Holiday / shutdown notice
              </h3>
              <button onClick={() => setOpen(false)} disabled={busy}
                className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
              Emails every active employee of the chosen plant who has a work email on file.
              Sent only when you press the button — never automatically.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">Plant</span>
                <select value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} className={input}>
                  <option value="ALL">All plants &amp; offices</option>
                  {plants.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">Type</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input}>
                  <option value="holiday">Holiday</option>
                  <option value="shutdown">Shutdown</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">Date(s)</span>
              <input value={form.dates} onChange={(e) => setForm({ ...form, dates: e.target.value })}
                placeholder="26 Aug 2026 — or 26–28 Aug 2026" className={input} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">Reason</span>
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Festival / maintenance shutdown / state holiday…" className={input} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">Extra note (optional)</span>
              <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Anything else the plant should know" className={`${input} resize-none`} />
            </label>

            {error && (
              <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-3 py-2 text-[11px] text-rose-500">
                <AlertCircle size={12} /> {error}
              </p>
            )}
            {result && (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3 py-2 text-[11px] text-emerald-600">
                <CheckCircle2 size={12} className="mt-px shrink-0" /> {result}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>
              <button onClick={send} disabled={busy || !form.dates || !form.reason}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={13} className="bmx-spin" /> : <Send size={13} />} Send notice
              </button>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}
