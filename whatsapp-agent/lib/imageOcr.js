/**
 * Biome Platform — robust offline OCR for photos and scanned pages
 * -------------------------------------------------------------------
 * WhatsApp documents arrive as phone photos: tilted a few degrees, shot
 * sideways or upside down, in poor light (one corner darker than the
 * other), low contrast, JPEG-compressed, sometimes shrunk to 800 px by
 * WhatsApp itself. Tesseract on the raw photo reads the clean ones and
 * produces character soup on the rest — and a garbled GSTIN or reference
 * is exactly what made OUR invoice look like a vendor's.
 *
 * Every page therefore goes through the same steps before Tesseract sees
 * it, all in JavaScript/WebAssembly (MuPDF decodes and renders, nothing
 * native, nothing downloaded):
 *
 *   1. decode + scale        small images are upscaled (Tesseract wants
 *                            ~20 px text height), huge ones scaled down
 *   2. orientation           0/90 vs 180/270 from the text-line profile,
 *                            0 vs 180 (and 90 vs 270) by a quick OCR test
 *   3. deskew                projection-profile search ±8°, re-rendered
 *                            straight from the original pixels
 *   4. flatten lighting      divide by the estimated paper background, so
 *                            a shadowed corner reads like the rest
 *   5. contrast stretch      1st..99th percentile to 0..255
 *   6. OCR                   the flattened page; if Tesseract is unsure,
 *                            a binarised copy as well, best one kept
 *
 * Returns the text plus Tesseract's own confidence, so the caller can ask
 * the AI for a second opinion when a page genuinely could not be read.
 */

const ocr = require("./ocrWorker");

let mupdfPromise = null;
function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import("mupdf").then((m) => (m && m.Document ? m : m.default || m));
  return mupdfPromise;
}

/** Image types MuPDF decodes itself. WebP/HEIC fall back to Tesseract's own decoder. */
const MUPDF_IMAGE_TYPES = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/bmp": "image/bmp",
  "image/gif": "image/gif",
  "image/tiff": "image/tiff",
  "image/x-portable-anymap": "image/x-portable-anymap",
};

function sniffMime(buffer, mimeType) {
  const b = buffer;
  if (b.length > 4) {
    if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
    if (b.slice(0, 2).toString() === "BM") return "image/bmp";
    if (b.slice(0, 3).toString() === "GIF") return "image/gif";
    if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return "image/tiff";
    if (b.slice(4, 12).toString().includes("ftyp")) return "image/heic";
    if (b.slice(0, 4).toString() === "%PDF") return "application/pdf";
  }
  return mimeType || "application/octet-stream";
}

/* ------------------------------------------------------------------ */
/* Pixel helpers (8-bit gray, row stride = width)                      */
/* ------------------------------------------------------------------ */

function grayFromPixmap(pix) {
  const w = pix.getWidth();
  const h = pix.getHeight();
  const stride = pix.getStride();
  const n = pix.getNumberOfComponents() + (pix.getAlpha() ? 1 : 0);
  const src = pix.getPixels();
  const nc = pix.getNumberOfComponents();
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    if (nc >= 3) {
      // Luminance, not the red channel: a blue-ink stamp or a pink carbon
      // copy disappears entirely in red alone.
      for (let x = 0; x < w; x++) { const i = row + x * n; out[y * w + x] = (src[i] * 299 + src[i + 1] * 587 + src[i + 2] * 114) / 1000; }
    } else {
      for (let x = 0; x < w; x++) out[y * w + x] = src[row + x * n];
    }
  }
  return { w, h, data: out };
}

function toPng(mupdf, img) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, img.w, img.h], false);
  const px = pix.getPixels();
  const stride = pix.getStride();
  for (let y = 0; y < img.h; y++) px.set(img.data.subarray(y * img.w, (y + 1) * img.w), y * stride);
  return Buffer.from(pix.asPNG());
}

/** Shrink by an integer factor (mean) — used for the cheap analysis passes. */
function downsample(img, factor) {
  if (factor <= 1) return img;
  const w = Math.floor(img.w / factor);
  const h = Math.floor(img.h / factor);
  const out = new Uint8ClampedArray(w * h);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * img.w + x * factor;
        for (let dx = 0; dx < factor; dx++) s += img.data[row + dx];
      }
      out[y * w + x] = s / area;
    }
  }
  return { w, h, data: out };
}

/**
 * Even out the lighting: estimate the paper's brightness everywhere
 * (bright-pixel envelope over 24 px blocks, smoothed) and divide by it.
 * A page shot under a lamp with one dark corner comes out evenly white.
 */
function flatten(img) {
  const B = 24;
  const gw = Math.ceil(img.w / B);
  const gh = Math.ceil(img.h / B);
  const grid = new Float32Array(gw * gh);
  const spread = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let n = 0;
      for (let y = gy * B; y < Math.min(img.h, gy * B + B); y += 2) {
        for (let x = gx * B; x < Math.min(img.w, gx * B + B); x += 2) {
          hist[img.data[y * img.w + x]]++;
          n++;
        }
      }
      // 90th percentile: the paper, not the ink.
      let target = n * 0.9, acc = 0, v = 255, lo = null;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (lo === null && acc >= n * 0.1) lo = i;
        if (acc >= target) { v = i; break; }
      }
      grid[gy * gw + gx] = Math.max(v, 40);
      spread[gy * gw + gx] = v - (lo || 0);
    }
  }
  // Smooth the envelope (two 3x3 box passes) so text-dense blocks don't dip.
  let g = grid;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        // max-biased: a block full of text reads darker than its paper
        s += g[yy * gw + xx]; c++;
      }
      next[y * gw + x] = Math.max(g[y * gw + x], s / c);
    }
    g = next;
  }
  // The table / floor around a photographed page: blocks far darker than
  // the paper. Dividing them by their own "background" turns them into
  // grey noise that Tesseract reads as text and that wrecks its layout
  // analysis — they are painted white instead.
  const sorted = Array.from(grid).sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.75)] || 255;
  // Only flat dark blocks (no ink on them) — a page corner that is merely
  // in shadow still has text contrast and is kept.
  const isBackground = (gx, gy) => {
    const i = Math.min(gh - 1, gy) * gw + Math.min(gw - 1, gx);
    return grid[i] < paper * 0.55 && spread[i] < 22;
  };
  const out = new Uint8ClampedArray(img.w * img.h);
  for (let y = 0; y < img.h; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(gh - 1, y0 + 1);
    for (let x = 0; x < img.w; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / B - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(gw - 1, x0 + 1);
      const bg =
        g[y0 * gw + x0] * (1 - tx) * (1 - ty) + g[y0 * gw + x1] * tx * (1 - ty) +
        g[y1 * gw + x0] * (1 - tx) * ty + g[y1 * gw + x1] * tx * ty;
      out[y * img.w + x] = isBackground((x / B) | 0, (y / B) | 0) ? 255 : (img.data[y * img.w + x] / bg) * 255;
    }
  }
  return { w: img.w, h: img.h, data: out };
}

/** Linear stretch so the darkest 1% is black and the brightest 1% white. */
function stretch(img) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i += 3) hist[img.data[i]]++;
  const total = Math.ceil(img.data.length / 3);
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.01) { hi = i; break; } }
  if (hi - lo < 30) return img;
  const out = new Uint8ClampedArray(img.data.length);
  const k = 255 / (hi - lo);
  for (let i = 0; i < img.data.length; i++) out[i] = (img.data[i] - lo) * k;
  return { w: img.w, h: img.h, data: out };
}

function otsu(img) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  const total = img.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

function binarize(img) {
  const t = otsu(img);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i++) out[i] = img.data[i] > t ? 255 : 0;
  return { w: img.w, h: img.h, data: out };
}

/**
 * Text-line sharpness of the page at a given angle: dark pixels projected
 * onto rows; straight text gives tall narrow peaks (high variance of the
 * differences between neighbouring rows).
 */
function profileScore(points, angleDeg, axisVertical, size) {
  const a = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(a), cos = Math.cos(a);
  const bins = new Float32Array(size * 2 + 4);
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    const v = axisVertical ? x * cos + y * sin : y * cos - x * sin;
    const b = Math.round(v) + size;
    if (b >= 0 && b < bins.length) bins[b]++;
  }
  let s = 0;
  for (let i = 1; i < bins.length; i++) { const d = bins[i] - bins[i - 1]; s += d * d; }
  return s;
}

/**
 * Analyse layout on a small copy: is the text running sideways, and by
 * how many degrees is the page tilted?
 */
function analyseLayout(img) {
  const factor = Math.max(1, Math.round(Math.max(img.w, img.h) / 700));
  const small = downsample(stretch(flatten(img)), factor);
  const t = Math.min(otsu(small), 170);
  const pts = [];
  for (let y = 0; y < small.h; y++) for (let x = 0; x < small.w; x++) if (small.data[y * small.w + x] < t) pts.push(x, y);
  if (pts.length < 200) return { sideways: false, skew: 0 };
  const size = Math.max(small.w, small.h);
  let bestRow = { s: -1, a: 0 }, bestCol = { s: -1, a: 0 };
  for (let a = -8; a <= 8.001; a += 0.5) {
    const r = profileScore(pts, a, false, size);
    if (r > bestRow.s) bestRow = { s: r, a };
    const c = profileScore(pts, a, true, size);
    if (c > bestCol.s) bestCol = { s: c, a };
  }
  // Refine the winner to a quarter degree.
  const sideways = bestCol.s > bestRow.s * 1.5;
  const base = sideways ? bestCol : bestRow;
  let refined = base;
  for (let a = base.a - 0.5; a <= base.a + 0.501; a += 0.25) {
    const s = profileScore(pts, a, sideways, size);
    if (s > refined.s) refined = { s, a };
  }
  return { sideways, skew: refined.a };
}

/** Words that real supply documents contain — used to judge which reading is right. */
const SIGNALS = [
  /invoice/i, /challan|delivery\s*note/i, /gstin/i, /vehicle/i, /weight|weighment|kanta/i,
  /\b(?:tare|gross|net)\b/i, /e[\s-]*way/i, /consignee|consignor|buyer|supplier|bill\s*to/i,
  /quantity|qty/i, /amount|total/i, /sample|moisture|gcv/i, /bilty|lorry|consignment/i,
  /[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4}/, /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2}/,
  /\b\d{2}[A-Z0-9]{5}\d{4}[A-Z0-9]{4}\b/,
];

function textScore(text, confidence) {
  if (!text) return 0;
  const sig = SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const words = (text.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  return sig * 10 + Math.min(20, words / 10) + (Number(confidence) || 0) / 5;
}

/* ------------------------------------------------------------------ */
/* Geometry: one bilinear warp does rotation, deskew and scaling        */
/* ------------------------------------------------------------------ */

/**
 * Rotate by `deg` (any angle) and scale by `scale`, sampling the ORIGINAL
 * pixels bilinearly. MuPDF's own renderer upscales a photo block-by-block
 * (nearest neighbour), which turns 9 px WhatsApp text into staircases
 * Tesseract cannot read; smooth interpolation is what makes upscaling help
 * instead of hurt.
 */
function warp(img, deg, scale) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const W = Math.max(1, Math.round((Math.abs(img.w * c) + Math.abs(img.h * s)) * scale));
  const H = Math.max(1, Math.round((Math.abs(img.w * s) + Math.abs(img.h * c)) * scale));
  const out = new Uint8ClampedArray(W * H);
  const cx = img.w / 2, cy = img.h / 2, ox = W / 2, oy = H / 2;
  const d = img.data, iw = img.w, ih = img.h;
  // Shrinking a lot: average first so thin strokes don't alias away.
  if (scale < 0.6) {
    const f = Math.max(1, Math.floor(1 / scale));
    if (f > 1) return warp(downsample(img, f), deg, scale * f);
  }
  for (let y = 0; y < H; y++) {
    const dy = (y - oy) / scale;
    for (let x = 0; x < W; x++) {
      const dx = (x - ox) / scale;
      const sx = dx * c + dy * s + cx;
      const sy = -dx * s + dy * c + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= iw - 1 || y0 >= ih - 1) { out[y * W + x] = 255; continue; }
      const tx = sx - x0, ty = sy - y0, i = y0 * iw + x0;
      out[y * W + x] = (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + iw] * (1 - tx) + d[i + iw + 1] * tx) * ty;
    }
  }
  return { w: W, h: H, data: out };
}

function crop(img, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(img.w, Math.ceil(x1)); y1 = Math.min(img.h, Math.ceil(y1));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) out.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, data: out };
}

/**
 * Erase the ruling lines of a table (Tally invoices are one big grid).
 * Tesseract's layout analysis treats a boxed cell as a picture and
 * silently drops the bold values inside it — the invoice number, the
 * "Other References" and the vehicle number were exactly what went
 * missing. Long horizontal / vertical dark runs are painted white.
 */
function removeLines(img) {
  const t = Math.min(otsu(img), 180);
  const minH = Math.max(40, Math.round(img.w / 22));
  const minV = Math.max(40, Math.round(img.h / 22));
  const kill = new Uint8Array(img.w * img.h);
  const dark = (x, y) => img.data[y * img.w + x] < t;
  for (let y = 0; y < img.h; y++) {
    let run = 0;
    for (let x = 0; x <= img.w; x++) {
      if (x < img.w && dark(x, y)) { run++; continue; }
      if (run >= minH) for (let k = x - run; k < x; k++) kill[y * img.w + k] = 1;
      run = 0;
    }
  }
  for (let x = 0; x < img.w; x++) {
    let run = 0;
    for (let y = 0; y <= img.h; y++) {
      if (y < img.h && dark(x, y)) { run++; continue; }
      if (run >= minV) for (let k = y - run; k < y; k++) kill[k * img.w + x] = 1;
      run = 0;
    }
  }
  const out = new Uint8ClampedArray(img.data);
  for (let y = 1; y < img.h - 1; y++) {
    for (let x = 1; x < img.w - 1; x++) {
      const i = y * img.w + x;
      // the line itself plus its anti-aliased fringe
      if (kill[i] || kill[i - 1] || kill[i + 1] || kill[i - img.w] || kill[i + img.w]) out[i] = 255;
    }
  }
  return { w: img.w, h: img.h, data: out };
}

/** A photo, decoded at its real pixel size (MuPDF's page view of an image is scaled by its DPI tag). */
function decodeImage(mupdf, buffer) {
  const image = new mupdf.Image(buffer);
  return grayFromPixmap(image.toPixmap());
}

/** A PDF page rendered at roughly scanner resolution (~200 dpi). */
function renderPdfPage(mupdf, page, longPx = 2300) {
  const b = page.getBounds();
  const longPt = Math.max(b[2] - b[0], b[3] - b[1]) || 842;
  const scale = Math.max(0.5, Math.min(4, longPx / longPt));
  return grayFromPixmap(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true));
}

/**
 * How much to enlarge: Tesseract reads best when lowercase letters are
 * ~20-30 px tall. A whole A4 page in a WhatsApp photo (1000-1600 px)
 * carries 8-10 px letters, so it is enlarged ~2.5x; a 4000 px camera
 * original is left about as it is.
 */
function scaleFor(img) {
  const long = Math.max(img.w, img.h);
  const target = long < 1300 ? long * 3 : long < 2000 ? long * 2.2 : Math.min(3600, long * 1.25);
  return Math.max(0.5, Math.min(3.2, Math.min(target, 3600) / long));
}

async function recognizeImg(mupdf, img, psm = 3) {
  const png = toPng(mupdf, img);
  const r = await ocr.recognizeFull(png, { psm });
  return { ...r, score: textScore(r.text, r.confidence) };
}

/**
 * Read the page in overlapping tiles (2 x 2, then 2 x 3 on tall pages),
 * each as one block of text. Tesseract's whole-page layout analysis
 * skips boxed table cells; a tile has no layout to get wrong, and a
 * label and its value land on the same line ("Invoice No. BI26-27-HR0912")
 * which is exactly how the field reader looks for them.
 */
async function readTiles(mupdf, img, budgetLeft) {
  const started = Date.now();
  const rows = img.h > img.w * 1.2 ? 3 : 2;
  const cols = 2;
  const ov = 0.1;
  const texts = [];
  const confs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Date.now() - started > budgetLeft) break;
      const tile = crop(
        img,
        (c / cols - ov / 2) * img.w, (r / rows - ov / 2) * img.h,
        ((c + 1) / cols + ov / 2) * img.w, ((r + 1) / rows + ov / 2) * img.h
      );
      try {
        const t = await ocr.recognizeFull(toPng(mupdf, tile), { psm: 6 });
        if (t.text && t.text.trim()) { texts.push(t.text.trim()); confs.push(t.confidence || 0); }
      } catch {
        /* one tile is not worth the page */
      }
    }
  }
  return {
    text: texts.join("\n"),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
  };
}

/**
 * OCR one page given as gray pixels (a decoded photo or a rendered PDF page).
 * @returns {Promise<{text, confidence, rotation, skew, variant, passes, ms}>}
 */
async function ocrGrayPage(mupdf, base, options = {}) {
  const started = Date.now();
  const budget = options.budgetMs || 75000;
  const layout = analyseLayout(base);
  const scale = options.scale || scaleFor(base);

  const prepare = (deg, sc = scale) => stretch(flatten(warp(base, deg - layout.skew, sc)));

  // Which way up? Decided on a central crop at full reading size — cheap,
  // and unlike a shrunken whole page the letters are big enough to read.
  const candidates = layout.sideways ? [90, 270, 0, 180] : [0, 180, 90, 270];
  let rotation = candidates[0];
  let page = prepare(rotation);
  let first = await recognizeImg(mupdf, page, 3);
  const weak = (r) => r.score < 55 || r.confidence < 55;
  if (weak(first)) {
    const probe = (img) => crop(img, img.w * 0.12, img.h * 0.1, img.w * 0.88, img.h * 0.55);
    let bestProbe = await recognizeImg(mupdf, probe(page), 6);
    for (const deg of candidates.slice(1)) {
      if (Date.now() - started > budget * 0.5) break;
      const img = prepare(deg);
      const p = await recognizeImg(mupdf, probe(img), 6);
      if (p.score > bestProbe.score + 6) { bestProbe = p; rotation = deg; page = img; }
    }
    if (rotation !== candidates[0]) first = await recognizeImg(mupdf, page, 3);
  }

  // Pass 2: table lines erased, read in tiles. Always run on anything that
  // looks like a form (it is where the numbers are), unless pass 1 was
  // already crisp and complete.
  const passes = ["page"];
  const parts = [first.text || ""];
  let confidence = first.confidence || 0;
  const crisp = first.confidence >= 85 && first.score >= 70;
  if (!crisp && Date.now() - started < budget) {
    const clean = removeLines(page);
    const tiles = await readTiles(mupdf, clean, budget - (Date.now() - started));
    if (tiles.text) {
      parts.push(tiles.text);
      passes.push("tiles");
      confidence = Math.max(confidence, tiles.confidence);
    }
    // Pass 3: faint print / carbon copies — a hard black-and-white copy.
    if (confidence < 60 && Date.now() - started < budget) {
      const bin = await recognizeImg(mupdf, binarize(clean), 11);
      if (bin.text && bin.text.trim()) { parts.push(bin.text); passes.push("binarised"); confidence = Math.max(confidence, bin.confidence); }
    }
  }

  const text = parts.filter((t) => t && t.trim()).join("\n\n----\n\n");
  return {
    text,
    confidence: Math.round(Number(confidence) || 0),
    rotation: rotation % 360,
    skew: layout.skew,
    variant: passes.join("+"),
    passes,
    ms: Date.now() - started,
  };
}

/** Back-compat: OCR one MuPDF page object. */
async function ocrMupdfPage(mupdf, page, options = {}) {
  return ocrGrayPage(mupdf, renderPdfPage(mupdf, page, options.targetLong || 2300), options);
}

/**
 * OCR a photo or image file of any common format.
 * @returns {Promise<{text, confidence, rotation, skew, method}>}
 */
async function ocrImage(buffer, mimeType, options = {}) {
  let kind = sniffMime(buffer, mimeType);
  // WebP / AVIF (and anything else MuPDF can't decode): convert to PNG
  // with sharp when it is available in this install, so these photos get
  // the full clean-up too.
  if (!MUPDF_IMAGE_TYPES[kind] && kind !== "image/heic" && kind !== "image/heif") {
    try {
      const sharp = require("sharp");
      buffer = await sharp(buffer).rotate().png().toBuffer();
      kind = "image/png";
    } catch {
      /* Tesseract's own decoder below */
    }
  }
  if (MUPDF_IMAGE_TYPES[kind]) {
    try {
      const mupdf = await loadMupdf();
      let base;
      try {
        base = decodeImage(mupdf, buffer);
      } catch {
        const doc = mupdf.Document.openDocument(buffer, MUPDF_IMAGE_TYPES[kind]);
        base = renderPdfPage(mupdf, doc.loadPage(0), 2000);
      }
      const r = await ocrGrayPage(mupdf, base, options);
      return { ...r, method: r.rotation ? `image_ocr_rotated_${r.rotation}` : "image_ocr", width: base.w, height: base.h };
    } catch (err) {
      if (options.strict) throw err;
      /* fall through to Tesseract's own decoder */
    }
  }
  if (kind === "image/heic" || kind === "image/heif") {
    throw new Error("HEIC photos can't be read offline — add a Gemini key in Settings → AI, or send the photo as JPEG.");
  }
  // WebP and anything MuPDF doesn't know: Tesseract decodes it itself, at
  // each orientation, best kept.
  let best = { text: "", confidence: 0, score: -1, rotation: 0 };
  for (const rotation of [0, 180, 90, 270]) {
    let r;
    try {
      r = await ocr.recognizeFull(buffer, rotation ? { rotateRadians: (rotation * Math.PI) / 180 } : { rotateAuto: true });
    } catch {
      continue;
    }
    const score = textScore(r.text, r.confidence);
    if (score > best.score) best = { ...r, score, rotation };
    if (score >= 60 && r.confidence >= 60) break;
  }
  return {
    text: best.text || "",
    confidence: Math.round(Number(best.confidence) || 0),
    rotation: best.rotation,
    skew: 0,
    method: best.rotation ? `image_ocr_rotated_${best.rotation}` : "image_ocr",
  };
}

/**
 * OCR selected pages of a PDF (pages without a usable text layer).
 * @param {number[]} pageIndexes zero-based
 */
async function ocrPdfPages(buffer, pageIndexes, options = {}) {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const out = [];
  for (const i of pageIndexes) {
    if (i >= doc.countPages()) break;
    try {
      const page = doc.loadPage(i);
      // Rendered at ~200 dpi; a scanned page is then read at that size
      // (scale 1.25) — the scanner already gave it readable letters.
      const base = renderPdfPage(mupdf, page, options.targetLong || 2300);
      out.push({ index: i, ...(await ocrGrayPage(mupdf, base, { ...options, scale: options.scale || 1.3 })) });
    } catch (err) {
      out.push({ index: i, text: "", confidence: 0, error: err.message });
    }
  }
  return out;
}

module.exports = { ocrImage, ocrPdfPages, ocrGrayPage, ocrMupdfPage, sniffMime, analyseLayout, flatten, stretch, binarize, removeLines, warp, textScore, loadMupdf, decodeImage, toPng };
