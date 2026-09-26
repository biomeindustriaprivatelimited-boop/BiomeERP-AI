import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { buildLedgerMastersRequestXml, parseLedgerMastersXml, type TallyLedgerMaster } from "@/lib/tally";

/**
 * Dashboard figures, straight from Tally.
 *
 * Everything here is derived from real ledger balances — nothing is
 * invented or estimated. Where Tally has no matching group, the figure
 * comes back as null and the dashboard says so rather than showing a
 * confident zero, because a wrong number on a finance screen is worse
 * than an honest gap.
 *
 * Tally's sign convention: debit balances are positive, credit balances
 * negative. Assets and expenses sit on the debit side; income, capital
 * and liabilities on the credit side. So sales and creditors are flipped
 * to read as positive amounts here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Group names vary between Tally setups, so match on keywords. */
const GROUPS = {
  cash: ["cash-in-hand", "cash in hand"],
  bank: ["bank account", "bank od", "bank occ"],
  debtors: ["sundry debtor"],
  creditors: ["sundry creditor"],
  sales: ["sales account"],
  purchase: ["purchase account"],
  dutiesTaxes: ["duties & taxes", "duties and taxes"],
};

function matches(parent: string, keywords: string[]): boolean {
  const p = (parent || "").toLowerCase();
  return keywords.some((k) => p.includes(k));
}

interface Bucket {
  total: number;
  count: number;
  ledgers: { name: string; balance: number }[];
}

function bucket(ledgers: TallyLedgerMaster[], keywords: string[], flipSign = false): Bucket {
  const hits = ledgers.filter((l) => matches(l.group ?? "", keywords));
  const rows = hits.map((l) => ({
    name: l.name,
    balance: flipSign ? -l.closingBalance : l.closingBalance,
  }));
  return {
    total: rows.reduce((s, r) => s + r.balance, 0),
    count: rows.length,
    // Biggest balances first — that's what anyone scanning the list wants.
    ledgers: rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 12),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;

  let body: { host?: string; port?: number; company?: string; timeoutMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const host = (body.host || "localhost").trim();
  const port = Number(body.port) || 9000;
  const company = (body.company || "").trim();
  const timeoutMs = Math.min(Number(body.timeoutMs) || 20000, 60000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${host}:${port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: buildLedgerMastersRequestXml(),
      signal: controller.signal,
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Tally replied with ${res.status}. Check that the company is open and the port is right.` },
        { status: 502 }
      );
    }

    const xml = await res.text();
    const ledgers = parseLedgerMastersXml(xml);

    if (!ledgers.length) {
      return NextResponse.json(
        {
          error:
            "Tally responded but returned no ledgers. Make sure the right company is open and that XML requests are enabled under Gateway of Tally → F1 → Advanced Configuration.",
        },
        { status: 502 }
      );
    }

    // Income and liability balances are credits, so flip them to read
    // positive on screen.
    const cash = bucket(ledgers, GROUPS.cash);
    const bank = bucket(ledgers, GROUPS.bank);
    const debtors = bucket(ledgers, GROUPS.debtors);
    const creditors = bucket(ledgers, GROUPS.creditors, true);
    const sales = bucket(ledgers, GROUPS.sales, true);
    const purchase = bucket(ledgers, GROUPS.purchase);
    const taxes = bucket(ledgers, GROUPS.dutiesTaxes, true);

    const found = (b: Bucket) => (b.count > 0 ? b.total : null);

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      company: company || null,
      ledgerCount: ledgers.length,
      summary: {
        cashInHand: found(cash),
        bankBalance: found(bank),
        /** Cash + bank, the number most people mean by "cash". */
        liquidTotal: cash.count + bank.count > 0 ? cash.total + bank.total : null,
        receivables: found(debtors),
        payables: found(creditors),
        sales: found(sales),
        purchases: found(purchase),
        taxLiability: found(taxes),
        grossMargin:
          sales.count > 0 && purchase.count > 0 ? sales.total - purchase.total : null,
      },
      breakdown: { cash, bank, debtors, creditors, sales, purchase, taxes },
      /** Groups Tally didn't have, so the UI can explain a missing tile. */
      missingGroups: Object.entries({
        "Cash-in-Hand": cash.count,
        "Bank Accounts": bank.count,
        "Sundry Debtors": debtors.count,
        "Sundry Creditors": creditors.count,
        "Sales Accounts": sales.count,
        "Purchase Accounts": purchase.count,
      })
        .filter(([, n]) => n === 0)
        .map(([name]) => name),
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return NextResponse.json(
        { error: `Tally didn't respond within ${Math.round(timeoutMs / 1000)}s. Is it open on ${host}:${port}?` },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        error:
          `Couldn't reach Tally at ${host}:${port}. Open Tally, load the company, and enable ` +
          `Gateway of Tally → F1 → Advanced Configuration → Client/Server = Both.`,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
