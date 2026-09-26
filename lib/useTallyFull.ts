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
  closingBalance: number;
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
  period: { from: string; to: string };
  counts: { ledgers: number; vouchers: number; debtors: number; creditors: number };
  voucherError: string | null;
  summary: {
    cashInHand: number | null;
    bankBalance: number | null;
    receivables: number | null;
    payables: number | null;
    sales: number | null;
    purchases: number | null;
    taxLiability: number | null;
    expenses: number | null;
    grossMargin: number | null;
  };
  parties: {
    debtors: TallyParty[];
    creditors: TallyParty[];
    cash: TallyParty[];
    bank: TallyParty[];
    salesLedgers: TallyParty[];
    purchaseLedgers: TallyParty[];
    expenses: TallyParty[];
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

export function useTallyFull(options: { includeVouchers?: boolean } = {}) {
  const [data, setData] = useState<TallyFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = getTallySettings();
      const res = await fetch("/api/tally/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: s.host,
          port: s.port,
          company: s.companyName,
          includeVouchers: options.includeVouchers !== false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [options.includeVouchers]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
