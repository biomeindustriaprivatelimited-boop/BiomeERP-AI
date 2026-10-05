import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { CATEGORY_LABEL, PL_CATEGORIES, fetchTallyFinance, tallyErrorBody } from "@/lib/tallyFinance";
import { respondWithProgress } from "@/lib/tallyStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every ledger of the configured company with opening balance (as at the
 * start of fromDate) and closing balance (as on toDate; for Sales /
 * Purchase / Expense / Income ledgers, the movement within the period).
 * Default period: current FY till today. `stream: true` = progress lines. Balances keep Tally's sign (Dr negative,
 * Cr positive) and carry `reservedGroup` — the Tally group above the
 * ledger after walking sub-groups — so "Customers" also finds parties in
 * sub-groups of Sundry Debtors.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  return respondWithProgress(body.stream === true, async (progress) => {
  try {
    const fin = await fetchTallyFinance({
      mode: body.mode,
      host: body.host,
      port: Number(body.port) || 9000,
      agentUrl: body.agentUrl,
      agentApiKey: body.agentApiKey,
      timeoutMs: 25000,
      fresh: body.fresh === true,
      onProgress: progress,
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
      /** Sales / Purchase / Expense / Income ledger: closingBalance is the
       *  movement within the period, not a balance "as on". */
      movement: PL_CATEGORIES.has(l.category),
    }));
    return {
      status: 200,
      body: {
        ledgers,
        count: ledgers.length,
        company: fin.company,
        period: fin.period,
        fetchedAt: fin.fetchedAt,
        opening: fin.opening,
        readings: fin.readings,
        fromCache: fin.fromCache,
      },
    };
  } catch (err) {
    const { status, body: errBody } = tallyErrorBody(err);
    return { status, body: errBody };
  }
  });
}
