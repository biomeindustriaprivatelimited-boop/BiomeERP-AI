"use client";

import { useRef, useState } from "react";
import { FlaskConical, Loader2, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import GlassCard from "@/components/GlassCard";

interface Step {
  name: string;
  ok: boolean;
  detail: string;
  data?: Record<string, any>;
}
interface Result {
  name: string;
  steps: Step[];
  verdict: string;
  extracted?: Record<string, any>;
  error?: string;
  ms: number;
}

/**
 * "Upload documents to test": runs a file through EXACTLY the WhatsApp
 * reading pipeline (same OCR, same corrections, same AI second opinion,
 * same rules and matching) and shows every step — nothing is saved and no
 * WhatsApp is needed. An optional caption is used exactly as a WhatsApp
 * caption would be.
 */
export default function TestUploadPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  async function run(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    for (const f of list) {
      setBusy(f.name);
      const t0 = Date.now();
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] || "");
          r.onerror = () => rej(new Error("Could not read the file."));
          r.readAsDataURL(f);
        });
        const payload = JSON.stringify({ fileBase64: b64, fileName: f.name, mimeType: f.type || undefined, caption: caption.trim() || undefined });
        let res = await fetch("/api/whatsapp/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        // Agent not running: the same reader runs inside the app server.
        if (res.status === 503) {
          res = await fetch("/api/test-document", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        }
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Test failed (${res.status}).`);
        setResults((prev) => [{ name: f.name, steps: j.steps || [], verdict: j.verdict, extracted: j.extracted, ms: Date.now() - t0 }, ...prev].slice(0, 12));
      } catch (e) {
        setResults((prev) => [{ name: f.name, steps: [], verdict: "failed", error: (e as Error).message, ms: Date.now() - t0 }, ...prev].slice(0, 12));
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
  }

  return (
    <div data-testid="test-upload-panel"><GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <FlaskConical size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Upload documents to test</h2>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-biome-muted">
        See exactly how a document would be understood if it arrived on WhatsApp — the text read, corrections, the type, whose paper
        it is, every field, and which supply set it would join. Nothing is saved. A photo takes 10–40 seconds to read.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Optional caption, as typed in WhatsApp (e.g. JPL weight slip HR55AB1234)"
          className="bmx-input min-w-[240px] flex-1 rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/70"
        />
        <button
          onClick={() => input.current?.click()}
          disabled={Boolean(busy)}
          data-testid="test-upload-button"
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
          {busy ? `Reading ${busy}…` : "Choose documents to test"}
        </button>
        <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" className="hidden" data-testid="test-upload-input" onChange={(e) => run(e.target.files)} />
      </div>

      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          {results.map((r, i) => (
            <TestResult key={`${r.name}-${i}`} r={r} />
          ))}
        </div>
      )}
    </GlassCard></div>
  );
}

function TestResult({ r }: { r: Result }) {
  const [open, setOpen] = useState(false);
  const typeStep = r.steps.find((s) => s.name === "Document identified");
  const fields = r.steps.find((s) => s.name === "Fields extracted")?.data || {};
  const sample = r.steps.find((s) => s.name === "Text extracted")?.data?.sample;
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg/60 p-3" data-testid="test-result">
      <div className="flex flex-wrap items-center gap-2">
        {r.verdict === "ok" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertTriangle size={14} className="text-amber-500" />}
        <b className="min-w-0 flex-1 truncate text-[12px] text-biome-text" title={r.name}>{r.name}</b>
        <span className="text-[10.5px] text-biome-muted">{(r.ms / 1000).toFixed(1)} s</span>
      </div>
      {r.error && <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-300">{r.error}</p>}
      {typeStep && <p className="mt-1 text-[11.5px] text-biome-text" data-testid="test-result-type">{typeStep.detail}</p>}
      {Object.keys(fields).length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
          {Object.entries(fields).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="w-28 shrink-0 text-biome-muted">{k}</span>
              <span className="min-w-0 truncate font-mono text-biome-text">{v == null || v === "" ? "—" : String(v)}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-biome-muted hover:text-biome-text">
        <ChevronDown size={12} className={open ? "rotate-180" : ""} /> Every step{sample ? " and the text read" : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {r.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              {s.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />}
              <div className="min-w-0">
                <span className="font-semibold text-biome-text">{s.name}</span>
                {s.detail && <span className="whitespace-pre-wrap text-biome-muted"> — {s.detail}</span>}
              </div>
            </div>
          ))}
          {sample && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-biome-line bg-biome-hover p-2 font-mono text-[10.5px] text-biome-text">{sample}</pre>
          )}
        </div>
      )}
    </div>
  );
}
