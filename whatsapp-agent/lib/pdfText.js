/**
 * Biome Platform — PDF text extraction (offline)
 * -------------------------------------------------------------------
 * Reads text out of PDFs inside the WhatsApp agent, page by page.
 *
 * WHY THIS EXISTS
 * Almost everything that arrives in the sales group is a PDF, and the
 * agent could only OCR images. Tesseract cannot read a PDF, so every
 * PDF fell straight through to "Needs Review" no matter how clean it
 * was. That single gap is what put roughly nine documents in ten into
 * the manual pile.
 *
 * WHY PAGE BY PAGE
 * Vendors routinely send one merged PDF holding the tax invoice, the
 * e-way bill, the Bill T and the weight slip. Treating that as a single
 * blob means whichever document happens to dominate the text wins and
 * the other three are lost. Reading each page separately lets the
 * classifier see them as the four documents they are.
 *
 * pdfjs-dist is already a dependency of this project, so this adds no
 * new install step.
 */

let pdfjs = null;
let loadFailed = null;

/**
 * pdfjs ships several builds. The legacy one is the CommonJS build
 * meant for Node; the default is ESM and browser-targeted.
 */
function loadPdfjs() {
  if (pdfjs) return pdfjs;
  if (loadFailed) throw new Error(loadFailed);

  const candidates = [
    "pdfjs-dist/legacy/build/pdf.js",
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/build/pdf.js",
    "pdfjs-dist",
  ];
  for (const path of candidates) {
    try {
      const mod = require(path);
      pdfjs = mod.default || mod;
      if (typeof pdfjs.getDocument === "function") return pdfjs;
    } catch {
      // try the next build
    }
  }
  loadFailed = "pdfjs-dist could not be loaded — run `npm install` in the project folder.";
  throw new Error(loadFailed);
}

/** Run a cleanup call that must never break the caller. */
function safely(fn) {
  try {
    fn();
  } catch {
    /* cleanup is best effort — never worth losing a result over */
  }
}

async function safelyAsync(fn) {
  try {
    await fn();
  } catch {
    /* as above */
  }
}

/**
 * Extract the text of every page.
 *
 * @param {Buffer} buffer
 * @param {object} options
 *   @param {number} options.maxPages  stop after this many (default 20)
 * @returns {Promise<{ pages: string[], text: string, pageCount: number, hasTextLayer: boolean }>}
 */
async function extractPdfPages(buffer, options = {}) {
  const maxPages = options.maxPages || 20;
  const lib = loadPdfjs();

  const task = lib.getDocument({
    data: new Uint8Array(buffer),
    // These keep pdfjs quiet and lightweight in a headless process.
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  });

  const doc = await task.promise;
  const pageCount = doc.numPages;
  const pages = [];

  try {
    for (let n = 1; n <= Math.min(pageCount, maxPages); n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        // pdfjs returns positioned fragments. Joining with spaces and
        // inserting a newline when the vertical position jumps keeps
        // labels attached to their values, which is what the field
        // patterns rely on.
        let text = "";
        let lastY = null;
        for (const item of content.items) {
          if (typeof item.str !== "string") continue;
          const y = item.transform ? Math.round(item.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
            text += "\n";
          } else if (text && !text.endsWith("\n") && !text.endsWith(" ")) {
            text += " ";
          }
          text += item.str;
          lastY = y;
        }
        pages.push(text.replace(/[ \t]+/g, " ").trim());
      } finally {
        // Cleanup must never cost us the page we just read. These helpers
        // exist under different names across pdfjs versions, and calling
        // a missing one throws — which is exactly how every PDF in this
        // app ended up "unreadable" while its text sat parsed in memory.
        safely(() => page.cleanup && page.cleanup());
      }
    }
  } finally {
    // Release the worker so the process doesn't hold memory. Guarded for
    // the same reason as above: on this pdfjs build `doc.destroy` is not
    // a function, and letting that TypeError escape discarded the text
    // of every document the app has ever opened.
    await safelyAsync(() => doc.destroy && doc.destroy());
    await safelyAsync(() => task.destroy && task.destroy());
  }

  const text = pages.join("\n\n");
  return {
    pages,
    text,
    pageCount,
    // A scanned PDF has pages but almost no extractable text — that's
    // the signal to fall back to OCR rather than give up.
    hasTextLayer: text.replace(/\s/g, "").length > 40,
  };
}

module.exports = { extractPdfPages };
