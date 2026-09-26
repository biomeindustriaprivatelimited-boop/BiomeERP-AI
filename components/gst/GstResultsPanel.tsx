"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  FileMinus2,
  FilePlus2,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import AnimatedCounter from "@/components/AnimatedCounter";
import {
  GstReconciliationResult,
  formatINR,
  exportGstInvoiceReport,
} from "@/lib/gst";

type TabKey = "mismatches" | "matched" | "onlyReturn" | "onlyBooks";

export default function GstResultsPanel({
  result,
  returnLabel,
}: {
  result: GstReconciliationResult;
  returnLabel: string;
}) {
  const [tab, setTab] = useState<TabKey>("mismatches");

  const total =
    result.matched.length + result.mismatches.length + result.onlyInReturn.length + result.onlyInBooks.length;
  const accuracy = total > 0 ? (result.matched.length / total) * 100 : 0;

  const TABS: { key: TabKey; label: string; count: number; icon: any; color: string }[] = [
    { key: "mismatches", label: "Mismatches", count: result.mismatches.length, icon: AlertTriangle, color: "text-biome-bolt" },
    { key: "matched", label: "Fully Matched", count: result.matched.length, icon: CheckCircle2, color: "text-biome-leafBright" },
    { key: "onlyReturn", label: `Only in ${returnLabel}`, count: result.onlyInReturn.length, icon: FilePlus2, color: "text-biome-skyBright" },
    { key: "onlyBooks", label: "Only in Books", count: result.onlyInBooks.length, icon: FileMinus2, color: "text-biome-muted" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GlassCard className="p-4">
          <p className="text-[11px] text-biome-muted">Match Accuracy</p>
          <p className="mt-1 font-display text-2xl font-semibold text-biome-leafBright">
            <AnimatedCounter value={accuracy} decimals={1} suffix="%" />
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-biome-muted">Taxable Value ({returnLabel})</p>
          <p className="mt-1 font-display text-xl font-semibold text-biome-text">
            {formatINR(result.totals.returnTaxableValue)}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-biome-muted">Taxable Value (Books)</p>
          <p className="mt-1 font-display text-xl font-semibold text-biome-text">
            {formatINR(result.totals.booksTaxableValue)}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-biome-muted">Tax Gap</p>
          <p className="mt-1 font-display text-xl font-semibold text-biome-bolt">
            {formatINR(result.totals.returnTax - result.totals.booksTax)}
          </p>
        </GlassCard>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright"
                    : "border-biome-line text-biome-muted hover:text-biome-text"
                }`}
              >
                <Icon size={13} className={active ? t.color : ""} />
                {t.label}
                <span className="rounded-full bg-biome-hover px-1.5 py-0.5 text-[10px]">{t.count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => exportGstInvoiceReport(result, returnLabel, `${returnLabel.toLowerCase()}-reconciliation.xlsx`, "excel")}
            className="flex items-center gap-1.5 rounded-full border border-biome-leaf/40 bg-biome-leaf/10 px-3 py-1.5 text-xs text-biome-leafBright transition-colors hover:bg-biome-leaf/20"
          >
            <FileSpreadsheet size={13} /> Excel Report
          </button>
          <button
            onClick={() => exportGstInvoiceReport(result, returnLabel, `${returnLabel.toLowerCase()}-mismatches.csv`, "csv")}
            className="flex items-center gap-1.5 rounded-full border border-biome-line px-3 py-1.5 text-xs text-biome-muted transition-colors hover:text-biome-text"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      <GlassCard className="overflow-hidden p-0">
        <div className="max-h-[420px] overflow-auto">
          <AnimatePresence mode="wait">
            <motion.table
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full text-left text-xs"
            >
              <thead className="sticky top-0 bg-biome-bgSoft/95 text-biome-muted backdrop-blur">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Invoice No</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">GSTIN</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                  {(tab === "mismatches" || tab === "matched") && (
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Field differences</th>
                  )}
                  {(tab === "onlyReturn" || tab === "onlyBooks") && (
                    <>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Taxable Value</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Total Tax</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {tab === "mismatches" &&
                  result.mismatches.map((m, i) => (
                    <tr key={i} className="border-t border-biome-line/40">
                      <td className="whitespace-nowrap px-3 py-2 text-biome-text">{m.invoiceNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{m.gstin}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{m.invoiceDate ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-bolt">
                        {m.fieldDiffs.map((d) => `${d.label}: ${formatINR(d.diff)}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                {tab === "matched" &&
                  result.matched.map((m, i) => (
                    <tr key={i} className="border-t border-biome-line/40">
                      <td className="whitespace-nowrap px-3 py-2 text-biome-text">{m.invoiceNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{m.gstin}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{m.invoiceDate ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-leafBright">Fully matched</td>
                    </tr>
                  ))}
                {tab === "onlyReturn" &&
                  result.onlyInReturn.map((e, i) => (
                    <tr key={i} className="border-t border-biome-line/40">
                      <td className="whitespace-nowrap px-3 py-2 text-biome-text">{e.invoiceNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{e.gstin}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{e.invoiceDate ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-text">{formatINR(e.taxableValue)}</td>
                      <td className="px-3 py-2 text-biome-text">{formatINR(e.totalTax)}</td>
                    </tr>
                  ))}
                {tab === "onlyBooks" &&
                  result.onlyInBooks.map((e, i) => (
                    <tr key={i} className="border-t border-biome-line/40">
                      <td className="whitespace-nowrap px-3 py-2 text-biome-text">{e.invoiceNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{e.gstin}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-biome-muted">{e.invoiceDate ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-text">{formatINR(e.taxableValue)}</td>
                      <td className="px-3 py-2 text-biome-text">{formatINR(e.totalTax)}</td>
                    </tr>
                  ))}
              </tbody>
            </motion.table>
          </AnimatePresence>
        </div>
      </GlassCard>
    </div>
  );
}
