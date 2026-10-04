/**
 * Biome Platform — WhatsApp Agent / reference numbers
 * -------------------------------------------------------------------
 * Parses the coordination reference that ties one whole supply together.
 *
 * Printed shape (seen in the "Other References" box of a Biome tax
 * invoice / delivery note):
 *
 *        BDC  /  786  /  MHI  /  44
 *         |       |       |      |
 *         |       |       |      +-- vendor's tax invoice no
 *         |       |       |          (may instead be the vendor's
 *         |       |       |           challan no)
 *         |       |       +--------- vendor code (the supplier who
 *         |       |                  supplied this to our client)
 *         |       +----------------- our tax invoice no
 *         |                          (may instead be our challan no)
 *         +------------------------- our company code
 *
 * Real examples confirmed against actual documents:
 *   BDC/786/MHI/44   -> Biome Tax Invoice BI26-27-HR0786, vendor MHI inv 44
 *   BDC/884/IBS/30   -> Biome Delivery Note BIPL/2026-27/884, vendor IBS inv 30
 *
 * This runs over OCR'd text, so it has to survive real-world noise:
 * a stray leading letter ("IBDC/786/MHI/44"), a trailing full stop,
 * "1" read as "I", backslashes instead of slashes, stray spaces.
 */

const DEFAULT_COMPANY_CODES = ["BDC"];

/**
 * Our own plant codes. In a manufacturing supply these take the vendor's
 * place in the reference:
 *
 *   BDC / 810 / REW / 810
 *    |     |     |     |
 *    |     |     |     +-- our tax invoice number, repeated
 *    |     |     +-------- the PLANT, not a vendor
 *    |     +-------------- our tax invoice number
 *    +-------------------- our company code
 *
 * The give-away is the third segment matching a plant. Reading REW as a
 * vendor code would leave the supply waiting forever for a vendor
 * invoice that does not exist.
 *
 * On a manufacturing reference the second and fourth segments are always
 * the same number — both are our own invoice. Detection deliberately
 * does NOT depend on that, because a real invoice was found reading
 * BDC/809/REW/808 where the typist slipped a digit. Requiring them to
 * match would have refused a perfectly valid supply; instead the
 * mismatch is parsed, then reported as a probable typo.
 */
const PLANT_CODES = ["REW", "GKD"];

/** Codes (BDC, MHI) are compared letter-for-letter, so strip everything
 *  that isn't alphanumeric. */
function normaliseCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Document numbers may legitimately contain hyphens ("26-27-0786"), so
 *  those are kept — only surrounding punctuation is trimmed. */
function normaliseDocNo(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\-]/g, "")
    .replace(/^-+|-+$/g, "");
}

/** Segment separators we accept: / \ | and the hyphen. */
const SEGMENT = "[A-Z0-9][A-Z0-9\\-]{0,14}";
const SEP = "\\s*[\\/\\\\|]\\s*";
const REF_RE = new RegExp(
  `(${SEGMENT})${SEP}(${SEGMENT})${SEP}(${SEGMENT})${SEP}(${SEGMENT})`,
  "gi"
);

function isNumericish(s) {
  return /^[0-9]{1,12}$/.test(String(s).replace(/[^0-9]/g, "")) && /[0-9]/.test(s);
}

/**
 * Pull every plausible 4-segment reference out of a blob of text and
 * return them best-first.
 *
 * @param {string} text            OCR transcription / any text
 * @param {object} opts
 * @param {string[]} opts.companyCodes  our own codes, default ["BDC"]
 * @param {string[]} opts.vendorCodes   known vendor codes from the registry
 * @returns {Array<{raw,companyCode,biomeDocNo,vendorCode,vendorDocNo,score,canonical}>}
 */
function findReferences(text, opts = {}) {
  const companyCodes = (opts.companyCodes && opts.companyCodes.length
    ? opts.companyCodes
    : DEFAULT_COMPANY_CODES
  ).map(normaliseCode);
  const vendorCodes = new Set((opts.vendorCodes || []).map(normaliseCode));

  const haystack = String(text || "");
  const out = [];
  const seen = new Set();

  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(haystack)) !== null) {
    let [, s1, s2, s3, s4] = m;

    let companyCode = normaliseCode(s1);
    // OCR often glues the previous cell's last letter onto our code, e.g.
    // the invoice box renders as "IBDC/786/MHI/44". If the tail of what we
    // read IS one of our codes, trust the tail.
    const matchedCompany = companyCodes.find(
      (c) => companyCode === c || (companyCode.length <= c.length + 2 && companyCode.endsWith(c))
    );
    if (matchedCompany) companyCode = matchedCompany;

    const vendorCode = normaliseCode(s3);
    const biomeDocNo = normaliseDocNo(s2);
    const vendorDocNo = normaliseDocNo(s4);

    if (!companyCode || !biomeDocNo || !vendorCode || !vendorDocNo) continue;
    // A vendor code is a short alphabetic mnemonic (MHI, IBS, ...), never
    // a pure number — this is what rules out date-like "27/07/2026/44".
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(vendorCode)) continue;

    let score = 0;
    if (matchedCompany) score += 4;
    if (vendorCodes.has(vendorCode)) score += 3;
    if (isNumericish(biomeDocNo)) score += 1;
    if (isNumericish(vendorDocNo)) score += 1;
    if (/^[A-Z]{2,5}$/.test(vendorCode)) score += 1;

    // Below 4 it's almost certainly a date, a GSTIN fragment or an
    // address line — not a coordination reference.
    if (score < 4) continue;

    // Manufacturing: the third segment is one of our plants, and our own
    // document number is repeated in the fourth.
    const isPlant = PLANT_CODES.includes(vendorCode) || (opts.plantCodes || []).includes(vendorCode);
    const supplyType = isPlant ? "manufacturing" : "trading";
    if (isPlant) score += 3;

    // Both numbers on a manufacturing reference are our own invoice, so
    // they should agree. When they don't, someone mistyped one of them —
    // worth surfacing, never worth rejecting the document over.
    const numbersAgree = normaliseDocNo(biomeDocNo) === normaliseDocNo(vendorDocNo);
    const likelyTypo = isPlant && !numbersAgree;
    if (isPlant && numbersAgree) score += 2;

    const canonical = `${companyCode}/${biomeDocNo}/${vendorCode}/${vendorDocNo}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    out.push({
      raw: m[0].trim(),
      canonical,
      companyCode,
      biomeDocNo,
      vendorCode,
      vendorDocNo,
      // For a manufacturing supply this names the plant, not a vendor.
      plantCode: isPlant ? vendorCode : null,
      supplyType,
      /** Set when a manufacturing reference's two numbers disagree. */
      likelyTypo,
      typoNote: likelyTypo
        ? `Both numbers on a plant reference should be our invoice number, but this reads ${biomeDocNo} and ${vendorDocNo}. Check the invoice.`
        : null,
      score,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Convenience: the single best reference, or null. */
function parseReference(text, opts = {}) {
  return findReferences(text, opts)[0] || null;
}

function editDistance(a, b) {
  a = String(a); b = String(b);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/**
 * Rebuild a reference OCR mangled beyond the normal parser —
 * "BDC/8s4Bs/30" for BDC/884/IBS/30 (a slash lost, 8 read as s).
 *
 * Only possible because the rest of the page already says most of it:
 * OUR document number is printed separately (BIPL/2026-27/884), so the
 * second segment is known; the vendor code must be one of the registered
 * codes, so the third segment is chosen from a short list; the fourth is
 * whatever digits remain. Returns null unless exactly one vendor code
 * fits within one misread character.
 *
 * @param {string} text  the page text
 * @param {object} opts  { ourDocNo, companyCodes, vendorCodes, plantCodes }
 */
function repairReference(text, opts = {}) {
  const core = String(opts.ourDocNo || "").match(/(\d+)\s*$/);
  if (!core) return null;
  const ours = core[1].replace(/^0+(?=\d)/, "");
  const companyCodes = (opts.companyCodes && opts.companyCodes.length ? opts.companyCodes : DEFAULT_COMPANY_CODES).map(normaliseCode);
  const codes = [...new Set([...(opts.vendorCodes || []), ...PLANT_CODES, ...(opts.plantCodes || [])].map(normaliseCode).filter((c) => c.length >= 2))];
  const src = String(text || "");

  // Where a reference would be: after "Other References", or any token
  // that starts like our company code.
  const spots = [];
  const label = /other\s*re[ft]e?r?e?n?c?e?s?\.?\s*[:\-]?\s*([^\n]{0,40})/gi;
  let m;
  while ((m = label.exec(src))) spots.push(m[1]);
  for (const cc of companyCodes) {
    const re = new RegExp(`[${cc[0]}8][${cc.slice(1)}0O]{${cc.length - 1}}\\s*[\\/|\\\\Il1]?[^\\s]{3,24}`, "gi");
    while ((m = re.exec(src))) spots.push(m[0]);
  }

  for (const spot of spots) {
    let rest = spot.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cc = companyCodes.find((c) => editDistance(rest.slice(0, c.length), c) <= 1);
    if (!cc) continue;
    rest = rest.slice(cc.length);
    // Our number, allowing one misread character.
    const head = rest.slice(0, ours.length);
    const fold = (x) => x.replace(/[OQD]/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
    if (editDistance(fold(head), ours) > 1) continue;
    rest = rest.slice(ours.length);
    const tail = rest.match(/(\d{1,8})$/);
    if (!tail) continue;
    const middle = rest.slice(0, rest.length - tail[1].length).replace(/^[1I|L](?=[A-Z]{2})/, (x) => x); // keep; code may start with I
    if (!middle) continue;
    const fits = codes
      .map((c) => ({ c, d: Math.min(editDistance(middle, c), middle.length > c.length ? editDistance(middle.slice(-c.length), c) : 99) }))
      .filter((x) => x.d <= 1)
      .sort((a, b) => a.d - b.d);
    if (!fits.length || (fits.length > 1 && fits[0].d === fits[1].d)) continue;
    const rebuilt = parseReference(`${cc}/${ours}/${fits[0].c}/${tail[1]}`, { ...opts, vendorCodes: codes });
    if (rebuilt) return { ...rebuilt, repaired: true, repairedFrom: spot.trim() };
  }
  return null;
}

/** Safe for use as a folder name: BDC/786/MHI/44 -> BDC-786-MHI-44 */
function referenceToFolder(canonical) {
  return String(canonical || "")
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9\-_.]/g, "")
    .slice(0, 80);
}

module.exports = {
  findReferences,
  parseReference,
  repairReference,
  referenceToFolder,
  normaliseCode,
  normaliseDocNo,
  DEFAULT_COMPANY_CODES,
  PLANT_CODES,
};
