// Client-side PDF text extraction & rasterization, built on pdfjs-dist.
// Used by both the Reconciliation module (PDF ledgers -> table rows) and
// the OCR Scanner (PDF documents -> either direct text, or rasterized
// pages handed off to Tesseract when the PDF has no text layer).

let pdfjsLibPromise: Promise<any> | null = null;

async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsLibPromise;
}

export interface PdfPageText {
  pageNumber: number;
  lines: string[];
}

export interface PdfExtractionResult {
  pageCount: number;
  pages: PdfPageText[];
  fullText: string;
  /** True when the PDF has a real text layer (not just scanned images). */
  hasTextLayer: boolean;
}

/**
 * Extracts text from a PDF, preserving row structure by clustering text
 * items that share the same vertical position (baseline) into lines, and
 * ordering them left-to-right — this is what makes ledger-style tables
 * recoverable as rows of cells further down the pipeline.
 */
export async function extractPdfText(file: File): Promise<PdfExtractionResult> {
  const pdfjsLib = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({
    data: buffer,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;

  const pages: PdfPageText[] = [];
  let totalChars = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    type Item = { str: string; x: number; y: number };
    const items: Item[] = (content.items as any[])
      .filter((it) => typeof it.str === "string")
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      }));

    // Cluster into lines by y-position (a few pixels of tolerance).
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; items: Item[] }[] = [];
    const TOLERANCE = 3;
    for (const it of items) {
      let line = lines.find((l) => Math.abs(l.y - it.y) <= TOLERANCE);
      if (!line) {
        line = { y: it.y, items: [] };
        lines.push(line);
      }
      line.items.push(it);
    }

    const pageLines = lines.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      // Insert a wide gap marker whenever the horizontal jump between two
      // words is large — this is later used to split ledger rows into
      // cells (mirrors how `pdftotext -layout` infers columns).
      let out = "";
      let prevEnd: number | null = null;
      for (const it of l.items) {
        if (prevEnd !== null && it.x - prevEnd > 10) {
          out += "  "; // column gap
        } else if (out) {
          out += " ";
        }
        out += it.str;
        prevEnd = it.x + it.str.length * 5.5; // rough glyph-width estimate
      }
      return out.trim();
    });

    pages.push({ pageNumber: i, lines: pageLines });
    totalChars += pageLines.join("").length;
  }

  const fullText = pages.map((p) => p.lines.join("\n")).join("\n\n");

  return {
    pageCount: doc.numPages,
    pages,
    fullText,
    // Fewer than ~4 real characters per page strongly suggests a scanned
    // (image-only) PDF with no embedded text layer.
    hasTextLayer: totalChars / Math.max(1, doc.numPages) > 4,
  };
}

/** Renders every page of a PDF to a PNG data URL, for OCR-ing scanned PDFs. */
export async function renderPdfPagesToImages(
  file: File,
  scale = 2.2
): Promise<string[]> {
  const pdfjsLib = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const images: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/png"));
  }
  return images;
}

/* ------------------------------------------------------------------ */
/*  Table-row heuristics — turn ledger-style PDF text into header+rows */
/* ------------------------------------------------------------------ */

export interface PdfTable {
  headers: string[];
  rows: Record<string, any>[];
}

/**
 * Splits each extracted line into cells (2+ space gaps, mirroring the
 * column-gap markers inserted during extraction), picks the most likely
 * header row (the first line whose cell count matches the mode of the
 * page), and returns a header/rows structure compatible with the
 * reconciliation engine's ColumnMapping.
 */
export function textToTable(pages: PdfPageText[]): PdfTable {
  const allLines = pages.flatMap((p) => p.lines).filter((l) => l.trim().length > 0);
  const split = (line: string) =>
    line
      .split(/\s{2,}/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

  const cellRows = allLines.map(split);
  const counts = new Map<number, number>();
  for (const cells of cellRows) {
    if (cells.length < 2) continue;
    counts.set(cells.length, (counts.get(cells.length) ?? 0) + 1);
  }
  let modeCount = 0;
  let modeLen = 0;
  for (const [len, count] of counts) {
    if (count > modeCount) {
      modeCount = count;
      modeLen = len;
    }
  }
  if (modeLen === 0) return { headers: [], rows: [] };

  const candidateRows = cellRows.filter((c) => c.length === modeLen);
  const headerCells = candidateRows[0];
  const headers = headerCells.map((h, i) => h || `Column ${i + 1}`);

  const rows: Record<string, any>[] = candidateRows.slice(1).map((cells) => {
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });

  return { headers, rows };
}
