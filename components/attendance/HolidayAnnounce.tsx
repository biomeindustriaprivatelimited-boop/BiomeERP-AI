"use client";

import { useState } from "react";
import Portal from "@/components/Portal";
import { Megaphone, Loader2, Send, CheckCircle2, AlertCircle, X } from "lucide-react";
import { usePlants } from "@/lib/usePlants";

/**
 * "Announce a holiday / shutdown" — developer and admin only.
 *
 * The caller decides whether to render this (the API's `canAnnounce` /
 * `canEdit` flag); the server refuses everyone else regardless.
 *
 * Announcing puts the date(s) on the holiday calendar, marks them H in the
 * attendance register for the plant's people, and — if ticked — emails the
 * notice. The earlier version rendered plant objects as <option> text,
 * which threw the moment the dialog opened; it now uses the plant codes.
 */
export default function HolidayAnnounce({ onDone }: { onDone?: () => void }) {
  const plants = usePlants();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    plant: "ALL", kind: "holiday", fromDate: iso, toDate: iso, reason: "", note: "", email: true,
  });

  async function send() {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/attendance/holiday-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      const parts = [
        `Added to the holiday calendar; ${json.attendanceMarked} attendance day(s) marked Holiday.`,
      ];
      if (form.email) {
        parts.push(`${json.sent} of ${json.total} emailed.`);
        if (json.failed?.length) parts.push(`Not emailed: ${json.failed.map((f: any) => `${f.name} (${f.error})`).join(", ")}.`);
        if (json.noEmail?.length) parts.push(`No work email — tell them another way: ${json.noEmail.join(", ")}.`);
      }
      setResult(parts.join(" "));
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  const label = "mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted";

  return (
    <>
      <button onClick={() => { setOpen(true); setResult(null); setError(null); }} data-testid="announce-holiday"
        className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted transition-colors hover:text-biome-text">
        <Megaphone size={13} /> Announce holiday
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" onClick={() => !busy && setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Announce holiday"
            className="bmx-card w-full max-w-lg rounded-3xl border border-biome-line bg-biome-bgSoft p-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-biome-text">
                <Megaphone size={16} className="text-biome-leafBright" /> Holiday / shutdown notice
              </h3>
              <button onClick={() => setOpen(false)} disabled={busy} aria-label="Close"
                className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
              Goes on the holiday calendar and marks the day(s) as Holiday in attendance for that
              plant&apos;s people. Email is optional.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>Plant</span>
                <select value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} className={input}>
                  <option value="ALL">All plants &amp; offices</option>
                  {plants.map((p) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
                </select>
              </label>
              <label className="block">
                <span className={label}>Type</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input}>
                  <option value="holiday">Holiday</option>
                  <option value="shutdown">Shutdown</option>
                </select>
              </label>
              <label className="block">
                <span className={label}>From</span>
                <input type="date" value={form.fromDate} name="fromDate"
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })}
                  className={input} />
              </label>
              <label className="block">
                <span className={label}>To</span>
                <input type="date" value={form.toDate} min={form.fromDate} name="toDate"
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })} className={input} />
              </label>
            </div>
            <label className="mt-3 block">
              <span className={label}>Holiday name / reason</span>
              <input value={form.reason} name="reason" onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Diwali / maintenance shutdown / state holiday…" className={input} />
            </label>
            <label className="mt-3 block">
              <span className={label}>Extra note (optional)</span>
              <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Anything else the plant should know" className={`${input} resize-none`} />
            </label>
            <label className="mt-3 flex items-center gap-2 text-[11.5px] text-biome-text">
              <input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
              Also email the notice to staff with a work email
            </label>

            {error && (
              <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-3 py-2 text-[11px] text-rose-500">
                <AlertCircle size={12} /> {error}
              </p>
            )}
            {result && (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3 py-2 text-[11px] text-emerald-600" data-testid="announce-result">
                <CheckCircle2 size={12} className="mt-px shrink-0" /> {result}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>
              <button onClick={send} disabled={busy || !form.fromDate || !form.reason.trim()}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={13} className="bmx-spin" /> : <Send size={13} />} Announce
              </button>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}
