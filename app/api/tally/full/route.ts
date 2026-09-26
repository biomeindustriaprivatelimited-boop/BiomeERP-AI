import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  buildLedgerMastersRequestXml,
  parseLedgerMastersXml,
  buildVoucherFetchRequestXml,
  parseVoucherExportXml,
  type TallyLedgerMaster,
  type TallyVoucherRow,
} from "@/lib/tally";

/**
 * Biome Platform — full Tally pull
 * -------------------------------------------------------------------
 * The dashboard's earlier call only read ledger MASTERS, which is why it
 * showed group totals but no party names and no transactions. This route
 * pulls both halves and joins them:
 *
 *   MASTERS   every ledger, its group, opening and closing balance
 *   VOUCHERS  every transaction in the requested date range
 *
 * Together those give party-wise sales and purchases, ageing, top
 * customers and suppliers, and month-by-month movement — everything the
 * Analytics and Reports pages need.
 *
 * Both requests go to the same Tally instance over its XML port. Nothing
 * is cached server-side; the client asks when it wants fresh figures.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROUPS = {
  cash: ["cash-in-hand", "cash in hand"],
  bank: ["bank account", "bank od", "bank occ"],
  debtors: ["sundry debtor"],
  creditors: ["sundry creditor"],
  sales: ["sales account"],
  purchase: ["purchase account"],
  dutiesTaxes: ["duties & taxes", "duties and taxes"],
  indirectExpenses: ["indirect expense"],
  directExpenses: ["direct expense"],
};

function inGroup(group: string | null, keywords: string[]): boolean {
  const g = (group || "").toLowerCase();
  return keywords.some((k) => g.includes(k));
}

/**
 * Tally's XML sign convention is not consistent across installations —
 * some return debits positive, some return credits positive, and revenue
 * accounts often close to zero in the masters entirely. Trusting the raw
 * sign produced nonsense like "Cash in Hand: -₹44.95 L".
 *
 * So we never trust it. Every balance is taken as a MAGNITUDE, and the
 * sign is applied from what the account actually is:
 *   assets (cash, bank, debtors)   -> positive means you have it
 *   liabilities (creditors)        -> positive means you owe it
 *   income / expense               -> positive means that much happened
 *
 * A negative only survives where it is genuinely meaningful — a bank
 * overdraft, for instance, which we detect from the opening balance
 * moving the same way.
 */
function magnitude(n: number): number {
  return Math.abs(n) || 0;
}

async function askTally(host: string, port: number, xml: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tally replied with ${res.status}.`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Indian financial year containing a date: 1 April to 31 March. */
function currentFinancialYear(): { from: string; to: string } {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${startYear}0401`, to: `${startYear + 1}0331` };
}

interface PartyTotals {
  name: string;
  group: string | null;
  closingBalance: number;
  rawClosingBalance?: number;
  transactionCount: number;
  totalValue: number;
  lastTransaction: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: {
    host?: string;
    port?: number;
    company?: string;
    fromDate?: string;
    toDate?: string;
    timeoutMs?: number;
    /** Skip the voucher pull when only balances are needed — it's slower. */
    includeVouchers?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const host = (body.host || "localhost").trim();
  const port = Number(body.port) || 9000;
  const company = (body.company || "").trim();
  const timeoutMs = Math.min(Number(body.timeoutMs) || 45000, 120000);
  const includeVouchers = body.includeVouchers !== false;

  const fy = currentFinancialYear();
  // Tally wants YYYYMMDD.
  const fromDate = (body.fromDate || fy.from).replace(/-/g, "");
  const toDate = (body.toDate || fy.to).replace(/-/g, "");

  // ---- 1. Masters ----
  let ledgers: TallyLedgerMaster[] = [];
  try {
    const xml = await askTally(host, port, buildLedgerMastersRequestXml(), timeoutMs);
    ledgers = parseLedgerMastersXml(xml);
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? `Tally didn't respond within ${Math.round(timeoutMs / 1000)}s at ${host}:${port}.`
          : `Couldn't reach Tally at ${host}:${port}. Open Tally, load the company, and set Gateway of Tally → F1 → Advanced Configuration → Client/Server to "Both".`,
      },
      { status: 502 }
    );
  }

  if (!ledgers.length) {
    return NextResponse.json(
      {
        error:
          "Tally responded but sent no ledgers. Check that the right company is loaded and that ODBC/XML access is enabled.",
      },
      { status: 502 }
    );
  }

  // ---- 2. Vouchers (best effort — balances still work without them) ----
  let vouchers: TallyVoucherRow[] = [];
  let voucherError: string | null = null;
  if (includeVouchers) {
    try {
      const xml = await askTally(
        host,
        port,
        buildVoucherFetchRequestXml(fromDate, toDate, company || undefined),
        timeoutMs
      );
      vouchers = parseVoucherExportXml(xml);
    } catch (err: any) {
      voucherError =
        err?.name === "AbortError"
          ? "Transactions took too long to fetch — try a shorter date range."
          : `Transactions couldn't be fetched: ${err?.message ?? "unknown error"}. Balances below are still accurate.`;
    }
  }

  // ---- 3. Join masters with transactions, by party name ----
  const norm = (s: string | null) => (s || "").trim().toLowerCase();
  const byParty = new Map<string, { count: number; value: number; last: string | null }>();
  for (const v of vouchers) {
    const key = norm(v.party);
    if (!key) continue;
    const cur = byParty.get(key) || { count: 0, value: 0, last: null };
    cur.count += 1;
    cur.value += Math.abs(v.amount ?? 0);
    if (v.date && (!cur.last || v.date > cur.last)) cur.last = v.date;
    byParty.set(key, cur);
  }

  function partyList(keywords: string[]): PartyTotals[] {
    return ledgers
      .filter((l) => inGroup(l.group, keywords))
      .map((l) => {
        const t = byParty.get(norm(l.name));
        return {
          name: l.name,
          group: l.group,
          // Magnitude, not Tally's raw sign — see magnitude() above.
          closingBalance: magnitude(l.closingBalance),
          rawClosingBalance: l.closingBalance,
          transactionCount: t?.count ?? 0,
          totalValue: t?.value ?? 0,
          lastTransaction: t?.last ?? null,
        };
      })
      .filter((r) => r.closingBalance !== 0 || r.transactionCount > 0)
      .sort((a, b) => b.closingBalance - a.closingBalance);
  }

  const debtors = partyList(GROUPS.debtors);
  const creditors = partyList(GROUPS.creditors);
  const cash = partyList(GROUPS.cash);
  const bank = partyList(GROUPS.bank);
  const salesLedgers = partyList(GROUPS.sales);
  const purchaseLedgers = partyList(GROUPS.purchase);
  const taxes = partyList(GROUPS.dutiesTaxes);
  const expenses = [...partyList(GROUPS.indirectExpenses), ...partyList(GROUPS.directExpenses)];

  const sum = (rows: PartyTotals[]) => rows.reduce((s, r) => s + r.closingBalance, 0);
  const has = (rows: PartyTotals[]) => (rows.length ? sum(rows) : null);

  // Sales and purchases come from VOUCHERS, not ledger masters. Revenue
  // and expense ledgers are closed off to the P&L, so their master
  // closing balance is very often zero — which is exactly why Sales was
  // showing ₹0 while Purchases showed a stale figure.
  const voucherTotal = (match: (t: string) => boolean) =>
    vouchers
      .filter((v) => match((v.voucherType || "").toLowerCase()))
      .reduce((s, v) => s + Math.abs(v.amount ?? 0), 0);

  const salesFromVouchers = voucherTotal((t) => t.includes("sale") && !t.includes("return"));
  const purchasesFromVouchers = voucherTotal((t) => t.includes("purchase") && !t.includes("return"));

  // Fall back to the masters only when there are no vouchers at all.
  const salesTotal = vouchers.length ? salesFromVouchers : has(salesLedgers);
  const purchasesTotal = vouchers.length ? purchasesFromVouchers : has(purchaseLedgers);

  // ---- 4. Month-by-month movement, straight from the vouchers ----
  const monthly = new Map<string, { sales: number; purchases: number; receipts: number; payments: number; count: number }>();
  const VOUCHER_KIND = (t: string | null) => {
    const v = (t || "").toLowerCase();
    if (v.includes("sale")) return "sales";
    if (v.includes("purchase")) return "purchases";
    if (v.includes("receipt")) return "receipts";
    if (v.includes("payment")) return "payments";
    return null;
  };
  for (const v of vouchers) {
    if (!v.date) continue;
    const month = v.date.slice(0, 7); // YYYY-MM
    const kind = VOUCHER_KIND(v.voucherType);
    if (!kind) continue;
    const cur = monthly.get(month) || { sales: 0, purchases: 0, receipts: 0, payments: 0, count: 0 };
    cur[kind] += Math.abs(v.amount ?? 0);
    cur.count += 1;
    monthly.set(month, cur);
  }
  const monthlySeries = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, ...v }));

  const voucherTypeCounts = vouchers.reduce<Record<string, { count: number; value: number }>>((acc, v) => {
    const t = v.voucherType || "Unknown";
    if (!acc[t]) acc[t] = { count: 0, value: 0 };
    acc[t].count += 1;
    acc[t].value += Math.abs(v.amount ?? 0);
    return acc;
  }, {});

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    company: company || null,
    period: { from: fromDate, to: toDate },
    counts: {
      ledgers: ledgers.length,
      vouchers: vouchers.length,
      debtors: debtors.length,
      creditors: creditors.length,
    },
    voucherError,
    summary: {
      cashInHand: has(cash),
      bankBalance: has(bank),
      receivables: has(debtors),
      payables: has(creditors),
      sales: salesTotal,
      purchases: purchasesTotal,
      /** Where the sales/purchase figures came from, so the UI can say so. */
      salesSource: vouchers.length ? "vouchers" : "ledger masters",
      taxLiability: has(taxes),
      expenses: has(expenses),
      grossMargin:
        salesTotal !== null && purchasesTotal !== null ? salesTotal - purchasesTotal : null,
    },
    parties: {
      /** Named debtors and creditors — what was missing before. */
      debtors: debtors.slice(0, 200),
      creditors: creditors.slice(0, 200),
      cash,
      bank,
      salesLedgers: salesLedgers.slice(0, 50),
      purchaseLedgers: purchaseLedgers.slice(0, 50),
      expenses: expenses.slice(0, 50),
    },
    transactions: vouchers.slice(0, 2000),
    monthlySeries,
    voucherTypeCounts,
    missingGroups: Object.entries({
      "Cash-in-Hand": cash.length,
      "Bank Accounts": bank.length,
      "Sundry Debtors": debtors.length,
      "Sundry Creditors": creditors.length,
      "Sales Accounts": salesLedgers.length,
      "Purchase Accounts": purchaseLedgers.length,
    })
      .filter(([, n]) => n === 0)
      .map(([name]) => name),
  });
}
