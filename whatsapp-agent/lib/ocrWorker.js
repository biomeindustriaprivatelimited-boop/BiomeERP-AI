/**
 * Biome Platform — one OCR worker, fully offline, that can never hang
 * -------------------------------------------------------------------
 * Why this file exists (three real failures, one fix):
 *
 *  1. `Tesseract.createWorker("eng")` with no options DOWNLOADS the English
 *     model from a CDN on first use. On a PC behind a firewall, on a slow
 *     line, or with no internet, that download fails — and tesseract.js
 *     reports the failure as an uncaught worker error, so the awaiting
 *     promise NEVER settles. The WhatsApp queue processes one document at
 *     a time, so one stuck read stopped every document after it. That is
 *     "WhatsApp documents are not being saved".
 *  2. The installed app lives under Program Files, which is read-only, so
 *     even a successful download could not be cached and was repeated.
 *  3. `whatsapp-agent/tessdata/eng.traineddata.gz` is the LEGACY model;
 *     tesseract.js v7's LSTM core aborts on it
 *     ("missing function: DotProductSSE") — every scanned PDF failed.
 *
 * The fix: always load the LSTM models shipped in `public/tessdata`
 * (the same files the browser OCR uses), cache under the writable data
 * folder, surface worker errors instead of throwing them into the void,
 * and put a timeout on every call. A worker that fails is thrown away
 * and a fresh one is made for the next document.
 */

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");

const LANG_DIRS = [
  path.join(__dirname, "..", "..", "public", "tessdata"),
  path.join(process.cwd(), "public", "tessdata"),
];

function langPath() {
  for (const dir of LANG_DIRS) {
    if (fs.existsSync(path.join(dir, "eng.traineddata"))) return dir;
  }
  throw new Error("OCR language data not found (public/tessdata/eng.traineddata). Reinstall the app.");
}

function cachePath() {
  const dir = path.join(PATHS.root, "runtime", "tesseract-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s — skipped.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const workers = new Map(); // lang -> Promise<worker>

async function getWorker(lang = "eng") {
  if (workers.has(lang)) return workers.get(lang);
  const Tesseract = require("tesseract.js");
  let failed = null;
  const p = withTimeout(
    Tesseract.createWorker(lang.split("+"), 1, {
      langPath: langPath(),
      cachePath: cachePath(),
      gzip: false,
      // Without this, a worker error is thrown as an uncaught exception
      // and the caller's promise hangs forever.
      errorHandler: (err) => { failed = err; workers.delete(lang); },
    }),
    60_000,
    "Starting the OCR engine"
  ).catch((err) => { workers.delete(lang); throw err; });
  workers.set(lang, p);
  const w = await p;
  if (failed) throw failed;
  return w;
}

async function discard(lang) {
  const p = workers.get(lang);
  workers.delete(lang);
  if (p) { try { (await p).terminate(); } catch { /* already gone */ } }
}

/**
 * Read one image. Returns the text ("" when nothing legible).
 * `options` is passed straight to worker.recognize (e.g. rotateRadians).
 */
async function recognize(image, options = {}, lang = "eng") {
  const worker = await getWorker(lang);
  try {
    const result = await withTimeout(worker.recognize(image, options), 90_000, "Reading the page");
    return (result && result.data && result.data.text) || "";
  } catch (err) {
    await discard(lang); // a worker that failed once is not trusted again
    throw err;
  }
}

module.exports = { recognize, getWorker, langPath };
