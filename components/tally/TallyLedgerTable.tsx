"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, AlertCircle, FileSpreadsheet, RefreshCw, LucideIcon } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { getTallySettings } from "@/lib/preferences";
import { TallyLedgerMaster } from "@/lib/tally";
import { downloadExcelWorkbook, formatINR } from "@/lib/reconciliation";
import { postTallyStream } from "@/lib/tallyClient";
import { useTallyPeriod, type ResolvedPeriod, type TallyProgressInfo } from "@/lib/tallyPeriod";
import TallyPeriodBar from "@/components/tally/TallyPeriodBar";

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Case-insensitive substrings matched against the ledger's Tally
   *  group ("Parent") — e.g. ["sundry creditor"] for Vendors. Leave
   *  empty to show every ledger (used by the general Ledgers page). */
  groupKeywords?: string[];
}

export default function TallyLedgerTable({ title, description, icon: Icon, groupKeywords = [] }: Props) {
  const [ledgers, setLedgers] = useState<TallyLedgerMaster[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [basis, setBasis] = useState<string | null>(null);
  const [period, setPeriod] = useState<ResolvedPeriod | null>(null);
  const [progress, setProgress] = useState<TallyProgressInfo | null>(null);
  const { choice, setChoice, dates } = useTallyPeriod();
  const abortRef = useRef<AbortController | null>(null);
  const { fromDate, toDate } = dates;

  const fetchLedgers = useCallback(
    async (fresh: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setProgress(null);
      // Never show one period's balances under another period's heading.
      setLedgers(null);
      setPeriod(null);
      setBasis(null);
      try {
        const settings = getTallySettings();
        const { ok, json: data } = await postTallyStream(
          "/api/tally/ledgers",
          { ...settings, fromDate, toDate, fresh },
          { signal: ctrl.signal, onProgress: (p) => !ctrl.signal.aborted && setProgress(p) }
        );
        if (ctrl.signal.aborted) return;
        if (!ok || data.error) throw new Error(data.error || "Could not fetch from Tally.");
        setLedgers(data.ledgers);
        setPeriod(data.period ?? null);
        setBasis(
          data.company
            ? `${data.company} · read ${new Date(data.fetchedAt).toLocaleTimeString("en-IN")}`
            : null
        );
      } catch (err: any) {
        if (ctrl.signal.aborted || err?.name === "AbortError") return;
        setError(err?.message || "Could not fetch from Tally. Check Settings → Tally Integration.");
        setLedgers(null);
        setBasis(null);
      } finally {
        if (abortRef.current === ctrl) {
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [fromDate, toDate]
  );

  useEffect(() => {
    fetchLedgers(false);
    return () => abortRef.current?.abort();
  }, [fetchLedgers]);

  const openingHead = period?.openingOn ? `Opening (${period.openingOn})` : "Opening Balance";
  const closingHead = period?.asOn ? `Closing (as on ${period.asOn})` : "Closing Balance";

  const filtered = useMemo(() => {
    if (!ledgers) return [];
    let rows = ledgers;
    if (groupKeywords.length) {
      // Match the immediate group AND the Tally group above it, so parties
      // in sub-groups (e.g. "Debtors - NTPC" under Sundry Debtors) count.
      rows = rows.filter((l) =>
        groupKeywords.some((kw) =>
          [l.group, l.reservedGroup, l.primaryGroup].some((g) =>
            (g || "").toLowerCase().includes(kw.toLowerCase())
          )
        )
      );
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((l) => l.name.toLowerCase().includes(q));
    }
    return rows;
  }, [ledgers, groupKeywords, query]);

  // Tally sign: Dr negative, Cr positive. Summed as-is, then shown Dr/Cr.
  const totalClosing = filtered.reduce((sum, l) => sum + l.closingBalance, 0);

  function exportExcel() {
    downloadExcelWorkbook(
      {
        [title]: filtered.map((l) => ({
          Name: l.name,
          Group: l.group ?? "",
          "Tally Group": l.reservedGroup ?? "",
          Period: period ? `${period.label ?? ""} (${period.range ?? `${period.from} to ${period.to}`})` : "",
          [openingHead]: Math.abs(l.openingBalance),
          "Opening Dr/Cr": drCr(l.openingBalance),
          [l.movement ? "Movement in period" : closingHead]: Math.abs(l.closingBalance),
          "Closing Dr/Cr": drCr(l.closingBalance),
          "Closing is": l.movement ? "movement in the period" : `balance as on ${period?.asOn ?? ""}`,
        })),
      },
      `${title.toLowerCase().replace(/\s+/g, "-")}.xlsx`
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-6">
      <GlassCard activeBorder className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-biome-leaf/12 p-3">
            <Icon size={24} className="text-biome-leafBright" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-biome-text md:text-2xl">
              {title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-biome-muted">{description}</p>
          </div>
        </div>
      </GlassCard>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      <TallyPeriodBar choice={choice} onChange={setChoice} period={period} loading={loading} progress={progress} showAsOn={false} />

      <GlassCard delay={0.05} className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-biome-line bg-biome-hover px-3 py-2">
            <Search size={14} className="text-biome-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="flex-1 bg-transparent text-xs text-biome-text outline-none placeholder:text-biome-muted/60"
            />
          </div>
          <PremiumButton variant="ghost" onClick={() => fetchLedgers(true)} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh from Tally
          </PremiumButton>
          <PremiumButton variant="ghost" onClick={exportExcel} disabled={!filtered.length}>
            <FileSpreadsheet size={13} /> Export Excel
          </PremiumButton>
        </div>

        {loading && !ledgers && (
          <p className="flex items-center gap-2 py-8 text-xs text-biome-muted">
            <Loader2 size={13} className="animate-spin" /> Fetching from Tally{progress?.label ? ` — ${progress.label}` : "…"}
          </p>
        )}
        {period && ledgers && (
          <p className="mb-3 text-[11px] text-biome-muted">
            Balance-sheet ledgers (cash, bank, parties, taxes): closing balance as on {period.asOn}. Sales, purchase,
            expense and income ledgers: movement within {period.label}.
          </p>
        )}

        {!loading && ledgers && filtered.length === 0 && !error && (
          <p className="py-8 text-center text-xs text-biome-muted">
            No matching ledgers found{groupKeywords.length ? " in this group" : ""}.
          </p>
        )}

        {filtered.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between text-[11px] text-biome-muted">
              <span>
                {filtered.length} ledgers{period?.label ? ` · ${period.label}` : ""}{basis ? ` · ${basis}` : ""}
              </span>
              <span>
                Total closing balance:{" "}
                <span className="font-medium text-biome-text">{formatDrCr(totalClosing)}</span>
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-biome-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-biome-hover text-biome-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Group</th>
                    <th className="px-3 py-2 text-right font-medium">{openingHead}</th>
                    <th className="px-3 py-2 text-right font-medium">{closingHead}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, i) => (
                    <motion.tr
                      key={l.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.01, 0.3) }}
                      className="border-t border-biome-line/60"
                    >
                      <td className="px-3 py-2 text-biome-text">{l.name}</td>
                      <td className="px-3 py-2 text-biome-muted">
                        {l.group ?? "—"}
                        {l.reservedGroup && l.reservedGroup !== l.group && (
                          <span className="ml-1 text-[10px] text-biome-muted/70">({l.reservedGroup})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-biome-muted">
                        {formatDrCr(l.openingBalance)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-biome-text">
                        {formatDrCr(l.closingBalance)}
                        {l.movement && (
                          <span className="block text-[9.5px] font-normal text-biome-muted">movement in period</span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}

/** Tally's XML sign: Dr negative, Cr positive. */
function drCr(n: number): string {
  return n < 0 ? "Dr" : n > 0 ? "Cr" : "";
}

function formatDrCr(n: number): string {
  if (!n) return formatINR(0);
  return `${formatINR(Math.abs(n))} ${drCr(n)}`;
}
