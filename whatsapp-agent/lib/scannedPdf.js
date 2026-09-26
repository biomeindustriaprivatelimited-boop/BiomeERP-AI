/**
 * Biome Platform — reading scanned PDFs offline
 * -------------------------------------------------------------------
 * Pulls the embedded page images out of a scanned PDF so Tesseract can
 * read them.
 *
 * THE PROBLEM THIS SOLVES
 * A large share of what arrives is produced by a phone scanner app —
 * "DocScanner 30-Jul-2026 01-16 PM.pdf", four pages, one or two
 * megabytes. Those PDFs have no text layer at all: each page is just a
 * photograph in a PDF wrapper. pdfjs finds nothing, so they fell
 * straight through to manual handling.
 *
 * The obvious fix is to rasterise each page and OCR the result, but that
 * needs `canvas`, which on Windows means a native toolchain and a build
 * step users shouldn't have to care about.
 *
 * So this takes the shorter path. A scanner-app PDF doesn't *render* to
 * an image — it *contains* one, stored as an ordinary JPEG. Lifting that
 * JPEG out is byte-scanning, needs no dependencies at all, and gives
 * Tesseract exactly the same picture rasterising would have produced.
 *
 * Scope: JPEG (DCTDecode) images, which is what every scanner app
 * produces. A PDF using Flate-compressed bitmaps isn't handled here and
 * falls back to the existing path.
 */

/**
 * Find embedded JPEG streams in a PDF buffer.
 *
 * JPEGs are located by their own markers rather than by parsing the PDF
 * object graph: every JPEG starts FF D8 FF and ends FF D9. Inside a PDF
 * those bytes are stored verbatim between `stream` and `endstream`, so
 * scanning for the markers is both simpler and far more tolerant of the
 * malformed PDFs scanner apps sometimes emit.
 *
 * @param {Buffer} buffer
 * @param {object} options
 *   @param {number} options.maxImages  stop after this many (default 8)
 *   @param {number} options.minBytes   ignore anything smaller (default 20 KB)
 * @returns {Buffer[]} the JPEGs, in page order
 */
function extractEmbeddedJpegs(buffer, options = {}) {
  const maxImages = options.maxImages || 8;
  // Logos and signature stamps are small. A scanned page is not.
  const minBytes = options.minBytes || 20 * 1024;

  const images = [];
  let cursor = 0;

  while (images.length < maxImages && cursor < buffer.length - 4) {
    // Start of Image
    const start = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]), cursor);
    if (start === -1) break;

    // End of Image. Search from just past the start so a marker inside
    // the header can't terminate it immediately.
    const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
    if (end === -1) break;

    const jpeg = buffer.subarray(start, end + 2);
    if (jpeg.length >= minBytes) images.push(Buffer.from(jpeg));

    cursor = end + 2;
  }

  return images;
}

/**
 * OCR a scanned PDF by reading its embedded page images.
 *
 * @param {Buffer} buffer     the PDF
 * @param {object} options
 *   @param {number} options.maxPages  pages to read (default 5)
 *   @param {string} options.lang      Tesseract language (default "eng")
 * @returns {Promise<{ pages: string[], text: string, imageCount: number }>}
 */
/**
 * Render every page to a PNG with MuPDF (WebAssembly — nothing to install
 * on the PC). This is the fix for "scanned PDFs are not read": phone
 * scanners and CamScanner write pages as Flate/JBIG2/CCITT images, not
 * JPEGs, so the old embedded-JPEG shortcut found nothing at all.
 * 2× scale gives Tesseract ~200 dpi, which is where handwritten kanta
 * slips start to read.
 */
async function rasterisePages(buffer, maxPages) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const n = Math.min(doc.countPages(), maxPages);
  const out = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceGray, false, true);
    out.push(Buffer.from(pix.asPNG()));
  }
  return out;
}

async function ocrScannedPdf(buffer, options = {}) {
  const maxPages = options.maxPages || 5;
  let images = [];
  try {
    images = await rasterisePages(buffer, maxPages);
  } catch (err) {
    // Fall back to the old shortcut when the renderer is unavailable.
    images = extractEmbeddedJpegs(buffer, { maxImages: maxPages });
  }
  if (!images.length) images = extractEmbeddedJpegs(buffer, { maxImages: maxPages });

  if (!images.length) {
    throw new Error(
      "This PDF has no text layer and no readable page images. It may use a compression " +
        "this reader doesn't handle — identify it manually, or add an AI key."
    );
  }

  let Tesseract;
  try {
    Tesseract = require("tesseract.js");
  } catch {
    throw new Error("tesseract.js isn't installed — run `npm install`.");
  }

  // One worker for every page. Starting a worker is the slow part, so
  // reusing it across pages matters on a four-page scan.
  // Hindi + English: kanta slips, bilties and receivings are printed in
  // Hindi with handwritten numbers. Both language files ship in
  // ./tessdata so nothing is downloaded at run time.
  const path = require("path");
  const langPath = path.join(__dirname, "..", "tessdata");
  const worker = await Tesseract.createWorker(options.lang || "hin+eng", 1, { langPath, gzip: true, cachePath: langPath });
  const pages = [];
  try {
    for (const image of images) {
      try {
        const { data } = await worker.recognize(image);
        pages.push((data.text || "").trim());
      } catch (err) {
        // One unreadable page shouldn't cost the other three.
        pages.push("");
      }
    }
  } finally {
    // Same guard as pdfText: a failing cleanup must never discard text
    // that was read successfully.
    try {
      await worker.terminate();
    } catch {
      /* best effort */
    }
  }

  return {
    pages,
    text: pages.filter(Boolean).join("\n\n"),
    imageCount: images.length,
  };
}

module.exports = { extractEmbeddedJpegs, ocrScannedPdf };
