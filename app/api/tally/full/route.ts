import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { respondWithProgress } from "@/lib/tallyStream";
import {
  fetchTallyFinance,
  fetchVouchersRange,
  type VoucherRangeFetch,
  missingGroups,
  tallyErrorBody,
  round2,
  type ClassifiedLedger,
  type TallyVoucher,
} from "@/lib/tallyFinance";

/**
 * Biome Platform — full Tally pull (home KPIs, Analytics, Reports)
 * -------------------------------------------------------------------
 * BALANCES come from ledger closing balances for the chosen company and
 * period (lib/tallyFinance.ts has the rules: Tally sign convention, group
 * tree walk, SVCURRENTCOMPANY/SVFROMDATE/SVTODATE). Sales and Purchases
 * are the Sales Accounts / Purchase Accounts closing balances for the
 * period — what Tally's own P&L shows — never a voucher-type guess.
 *
 * VOUCHERS are optional extras (month-by-month chart, transaction list).
 * They never change a KPI.
 *
 * PERIOD: fromDate/toDate (YYYY-MM-DD) pick any range — P&L figures are
 * for exactly that range, balances are "as on" toDate. Long ranges are read
 * in pieces (balances per FY, transactions per month); send `stream: true`
 * to get progress lines while that happens (lib/tallyStream.ts).
 *
 * Readings are kept for 2 minutes (lib/tallyFinance.ts); `fresh: true`
 * (the Refresh button) reads Tally again. If Tally can't be read, the
 * caller gets an error and no figures.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PartyTotals {
  name: string;
  group: string | null;
  primaryGroup: string | null;
  /** Natural direction: debtors/cash/bank Dr-positive, creditors/OD/sales
   *  Cr-positive. Negative = advance / overdrawn. */
  closingBalance: number;
  /** Exactly as Tally sent it (Dr negative, Cr positive). */
  rawClosingBalance: number;
  side: "Dr" | "Cr" | "";
  transactionCount: number;
  totalValue: number;
  lastTransaction: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: {
    mode?: "direct" | "agent";
    host?: string;
    port?: number;
    agentUrl?: string;
    agentApiKey?: string;
    company?: string;
    companyName?: string;
    fromDate?: string;
    toDate?: string;
    timeoutMs?: number;
    /** Skip the voucher pull when only balances are needed — it's slower. */
    includeVouchers?: boolean;
    /** Bypass the 2-minute cache. */
    fresh?: boolean;
    /** Answer with progress lines (NDJSON). */
    stream?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const target = {
    mode: body.mode,
    host: body.host,
    port: Number(body.port) || 9000,
    agentUrl: body.agentUrl,
    agentApiKey: body.agentApiKey,
    timeoutMs: Math.min(Number(body.timeoutMs) || 45000, 120000),
  };
  const includeVouchers = body.includeVouchers !== false;

  return respondWithProgress(body.stream === true, async (progress) => {
  let fin;
  try {
    fin = await fetchTallyFinance({
      ...target,
      company: (body.company ?? body.companyName ?? "").trim() || undefined,
      fromDate: body.fromDate,
      toDate: body.toDate,
      fresh: body.fresh === true,
      onProgress: progress,
    });
  } catch (err) {
    const { status, body: errBody } = tallyErrorBody(err);
    return {
      status,
      body: { ...errBody, host: target.host || "localhost", port: target.port, attemptedAt: new Date().toISOString() },
    };
  }

  // ---- Vouchers (best effort, one month at a time) ----
  let vouchers: TallyVoucher[] = [];
  let voucherError: string | null = null;
  let voucherSource: string | null = null;
  let voucherChunks: VoucherRangeFetch["chunks"] | null = null;
  if (includeVouchers) {
    const v = await fetchVouchersRange(target, fin.company, fin.period.from, fin.period.to, {
      fresh: body.fresh === true,
      onProgress: progress,
    });
    vouchers = v.vouchers;
    voucherError = v.error;
    voucherSource = v.source;
    voucherChunks = v.chunks;
  }

  // ---- Join balances with transactions, by party name ----
  const norm = (s: string | null) => (s || "").trim().toLowerCase();
  const byParty = new Map<string, { count: number; value: number; last: string | null }>();
  for (const v of vouchers) {
    const key = norm(v.party);
    if (!key) continue;
    const cur = byParty.get(key) || { count: 0, value: 0, last: null };
    cur.count += 1;
    cur.value = round2(cur.value + Math.abs(v.amount ?? 0));
    if (v.date && (!cur.last || v.date > cur.last)) cur.last = v.date;
    byParty.set(key, cur);
  }

  const toParty = (l: ClassifiedLedger): PartyTotals => {
    const t = byParty.get(norm(l.name));
    return {
      name: l.name,
      group: l.group,
      primaryGroup: l.primaryGroup,
      closingBalance: l.natural,
      rawClosingBalance: l.closingBalance,
      side: l.side,
      transactionCount: t?.count ?? 0,
      totalValue: t?.value ?? 0,
      lastTransaction: t?.last ?? null,
    };
  };
  const list = (rows: ClassifiedLedger[]) =>
    rows
      .map(toParty)
      .filter((r) => r.closingBalance !== 0 || r.transactionCount > 0)
      .sort((a, b) => b.closingBalance - a.closingBalance);

  const b = fin.buckets;
  const debtors = list(b.debtors.ledgers);
  const creditors = list(b.creditors.ledgers);

  // ---- Month-by-month movement ----
  // With the bridge's ledger lines, sales/purchases per month are the
  // amounts posted to Sales/Purchase ledgers (so GST and freight are not
  // counted as sales). Without lines, fall back to the voucher type name.
  const category = new Map(fin.ledgers.map((l) => [norm(l.name), l.category] as const));
  const monthly = new Map<string, { sales: number; purchases: number; receipts: number; payments: number; count: number }>();
  for (const v of vouchers) {
    if (!v.date) continue;
    const month = v.date.slice(0, 7);
    const cur = monthly.get(month) || { sales: 0, purchases: 0, receipts: 0, payments: 0, count: 0 };
    const type = (v.voucherType || "").toLowerCase();
    let touched = false;
    if (v.entries.length && voucherSource === "bridge") {
      for (const e of v.entries) {
        const c = category.get(norm(e.ledger));
        if (c === "sales") { cur.sales = round2(cur.sales + e.amount); touched = true; }
        if (c === "purchases") { cur.purchases = round2(cur.purchases - e.amount); touched = true; }
      }
    } else if (type.includes("sale") && !type.includes("return")) {
      cur.sales = round2(cur.sales + Math.abs(v.amount ?? 0));
      touched = true;
    } else if (type.includes("purchase") && !type.includes("return")) {
      cur.purchases = round2(cur.purchases + Math.abs(v.amount ?? 0));
      touched = true;
    }
    if (type.includes("receipt")) { cur.receipts = round2(cur.receipts + Math.abs(v.amount ?? 0)); touched = true; }
    else if (type.includes("payment")) { cur.payments = round2(cur.payments + Math.abs(v.amount ?? 0)); touched = true; }
    if (!touched) continue;
    cur.count += 1;
    monthly.set(month, cur);
  }
  const monthlySeries = [...monthly.entries()]
    .sort((a, c) => a[0].localeCompare(c[0]))
    .map(([month, v]) => ({ month, ...v }));

  const voucherTypeCounts = vouchers.reduce<Record<string, { count: number; value: number }>>((acc, v) => {
    const t = v.voucherType || "Unknown";
    if (!acc[t]) acc[t] = { count: 0, value: 0 };
    acc[t].count += 1;
    acc[t].value = round2(acc[t].value + Math.abs(v.amount ?? 0));
    return acc;
  }, {});

  return { status: 200, body: {
    ok: true,
    fetchedAt: fin.fetchedAt,
    company: fin.company,
    companies: fin.companies,
    period: { ...fin.period },
    /** "FY 2026-27 till today · Biome Industria Private Limited" */
    basis: `${fin.period.label} · ${fin.company}`,
    ledgerCount: fin.ledgers.length,
    counts: {
      ledgers: fin.ledgers.length,
      vouchers: vouchers.length,
      /** Only ledgers with a non-zero balance. */
      debtors: b.debtors.count,
      creditors: b.creditors.count,
      customerAdvances: b.debtors.ledgers.filter((l) => l.natural < 0).length,
      vendorAdvances: b.creditors.ledgers.filter((l) => l.natural < 0).length,
    },
    voucherError,
    voucherSource,
    warnings: fin.warnings,
    summary: fin.summary,
    parties: {
      debtors: debtors.slice(0, 200),
      creditors: creditors.slice(0, 200),
      cash: list(b.cash.ledgers),
      bank: list(b.bank.ledgers),
      bankOD: list(b.bankOD.ledgers),
      salesLedgers: list(b.sales.ledgers).slice(0, 50),
      purchaseLedgers: list(b.purchases.ledgers).slice(0, 50),
      expenses: [...list(b.directExpenses.ledgers), ...list(b.indirectExpenses.ledgers)]
        .sort((a, c) => c.closingBalance - a.closingBalance)
        .slice(0, 50),
      taxes: list(b.dutiesTaxes.ledgers),
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transactions: vouchers.slice(0, 2000).map(({ entries, ...v }) => v),
    monthlySeries,
    voucherTypeCounts,
    missingGroups: missingGroups(b),
    opening: fin.opening,
    booksFrom: fin.booksFrom,
    readings: fin.readings,
    fromCache: fin.fromCache,
    retried: fin.retried,
    voucherChunks,
  } };
  });
}
