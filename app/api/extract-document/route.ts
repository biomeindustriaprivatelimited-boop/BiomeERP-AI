import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { runVision, extractJson as extractJsonShared, diagnoseKeys, AiError } from "@/lib/aiProvider";

// This must stay a server-side route: it's the only place API keys ever
// touch the network. The browser never sees them.
export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a meticulous, general-purpose document data-extraction engine for Biome Industria Private Limited's enterprise platform. You will be shown one or more images of ANY kind of uploaded document or photo — a bill/receipt/voucher, an ID or certificate, a form or letter, a page from a multi-row/multi-column table (a ledger/statement, a lab or quality-test analysis report, an inventory or dispatch list, etc), or anything else. Documents may be stamped, rotated, creased, low-resolution, handwritten, or mix Hindi and English.

Read with maximum care. Do not guess or hallucinate a value you cannot actually read — leave it null instead, and give it low confidence. Being honest about uncertainty is more valuable than a confident-looking wrong answer, since this data feeds real records.

Classifying documentType correctly matters a lot — get this right first:
- "document": ANY single, non-tabular document — a bill/receipt/invoice/voucher, an ID card, a certificate, a letter, a form, a policy, a photo of a nameplate, etc. Extract whatever labelled fields it actually contains (see "fields" below) — do NOT assume it's an invoice; a birth certificate has no "amount" and an ID card has no "vendor", so only report the fields that genuinely exist on THIS document, using THEIR OWN printed labels.
- "lab_report": a coal/combustion/quality-testing laboratory report (e.g. an NTPC Coal and Combustion Laboratory report, or any similarly structured test report) that has ALL three of: (a) a letterhead-style header naming an organization/department/lab, (b) a metadata block of report-level details (date, test report no., vendor, PO no., material supplied, etc.), and (c) a multi-row results table (one row per truck/sample/consignment). If a document has this letterhead + metadata + table shape, classify it as "lab_report", NOT "ledger_table" — populate "labReport" (below) instead of leaving it null.
- "ledger_table": ANY OTHER document whose main content is a multi-row table (dispatch/truck registers, inventory lists, attendance sheets, vendor statements, etc.) that does NOT have the letterhead + metadata-block shape described above. Populate "table" with every row and its own column headers exactly as printed.
- "other": anything with no meaningfully extractable labelled fields or table (a photo, a plain paragraph of prose, etc).

For "lab_report" and "ledger_table", set "fields" to an empty array (do not guess a vendor name, date, or amount from the header text — that data belongs in "labReport"/"table"/"transcription" instead).

Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it — matching exactly this shape:

{
  "documentType": "document" | "lab_report" | "ledger_table" | "other",
  "transcription": string,               // best-effort full plain-text transcription of everything legible on the document, line by line
  "fields": [
    // ONLY for documentType "document" — every genuinely labelled key/value pair actually printed on
    // THIS document, in the order they appear. Use natural, human-readable labels exactly as the
    // document itself would call them (e.g. "Invoice No", "Date of Birth", "Certificate No",
    // "Total Amount", "Aadhaar No", "Policy No", "GSTIN") — never force a fixed invoice-shaped set of
    // fields onto a document that isn't an invoice. Leave this an empty array if nothing is clearly
    // labelled. Normalize dates to YYYY-MM-DD where possible; strip currency symbols/commas from amounts.
    { "label": string, "value": string, "confidence": number }
  ],
  "table": { "headers": string[], "rows": [ { [header: string]: string } ] } | null
    // populate "table" ONLY when documentType is "ledger_table" (for "lab_report", the results
    // table goes inside "labReport.table" instead, and this top-level "table" stays null) —
    // follow these rules exactly:
    // 1. "headers" must be the real printed column names, one string per column, in reading
    //    order (left to right). If a header wraps across two printed lines (e.g. "Date of
    //    unloading" / "(DD/MM/YYYY)"), join it into ONE header string with a space between —
    //    never split one printed column into two header strings, and never merge two printed
    //    columns into one header string.
    // 2. Every object in "rows" MUST have exactly one key for every string in "headers",
    //    using the EXACT same header string as the key (character-for-character identical —
    //    this is critical, mismatched keys break the export). Never use "|" or any other
    //    separator character inside a cell value to cram multiple columns' data together —
    //    each column's value goes in its own key.
    // 3. Include EVERY data row visible in the image, not a sample — if the table has 6 rows,
    //    return 6 row objects, in the same top-to-bottom order as printed.
    // 4. Otherwise (documentType is "document", "lab_report", or "other") set "table" to null.
  "labReport": {
    "organizationName": string | null,     // e.g. "NTPC"
    "department": string | null,           // e.g. "Coal and Combustion Laboratory Chemistry Dept.-(O&M)"
    "address": string | null,              // e.g. "NTPC Dadri, Gautam Budh Nagar, 201008"
    "metadata": {
      "date": string | null,
      "testReportNo": string | null,
      "vendorName": string | null,
      "poNo": string | null,
      "materialSupplied": string | null,
      "sampleDrawnBy": string | null
    },
    "table": {
      "headers": string[],
      "rows": [ { [header: string]: string } ]
    } | null,
    "remarks": string[],
    "signatories": [ { "name": string | null, "designation": string | null } ]
  } | null
    // populate "labReport" whenever documentType is "lab_report"; leave every other field
    // (fields, table) null/empty in that case. Set "labReport" to null for every other documentType.
}

"confidence" is your own honest 0-100 self-assessment of how certain you are that the value is correct, not a measurement — calibrate it: use under 50 for a guess, 50-80 for "probably right but the scan is unclear", and above 80 only when the text is genuinely crisp and unambiguous.`;

const USER_INSTRUCTION =
  "Read this document carefully and respond with ONLY the JSON object described in your instructions.";

interface ParsedImage {
  mediaType: string;
  data: string;
}

function parseImages(rawImages: string[]): ParsedImage[] {
  const parsed: ParsedImage[] = [];
  for (const dataUrl of rawImages) {
    // Accept both images and PDFs — both providers read PDFs natively, so
    // a user can drop a multi-page bill straight in without splitting it.
    const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+|application\/pdf);base64,(.+)$/);
    if (match) parsed.push({ mediaType: match[1], data: match[2] });
  }
  return parsed;
}

// PDFs are supported by both providers natively; images too. The
// provider module handles which model actually runs and falls back when
// one fails, so this route just assembles the request.

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "documents");
  if ("response" in auth) return auth.response;

  const diag = diagnoseKeys();
  if (!diag.configured) {
    return NextResponse.json({ error: diag.problem, code: "NO_API_KEY" }, { status: 400 });
  }

  let body: { images?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rawImages = (body.images ?? []).filter(Boolean);
  if (!rawImages.length) {
    return NextResponse.json({ error: "No images provided." }, { status: 400 });
  }
  if (rawImages.length > 10) {
    return NextResponse.json(
      { error: "Too many pages — please send at most 10 images per document." },
      { status: 400 }
    );
  }

  const images = parseImages(rawImages);
  if (!images.length) {
    return NextResponse.json({ error: "None of the provided images were valid." }, { status: 400 });
  }

  try {
    const { text, provider } = await runVision({
      system: SYSTEM_PROMPT,
      userText: USER_INSTRUCTION,
      parts: images.map((img) => ({ mediaType: img.mediaType, data: img.data })),
      maxTokens: 8192,
    });
    const result = extractJsonShared(text);
    return NextResponse.json({ result, provider });
  } catch (err: any) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, provider: err.provider }, { status: err.status });
    }
    if (err instanceof SyntaxError || /JSON/.test(err?.message || "")) {
      return NextResponse.json(
        { error: "The AI's response could not be parsed. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: err?.message || "Request to the AI failed." }, { status: 500 });
  }
}
