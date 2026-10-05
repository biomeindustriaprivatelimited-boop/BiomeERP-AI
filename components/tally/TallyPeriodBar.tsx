"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Info, Loader2 } from "lucide-react";
import {
  PERIOD_PRESETS,
  periodDates,
  validateCustom,
  type ResolvedPeriod,
  type TallyPeriodChoice,
  type TallyPeriodPreset,
  type TallyProgressInfo,
} from "@/lib/tallyPeriod";

/**
 * Period selector + "what period these figures are for" + progress while a
 * long period is read from Tally piece by piece. Used on the home Finance
 * Command Center and on every Tally ledger / transaction / report page.
 */
export default function TallyPeriodBar({
  choice,
  onChange,
  period,
  loading,
  progress,
  className = "",
  showAsOn = true,
}: {
  choice: TallyPeriodChoice;
  onChange: (c: TallyPeriodChoice) => void;
  /** The period as the server resolved it (null while loading / on error). */
  period?: ResolvedPeriod | null;
  loading?: boolean;
  progress?: TallyProgressInfo | null;
  className?: string;
  /** Show "balances as on …" (pages with balance-sheet figures). */
  showAsOn?: boolean;
}) {
  const initial = periodDates(choice);
  const [from, setFrom] = useState(choice.from || (initial.fromDate === "books" ? "" : initial.fromDate));
  const [to, setTo] = useState(choice.to || initial.toDate);
  const [customOpen, setCustomOpen] = useState(choice.preset === "custom");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCustomOpen(choice.preset === "custom");
    if (choice.preset === "custom") {
      setFrom(choice.from || "");
      setTo(choice.to || "");
    }
  }, [choice.preset, choice.from, choice.to]);

  function pick(id: TallyPeriodPreset) {
    setErr(null);
    if (id === "custom") {
      // Start the custom range from what is on screen now.
      const cur = period ?? null;
      if (cur?.from) setFrom(cur.from);
      if (cur?.to) setTo(cur.to);
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange({ preset: id });
  }

  function applyCustom() {
    const e = validateCustom(from, to);
    setErr(e);
    if (!e) onChange({ preset: "custom", from, to });
  }

  const selectValue: TallyPeriodPreset = customOpen ? "custom" : choice.preset;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const inputCls =
    "rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-[12px] text-biome-text outline-none focus:border-biome-leaf/40";

  return (
    <div className={`glass rounded-2xl px-4 py-3 ${className}`} data-testid="tally-period-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-biome-text">
          <CalendarRange size={14} className="text-biome-leafBright" />
          Period
        </span>
        <select
          aria-label="Period"
          value={selectValue}
          onChange={(e) => pick(e.target.value as TallyPeriodPreset)}
          className={inputCls}
          data-testid="tally-period-select"
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="bg-biome-surface text-biome-text">
              {p.label}
            </option>
          ))}
        </select>
        {customOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-biome-muted">
              From
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} data-testid="tally-period-from" />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-biome-muted">
              To
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} data-testid="tally-period-to" />
            </label>
            <button
              onClick={applyCustom}
              disabled={loading}
              className="rounded-lg bg-biome-leaf/15 px-3 py-1.5 text-[12px] font-medium text-biome-leafBright transition-colors hover:bg-biome-leaf/25 disabled:opacity-50"
              data-testid="tally-period-apply"
            >
              Show
            </button>
          </div>
        )}

        {/* The period the figures on screen are actually for */}
        <div className="ml-auto min-w-0 text-right">
          {period?.label ? (
            <p className="text-[12px] text-biome-text" data-testid="tally-period-active">
              <span className="font-semibold">{period.label}</span>
              {period.range && period.range !== period.label ? (
                <span className="text-biome-muted"> · {period.range}</span>
              ) : null}
            </p>
          ) : loading ? (
            <p className="text-[12px] text-biome-muted">Reading Tally…</p>
          ) : null}
          {period?.asOn && showAsOn && (
            <p className="text-[10.5px] text-biome-muted">
              Sales &amp; purchases = movement in this period · balances (cash, bank, receivables, payables) as on {period.asOn}
            </p>
          )}
        </div>
      </div>

      {err && <p className="mt-2 text-[11.5px] font-medium text-rose-500">{err}</p>}

      {period?.notes && period.notes.length > 0 && !loading && (
        <div className="mt-2 space-y-0.5">
          {period.notes.map((n, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] text-biome-muted" data-testid="tally-period-note">
              <Info size={12} className="mt-0.5 shrink-0 text-biome-bolt" />
              {n}
            </p>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-2.5" data-testid="tally-progress">
          <div className="flex items-center gap-2 text-[11px] text-biome-muted">
            <Loader2 size={12} className="animate-spin text-biome-leafBright" />
            <span className="min-w-0 truncate">
              {progress?.label || "Connecting to Tally…"}
              {progress && progress.total > 1 && progress.phase !== "company" ? ` (${Math.min(progress.done, progress.total)} of ${progress.total})` : ""}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-biome-line/70">
            <div
              className={`h-full rounded-full bg-biome-leafBright transition-all duration-300 ${pct === null ? "w-1/4 animate-pulse" : ""}`}
              style={pct === null ? undefined : { width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
