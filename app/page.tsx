"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useSession } from "@/lib/session";
import { TiltCard, Scramble, SplitText, SPRING } from "@/components/motion/kit";
import { CategoryGrid } from "@/components/hub/HubGrid";
import { FEATURE_MAP } from "@/lib/featureMap";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  FileClock,
  FileWarning,
  Landmark,
  BarChart3,
  ScanLine,
  MessagesSquare,
  Users,
  ShieldCheck,
  Bot,
  ChevronRight,
  RefreshCw,
  Loader2,
  Plug,
  AlertTriangle,
  CheckCircle2,
  Rocket,
  Calendar,
  Percent,
  Building2,
} from "lucide-react";
import { useTallyFull, tallyBasisLine, inrShort as inrShortShared } from "@/lib/useTallyFull";

interface Summary {
  cashInHand: number | null;
  bankBalance: number | null;
  receivables: number | null;
  payables: number | null;
  sales: number | null;
  purchases: number | null;
  grossMargin: number | null;
}
interface Bucket {
  total: number;
  count: number;
  ledgers: { name: string; balance: number }[];
}
interface DashboardData {
  fetchedAt: string;
  ledgerCount: number;
  summary: Summary;
  breakdown: Record<string, Bucket>;
  missingGroups: string[];
}

/** ₹48,75,000 -> "₹48.75 L" — Indian readers scan lakhs, not millions. */
function inrShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

const QUICK_ACTIONS = [
  { href: "/reconciliation", title: "Reconciliation", desc: "Match & reconcile ledgers instantly", icon: BarChart3, from: "from-emerald-400", to: "to-green-600" },
  { href: "/ocr", title: "OCR Scanner", desc: "Extract text from invoices & receipts", icon: ScanLine, from: "from-blue-400", to: "to-indigo-600" },
  { href: "/whatsapp", title: "WhatsApp Docs", desc: "Supply documents, filed automatically", icon: MessagesSquare, from: "from-violet-400", to: "to-purple-600" },
  { href: "/payments", title: "Payments", desc: "Record & track payments", icon: Wallet, from: "from-amber-400", to: "to-orange-600" },
  { href: "/vendors", title: "Vendors", desc: "Codes, details & KYC", icon: Users, from: "from-teal-400", to: "to-cyan-600" },
  { href: "/gst-compliance", title: "GST Dashboard", desc: "Check GST status & filings", icon: ShieldCheck, from: "from-rose-400", to: "to-pink-600" },
];

export default function DashboardPage() {
  const { can, visible } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tallyError, setTallyError] = useState<string | null>(null);
  const [wa, setWa] = useState<any>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Client-only so server and client don't disagree about the time.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Balances only — the KPIs never depend on the (slower) voucher pull.
  const { data: full, loading: tallyLoading, error: fullError, reload } = useTallyFull({ includeVouchers: false });
  const load = reload;

  useEffect(() => {
    setData(full as any);
    setTallyError(fullError);
    setLoading(tallyLoading);
  }, [full, fullError, tallyLoading]);

  useEffect(() => {
    fetch("/api/whatsapp/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setWa)
      .catch(() => {});
  }, []);

  const s = data?.summary;
  const stats = [
    { label: "Cash in Hand", value: s?.cashInHand, icon: Wallet, tint: "text-emerald-600 bg-emerald-100" },
    { label: "Bank Balance", value: s?.bankBalance, icon: Landmark, tint: "text-blue-600 bg-blue-100" },
    { label: "Receivables", value: s?.receivables, icon: ArrowDownLeft, tint: "text-teal-600 bg-teal-100" },
    { label: "Payables", value: s?.payables, icon: ArrowUpRight, tint: "text-rose-600 bg-rose-100" },
    { label: "Sales", value: s?.sales, icon: FileClock, tint: "text-violet-600 bg-violet-100" },
    { label: "Purchases", value: s?.purchases, icon: FileWarning, tint: "text-amber-600 bg-amber-100" },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      {/* ================= Header row ================= */}
      <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <p className="text-[12.5px] text-biome-muted">{greeting()}, Govind 👋</p>
          <h1 className="mt-0.5 font-display text-[30px] font-bold leading-tight tracking-tight text-biome-text">
            <SplitText text="Finance" /> <span className="text-biome-leafBright"><SplitText text="Command Center" delay={0.15} /></span>
          </h1>
          <p className="mt-1 text-[12.5px] text-biome-muted">
            Real-time financial intelligence &amp; automation for smarter decisions.
          </p>
        </div>

        {/* AI assistant entry point */}
        <Link
          href="/assistant"
          className="glass group flex items-center gap-3 rounded-2xl px-4 py-3 transition-transform hover:-translate-y-0.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-biome-leaf to-biome-leafBright">
            <Bot size={17} className="text-biome-text" />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-biome-text">AI Assistant</p>
            <p className="truncate text-[11px] text-biome-muted">Ask anything about your data…</p>
          </div>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-biome-leaf/12 text-biome-leafBright transition-transform group-hover:translate-x-0.5">
            <ChevronRight size={14} />
          </span>
        </Link>

        {/* The date and clock live in the top bar, which is on every page —
            repeating them here was showing the same thing twice. */}
        <button
          onClick={load}
          disabled={loading}
          className="glass flex items-center gap-2 self-start rounded-xl px-3.5 py-2.5 text-[12px] text-biome-muted transition-colors hover:text-biome-text disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {/* ================= Stat strip ================= */}
      <div className="glass grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-biome-line/60 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((t, i) => (
          <TiltCard
            key={t.label}
            max={7}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.06, ...SPRING }}
            className="bg-biome-surface px-4 py-3.5"
          >
            <div className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.tint}`}>
                <t.icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] text-biome-muted">{t.label}</p>
                <p className="font-display text-[19px] font-bold tabular-nums leading-tight text-biome-text">
                  {loading ? (
                    <span className="mt-1 inline-block h-5 w-16 animate-pulse rounded bg-biome-line" />
                  ) : (
                    <Scramble value={inrShort(t.value)} />
                  )}
                </p>
              </div>
            </div>
          </TiltCard>
        ))}
      </div>

      {/* What the figures are: period, company, when read */}
      {full && !tallyError && (
        <p className="px-1 text-[11px] text-biome-muted">
          {tallyBasisLine(full)}
          {" · receivables & payables are net of advances"}
          {full.summary.bankOverdraft ? ` · bank OD/CC owed ${inrShort(full.summary.bankOverdraft)} (not in bank balance)` : ""}
        </p>
      )}

      {/* Tally not reachable — one quiet line, not a wall of text */}
      {tallyError && (
        <div className="glass flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5">
          <Plug size={14} className="shrink-0 text-biome-bolt" />
          <p className="text-[11.5px] text-biome-text">
            Couldn&apos;t read Tally, so the figures above stay blank (no old numbers are shown).
          </p>
          <p className="min-w-0 flex-1 text-[11px] text-biome-muted" title={tallyError}>
            {tallyError}
          </p>
          <Link href="/settings" className="shrink-0 text-[11.5px] font-medium text-biome-leafBright hover:underline">
            Connect Tally →
          </Link>
        </div>
      )}

      {/* ================= Charts row ================= */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr_1fr]">
        {/* Sales vs Purchases */}
        <section className="glass rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-[15px] font-semibold text-biome-text">Sales vs Purchases</h2>
              <p className="text-[11px] text-biome-muted">
                {full?.period?.label ? `Sales & Purchase Accounts, ${full.period.label} (excl. GST)` : "Sales & Purchase Accounts"}
              </p>
            </div>
            <span className="rounded-lg border border-biome-line px-2.5 py-1 text-[11px] text-biome-muted">
              From Tally
            </span>
          </div>
          {s && s.sales !== null && s.purchases !== null ? (
            <MarginBars sales={s.sales} purchases={s.purchases} margin={s.grossMargin} />
          ) : (
            <EmptyPanel
              icon={BarChart3}
              title={loading ? "Loading from Tally…" : "No sales or purchase data yet"}
              body={
                loading
                  ? ""
                  : "Connect Tally and these bars fill in from your Sales and Purchase groups."
              }
            />
          )}
        </section>

        {/* Working capital */}
        <section className="glass rounded-2xl p-5">
          <h2 className="font-display text-[15px] font-semibold text-biome-text">Working capital</h2>
          <p className="mb-4 text-[11px] text-biome-muted">Money in vs money out</p>
          {s && (s.receivables !== null || s.payables !== null) ? (
            <div className="space-y-3.5">
              <Donut receivables={s.receivables ?? 0} payables={s.payables ?? 0} />
              <div className="space-y-2 border-t border-biome-line pt-3">
                <LegendRow colour="bg-teal-500" label="Receivables" value={s.receivables} />
                <LegendRow colour="bg-rose-500" label="Payables" value={s.payables} />
                <LegendRow
                  colour="bg-biome-leafBright"
                  label="Net position"
                  value={(s.receivables ?? 0) - (s.payables ?? 0)}
                  bold
                />
              </div>
            </div>
          ) : (
            <EmptyPanel
              icon={Percent}
              title={loading ? "Loading…" : "Nothing to show yet"}
              body={loading ? "" : "Debtor and creditor balances appear here once Tally is connected."}
            />
          )}
        </section>

        {/* Alerts */}
        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-biome-text">Alerts &amp; Insights</h2>
          </div>
          <div className="space-y-2">
            {buildAlerts(data, wa).map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl border border-biome-line px-3 py-2.5">
                <span className={`mt-0.5 shrink-0 ${a.tone}`}>
                  {a.severity === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-biome-text">{a.title}</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">{a.detail}</p>
                </div>
                {a.href && (
                  <Link href={a.href} className="shrink-0 text-biome-muted hover:text-biome-leafBright">
                    <ArrowUpRight size={13} />
                  </Link>
                )}
                {a.badge && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-medium ${
                      a.severity === "high"
                        ? "bg-rose-100 text-rose-700"
                        : a.severity === "ok"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {a.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ================= Quick actions ================= */}
      <section>
        <section className="mb-6">
        <div className="mb-3 flex items-end justify-between"><h2 className="biome-shout text-[22px] leading-none text-biome-text">Open the OS<span className="text-biome-leafBright">.</span></h2><p className="text-[11px] text-biome-muted">Click a category → its features → their options.</p></div>
        <CategoryGrid categories={FEATURE_MAP} />
      </section>
      <h2 className="mb-3 font-display text-[15px] font-semibold text-biome-text">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {QUICK_ACTIONS.filter((a) => visible(a.href)).map((a, i) => (
            <motion.div key={a.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.04 }}>
              <Link
                href={a.href}
                className={`group flex h-full flex-col justify-between rounded-2xl bg-gradient-to-br ${a.from} ${a.to} p-4 text-biome-text shadow-md transition-transform hover:-translate-y-1`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-biome-hover">
                  <a.icon size={17} />
                </span>
                <div className="mt-5">
                  <p className="text-[13px] font-semibold leading-tight">{a.title}</p>
                  <p className="mt-1 text-[10.5px] leading-snug text-white/85">{a.desc}</p>
                </div>
                <span className="mt-3 flex h-6 w-6 items-center justify-center self-end rounded-full bg-biome-hover transition-transform group-hover:translate-x-0.5">
                  <ArrowUpRight size={13} />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ================= Bottom row ================= */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="glass overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-display text-[15px] font-semibold text-biome-text">Top receivables</h2>
            <Link href="/customers" className="text-[11.5px] text-biome-leafBright hover:underline">
              View all
            </Link>
          </div>
          <LedgerTable rows={(data as any)?.parties?.debtors ?? []} loading={loading} emptyLabel="Customer balances appear here once Tally is connected." />
        </section>

        <section className="glass overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-display text-[15px] font-semibold text-biome-text">Cash &amp; bank accounts</h2>
            <Link href="/ledgers" className="text-[11.5px] text-biome-leafBright hover:underline">
              View all
            </Link>
          </div>
          <LedgerTable
            rows={[...((data as any)?.parties?.cash ?? []), ...((data as any)?.parties?.bank ?? [])]}
            loading={loading}
            emptyLabel="Cash and bank ledgers appear here once Tally is connected."
            icon={Building2}
          />
        </section>
      </div>

      {data && (
        <p className="px-1 text-[10.5px] text-biome-muted">
          {data.ledgerCount} ledgers read from Tally · updated{" "}
          {new Date(data.fetchedAt).toLocaleTimeString("en-IN")}
          {data.missingGroups.length > 0 && ` · not found in this company: ${data.missingGroups.join(", ")}`}
        </p>
      )}
    </div>
  );
}

/* ==================== pieces ==================== */

function EmptyPanel({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-biome-line/50">
        <Icon size={17} className="text-biome-muted" />
      </span>
      <p className="text-[12px] font-medium text-biome-text">{title}</p>
      {body && <p className="max-w-xs text-[11px] leading-relaxed text-biome-muted">{body}</p>}
    </div>
  );
}

function MarginBars({ sales, purchases, margin }: { sales: number; purchases: number; margin: number | null }) {
  const max = Math.max(Math.abs(sales), Math.abs(purchases), 1);
  const pct = sales !== 0 && margin !== null ? (margin / sales) * 100 : null;
  return (
    <div className="space-y-5">
      {[
        { label: "Sales", value: sales, cls: "from-emerald-400 to-green-500" },
        { label: "Purchases", value: purchases, cls: "from-amber-400 to-orange-500" },
      ].map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12px] text-biome-muted">{r.label}</span>
            <span className="font-display text-[15px] font-bold tabular-nums text-biome-text">{inrShort(r.value)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-biome-line/60">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className={`h-full rounded-full bg-gradient-to-r ${r.cls}`}
            />
          </div>
        </div>
      ))}
      {margin !== null && (
        <div className="flex items-baseline justify-between border-t border-biome-line pt-3.5">
          <span className="text-[12px] text-biome-muted">
            Gross margin
            {pct !== null && <span className="ml-1.5 text-[10.5px] text-biome-muted/70">({pct.toFixed(1)}% of sales)</span>}
          </span>
          <span className={`font-display text-xl font-bold tabular-nums ${margin >= 0 ? "text-biome-leafBright" : "text-rose-500"}`}>
            {inrShort(margin)}
          </span>
        </div>
      )}
    </div>
  );
}

/** A pure-SVG donut — no chart library, so nothing extra to install. */
function Donut({ receivables, payables }: { receivables: number; payables: number }) {
  const total = Math.abs(receivables) + Math.abs(payables) || 1;
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const recvLen = (Math.abs(receivables) / total) * circumference;
  const net = receivables - payables;

  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" strokeWidth="16" className="stroke-rose-400" />
        <motion.circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          strokeWidth="16"
          strokeLinecap="round"
          className="stroke-teal-400"
          initial={{ strokeDasharray: `0 ${circumference}` }}
          animate={{ strokeDasharray: `${recvLen} ${circumference - recvLen}` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[9.5px] uppercase tracking-wider text-biome-muted">Net</span>
        <span className={`font-display text-[15px] font-bold tabular-nums ${net >= 0 ? "text-biome-leafBright" : "text-rose-500"}`}>
          {inrShort(net)}
        </span>
      </div>
    </div>
  );
}

function LegendRow({ colour, label, value, bold }: { colour: string; label: string; value: number | null; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[11.5px] text-biome-muted">
        <span className={`h-2 w-2 rounded-full ${colour}`} />
        {label}
      </span>
      <span className={`font-mono text-[11.5px] tabular-nums ${bold ? "font-semibold text-biome-text" : "text-biome-text"}`}>
        {inrShort(value)}
      </span>
    </div>
  );
}

function LedgerTable({
  rows,
  loading,
  emptyLabel,
  icon: Icon = Users,
}: {
  rows: { name: string; closingBalance: number }[];
  loading: boolean;
  emptyLabel: string;
  icon?: any;
}) {
  if (loading) {
    return (
      <div className="space-y-2 px-5 pb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-biome-line/50" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="px-5 pb-8 pt-2 text-center">
        <p className="text-[11.5px] text-biome-muted">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="max-h-[300px] overflow-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.name} className="border-t border-biome-line/70">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-biome-leaf/12 text-biome-leafBright">
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 truncate text-biome-text" title={r.name}>
                    {r.name}
                  </span>
                </div>
              </td>
              <td className="px-5 py-2.5 text-right font-mono tabular-nums text-biome-text">
                {inrShort(r.closingBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Alerts come from real state only. When nothing is wrong, say that — a
 * panel of invented warnings teaches people to ignore it.
 */
function buildAlerts(data: DashboardData | null, wa: any) {
  const out: {
    title: string;
    detail: string;
    severity: "high" | "medium" | "ok";
    tone: string;
    href?: string;
    badge?: string;
  }[] = [];

  if (wa?.hasAiKey === false) {
    out.push({
      title: "No AI key configured",
      detail: "Documents are saved but can't be read until a key is added.",
      severity: "high",
      tone: "text-rose-500",
      href: "/settings",
      badge: "High",
    });
  }
  if (wa?.stats?.needsReview > 0) {
    out.push({
      title: `${wa.stats.needsReview} documents waiting to match`,
      detail: "Read and filed, waiting on the invoice that names their supply.",
      severity: "medium",
      tone: "text-amber-500",
      href: "/whatsapp",
      badge: "Waiting",
    });
  }
  if (wa && wa.status !== "connected") {
    out.push({
      title: "WhatsApp isn't linked",
      detail: "Documents sent to the sales group aren't being collected.",
      severity: "medium",
      tone: "text-amber-500",
      href: "/whatsapp",
      badge: "Medium",
    });
  }
  if (data?.summary.payables) {
    out.push({
      title: `${inrShort(data.summary.payables)} owed to vendors`,
      detail:
        `Across ${(data as any).counts?.creditors ?? 0} creditor ledgers with a balance` +
        ((data as any).summary?.advancesToVendors
          ? `, net of ${inrShort((data as any).summary.advancesToVendors)} advances paid.`
          : "."),
      severity: "medium",
      tone: "text-amber-500",
      href: "/vendors",
      badge: "Medium",
    });
  }
  if (!out.length) {
    out.push({
      title: "Nothing needs attention",
      detail: "Everything that's connected is running normally.",
      severity: "ok",
      tone: "text-emerald-500",
      badge: "Good",
    });
  }
  return out;
}
