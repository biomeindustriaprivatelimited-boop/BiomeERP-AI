import { createWorker, PSM, type Worker as TesseractWorker } from "tesseract.js";
import { preprocessImage } from "@/lib/imagePreprocess";
import type { PdfTable } from "@/lib/pdf";

/* ------------------------------------------------------------------ */
/*  Worker lifecycle — one shared worker per language, reused across   */
/*  documents in a session instead of spinning up a fresh WASM runtime */
/*  (and re-downloading language data) for every scan.                 */
/* ------------------------------------------------------------------ */

const workers = new Map<string, Promise<TesseractWorker>>();

export type OcrLanguage = "eng" | "eng+hin";

function getWorker(lang: OcrLanguage): Promise<TesseractWorker> {
  let w = workers.get(lang);
  if (!w) {
    w = createWorker(lang.split("+"));
    workers.set(lang, w);
  }
  return w;
}

export async function terminateAllOcrWorkers() {
  for (const w of workers.values()) {
    (await w).terminate();
  }
  workers.clear();
}

/* ------------------------------------------------------------------ */
/*  Recognition                                                        */
/* ------------------------------------------------------------------ */

export interface OcrWord {
  text: string;
  x0: number;
  x1: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  y: number;
  /** Line height (bbox.y1 - bbox.y0) — used to size the row-clustering
   *  tolerance when reconstructing table structure. */
  height?: number;
  /** Per-word bounding-box x-positions. On complex/rotated table scans,
   *  Tesseract's own PSM modes (sparse text especially) often segment
   *  each table cell as its own "line" rather than a full row — keeping
   *  real word coordinates lets buildTableFromLines() reconstruct actual
   *  rows/columns from geometry instead of guessing from text gaps,
   *  which is what the old column-gap-on-text heuristic did and why it
   *  broke on multi-column scans. */
  words?: OcrWord[];
}

export interface OcrResult {
  text: string;
  confidence: number; // overall page confidence, 0-100
  lines: OcrLine[];
  wordCount: number;
  lowConfidenceWordCount: number; // words below 60% — worth a manual glance
  /** How many recognition passes were tried before picking this one
   *  (only set by runOcrThorough — a quick single pass leaves it unset). */
  passesRun?: number;
}

async function recognizeOnce(
  worker: TesseractWorker,
  image: string | HTMLCanvasElement | Blob
): Promise<OcrResult> {
  const { data } = await worker.recognize(image as any, {}, { blocks: true, text: true });

  const lines: OcrLine[] = [];
  let wordCount = 0;
  let lowConfidenceWordCount = 0;

  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        let text = "";
        let prevX1: number | null = null;
        const words: OcrWord[] = [];
        for (const word of line.words) {
          if (prevX1 !== null && word.bbox.x0 - prevX1 > 15) text += "  ";
          else if (text) text += " ";
          text += word.text;
          words.push({ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1 });
          prevX1 = word.bbox.x1;
          wordCount++;
          if (word.confidence < 60) lowConfidenceWordCount++;
        }
        if (text.trim()) {
          lines.push({
            text: text.trim(),
            confidence: line.confidence,
            y: line.bbox.y0,
            height: line.bbox.y1 - line.bbox.y0,
            words,
          });
        }
      }
    }
  }
  lines.sort((a, b) => a.y - b.y);

  return {
    text: data.text,
    confidence: data.confidence,
    lines,
    wordCount,
    lowConfidenceWordCount,
  };
}

/** Quick single-pass recognition — used for the PDF-ledger scanned-page
 *  fallback in the reconciliation engine, where speed matters more than
 *  squeezing out the last percentage point of accuracy. */
export async function runOcr(
  image: string | HTMLCanvasElement | Blob,
  lang: OcrLanguage = "eng"
): Promise<OcrResult> {
  const worker = await getWorker(lang);
  return recognizeOnce(worker, image);
}

function scoreResult(r: OcrResult): number {
  // Rewards both confidence and how much was actually recognized — a pass
  // that reads 3 words at 95% confidence is worse than one that reads 80
  // words at 85%, which this product-with-sqrt balance favors.
  return r.confidence * Math.sqrt(Math.max(1, r.wordCount));
}

export interface ThoroughProgress {
  label: string;
  pass: number;
  totalPasses: number;
}

/**
 * The "give me the best possible read, however long it takes" pipeline:
 * runs OCR across multiple preprocessing variants (standard enhancement,
 * and a harder binarized pass for rough photo scans) crossed with
 * multiple Tesseract page-segmentation modes (auto, sparse text for
 * scattered/tabular layouts, single block for dense paragraphs), and
 * keeps whichever pass actually reads the document best. This mirrors
 * the "dual binarization + multiple PSM modes, auto-pick the best"
 * approach from the original Streamlit OCR tool.
 */
export async function runOcrThorough(
  source: File | Blob | string,
  lang: OcrLanguage = "eng",
  onProgress?: (p: ThoroughProgress) => void
): Promise<OcrResult> {
  const worker = await getWorker(lang);

  const preprocessVariants: { label: string; opts: Parameters<typeof preprocessImage>[1] }[] = [
    { label: "enhanced", opts: { grayscale: true, enhanceContrast: true, binarize: false, upscale: true } },
    { label: "high-contrast", opts: { grayscale: true, enhanceContrast: true, binarize: true, upscale: true } },
  ];
  const psmModes: { label: string; psm: PSM }[] = [
    { label: "auto layout", psm: PSM.AUTO },
    { label: "sparse / tabular", psm: PSM.SPARSE_TEXT },
    { label: "dense block", psm: PSM.SINGLE_BLOCK },
  ];

  const totalPasses = preprocessVariants.length * psmModes.length;
  let pass = 0;
  let best: OcrResult | null = null;

  for (const variant of preprocessVariants) {
    const { canvas } = await preprocessImage(source, variant.opts);
    for (const mode of psmModes) {
      pass++;
      onProgress?.({ label: `${variant.label} · ${mode.label}`, pass, totalPasses });
      await worker.setParameters({ tessedit_pageseg_mode: mode.psm });
      const result = await recognizeOnce(worker, canvas);
      if (!best || scoreResult(result) > scoreResult(best)) best = result;
    }
  }

  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return { ...(best as OcrResult), passesRun: totalPasses };
}

/* ------------------------------------------------------------------ */
/*  Field extraction — regex + keyword heuristics over OCR'd lines     */
/* ------------------------------------------------------------------ */

export interface ExtractedField {
  label: string;
  value: string;
  confidence: number; // 0-100
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}\b/;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/;

/** Turns a human-readable label into a stable object key, e.g.
 *  "Date of Birth" -> "date_of_birth". Exported so callers building
 *  their own field maps (e.g. from the AI extractor's dynamic field
 *  list) key them the same way. */
export function slugifyLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z0-9 ()/.&'-]{1,40}?)\s*[:\-]\s+(.+)$/;
// Fallback for label/value pairs printed with a wide column gap instead
// of a colon (common in scanned forms and tables read by OCR).
const WIDE_GAP_RE = /^([A-Za-z][A-Za-z0-9 ()/.&'-]{1,40}?)\s{2,}(.+)$/;
const HEADER_SKIP_RE = /^(tax\s*)?invoice$|^bill\s*of\s*supply$|^receipt$|^statement$|^certificate$/i;

/**
 * Document-agnostic field extraction: scans OCR'd lines for
 * "Label: value" (or wide-gapped "Label   value") pairs and returns
 * whatever labelled fields the document actually contains — no
 * assumption that the document is an invoice, so this works equally
 * well for IDs, certificates, forms, letters, receipts, or anything
 * else someone uploads.
 */
export function extractDocumentFields(result: OcrResult): Record<string, ExtractedField> {
  const fields: Record<string, ExtractedField> = {};
  const usedKeys = new Set<string>();

  for (const line of result.lines) {
    const text = line.text.trim();
    if (!text || text.length > 120 || HEADER_SKIP_RE.test(text)) continue;

    const m = text.match(LABEL_VALUE_RE) ?? text.match(WIDE_GAP_RE);
    if (!m) continue;

    const label = m[1].trim().replace(/\s+/g, " ");
    const value = m[2].trim();
    if (!label || !value || value.length > 100 || /^\d+$/.test(label)) continue;

    let key = slugifyLabel(label);
    let n = 2;
    while (usedKeys.has(key)) key = `${slugifyLabel(label)}_${n++}`;
    usedKeys.add(key);

    fields[key] = { label, value, confidence: line.confidence };
  }

  // GSTIN / PAN are fixed-format identifiers that can appear on any kind
  // of document (not just invoices), so they're still worth surfacing
  // when the format matches, even without an explicit "GSTIN:" label.
  const gstinMatch = result.text.match(GSTIN_RE);
  if (gstinMatch && !Object.values(fields).some((f) => f.value === gstinMatch[0])) {
    fields.gstin = { label: "GSTIN", value: gstinMatch[0], confidence: Math.min(98, result.confidence) };
  }
  const textWithoutGstin = gstinMatch ? result.text.replace(gstinMatch[0], "") : result.text;
  const panMatch = textWithoutGstin.match(PAN_RE);
  if (panMatch && !Object.values(fields).some((f) => f.value === panMatch[0])) {
    fields.pan = { label: "PAN", value: panMatch[0], confidence: Math.min(95, result.confidence) };
  }

  return fields;
}

/* ------------------------------------------------------------------ */
/*  Table reconstruction from OCR'd lines                              */
/* ------------------------------------------------------------------ */

/**
 * On complex/rotated table scans, Tesseract's page-segmentation modes
 * (sparse text especially, which `runOcrThorough` often picks for these)
 * frequently detect each individual table CELL as its own "line" rather
 * than a full row — so by the time we have `OcrLine[]`, a 7-column,
 * 6-row table has already become 40+ single-cell "lines" with no row
 * structure left in the text. The old approach fed that straight into
 * the PDF-text column-gap heuristic (`textToTable`, designed for lines
 * that already represent a full row), which had nothing reliable to
 * split on and would lock onto stray 2-cell fragments instead of the
 * real table.
 *
 * This reconstructs rows geometrically instead: lines are grouped into
 * visual rows by y-proximity (using each line's own height as the
 * clustering tolerance), all the words belonging to a row are pooled
 * back together and re-split into cells by real x-gaps, and finally a
 * row length that recurs across multiple rows (favoring 3+ columns,
 * since 1-2 "columns" are almost always stray text or label/value
 * pairs rather than a genuine table) is picked as the table shape.
 */
function clusterLinesIntoRows(lines: OcrLine[]): OcrLine[][] {
  if (!lines.length) return [];
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  const heights = sorted.map((l) => l.height).filter((h): h is number => !!h && h > 0);
  const medianHeight = heights.length
    ? heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)]
    : 20;
  const rowGapThreshold = Math.max(6, medianHeight * 0.65);

  const rows: OcrLine[][] = [];
  let rowAvgY = -Infinity;
  for (const line of sorted) {
    if (rows.length && Math.abs(line.y - rowAvgY) <= rowGapThreshold) {
      const row = rows[rows.length - 1];
      row.push(line);
      rowAvgY = row.reduce((s, l) => s + l.y, 0) / row.length;
    } else {
      rows.push([line]);
      rowAvgY = line.y;
    }
  }
  return rows;
}

/** Re-splits a row's pooled words into cell spans (text + x-range) using
 *  real x-gaps, rather than trusting wherever Tesseract happened to draw
 *  its own line boundaries (which, per the note above, is often one
 *  cell each). Keeping the x-range (not just the text) lets the header
 *  reconstruction below line header text up with the right column. */
function rowToCellSpans(row: OcrLine[], gapThreshold = 18): { text: string; x0: number; x1: number }[] {
  const words = row.flatMap((l) => l.words ?? []).sort((a, b) => a.x0 - b.x0);
  if (!words.length) {
    // No word-level position data — fall back to treating each original
    // line as one cell (still better than nothing).
    return row.map((l) => ({ text: l.text, x0: 0, x1: 0 })).filter((c) => c.text);
  }
  const cells: { text: string; x0: number; x1: number }[] = [];
  let current = "";
  let cx0: number | null = null;
  let prevX1: number | null = null;
  for (const w of words) {
    if (prevX1 !== null && w.x0 - prevX1 > gapThreshold) {
      if (current.trim()) cells.push({ text: current.trim(), x0: cx0 as number, x1: prevX1 });
      current = "";
      cx0 = null;
    }
    if (cx0 === null) cx0 = w.x0;
    current += (current ? " " : "") + w.text;
    prevX1 = w.x1;
  }
  if (current.trim()) cells.push({ text: current.trim(), x0: cx0 as number, x1: prevX1 as number });
  return cells;
}

const NUMERIC_CELL_RE = /^[\d.,%\/₹$-]+$/;

/**
 * Some uploads (ledger pages, vendor statements, lab/test reports) are
 * tables, not single-document field sets — keyword field extraction
 * above will legitimately come back mostly empty for these. This
 * reconstructs the real row/column structure from the OCR'd lines'
 * word-level positions (see clusterLinesIntoRows/rowToCellSpans above),
 * so the user gets usable structured data instead of either a wall of
 * "Not detected" fields or a garbled fake table.
 *
 * Column HEADERS are reconstructed too, rather than falling back to
 * generic "Column 1/2/3" names: the data rows reliably share the same
 * cell count, so their word x-positions establish where each column
 * actually sits on the page; whatever text sits directly above that —
 * even a header that wraps across two physical lines, which is common
 * on scanned report tables — gets assigned to its nearest column by
 * x-position and stitched back together into the real printed label.
 */
export function detectTableInResult(result: OcrResult): PdfTable {
  const rowClusters = clusterLinesIntoRows(result.lines);
  const withCells = rowClusters.map((row) => ({ row, spans: rowToCellSpans(row) }));

  const counts = new Map<number, number>();
  for (const { spans } of withCells) {
    if (spans.length < 3) continue; // 1-2 "columns" is text or a label:value pair, not a table
    counts.set(spans.length, (counts.get(spans.length) ?? 0) + 1);
  }
  let modeLen = 0;
  let modeCount = 0;
  for (const [len, count] of counts) {
    if (count > modeCount) {
      modeCount = count;
      modeLen = len;
    }
  }
  // Need the shape to recur across at least a couple of rows before
  // trusting it's a real table rather than a coincidence.
  if (modeLen === 0 || modeCount < 2) return { headers: [], rows: [] };

  const dataRowIdx = withCells
    .map((wc, i) => ({ wc, i }))
    .filter(({ wc }) => wc.spans.length === modeLen);
  if (dataRowIdx.length === 0) return { headers: [], rows: [] };

  // Column x-centers, established from the data rows themselves (the
  // one thing we can trust to be consistently modeLen-wide).
  const columnCenters = Array.from({ length: modeLen }, (_, col) => {
    const mids = dataRowIdx
      .map(({ wc }) => wc.spans[col])
      .filter(Boolean)
      .map((s) => (s.x0 + s.x1) / 2);
    mids.sort((a, b) => a - b);
    return mids[Math.floor(mids.length / 2)];
  });
  function nearestColumn(x: number): number {
    let best = 0;
    let bestDist = Infinity;
    columnCenters.forEach((c, i) => {
      const d = Math.abs(x - c);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  // Pull the real header text from whatever row-cluster(s) sit directly
  // above the first data row (covers headers wrapped across up to a
  // couple of physical lines), assigning each header word to its
  // nearest data column rather than trusting the header's own (often
  // fragmented) row grouping.
  const firstDataRowIdx = dataRowIdx[0].i;
  const headerWords: { col: number; text: string; y: number; x0: number }[] = [];
  const lookback = Math.min(firstDataRowIdx, 4);
  for (let i = firstDataRowIdx - lookback; i < firstDataRowIdx; i++) {
    if (i < 0) continue;
    for (const line of rowClusters[i]) {
      for (const w of line.words ?? []) {
        headerWords.push({ col: nearestColumn(w.x0), text: w.text, y: line.y, x0: w.x0 });
      }
    }
  }
  const headerByCol: string[][] = Array.from({ length: modeLen }, () => []);
  headerWords
    .sort((a, b) => a.y - b.y || a.x0 - b.x0)
    .forEach((w) => headerByCol[w.col].push(w.text));

  const headers = headerByCol.map((words, i) => {
    const label = words.join(" ").trim();
    // A "header" that's purely numeric/punctuation isn't a real label —
    // more likely a stray table value that drifted into the lookback
    // window — so fall back to a generic name for just that column.
    return label && !NUMERIC_CELL_RE.test(label) ? label : `Column ${i + 1}`;
  });

  const tableRows: Record<string, any>[] = dataRowIdx.map(({ wc }) => {
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => (obj[h] = wc.spans[i]?.text ?? ""));
    return obj;
  });

  return { headers, rows: tableRows };
}

/* ------------------------------------------------------------------ */
/*  Export helpers for the OCR Scanner's document queue                */
/* ------------------------------------------------------------------ */

export interface OcrDocSummary {
  fileName: string;
  fields: Record<string, ExtractedField>;
  confidence: number;
  lowConfidenceWordCount: number;
  /** Present when the document is a table/report (ledger page, lab
   *  report, statement, etc.) rather than a single field-shaped
   *  document — "fields" above is usually empty for these, so the
   *  export functions fall back to this structured table instead. */
  table?: { headers: string[]; rows: Record<string, any>[] } | null;
  /** Full recognized text (AI transcription or raw OCR text) — always
   *  carried through to every export so a document is never reduced to
   *  just "Not detected" fields when the underlying text was read fine. */
  rawText?: string;
}

/** Column order is built dynamically from whatever fields were actually
 *  found across the batch — a set of invoices gives "Invoice No / Total
 *  Amount / GSTIN…" columns, a set of ID cards gives "Name / DOB / ID
 *  No…" columns, and a mixed batch gets the union of both. No document
 *  type is special-cased or assumed ahead of time. */
export function collectFieldLabelOrder(docs: OcrDocSummary[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const field of Object.values(doc.fields)) {
      if (!seen.has(field.label)) {
        seen.add(field.label);
        order.push(field.label);
      }
    }
  }
  return order;
}

export function buildOcrExportRows(docs: OcrDocSummary[]): Record<string, any>[] {
  const labelOrder = collectFieldLabelOrder(docs);
  return docs.map((doc) => {
    const row: Record<string, any> = { "File Name": doc.fileName };
    const byLabel: Record<string, string> = {};
    for (const field of Object.values(doc.fields)) byLabel[field.label] = field.value;

    const hasTable = Boolean(doc.table && doc.table.headers.length && doc.table.rows.length);
    const hasAnyField = labelOrder.some((label) => (byLabel[label] ?? "").trim());

    for (const label of labelOrder) row[label] = byLabel[label] ?? "";

    row["Document Type"] = hasTable
      ? "Table / report (see separate sheet)"
      : hasAnyField
      ? "Structured fields"
      : "Unclassified (see Recognized Text)";
    row["OCR Confidence"] = `${doc.confidence.toFixed(1)}%`;
    row["Low-Confidence Words"] = doc.lowConfidenceWordCount;
    // Always carry the full recognized text through — this is what keeps
    // a document useful in the export even when no field or table was
    // confidently detected, which is exactly the case that used to
    // leave rows looking mostly empty.
    row["Recognized Text"] = doc.rawText ?? "";
    return row;
  });
}

/** One extra sheet per table-shaped document (ledger page, lab/test
 *  report, statement, etc.), keyed by a sheet-safe version of the file
 *  name, holding the actual extracted rows — Excel sheet names are
 *  capped at 31 chars so long file names are trimmed. */
export function buildOcrTableSheets(docs: OcrDocSummary[]): Record<string, Record<string, any>[]> {
  const sheets: Record<string, Record<string, any>[]> = {};
  const usedNames = new Set<string>();
  docs.forEach((doc, i) => {
    if (!doc.table || !doc.table.headers.length || !doc.table.rows.length) return;
    let base = doc.fileName.replace(/\.[^.]+$/, "").replace(/[\\/*?:\[\]]/g, " ").trim();
    let name = base.slice(0, 28) || `Doc ${i + 1}`;
    while (usedNames.has(name)) name = `${name.slice(0, 25)} ${i + 1}`;
    usedNames.add(name);
    sheets[name] = doc.table.rows;
  });
  return sheets;
}

export function tableCell(row: Record<string, any>, header: string, index: number): string {
  if (header in row && row[header] !== undefined && row[header] !== null) return String(row[header]);
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const key = Object.keys(row).find((k) => normalize(k) === normalize(header));
  if (key !== undefined) return String(row[key] ?? "");
  // Last resort: line up by column position — covers cases where the
  // extractor's row keys don't exactly echo its own header strings.
  const values = Object.values(row);
  return values[index] !== undefined ? String(values[index]) : "";
}

const BRAND_GREEN_HEX = "5A9C4E";
const BRAND_SKY_HEX = "3B7FBF";
const HEADER_TEXT_HEX = "FFFFFF";
const BAND_HEX = "F2F6EF";
const INK_HEX = "161E2D";

/**
 * Builds a properly formatted, coloured Excel workbook for a batch of
 * OCR/AI-read documents: a "Summary" sheet with a bold coloured header
 * row, banded rows, frozen header, and auto-sized columns, plus one
 * extra sheet per table-shaped document (ledger page, lab report,
 * etc). Replaces the plain, unstyled worksheet output so exports look
 * like an actual report rather than a raw data dump — regardless of
 * whether the batch is invoices, IDs, certificates, ledger pages, or a
 * mix of all of them.
 */
export async function downloadOcrExcelReport(docs: OcrDocSummary[], fileName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria Enterprise Platform";
  wb.created = new Date();

  const rows = buildOcrExportRows(docs);
  const columns = rows.length ? Object.keys(rows[0]) : ["File Name"];

  const summary = wb.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  summary.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(50, Math.max(14, key.length + 4)),
  }));

  summary.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${HEADER_TEXT_HEX}` } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_GREEN_HEX}` } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
  summary.getRow(1).height = 20;

  rows.forEach((row, i) => {
    const excelRow = summary.addRow(row);
    if (i % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BAND_HEX}` } };
      });
    }
    excelRow.eachCell((cell) => {
      cell.font = { ...(cell.font ?? {}), color: { argb: `FF${INK_HEX}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    excelRow.height = 18;
  });

  // Auto-size columns a little further based on actual content, capped
  // so one very long "Recognized Text" value doesn't blow out the sheet.
  summary.columns.forEach((col) => {
    let max = String(col.header ?? "").length;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(60, Math.max(12, max + 2));
  });

  // One extra sheet per table-shaped document (ledger page, lab/test
  // report, etc.), styled the same way as the summary sheet.
  const tableSheets = buildOcrTableSheets(docs);
  for (const [name, tableRows] of Object.entries(tableSheets)) {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    const cols = tableRows.length ? Object.keys(tableRows[0]) : ["Column 1"];
    ws.columns = cols.map((key) => ({ header: key, key, width: Math.max(12, key.length + 4) }));
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: `FF${HEADER_TEXT_HEX}` } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_SKY_HEX}` } };
    });
    tableRows.forEach((row, i) => {
      const excelRow = ws.addRow(row);
      if (i % 2 === 1) {
        excelRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BAND_HEX}` } };
        });
      }
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadOcrPdfReport(docs: OcrDocSummary[], fileName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { drawLetterhead, drawFooter } = await import("./pdfBranding");

  const doc = new jsPDF({ orientation: "landscape" });
  const green: [number, number, number] = [124, 179, 66];

  const startY = await drawLetterhead(
    doc,
    "OCR Extraction Report",
    `${docs.length} document${docs.length === 1 ? "" : "s"} · Generated ${new Date().toLocaleString("en-IN")}`
  );

  // Column set adapts to whatever the documents actually contained — a
  // batch of invoices gets invoice-shaped columns, a batch of ID cards
  // gets ID-shaped columns, a mixed batch gets the union. Capped so a
  // document with an unusually long field list doesn't blow out the
  // page — the full detail for every field still lives in the Excel
  // export and each document's own text/table page below.
  const labelOrder = collectFieldLabelOrder(docs).slice(0, 10);
  const headers = ["File", ...labelOrder, "Confidence"];
  const body = docs.map((d) => {
    const byLabel: Record<string, string> = {};
    for (const field of Object.values(d.fields)) byLabel[field.label] = field.value;
    return [d.fileName, ...labelOrder.map((label) => byLabel[label] || "—"), `${d.confidence.toFixed(1)}%`];
  });

  autoTable(doc, {
    startY,
    head: [headers],
    body,
    theme: "striped",
    headStyles: { fillColor: green, textColor: 255, fontSize: 8 },
    styles: { fontSize: 7, cellPadding: 2 },
    margin: { left: 14, right: 14 },
  });

  // Documents that are tables/reports rather than single field-shaped
  // documents (lab reports, ledger pages, statements) get their full
  // extracted table on its own page, since the summary row above can't
  // hold tabular data.
  const tableDocs = docs.filter((d) => d.table && d.table.headers.length && d.table.rows.length);
  for (const d of tableDocs) {
    doc.addPage();
    const tStartY = await drawLetterhead(doc, d.fileName, "Extracted table data");
    autoTable(doc, {
      startY: tStartY,
      head: [d.table!.headers],
      body: d.table!.rows.map((row) => d.table!.headers.map((h, i) => tableCell(row, h, i))),
      theme: "striped",
      headStyles: { fillColor: green, textColor: 255, fontSize: 7.5 },
      styles: { fontSize: 7, cellPadding: 1.8 },
      margin: { left: 14, right: 14 },
    });
  }

  // Every remaining document (no table detected — single documents, or
  // anything that didn't cleanly match any labelled fields either) gets
  // its full recognized text on its own page, so the readable text
  // always makes it into the report even when structured fields came
  // back empty.
  const textDocs = docs.filter(
    (d) => !(d.table && d.table.headers.length && d.table.rows.length) && (d.rawText ?? "").trim()
  );
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (const d of textDocs) {
    doc.addPage();
    let ty = await drawLetterhead(doc, d.fileName, "Recognized text");
    doc.setFont("courier", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 36, 48);
    const lines = doc.splitTextToSize(d.rawText!.trim(), pageWidth - 28);
    for (const line of lines) {
      if (ty > pageHeight - 16) {
        doc.addPage();
        ty = 16;
      }
      doc.text(line, 14, ty);
      ty += 4.2;
    }
  }

  drawFooter(doc);
  doc.save(fileName);
}
