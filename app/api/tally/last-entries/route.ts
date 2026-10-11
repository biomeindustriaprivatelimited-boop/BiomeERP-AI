import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { respondWithProgress } from "@/lib/tallyStream";
import { tallyErrorBody } from "@/lib/tallyFinance";
import { fetchLastEntries } from "@/lib/tallyLedgerActivity";

/**
 * Date of the LAST voucher behind each Tally figure, for the chosen period
 * (lib/tallyLedgerActivity.ts): cash, bank, receivables, payables, sales,
 * purchases, taxes, expenses — and, with scope "ledgers", every ledger.
 *
 * Kept apart from /api/tally/full so the KPIs never wait for it. Same
 * body as the other Tally routes (connection, company, fromDate, toDate,
 * fresh, stream).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  return respondWithProgress(body.stream === true, async (progress) => {
    try {
      const r = await fetchLastEntries({
        mode: body.mode,
        host: body.host,
        port: Number(body.port) || 9000,
        agentUrl: body.agentUrl,
        agentApiKey: body.agentApiKey,
        timeoutMs: Math.min(Number(body.timeoutMs) || 45000, 120000),
        company: String(body.company ?? body.companyName ?? "").trim() || undefined,
        fromDate: body.fromDate,
        toDate: body.toDate,
        fresh: body.fresh === true,
        scope: body.scope === "ledgers" ? "ledgers" : "summary",
        onProgress: progress,
      });
      return { status: 200, body: { ok: true, ...r } };
    } catch (err) {
      const { status, body: errBody } = tallyErrorBody(err);
      return { status, body: errBody };
    }
  });
}
