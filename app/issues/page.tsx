"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Portal from "@/components/Portal";
import Link from "next/link";
import { Camera, Loader2, AlertTriangle, Plus, CheckCircle2, X, Lightbulb, ScanLine } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * ISSUES & INCIDENTS + CAMERA-TO-ACTION.
 *
 * Take or upload a photo → the app reads any text on it (offline OCR),
 * suggests a category from what it sees, and offers the actions that
 * category needs. Raising the issue creates the Work task, stores the
 * photo as evidence, and shows similar past issues with how they ended.
 * Honest scope: there is no vision model here — categorisation is from
 * OCR text and keyword rules, and the person confirms it.
 */

const KIND_HINTS: { kind: string; words: string[] }[] = [
  { kind: "damaged_material", words: ["damage", "wet", "moisture", "broken", "torn", "spoil", "rot", "kharab", "geela"] },
  { kind: "vehicle", words: ["tyre", "tire", "puncture", "brake", "breakdown", "engine", "truck", "vehicle", "gadi", "lorry", "hr ", "dl ", "up "] },
  { kind: "site_incident", words: ["injury", "accident", "fire", "spill", "fall", "hurt", "safety", "chot"] },
  { kind: "financial", words: ["invoice", "payment", "amount", "gst", "bill", "rs", "₹", "rupee", "paise"] },
  { kind: "vendor", words: ["vendor", "supplier", "challan", "weight", "kanta", "short"] },
];

export default function IssuesPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [open, setOpen] = useState<any | null>(null);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/issues", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, any>) {
    const r = await fetch("/api/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error || "Failed."); return null; }
    await load(); return j;
  }

  const P: Record<string, string> = { critical: "border-rose-500/40 bg-rose-500/10 text-rose-500", high: "border-orange-500/40 bg-orange-500/10 text-orange-500", medium: "border-amber-500/40 bg-amber-500/10 text-amber-600", low: "border-sky-400/40 bg-sky-400/10 text-sky-600" };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Issues<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">Report from the field with a photo; every issue gets an owner, evidence, a timeline and a Work task.</p>
        </div>
        <button onClick={() => setCapture(true)} className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white"><Camera size={14} /> Camera to action</button>
      </header>
      {err && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{err}</p>}
      {!data && !err && <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>}

      {data && (
        <div className="space-y-2">
          {data.issues.length === 0 && <GlassCard className="p-8 text-center"><p className="text-[12.5px] font-bold text-biome-text">No issues raised</p><p className="mt-1 text-[11px] text-biome-muted">Use Camera to action from a phone or desktop.</p></GlassCard>}
          {data.issues.map((i: any) => (
            <button key={i.id} onClick={() => setOpen(i)} className="bmx-card flex w-full items-start gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3 text-left">
              <span className={`mt-0.5 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${P[i.priority]}`}>{i.priority}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-biome-text">{i.title}</span>
                <span className="block text-[10.5px] text-biome-muted">{data.kinds.find((k: any) => k.id === i.kind)?.label} · {i.party || "—"} · {i.status} · {i.ownerName || "unassigned"} · {i.evidence.length} evidence</span>
              </span>
              <span className="text-[10px] text-biome-muted">{new Date(i.updatedAt).toLocaleDateString("en-IN")}</span>
            </button>
          ))}
        </div>
      )}

      {capture && <CaptureSheet kinds={data?.kinds || []} onClose={() => setCapture(false)} onCreate={async (b) => { const r = await act({ action: "create", ...b }); if (r) { setCapture(false); setOpen(r.issue); } }} />}
      {open && <IssueSheet issue={open} kinds={data?.kinds || []} onClose={() => setOpen(null)} onAct={async (b) => { const r = await act({ ...b, id: open.id }); if (r?.issue) setOpen(r.issue); }} />}
    </div>
  );
}

function CaptureSheet({ kinds, onClose, onCreate }: { kinds: any[]; onClose: () => void; onCreate: (b: Record<string, any>) => Promise<void> }) {
  const [img, setImg] = useState<{ base64: string; name: string; mime: string; url: string } | null>(null);
  const [ocr, setOcr] = useState<string>("");
  const [reading, setReading] = useState(false);
  const [f, setF] = useState({ kind: "operational", title: "", description: "", party: "", priority: "medium" });
  const [similar, setSimilar] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onFile(file: File) {
    const url = URL.createObjectURL(file);
    const base64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
    setImg({ base64, name: file.name || "photo.jpg", mime: file.type || "image/jpeg", url });
    setReading(true);
    try {
      const { runOcrThorough } = await import("@/lib/ocr");
      const res = await runOcrThorough(file, "eng", () => {});
      const text = res.text || "";
      setOcr(text);
      const lower = text.toLowerCase();
      const guess = KIND_HINTS.map((h) => ({ kind: h.kind, hits: h.words.filter((w) => lower.includes(w)).length })).sort((a, b) => b.hits - a.hits)[0];
      const vehicle = text.toUpperCase().match(/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/);
      setF((x) => ({ ...x, kind: guess && guess.hits > 0 ? guess.kind : x.kind, party: vehicle ? vehicle[0].replace(/[\s-]+/g, " ") : x.party, title: x.title || (guess && guess.hits > 0 ? `${kinds.find((k) => k.id === guess.kind)?.label || "Issue"}${vehicle ? ` — ${vehicle[0]}` : ""}` : "") }));
    } catch { /* OCR unavailable — the person types it */ } finally { setReading(false); }
  }

  useEffect(() => {
    if (!f.title && !f.party) return;
    const t = setTimeout(async () => {
      const r = await fetch("/api/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "similar", ...f }) });
      const j = await r.json().catch(() => ({})); setSimilar(j.similar || []);
    }, 400);
    return () => clearTimeout(t);
  }, [f]);

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  const kind = kinds.find((k) => k.id === f.kind);
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-bold text-biome-text"><Camera size={16} className="text-biome-leafBright" /> Camera to action</h3><button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button onClick={() => inputRef.current?.click()} className="mt-3 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-biome-line px-4 py-6 text-biome-muted hover:border-biome-leaf/40">
          {img ? <img src={img.url} alt="" className="max-h-48 rounded-xl" /> : <Camera size={24} />}
          <span className="text-[11.5px] font-semibold">{img ? "Retake / choose another" : "Take a photo or choose one"}</span>
        </button>
        {reading && <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-biome-muted"><ScanLine size={12} className="bmx-spin" /> Reading the photo…</p>}
        {ocr && <p className="mt-2 max-h-16 overflow-y-auto rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[10px] text-biome-muted">Read: {ocr.slice(0, 300)}</p>}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={input}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={input}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        </div>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What happened (short)" className={`${input} mt-2`} />
        <input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} placeholder="Vendor / client / vehicle concerned" className={`${input} mt-2`} />
        <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Details" className={`${input} mt-2 resize-none`} />

        {kind && (
          <div className="mt-3 rounded-2xl border border-biome-leaf/30 bg-biome-leaf/[.06] px-3 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-leafBright">Suggested actions</p>
            <ul className="mt-1 space-y-0.5">{kind.actions.map((a: string) => <li key={a} className="text-[11px] text-biome-text">→ {a}</li>)}</ul>
            <p className="mt-1 text-[9.5px] text-biome-muted">Raising the issue creates the Work task with the first action; evidence is attached.</p>
          </div>
        )}
        {similar.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[.06] px-3 py-2">
            <p className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-amber-600"><Lightbulb size={11} /> Similar past issues</p>
            {similar.map((s: any) => <p key={s.issue.id} className="mt-1 text-[11px] text-biome-text">• {s.issue.title} — <span className="text-biome-muted">{s.issue.resolution || s.issue.status}</span></p>)}
          </div>
        )}
        <button disabled={busy || !f.title} onClick={async () => { setBusy(true); await onCreate({ ...f, evidenceBase64: img?.base64, evidenceName: img?.name, evidenceMime: img?.mime, ocrText: ocr }); setBusy(false); }}
          className="bmx-btn mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-biome-leaf px-5 py-3.5 text-[12.5px] font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={15} className="bmx-spin" /> : <Plus size={15} />} Raise issue &amp; create task
        </button>
      </div>
    </div></Portal>
  );
}

function IssueSheet({ issue, kinds, onClose, onAct }: { issue: any; kinds: any[]; onClose: () => void; onAct: (b: Record<string, any>) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState(issue.resolution || "");
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="text-[15px] font-bold text-biome-text">{issue.title}</h3><p className="text-[10.5px] text-biome-muted">{kinds.find((k) => k.id === issue.kind)?.label} · {issue.priority} · {issue.status} · raised by {issue.raisedByName}</p></div>
          <button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button>
        </div>
        {issue.description && <p className="mt-2 text-[11.5px] text-biome-text">{issue.description}</p>}
        {issue.evidence.length > 0 && <p className="mt-2 text-[10.5px] text-biome-muted">Evidence: {issue.evidence.map((e: any) => e.name).join(", ")}</p>}
        {issue.taskId && <Link href="/work" className="mt-1 inline-block text-[11px] font-semibold text-biome-leafBright">Open the Work task →</Link>}
        <p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Timeline</p>
        <ul className="mt-1 space-y-1">{issue.timeline.map((t: any, i: number) => <li key={i} className="text-[11px] text-biome-text"><span className="text-biome-muted">{new Date(t.at).toLocaleString("en-IN")} · {t.by}:</span> {t.note}</li>)}</ul>
        <div className="mt-3 flex gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className={input} /><button onClick={async () => { await onAct({ action: "note", note }); setNote(""); }} disabled={!note} className="bmx-chip rounded-xl border border-biome-line px-3 text-[11px] font-semibold text-biome-muted disabled:opacity-50">Add</button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr,auto]">
          <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Resolution (when closing)" className={input} />
          <div className="flex gap-1.5">
            {issue.status !== "investigating" && issue.status !== "resolved" && <button onClick={() => onAct({ action: "status", status: "investigating" })} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Investigating</button>}
            {issue.status !== "resolved" && <button onClick={() => onAct({ action: "status", status: "resolved", resolution })} className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-3 py-2 text-[11px] font-bold text-white"><CheckCircle2 size={12} /> Resolve</button>}
          </div>
        </div>
      </div>
    </div></Portal>
  );
}
