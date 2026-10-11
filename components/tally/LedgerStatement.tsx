"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileDown,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import TallyPeriodBar from "@/components/tally/TallyPeriodBar";
import { getTallySettings } from "@/lib/preferences";
import { postTallyStream } from "@/lib/tallyClient";
import { useTallyPeriod, type ResolvedPeriod, type TallyProgressInfo } from "@/lib/tallyPeriod";
import { useSession } from "@/lib/session";
import { BIOME_COMPANY, letterheadFrom } from "@/lib/companyProfile";
import {
  amt,
  balText,
  exportStatementExcel,
  exportStatementPdf,
  tallyDate,
  type StatementExportData,
  type StatementRowData,
} from "@/lib/ledgerStatementExport";

/**
 * Ledger statement — any Tally ledger, laid out like a printed Tally
 * "Ledger Account": company letterhead, the party's details, then every
 * voucher with a running balance. Data: /api/tally/ledger-statement.
 */

interface LedgerOption {
  name: string;
  group: string | null;
  categoryLabel: string;
}

interface Statement {
  fetchedAt: string;
  company: string;
  companyProfile: any;
  period: ResolvedPeriod & { from: string; to: string };
  ledger: {
    name: string;
    group: string | null;
    primaryGroup: string | null;
    categoryLabel: string;
    profitAndLoss: boolean;
    details: null | {
      mailingName: string | null;
      address: string[];
      state: string | null;
      pincode: string | null;
      country: string | null;
      gstin: string | null;
      gstRegistrationType: string | null;
      pan: string | null;
      contactPerson: string | null;
      phone: string | null;
      email: string | null;
    };
  };
  opening: number;
  rows: StatementRowData[];
  totals: { debit: number; credit: number; count: number };
  closing: number;
  tallyClosing: number | null;
  mismatch: string | null;
  warnings: string[];
  partner: null | {
    code: string | null;
    legalName: string | null;
    gstin: string | null;
    pan: string | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    responsiblePerson: string | null;
  };
}

const conn = () => {
  const s = getTallySettings();
  return { mode: s.mode, host: s.host, port: s.port, agentUrl: s.agentUrl, agentApiKey: s.agentApiKey, company: s.companyName };
};

export default function LedgerStatement({ initialLedger }: { initialLedger: string }) {
  const router = useRouter();
  const { user } = useSession();
  const { choice, setChoice, dates } = useTallyPeriod();
  const { fromDate, toDate } = dates;
  const [ledger, setLedger] = useState(initialLedger);
  const [options, setOptions] = useState<LedgerOption[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(!initialLedger);
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TallyProgressInfo | null>(null);
  const [narration, setNarration] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setLedger(initialLedger), [initialLedger]);

  // Ledger names for the picker (every group — vendors, clients, bank, expenses).
  useEffect(() => {
    let alive = true;
    fetch("/api/tally/ledger-statement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...conn(), list: true }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Ledger list couldn't be read (${r.status}).`);
        if (alive) setOptions(j.ledgers || []);
      })
      .catch((e) => alive && setOptionsError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!ledger) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setProgress(null);
      setData(null);
      setOpen(new Set());
      try {
        const { ok, status, json } = await postTallyStream<Statement>(
          "/api/tally/ledger-statement",
          { ...conn(), ledger, fromDate, toDate, fresh },
          { signal: ctrl.signal, onProgress: (p) => !ctrl.signal.aborted && setProgress(p) }
        );
        if (ctrl.signal.aborted) return;
        if (!ok) throw new Error(json.error || `Tally couldn't be read (${status}).`);
        setData(json);
      } catch (e: any) {
        if (ctrl.signal.aborted || e?.name === "AbortError") return;
        setError(e?.message || "Tally couldn't be read. Check Settings → Tally.");
      } finally {
        if (abortRef.current === ctrl) {
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [ledger, fromDate, toDate]
  );

  useEffect(() => {
    load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  const pick = (name: string) => {
    setPickerOpen(false);
    setQuery("");
    setLedger(name);
    router.replace(`/ledgers/statement?ledger=${encodeURIComponent(name)}`);
  };

  const matches = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.name.toLowerCase().includes(q) || (o.group || "").toLowerCase().includes(q) || o.categoryLabel.toLowerCase().includes(q))
      : options;
    return list.slice(0, 80);
  }, [options, query]);

  const letterhead = letterheadFrom(data?.companyProfile);
  const periodText = data ? `${tallyDate(data.period.from)} to ${tallyDate(data.period.to)}` : "";

  /** The party block: Tally's ledger master first, the registry fills gaps. */
  const partyFields = useMemo((): [string, string][] => {
    if (!data) return [];
    const d = data.ledger.details;
    const p = data.partner;
    const address = d?.address?.length
      ? [...d.address, d.pincode ? `PIN ${d.pincode}` : ""].filter(Boolean).join(", ")
      : p?.address || "";
    const rows: [string, string | null | undefined][] = [
      ["Ledger", data.ledger.name],
      ["Under (group)", [data.ledger.group, data.ledger.categoryLabel !== "Other" && data.ledger.categoryLabel !== data.ledger.group ? data.ledger.categoryLabel : null].filter(Boolean).join(" · ")],
      ["Mailing name", d?.mailingName && d.mailingName !== data.ledger.name ? d.mailingName : p?.legalName && p.legalName !== data.ledger.name ? p.legalName : null],
      ["Address", address],
      ["State", d?.state || null],
      ["GSTIN/UIN", d?.gstin || p?.gstin],
      ["PAN", d?.pan || p?.pan],
      ["Contact", d?.contactPerson || p?.contactPerson],
      ["Phone", d?.phone || p?.phone],
      ["Email", d?.email || p?.email],
      ["Registry code", p?.code],
      ["Responsible person", p?.responsiblePerson],
    ];
    return rows.filter(([, v]) => v && String(v).trim()) as [string, string][];
  }, [data]);

  const exportData = (): StatementExportData | null =>
    data
      ? {
          letterhead,
          ledgerName: data.ledger.name,
          periodText,
          party: { fields: partyFields },
          opening: data.opening,
          rows: data.rows,
          totals: data.totals,
          closing: data.closing,
          withNarration: narration,
          generatedBy: user?.name || user?.username || "",
          company: data.company,
        }
      : null;

  async function doExport(kind: "pdf" | "xlsx") {
    const d = exportData();
    if (!d) return;
    setBusy(kind);
    try {
      if (kind === "pdf") await exportStatementPdf(d);
      else await exportStatementExcel(d);
    } catch (e: any) {
      setError(`Export failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const lastEntry = data?.rows.length ? data.rows[data.rows.length - 1].date : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pt-4">
      {/* ---------- Controls ---------- */}
      <GlassCard activeBorder className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-biome-leaf/12 p-2.5">
              <ScrollText size={20} className="text-biome-leafBright" />
            </div>
            <div>
              <Link href="/ledgers" className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-biome-muted hover:text-biome-text">
                <ArrowLeft size={11} /> Ledgers
              </Link>
              <h1 className="font-display text-xl font-semibold text-biome-text">Ledger statement</h1>
              <p className="mt-0.5 max-w-2xl text-[12px] text-biome-muted">
                Any ledger from Tally — vendor, client, bank, expense — with every voucher and a running balance, the way
                Tally&apos;s Ledger Vouchers screen shows it. Double-click a voucher (or press the arrow) to see all its entries.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11.5px] text-biome-text">
              <input type="checkbox" checked={narration} onChange={(e) => setNarration(e.target.checked)} data-testid="toggle-narration" />
              Narration
            </label>
            <PremiumButton variant="ghost" onClick={() => load(true)} disabled={loading || !ledger}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </PremiumButton>
            <PremiumButton variant="ghost" onClick={() => doExport("pdf")} disabled={!data || busy !== null}>
              {busy === "pdf" ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} PDF
            </PremiumButton>
            <PremiumButton variant="ghost" onClick={() => doExport("xlsx")} disabled={!data || busy !== null}>
              {busy === "xlsx" ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Excel
            </PremiumButton>
          </div>
        </div>

        {/* Ledger picker */}
        <div className="relative mt-4">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex w-full items-center gap-2 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5 text-left text-[13px] text-biome-text"
            data-testid="ledger-picker"
          >
            <Search size={14} className="text-biome-muted" />
            <span className="flex-1 truncate">{ledger || "Pick a ledger — search any vendor, client, bank or expense ledger"}</span>
            <ChevronDown size={14} className="text-biome-muted" />
          </button>
          {pickerOpen && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-biome-line bg-biome-surface p-2 shadow-xl">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) pick(matches[0].name);
                  if (e.key === "Escape") setPickerOpen(false);
                }}
                placeholder="Type a ledger or group name…"
                className="mb-2 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-[12.5px] text-biome-text outline-none placeholder:text-biome-muted/70"
              />
              <div className="max-h-72 overflow-y-auto">
                {!options && !optionsError && (
                  <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-biome-muted">
                    <Loader2 size={12} className="animate-spin" /> Reading ledger names from Tally…
                  </p>
                )}
                {optionsError && <p className="px-2 py-3 text-[12px] text-rose-500">{optionsError}</p>}
                {options && !matches.length && <p className="px-2 py-3 text-[12px] text-biome-muted">No ledger matches.</p>}
                {matches.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() => pick(o.name)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-biome-text hover:bg-biome-hover"
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="shrink-0 text-[10.5px] text-biome-muted">{o.group || o.categoryLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      <TallyPeriodBar choice={choice} onChange={setChoice} period={data?.period ?? null} loading={loading} progress={progress} showAsOn={false} />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-[12.5px] text-biome-text" data-testid="statement-error">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-500" />
          <div>
            <p className="font-semibold">The ledger couldn&apos;t be read from Tally.</p>
            <p className="mt-0.5 text-biome-muted">{error}</p>
            <p className="mt-1 text-[11.5px] text-biome-muted">
              Nothing is shown rather than an incomplete statement.{" "}
              <Link href="/settings" className="text-biome-leafBright hover:underline">
                Check Settings → Tally
              </Link>
            </p>
          </div>
        </div>
      )}

      {!ledger && !error && (
        <GlassCard className="p-8 text-center text-[13px] text-biome-muted">Pick a ledger above to see its statement.</GlassCard>
      )}

      {loading && !data && ledger && (
        <GlassCard className="flex items-center gap-2 p-6 text-[12.5px] text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Reading {ledger} from Tally{progress?.label ? ` — ${progress.label}` : "…"}
        </GlassCard>
      )}

      {data && (
        <>
          {data.mismatch && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-biome-text" data-testid="statement-mismatch">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
              {data.mismatch}
            </div>
          )}
          {data.warnings?.map((w) => (
            <p key={w} className="px-1 text-[11px] text-biome-muted">
              {w}
            </p>
          ))}

          {/* ---------- The printed-ledger "paper" (fixed light colours so it reads the same in every theme) ---------- */}
          <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl" data-testid="statement-paper">
            <div className="h-1.5 bg-[#14532d]" />
            <div className="relative px-6 pb-4 pt-5 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BIOME_COMPANY.logo} alt="" className="absolute left-6 top-5 h-12 w-12 rounded-lg object-contain" />
              <p className="font-display text-[19px] font-bold uppercase tracking-wide text-[#14532d]">{letterhead.name}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-600">{letterhead.address.join(", ")}</p>
              <p className="text-[11.5px] text-slate-600">
                GSTIN: <span className="font-semibold text-slate-800">{letterhead.gstin}</span> · PAN: {letterhead.pan} · State: {letterhead.state}
              </p>
              <div className="mx-auto mt-3 h-px max-w-3xl bg-slate-200" />
              <p className="mt-3 text-[15px] font-bold tracking-wide text-slate-900">Ledger Account</p>
              <p className="text-[14px] font-semibold text-slate-800" data-testid="statement-ledger-name">
                {data.ledger.name}
              </p>
              <p className="text-[11.5px] text-slate-600">{periodText}</p>
            </div>

            {/* Party block */}
            <div className="mx-6 mb-4 grid gap-x-8 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] sm:grid-cols-2" data-testid="statement-party">
              {partyFields.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="w-32 shrink-0 font-semibold text-slate-500">{k}</span>
                  <span className="min-w-0 break-words text-slate-900">{v}</span>
                </div>
              ))}
            </div>

            {/* Ledger table */}
            <div className="overflow-x-auto px-6 pb-6">
              <table className="w-full border-collapse text-[12px]" data-testid="statement-table">
                <thead>
                  <tr className="bg-[#14532d] text-white">
                    <th className="w-6 px-1 py-2" />
                    <th className="px-2 py-2 text-left font-semibold">Date</th>
                    <th className="px-2 py-2 text-left font-semibold">Particulars</th>
                    <th className="px-2 py-2 text-left font-semibold">Vch Type</th>
                    <th className="px-2 py-2 text-left font-semibold">Vch No.</th>
                    <th className="px-2 py-2 text-right font-semibold">Debit</th>
                    <th className="px-2 py-2 text-right font-semibold">Credit</th>
                    <th className="px-2 py-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold">
                    <td />
                    <td className="px-2 py-1.5 text-slate-600">{tallyDate(data.period.from)}</td>
                    <td className="px-2 py-1.5">Opening Balance</td>
                    <td />
                    <td />
                    <td className="px-2 py-1.5 text-right tabular-nums">{data.opening < 0 ? amt(data.opening) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{data.opening > 0 ? amt(data.opening) : ""}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{balText(data.opening)}</td>
                  </tr>
                  {data.rows.map((r, i) => {
                    const isOpen = open.has(i);
                    return (
                      <Fragment key={`${r.date}-${r.voucherNumber}-${i}`}>
                        <tr
                          className={`cursor-pointer border-b border-slate-100 align-top hover:bg-emerald-50 ${i % 2 ? "bg-slate-50/60" : ""}`}
                          onDoubleClick={() => toggle(i)}
                          data-testid="statement-row"
                        >
                          <td className="px-1 py-1.5 text-slate-400">
                            <button type="button" onClick={() => toggle(i)} aria-label={isOpen ? "Hide entries" : "Show entries"} className="hover:text-slate-800">
                              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">{tallyDate(r.date)}</td>
                          <td className="px-2 py-1.5">
                            <span className="text-slate-900">
                              <span className="text-slate-400">{r.debit ? "To " : "By "}</span>
                              {r.particulars}
                            </span>
                            {r.moreParticulars > 0 && <span className="ml-1 text-[10.5px] text-slate-500">(+{r.moreParticulars} more)</span>}
                            {narration && r.narration && <span className="block text-[11px] italic text-slate-500">{r.narration}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{r.voucherType}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.voucherNumber}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{amt(r.debit)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{amt(r.credit)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700">{balText(r.balance)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-slate-200 bg-emerald-50/60" data-testid="statement-entries">
                            <td />
                            <td colSpan={7} className="px-2 py-2">
                              <table className="w-full max-w-2xl text-[11.5px]">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="py-0.5 text-left font-semibold">Ledger</th>
                                    <th className="py-0.5 text-right font-semibold">Debit</th>
                                    <th className="py-0.5 text-right font-semibold">Credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.entries.map((e, k) => (
                                    <tr key={k} className={e.ledger.trim().toLowerCase() === data.ledger.name.trim().toLowerCase() ? "font-semibold" : ""}>
                                      <td className="py-0.5 text-slate-800">{e.ledger}</td>
                                      <td className="py-0.5 text-right tabular-nums">{e.amount < 0 ? amt(e.amount) : ""}</td>
                                      <td className="py-0.5 text-right tabular-nums">{e.amount > 0 ? amt(e.amount) : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {(r.reference || r.narration) && (
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {r.reference ? `Ref: ${r.reference}` : ""}
                                  {r.reference && r.narration ? " · " : ""}
                                  {r.narration ? `Narration: ${r.narration}` : ""}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!data.rows.length && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-[12px] italic text-slate-500">
                        No vouchers on this ledger in {data.period.label || periodText}.
                      </td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-[#1f7a4c] bg-emerald-50 font-semibold" data-testid="statement-total">
                    <td />
                    <td />
                    <td className="px-2 py-1.5">Current Total ({data.totals.count} vouchers)</td>
                    <td />
                    <td />
                    <td className="px-2 py-1.5 text-right tabular-nums">{amt(data.totals.debit) || "0.00"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{amt(data.totals.credit) || "0.00"}</td>
                    <td />
                  </tr>
                  <tr className="border-b-4 border-double border-[#1f7a4c] bg-emerald-50 font-bold" data-testid="statement-closing">
                    <td />
                    <td className="px-2 py-1.5 text-slate-600">{tallyDate(data.period.to)}</td>
                    <td className="px-2 py-1.5">Closing Balance</td>
                    <td />
                    <td />
                    <td className="px-2 py-1.5 text-right tabular-nums">{data.closing < 0 ? amt(data.closing) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{data.closing > 0 ? amt(data.closing) : ""}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{balText(data.closing)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 text-[10.5px] text-slate-500">
                From Tally · {data.company} · read {new Date(data.fetchedAt).toLocaleString("en-IN")}
                {lastEntry ? ` · last entry ${tallyDate(lastEntry)}` : ""}
                {data.tallyClosing !== null && !data.mismatch ? " · closing balance matches Tally" : ""}
                {data.ledger.profitAndLoss ? " · profit & loss ledger: balance is the movement since 1 April" : ""}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
