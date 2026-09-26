"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FileCheck2, Sparkles, AlertCircle, SlidersHorizontal, Loader2, Database } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useNotifications } from "@/lib/notifications";
import Dropzone from "@/components/reconciliation/Dropzone";
import ColumnMapper from "@/components/reconciliation/ColumnMapper";
import ResultsPanel from "@/components/reconciliation/ResultsPanel";
import { getTallySettings } from "@/lib/preferences";
import { tallyRowsToParsedFile } from "@/lib/tally";
import {
  ParsedFile,
  ColumnMapping,
  parseFile,
  autoDetectColumns,
  reconcile,
  ReconciliationResult,
} from "@/lib/reconciliation";

function defaultFromDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReconciliationPage() {
  const [fileA, setFileA] = useState<ParsedFile | null>(null);
  const [fileB, setFileB] = useState<ParsedFile | null>(null);
  const [mappingA, setMappingA] = useState<ColumnMapping>({});
  const [mappingB, setMappingB] = useState<ColumnMapping>({});
  const [parsingA, setParsingA] = useState(false);
  const [parsingB, setParsingB] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(1);
  const [compareDate, setCompareDate] = useState(true);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [running, setRunning] = useState(false);
  const { notify } = useNotifications();

  const [tallyFrom, setTallyFrom] = useState(defaultFromDate());
  const [tallyTo, setTallyTo] = useState(defaultToDate());
  const [tallyFetching, setTallyFetching] = useState<"A" | "B" | null>(null);

  async function fetchFromTally(side: "A" | "B") {
    setError(null);
    setTallyFetching(side);
    side === "A" ? setParsingA(true) : setParsingB(true);
    try {
      const settings = getTallySettings();
      const res = await fetch("/api/tally/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          companyName: settings.companyName || undefined,
          fromDate: tallyFrom,
          toDate: tallyTo,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not fetch from Tally.");
      }
      const parsed = tallyRowsToParsedFile(
        data.rows,
        `Tally (${tallyFrom} to ${tallyTo})`
      );
      const mapping = autoDetectColumns(parsed.headers, parsed.rows);
      if (side === "A") {
        setFileA(parsed);
        setMappingA(mapping);
      } else {
        setFileB(parsed);
        setMappingB(mapping);
      }
      setResult(null);
      notify({
        kind: "success",
        title: "Fetched from Tally",
        detail: `${data.rows.length} vouchers loaded into Ledger ${side}.`,
      });
    } catch (err: any) {
      setError(
        err?.message ||
          "Could not fetch from Tally. Check Settings → Tally Integration and try Test Connection."
      );
    } finally {
      setTallyFetching(null);
      side === "A" ? setParsingA(false) : setParsingB(false);
    }
  }

  const nameA = fileA?.fileName.replace(/\.(csv|xlsx|xls)$/i, "") || "Ledger A";
  const nameB = fileB?.fileName.replace(/\.(csv|xlsx|xls)$/i, "") || "Ledger B";

  const hasMatchKey = (m: ColumnMapping) =>
    Boolean(m.invoiceNo || (m.party && (m.amount || m.sale || m.purchase || m.payment || m.receipt)));
  const readyToRun = Boolean(fileA && fileB && hasMatchKey(mappingA) && hasMatchKey(mappingB));

  async function handleFile(side: "A" | "B", file: File) {
    setError(null);
    side === "A" ? setParsingA(true) : setParsingB(true);
    try {
      const parsed = await parseFile(file);
      if (!parsed.headers.length) {
        throw new Error(`"${file.name}" looks empty or unreadable.`);
      }
      const mapping = autoDetectColumns(parsed.headers, parsed.rows);
      if (side === "A") {
        setFileA(parsed);
        setMappingA(mapping);
      } else {
        setFileB(parsed);
        setMappingB(mapping);
      }
      setResult(null);
    } catch (err: any) {
      setError(err?.message || "Could not parse that file. Try a CSV or Excel export.");
    } finally {
      side === "A" ? setParsingA(false) : setParsingB(false);
    }
  }

  function clearFile(side: "A" | "B") {
    if (side === "A") {
      setFileA(null);
      setMappingA({});
    } else {
      setFileB(null);
      setMappingB({});
    }
    setResult(null);
  }

  function runReconciliation() {
    if (!fileA || !fileB) return;
    setRunning(true);
    setError(null);
    // Small timeout keeps the UI responsive & shows the loading state
    // even on very fast, small ledgers.
    setTimeout(() => {
      try {
        const res = reconcile(fileA.rows, mappingA, fileB.rows, mappingB, {
          amountTolerance: tolerance,
          compareDate,
        });
        setResult(res);
        notify({
          kind: res.discrepancies.length > 0 ? "warning" : "success",
          title: "Reconciliation complete",
          detail: `${res.matched.length} matched, ${res.discrepancies.length} discrepancies`,
        });
      } catch (err: any) {
        setError(err?.message || "Reconciliation failed. Check your column mapping and try again.");
      } finally {
        setRunning(false);
      }
    }, 150);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-6">
      {/* Header */}
      <GlassCard activeBorder className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-biome-leaf/12 p-3">
            <FileCheck2 size={24} className="text-biome-leafBright" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-biome-text md:text-2xl">
              Ledger Reconciliation
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-biome-muted">
              Upload Ledger A and Ledger B. The app auto-detects invoice, party, date and amount columns and can reconcile even when invoice numbers are absent or exported differently. Everything runs locally in your browser.
            </p>
          </div>
        </div>
      </GlassCard>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Fetch from Tally */}
      <GlassCard delay={0.03} className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-biome-muted">
            <Database size={15} className="text-biome-leafBright" />
            <span className="text-xs">Fetch vouchers straight from Tally:</span>
          </div>
          <label className="text-[11px] text-biome-muted">
            From
            <input
              type="date"
              value={tallyFrom}
              onChange={(e) => setTallyFrom(e.target.value)}
              className="mt-0.5 block rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
            />
          </label>
          <label className="text-[11px] text-biome-muted">
            To
            <input
              type="date"
              value={tallyTo}
              onChange={(e) => setTallyTo(e.target.value)}
              className="mt-0.5 block rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
            />
          </label>
          <PremiumButton
            variant="ghost"
            onClick={() => fetchFromTally("A")}
            disabled={tallyFetching !== null}
          >
            {tallyFetching === "A" ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
            Fetch into Ledger A
          </PremiumButton>
          <PremiumButton
            variant="ghost"
            onClick={() => fetchFromTally("B")}
            disabled={tallyFetching !== null}
          >
            {tallyFetching === "B" ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
            Fetch into Ledger B
          </PremiumButton>
        </div>
        <p className="mt-2 text-[10px] text-biome-muted/70">
          Needs the TDL loaded in Tally and connection details set once in Settings → Tally Integration. You can also upload CSV, Excel or PDF ledgers from any accounting software. If invoice numbers differ, the offline engine falls back to party + date + amount matching.
        </p>
      </GlassCard>

      {/* Upload */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GlassCard delay={0.05} className="p-5">
          <Dropzone
            label="Ledger A"
            hint="e.g. your internal purchase / sales ledger"
            fileName={fileA?.fileName ?? null}
            rowCount={parsingA ? null : fileA?.rows.length ?? null}
            onFile={(f) => handleFile("A", f)}
            onClear={() => clearFile("A")}
            accentClass="text-biome-leafBright"
          />
        </GlassCard>
        <GlassCard delay={0.1} className="p-5">
          <Dropzone
            label="Ledger B"
            hint="e.g. vendor / party statement to reconcile against"
            fileName={fileB?.fileName ?? null}
            rowCount={parsingB ? null : fileB?.rows.length ?? null}
            onFile={(f) => handleFile("B", f)}
            onClear={() => clearFile("B")}
            accentClass="text-biome-skyBright"
          />
        </GlassCard>
      </div>

      {/* Column mapping */}
      {fileA && fileB && (
        <GlassCard delay={0.1} className="p-5 md:p-6">
          <div className="mb-4 flex items-center gap-2 text-biome-muted">
            <Sparkles size={15} className="text-biome-leafBright" />
            <p className="text-xs">
              Columns are auto-detected from your headers. Correct anything that looks wrong
              before running — this is what drives match accuracy.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <ColumnMapper
              title={`${nameA} columns`}
              headers={fileA.headers}
              mapping={mappingA}
              onChange={setMappingA}
            />
            <ColumnMapper
              title={`${nameB} columns`}
              headers={fileB.headers}
              mapping={mappingB}
              onChange={setMappingB}
            />
          </div>

          {/* Settings + Run */}
          <div className="mt-6 flex flex-col gap-4 border-t border-biome-line pt-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-biome-muted">
                <SlidersHorizontal size={14} />
                Amount tolerance
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={tolerance}
                  onChange={(e) => setTolerance(Math.max(0, Number(e.target.value)))}
                  className="w-16 rounded-lg border border-biome-line bg-biome-hover px-2 py-1 text-center text-xs text-biome-text outline-none focus:border-biome-leaf"
                />
                <span>₹</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-biome-muted">
                <input
                  type="checkbox"
                  checked={compareDate}
                  onChange={(e) => setCompareDate(e.target.checked)}
                  className="h-3.5 w-3.5 accent-biome-leaf"
                />
                Flag invoice date mismatches
              </label>
            </div>

            <PremiumButton disabled={!readyToRun || running} onClick={runReconciliation}>
              {running ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Matching…
                </>
              ) : (
                <>
                  <FileCheck2 size={16} /> Run Reconciliation
                </>
              )}
            </PremiumButton>
          </div>

          {!mappingA.invoiceNo || !mappingB.invoiceNo ? (
            <p className="mt-3 text-xs text-biome-bolt">
              Map an Invoice No column on both ledgers to enable matching.
            </p>
          ) : null}
        </GlassCard>
      )}

      {/* Results */}
      {running && !result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p className="mb-2 text-xs text-biome-muted">Matching entries…</p>
          <SkeletonTable rows={5} cols={6} />
        </motion.div>
      )}
      {result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <ResultsPanel result={result} mappingA={mappingA} mappingB={mappingB} nameA={nameA} nameB={nameB} />
        </motion.div>
      )}
    </div>
  );
}
