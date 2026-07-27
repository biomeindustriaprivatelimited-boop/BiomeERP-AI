import { NextRequest, NextResponse } from "next/server";

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
    const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
    if (match) parsed.push({ mediaType: match[1], data: match[2] });
  }
  return parsed;
}

function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

class UpstreamError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Google Gemini — tried first when configured, since it has a genuine
 *  no-credit-card-required free tier that includes image understanding. */
async function callGemini(apiKey: string, images: ParsedImage[]): Promise<unknown> {
  const parts: any[] = [];
  images.forEach((img, i) => {
    if (images.length > 1) parts.push({ text: `Page ${i + 1} of ${images.length}:` });
    parts.push({ inline_data: { mime_type: img.mediaType, data: img.data } });
  });
  parts.push({ text: USER_INSTRUCTION });

  const model = "gemini-flash-latest";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamError(`Gemini API error (${res.status}): ${errText.slice(0, 400)}`, 502);
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return extractJson(text);
}

/** Anthropic — used when GEMINI_API_KEY isn't set but ANTHROPIC_API_KEY is,
 *  for anyone who prefers Claude or already has API credits. */
async function callAnthropic(apiKey: string, images: ParsedImage[]): Promise<unknown> {
  const content: any[] = [];
  images.forEach((img, i) => {
    if (images.length > 1) content.push({ type: "text", text: `Page ${i + 1} of ${images.length}:` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  });
  content.push({ type: "text", text: USER_INSTRUCTION });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamError(`Anthropic API error (${res.status}): ${errText.slice(0, 400)}`, 502);
  }

  const data = await res.json();
  const textBlock = (data.content ?? []).find((b: any) => b.type === "text");
  return extractJson(textBlock?.text ?? "");
}

export async function POST(req: NextRequest) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!geminiKey && !anthropicKey) {
    return NextResponse.json(
      {
        error:
          "No AI API key is configured. Add GEMINI_API_KEY (free — get one at aistudio.google.com/apikey) or ANTHROPIC_API_KEY to a .env.local file in the project root (see .env.local.example) and restart `npm run dev`.",
        code: "NO_API_KEY",
      },
      { status: 500 }
    );
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
  if (rawImages.length > 6) {
    return NextResponse.json(
      { error: "Too many pages — please send at most 6 images per document." },
      { status: 400 }
    );
  }

  const images = parseImages(rawImages);
  if (!images.length) {
    return NextResponse.json({ error: "None of the provided images were valid." }, { status: 400 });
  }

  try {
    const result = geminiKey ? await callGemini(geminiKey, images) : await callAnthropic(anthropicKey!, images);
    return NextResponse.json({ result });
  } catch (err: any) {
    if (err instanceof UpstreamError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "The AI's response could not be parsed as JSON." },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: err?.message || "Request to the AI API failed." }, { status: 500 });
  }
}
