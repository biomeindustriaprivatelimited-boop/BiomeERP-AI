import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { runVision, diagnoseKeys, AiError, extractJson } from "@/lib/aiProvider";

/**
 * AI help for ledger reconciliation, in the two places it actually gets
 * stuck in practice.
 *
 * 1. action "map"
 *    Reconciliation fails most often because the two files call the same
 *    thing different names — "Vch No." vs "Voucher Number", "Debit" vs
 *    "Dr Amount", a Tally export with the party name in an unlabelled
 *    column. Auto-detection is keyword-based and gives up on those. The
 *    AI sees the real headers plus a few sample rows and maps them.
 *
 * 2. action "explain"
 *    Once differences are found, someone still has to work out WHY each
 *    one differs and what to do. The AI groups them into causes an
 *    accountant would recognise and suggests the fix, so the export is
 *    something you can act on rather than just a list of mismatches.
 *
 * No file ever leaves the browser for this — only column headers and a
 * small sample of rows are sent, which is what the model needs to reason
 * about structure.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The canonical fields the reconciliation engine understands. */
const TARGET_FIELDS = [
  { key: "invoiceNo", desc: "Invoice / bill / voucher number — the primary matching key" },
  { key: "invoiceDate", desc: "Invoice or voucher date" },
  { key: "partyName", desc: "Party / ledger / supplier / customer name" },
  { key: "purchase", desc: "Purchase value (debit side for a purchase ledger)" },
  { key: "sale", desc: "Sales value (credit side for a sales ledger)" },
  { key: "payment", desc: "Payment made / amount paid out" },
  { key: "receipt", desc: "Payment received / amount received" },
  { key: "amount", desc: "Generic amount, when the file doesn't split debit and credit" },
  { key: "tds", desc: "TDS deducted" },
  { key: "gstin", desc: "Counterparty GSTIN" },
  { key: "narration", desc: "Narration / particulars / remarks" },
];

const MAP_SYSTEM = `You map spreadsheet columns onto a fixed set of accounting fields for an Indian biomass supply company reconciling two ledgers.

You will be given the column headers of one file and a few sample rows. Work out which header holds each of these fields:

${TARGET_FIELDS.map((f) => `- "${f.key}": ${f.desc}`).join("\n")}

Real-world headers you should expect and handle: "Vch No.", "Vch Type", "Particulars", "Dr", "Cr", "Debit Amount", "Credit Amount", "Bill No", "Doc No", "Party's Name", "GST No", "Taxable Value", "Amt", Hindi or mixed-language headers, headers with trailing spaces or line breaks, and merged/exported Tally columns.

Rules:
- Return the EXACT header string as it was given to you, character for character. If you change it even slightly the mapping will not work.
- Map a field to null when no column genuinely holds it. Never force a match — a wrong mapping is far worse than an honest null.
- Use the SAMPLE ROWS to decide, not just the header text. A column headed "Amount" that contains dates is a date column. A column of 15-character alphanumerics starting with two digits is a GSTIN.
- If two columns could serve one field (e.g. both "Debit" and "Purchase Value"), choose the one whose sample values look like the actual transaction value.
- Debit/credit pairs: for a purchase or creditor ledger, debit is usually payment and credit is usually purchase. Say which you chose and why in "reasoning".

Respond with ONLY this JSON object:
{
  "mapping": { "invoiceNo": string|null, "invoiceDate": string|null, "partyName": string|null, "purchase": string|null, "sale": string|null, "payment": string|null, "receipt": string|null, "amount": string|null, "tds": string|null, "gstin": string|null, "narration": string|null },
  "confidence": number,
  "reasoning": string,
  "unmappedHeaders": string[],
  "warnings": string[]
}`;

const EXPLAIN_SYSTEM = `You are a chartered accountant reviewing reconciliation differences between two ledgers for an Indian biomass supply company (Biome Industria Private Limited). You are given a list of differences already found by an exact-matching engine.

For each difference, work out the most likely CAUSE and the ACTION to take. Group them into causes an accountant would recognise, such as:
- Rounding difference (a rupee or two — write it off)
- TDS deducted by the customer but not recorded by us
- GST component recorded on one side only
- Timing difference (entered in a different month or financial year)
- Debit note / credit note not posted on one side
- Part payment against a single invoice, or one payment against several invoices
- Invoice number typed differently (prefix, leading zeros, slash vs dash)
- Duplicate entry on one side
- Genuinely missing entry that needs posting

Be concrete about amounts. When a difference is close to a known percentage of the invoice value (2% or 0.1% for TDS, 5%/12%/18%/28% for GST), say so explicitly — that is usually the answer.

Never invent a cause you cannot support from the numbers given. If a difference has no clear explanation, say so and mark it for manual review — that is a useful answer.

Respond with ONLY this JSON object:
{
  "groups": [
    {
      "cause": string,
      "category": string,
      "rowIndexes": number[],
      "totalDifference": number,
      "explanation": string,
      "action": string,
      "severity": "low" | "medium" | "high"
    }
  ],
  "summary": string,
  "unexplained": number[]
}`;

interface MapRequest {
  action: "map";
  headers: string[];
  sampleRows: Record<string, any>[];
  ledgerLabel?: string;
}

interface ExplainRequest {
  action: "explain";
  differences: {
    invoiceNo?: string | null;
    partyName?: string | null;
    field?: string;
    valueA?: any;
    valueB?: any;
    difference?: number | null;
    invoiceValue?: number | null;
  }[];
}

const MAX_SAMPLE_ROWS = 12;
const MAX_DIFFERENCES = 150;

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const diag = diagnoseKeys();
  if (!diag.configured) {
    return NextResponse.json({ error: diag.problem, code: "NO_API_KEY" }, { status: 400 });
  }

  let body: MapRequest | ExplainRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (body.action === "map") {
      const headers = (body.headers || []).filter((h) => typeof h === "string");
      if (!headers.length) {
        return NextResponse.json({ error: "No column headers were provided." }, { status: 400 });
      }

      const sample = (body.sampleRows || []).slice(0, MAX_SAMPLE_ROWS);
      const userText = [
        body.ledgerLabel ? `This file is: ${body.ledgerLabel}` : "",
        `COLUMN HEADERS (${headers.length}):`,
        JSON.stringify(headers),
        "",
        `SAMPLE ROWS (${sample.length}):`,
        JSON.stringify(sample, null, 1).slice(0, 12000),
        "",
        "Map these columns onto the accounting fields. Respond with ONLY the JSON object.",
      ]
        .filter(Boolean)
        .join("\n");

      const { text, provider } = await runVision({
        system: MAP_SYSTEM,
        userText,
        parts: [], // text-only; the provider handles a request with no images
        maxTokens: 2048,
      });

      const result = extractJson(text);

      // Never trust a header the model invented — drop anything that isn't
      // in the real header list, so a hallucinated name can't silently
      // break the mapping downstream.
      const cleanMapping: Record<string, string | null> = {};
      const headerSet = new Set(headers);
      const dropped: string[] = [];
      for (const f of TARGET_FIELDS) {
        const v = result?.mapping?.[f.key];
        if (typeof v === "string" && headerSet.has(v)) cleanMapping[f.key] = v;
        else {
          cleanMapping[f.key] = null;
          if (typeof v === "string" && v) dropped.push(`${f.key} → "${v}"`);
        }
      }

      const warnings: string[] = Array.isArray(result?.warnings) ? result.warnings.map(String) : [];
      if (dropped.length) {
        warnings.push(
          `Ignored ${dropped.length} suggested column name(s) that don't exist in the file: ${dropped.join(", ")}.`
        );
      }

      return NextResponse.json({
        mapping: cleanMapping,
        confidence: Number(result?.confidence) || 0,
        reasoning: String(result?.reasoning || ""),
        unmappedHeaders: headers.filter((h) => !Object.values(cleanMapping).includes(h)),
        warnings,
        provider,
      });
    }

    if (body.action === "explain") {
      const diffs = (body.differences || []).slice(0, MAX_DIFFERENCES);
      if (!diffs.length) {
        return NextResponse.json({ error: "No differences were provided." }, { status: 400 });
      }

      const userText = [
        `${diffs.length} reconciliation differences, indexed from 0:`,
        JSON.stringify(diffs, null, 1).slice(0, 30000),
        "",
        "Group these by likely cause and say what to do about each. Respond with ONLY the JSON object.",
      ].join("\n");

      const { text, provider } = await runVision({
        system: EXPLAIN_SYSTEM,
        userText,
        parts: [],
        maxTokens: 8192,
      });

      const result = extractJson(text);
      const groups = Array.isArray(result?.groups)
        ? result.groups.map((g: any) => ({
            cause: String(g.cause || "Unclassified"),
            category: String(g.category || g.cause || "Unclassified"),
            // Keep only indexes that actually exist in what we sent.
            rowIndexes: Array.isArray(g.rowIndexes)
              ? g.rowIndexes.map(Number).filter((i: number) => i >= 0 && i < diffs.length)
              : [],
            totalDifference: Number(g.totalDifference) || 0,
            explanation: String(g.explanation || ""),
            action: String(g.action || ""),
            severity: ["low", "medium", "high"].includes(g.severity) ? g.severity : "medium",
          }))
        : [];

      return NextResponse.json({
        groups,
        summary: String(result?.summary || ""),
        unexplained: Array.isArray(result?.unexplained)
          ? result.unexplained.map(Number).filter((i: number) => i >= 0 && i < diffs.length)
          : [],
        analysed: diffs.length,
        truncated: (body.differences || []).length > MAX_DIFFERENCES,
        provider,
      });
    }

    return NextResponse.json(
      { error: `Unknown action. Use "map" or "explain".` },
      { status: 400 }
    );
  } catch (err: any) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, provider: err.provider }, { status: err.status });
    }
    if (/JSON/.test(err?.message || "")) {
      return NextResponse.json(
        { error: "The AI's response couldn't be parsed. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: err?.message || "The AI request failed." }, { status: 500 });
  }
}
