"use client";

import { useCallback, useEffect, useState } from "react";
import { Factory, Loader2, Plus, Pencil, Check, X, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Developer → Plants.
 *
 * The plant master: Mayan (REW) and Gangakhed (GKD) today, more later.
 * Only the developer adds or edits a plant — its code ties together
 * sign-ins, imprest, attendance, the biomass / transport sheets and the
 * spare-parts stock, so it cannot change once created. The name, state and
 * address can.
 */

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";

type Form = { code: string; label: string; state: string; location: string; active: boolean; isNew: boolean };

export default function PlantsTab() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/plants-master", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setData(j); else setMsg({ ok: false, text: j.error || "Could not load plants." });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/plants-master", {
        method: form.isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.code, label: form.label, state: form.state, location: form.location, active: form.active }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Not saved.");
      setMsg({ ok: true, text: `${form.label} (${form.code.toUpperCase()}) saved. Its biomass sheet, transport sheet and stock are ready under Plant.` });
      setForm(null);
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  if (!data) return <p className="text-[12px] text-biome-muted"><Loader2 size={13} className="bmx-spin mr-1 inline" /> Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[720px] text-[11.5px] text-biome-muted">
          Every plant of the company. A new plant gets its own biomass sheet, transport sheet, stock and imprest — kept separate from every other plant.
          Only the developer can add or edit a plant.
        </p>
        {data.canEdit && (
          <button onClick={() => { setMsg(null); setForm({ code: "", label: "", state: data.states?.[0]?.code || "HR", location: "", active: true, isNew: true }); }}
            className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-3 py-1.5 text-[11px] font-bold text-white"><Plus size={12} /> Add plant</button>
        )}
      </div>

      {msg && (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-700" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
          {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} className="text-rose-500" />} {msg.text}
        </p>
      )}

      {form && (
        <section className="rounded-2xl border border-biome-leaf/40 bg-biome-bgSoft p-4">
          <p className="mb-3 text-[12.5px] font-semibold text-biome-text">{form.isNew ? "New plant" : `Edit ${form.code}`}</p>
          <div className="grid gap-2 md:grid-cols-4">
            <label><span className={lbl}>Code (cannot change later)</span>
              <input value={form.code} disabled={!form.isNew} maxLength={6} placeholder="e.g. JSR"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} className={`${input} disabled:opacity-60`} /></label>
            <label><span className={lbl}>Plant name</span>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Jamshedpur" className={input} /></label>
            <label><span className={lbl}>State (holiday calendar)</span>
              <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={input}>
                {(data.states || []).map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select></label>
            <label><span className={lbl}>Address / location</span>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={input} /></label>
          </div>
          {!form.isNew && (
            <label className="mt-2 flex items-center gap-2 text-[11.5px] text-biome-text">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Plant is working (untick to close a plant — its data stays)
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy || !form.code || !form.label} className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />} Save
            </button>
            <button onClick={() => setForm(null)} className="flex items-center gap-1 rounded-xl border border-biome-line px-4 py-2 text-[11.5px] text-biome-muted"><X size={13} /> Cancel</button>
          </div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {data.plants.map((p: any, i: number) => (
          <div key={p.code} className={`rounded-2xl border p-4 ${p.active ? "border-biome-line bg-biome-bgSoft" : "border-dashed border-biome-line opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-[14px] font-semibold text-biome-text"><Factory size={15} className="text-biome-leaf" /> {i + 1}. {p.label} Plant <span className="rounded-md bg-biome-leaf/12 px-1.5 py-0.5 text-[10px] font-bold text-biome-leaf">{p.code}</span></p>
                <p className="mt-1 text-[11px] text-biome-muted">{p.location || "—"} · {(data.states || []).find((s: any) => s.code === p.state)?.label || p.state}</p>
                <p className="mt-1 text-[10.5px] text-biome-muted">{p.employees} employees · {p.holidays} holidays{p.active ? "" : " · closed"}</p>
              </div>
              {data.canEdit && (
                <button onClick={() => { setMsg(null); setForm({ code: p.code, label: p.label, state: p.state, location: p.location || "", active: p.active, isNew: false }); }}
                  className="flex items-center gap-1 rounded-lg border border-biome-line px-2 py-1 text-[10.5px] text-biome-muted"><Pencil size={11} /> Edit</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
