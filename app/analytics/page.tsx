"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  TrendingUp,
  RefreshCw,
  Loader2,
  Plug,
  ArrowUpRight,
  Users,
  Factory,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { getTallySettings } from "@/lib/preferences";
import { inrShort, useTallyFull } from "@/lib/useTallyFull";
import TallyError from "@/components/TallyError";

export default function AnalyticsPage() {
  const { data, loading, error, reload } = useTallyFull();

  const months = data?.monthlySeries ?? [];
  const maxMonthly = useMemo(
    () => Math.max(...months.map((m) => Math.max(m.sales, m.purchases)), 1),
    [months]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
            <TrendingUp size={20} className="text-biome-leafBright" />
            Analytics
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
            Trends built from your Tally vouchers for the current financial year — month by month,
            party by party. Nothing here is estimated; if Tally doesn&apos;t have it, it isn&apos;t
            shown.
          </p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="glass flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] text-biome-muted transition-colors hover:text-biome-text disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {error && <TallyError error={error} />}

      {data?.voucherError && (
        <GlassCard className="flex items-start gap-2.5 border-biome-bolt/25 px-4 py-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-biome-bolt" />
          <p className="text-[11.5px] leading-relaxed text-biome-muted">{data.voucherError}</p>
        </GlassCard>
      )}

      {loading && !data && (
        <GlassCard className="flex items-center justify-center gap-2 py-16 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Reading ledgers and vouchers from Tally…
        </GlassCard>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Ledgers" value={String(data.counts.ledgers)} />
            <Tile label="Transactions" value={String(data.counts.vouchers)} />
            <Tile label="Customers" value={String(data.counts.debtors)} />
            <Tile label="Vendors" value={String(data.counts.creditors)} />
          </div>

          {/* ---- Monthly movement ---- */}
          <GlassCard className="p-5">
            <h2 className="font-display text-[15px] font-semibold text-biome-text">
              Month by month
            </h2>
            <p className="mb-4 text-[11px] text-biome-muted">
              Sales and purchases from voucher entries this financial year
            </p>

            {months.length === 0 ? (
              <p className="py-10 text-center text-[11.5px] text-biome-muted">
                No sales or purchase vouchers were returned for this period.
              </p>
            ) : (
              <div className="space-y-3">
                {months.map((m) => (
                  <div key={m.month}>
                    <div className="mb-1 flex items-baseline justify-between text-[11px]">
                      <span className="font-medium text-biome-text">{monthLabel(m.month)}</span>
                      <span className="text-biome-muted">
                        <span className="text-emerald-500">{inrShort(m.sales)}</span>
                        <span className="mx-1.5 text-biome-muted/50">vs</span>
                        <span className="text-amber-500">{inrShort(m.purchases)}</span>
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-biome-line/60">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(m.sales / maxMonthly) * 100}%` }}
                          transition={{ duration: 0.6 }}
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500"
                        />
                      </div>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-biome-line/60">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(m.purchases / maxMonthly) * 100}%` }}
                          transition={{ duration: 0.6 }}
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 pt-1 text-[10.5px] text-biome-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Sales
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Purchases
                  </span>
                </div>
              </div>
            )}
          </GlassCard>

          {/* ---- Named parties: the thing that was missing ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <PartyPanel
              title="Top customers"
              subtitle="By outstanding balance"
              icon={Users}
              rows={data.parties.debtors}
              href="/customers"
            />
            <PartyPanel
              title="Top vendors"
              subtitle="By outstanding balance"
              icon={Factory}
              rows={data.parties.creditors}
              href="/vendors"
            />
          </div>

          {/* ---- Voucher mix ---- */}
          <GlassCard className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-biome-text">
              <Receipt size={15} className="text-biome-muted" />
              Transaction mix
            </h2>
            {Object.keys(data.voucherTypeCounts).length === 0 ? (
              <p className="py-6 text-center text-[11.5px] text-biome-muted">
                No vouchers were returned for this period.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(data.voucherTypeCounts)
                  .sort((a, b) => b[1].value - a[1].value)
                  .map(([type, v]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-xl border border-biome-line px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-biome-text">{type}</p>
                        <p className="text-[10px] text-biome-muted">{v.count} entries</p>
                      </div>
                      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-biome-text">
                        {inrShort(v.value)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </GlassCard>

          <p className="px-1 text-[10.5px] text-biome-muted">
            Read from Tally at {new Date(data.fetchedAt).toLocaleTimeString("en-IN")} · period{" "}
            {data.period.from} to {data.period.to}
          </p>
        </>
      )}
    </div>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-biome-muted/60">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-biome-text">{value}</p>
    </GlassCard>
  );
}

/**
 * Not exported.
 *
 * A page file may only export `default` and Next's own config keys —
 * anything else fails the production build with a type error about an
 * index signature, which is a confusing way to be told "this export
 * doesn't belong here". PartyPanel is used only on this page, so it
 * stays local.
 */
function PartyPanel({
  title,
  subtitle,
  icon: Icon,
  rows,
  href,
}: {
  title: string;
  subtitle: string;
  icon: any;
  rows: { name: string; closingBalance: number; transactionCount: number; lastTransaction: string | null }[];
  href: string;
}) {
  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-biome-text">
            <Icon size={15} className="text-biome-muted" />
            {title}
          </h2>
          <p className="text-[11px] text-biome-muted">{subtitle}</p>
        </div>
        <Link href={href} className="text-[11.5px] text-biome-leafBright hover:underline">
          View all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-8 text-center text-[11.5px] text-biome-muted">
          No ledgers found in this group.
        </p>
      ) : (
        <table className="w-full text-left text-[12px]">
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.name} className="border-t border-biome-line/70">
                <td className="px-5 py-2.5">
                  <p className="truncate text-biome-text" title={r.name}>
                    {r.name}
                  </p>
                  <p className="text-[10px] text-biome-muted">
                    {r.transactionCount > 0
                      ? `${r.transactionCount} transactions${r.lastTransaction ? ` · last ${r.lastTransaction}` : ""}`
                      : "No transactions in this period"}
                  </p>
                </td>
                <td className="px-5 py-2.5 text-right font-mono tabular-nums text-biome-text">
                  {inrShort(r.closingBalance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassCard>
  );
}
