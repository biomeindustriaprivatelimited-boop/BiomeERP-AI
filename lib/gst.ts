import {
  parseFile,
  parseDateValue,
  parseNumberValue,
  normalizeInvoiceKey,
  looseInvoiceKey,
  formatINR,
  downloadExcelWorkbook,
  downloadCsv,
  type ParsedFile,
} from "./reconciliation";

/* ------------------------------------------------------------------ */
/*  Return types                                                       */
/* ------------------------------------------------------------------ */

export type GstReturnType = "GSTR1" | "GSTR2B" | "GSTR3B";

export const GST_RETURNS: {
  key: GstReturnType;
  label: string;
  subtitle: string;
  booksLabel: string;
}[] = [
  {
    key: "GSTR1",
    label: "GSTR-1",
    subtitle: "Outward supplies (sales)",
    booksLabel: "Sales Register (Books)",
  },
  {
    key: "GSTR2B",
    label: "GSTR-2B",
    subtitle: "Inward supplies / ITC (purchases)",
    booksLabel: "Purchase Register (Books)",
  },
  {
    key: "GSTR3B",
    label: "GSTR-3B",
    subtitle: "Summary return (tax liability & ITC)",
    booksLabel: "Books Summary (tax computed)",
  },
];

/* ------------------------------------------------------------------ */
/*  Field schema — invoice-level (GSTR-1 / GSTR-2B)                    */
/* ------------------------------------------------------------------ */

export const GST_FIELDS = [
  {
    key: "gstin",
    label: "GSTIN",
    keywords: ["gstin", "gstin/uin", "supplier gstin", "recipient gstin", "gst no", "gst number"],
  },
  {
    key: "invoiceNo",
    label: "Invoice No",
    keywords: ["invoice no", "invoice number", "inv no", "bill no", "document no", "voucher no"],
  },
  {
    key: "invoiceDate",
    label: "Invoice Date",
    keywords: ["invoice date", "bill date", "document date", "voucher date", "date"],
  },
  {
    key: "taxableValue",
    label: "Taxable Value",
    keywords: ["taxable value", "taxable amount", "assessable value"],
  },
  {
    key: "cgst",
    label: "CGST",
    keywords: ["cgst", "cgst amount", "central tax"],
  },
  {
    key: "sgst",
    label: "SGST",
    keywords: ["sgst", "sgst amount", "state tax", "utgst"],
  },
  {
    key: "igst",
    label: "IGST",
    keywords: ["igst", "igst amount", "integrated tax"],
  },
  {
    key: "invoiceValue",
    label: "Invoice Value",
    keywords: ["invoice value", "total invoice value", "total value", "grand total", "total amount"],
  },
] as const;

export type GstFieldKey = (typeof GST_FIELDS)[number]["key"];
export type GstColumnMapping = Partial<Record<GstFieldKey, string | null>>;

export function autoDetectGstColumns(headers: string[]): GstColumnMapping {
  const mapping: GstColumnMapping = {};
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: h.toLowerCase().trim() }));

  for (const field of GST_FIELDS) {
    let found: string | null = null;
    for (const kw of field.keywords) {
      const hit = normalizedHeaders.find((h) => h.norm === kw);
      if (hit) {
        found = hit.raw;
        break;
      }
    }
    if (!found) {
      for (const kw of field.keywords) {
        const hit = normalizedHeaders.find((h) => h.norm.includes(kw));
        if (hit) {
          found = hit.raw;
          break;
        }
      }
    }
    mapping[field.key] = found;
  }
  return mapping;
}

/* ------------------------------------------------------------------ */
/*  Invoice-level reconciliation (GSTR-1 / GSTR-2B vs Books)           */
/* ------------------------------------------------------------------ */

export interface GstEntry {
  key: string;
  looseKey: string;
  gstin: string;
  invoiceNo: string;
  invoiceDate: string | null;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  invoiceValue: number;
  raw: Record<string, any>;
}

const NUM_FIELDS: GstFieldKey[] = ["taxableValue", "cgst", "sgst", "igst", "invoiceValue"];
const TOLERANCE = 1; // rupee tolerance for rounding differences

function buildEntries(parsed: ParsedFile, mapping: GstColumnMapping): GstEntry[] {
  return parsed.rows.map((row) => {
    const invoiceNoRaw = mapping.invoiceNo ? row[mapping.invoiceNo] : "";
    const gstinRaw = mapping.gstin ? row[mapping.gstin] : "";
    const num = (k: GstFieldKey) => {
      const col = mapping[k];
      const v = col ? parseNumberValue(row[col]) : null;
      return v ?? 0;
    };
    const taxableValue = num("taxableValue");
    const cgst = num("cgst");
    const sgst = num("sgst");
    const igst = num("igst");
    return {
      key: normalizeInvoiceKey(invoiceNoRaw),
      looseKey: looseInvoiceKey(invoiceNoRaw),
      gstin: String(gstinRaw ?? "").trim().toUpperCase(),
      invoiceNo: String(invoiceNoRaw ?? "").trim(),
      invoiceDate: mapping.invoiceDate ? parseDateValue(row[mapping.invoiceDate]) : null,
      taxableValue,
      cgst,
      sgst,
      igst,
      totalTax: cgst + sgst + igst,
      invoiceValue: num("invoiceValue") || taxableValue + cgst + sgst + igst,
      raw: row,
    };
  });
}

export interface GstMatchRow {
  invoiceNo: string;
  gstin: string;
  invoiceDate: string | null;
  fieldDiffs: { field: GstFieldKey; label: string; returnValue: number; booksValue: number; diff: number }[];
  status: "matched" | "mismatch";
}

export interface GstReconciliationResult {
  matched: GstMatchRow[];
  mismatches: GstMatchRow[];
  onlyInReturn: GstEntry[];
  onlyInBooks: GstEntry[];
  totals: {
    returnTaxableValue: number;
    booksTaxableValue: number;
    returnTax: number;
    booksTax: number;
  };
}

export function reconcileInvoiceLevel(
  returnFile: ParsedFile,
  booksFile: ParsedFile,
  returnMapping: GstColumnMapping,
  booksMapping: GstColumnMapping
): GstReconciliationResult {
  const returnEntries = buildEntries(returnFile, returnMapping);
  const booksEntries = buildEntries(booksFile, booksMapping);

  const booksByKey = new Map<string, GstEntry>();
  const booksByLooseKey = new Map<string, GstEntry>();
  for (const e of booksEntries) {
    if (e.key) booksByKey.set(e.key, e);
    if (e.looseKey) booksByLooseKey.set(e.looseKey, e);
  }

  const matched: GstMatchRow[] = [];
  const mismatches: GstMatchRow[] = [];
  const usedBooksKeys = new Set<string>();
  const onlyInReturn: GstEntry[] = [];

  for (const r of returnEntries) {
    const b = (r.key && booksByKey.get(r.key)) || (r.looseKey && booksByLooseKey.get(r.looseKey));
    if (!b) {
      onlyInReturn.push(r);
      continue;
    }
    usedBooksKeys.add(b.key || b.looseKey);

    const fieldDiffs: GstMatchRow["fieldDiffs"] = [];
    for (const fk of NUM_FIELDS) {
      const rv = r[fk] as number;
      const bv = b[fk] as number;
      const diff = Math.round((rv - bv) * 100) / 100;
      if (Math.abs(diff) > TOLERANCE) {
        const field = GST_FIELDS.find((f) => f.key === fk)!;
        fieldDiffs.push({ field: fk, label: field.label, returnValue: rv, booksValue: bv, diff });
      }
    }

    const row: GstMatchRow = {
      invoiceNo: r.invoiceNo || b.invoiceNo,
      gstin: r.gstin || b.gstin,
      invoiceDate: r.invoiceDate || b.invoiceDate,
      fieldDiffs,
      status: fieldDiffs.length ? "mismatch" : "matched",
    };
    if (fieldDiffs.length) mismatches.push(row);
    else matched.push(row);
  }

  const onlyInBooks = booksEntries.filter((b) => !usedBooksKeys.has(b.key || b.looseKey));

  const sum = (arr: GstEntry[], k: GstFieldKey) => arr.reduce((s, e) => s + (e[k as keyof GstEntry] as number), 0);

  return {
    matched,
    mismatches,
    onlyInReturn,
    onlyInBooks,
    totals: {
      returnTaxableValue: sum(returnEntries, "taxableValue"),
      booksTaxableValue: sum(booksEntries, "taxableValue"),
      returnTax: returnEntries.reduce((s, e) => s + e.totalTax, 0),
      booksTax: booksEntries.reduce((s, e) => s + e.totalTax, 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Summary-level reconciliation (GSTR-3B vs Books)                    */
/* ------------------------------------------------------------------ */

export const GSTR3B_SUMMARY_FIELDS = [
  { key: "taxableValue", label: "Total Taxable Value" },
  { key: "cgst", label: "CGST Payable / ITC" },
  { key: "sgst", label: "SGST Payable / ITC" },
  { key: "igst", label: "IGST Payable / ITC" },
] as const;

export interface Gstr3bSummaryRow {
  field: string;
  label: string;
  returnValue: number;
  booksValue: number;
  diff: number;
  status: "matched" | "mismatch";
}

export function reconcileSummaryLevel(
  returnFile: ParsedFile,
  booksFile: ParsedFile,
  returnMapping: GstColumnMapping,
  booksMapping: GstColumnMapping
): Gstr3bSummaryRow[] {
  const sumCol = (parsed: ParsedFile, col: string | null | undefined) => {
    if (!col) return 0;
    return parsed.rows.reduce((s, row) => s + (parseNumberValue(row[col]) ?? 0), 0);
  };

  return GSTR3B_SUMMARY_FIELDS.map(({ key, label }) => {
    const rv = sumCol(returnFile, returnMapping[key as GstFieldKey]);
    const bv = sumCol(booksFile, booksMapping[key as GstFieldKey]);
    const diff = Math.round((rv - bv) * 100) / 100;
    return {
      field: key,
      label,
      returnValue: rv,
      booksValue: bv,
      diff,
      status: Math.abs(diff) > TOLERANCE ? "mismatch" : "matched",
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

function matchRowToExport(m: GstMatchRow) {
  const out: Record<string, any> = {
    "Invoice No": m.invoiceNo,
    GSTIN: m.gstin,
    "Invoice Date": m.invoiceDate ?? "",
    Status: m.status === "matched" ? "Matched" : "Mismatch",
  };
  for (const d of m.fieldDiffs) {
    out[`${d.label} (Return)`] = formatINR(d.returnValue);
    out[`${d.label} (Books)`] = formatINR(d.booksValue);
    out[`${d.label} (Diff)`] = formatINR(d.diff);
  }
  return out;
}

function entryToExport(e: GstEntry) {
  return {
    "Invoice No": e.invoiceNo,
    GSTIN: e.gstin,
    "Invoice Date": e.invoiceDate ?? "",
    "Taxable Value": formatINR(e.taxableValue),
    CGST: formatINR(e.cgst),
    SGST: formatINR(e.sgst),
    IGST: formatINR(e.igst),
    "Invoice Value": formatINR(e.invoiceValue),
  };
}

export function exportGstInvoiceReport(
  result: GstReconciliationResult,
  returnLabel: string,
  fileName: string,
  format: "excel" | "csv"
) {
  const sheets = {
    Matched: result.matched.map(matchRowToExport),
    Mismatches: result.mismatches.map(matchRowToExport),
    [`Only in ${returnLabel}`]: result.onlyInReturn.map(entryToExport),
    "Only in Books": result.onlyInBooks.map(entryToExport),
  };
  if (format === "excel") downloadExcelWorkbook(sheets, fileName);
  else downloadCsv(sheets.Mismatches.length ? sheets.Mismatches : sheets.Matched, fileName);
}

export function exportGstSummaryReport(rows: Gstr3bSummaryRow[], fileName: string, format: "excel" | "csv") {
  const data = rows.map((r) => ({
    Field: r.label,
    "As per GSTR-3B": formatINR(r.returnValue),
    "As per Books": formatINR(r.booksValue),
    Difference: formatINR(r.diff),
    Status: r.status === "matched" ? "Matched" : "Mismatch",
  }));
  if (format === "excel") downloadExcelWorkbook({ "GSTR-3B Summary": data }, fileName);
  else downloadCsv(data, fileName);
}

export { parseFile, formatINR };
export type { ParsedFile };
