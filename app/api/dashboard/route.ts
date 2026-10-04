import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { respondWithProgress } from "@/lib/tallyStream";
import {
  fetchTallyFinance,
  missingGroups,
  tallyErrorBody,
  type CategoryBucket,
} from "@/lib/tallyFinance";

/**
 * Dashboard figures, straight from Tally — balances only.
 *
 * Same computation as /api/tally/full (lib/tallyFinance.ts), so the two
 * can never disagree. Tally's XML sign convention is DEBIT NEGATIVE,
 * CREDIT POSITIVE; every figure here is turned into its natural direction
 * (cash/bank/debtors Dr-positive, creditors/sales/OD Cr-positive) and
 * netted — a customer advance reduces receivables, it is not added to it.
 * Where the company has no ledger in a group the figure is null, so the
 * screen shows "—" rather than a confident zero.
 *
 * fromDate/toDate pick the period (sales/purchases for exactly that range,
 * balances "as on" toDate); `stream: true` sends progress lines first.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slim(b: CategoryBucket) {
  return {
    total: b.total,
    count: b.count,
    ledgers: b.ledgers
      .filter((l) => l.natural !== 0)
      .slice()
      .sort((x, y) => Math.abs(y.natural) - Math.abs(x.natural))
      .slice(0, 12)
      .map((l) => ({ name: l.name, balance: l.natural, side: l.side, group: l.group })),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
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
    fresh?: boolean;
    stream?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  return respondWithProgress(body.stream === true, async (progress) => {
  try {
    const fin = await fetchTallyFinance({
      mode: body.mode,
      host: body.host,
      port: Number(body.port) || 9000,
      agentUrl: body.agentUrl,
      agentApiKey: body.agentApiKey,
      timeoutMs: Math.min(Number(body.timeoutMs) || 20000, 60000),
      company: (body.company ?? body.companyName ?? "").trim() || undefined,
      fromDate: body.fromDate,
      toDate: body.toDate,
      fresh: body.fresh === true,
      onProgress: progress,
    });
    const b = fin.buckets;
    return { status: 200, body: {
      ok: true,
      fetchedAt: fin.fetchedAt,
      company: fin.company,
      companies: fin.companies,
      period: fin.period,
      basis: `${fin.period.label} · ${fin.company}`,
      ledgerCount: fin.ledgers.length,
      counts: { debtors: b.debtors.count, creditors: b.creditors.count },
      summary: fin.summary,
      breakdown: {
        cash: slim(b.cash),
        bank: slim(b.bank),
        bankOD: slim(b.bankOD),
        debtors: slim(b.debtors),
        creditors: slim(b.creditors),
        sales: slim(b.sales),
        purchase: slim(b.purchases),
        taxes: slim(b.dutiesTaxes),
      },
      warnings: fin.warnings,
      missingGroups: missingGroups(b),
      opening: fin.opening,
      readings: fin.readings,
      fromCache: fin.fromCache,
      retried: fin.retried,
    } };
  } catch (err) {
    const { status, body: errBody } = tallyErrorBody(err);
    return { status, body: errBody };
  }
  });
}
