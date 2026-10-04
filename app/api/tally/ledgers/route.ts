import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { CATEGORY_LABEL, fetchTallyFinance, tallyErrorBody } from "@/lib/tallyFinance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every ledger of the configured company with opening and closing balance
 * for the current FY till today. Balances keep Tally's sign (Dr negative,
 * Cr positive) and carry `reservedGroup` — the Tally group above the
 * ledger after walking sub-groups — so "Customers" also finds parties in
 * sub-groups of Sundry Debtors.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  try {
    const fin = await fetchTallyFinance({
      mode: body.mode,
      host: body.host,
      port: Number(body.port) || 9000,
      agentUrl: body.agentUrl,
      agentApiKey: body.agentApiKey,
      timeoutMs: 25000,
      company: (body.companyName ?? body.company ?? "").trim() || undefined,
      fromDate: body.fromDate,
      toDate: body.toDate,
    });
    const ledgers = fin.ledgers.map((l) => ({
      name: l.name,
      group: l.group,
      openingBalance: l.openingBalance,
      closingBalance: l.closingBalance,
      primaryGroup: l.primaryGroup,
      reservedGroup: l.category === "other" ? null : CATEGORY_LABEL[l.category],
    }));
    return NextResponse.json({
      ledgers,
      count: ledgers.length,
      company: fin.company,
      period: fin.period,
      fetchedAt: fin.fetchedAt,
    });
  } catch (err) {
    const { status, body: errBody } = tallyErrorBody(err);
    return NextResponse.json(errBody, { status });
  }
}
