"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Stethoscope,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderTree,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";

/**
 * Run one document through the whole pipeline and show every step.
 *
 * This page exists because "it isn't working" cannot be fixed by anyone.
 * Dropping a real document here turns that into "step 3 says the PDF has
 * no text layer" — which can. It needs no WhatsApp connection and saves
 * nothing; it only reports what *would* happen.
 */

interface Step {
  name: string;
  ok: boolean;
  detail: string;
  data?: any;
}

interface Result {
  steps: Step[];
  verdict: "ok" | "partial" | "failed";
  problems?: string[];
  failedAt?: string;
  extracted?: any;
}

export default function TestPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/test-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, fileName: file.name, mimeType: file.type }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      setResult(json);
      // Open the first failing step — that's the one worth reading.
      const firstBad = (json.steps || []).findIndex((s: Step) => !s.ok);
      setOpenStep(firstBad >= 0 ? firstBad : null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      <div className="pt-1">
        <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
          <Stethoscope size={20} className="text-biome-leafBright" />
          Test a document
        </h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
          Drop any real document here and see exactly what the agent reads from it and where it
          would be filed. Nothing is saved and WhatsApp doesn&apos;t need to be connected — this
          only reports what would happen.
        </p>
      </div>

      <GlassCard className="p-5">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-10 text-center transition-colors hover:border-biome-leaf/40 hover:bg-biome-leaf/[0.04]">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(f);
            }}
          />
          {busy ? (
            <Loader2 size={22} className="animate-spin text-biome-leafBright" />
          ) : (
            <Upload size={22} className="text-biome-muted" />
          )}
          <span className="text-[12.5px] font-medium text-biome-text">
            {busy ? `Reading ${fileName}…` : "Choose a document"}
          </span>
          <span className="text-[11px] text-biome-muted">
            A vendor invoice, a weight slip, a scanned bilty — anything that arrives in the group
          </span>
        </label>
      </GlassCard>

      {error && (
        <GlassCard className="flex items-start gap-2.5 border-rose-400/30 p-4">
          <XCircle size={15} className="mt-0.5 shrink-0 text-rose-400" />
          <div>
            <p className="text-xs font-medium text-biome-text">Couldn&apos;t run the test</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">{error}</p>
            <p className="mt-1.5 text-[11px] text-biome-muted">
              This test runs inside the app itself — WhatsApp does not need to be connected. If it
              still fails, the message above names the exact reason.
            </p>
          </div>
        </GlassCard>
      )}

      {result && (
        <>
          <GlassCard
            className={`p-4 ${
              result.verdict === "ok"
                ? "border-emerald-400/30"
                : result.verdict === "partial"
                  ? "border-amber-400/30"
                  : "border-rose-400/30"
            }`}
          >
            <div className="flex items-start gap-3">
              {result.verdict === "ok" ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-biome-text">
                  {result.verdict === "ok"
                    ? "Read and placed correctly"
                    : result.verdict === "partial"
                      ? "Read, but with gaps"
                      : "Could not be read"}
                </p>
                {result.problems && result.problems.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {result.problems.map((p, i) => (
                      <li key={i} className="text-[11.5px] leading-relaxed text-biome-muted">
                        • {p}
                      </li>
                    ))}
                  </ul>
                )}
                {result.verdict !== "ok" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-biome-muted">
                    Copy the failing step below and send it on — that message names the exact
                    problem.
                  </p>
                )}
              </div>
            </div>
          </GlassCard>

          <div className="space-y-2">
            {result.steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <GlassCard className="overflow-hidden">
                  <button
                    onClick={() => setOpenStep(openStep === i ? null : i)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-biome-hover"
                  >
                    <span className="mt-0.5 shrink-0">
                      {step.ok ? (
                        <CheckCircle2 size={15} className="text-emerald-500" />
                      ) : (
                        <XCircle size={15} className="text-rose-500" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-biome-text">{step.name}</p>
                      {step.detail && (
                        <p className="mt-0.5 whitespace-pre-line text-[11.5px] leading-relaxed text-biome-muted">
                          {step.detail}
                        </p>
                      )}
                    </div>
                    {step.data && (
                      <motion.span
                        animate={{ rotate: openStep === i ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-0.5 shrink-0"
                      >
                        <ChevronDown size={14} className="text-biome-muted" />
                      </motion.span>
                    )}
                  </button>

                  {openStep === i && step.data && (
                    <div className="border-t border-biome-line px-4 py-3">
                      {step.data.sample ? (
                        <>
                          <p className="mb-1.5 text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                            Text read from the page
                          </p>
                          <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-biome-line bg-biome-hover p-2.5 font-mono text-[10px] leading-relaxed text-biome-muted">
                            {step.data.sample || "(nothing)"}
                          </pre>
                        </>
                      ) : (
                        <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                          {Object.entries(step.data).map(([k, v]) => (
                            <div key={k} className="min-w-0">
                              <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/50">
                                {k.replace(/([A-Z])/g, " $1")}
                              </p>
                              <p className="truncate font-mono text-[11px] text-biome-text">
                                {v === null || v === undefined || v === ""
                                  ? "—"
                                  : Array.isArray(v)
                                    ? v.join(", ") || "—"
                                    : String(v)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            ))}
          </div>

          <GlassCard className="flex items-start gap-2.5 p-4">
            <FolderTree size={15} className="mt-0.5 shrink-0 text-biome-muted" />
            <p className="text-[11px] leading-relaxed text-biome-muted">
              Nothing was saved. To file documents for real, link WhatsApp and let them arrive in a
              watched group — or use Identify on any document already received.
            </p>
          </GlassCard>
        </>
      )}
    </div>
  );
}
