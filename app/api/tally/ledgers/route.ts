import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  buildLedgerMastersRequestXml,
  parseLedgerMastersXml,
  looksLikeTallyResponse,
  extractTallyLineError,
  resolveTallyTarget,
} from "@/lib/tally";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { url, headers } = resolveTallyTarget(body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: buildLedgerMastersRequestXml(),
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
          error: `${url} didn't return Tally XML. Raw response: ${text.slice(0, 300).trim() || "(empty)"}`,
        },
        { status: 502 }
      );
    }
    const lineError = extractTallyLineError(text);
    if (lineError) {
      return NextResponse.json({ error: `Tally reported: "${lineError}"` }, { status: 502 });
    }

    const ledgers = parseLedgerMastersXml(text);
    return NextResponse.json({ ledgers, count: ledgers.length });
  } catch (err: any) {
    clearTimeout(timeout);
    const isAbort = err?.name === "AbortError";
    return NextResponse.json(
      {
        error: isAbort ? `Timed out waiting for ${url}.` : `Could not reach ${url}: ${err?.message || "connection failed"}.`,
      },
      { status: 502 }
    );
  }
}
