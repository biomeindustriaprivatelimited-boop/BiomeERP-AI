"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  FileMinus2,
  FilePlus2,
  Search,
  Download,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import AnimatedCounter from "@/components/AnimatedCounter";
import {
  ReconciliationResult,
  ColumnMapping,
  FIELDS,
  MatchResult,
  LedgerEntry,
  formatINR,
  buildExportSheets,
  downloadExcelWorkbook,
  downloadCsv,
  downloadReconciliationPdf,
  categorizeMatch,
  DiscrepancyCategory,
} from "@/lib/reconciliation";

const CATEGORY_COLORS: Record<DiscrepancyCategory, string> = {
  "Approximate Invoice Match": "bg-biome-sky/15 text-biome-skyBright",
  "Amount Mismatch": "bg-biome-bolt/15 text-biome-bolt",
  "Date Mismatch": "bg-biome-sky/15 text-biome-skyBright",
  "TDS Mismatch": "bg-purple-500/15 text-purple-300",
  "Multiple Field Mismatch": "bg-red-500/15 text-red-300",
};

type TabKey = "matched" | "discrepancies" | "onlyA" | "onlyB";

export default function ResultsPanel({
  result,
  mappingA,
  mappingB,
  nameA,
  nameB,
}: {
  result: ReconciliationResult;
  mappingA: ColumnMapping;
  mappingB: ColumnMapping;
  nameA: string;
  nameB: string;
}) {
  const [tab, setTab] = useState<TabKey>("discrepancies");
  const [query, setQuery] = useState("");

  const activeFields = useMemo(
    () => FIELDS.filter((f) => f.key !== "invoiceNo" && (mappingA[f.key] || mappingB[f.key])),
    [mappingA, mappingB]
  );

  const total =
    result.matched.length +
    result.discrepancies.length +
    result.onlyInA.length +
    result.onlyInB.length;
  const accuracy = total > 0 ? (result.matched.length / total) * 100 : 0;

  const TABS: { key: TabKey; label: string; count: number; icon: any; color: string }[] = [
    {
      key: "discrepancies",
      label: "Discrepancies",
      count: result.discrepancies.length,
      icon: AlertTriangle,
      color: "text-biome-bolt",
    },
    {
      key: "matched",
      label: "Fully Matched",
      count: result.matched.length,
      icon: CheckCircle2,
      color: "text-biome-leafBright",
    },
    {
      key: "onlyA",
      label: `Only in ${nameA}`,
      count: result.onlyInA.length,
      icon: FileMinus2,
      color: "text-biome-skyBright",
    },
    {
      key: "onlyB",
      label: `Only in ${nameB}`,
      count: result.onlyInB.length,
      icon: FilePlus2,
      color: "text-biome-skyBright",
    },
  ];

  function matchesQuery(invoiceNo: string) {
    if (!query.trim()) return true;
    return invoiceNo.toLowerCase().includes(query.trim().toLowerCase());
  }

  const filteredMatched = result.matched.filter((m) => matchesQuery(m.invoiceNo));
  const filteredDiscrepancies = result.discrepancies.filter((m) => matchesQuery(m.invoiceNo));
  const filteredOnlyA = result.onlyInA.filter((e) => matchesQuery(e.invoiceNoDisplay));
  const filteredOnlyB = result.onlyInB.filter((e) => matchesQuery(e.invoiceNoDisplay));

  function exportCurrentTab() {
    const sheets = buildExportSheets(result, mappingA, mappingB);
    const map: Record<TabKey, keyof typeof sheets> = {
      matched: "Fully Matched",
      discrepancies: "Discrepancies",
      onlyA: "Only in Ledger A",
      onlyB: "Only in Ledger B",
    };
    downloadCsv(sheets[map[tab]], `biome-reconciliation-${map[tab].toLowerCase().replace(/\s+/g, "-")}.csv`);
  }

  function exportAll() {
    const sheets = buildExportSheets(result, mappingA, mappingB);
    downloadExcelWorkbook(sheets, "biome-reconciliation-report.xlsx");
  }

  function exportByCategory() {
    // buildExportSheets already includes one "Discrepancy - <Category>" sheet
    // per bucket alongside the standard tabs, so category-wise Excel export
    // is just the same workbook — it's already organised that way.
    const sheets = buildExportSheets(result, mappingA, mappingB);
    const categorySheets = Object.fromEntries(
      Object.entries(sheets).filter(([name]) => name.startsWith("Discrepancy - "))
    );
    if (!Object.keys(categorySheets).length) {
      const sheets2 = { Discrepancies: sheets["Discrepancies"] };
      downloadExcelWorkbook(sheets2, "biome-reconciliation-discrepancies.xlsx");
      return;
    }
    downloadExcelWorkbook(categorySheets, "biome-reconciliation-discrepancies-by-category.xlsx");
  }

  const [exportingPdf, setExportingPdf] = useState(false);
  async function exportAllPdf() {
    setExportingPdf(true);
    try {
      await downloadReconciliationPdf(
        result,
        mappingA,
        mappingB,
        nameA,
        nameB,
        "biome-reconciliation-report.pdf"
      );
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <GlassCard className="p-5">
          <p className="text-2xl font-semibold text-biome-text">
            <AnimatedCounter value={accuracy} decimals={1} suffix="%" />
          </p>
          <p className="mt-1 text-xs text-biome-muted">Match Accuracy</p>
        </GlassCard>
        <GlassCard delay={0.05} className="p-5">
          <p className="text-2xl font-semibold text-biome-leafBright">
            <AnimatedCounter value={result.matched.length} />
          </p>
          <p className="mt-1 text-xs text-biome-muted">Fully Matched</p>
        </GlassCard>
        <GlassCard delay={0.1} className="p-5">
          <p className="text-2xl font-semibold text-biome-bolt">
            <AnimatedCounter value={result.discrepancies.length} />
          </p>
          <p className="mt-1 text-xs text-biome-muted">Discrepancies</p>
        </GlassCard>
        <GlassCard delay={0.15} className="p-5">
          <p className="text-2xl font-semibold text-biome-skyBright">
            <AnimatedCounter value={result.onlyInA.length} />
          </p>
          <p className="mt-1 text-xs text-biome-muted">Only in {nameA}</p>
        </GlassCard>
        <GlassCard delay={0.2} className="p-5">
          <p className="text-2xl font-semibold text-biome-skyBright">
            <AnimatedCounter value={result.onlyInB.length} />
          </p>
          <p className="mt-1 text-xs text-biome-muted">Only in {nameB}</p>
        </GlassCard>
      </div>

      {/* Controls */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-biome-leaf/12 text-biome-leafBright"
                      : "text-biome-muted hover:bg-biome-hover hover:text-biome-text"
                  }`}
                >
                  <Icon size={14} className={active ? t.color : ""} />
                  {t.label}
                  <span className="rounded-full bg-biome-hover px-1.5 py-0.5 text-[10px]">
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-xs">
              <Search size={14} className="text-biome-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search invoice no…"
                className="w-32 bg-transparent text-biome-text outline-none placeholder:text-biome-muted/60 sm:w-44"
              />
            </div>
            <button
              onClick={exportCurrentTab}
              className="flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-xs font-medium text-biome-muted transition-colors hover:text-biome-text"
            >
              <Download size={14} /> CSV
            </button>
            <button
              onClick={exportAll}
              className="flex items-center gap-1.5 rounded-xl border border-biome-leaf/30 bg-biome-leaf/10 px-3 py-2 text-xs font-medium text-biome-leafBright transition-colors hover:bg-biome-leaf/20"
            >
              <FileSpreadsheet size={14} /> Excel Report
            </button>
            <button
              onClick={exportByCategory}
              disabled={!result.discrepancies.length}
              title="One sheet per discrepancy type (Amount Mismatch, Date Mismatch, TDS Mismatch, etc.)"
              className="flex items-center gap-1.5 rounded-xl border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileSpreadsheet size={14} /> By Category
            </button>
            <button
              onClick={exportAllPdf}
              disabled={exportingPdf}
              className="flex items-center gap-1.5 rounded-xl border border-biome-sky/30 bg-biome-sky/10 px-3 py-2 text-xs font-medium text-biome-skyBright transition-colors hover:bg-biome-sky/20 disabled:opacity-50"
            >
              <FileText size={14} /> {exportingPdf ? "Building PDF…" : "PDF Report"}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="max-h-[520px] overflow-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "matched" && (
                <MatchTable rows={filteredMatched} fields={activeFields} nameA={nameA} nameB={nameB} showReason={false} />
              )}
              {tab === "discrepancies" && (
                <MatchTable rows={filteredDiscrepancies} fields={activeFields} nameA={nameA} nameB={nameB} showReason />
              )}
              {tab === "onlyA" && (
                <EntryTable rows={filteredOnlyA} fields={activeFields} emptyLabel={nameA} />
              )}
              {tab === "onlyB" && (
                <EntryTable rows={filteredOnlyB} fields={activeFields} emptyLabel={nameB} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </GlassCard>
    </div>
  );
}

function MatchTable({
  rows,
  fields,
  nameA,
  nameB,
  showReason,
}: {
  rows: MatchResult[];
  fields: typeof FIELDS[number][];
  nameA: string;
  nameB: string;
  showReason: boolean;
}) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-biome-bgSoft/95 text-biome-muted backdrop-blur">
        <tr>
          <Th>Invoice No</Th>
          {fields.map((f) => (
            <Th key={f.key} colSpan={2}>
              {f.label}
              <span className="ml-1 font-normal text-biome-muted/60">({nameA} / {nameB})</span>
            </Th>
          ))}
          {showReason && <Th>Reason</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const mismatchKeys = new Set(m.mismatches.map((x) => x.field));
          return (
            <tr key={m.key} className="border-t border-biome-line/60 hover:bg-biome-hover">
              <Td className="font-mono">
                {m.invoiceNo}
                {m.matchedVia === "loose" && (
                  <span className="ml-1.5 rounded-full bg-biome-sky/15 px-1.5 py-0.5 text-[9px] text-biome-skyBright">
                    approx match
                  </span>
                )}
              </Td>
              {fields.map((f) => {
                const bad = mismatchKeys.has(f.key);
                return (
                  <td
                    key={f.key}
                    colSpan={2}
                    className={`whitespace-nowrap px-3 py-2.5 ${bad ? "bg-biome-bolt/[0.06]" : ""}`}
                  >
                    <span className={bad ? "text-biome-bolt" : "text-biome-text"}>
                      {formatField(m.a.fields[f.key], f.type)}
                    </span>
                    <span className="mx-1 text-biome-muted/50">/</span>
                    <span className={bad ? "text-biome-bolt" : "text-biome-text"}>
                      {formatField(m.b.fields[f.key], f.type)}
                    </span>
                  </td>
                );
              })}
              {showReason && (
                <Td className="max-w-[280px] text-biome-muted">
                  <span
                    className={`mr-1.5 inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                      CATEGORY_COLORS[categorizeMatch(m)]
                    }`}
                  >
                    {categorizeMatch(m)}
                  </span>
                  {m.mismatches.length
                    ? m.mismatches.map((mm) => mm.label).join(", ") + " differs"
                    : m.matchedVia === "loose"
                    ? "verify manually"
                    : "—"}
                </Td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EntryTable({
  rows,
  fields,
  emptyLabel,
}: {
  rows: LedgerEntry[];
  fields: typeof FIELDS[number][];
  emptyLabel: string;
}) {
  if (!rows.length) return <EmptyState />;
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-biome-bgSoft/95 text-biome-muted backdrop-blur">
        <tr>
          <Th>Invoice No</Th>
          {fields.map((f) => (
            <Th key={f.key}>{f.label}</Th>
          ))}
          <Th>Notes</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.key} className="border-t border-biome-line/60 hover:bg-biome-hover">
            <Td className="font-mono">{e.invoiceNoDisplay}</Td>
            {fields.map((f) => (
              <Td key={f.key}>{formatField(e.fields[f.key], f.type)}</Td>
            ))}
            <Td className="text-biome-muted">
              {e.duplicateCount > 1 ? `${e.duplicateCount} lines summed` : "—"}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatField(v: string | number | null | undefined, type: string) {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "number") return formatINR(v as number);
  return v.toString();
}

function Th({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return (
    <th colSpan={colSpan} className="whitespace-nowrap px-3 py-2.5 text-[11px] font-medium">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-biome-text ${className}`}>{children}</td>;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <CheckCircle2 size={28} className="text-biome-muted/40" />
      <p className="text-sm text-biome-muted">No rows in this category.</p>
    </div>
  );
}
