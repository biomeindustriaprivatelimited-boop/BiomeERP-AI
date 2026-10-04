"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight, Truck, Factory, Package, Wallet, Users, FileWarning, Handshake, ClipboardList,
  Landmark, Receipt, TrendingUp, MessagesSquare, FileBarChart2, Loader2, Leaf,
} from "lucide-react";
import { useSession } from "@/lib/session";
import type { TallyFull } from "@/lib/useTallyFull";

/**
 * The home page's "Reports" section: a summary card per report the
 * signed-in person may read, each with its key numbers, a small table or
 * trend, and a link to the full report.
 *
 * Module cards come from /api/home-reports (access-scoped on the server);
 * the finance cards are built from the Tally data the page already loaded,
 * and the documents card from the WhatsApp status it already fetched — no
 * second Tally pull.
 */

type Kind = "money" | "kg" | "count" | "pct" | "text";
interface Metric { label: string; value: number | string; kind: Kind; tone?: "good" | "warn" | "bad" }
interface Row { label: string; value: number; kind: Kind; sub?: string }
interface Card {
  id: string; title: string; module: string; href: string; reportHref?: string;
  metrics: Metric[]; tableTitle?: string; rows?: Row[];
  series?: { label: string; value: number }[]; seriesKind?: Kind;
  empty: boolean; note?: string;
}

const ICON: Record<string, any> = {
  coordination_mfg: Truck, coordination_trading: Truck, transport: Truck, biomass: Leaf, po: ClipboardList,
  stock: Package, imprest: Wallet, people: Users, mismatches: FileWarning, registry: Handshake,
  receivables: Landmark, payables: Receipt, monthly: TrendingUp, gst: FileBarChart2, documents: MessagesSquare,
};
const TINT: Record<string, string> = {
  Supply: "text-sky-500 bg-sky-500/12", Plant: "text-amber-500 bg-amber-500/12", Finance: "text-emerald-500 bg-emerald-500/12",
  People: "text-violet-500 bg-violet-500/12", Documents: "text-rose-500 bg-rose-500/12", Partners: "text-teal-500 bg-teal-500/12",
};

export function fmt(v: number | string, kind: Kind): string {
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  switch (kind) {
    case "money": {
      const a = Math.abs(v), s = v < 0 ? "-" : "";
      if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
      if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
      if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)} K`;
      return `${s}₹${a.toFixed(0)}`;
    }
    case "kg": return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} MT` : `${Math.round(v).toLocaleString("en-IN")} kg`;
    case "pct": return `${v.toFixed(1)}%`;
    default: return Math.round(v).toLocaleString("en-IN");
  }
}
const TONE = { good: "text-emerald-500", warn: "text-amber-500", bad: "text-rose-500" } as const;

function monthLabel(k: string) {
  if (!/^\d{4}-\d{2}$/.test(k)) return k;
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
}

/** "Receivable as on 04-Oct-2026 · sales for FY 2026-27 till today" */
function periodNote(d: TallyFull, balance: string): string | undefined {
  if (!d.period?.label) return undefined;
  const asOn = d.period.asOn ? `${balance} as on ${d.period.asOn} · ` : "";
  return `${asOn}${balance === "Receivable" ? "sales" : "purchases"} for ${d.period.label}`;
}

export default function HomeReports({ tally, tallyLoading, wa }: { tally: TallyFull | null; tallyLoading: boolean; wa: any }) {
  const { can, visible } = useSession();
  const [server, setServer] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/home-reports", { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Reports could not load."); return j; })
      .then((j) => alive && setServer(j.cards || []))
      .catch((e) => alive && (setError(e.message), setServer([])));
    return () => { alive = false; };
  }, []);

  const finance: Card[] = [];
  if (can("finance") || can("tally")) {
    const d = tally;
    const debtors = [...(d?.parties.debtors || [])];
    const creditors = [...(d?.parties.creditors || [])];
    finance.push({
      id: "receivables", title: "Client-wise sales & receivables", module: "Finance", href: "/customers", reportHref: "/reports",
      metrics: [
        { label: "Receivable", value: d?.summary.receivables ?? 0, kind: "money" },
        { label: "Sales (period)", value: d?.summary.sales ?? 0, kind: "money" },
        { label: "Clients", value: d?.counts.debtors ?? debtors.length, kind: "count" },
      ],
      tableTitle: "Biggest client balances",
      rows: debtors.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance)).slice(0, 5)
        .map((p) => ({ label: p.name, value: p.closingBalance, kind: "money" as Kind, sub: p.transactionCount ? `${p.transactionCount} vouchers` : undefined })),
      empty: !d || (!debtors.length && d.summary.receivables == null),
      note: !d ? "Appears once Tally is connected." : periodNote(d, "Receivable"),
    });
    finance.push({
      id: "payables", title: "Vendor payables", module: "Finance", href: "/vendors", reportHref: "/reports",
      metrics: [
        { label: "Payable", value: d?.summary.payables ?? 0, kind: "money" },
        { label: "Purchases (period)", value: d?.summary.purchases ?? 0, kind: "money" },
        { label: "Vendors", value: d?.counts.creditors ?? creditors.length, kind: "count" },
      ],
      tableTitle: "Biggest vendor balances",
      rows: creditors.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance)).slice(0, 5)
        .map((p) => ({ label: p.name, value: Math.abs(p.closingBalance), kind: "money" as Kind, sub: p.transactionCount ? `${p.transactionCount} vouchers` : undefined })),
      empty: !d || (!creditors.length && d.summary.payables == null),
      note: !d ? "Appears once Tally is connected." : periodNote(d, "Payable"),
    });
    const series = (d?.monthlySeries || []).slice(-6);
    finance.push({
      id: "monthly", title: "Monthly sales, receipts & payments", module: "Finance", href: "/analytics", reportHref: "/reports",
      metrics: [
        { label: "Sales (6 mo)", value: series.reduce((t, m) => t + (m.sales || 0), 0), kind: "money" },
        { label: "Receipts", value: series.reduce((t, m) => t + (m.receipts || 0), 0), kind: "money", tone: "good" },
        { label: "Payments", value: series.reduce((t, m) => t + (m.payments || 0), 0), kind: "money" },
      ],
      series: series.map((m) => ({ label: m.month, value: m.sales || 0 })), seriesKind: "money",
      empty: !series.length,
      note: !d ? "Appears once Tally is connected." : undefined,
    });
    if (visible("/gst-compliance")) {
      const vt = d?.voucherTypeCounts || {};
      finance.push({
        id: "gst", title: "GST & taxes", module: "Finance", href: "/gst-compliance",
        metrics: [
          { label: "Duties & taxes balance", value: d?.summary.taxLiability ?? 0, kind: "money" },
          { label: "Sales vouchers", value: Object.entries(vt).filter(([k]) => /sales/i.test(k)).reduce((t, [, v]) => t + v.count, 0), kind: "count" },
          { label: "Purchase vouchers", value: Object.entries(vt).filter(([k]) => /purchase/i.test(k)).reduce((t, [, v]) => t + v.count, 0), kind: "count" },
        ],
        note: d ? "Reconcile GSTR-2B / GSTR-1 against these books in GST Compliance." : "Appears once Tally is connected.",
        empty: !d || d.summary.taxLiability == null,
      });
    }
  }
  if (can("whatsapp") && visible("/whatsapp")) {
    const st = wa?.stats;
    finance.push({
      id: "documents", title: "Supply documents (WhatsApp)", module: "Documents", href: "/whatsapp",
      metrics: [
        { label: "Documents", value: st?.totalDocuments ?? 0, kind: "count" },
        { label: "Filed", value: st?.filed ?? 0, kind: "count", tone: "good" },
        { label: "Waiting to match", value: st?.needsReview ?? 0, kind: "count", tone: st?.needsReview ? "warn" : "good" },
        { label: "Complete sets", value: st ? `${st.completeSets ?? 0} / ${st.totalSets ?? 0}` : "0", kind: "text" },
      ],
      empty: !st || !st.totalDocuments,
      note: wa && wa.status !== "connected" ? "WhatsApp is not linked — new documents are not being collected." : undefined,
    });
  }

  const cards = [...finance, ...(server || [])].filter((c) => visible(c.href));
  const loadingTally = tallyLoading && !tally;

  return (
    <section aria-labelledby="home-reports">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="home-reports" className="biome-shout text-[22px] leading-none text-biome-text">Reports<span className="text-biome-leafBright">.</span></h2>
          <p className="mt-1 text-[11px] text-biome-muted">Live summaries of your data — open any card for the full report. Tally figures are for the period chosen above; other figures are this financial year unless stated.</p>
        </div>
        {visible("/report-builder") && (
          <Link href="/report-builder" className="flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[11.5px] font-semibold text-biome-text hover:border-biome-leafBright/50">
            Report builder <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
      {error && <p className="mb-3 text-[11px] text-rose-500">{error}</p>}
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {cards.map((c, i) => (
          <ReportCard key={c.id} card={{ ...c, reportHref: c.reportHref && visible(c.reportHref.split("?")[0]) ? c.reportHref : undefined }} index={i} pending={loadingTally && ["receivables", "payables", "monthly", "gst"].includes(c.id)} />
        ))}
        {server === null && (
          <div className="glass flex items-center justify-center gap-2 rounded-2xl p-8 text-[12px] text-biome-muted">
            <Loader2 size={14} className="animate-spin" /> Loading reports…
          </div>
        )}
      </div>
    </section>
  );
}

function ReportCard({ card, index, pending }: { card: Card; index: number; pending: boolean }) {
  const Icon = ICON[card.id] || Factory;
  const max = Math.max(1, ...(card.series || []).map((s) => Math.abs(s.value)));
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), duration: 0.3 }}
      className="glass flex min-w-0 flex-col rounded-2xl p-4"
      data-report-card={card.id}
    >
      <header className="mb-3 flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TINT[card.module] || "text-biome-leafBright bg-biome-leaf/12"}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{card.module}</p>
          <h3 className="truncate font-display text-[14px] font-semibold text-biome-text" title={card.title}>{card.title}</h3>
        </div>
        <Link href={card.href} aria-label={`Open ${card.title}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-biome-line text-biome-muted transition-colors hover:border-biome-leafBright/50 hover:text-biome-leafBright">
          <ArrowUpRight size={13} />
        </Link>
      </header>

      {pending ? (
        <div className="space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-8 animate-pulse rounded-lg bg-biome-line/50" />)}</div>
      ) : card.empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-biome-line py-6 text-center">
          <p className="text-[12px] font-medium text-biome-text">No data yet</p>
          <p className="max-w-[260px] text-[10.5px] text-biome-muted">{card.note || "Figures appear here as soon as entries are made."}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {card.metrics.slice(0, 4).map((m) => (
              <div key={m.label} className="min-w-0 rounded-xl bg-biome-surface px-3 py-2">
                <p className="truncate text-[10px] text-biome-muted" title={m.label}>{m.label}</p>
                <p className={`truncate font-display text-[16px] font-bold tabular-nums ${m.tone ? TONE[m.tone] : "text-biome-text"}`}>{fmt(m.value, m.kind)}</p>
              </div>
            ))}
          </div>

          {card.series && card.series.length > 0 && (
            <div className="mt-3">
              <div className="flex h-16 items-end gap-1.5" role="img" aria-label={`${card.title} trend`}>
                {card.series.map((s) => (
                  <div key={s.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${monthLabel(s.label)}: ${fmt(s.value, card.seriesKind || "count")}`}>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(4, (Math.abs(s.value) / max) * 100)}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="w-full rounded-t-md bg-gradient-to-t from-biome-leaf/70 to-biome-leafBright"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5">
                {card.series.map((s) => <span key={s.label} className="min-w-0 flex-1 truncate text-center text-[9px] text-biome-muted">{monthLabel(s.label)}</span>)}
              </div>
            </div>
          )}

          {card.rows && card.rows.length > 0 && (
            <div className="mt-3">
              {card.tableTitle && <p className="mb-1 text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{card.tableTitle}</p>}
              <ul className="divide-y divide-biome-line/70">
                {card.rows.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[11.5px] text-biome-text" title={r.label}>{r.label}</span>
                      {r.sub && <span className="block text-[9.5px] text-biome-muted">{r.sub}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-biome-text">{fmt(r.value, r.kind)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {card.note && <p className="mt-2 text-[10.5px] leading-snug text-biome-muted">{card.note}</p>}
        </>
      )}

      {card.reportHref && (
        <Link href={card.reportHref} className="mt-3 self-start text-[11px] font-semibold text-biome-leafBright hover:underline">
          Open full report →
        </Link>
      )}
    </motion.article>
  );
}
