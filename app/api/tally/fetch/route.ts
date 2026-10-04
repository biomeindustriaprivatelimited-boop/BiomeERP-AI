import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { fetchVouchers } from "@/lib/tallyFinance";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const companyName = body.companyName?.trim() || undefined;
  const fromDate = body.fromDate; // "YYYY-MM-DD"
  const toDate = body.toDate; // "YYYY-MM-DD"

  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "fromDate and toDate are required." }, { status: 400 });
  }

  // BiomeBridge.tdl first (the one Settings tells you to load), then the
  // older "Biome Voucher Export" report. Previously only the old report was
  // asked for, so with the new bridge loaded nothing ever came back.
  const v = await fetchVouchers(
    { ...body, timeoutMs: 25000 },
    companyName || "",
    fromDate,
    toDate
  );
  if (v.error) {
    return NextResponse.json({ error: v.error }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rows = v.vouchers.map(({ entries, ...r }) => r);
  if (!rows.length) {
    return NextResponse.json(
      {
        error:
          "Connected successfully, but no vouchers came back for that date range. Try widening the dates, or confirm the right company is open in Tally.",
      },
      { status: 200 }
    );
  }
  return NextResponse.json({ rows, count: rows.length, source: v.source });
}
