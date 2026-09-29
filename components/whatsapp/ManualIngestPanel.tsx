"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * Put documents into the automation by hand — papers that came by email,
 * were scanned at the office, or arrived while WhatsApp was not linked.
 * Each file takes exactly the WhatsApp path: read, match the supply
 * reference, hold vendor papers until our invoice arrives, file, and
 * appear in Supply sets.
 */
export default function ManualIngestPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; text: string }[]>([]);

  async function send(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const out: { name: string; ok: boolean; text: string }[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] || "");
          r.onerror = () => rej(new Error("Could not read the file."));
          r.readAsDataURL(f);
        });
        const res = await fetch("/api/whatsapp/ingest", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileBase64: b64, fileName: f.name, mimeType: f.type || undefined, senderName: "Manual upload" }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Failed (${res.status}).`);
        const rec = j.record || {};
        const type = rec.extracted?.documentType ? String(rec.extracted.documentType).replace(/_/g, " ") : "document";
        const where =
          rec.bucket === "filed" ? `filed → ${rec.relativePath || ""}`
          : rec.bucket === "_Staged" ? "held — waiting for our invoice with the same reference"
          : rec.bucket === "_Duplicate" ? "already received earlier (duplicate)"
          : rec.aiMessage || rec.bucket || "saved";
        out.push({ name: f.name, ok: rec.bucket !== "_Duplicate", text: `${type} · ${where}` });
      } catch (e) {
        out.push({ name: f.name, ok: false, text: (e as Error).message });
      }
      setResults([...out]);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <FileUp size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Add documents by hand</h2>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
        Papers that came by email or were scanned at the office go through the same automation as WhatsApp:
        read, matched to the supply reference, held or filed, and shown in Supply sets. PDF, JPG or PNG — up to 20 at a time.
      </p>
      <button onClick={() => input.current?.click()} disabled={busy}
        className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
        {busy ? <Loader2 size={13} className="bmx-spin" /> : <FileUp size={13} />} Choose documents
      </button>
      <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" className="hidden" onChange={(e) => send(e.target.files)} />
      {results.length > 0 && (
        <div className="mt-3 rounded-xl border border-biome-line bg-biome-bg/60 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">This upload · {results.length}</span>
          {!busy && <button onClick={() => setResults([])} className="text-[10.5px] font-semibold text-biome-muted hover:text-biome-text">Clear</button>}
        </div>
        <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              {r.ok ? <CheckCircle2 size={13} className="mt-px shrink-0 text-emerald-600" /> : <AlertTriangle size={13} className="mt-px shrink-0 text-amber-500" />}
              <span className="text-biome-text"><b>{r.name}</b> — <span className="text-biome-muted">{r.text}</span></span>
            </li>
          ))}
        </ul>
        </div>
      )}
    </GlassCard>
  );
}
