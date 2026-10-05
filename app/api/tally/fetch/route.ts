import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  chooseCompany,
  fetchVouchersRange,
  listCompanies,
  resolvePeriod,
  tallyErrorBody,
} from "@/lib/tallyFinance";
import { respondWithProgress } from "@/lib/tallyStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transactions (vouchers) for any From–To period. `fromDate: "books"` =
 * from the company's books beginning. The range is validated (From ≤ To,
 * clamped to the books beginning and to today, with notes) and read ONE
 * MONTH AT A TIME with retries, so a multi-year range doesn't time out.
 * `stream: true` = progress lines (lib/tallyStream.ts).
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const companyName = (body.companyName ?? body.company ?? "").trim() || undefined;
  const fromDate = body.fromDate; // "YYYY-MM-DD" or "books"
  const toDate = body.toDate; // "YYYY-MM-DD"

  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "fromDate and toDate are required." }, { status: 400 });
  }
  // Obvious mistakes (bad date, From after To) answer at once, before Tally.
  try {
    resolvePeriod({ fromDate, toDate });
  } catch (err) {
    const { status, body: errBody } = tallyErrorBody(err);
    return NextResponse.json(errBody, { status });
  }

  return respondWithProgress(body.stream === true, async (progress) => {
    const target = { ...body, timeoutMs: 25000 };
    let company;
    let period;
    try {
      progress({ phase: "company", done: 0, total: 1, label: "Checking the company in Tally" });
      company = chooseCompany(await listCompanies(target), companyName);
      period = resolvePeriod({ fromDate, toDate, booksFrom: company.booksFrom || company.startingFrom });
    } catch (err) {
      const { status, body: errBody } = tallyErrorBody(err);
      return { status, body: errBody };
    }

    // BiomeBridge.tdl first (the one Settings tells you to load), then the
    // older "Biome Voucher Export" report.
    const v = await fetchVouchersRange(target, company.name, period.from, period.to, {
      fresh: body.fresh === true,
      onProgress: progress,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const rows = v.vouchers.map(({ entries, ...r }) => r);
    if (v.error && !rows.length) {
      return { status: 502, body: { error: v.error, chunks: v.chunks, period, company: company.name } };
    }
    if (!rows.length) {
      return {
        status: 200,
        body: {
          rows: [],
          count: 0,
          period,
          company: company.name,
          chunks: v.chunks,
          error:
            "Connected successfully, but no vouchers came back for that period. Try a wider period, or confirm the right company is open in Tally.",
        },
      };
    }
    // Some months failed: return what was read, with the warning.
    return {
      status: 200,
      body: {
        rows,
        count: rows.length,
        source: v.source,
        period,
        company: company.name,
        fetchedAt: new Date().toISOString(),
        warning: v.error,
        chunks: v.chunks,
      },
    };
  });
}
