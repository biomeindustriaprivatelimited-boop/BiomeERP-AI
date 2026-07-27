"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, SlidersHorizontal, Loader2, AlertCircle, FileSpreadsheet, Download } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import Dropzone from "@/components/reconciliation/Dropzone";
import GstColumnMapper from "@/components/gst/GstColumnMapper";
import GstReturnIcon from "@/components/gst/GstReturnIcon";
import GstResultsPanel from "@/components/gst/GstResultsPanel";
import PremiumTable from "@/components/ui/PremiumTable";
import PremiumButton from "@/components/ui/PremiumButton";
import {
  GST_RETURNS,
  GstReturnType,
  GstColumnMapping,
  parseFile,
  ParsedFile,
  autoDetectGstColumns,
  reconcileInvoiceLevel,
  reconcileSummaryLevel,
  exportGstSummaryReport,
  GstReconciliationResult,
  Gstr3bSummaryRow,
  formatINR,
} from "@/lib/gst";

export default function GstCompliancePage() {
  const [activeReturn, setActiveReturn] = useState<GstReturnType>("GSTR1");
  const [returnFile, setReturnFile] = useState<ParsedFile | null>(null);
  const [booksFile, setBooksFile] = useState<ParsedFile | null>(null);
  const [returnMapping, setReturnMapping] = useState<GstColumnMapping>({});
  const [booksMapping, setBooksMapping] = useState<GstColumnMapping>({});
  const [parsingReturn, setParsingReturn] = useState(false);
  const [parsingBooks, setParsingBooks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<GstReconciliationResult | null>(null);
  const [summaryResult, setSummaryResult] = useState<Gstr3bSummaryRow[] | null>(null);

  const meta = GST_RETURNS.find((r) => r.key === activeReturn)!;
  const isSummary = activeReturn === "GSTR3B";

  function switchReturn(type: GstReturnType) {
    setActiveReturn(type);
    setInvoiceResult(null);
    setSummaryResult(null);
    setError(null);
  }

  async function handleFile(side: "return" | "books", file: File) {
    setError(null);
    side === "return" ? setParsingReturn(true) : setParsingBooks(true);
    try {
      const parsed = await parseFile(file);
      if (!parsed.headers.length) throw new Error(`"${file.name}" looks empty or unreadable.`);
      const mapping = autoDetectGstColumns(parsed.headers);
      if (side === "return") {
        setReturnFile(parsed);
        setReturnMapping(mapping);
      } else {
        setBooksFile(parsed);
        setBooksMapping(mapping);
      }
      setInvoiceResult(null);
      setSummaryResult(null);
    } catch (err: any) {
      setError(err?.message || "Could not parse that file. Try a CSV or Excel export.");
    } finally {
      side === "return" ? setParsingReturn(false) : setParsingBooks(false);
    }
  }

  const readyToRun = Boolean(
    returnFile &&
      booksFile &&
      (isSummary
        ? returnMapping.taxableValue || returnMapping.cgst || returnMapping.igst
        : returnMapping.invoiceNo && booksMapping.invoiceNo)
  );

  function runReconciliation() {
    if (!returnFile || !booksFile) return;
    setRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        if (isSummary) {
          setSummaryResult(reconcileSummaryLevel(returnFile, booksFile, returnMapping, booksMapping));
        } else {
          setInvoiceResult(reconcileInvoiceLevel(returnFile, booksFile, returnMapping, booksMapping));
        }
      } catch (err: any) {
        setError(err?.message || "Reconciliation failed — check the column mapping and try again.");
      } finally {
        setRunning(false);
      }
    }, 350);
  }

  return (
    <div className="space-y-6 pb-12">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-biome-leafBright">
          <ShieldCheck size={14} /> GST Compliance
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-biome-text">
          Reconcile your GST returns against books
        </h1>
        <p className="mt-1 text-sm text-biome-muted">
          Compare GSTR-1, GSTR-2B, or GSTR-3B against your own sales / purchase / tax records — spot mismatches
          before you file.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GST_RETURNS.map((r, i) => {
          const active = activeReturn === r.key;
          return (
            <motion.button
              key={r.key}
              onClick={() => switchReturn(r.key)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              whileHover={{ y: -3 }}
              className={`energy-pulse-border glass flex items-center gap-3 rounded-2xl p-4 text-left transition-colors ${
                active ? "is-active border-biome-leaf/50 bg-biome-leaf/[0.06]" : ""
              }`}
            >
              <GstReturnIcon type={r.key} />
              <div>
                <p className="font-display text-sm font-semibold text-biome-text">{r.label}</p>
                <p className="text-[11px] text-biome-muted">{r.subtitle}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      <GlassCard className="p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Dropzone
            label={`${meta.label} (Government portal export)`}
            hint="JSON→Excel, CSV, or XLSX export from the GST portal"
            fileName={returnFile?.fileName ?? null}
            rowCount={returnFile?.rows.length ?? null}
            onFile={(f) => handleFile("return", f)}
            onClear={() => {
              setReturnFile(null);
              setReturnMapping({});
              setInvoiceResult(null);
              setSummaryResult(null);
            }}
            accentClass="text-biome-leafBright"
          />
          <Dropzone
            label={meta.booksLabel}
            hint="Your own accounting export — CSV or XLSX"
            fileName={booksFile?.fileName ?? null}
            rowCount={booksFile?.rows.length ?? null}
            onFile={(f) => handleFile("books", f)}
            onClear={() => {
              setBooksFile(null);
              setBooksMapping({});
              setInvoiceResult(null);
              setSummaryResult(null);
            }}
            accentClass="text-biome-skyBright"
          />
        </div>

        {(parsingReturn || parsingBooks) && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-biome-muted">
            <Loader2 size={13} className="animate-spin" /> Reading file…
          </p>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-biome-bolt">
            <AlertCircle size={13} /> {error}
          </p>
        )}

        {returnFile && booksFile && (
          <div className="mt-6 space-y-5 border-t border-biome-line/50 pt-5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-biome-muted">
              <SlidersHorizontal size={13} /> Column mapping (auto-detected — adjust if needed)
            </p>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <GstColumnMapper title={meta.label} headers={returnFile.headers} mapping={returnMapping} onChange={setReturnMapping} />
              <GstColumnMapper title={meta.booksLabel} headers={booksFile.headers} mapping={booksMapping} onChange={setBooksMapping} />
            </div>

            <PremiumButton onClick={runReconciliation} disabled={!readyToRun || running}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              {running ? "Reconciling…" : `Reconcile ${meta.label} vs Books`}
            </PremiumButton>
          </div>
        )}
      </GlassCard>

      {invoiceResult && !isSummary && <GstResultsPanel result={invoiceResult} returnLabel={meta.label} />}

      {summaryResult && isSummary && (
        <GlassCard className="p-5">
          <p className="mb-4 font-display text-sm font-semibold text-biome-text">GSTR-3B vs Books — summary comparison</p>
          <PremiumTable
            columns={[
              { key: "label", header: "Field" },
              { key: "returnValue", header: "As per GSTR-3B", accessor: (r) => r.returnValue, render: (r) => formatINR(r.returnValue) },
              { key: "booksValue", header: "As per Books", accessor: (r) => r.booksValue, render: (r) => formatINR(r.booksValue) },
              {
                key: "diff",
                header: "Difference",
                accessor: (r) => r.diff,
                render: (r) => (
                  <span className={r.status === "mismatch" ? "text-biome-bolt" : "text-biome-leafBright"}>
                    {formatINR(r.diff)}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (r) =>
                  r.status === "mismatch" ? (
                    <span className="rounded-full bg-biome-bolt/15 px-2 py-0.5 text-[10px] text-biome-bolt">Mismatch</span>
                  ) : (
                    <span className="rounded-full bg-biome-leaf/15 px-2 py-0.5 text-[10px] text-biome-leafBright">Matched</span>
                  ),
              },
            ]}
            rows={summaryResult}
            emptyLabel="No comparison rows."
            maxHeight="24rem"
          />
          <div className="mt-4 flex gap-2">
            <PremiumButton onClick={() => exportGstSummaryReport(summaryResult, "gstr3b-summary.xlsx", "excel")} variant="secondary">
              <FileSpreadsheet size={13} /> Excel Report
            </PremiumButton>
            <PremiumButton onClick={() => exportGstSummaryReport(summaryResult, "gstr3b-summary.csv", "csv")} variant="ghost">
              <Download size={13} /> CSV
            </PremiumButton>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
