import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { runVision, diagnoseKeys, AiError, extractJson } from "@/lib/aiProvider";

/**
 * Biome Platform — Ledger Agent
 * -------------------------------------------------------------------
 * A dedicated reader for account ledgers, built because the keyword-based
 * column detection kept failing on real exports.
 *
 * The problem it solves: no two ledgers look alike. A Tally day-book puts
 * the party in "Particulars" with the voucher type on the next line. A
 * bank statement has "Withdrawal"/"Deposit". A vendor's own statement
 * might be a PDF with the opening balance in a merged cell and running
 * balances down the right. Keyword matching guesses wrong on all of them
 * and the reconciliation silently produces nonsense.
 *
 * So this agent works in three passes, the way a person would:
 *
 *   1. UNDERSTAND  — what IS this file? whose ledger, what period, which
 *                    column means what, where does the data actually start
 *   2. NORMALISE   — turn both sides into the same shape: one row per
 *                    transaction with a date, a document number, a debit
 *                    and a credit
 *   3. RECONCILE   — match them, then explain every difference by cause
 *
 * Passes 1 and 3 use the AI; pass 2 is deterministic code, so the actual
 * numbers are never invented by a model.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNDERSTAND_SYSTEM = `You are reading an accounting ledger for an Indian biomass supply company and working out its structure so it can be parsed programmatically. Ledgers arrive as Tally exports, bank statements, vendor statements, or hand-built spreadsheets. They are messy: title rows above the headers, merged cells, blank spacer rows, running balances, opening/closing balance lines, sub-totals, and columns whose headers don't say what they hold.

You will be given the first rows of the file exactly as parsed, as an array of arrays.

Work out:
- Which row index holds the real column headers (0-based). Title/company/period rows above it don't count.
- Which row index the first actual transaction starts on.
- What each column is. Use these roles:
  "date"        transaction date
  "docNo"       invoice / bill / voucher / cheque number — the main matching key
  "particulars" party name or narration
  "voucherType" Sales / Purchase / Payment / Receipt / Journal / Contra
  "debit"       debit amount (Dr)
  "credit"      credit amount (Cr)
  "amount"      a single signed amount column, when debit and credit aren't split
  "balance"     running balance — important to identify so it is NOT treated as a transaction value
  "gstin"       counterparty GSTIN
  "ignore"      anything else

Rules:
- Decide from the DATA, not just the header text. A column headed "Amount" holding 01-04-2026 is a date. A column that only ever increases or decreases smoothly is a running balance, not a transaction amount.
- Identify the running balance column carefully. Treating it as an amount is the single most damaging mistake here and produces reconciliations that are entirely wrong.
- Note rows that are opening balance, closing balance, or sub-totals so they can be excluded — they are not transactions.
- If the file has debit and credit as separate columns, map both. Only use "amount" when there is genuinely one column.
- Say honestly when you are unsure. A low confidence with a clear reason is far more useful than a confident wrong guess.

Respond with ONLY this JSON:
{
  "ledgerOwner": string|null,
  "counterparty": string|null,
  "period": string|null,
  "headerRowIndex": number,
  "firstDataRowIndex": number,
  "columns": [{ "index": number, "header": string, "role": string, "why": string }],
  "excludeRowPatterns": string[],
  "dateFormat": string|null,
  "confidence": number,
  "notes": string,
  "warnings": string[]
}`;

const RECONCILE_SYSTEM = `You are a chartered accountant reconciling two ledgers for an Indian biomass supply company: OUR books against a COUNTERPARTY statement (a vendor, a customer, or a bank).

You are given transactions from both sides, already normalised, each with an index. Match them and explain what doesn't match.

Match on document number first, then on date-and-amount. Be tolerant about how numbers are written: "BI/26-27/0786", "BI-26-27-786" and "786" are very likely the same document. Amounts within a rupee or two are the same amount.

For every unmatched or partly-matched item, decide the cause. Use these categories, which is how the difference will be exported:

  "Matched"                  both sides agree
  "Rounding Difference"      a rupee or two
  "TDS Deducted"             difference is ~0.1%, 1%, 2% or 10% of the invoice — TDS the other side deducted and we haven't recorded
  "GST Difference"           difference matches a GST rate (5/12/18/28%) or the CGST+SGST half of it
  "Timing Difference"        same document, recorded in different months or financial years
  "Part Payment"             one invoice settled by several payments, or one payment against several invoices
  "Document No Mismatch"     clearly the same transaction, written differently
  "Duplicate Entry"          the same transaction posted twice on one side
  "Missing In Our Books"     on their statement, absent from ours
  "Missing In Their Books"   in our books, absent from theirs
  "Unexplained"              you cannot account for it from the numbers given

Rules:
- Never invent a cause. "Unexplained" is a correct and useful answer — an accountant will look at those first.
- When you claim TDS or GST, state the percentage and the arithmetic in the explanation so it can be checked.
- Give the net effect: how much of the total difference each category accounts for.
- Reference rows by the indexes you were given. Do not renumber them.

Respond with ONLY this JSON:
{
  "matches": [{ "oursIndex": number|null, "theirsIndex": number|null, "category": string, "difference": number, "explanation": string, "action": string }],
  "categoryTotals": [{ "category": string, "count": number, "totalDifference": number }],
  "openingDifference": number|null,
  "closingDifference": number|null,
  "summary": string,
  "confidence": number
}`;

const MAX_UNDERSTAND_ROWS = 25;
const MAX_TXNS_PER_SIDE = 120;

interface UnderstandRequest {
  action: "understand";
  /** Raw rows as arrays, straight from the sheet — headers not yet applied. */
  sampleRows: any[][];
  fileName?: string;
}

interface ReconcileRequest {
  action: "reconcile";
  ours: any[];
  theirs: any[];
  oursLabel?: string;
  theirsLabel?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const diag = diagnoseKeys();
  if (!diag.configured) {
    return NextResponse.json({ error: diag.problem, code: "NO_API_KEY" }, { status: 400 });
  }

  let body: UnderstandRequest | ReconcileRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    // ---------------- Pass 1: understand the file ----------------
    if (body.action === "understand") {
      const rows = (body.sampleRows || []).slice(0, MAX_UNDERSTAND_ROWS);
      if (!rows.length) {
        return NextResponse.json({ error: "No rows were provided to read." }, { status: 400 });
      }

      const userText = [
        body.fileName ? `File name: ${body.fileName}` : "",
        `First ${rows.length} rows, exactly as parsed (row 0 first):`,
        JSON.stringify(rows, null, 1).slice(0, 20000),
        "",
        "Work out the structure. Respond with ONLY the JSON object.",
      ]
        .filter(Boolean)
        .join("\n");

      const { text, provider } = await runVision({
        system: UNDERSTAND_SYSTEM,
        userText,
        parts: [],
        maxTokens: 4096,
      });
      const result = extractJson(text);

      const width = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      const VALID_ROLES = new Set([
        "date",
        "docNo",
        "particulars",
        "voucherType",
        "debit",
        "credit",
        "amount",
        "balance",
        "gstin",
        "ignore",
      ]);

      // Drop anything referring to a column that isn't in the file, so a
      // hallucinated index can't corrupt the parse downstream.
      const columns = Array.isArray(result?.columns)
        ? result.columns
            .filter((c: any) => Number.isInteger(c?.index) && c.index >= 0 && c.index < width)
            .map((c: any) => ({
              index: c.index,
              header: String(c.header ?? ""),
              role: VALID_ROLES.has(c.role) ? c.role : "ignore",
              why: String(c.why ?? ""),
            }))
        : [];

      const warnings: string[] = Array.isArray(result?.warnings) ? result.warnings.map(String) : [];
      const roles = columns.map((c: any) => c.role);
      if (!roles.includes("date")) warnings.push("No date column was identified.");
      if (!roles.includes("debit") && !roles.includes("credit") && !roles.includes("amount")) {
        warnings.push("No amount column was identified — reconciliation can't run without one.");
      }
      if (!roles.includes("docNo")) {
        warnings.push(
          "No document-number column was identified, so matching will fall back to date and amount, which is less reliable."
        );
      }

      return NextResponse.json({
        ledgerOwner: result?.ledgerOwner ?? null,
        counterparty: result?.counterparty ?? null,
        period: result?.period ?? null,
        headerRowIndex: Number.isInteger(result?.headerRowIndex) ? result.headerRowIndex : 0,
        firstDataRowIndex: Number.isInteger(result?.firstDataRowIndex)
          ? result.firstDataRowIndex
          : (Number(result?.headerRowIndex) || 0) + 1,
        columns,
        excludeRowPatterns: Array.isArray(result?.excludeRowPatterns)
          ? result.excludeRowPatterns.map(String)
          : [],
        dateFormat: result?.dateFormat ?? null,
        confidence: Number(result?.confidence) || 0,
        notes: String(result?.notes ?? ""),
        warnings,
        provider,
      });
    }

    // ---------------- Pass 3: reconcile ----------------
    if (body.action === "reconcile") {
      const ours = (body.ours || []).slice(0, MAX_TXNS_PER_SIDE);
      const theirs = (body.theirs || []).slice(0, MAX_TXNS_PER_SIDE);
      if (!ours.length && !theirs.length) {
        return NextResponse.json({ error: "Both sides are empty." }, { status: 400 });
      }

      const userText = [
        `OUR BOOKS${body.oursLabel ? ` (${body.oursLabel})` : ""} — ${ours.length} transactions, indexed from 0:`,
        JSON.stringify(ours, null, 1).slice(0, 24000),
        "",
        `THEIR STATEMENT${body.theirsLabel ? ` (${body.theirsLabel})` : ""} — ${theirs.length} transactions, indexed from 0:`,
        JSON.stringify(theirs, null, 1).slice(0, 24000),
        "",
        "Match these and explain every difference by category. Respond with ONLY the JSON object.",
      ].join("\n");

      const { text, provider } = await runVision({
        system: RECONCILE_SYSTEM,
        userText,
        parts: [],
        maxTokens: 16384,
      });
      const result = extractJson(text);

      // Keep only rows that point at transactions we actually sent.
      const matches = Array.isArray(result?.matches)
        ? result.matches
            .map((m: any) => ({
              oursIndex:
                Number.isInteger(m?.oursIndex) && m.oursIndex >= 0 && m.oursIndex < ours.length
                  ? m.oursIndex
                  : null,
              theirsIndex:
                Number.isInteger(m?.theirsIndex) && m.theirsIndex >= 0 && m.theirsIndex < theirs.length
                  ? m.theirsIndex
                  : null,
              category: String(m?.category ?? "Unexplained"),
              difference: Number(m?.difference) || 0,
              explanation: String(m?.explanation ?? ""),
              action: String(m?.action ?? ""),
            }))
            .filter((m: any) => m.oursIndex !== null || m.theirsIndex !== null)
        : [];

      // Recompute the totals ourselves rather than trusting the model's
      // arithmetic — the categories are its judgement, the sums are not.
      const totals = new Map<string, { count: number; totalDifference: number }>();
      for (const m of matches) {
        const t = totals.get(m.category) || { count: 0, totalDifference: 0 };
        t.count += 1;
        t.totalDifference += m.difference;
        totals.set(m.category, t);
      }

      return NextResponse.json({
        matches,
        categoryTotals: [...totals.entries()]
          .map(([category, v]) => ({ category, ...v }))
          .sort((a, b) => Math.abs(b.totalDifference) - Math.abs(a.totalDifference)),
        openingDifference: result?.openingDifference ?? null,
        closingDifference: result?.closingDifference ?? null,
        summary: String(result?.summary ?? ""),
        confidence: Number(result?.confidence) || 0,
        analysed: { ours: ours.length, theirs: theirs.length },
        truncated:
          (body.ours || []).length > MAX_TXNS_PER_SIDE ||
          (body.theirs || []).length > MAX_TXNS_PER_SIDE,
        provider,
      });
    }

    return NextResponse.json(
      { error: `Unknown action. Use "understand" or "reconcile".` },
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
    return NextResponse.json({ error: err?.message || "The ledger agent failed." }, { status: 500 });
  }
}
