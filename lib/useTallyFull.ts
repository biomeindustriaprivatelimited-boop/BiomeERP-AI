"use client";

import { useCallback, useEffect, useState } from "react";
import { getTallySettings } from "@/lib/preferences";

/**
 * One place that fetches the full Tally picture — masters AND vouchers —
 * so the dashboard, Analytics and Reports all show the same numbers
 * rather than each querying differently and disagreeing.
 */

export interface TallyParty {
  name: string;
  group: string | null;
  primaryGroup?: string | null;
  /** Natural direction (debtors/cash/bank Dr-positive, creditors/sales/OD
   *  Cr-positive). Negative = advance or overdrawn. */
  closingBalance: number;
  /** As Tally sent it: Dr negative, Cr positive. */
  rawClosingBalance?: number;
  side?: "Dr" | "Cr" | "";
  transactionCount: number;
  totalValue: number;
  lastTransaction: string | null;
}

export interface TallyTransaction {
  invoiceNo: string;
  date: string | null;
  party: string | null;
  voucherType: string | null;
  narration: string | null;
  amount: number | null;
}

export interface TallyFull {
  fetchedAt: string;
  company: string | null;
  /** Companies open in Tally right now. */
  companies?: string[];
  /** label: "FY 2026-27 till today"; range: "01-Apr-2026 to 04-Oct-2026". */
  period: { from: string; to: string; label?: string; range?: string; fy?: string };
  /** "FY 2026-27 till today · <company>" — put this next to any KPI. */
  basis?: string;
  ledgerCount?: number;
  /** debtors/creditors count only ledgers with a non-zero balance. */
  counts: {
    ledgers: number;
    vouchers: number;
    debtors: number;
    creditors: number;
    customerAdvances?: number;
    vendorAdvances?: number;
  };
  voucherError: string | null;
  warnings?: string[];
  summary: {
    cashInHand: number | null;
    /** Bank Accounts only (net); OD/cash-credit is bankOverdraft. */
    bankBalance: number | null;
    bankOverdraft?: number | null;
    liquidTotal?: number | null;
    /** NET of customer advances. */
    receivables: number | null;
    receivablesGross?: number | null;
    advancesFromCustomers?: number | null;
    /** NET of advances paid to vendors. */
    payables: number | null;
    payablesGross?: number | null;
    advancesToVendors?: number | null;
    /** Sales Accounts for the period (excl. GST, net of returns). */
    sales: number | null;
    purchases: number | null;
    taxLiability: number | null;
    expenses: number | null;
    otherIncome?: number | null;
    grossMargin: number | null;
  };
  parties: {
    debtors: TallyParty[];
    creditors: TallyParty[];
    cash: TallyParty[];
    bank: TallyParty[];
    bankOD?: TallyParty[];
    salesLedgers: TallyParty[];
    purchaseLedgers: TallyParty[];
    expenses: TallyParty[];
    taxes?: TallyParty[];
  };
  transactions: TallyTransaction[];
  monthlySeries: {
    month: string;
    sales: number;
    purchases: number;
    receipts: number;
    payments: number;
    count: number;
  }[];
  voucherTypeCounts: Record<string, { count: number; value: number }>;
  missingGroups: string[];
}

/** ₹48,75,000 -> "₹48.75 L". Indian readers scan lakhs and crores. */
export function inrShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function inrFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** One line for under the KPIs: "FY 2026-27 till today · Biome Industria
 *  Private Limited · synced 10:42 am". */
export function tallyBasisLine(d: Pick<TallyFull, "period" | "company" | "fetchedAt"> | null | undefined): string {
  if (!d) return "";
  const parts = [
    d.period?.label ? `${d.period.label}${d.period.range ? ` (${d.period.range})` : ""}` : null,
    d.company,
    d.fetchedAt
      ? `synced ${new Date(d.fetchedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function useTallyFull(options: { includeVouchers?: boolean } = {}) {
  const [data, setData] = useState<TallyFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** "unreachable" | "timeout" | "choose-company" | "company-not-open" | … */
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const s = getTallySettings();
      const res = await fetch("/api/tally/full", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: s.mode,
          host: s.host,
          port: s.port,
          agentUrl: s.agentUrl,
          agentApiKey: s.agentApiKey,
          company: s.companyName,
          includeVouchers: options.includeVouchers !== false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = new Error(json.error || `Request failed (${res.status}).`) as Error & { code?: string };
        e.code = json.code;
        throw e;
      }
      setData(json);
    } catch (err) {
      // Never keep the previous figures on screen after a failed refresh —
      // old numbers that look current are worse than a clear blank.
      setError((err as Error).message);
      setErrorCode((err as any).code ?? null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [options.includeVouchers]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, errorCode, reload };
}
