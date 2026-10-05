"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from "lucide-react";
import GlassCard from "@/components/GlassCard";

interface Check {
  key: string;
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}

/**
 * Automatic health check: every link the document automation depends on,
 * each with a plain verdict — WhatsApp linked, groups chosen, messages
 * arriving, documents today, the offline OCR engine actually reading, the
 * Gemini key answering a live call, and the document folder writable.
 */
export default function HealthPanel({ compact = false }: { compact?: boolean }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/health-check${force ? "?force=1" : ""}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Health check failed (${res.status}).`);
      setChecks(j.checks || []);
      setAt(j.at || null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(false), 60000);
    return () => clearInterval(t);
  }, [load]);

  const bad = (checks || []).filter((c) => !c.ok).length;
  const warn = (checks || []).filter((c) => c.ok && c.warn).length;

  return (
    <div data-testid="health-panel"><GlassCard className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Activity size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Health check</h2>
        {checks && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
              bad ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : warn ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-[#9fe870]/30 text-biome-text"
            }`}
          >
            {bad ? `${bad} problem${bad === 1 ? "" : "s"}` : warn ? "Working, with notes" : "All good"}
          </span>
        )}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[11px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-60"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Run again
        </button>
      </div>
      {error && <p className="text-[11.5px] text-rose-600 dark:text-rose-300">{error}</p>}
      {!checks && !error && (
        <p className="flex items-center gap-2 text-[11.5px] text-biome-muted">
          <Loader2 size={13} className="animate-spin" /> Checking every part — the OCR and Gemini tests take a few seconds…
        </p>
      )}
      {checks && (
        <ul className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
          {checks.map((c) => (
            <li key={c.key} data-testid={`health-${c.key}`} className="flex items-start gap-2 rounded-xl border border-biome-line/60 bg-biome-hover px-3 py-2">
              {!c.ok ? (
                <XCircle size={14} className="mt-0.5 shrink-0 text-rose-500" />
              ) : c.warn ? (
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              ) : (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              )}
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold text-biome-text">{c.label}</p>
                <p className="break-words text-[11px] leading-relaxed text-biome-muted">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {at && <p className="mt-2 text-[10px] text-biome-muted">Checked {new Date(at).toLocaleTimeString("en-IN")}</p>}
    </GlassCard></div>
  );
}
