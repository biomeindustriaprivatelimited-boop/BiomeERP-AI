/**
 * Biome Platform — Smart Sheets (client only)
 * -------------------------------------------------------------------
 * "A pile of paper in, one clean spreadsheet out."
 *
 * The existing OCR screen answers "what does this document say?". This
 * module answers a narrower, more useful question for batches: "fill
 * THESE columns from EVERY document" — the way a person keys 50
 * receivings into a register with fixed headings.
 *
 * Everything runs in the browser on the local Tesseract engine, so it
 * works with no internet at all. That has an honest consequence worth
 * stating rather than hiding: on clean printed documents the columns fill
 * well; on faint carbon copies and handwriting they will not, and the
 * grid marks every low-confidence cell so a person checks THOSE instead
 * of re-reading everything. No local OCR is "99.9%" on field paperwork,
 * and pretending otherwise would just move the errors into the books.
 *
 * Presets mirror the documents this business actually batches: plant
 * receivings / weight slips, lab reports, and sales invoices. A custom
 * schema (up to 30 columns) covers everything else.
 */

import type { OcrResult, ExtractedField } from "@/lib/ocr";
import { extractDocumentFields, slugifyLabel } from "@/lib/ocr";

export const SHEET_MAX_FILES = 100;
export const SHEET_MAX_COLUMNS = 30;

export interface SheetColumn {
  id: string;
  label: string;
  /** Lower-case keywords looked for near a value on the page. */
  hints: string[];
  /** Shapes the value cleaner and the fallback regexes. */
  type: "text" | "number" | "date" | "gstin" | "vehicle" | "amount";
}

export interface SheetPreset {
  id: string;
  label: string;
  help: string;
  columns: SheetColumn[];
}

function col(label: string, type: SheetColumn["type"], hints: string[]): SheetColumn {
  return { id: slugifyLabel(label), label, type, hints: hints.map((h) => h.toLowerCase()) };
}

export const SHEET_PRESETS: SheetPreset[] = [
  {
    id: "receiving",
    label: "Receivings / weight slips",
    help: "One row per slip: vehicle, party, material, gross–tare–net.",
    columns: [
      col("Slip No", "text", ["slip no", "slip number", "sr no", "serial", "rst no", "token"]),
      col("Date", "date", ["date", "dated", "dt"]),
      col("Vehicle No", "vehicle", ["vehicle", "truck", "lorry", "veh no", "vehicle no"]),
      col("Party / Vendor", "text", ["party", "vendor", "supplier", "customer", "name of party", "m/s"]),
      col("Material", "text", ["material", "item", "commodity", "product", "description"]),
      col("Gross Wt", "number", ["gross", "gross wt", "gross weight", "g.wt"]),
      col("Tare Wt", "number", ["tare", "tare wt", "tare weight", "t.wt"]),
      col("Net Wt", "number", ["net", "net wt", "net weight", "n.wt"]),
    ],
  },
  {
    id: "lab_report",
    label: "Lab reports",
    help: "One row per report: sample, moisture, ash, GCV and friends.",
    columns: [
      col("Report No", "text", ["report no", "report number", "certificate no", "ref no", "sample id"]),
      col("Date", "date", ["date", "dated", "report date", "date of test"]),
      col("Party", "text", ["party", "customer", "client", "vendor", "supplier", "m/s"]),
      col("Sample / Material", "text", ["sample", "material", "commodity", "description", "sample description"]),
      col("Moisture %", "number", ["moisture", "total moisture", "moisture content", "tm"]),
      col("Ash %", "number", ["ash", "ash content"]),
      col("Volatile %", "number", ["volatile", "volatile matter", "vm"]),
      col("GCV", "number", ["gcv", "gross calorific", "calorific value", "kcal"]),
    ],
  },
  {
    id: "sales_invoice",
    label: "Sales invoices",
    help: "One row per invoice: number, buyer, GSTIN, taxable value, GST, total.",
    columns: [
      col("Invoice No", "text", ["invoice no", "invoice number", "bill no", "inv no", "tax invoice no"]),
      col("Date", "date", ["date", "invoice date", "dated", "dt"]),
      col("Buyer", "text", ["buyer", "bill to", "billed to", "consignee", "customer", "party", "m/s"]),
      col("Buyer GSTIN", "gstin", ["gstin", "gst no", "gst number", "gstin/uin"]),
      col("Taxable Value", "amount", ["taxable value", "taxable amount", "sub total", "subtotal", "basic value"]),
      col("GST Amount", "amount", ["gst", "igst", "cgst", "sgst", "tax amount", "total tax"]),
      col("Invoice Total", "amount", ["total", "grand total", "invoice total", "amount payable", "net amount"]),
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export interface SheetCell {
  value: string;
  /** 0–100. Below ~65 the grid flags the cell for human eyes. */
  confidence: number;
}

export interface SheetRow {
  fileName: string;
  cells: Record<string, SheetCell>;
  pageConfidence: number;
}

const DATE_RE = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;
const VEHICLE_RE = /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{3,4}\b/;
const NUMBER_RE = /-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/;

function cleanFor(type: SheetColumn["type"], raw: string): string {
  const v = raw.trim();
  switch (type) {
    case "number":
    case "amount": {
      const m = v.match(NUMBER_RE);
      return m ? m[0].replace(/,/g, "") : v;
    }
    case "date": {
      const m = v.match(DATE_RE);
      return m ? m[0] : v;
    }
    case "gstin": {
      const m = v.toUpperCase().match(GSTIN_RE);
      return m ? m[0] : v.toUpperCase();
    }
    case "vehicle": {
      const m = v.toUpperCase().match(VEHICLE_RE);
      return m ? m[0].replace(/[\s-]+/g, " ").trim() : v.toUpperCase();
    }
    default:
      return v;
  }
}

/** Does this cleaned value even look like its column's type? */
function shapeOk(type: SheetColumn["type"], v: string): boolean {
  if (!v) return false;
  switch (type) {
    case "number":
    case "amount": return /^-?\d+(\.\d+)?$/.test(v);
    case "date": return DATE_RE.test(v);
    case "gstin": return GSTIN_RE.test(v);
    case "vehicle": return VEHICLE_RE.test(v);
    default: return v.length > 0;
  }
}

/**
 * Fills one row of the schema from one recognised document.
 *
 * Three passes, cheapest first:
 *   1. the labelled fields the shared extractor already found;
 *   2. a "label: value" scan of each line against the column's hints;
 *   3. for typed columns, a bare-pattern hunt (a GSTIN is a GSTIN even
 *      when its label was smudged).
 */
export function fillRow(columns: SheetColumn[], result: OcrResult, fileName: string): SheetRow {
  const fields: Record<string, ExtractedField> = extractDocumentFields(result);
  const fieldList = Object.values(fields);
  const lines = result.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const cells: Record<string, SheetCell> = {};

  for (const c of columns) {
    let best: SheetCell = { value: "", confidence: 0 };

    // Pass 1 — the extractor's labelled fields.
    for (const f of fieldList) {
      const label = f.label.toLowerCase();
      if (c.hints.some((h) => label.includes(h))) {
        const v = cleanFor(c.type, f.value);
        if (shapeOk(c.type, v) && f.confidence > best.confidence) {
          best = { value: v, confidence: f.confidence };
        }
      }
    }

    // Pass 2 — "label : value" on raw lines.
    if (!best.value) {
      for (const line of lines) {
        const lower = line.toLowerCase();
        const hint = c.hints.find((h) => lower.includes(h));
        if (!hint) continue;
        const after = line.slice(lower.indexOf(hint) + hint.length).replace(/^[\s:.\-–—=]+/, "");
        const v = cleanFor(c.type, after);
        if (shapeOk(c.type, v)) {
          best = { value: v, confidence: Math.min(80, result.confidence) };
          break;
        }
      }
    }

    // Pass 3 — bare pattern, typed columns only.
    if (!best.value && (c.type === "gstin" || c.type === "vehicle" || c.type === "date")) {
      const re = c.type === "gstin" ? GSTIN_RE : c.type === "vehicle" ? VEHICLE_RE : DATE_RE;
      const m = result.text.toUpperCase().match(re);
      if (m) best = { value: cleanFor(c.type, m[0]), confidence: Math.min(60, result.confidence) };
    }

    cells[c.id] = best;
  }

  return { fileName, cells, pageConfidence: result.confidence };
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function sheetToCsv(columns: SheetColumn[], rows: SheetRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ["File", ...columns.map((c) => c.label)].map(esc).join(",");
  const body = rows.map((r) =>
    [r.fileName, ...columns.map((c) => r.cells[c.id]?.value || "")].map(esc).join(",")
  );
  return [head, ...body].join("\n");
}

export async function downloadSheetExcel(columns: SheetColumn[], rows: SheetRow[], fileName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria Platform";
  const ws = wb.addWorksheet("Extracted", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "File", key: "__file", width: 26 },
    ...columns.map((c) => ({
      header: c.label,
      key: c.id,
      width: Math.max(12, Math.min(32, c.label.length + 8)),
    })),
  ];

  const headRow = ws.getRow(1);
  headRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D4F" } };
  headRow.height = 20;

  for (const r of rows) {
    const row = ws.addRow({
      __file: r.fileName,
      ...Object.fromEntries(columns.map((c) => {
        const cell = r.cells[c.id];
        const v = cell?.value || "";
        const asNum = (c.type === "number" || c.type === "amount") && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        return [c.id, asNum];
      })),
    });
    // Low-confidence cells are painted so the person checking the sheet
    // knows WHERE to look — that is the whole value of the confidence.
    columns.forEach((c, i) => {
      const cell = r.cells[c.id];
      if (!cell) return;
      const xl = row.getCell(i + 2);
      if (!cell.value) {
        xl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE2E2" } };
      } else if (cell.confidence < 65) {
        xl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DC" } };
      }
    });
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + 1 } };

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}

export async function downloadSheetPdf(columns: SheetColumn[], rows: SheetRow[], fileName: string, title: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait", unit: "pt" });

  doc.setFontSize(14);
  doc.text(title, 40, 42);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${rows.length} document${rows.length === 1 ? "" : "s"} · extracted offline · low-confidence cells are shaded`, 40, 58);

  autoTable(doc, {
    startY: 74,
    head: [["File", ...columns.map((c) => c.label)]],
    body: rows.map((r) => [r.fileName, ...columns.map((c) => r.cells[c.id]?.value || "")]),
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [46, 125, 79] },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index === 0) return;
      const r = rows[data.row.index];
      const c = columns[data.column.index - 1];
      const cell = r?.cells[c.id];
      if (!cell?.value) data.cell.styles.fillColor = [255, 226, 226];
      else if (cell.confidence < 65) data.cell.styles.fillColor = [255, 246, 220];
    },
  });

  doc.save(fileName);
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 4000);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
