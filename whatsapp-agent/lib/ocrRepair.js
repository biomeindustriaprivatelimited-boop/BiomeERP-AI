/**
 * Biome Platform — repairing OCR noise in the numbers that matter
 * -------------------------------------------------------------------
 * A phone photo of a Tally invoice, sent through WhatsApp, comes out of
 * Tesseract like this:
 *
 *     GSTINAMN: O6AAICBI9Z7HIZS            (06AAJCB1927H1ZS)
 *     Other References BDCI912/AATI338     (BDC/912/AAT/338)
 *     mmvoice Na 126.27-4RO912             (BI26-27-HR0912)
 *     Motor Vehicle No HRSSAB1I234         (HR55AB1234)
 *
 * Every field is there — just with look-alike characters. The exact
 * regexes downstream found none of them, so the document had no
 * reference, no invoice number, no vehicle, our own GSTIN was not
 * recognised and the paper was "not understood".
 *
 * Each of these identifiers has a FIXED SHAPE (which positions are
 * digits, which are letters), so a misread character can be put back
 * with confidence: an "O" where a digit must be is a 0, a "5" where a
 * letter must be is an S. GSTINs also carry a check character, which
 * proves a repair right.
 *
 * repairText() rewrites the noisy tokens IN PLACE (positions matter to
 * the issuer rules), and returns the list of repairs so the "Why?" view
 * can show them.
 */

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Character a look-alike stands for, when a digit is required. */
const TO_DIGIT = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", "|": "1", "!": "1", J: "1", T: "7", Z: "2", S: "5", B: "8", G: "6", A: "4", "]": "1", "[": "1" };
/** …and when a letter is required. */
const TO_LETTER = { 0: "O", 1: "I", 2: "Z", 5: "S", 8: "B", 6: "G", 4: "A", 7: "T", "|": "I", "!": "I" };

const digit = (c) => (/[0-9]/.test(c) ? c : TO_DIGIT[c] || null);
const letter = (c) => (/[A-Z]/.test(c) ? c : TO_LETTER[c] || null);
const alnum = (c) => (/[A-Z0-9]/.test(c) ? c : TO_LETTER[c] || null);

/** GSTIN check character (mod-36 Luhn variant used by the GST network). */
function gstinCheckChar(g) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}
function gstinValid(g) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g) && gstinCheckChar(g) === g[14];
}

const GST_SHAPE = ["d", "d", "l", "l", "l", "l", "l", "d", "d", "d", "d", "l", "a", "Z", "a"];

/** Put one 15-character OCR token into GSTIN shape, or null. */
function coerceGstin(tok) {
  if (tok.length !== 15) return null;
  let out = "";
  for (let i = 0; i < 15; i++) {
    const c = tok[i];
    const want = GST_SHAPE[i];
    // Position 13 (the entity number) is a digit on almost every GSTIN.
    const v = want === "d" ? digit(c) : want === "l" ? letter(c) : want === "Z" ? (c === "Z" || c === "2" || c === "7" ? "Z" : null) : i === 12 ? digit(c) || alnum(c) : alnum(c);
    if (!v) return null;
    out += v;
  }
  // State code 01-38 (97 = other territory, 99 = centre).
  const st = Number(out.slice(0, 2));
  if (!((st >= 1 && st <= 38) || st === 97 || st === 99)) return null;
  return out;
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

const OUR_PAN = "AAJCB1927H";

/**
 * Find GSTIN-like tokens and return { raw, index, value, how }.
 * `knownGstins` (vendor/client masters) let a near-miss snap to a real one.
 */
function findGstins(text, knownGstins = []) {
  const out = [];
  const up = String(text || "").toUpperCase();
  // 15 characters of letters/digits/look-alikes, allowing ONE stray space
  // that OCR likes to insert.
  const re = /(^|[^A-Z0-9])([0-9A-Z|!\]\[]{2}[0-9A-Z|!\]\[ ]{13,14})(?=$|[^A-Z0-9])/g;
  let m;
  while ((m = re.exec(up))) {
    const rawTok = m[2];
    const compact = rawTok.replace(/ /g, "");
    if (compact.length !== 15 || (rawTok.match(/ /g) || []).length > 1) continue;
    // A word that is all letters (or all digits) is not a GSTIN.
    if (!/[0-9]/.test(compact) || !/[A-Z]/.test(compact)) continue;
    const value = coerceGstin(compact);
    if (!value) continue;
    let fixed = value;
    let how = value === compact ? "exact" : "shape";
    if (gstinValid(value)) how = value === compact ? "exact" : "checksum";
    else {
      // Ours, misread: the PAN inside it is within two characters of ours.
      const pan = value.slice(2, 12);
      // Within two characters anywhere, or three when it is registered in
      // one of OUR states (06 Haryana, 27 Maharashtra) — a vendor PAN that
      // close to ours does not exist in practice.
      if (editDistance(pan, OUR_PAN) <= 2 || (["06", "27"].includes(value.slice(0, 2)) && editDistance(pan, OUR_PAN) <= 3)) {
        const cand = value.slice(0, 2) + OUR_PAN + value.slice(12, 14);
        fixed = cand + gstinCheckChar(cand);
        how = "our-pan";
      } else {
        const near = knownGstins.map((g) => ({ g, d: editDistance(g, value) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d)[0];
        if (near) { fixed = near.g; how = "master"; }
      }
    }
    out.push({ raw: rawTok, index: m.index + m[1].length, value: fixed, how });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The coordination reference: BDC / 786 / MHI / 44                   */
/* ------------------------------------------------------------------ */

/**
 * OCR turns the slashes into I, l, 1, |, ! or drops them, and BDC into
 * BOC / 8DC / BDG. The shape still decides: company code, digits,
 * letters (vendor or plant code), digits.
 */
function findLooseReferences(text, opts = {}) {
  const codes = (opts.companyCodes && opts.companyCodes.length ? opts.companyCodes : ["BDC"]).map((c) => String(c).toUpperCase());
  const vendorCodes = new Set((opts.vendorCodes || []).map((c) => String(c).toUpperCase()));
  const plantCodes = new Set(["REW", "GKD", ...(opts.plantCodes || []).map((c) => String(c).toUpperCase())]);
  const up = String(text || "").toUpperCase();
  const out = [];
  const SEP = "\\s{0,2}[\\/\\\\|Il1!\\]\\[]?\\s{0,2}";
  for (const cc of codes) {
    if (cc.length < 2) continue;
    // Each letter of the code may be its look-alike.
    const look = { B: "[B8]", D: "[D0O]", C: "[CG(]", O: "[O0D]", I: "[I1l|]", S: "[S5]", Z: "[Z2]", G: "[G6C]" };
    const ccRe = [...cc].map((ch) => look[ch] || ch).join("");
    const re = new RegExp(`${ccRe}${SEP}([0-9OQSIlZB]{1,6})${SEP}([A-Z0-9]{2,6}?)${SEP}([0-9OQSIlZB]{1,6})(?![0-9])`, "g");
    let m;
    while ((m = re.exec(up))) {
      let [, n1, code, n2] = m;
      // Each number must contain at least one character read AS a digit;
      // otherwise "IBS/30" can be bent into code "IB" + number "S".
      if (!/[0-9]/.test(n1) || !/[0-9]/.test(n2)) continue;
      const toNum = (x) => [...x].map((c) => digit(c) || c).join("");
      n1 = toNum(n1); n2 = toNum(n2);
      if (!/^\d+$/.test(n1) || !/^\d+$/.test(n2)) continue;
      // The code: letters only; a leading 1/I is usually the slash.
      let vc = [...code].map((c) => letter(c) || c).join("");
      if (!/^[A-Z]{2,5}$/.test(vc)) continue;
      // "BDC1912" — a slash read as 1 glued to our number. Strip it when
      // the remainder is our document number (if we know it).
      if (opts.ourDocNo) {
        const core = String(opts.ourDocNo).match(/(\d+)\s*$/);
        const ours = core ? core[1].replace(/^0+(?=\d)/, "") : null;
        if (ours && n1 !== ours && n1.length === ours.length + 1 && /^[17]/.test(n1) && n1.slice(1) === ours) n1 = ours;
      }
      // Prefer a known vendor/plant code within one character.
      const known = [...vendorCodes, ...plantCodes];
      if (!known.includes(vc)) {
        const near = known.map((k) => ({ k, d: editDistance(k, vc) })).filter((x) => x.d <= 1 && x.k.length === vc.length).sort((a, b) => a.d - b.d);
        if (near.length === 1 || (near.length > 1 && near[0].d < near[1].d)) vc = near[0].k;
        // Trailing I/L was the slash: "AATI" → AAT
        else if (/[IL]$/.test(vc) && known.includes(vc.slice(0, -1))) vc = vc.slice(0, -1);
      }
      // Too little to trust: a two-letter code nobody registered, or a
      // one-digit document number, is noise that happens to fit.
      if (!known.includes(vc) && vc.length < 3) continue;
      if (n1.replace(/^0+/, "").length < 2) continue;
      const canonical = `${cc}/${n1.replace(/^0+(?=\d)/, "") || n1}/${vc}/${n2.replace(/^0+(?=\d)/, "") || n2}`;
      out.push({ raw: m[0], index: m.index, canonical, known: known.includes(vc) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Our invoice / challan numbers                                        */
/* ------------------------------------------------------------------ */

/**
 * BI26-27-HR0912 read as "B126-27-HRO912", "126.27-4RO912", "BI 26-27 HR 0912".
 * The financial-year pair (consecutive years) and the 2-letter state are
 * the anchor; the B/I prefix may be lost entirely.
 */
function findOurInvoiceNumbers(text) {
  const up = String(text || "").toUpperCase();
  const out = [];
  const re = /(?:B?[I1L|!]\s?|B\s?)?([2-3][0-9OSIl])\s?[-.,_~\/]\s?([2-3][0-9OSIl])\s?[-.,_~\/]?\s?([A-Z0-9]{2})\s?([0-9OQSIlZB]{3,5})(?![0-9A-Z])/g;
  let m;
  while ((m = re.exec(up))) {
    const y1 = [...m[1]].map((c) => digit(c) || c).join("");
    const y2 = [...m[2]].map((c) => digit(c) || c).join("");
    if (Number(y2) !== Number(y1) + 1) continue; // must be a financial year
    let st = [...m[3]].map((c) => letter(c) || c).join("");
    // 4R → HR, MN → MH: only the states we bill from.
    const states = ["HR", "MH", "PB", "RJ", "UP", "DL", "GJ", "MP"];
    if (!states.includes(st)) {
      const near = states.find((s) => editDistance(s, st) <= 1 && (s[1] === st[1] || s[0] === st[0]));
      if (!near) continue;
      st = near;
    }
    const num = [...m[4]].map((c) => digit(c) || c).join("");
    if (!/^\d{3,5}$/.test(num)) continue;
    // Without the "BI" in front, insist on an invoice label nearby.
    const hasPrefix = /^B/.test(m[0]);
    if (!hasPrefix && !/INVOICE|INV\.?\s*NO|NA\b|NO\./.test(up.slice(Math.max(0, m.index - 40), m.index))) continue;
    out.push({ raw: m[0], index: m.index, value: `BI${y1}-${y2}-${st}${num}` });
  }
  // Delivery notes: BIPL/2026-27/913 — "BIPL/2026-271913" (slash read as 1).
  const dn = /B[I1L|]PL\s?[\/\\|Il1]?\s?(20\d{2})\s?[-.]\s?(\d{2})\s?[\/\\|Il1!]?\s?([0-9OQSIl]{1,5})(?![0-9])/g;
  while ((m = dn.exec(up))) {
    const fy2 = Number(m[2]);
    if (fy2 !== (Number(m[1]) + 1) % 100) continue;
    const num = [...m[3]].map((c) => digit(c) || c).join("");
    out.push({ raw: m[0], index: m.index, value: `BIPL/${m[1]}-${m[2]}/${num.replace(/^0+(?=\d)/, "")}` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vehicle numbers                                                      */
/* ------------------------------------------------------------------ */

const STATE_CODES = ["AN","AP","AR","AS","BR","CG","CH","DD","DL","DN","GA","GJ","HP","HR","JH","JK","KA","KL","LA","LD","MH","ML","MN","MP","MZ","NL","OD","OR","PB","PY","RJ","SK","TN","TR","TS","UK","UP","WB"];

/** HRSSAB1I234 → HR55AB1234; "HR 55 AB 1234" → HR55AB1234. */
function findVehicles(text) {
  const up = String(text || "").toUpperCase();
  const out = [];
  const re = /(^|[^A-Z0-9])([A-Z]{2})\s?([0-9OQSIlZBG]{2})\s?([A-Z0-9]{1,3}?)\s?([0-9OQSIlZBG]{4})(?![0-9A-Z])/g;
  let m;
  while ((m = re.exec(up))) {
    const st = m[2];
    if (!STATE_CODES.includes(st)) continue;
    const rto = [...m[3]].map((c) => digit(c) || c).join("");
    const series = [...m[4]].map((c) => letter(c) || c).join("");
    const num = [...m[5]].map((c) => digit(c) || c).join("");
    if (!/^\d{2}$/.test(rto) || !/^[A-Z]{1,3}$/.test(series) || !/^\d{4}$/.test(num)) continue;
    if (rto === "00") continue;
    // Most of the digits must have been read AS digits — a word like
    // "HRSSABOOKS" is not a plate. Next to a "Vehicle No" label one
    // more look-alike is forgiven.
    const labelled = /(?:veh\w*|v\w{2,4}c\w{0,3}e|truck|lorry|gaadi|gadi|v\.?\s*no|motor|m\w{2}or)[^\n]{0,30}$/i.test(up.slice(Math.max(0, m.index - 40), m.index + m[1].length));
    const realDigits = (m[3] + m[5]).replace(/[^0-9]/g, "").length;
    const seriesSubs = [...m[4]].filter((c) => /[0-9]/.test(c)).length;
    if (realDigits < (labelled ? 3 : 5) || seriesSubs > (labelled ? 1 : 0)) continue;
    out.push({ raw: m[0].slice(m[1].length), index: m.index + m[1].length, value: `${st}${rto}${series}${num}` });
  }
  return out;
}

/**
 * Rewrite the noisy identifiers in place; returns { text, repairs }.
 * @param {string} text
 * @param {object} opts { companyCodes, vendorCodes, plantCodes, knownGstins }
 */
function repairText(text, opts = {}) {
  let src = String(text || "");
  const repairs = [];
  const edits = [];
  for (const g of findGstins(src, opts.knownGstins || [])) {
    if (g.raw.replace(/ /g, "") !== g.value) { edits.push({ index: g.index, len: g.raw.length, value: g.value }); repairs.push({ field: "GSTIN", from: g.raw, to: g.value, how: g.how }); }
  }
  const ours = findOurInvoiceNumbers(src);
  for (const o of ours) {
    if (o.raw.replace(/\s/g, "") !== o.value) { edits.push({ index: o.index, len: o.raw.length, value: o.value }); repairs.push({ field: "Our document no.", from: o.raw.trim(), to: o.value }); }
  }
  const ourDocNo = ours[0] ? ours[0].value : null;
  const oursCore = ourDocNo ? (ourDocNo.match(/(\d+)$/) || [])[1] : null;
  // A reference the exact parser already reads cleanly is never "repaired".
  let strict = [];
  try {
    strict = require("./reference").findReferences(src, { companyCodes: opts.companyCodes, vendorCodes: opts.vendorCodes, plantCodes: opts.plantCodes });
  } catch {
    strict = [];
  }
  const strictClean = strict.filter((r) => /^[A-Z]{2,5}$/.test(r.vendorCode) && /^\d+$/.test(r.biomeDocNo) && /^\d+$/.test(r.vendorDocNo));
  for (const r of strictClean.length ? [] : findLooseReferences(src, { ...opts, ourDocNo })) {
    // Our own number is printed on the same page: a "reference" whose
    // second segment is a different number is noise, not a repair.
    if (oursCore && r.canonical.split("/")[1] !== oursCore.replace(/^0+(?=\d)/, "") &&
        editDistance(r.canonical.split("/")[1], oursCore.replace(/^0+(?=\d)/, "")) > 1) continue;
    if (r.raw.replace(/\s/g, "") !== r.canonical) { edits.push({ index: r.index, len: r.raw.length, value: ` ${r.canonical} ` }); repairs.push({ field: "Reference", from: r.raw.trim(), to: r.canonical }); }
  }
  for (const v of findVehicles(src)) {
    if (v.raw.replace(/\s/g, "") !== v.value) { edits.push({ index: v.index, len: v.raw.length, value: v.value }); repairs.push({ field: "Vehicle", from: v.raw.trim(), to: v.value }); }
  }
  // Apply right-to-left, skipping overlaps (first found wins).
  edits.sort((a, b) => a.index - b.index);
  const kept = [];
  let end = -1;
  for (const e of edits) { if (e.index >= end) { kept.push(e); end = e.index + e.len; } }
  for (const e of kept.reverse()) src = src.slice(0, e.index) + e.value + src.slice(e.index + e.len);
  return { text: src, repairs };
}

module.exports = { repairText, findGstins, findLooseReferences, findOurInvoiceNumbers, findVehicles, coerceGstin, gstinValid, gstinCheckChar };
