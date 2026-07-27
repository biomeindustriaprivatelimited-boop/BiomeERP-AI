import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ */
/*  Field schema                                                       */
/* ------------------------------------------------------------------ */

export const FIELDS = [
  {
    key: "invoiceNo",
    label: "Invoice No",
    type: "text",
    required: true,
    keywords: [
      "invoice no", "invoice number", "invoice #", "inv no", "inv number",
      "bill no", "bill number", "voucher no", "ref no", "reference no",
      "document no", "doc no", "invoiceno",
    ],
  },
  {
    key: "invoiceDate",
    label: "Invoice Date",
    type: "date",
    required: false,
    keywords: ["invoice date", "bill date", "voucher date", "doc date", "date"],
  },
  {
    key: "purchase",
    label: "Purchase",
    type: "number",
    required: false,
    keywords: ["purchase amount", "purchase value", "purchase"],
  },
  {
    key: "sale",
    label: "Sale",
    type: "number",
    required: false,
    keywords: ["sale amount", "sales amount", "sale value", "sales value", "sales", "sale"],
  },
  {
    key: "payment",
    label: "Payment",
    type: "number",
    required: false,
    keywords: ["payment amount", "payment", "paid amount", "paid"],
  },
  {
    key: "receipt",
    label: "Receipt",
    type: "number",
    required: false,
    keywords: ["receipt amount", "receipt", "received amount", "received"],
  },
  {
    key: "tds",
    label: "TDS",
    type: "number",
    required: false,
    keywords: ["tds amount", "tds", "tax deducted at source", "tax deducted"],
  },
  {
    key: "amount",
    label: "Amount",
    type: "number",
    required: false,
    keywords: ["grand total", "total amount", "net amount", "amount", "total"],
  },
] as const;

export type FieldKey = (typeof FIELDS)[number]["key"];
export type FieldType = "text" | "date" | "number";

export const NUMERIC_FIELDS: FieldKey[] = FIELDS.filter((f) => f.type === "number").map(
  (f) => f.key
);

export type ColumnMapping = Partial<Record<FieldKey, string | null>>;

export interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: Record<string, any>[];
}

/* ------------------------------------------------------------------ */
/*  File parsing (CSV / XLSX / XLS) — fully client-side                */
/* ------------------------------------------------------------------ */

export async function parseFile(file: File): Promise<ParsedFile> {
  if (/\.pdf$/i.test(file.name)) {
    return parsePdfLedger(file);
  }

  const isCsv = /\.csv$/i.test(file.name);

  const workbook = await new Promise<XLSX.WorkBook>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      try {
        if (isCsv) {
          const text = reader.result as string;
          resolve(XLSX.read(text, { type: "string", raw: false }));
        } else {
          const data = new Uint8Array(reader.result as ArrayBuffer);
          resolve(XLSX.read(data, { type: "array", cellDates: true }));
        }
      } catch (err) {
        reject(err);
      }
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (!raw.length) {
    return { fileName: file.name, headers: [], rows: [] };
  }

  const headerRow = (raw[0] as any[]).map((h) => (h ?? "").toString().trim());
  const rows: Record<string, any>[] = raw.slice(1).map((r: any[]) => {
    const obj: Record<string, any> = {};
    headerRow.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });

  return { fileName: file.name, headers: headerRow, rows };
}

/**
 * PDF ledgers: try the fast, high-accuracy path first (a real text layer,
 * clustered into rows/columns). Only if the PDF turns out to be scanned
 * (image-only, no text layer) do we fall back to rasterizing each page
 * and running it through OCR — slower, and flagged to the user as such
 * further up the call chain via the thrown-error message when it fails.
 */
async function parsePdfLedger(file: File): Promise<ParsedFile> {
  const { extractPdfText, renderPdfPagesToImages, textToTable } = await import("./pdf");

  const extraction = await extractPdfText(file);
  if (extraction.hasTextLayer) {
    const table = textToTable(extraction.pages);
    if (table.headers.length) {
      return { fileName: file.name, headers: table.headers, rows: table.rows };
    }
  }

  // Scanned / image-only PDF — OCR each page, then re-run the same
  // table heuristics against the recognized lines.
  const { runOcrThorough } = await import("./ocr");
  const images = await renderPdfPagesToImages(file);
  const pages: { pageNumber: number; lines: string[] }[] = [];
  for (let i = 0; i < images.length; i++) {
    const ocr = await runOcrThorough(images[i], "eng");
    pages.push({ pageNumber: i + 1, lines: ocr.lines.map((l) => l.text) });
  }
  const table = textToTable(pages);
  if (!table.headers.length) {
    throw new Error(
      `Could not detect a table structure in "${file.name}". Try the OCR Scanner instead, or export a cleaner CSV/Excel copy of this ledger.`
    );
  }
  return { fileName: file.name, headers: table.headers, rows: table.rows };
}

/* ------------------------------------------------------------------ */
/*  Column auto-detection                                              */
/* ------------------------------------------------------------------ */

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
}

export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const used = new Set<string>();

  for (const field of FIELDS) {
    let best: { raw: string; score: number } | null = null;

    for (const h of normalized) {
      if (used.has(h.raw)) continue;
      for (const kw of field.keywords) {
        let score = 0;
        if (h.norm === kw) score = 100;
        else if (h.norm.includes(kw)) score = 60 + kw.length; // longer keyword match wins
        else if (kw.includes(h.norm) && h.norm.length > 2) score = 40;

        if (score > 0 && (!best || score > best.score)) {
          best = { raw: h.raw, score };
        }
      }
    }

    if (best) {
      mapping[field.key] = best.raw;
      used.add(best.raw);
    } else {
      mapping[field.key] = null;
    }
  }

  return mapping;
}

/* ------------------------------------------------------------------ */
/*  Value normalization                                                 */
/* ------------------------------------------------------------------ */

export function normalizeInvoiceKey(val: unknown): string {
  return (val ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** A looser key used as a fallback when the exact key has no match
 *  (strips punctuation & leading zeros so "INV-001" ≈ "INV1"). */
export function looseInvoiceKey(val: unknown): string {
  const stripped = normalizeInvoiceKey(val).replace(/[^A-Z0-9]/g, "");
  if (/^\d+$/.test(stripped)) {
    return String(parseInt(stripped, 10));
  }
  return stripped.replace(/^([A-Z]+)0+(\d)/, "$1$2");
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function parseDateValue(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;

  if (val instanceof Date && !isNaN(val.getTime())) {
    return toIso(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
  }

  if (typeof val === "number" && isFinite(val)) {
    const ms = EXCEL_EPOCH + val * 86400000;
    const d = new Date(ms);
    return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const s = val.toString().trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return toIso(+m[1], +m[2], +m[3]);

  // DD-MM-YYYY or DD/MM/YYYY (India default)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    let year = +y;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let day = +d;
    let month = +mo;
    if (month > 12 && day <= 12) [day, month] = [month, day]; // swap if clearly MM/DD
    return toIso(year, month, day);
  }

  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  return null;
}

function toIso(y: number, m: number, d: number): string | null {
  if (!y || !m || !d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseNumberValue(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return isFinite(val) ? round2(val) : null;

  let s = val.toString().trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹$€,]/g, "").replace(/\b(Rs\.?|INR)/gi, "").trim();
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (!s || isNaN(Number(s))) return null;

  const n = Number(s);
  return round2(negative ? -n : n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/*  Ledger indexing                                                     */
/* ------------------------------------------------------------------ */

export interface LedgerEntry {
  key: string;
  looseKey: string;
  invoiceNoDisplay: string;
  duplicateCount: number;
  fields: Partial<Record<FieldKey, string | number | null>>;
  sourceRows: Record<string, any>[];
}

function extractFieldValue(
  row: Record<string, any>,
  mapping: ColumnMapping,
  field: (typeof FIELDS)[number]
): string | number | null {
  const col = mapping[field.key];
  if (!col) return null;
  const raw = row[col];
  if (field.type === "number") return parseNumberValue(raw);
  if (field.type === "date") return parseDateValue(raw);
  return (raw ?? "").toString().trim();
}

export function buildLedgerIndex(
  rows: Record<string, any>[],
  mapping: ColumnMapping
): Map<string, LedgerEntry> {
  const index = new Map<string, LedgerEntry>();
  const invoiceCol = mapping.invoiceNo;
  if (!invoiceCol) return index;

  for (const row of rows) {
    const rawInvoice = row[invoiceCol];
    const key = normalizeInvoiceKey(rawInvoice);
    if (!key) continue;

    const rowFields: Partial<Record<FieldKey, string | number | null>> = {};
    for (const field of FIELDS) {
      if (field.key === "invoiceNo") continue;
      rowFields[field.key] = extractFieldValue(row, mapping, field);
    }

    const existing = index.get(key);
    if (!existing) {
      index.set(key, {
        key,
        looseKey: looseInvoiceKey(rawInvoice),
        invoiceNoDisplay: (rawInvoice ?? "").toString().trim(),
        duplicateCount: 1,
        fields: rowFields,
        sourceRows: [row],
      });
    } else {
      // Duplicate invoice number within the same ledger — sum numeric
      // fields (typical for split-line ledger entries) and keep the
      // first non-numeric value.
      existing.duplicateCount += 1;
      existing.sourceRows.push(row);
      for (const field of FIELDS) {
        if (field.type !== "number") continue;
        const a = existing.fields[field.key] as number | null;
        const b = rowFields[field.key] as number | null;
        if (a === null && b === null) continue;
        existing.fields[field.key] = round2((a ?? 0) + (b ?? 0));
      }
    }
  }

  return index;
}

/* ------------------------------------------------------------------ */
/*  Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export interface FieldComparison {
  field: FieldKey;
  label: string;
  a: string | number | null;
  b: string | number | null;
}

export interface MatchResult {
  key: string;
  invoiceNo: string;
  a: LedgerEntry;
  b: LedgerEntry;
  matchedVia: "exact" | "loose";
  mismatches: FieldComparison[];
}

export interface ReconciliationResult {
  matched: MatchResult[];
  discrepancies: MatchResult[];
  onlyInA: LedgerEntry[];
  onlyInB: LedgerEntry[];
  stats: {
    totalA: number;
    totalB: number;
    duplicatesA: number;
    duplicatesB: number;
  };
}

export interface ReconcileOptions {
  amountTolerance: number; // ₹ tolerance for numeric comparisons
  compareDate: boolean;
}

/* ------------------------------------------------------------------ */
/*  Automatic discrepancy categorisation                                */
/*  Every discrepancy is classified into one clear, exportable bucket  */
/*  purely from the mismatch data already computed above — no external */
/*  AI call needed, so this always works even fully offline.           */
/* ------------------------------------------------------------------ */

export type DiscrepancyCategory =
  | "Approximate Invoice Match"
  | "Amount Mismatch"
  | "Date Mismatch"
  | "TDS Mismatch"
  | "Multiple Field Mismatch";

const AMOUNT_FIELD_KEYS: FieldKey[] = ["purchase", "sale", "payment", "receipt", "amount"];

export function categorizeMatch(m: MatchResult): DiscrepancyCategory {
  const fieldKeys = m.mismatches.map((x) => x.field);

  if (fieldKeys.length === 0) {
    // Only reason left for this to be a discrepancy is the loose invoice match.
    return "Approximate Invoice Match";
  }
  if (fieldKeys.length > 1) {
    return "Multiple Field Mismatch";
  }
  const only = fieldKeys[0];
  if (only === "tds") return "TDS Mismatch";
  if (only === "invoiceDate") return "Date Mismatch";
  if (AMOUNT_FIELD_KEYS.includes(only)) return "Amount Mismatch";
  return "Multiple Field Mismatch";
}

export function categorizeDiscrepancies(
  discrepancies: MatchResult[]
): Record<DiscrepancyCategory, MatchResult[]> {
  const buckets: Partial<Record<DiscrepancyCategory, MatchResult[]>> = {};
  for (const m of discrepancies) {
    const cat = categorizeMatch(m);
    (buckets[cat] ??= []).push(m);
  }
  return buckets as Record<DiscrepancyCategory, MatchResult[]>;
}

export function reconcile(
  rowsA: Record<string, any>[],
  mappingA: ColumnMapping,
  rowsB: Record<string, any>[],
  mappingB: ColumnMapping,
  options: ReconcileOptions
): ReconciliationResult {
  const indexA = buildLedgerIndex(rowsA, mappingA);
  const indexB = buildLedgerIndex(rowsB, mappingB);

  const looseMapB = new Map<string, LedgerEntry>();
  for (const entry of indexB.values()) {
    if (!looseMapB.has(entry.looseKey)) looseMapB.set(entry.looseKey, entry);
  }

  const matched: MatchResult[] = [];
  const discrepancies: MatchResult[] = [];
  const onlyInA: LedgerEntry[] = [];
  const usedBKeys = new Set<string>();

  const activeFields = FIELDS.filter(
    (f) => f.key !== "invoiceNo" && (mappingA[f.key] || mappingB[f.key])
  );

  for (const entryA of indexA.values()) {
    let entryB = indexB.get(entryA.key);
    let matchedVia: "exact" | "loose" = "exact";

    if (!entryB) {
      const loose = looseMapB.get(entryA.looseKey);
      if (loose && !usedBKeys.has(loose.key)) {
        entryB = loose;
        matchedVia = "loose";
      }
    }

    if (!entryB) {
      onlyInA.push(entryA);
      continue;
    }

    usedBKeys.add(entryB.key);

    const mismatches: FieldComparison[] = [];
    for (const field of activeFields) {
      const a = entryA.fields[field.key] ?? null;
      const b = entryB.fields[field.key] ?? null;

      if (field.type === "number") {
        const an = a as number | null;
        const bn = b as number | null;
        if (an === null && bn === null) continue;
        const diff = Math.abs((an ?? 0) - (bn ?? 0));
        if (an === null || bn === null || diff > options.amountTolerance) {
          mismatches.push({ field: field.key, label: field.label, a, b });
        }
      } else if (field.type === "date") {
        if (options.compareDate && a !== b) {
          mismatches.push({ field: field.key, label: field.label, a, b });
        }
      }
    }

    const result: MatchResult = {
      key: entryA.key,
      invoiceNo: entryA.invoiceNoDisplay || entryB.invoiceNoDisplay,
      a: entryA,
      b: entryB,
      matchedVia,
      mismatches,
    };

    if (mismatches.length === 0 && matchedVia === "exact") {
      matched.push(result);
    } else {
      discrepancies.push(result);
    }
  }

  const onlyInB: LedgerEntry[] = [];
  for (const entryB of indexB.values()) {
    if (!usedBKeys.has(entryB.key)) onlyInB.push(entryB);
  }

  const duplicatesA = [...indexA.values()].filter((e) => e.duplicateCount > 1).length;
  const duplicatesB = [...indexB.values()].filter((e) => e.duplicateCount > 1).length;

  return {
    matched,
    discrepancies,
    onlyInA,
    onlyInB,
    stats: {
      totalA: indexA.size,
      totalB: indexB.size,
      duplicatesA,
      duplicatesB,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                     */
/* ------------------------------------------------------------------ */

function matchRowToExport(
  m: MatchResult,
  activeFields: typeof FIELDS[number][],
  includeCategory = false
) {
  const row: Record<string, any> = { "Invoice No": m.invoiceNo };
  if (includeCategory) row["Category"] = categorizeMatch(m);
  for (const f of activeFields) {
    row[`${f.label} (Ledger A)`] = m.a.fields[f.key] ?? "";
    row[`${f.label} (Ledger B)`] = m.b.fields[f.key] ?? "";
  }
  if (m.mismatches.length) {
    row["Discrepancy Reason"] = m.mismatches
      .map((mm) => `${mm.label}: ${mm.a ?? "—"} (A) vs ${mm.b ?? "—"} (B)`)
      .join("; ");
  }
  if (m.matchedVia === "loose") {
    row["Note"] = "Matched via approximate invoice number";
  }
  return row;
}

function entryRowToExport(e: LedgerEntry, activeFields: typeof FIELDS[number][]) {
  const row: Record<string, any> = { "Invoice No": e.invoiceNoDisplay };
  for (const f of activeFields) {
    row[f.label] = e.fields[f.key] ?? "";
  }
  if (e.duplicateCount > 1) row["Duplicate Lines"] = e.duplicateCount;
  return row;
}

export function buildExportSheets(
  result: ReconciliationResult,
  mappingA: ColumnMapping,
  mappingB: ColumnMapping
) {
  const activeFields = FIELDS.filter(
    (f) => f.key !== "invoiceNo" && (mappingA[f.key] || mappingB[f.key])
  );

  const sheets: Record<string, Record<string, any>[]> = {
    "Fully Matched": result.matched.map((m) => matchRowToExport(m, activeFields)),
    Discrepancies: result.discrepancies.map((m) => matchRowToExport(m, activeFields, true)),
    "Only in Ledger A": result.onlyInA.map((e) => entryRowToExport(e, activeFields)),
    "Only in Ledger B": result.onlyInB.map((e) => entryRowToExport(e, activeFields)),
  };

  // One extra sheet per discrepancy category, so the export is already
  // sorted the way an accountant would want to work through it.
  const byCategory = categorizeDiscrepancies(result.discrepancies);
  for (const [category, rows] of Object.entries(byCategory)) {
    if (!rows.length) continue;
    sheets[`Discrepancy - ${category}`] = rows.map((m) => matchRowToExport(m, activeFields));
  }

  return sheets;
}

export function downloadExcelWorkbook(
  sheets: Record<string, Record<string, any>[]>,
  fileName: string
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ " ": "No rows" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

export function downloadCsv(rows: Record<string, any>[], fileName: string) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ " ": "No rows" }]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadReconciliationPdf(
  result: ReconciliationResult,
  mappingA: ColumnMapping,
  mappingB: ColumnMapping,
  nameA: string,
  nameB: string,
  fileName: string
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { drawLetterhead, drawFooter } = await import("./pdfBranding");

  const sheets = buildExportSheets(result, mappingA, mappingB);
  const total =
    result.matched.length +
    result.discrepancies.length +
    result.onlyInA.length +
    result.onlyInB.length;
  const accuracy = total > 0 ? ((result.matched.length / total) * 100).toFixed(1) : "0.0";

  const doc = new jsPDF({ orientation: "landscape" });
  const green: [number, number, number] = [124, 179, 66];

  const startY = await drawLetterhead(
    doc,
    "Ledger Reconciliation Report",
    `${nameA} vs ${nameB} · Generated ${new Date().toLocaleString("en-IN")}`
  );

  const summary = [
    ["Match Accuracy", `${accuracy}%`],
    ["Fully Matched", String(result.matched.length)],
    ["Discrepancies", String(result.discrepancies.length)],
    [`Only in ${nameA}`, String(result.onlyInA.length)],
    [`Only in ${nameB}`, String(result.onlyInB.length)],
  ];
  autoTable(doc, {
    startY,
    head: [["Summary", "Count"]],
    body: summary,
    theme: "plain",
    headStyles: { fillColor: green, textColor: 255 },
    styles: { fontSize: 9 },
    tableWidth: 90,
  });

  for (const [name, rows] of Object.entries(sheets)) {
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    // @ts-expect-error - lastAutoTable is attached at runtime by the plugin
    const startY = (doc.lastAutoTable?.finalY ?? 28) + 12;
    doc.setFontSize(12);
    doc.setTextColor(20, 30, 45);
    doc.text(name, 14, startY - 4);
    autoTable(doc, {
      startY,
      head: [headers],
      body: rows.map((r) => headers.map((h) => (r[h] ?? "").toString())),
      theme: "striped",
      headStyles: { fillColor: green, textColor: 255, fontSize: 8 },
      styles: { fontSize: 7, cellPadding: 2 },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        doc.setFontSize(12);
        doc.setTextColor(20, 30, 45);
      },
    });
  }

  drawFooter(doc);
  doc.save(fileName);
}
