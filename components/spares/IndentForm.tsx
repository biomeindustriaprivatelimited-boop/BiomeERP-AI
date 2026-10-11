"use client";

import { useState } from "react";
import { Plus, Trash2, Send, Loader2 } from "lucide-react";
import { input, label, btn, today } from "@/components/spares/ui";

/**
 * Raise a spare-part requirement. Used by the plant manager's page and by
 * procurement. A part not yet in the item master can be typed by name —
 * procurement adds it to the master when it orders.
 */
export function IndentForm({ plants, myPlant, machines, items, urgencyLabels, onSubmit }: {
  plants: { code: string; label: string }[];
  myPlant: string;
  machines: { id: string; code: string; name: string; plant: string; section?: string }[];
  items: { id: string; code: string; name: string; partNo: string; unit: string; machineIds: string[] }[];
  urgencyLabels: Record<string, string>;
  onSubmit: (body: any) => Promise<boolean>;
}) {
  const first = myPlant && plants.some((p) => p.code === myPlant) ? myPlant : plants[0]?.code || "";
  const [h, setH] = useState({ plant: first, urgency: "normal", machineId: "", reason: "", requiredBy: "" });
  const [lines, setLines] = useState<any[]>([{ itemId: "", name: "", partNo: "", qty: "", unit: "Nos" }]);
  const [busy, setBusy] = useState(false);
  const ms = machines.filter((m) => m.plant === h.plant);
  const fits = new Set(items.filter((i) => h.machineId && i.machineIds.includes(h.machineId)).map((i) => i.id));
  const set = (i: number, patch: any) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit() {
    setBusy(true);
    const ok = await onSubmit({ ...h, lines });
    setBusy(false);
    if (ok) { setLines([{ itemId: "", name: "", partNo: "", qty: "", unit: "Nos" }]); setH({ ...h, reason: "", machineId: "", requiredBy: "", urgency: "normal" }); }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <label><span className={label}>Plant</span>
          <select value={h.plant} onChange={(e) => setH({ ...h, plant: e.target.value, machineId: "" })} className={input} disabled={plants.length < 2}>
            {plants.map((p) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
          </select></label>
        <label><span className={label}>Urgency</span>
          <select value={h.urgency} onChange={(e) => setH({ ...h, urgency: e.target.value })} className={input}>
            {Object.entries(urgencyLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label><span className={label}>Machine (if for a machine)</span>
          <select value={h.machineId} onChange={(e) => setH({ ...h, machineId: e.target.value })} className={input}>
            <option value="">General / store stock</option>
            {ms.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.section ? ` (${m.section})` : ""}</option>)}
          </select></label>
        <label><span className={label}>Needed by</span><input type="date" min={today()} value={h.requiredBy} onChange={(e) => setH({ ...h, requiredBy: e.target.value })} className={input} /></label>
        <label className="md:col-span-4"><span className={label}>Reason</span>
          <input value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} placeholder="Pellet mill 1 roller worn out — output down / routine stock for next month" className={input} /></label>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-biome-line bg-biome-bg p-2.5 md:grid-cols-[1.4fr_1fr_110px_90px_38px]">
            <label><span className={label}>Part (from the list)</span>
              <select value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); set(i, { itemId: e.target.value, name: it?.name || "", partNo: it?.partNo || "", unit: it?.unit || l.unit }); }} className={input}>
                <option value="">Not in the list — type below</option>
                {fits.size > 0 && <optgroup label="Fits this machine">{items.filter((it) => fits.has(it.id)).map((it) => <option key={it.id} value={it.id}>{it.name}{it.partNo ? ` · ${it.partNo}` : ""}</option>)}</optgroup>}
                <optgroup label="All parts">{items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}{it.partNo ? ` · ${it.partNo}` : ""}</option>)}</optgroup>
              </select></label>
            <label><span className={label}>{l.itemId ? "Part no" : "Part name / description"}</span>
              {l.itemId ? <input value={l.partNo} readOnly className={`${input} opacity-70`} />
                : <input value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. V-belt B-72" className={input} />}</label>
            <label><span className={label}>Qty</span><input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className={input} /></label>
            <label><span className={label}>Unit</span><input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} disabled={!!l.itemId} className={input} /></label>
            <button type="button" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} className="mb-1 rounded-lg border border-biome-line p-2 text-rose-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { itemId: "", name: "", partNo: "", qty: "", unit: "Nos" }])} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted"><Plus size={12} /> Add part</button>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={busy} className={btn}>{busy ? <Loader2 size={14} className="bmx-spin" /> : <Send size={14} />} Send to procurement</button>
      </div>
    </div>
  );
}
