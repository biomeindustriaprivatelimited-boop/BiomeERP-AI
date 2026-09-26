"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Portal from "@/components/Portal";
import { FileText, Plus, Loader2, PenLine, MapPin, Camera, CheckCircle2, X, Download } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { useSession } from "@/lib/session";

/**
 * SMART FORM BUILDER — no code.
 * Build from a template or from scratch (text, number, dropdown, date,
 * photo, file, signature, location, checkbox), fill on desktop or phone,
 * review submissions, export CSV. A form can raise a Work task on every
 * submission so nothing filled in the field is ever missed at the desk.
 */

const TYPES = ["text", "number", "dropdown", "date", "photo", "file", "signature", "location", "checkbox"] as const;

export default function FormsPage() {
  const { can } = useSession();
  const [data, setData] = useState<any>(null);
  const [building, setBuilding] = useState(false);
  const [filling, setFilling] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => { const r = await fetch("/api/forms", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setData(j); }, []);
  useEffect(() => { load(); const id = new URLSearchParams(window.location.search).get("form"); if (id) setTimeout(() => setViewing({ id }), 300); }, [load]);

  async function post(body: Record<string, any>) {
    const r = await fetch("/api/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { setMsg(j.error || "Failed."); return null; }
    setMsg(null); await load(); return j;
  }

  const forms: any[] = data?.forms || [];
  const subsFor = (id: string) => (data?.submissions || []).filter((s: any) => s.formId === id);

  function exportCsv(f: any) {
    const subs = subsFor(f.id);
    const head = ["Submitted at", "By", ...f.fields.map((x: any) => x.label)];
    const rows = subs.map((s: any) => [s.submittedAt, s.submittedByName, ...f.fields.map((x: any) => String(s.values[x.id] ?? ""))]);
    const csv = [head, ...rows].map((r: string[]) => r.map((v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${f.name}.csv`; a.click();
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Forms<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">Site inspections, vendor evaluations, complaints, vehicle checks — built without code, filled on any device.</p>
        </div>
        {can("settings") && <button onClick={() => setBuilding(true)} className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white"><Plus size={14} /> New form</button>}
      </header>
      {msg && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{msg}</p>}
      {!data && <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>}

      {data && (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {forms.length === 0 && <GlassCard className="p-8 text-center md:col-span-3"><p className="text-[12.5px] font-bold text-biome-text">No forms yet</p><p className="mt-1 text-[11px] text-biome-muted">Start from a template: Site Inspection, Vendor Evaluation, Complaint, Vehicle Inspection, Expense Request.</p></GlassCard>}
          {forms.map((f) => (
            <div key={f.id} className={`bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4 ${!f.active ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2"><div><p className="text-[13px] font-bold text-biome-text">{f.name}</p><p className="text-[10.5px] text-biome-muted">{f.description || `${f.fields.length} fields`}</p></div><FileText size={16} className="text-biome-leafBright" /></div>
              <p className="mt-2 text-[10px] text-biome-muted">{subsFor(f.id).length} submissions{f.taskOnSubmit ? ` · task → ${f.taskOnSubmit}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {f.active && <button onClick={() => setFilling(f)} className="bmx-btn rounded-xl bg-biome-leaf px-3 py-2 text-[11px] font-bold text-white">Fill</button>}
                <button onClick={() => setViewing(f)} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Submissions</button>
                <button onClick={() => exportCsv(f)} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><Download size={11} /> CSV</button>
                {can("settings") && <button onClick={() => post({ action: "toggle", id: f.id })} className="text-[10.5px] font-semibold text-biome-muted">{f.active ? "Deactivate" : "Activate"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {building && <Builder templates={data?.templates || []} onClose={() => setBuilding(false)} onCreate={async (b) => { const r = await post({ action: "create", ...b }); if (r) setBuilding(false); }} />}
      {filling && <Filler form={filling} onClose={() => setFilling(null)} onSubmit={async (b) => { const r = await post({ action: "submit", formId: filling.id, ...b }); if (r) { setFilling(null); setMsg(null); } }} />}
      {viewing && data && (
        <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setViewing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
            {(() => { const f = forms.find((x) => x.id === viewing.id); if (!f) return <p className="text-[11px] text-biome-muted">Form not found.</p>; const subs = subsFor(f.id); return (
              <>
                <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-biome-text">{f.name} — {subs.length} submissions</h3><button onClick={() => setViewing(null)} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
                <table className="mt-3 w-full text-left text-[11px]"><thead><tr className="text-[9.5px] font-bold uppercase tracking-[.1em] text-biome-muted"><th className="py-1.5 pr-2">When</th><th className="pr-2">By</th>{f.fields.map((x: any) => <th key={x.id} className="pr-2">{x.label}</th>)}</tr></thead>
                  <tbody>{subs.map((s: any) => <tr key={s.id} className="border-t border-biome-line/60 text-biome-text"><td className="py-1.5 pr-2 whitespace-nowrap">{new Date(s.submittedAt).toLocaleString("en-IN")}</td><td className="pr-2">{s.submittedByName}</td>{f.fields.map((x: any) => <td key={x.id} className="pr-2">{String(s.values[x.id] ?? "—").slice(0, 40)}</td>)}</tr>)}</tbody></table>
              </>
            ); })()}
          </div>
        </div></Portal>
      )}
    </div>
  );
}

function Builder({ templates, onClose, onCreate }: { templates: any[]; onClose: () => void; onCreate: (b: Record<string, any>) => Promise<void> }) {
  const [f, setF] = useState<{ name: string; description: string; taskOnSubmit: string; fields: { label: string; type: string; required: boolean; options?: string[] }[] }>({ name: "", description: "", taskOnSubmit: "", fields: [] });
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-biome-text">New form</h3><button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
        <div className="mt-3 flex flex-wrap gap-1.5">{templates.map((t) => <button key={t.name} onClick={() => setF({ name: t.name, description: t.description, taskOnSubmit: "", fields: t.fields })} className="bmx-chip rounded-full border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text">{t.name}</button>)}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Form name" className={input} /><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" className={input} /></div>
        <select value={f.taskOnSubmit} onChange={(e) => setF({ ...f, taskOnSubmit: e.target.value })} className={`${input} mt-2`}><option value="">No task on submit</option><option value="accounts">Task for Accounts on every submission</option><option value="coordinator">Task for Coordinator</option><option value="plant_manager">Task for Plant Manager</option><option value="admin">Task for Admin</option></select>
        <p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Fields</p>
        <div className="mt-1 space-y-1.5">
          {f.fields.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr,120px,auto,auto] items-center gap-1.5">
              <input value={x.label} onChange={(e) => setF({ ...f, fields: f.fields.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} className={`${input} py-1.5 text-[11px]`} />
              <select value={x.type} onChange={(e) => setF({ ...f, fields: f.fields.map((y, j) => (j === i ? { ...y, type: e.target.value } : y)) })} className={`${input} py-1.5 text-[11px]`}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <label className="flex items-center gap-1 text-[10px] text-biome-muted"><input type="checkbox" checked={x.required} onChange={(e) => setF({ ...f, fields: f.fields.map((y, j) => (j === i ? { ...y, required: e.target.checked } : y)) })} /> req</label>
              <button onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} className="text-rose-500"><X size={12} /></button>
              {x.type === "dropdown" && <input value={(x.options || []).join(", ")} onChange={(e) => setF({ ...f, fields: f.fields.map((y, j) => (j === i ? { ...y, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : y)) })} placeholder="Options, comma separated" className={`${input} col-span-4 py-1.5 text-[11px]`} />}
            </div>
          ))}
          <button onClick={() => setF({ ...f, fields: [...f.fields, { label: "New field", type: "text", required: false }] })} className="text-[10.5px] font-semibold text-biome-leafBright">+ Add field</button>
        </div>
        <button disabled={!f.name || !f.fields.length} onClick={() => onCreate(f)} className="bmx-btn mt-4 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">Create form</button>
      </div>
    </div></Portal>
  );
}

function Filler({ form, onClose, onSubmit }: { form: any; onClose: () => void; onSubmit: (b: Record<string, any>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<{ fieldId: string; name: string; base64: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

  async function pickFile(fieldId: string, file: File) {
    const base64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
    setFiles((fs) => [...fs.filter((x) => x.fieldId !== fieldId), { fieldId, name: file.name, base64 }]);
    setValues((v) => ({ ...v, [fieldId]: file.name }));
  }
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-lg overflow-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-biome-text">{form.name}</h3><button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
        <div className="mt-3 space-y-3">
          {form.fields.map((x: any) => (
            <label key={x.id} className="block">
              <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">{x.label}{x.required ? " *" : ""}</span>
              {x.type === "text" && <input value={values[x.id] || ""} onChange={(e) => setValues({ ...values, [x.id]: e.target.value })} className={input} />}
              {x.type === "number" && <input type="number" value={values[x.id] ?? ""} onChange={(e) => setValues({ ...values, [x.id]: e.target.value })} className={input} />}
              {x.type === "date" && <input type="date" value={values[x.id] || ""} onChange={(e) => setValues({ ...values, [x.id]: e.target.value })} className={input} />}
              {x.type === "dropdown" && <select value={values[x.id] || ""} onChange={(e) => setValues({ ...values, [x.id]: e.target.value })} className={input}><option value="">Choose…</option>{(x.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}</select>}
              {x.type === "checkbox" && <input type="checkbox" checked={Boolean(values[x.id])} onChange={(e) => setValues({ ...values, [x.id]: e.target.checked })} />}
              {(x.type === "photo" || x.type === "file") && <div className="flex items-center gap-2"><input type="file" accept={x.type === "photo" ? "image/*" : undefined} capture={x.type === "photo" ? "environment" : undefined} onChange={(e) => e.target.files?.[0] && pickFile(x.id, e.target.files[0])} className="text-[11px] text-biome-muted" /><Camera size={13} className="text-biome-muted" /></div>}
              {x.type === "signature" && <Signature onChange={(dataUrl) => { setFiles((fs) => [...fs.filter((y) => y.fieldId !== x.id), { fieldId: x.id, name: "signature.png", base64: dataUrl.split(",")[1] }]); setValues({ ...values, [x.id]: "signed" }); }} />}
              {x.type === "location" && <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setValues({ ...values, [x.id]: `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` }), () => setValues({ ...values, [x.id]: "location unavailable" }))} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><MapPin size={12} /> {values[x.id] || "Capture location"}</button>}
            </label>
          ))}
        </div>
        <button disabled={busy} onClick={async () => { setBusy(true); await onSubmit({ values, files }); setBusy(false); }} className="bmx-btn mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-biome-leaf px-5 py-3.5 text-[12.5px] font-bold text-white disabled:opacity-60">{busy ? <Loader2 size={15} className="bmx-spin" /> : <CheckCircle2 size={15} />} Submit</button>
      </div>
    </div></Portal>
  );
}

function Signature({ onChange }: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  function pos(e: any) { const c = ref.current!; const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function start(e: any) { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: any) { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#163300"; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function end() { if (!drawing.current) return; drawing.current = false; onChange(ref.current!.toDataURL("image/png")); }
  return (
    <div>
      <canvas ref={ref} width={360} height={120} onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} className="w-full touch-none rounded-xl border border-biome-line bg-white" />
      <button type="button" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }} className="mt-1 flex items-center gap-1 text-[10px] text-biome-muted"><PenLine size={10} /> Clear</button>
    </div>
  );
}
