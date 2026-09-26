import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  buildVoucherFetchRequestXml,
  parseVoucherExportXml,
  looksLikeTallyResponse,
  extractTallyLineError,
  resolveTallyTarget,
} from "@/lib/tally";

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

  const { url, headers } = resolveTallyTarget(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: buildVoucherFetchRequestXml(fromDate, toDate, companyName),
      signal: controller.signal,
    });
    const text = await res.text();
    clearTimeout(timeout);

    if (res.status === 401) {
      return NextResponse.json(
        { error: "The Agent rejected the request — check the API key in Settings matches config.json." },
        { status: 401 }
      );
    }

    if (!looksLikeTallyResponse(text)) {
      return NextResponse.json(
        {
          error: `${url} didn't return a Tally XML response. Raw response: ${
            text.slice(0, 300).trim() || "(empty)"
          }`,
        },
        { status: 502 }
      );
    }

    const lineError = extractTallyLineError(text);
    if (lineError) {
      return NextResponse.json(
        {
          error: `Tally reported: "${lineError}". This usually means the "Biome Voucher Export" TDL report isn't loaded yet, or the company name doesn't match exactly.`,
        },
        { status: 502 }
      );
    }

    const rows = parseVoucherExportXml(text);
    if (!rows.length) {
      return NextResponse.json(
        {
          error:
            "Connected successfully, but no vouchers came back for that date range. Try widening the dates, or confirm the right company is open in Tally.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ rows, count: rows.length });
  } catch (err: any) {
    clearTimeout(timeout);
    const isAbort = err?.name === "AbortError";
    return NextResponse.json(
      {
        error: isAbort
          ? `Timed out waiting for ${url}.`
          : `Could not reach ${url}: ${err?.message || "connection failed"}.`,
      },
      { status: 502 }
    );
  }
}
