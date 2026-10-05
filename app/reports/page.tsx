"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen,
  Download,
  RefreshCw,
  Loader2,
  Search,
  FileSpreadsheet,
  Table2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";
import { downloadExcelWorkbook, downloadCsv } from "@/lib/reconciliation";
import { useTallyFull, inrShort, inrFull } from "@/lib/useTallyFull";
import TallyError from "@/components/TallyError";
import TallyPeriodBar from "@/components/tally/TallyPeriodBar";

type ReportId = "debtors" | "creditors" | "transactions" | "cashbank" | "monthly";

const REPORTS: { id: ReportId; label: string; desc: string }[] = [
  { id: "debtors", label: "Customer outstanding", desc: "Every debtor with its balance and activity" },
  { id: "creditors", label: "Vendor outstanding", desc: "Every creditor with its balance and activity" },
  { id: "transactions", label: "Transaction register", desc: "All vouchers in the current financial year" },
  { id: "cashbank", label: "Cash & bank", desc: "Cash and bank ledger balances" },
  { id: "monthly", label: "Monthly summary", desc: "Sales, purchases, receipts and payments by month" },
];

export default function ReportsPage() {
  const { notify } = useNotifications();
  const { data, loading, error, reload, progress, periodChoice, setPeriodChoice } = useTallyFull();
  const [active, setActive] = useState<ReportId>("debtors");
  const [query, setQuery] = useState("");

  /** Build the export table for a report — the same rows shown on screen. */
  const table = useMemo((): Record<string, any>[] => {
    if (!data) return [];
    const partyRows = (rows: typeof data.parties.debtors) =>
      rows.map((r) => ({
        Name: r.name,
        Group: r.group ?? "",
        "Closing Balance": r.closingBalance,
        "Balance (formatted)": inrFull(r.closingBalance),
        Transactions: r.transactionCount,
        "Transaction Value": r.totalValue,
        "Last Transaction": r.lastTransaction ?? "",
      }));

    switch (active) {
      case "debtors":
        return partyRows(data.parties.debtors);
      case "creditors":
        return partyRows(data.parties.creditors);
      case "cashbank":
        return partyRows([...data.parties.cash, ...data.parties.bank]);
      case "transactions":
        return data.transactions.map((t) => ({
          Date: t.date ?? "",
          "Voucher Type": t.voucherType ?? "",
          "Invoice / Voucher No": t.invoiceNo ?? "",
          Party: t.party ?? "",
          Amount: t.amount ?? "",
          "Amount (formatted)": inrFull(t.amount),
          Narration: t.narration ?? "",
        }));
      case "monthly":
        return data.monthlySeries.map((m) => ({
          Month: m.month,
          Sales: m.sales,
          Purchases: m.purchases,
          Receipts: m.receipts,
          Payments: m.payments,
          "Gross Margin": m.sales - m.purchases,
          Entries: m.count,
        }));
      default:
        return [];
    }
  }, [data, active]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return table;
    return table.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [table, query]);

  const columns = filtered.length ? Object.keys(filtered[0]) : [];
  const current = REPORTS.find((r) => r.id === active)!;

  function exportExcel() {
    if (!data) return;
    // One workbook with every report, so an accountant gets the whole
    // picture in a single file rather than five downloads.
    const sheets: Record<string, Record<string, any>[]> = {};
    const partyRows = (rows: typeof data.parties.debtors) =>
      rows.map((r) => ({
        Name: r.name,
        Group: r.group ?? "",
        "Closing Balance": r.closingBalance,
        Transactions: r.transactionCount,
        "Last Transaction": r.lastTransaction ?? "",
      }));
    sheets["Customer Outstanding"] = partyRows(data.parties.debtors);
    sheets["Vendor Outstanding"] = partyRows(data.parties.creditors);
    sheets["Cash and Bank"] = partyRows([...data.parties.cash, ...data.parties.bank]);
    sheets["Transactions"] = data.transactions.map((t) => ({
      Date: t.date ?? "",
      "Voucher Type": t.voucherType ?? "",
      "Voucher No": t.invoiceNo ?? "",
      Party: t.party ?? "",
      Amount: t.amount ?? "",
      Narration: t.narration ?? "",
    }));
    sheets["Monthly Summary"] = data.monthlySeries.map((m) => ({
      Month: m.month,
      Sales: m.sales,
      Purchases: m.purchases,
      Receipts: m.receipts,
      Payments: m.payments,
      "Gross Margin": m.sales - m.purchases,
    }));

    downloadExcelWorkbook(sheets, `biome-tally-reports-${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify({ kind: "success", title: "Workbook downloaded", detail: "Five sheets, one per report." });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
            <FolderOpen size={20} className="text-biome-leafBright" />
            Reports
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
            View any of these on screen, or export the lot to Excel. Everything is read from Tally
            for the period you pick below; the current month is always read live.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            disabled={loading}
            className="glass flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] text-biome-muted transition-colors hover:text-biome-text disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <PremiumButton onClick={exportExcel} disabled={!data}>
            <FileSpreadsheet size={13} /> Export all to Excel
          </PremiumButton>
        </div>
      </div>

      <TallyPeriodBar
        choice={periodChoice}
        onChange={setPeriodChoice}
        period={data?.period}
        loading={loading}
        progress={progress}
      />

      {error && <TallyError error={error} />}

      {loading && !data && (
        <GlassCard className="flex items-center justify-center gap-2 py-16 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Reading from Tally…
        </GlassCard>
      )}

      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {REPORTS.map((r) => (
              <button
                key={r.id}
                onClick={() => setActive(r.id)}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  active === r.id
                    ? "border-biome-leaf/40 bg-biome-leaf/10"
                    : "border-biome-line hover:bg-biome-hover"
                }`}
              >
                <p
                  className={`text-[12px] font-medium ${
                    active === r.id ? "text-biome-leafBright" : "text-biome-text"
                  }`}
                >
                  {r.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-biome-muted">{r.desc}</p>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${current.label.toLowerCase()}…`}
                className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-biome-muted">
                {filtered.length} row{filtered.length === 1 ? "" : "s"}
              </span>
              <PremiumButton
                variant="ghost"
                onClick={() =>
                  downloadCsv(filtered, `${active}-${new Date().toISOString().slice(0, 10)}.csv`)
                }
                disabled={!filtered.length}
              >
                <Download size={13} /> CSV
              </PremiumButton>
            </div>
          </div>

          <GlassCard className="overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Table2 size={20} className="text-biome-muted" />
                <p className="text-[12px] font-medium text-biome-text">
                  {query ? "Nothing matches that search" : "No rows in this report"}
                </p>
                <p className="max-w-sm text-[11px] text-biome-muted">
                  {query
                    ? "Try a party name, a voucher number, or clear the search."
                    : active === "transactions"
                      ? "Tally returned no vouchers for the current financial year."
                      : "Tally has no ledgers in this group."}
                </p>
              </div>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-left text-[11.5px]">
                  <thead className="sticky top-0 z-10 bg-biome-surface">
                    <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                      {columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 500).map((row, i) => (
                      <tr key={i} className="border-b border-biome-line/40 last:border-0 hover:bg-biome-hover">
                        {columns.map((c) => {
                          const v = row[c];
                          const numeric = typeof v === "number";
                          return (
                            <td
                              key={c}
                              className={`whitespace-nowrap px-3 py-2 ${
                                numeric ? "text-right font-mono tabular-nums" : ""
                              } text-biome-text`}
                            >
                              {numeric ? inrShort(v) : String(v ?? "")}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > 500 && (
                  <p className="border-t border-biome-line px-3 py-2 text-[10.5px] text-biome-muted">
                    Showing the first 500 rows on screen. The export contains all {filtered.length}.
                  </p>
                )}
              </div>
            )}
          </GlassCard>

          <p className="px-1 text-[10.5px] text-biome-muted">
            {data.counts.ledgers} ledgers · {data.counts.vouchers} transactions · read{" "}
            {new Date(data.fetchedAt).toLocaleTimeString("en-IN")}
          </p>
        </>
      )}
    </div>
  );
}
