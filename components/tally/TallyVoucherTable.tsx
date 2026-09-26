"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, AlertCircle, FileSpreadsheet, RefreshCw, LucideIcon } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { getTallySettings } from "@/lib/preferences";
import { TallyVoucherRow } from "@/lib/tally";
import { downloadExcelWorkbook, formatINR } from "@/lib/reconciliation";

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Case-insensitive substrings matched against the voucher type name
   *  (e.g. ["payment"] for the Payments page). Empty = show all types. */
  voucherTypeKeywords?: string[];
}

function defaultFromDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}
function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function TallyVoucherTable({
  title,
  description,
  icon: Icon,
  voucherTypeKeywords = [],
}: Props) {
  const [rows, setRows] = useState<TallyVoucherRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(defaultToDate());

  async function fetchVouchers() {
    setLoading(true);
    setError(null);
    try {
      const settings = getTallySettings();
      const res = await fetch("/api/tally/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          companyName: settings.companyName || undefined,
          fromDate,
          toDate,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not fetch from Tally.");
      setRows(data.rows || []);
    } catch (err: any) {
      setError(err?.message || "Could not fetch from Tally. Check Settings → Tally Integration.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (voucherTypeKeywords.length) {
      out = out.filter((r) =>
        voucherTypeKeywords.some((kw) => (r.voucherType || "").toLowerCase().includes(kw.toLowerCase()))
      );
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (r) =>
          r.invoiceNo.toLowerCase().includes(q) || (r.party || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, voucherTypeKeywords, query]);

  const total = filtered.reduce((sum, r) => sum + (r.amount || 0), 0);

  function exportExcel() {
    downloadExcelWorkbook(
      {
        [title]: filtered.map((r) => ({
          "Voucher No": r.invoiceNo,
          Date: r.date,
          Party: r.party,
          "Voucher Type": r.voucherType,
          Amount: r.amount,
          Narration: r.narration,
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

      <GlassCard delay={0.05} className="p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-biome-muted">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-0.5 block rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
            />
          </label>
          <label className="text-[11px] text-biome-muted">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-0.5 block rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
            />
          </label>
          <PremiumButton variant="ghost" onClick={fetchVouchers} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Fetch from Tally
          </PremiumButton>
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-biome-line bg-biome-hover px-3 py-2">
            <Search size={14} className="text-biome-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search voucher no. or party…"
              className="flex-1 bg-transparent text-xs text-biome-text outline-none placeholder:text-biome-muted/60"
            />
          </div>
          <PremiumButton variant="ghost" onClick={exportExcel} disabled={!filtered.length}>
            <FileSpreadsheet size={13} /> Export Excel
          </PremiumButton>
        </div>

        {rows === null && !loading && !error && (
          <p className="py-8 text-center text-xs text-biome-muted">
            Pick a date range and click "Fetch from Tally" to load {title.toLowerCase()}.
          </p>
        )}

        {loading && (
          <p className="flex items-center gap-2 py-8 text-xs text-biome-muted">
            <Loader2 size={13} className="animate-spin" /> Fetching from Tally…
          </p>
        )}

        {!loading && rows !== null && filtered.length === 0 && !error && (
          <p className="py-8 text-center text-xs text-biome-muted">
            No {title.toLowerCase()} found in this date range.
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between text-[11px] text-biome-muted">
              <span>{filtered.length} vouchers</span>
              <span>
                Total: <span className="font-medium text-biome-text">{formatINR(total)}</span>
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-biome-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-biome-hover text-biome-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Voucher No</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Party</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <motion.tr
                      key={`${r.invoiceNo}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.01, 0.3) }}
                      className="border-t border-biome-line/60"
                    >
                      <td className="px-3 py-2 text-biome-text">{r.invoiceNo}</td>
                      <td className="px-3 py-2 text-biome-muted">{r.date ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-muted">{r.party ?? "—"}</td>
                      <td className="px-3 py-2 text-biome-muted">{r.voucherType ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-medium text-biome-text">
                        {r.amount != null ? formatINR(r.amount) : "—"}
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
