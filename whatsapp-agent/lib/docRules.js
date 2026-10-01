/**
 * Biome Platform — WhatsApp Agent / document type rules
 * -------------------------------------------------------------------
 * Deterministic, evidence-ordered typing — built from the company's OWN
 * documents (the samples embedded in the filing SOP), not from guesses.
 *
 * Why this exists: keyword scoring kept losing exactly where it matters.
 * Two real failures this file is the answer to:
 *
 *   1. OUR tax invoice and delivery note PRINT an "e-Way Bill No"
 *      column on their own page. "e-way bill" (weight 3) outscored
 *      "delivery note" (weight 2), so our challans filed as e-way
 *      bills. The fix is ORDER, not weights: what the document says it
 *      IS at the top of the page decides, and a standalone e-way bill
 *      is only recognised by the e-way PRINTOUT's own structure
 *      ("E-WAY BILL Details" + "Valid Upto"), never by the phrase
 *      appearing as a column label.
 *
 *   2. The real consignment tag says "Tag for Consignment"
 *      (Annexure-II) — not "consignment tag" — so it never matched and
 *      fell through to the sparse-text weight-slip guess. And its
 *      FILENAME said "Consignment tag" the whole time; filenames are
 *      written by the coordinator and are evidence, not decoration.
 *
 * Order of authority (first confident answer wins):
 *   1. Page structure — what the document's own header/format proves.
 *   2. Filename — what the coordinator called it.
 *   3. (Caller falls back to the fuzzy classifier only below these.)
 */

const OUR_GSTIN = "06AAJCB1927H1ZS";
const BIOME_RE = /biome\s*industria/i;

function norm(s) {
  return String(s || "")
    // Soft hyphens and unicode dashes: the real e-way printout reads
    // "e\u00adWay Bill" — invisible on screen, fatal to a regex.
    .replace(/[\u00ad\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The top of the page is where a document announces itself. */
function head(text, n = 700) {
  return norm(text).slice(0, n).toLowerCase();
}

/** Sided type from who issued it. */
function side(issuedByUs, biomeType, vendorType) {
  return issuedByUs ? biomeType : vendorType;
}

/**
 * Did WE issue this page? GSTIN on the letterhead decides; the buyer
 * block ("Billed to: BIOME...") explicitly does NOT make it ours.
 */
/**
 * Our PAN — the middle ten characters of every Biome GSTIN, whichever
 * state the registration is in (06… Haryana, 27… Maharashtra).
 *
 * Comparing the whole GSTIN to "06AAJCB1927H1ZS" letter-for-letter made
 * OUR OWN invoice read as a vendor's whenever OCR slipped one character
 * ("…H1Z5", "O6AAJ…"), the GSTIN line was cropped off the photo, or the
 * Gangakhed registration was printed — the consignee's GSTIN was then the
 * "first GSTIN", the invoice was typed vendor_tax_invoice, it was HELD in
 * staging waiting for "our invoice", and the whole supply set never formed.
 */
const OUR_PAN = OUR_GSTIN.slice(2, 12);

/** Fold OCR look-alikes together so a misread character still compares equal. */
function foldOcr(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/O|Q|D/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6");
}

/** True for any GSTIN-shaped token that carries our PAN (tolerant of OCR slips). */
function isOurGstin(token) {
  const t = String(token || "").toUpperCase().replace(/\s/g, "");
  return t.length === 15 && foldOcr(t.slice(2, 12)) === foldOcr(OUR_PAN);
}

/**
 * Where our GSTIN and the first OTHER GSTIN sit on the page (-1 = absent).
 */
function gstinPositions(text) {
  const up = String(text || "").toUpperCase();
  let ourPos = -1;
  let foreignPos = -1;
  const re = /\b[0-9A-Z]{15}\b/g;
  let m;
  while ((m = re.exec(up))) {
    const tok = m[0];
    if (isOurGstin(tok)) {
      if (ourPos === -1) ourPos = m.index;
      continue;
    }
    // OCR swaps O and 0 freely inside GSTINs; normalise candidates before
    // judging them (a real vendor GSTIN arrived as "03ABDFGO879P1Z1").
    const fixed = tok.replace(/^(..)/, (x) => x.replace(/O/g, "0")).replace(/^(.{7})(.{4})/, (x, a, b) => a + b.replace(/O/g, "0"));
    if (foreignPos === -1 && /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(fixed)) foreignPos = m.index;
  }
  return { ourPos, foreignPos };
}

const AS_BUYER_RE = /(?:billed\s*to|bill\s*to|buyer|shipped\s*to|consignee|recipient)\s*:?[\s\S]{0,200}?biome\s*industria/i;

function issuerIsUs(text) {
  const { ourPos, foreignPos } = gstinPositions(text);
  // Our GSTIN printed before anyone else's: our letterhead.
  if (ourPos !== -1 && (foreignPos === -1 || ourPos < foreignPos)) return true;
  // Someone else's GSTIN first and ours further down: we are the buyer.
  if (ourPos !== -1) return false;

  // Our GSTIN not legible (photo/scan, cropped). Fall back to the
  // letterhead: Biome at the very top of page one, before any other
  // party's GSTIN, and not in a buyer block.
  const t = String(text || "");
  const i = t.search(BIOME_RE);
  if (i === -1) return false;
  if (foreignPos !== -1 && i > foreignPos) return false;
  // Is the FIRST Biome mention inside a buyer block ("Billed to: Biome…")?
  const asBuyer = AS_BUYER_RE.test(norm(t.slice(Math.max(0, i - 200), i + 20)));
  // "Letterhead" means the very top of page one, not the top third of a
  // merged multi-page blob — that read a vendor invoice as ours.
  return i < 300 && !asBuyer;
}

/* ------------------------------------------------------------------ */
/* 1. Structure rules — the page proves what it is                     */
/* ------------------------------------------------------------------ */

function byStructure(text, knownClients = [], knownVendors = []) {
  if (!text || norm(text).length < 8) return null;
  // "The header" is the very top of page one — the strip where a
  // document announces itself. On merged PDFs (a challan with the
  // consignment tag stapled behind it) only THIS strip may decide,
  // or the later pages hijack the type of the whole file.
  const strip = head(text, 150);
  const h = head(text);
  const full = norm(text).toLowerCase();
  const us = issuerIsUs(text);

  // --- E-way bill printout: its own structure, announced up top.
  // Checked FIRST because the printout also lists "Tax Invoice" as a
  // sub-field under Document Details — header position beats that.
  const ewayStructure =
    /e[\s\-.]*way\s*bill\s*details/.test(full) ||
    (/eway\s*bill\s*no\s*[:.]?\s*\d/.test(full) && /valid\s*upto/.test(full));
  if (ewayStructure && /e[\s\-.]*way\s*bill/.test(strip) && !/tax\s*invo[il]ce|delivery\s*(?:note|challan)/.test(strip)) {
    return {
      documentType: side(us, "biome_eway_bill", "vendor_eway_bill"),
      confidence: 96,
      reason: "e-way bill printout structure (E-WAY BILL Details / Valid Upto)",
    };
  }

  // --- Tax invoice: announced in the header strip. Tolerates the
  // classic OCR slip "TAX INVOLCE" seen on a real vendor invoice.
  if (/tax\s*invo[il]ce/.test(strip)) {
    return {
      documentType: side(us, "biome_tax_invoice", "vendor_tax_invoice"),
      confidence: 96,
      reason: "header says TAX INVOICE",
    };
  }

  // --- Delivery note / challan: announced in the header strip. Fires
  // before any e-way keyword can — our delivery notes print an
  // "e-Way Bill No" column and are still delivery notes.
  if (/delivery\s*(?:note|challan)/.test(strip) || /vehicle\s*challan/.test(strip)) {
    return {
      documentType: side(us, "biome_delivery_challan", "vendor_delivery_challan"),
      confidence: 96,
      reason: "header says DELIVERY NOTE/CHALLAN",
    };
  }

  // Header said invoice/challan further down than the strip? Still an
  // announcement if it lands in the first 700 chars and nothing above
  // claimed the page.
  if (/tax\s*invo[il]ce/.test(h)) {
    return { documentType: side(us, "biome_tax_invoice", "vendor_tax_invoice"), confidence: 94, reason: "TAX INVOICE near the top" };
  }
  if (/delivery\s*(?:note|challan)/.test(h)) {
    return { documentType: side(us, "biome_delivery_challan", "vendor_delivery_challan"), confidence: 94, reason: "DELIVERY NOTE/CHALLAN near the top" };
  }

  // --- Consignment tag: "Tag for Consignment" / Annexure wording.
  // Learned from the real tag: "Annexure-II | Tag for Consignment |
  // (To be tagged along with each consignment ...)". Below the header
  // rules on purpose: a tag stapled behind a challan must not rename
  // the challan.
  if (
    /tag\s*for\s*consignment/.test(full) ||
    /consignment\s*tag/.test(full) ||
    (/annexure/.test(h) && /consignment/.test(full))
  ) {
    return { documentType: "consignment_tag", confidence: 95, reason: "page says Tag for Consignment" };
  }

  // --- Bilty / LR: the transporter's consignment note.
  if (/\b(?:bilty|bilti|builty)\b/.test(full) || /बिल्टी|बिलटी|ट्रांसपोर्ट/.test(full) ||
      /lorry\s*receipt|goods\s*consignment\s*note|consignment\s*note/.test(full) ||
      /\b(?:l\.?r\.?|g\.?r\.?)\s*no\b/.test(full)) {
    return { documentType: "bilty_lr", confidence: 92, reason: "bilty / lorry receipt wording" };
  }

  // --- Lab report / analysis.
  if (/laborator|test\s*report|analysis\s*(?:report|of)|certificate\s*of\s*analysis/.test(full) &&
      /moisture|ash|gcv|calorific|volatile|sample/.test(full)) {
    return { documentType: "lab_report", confidence: 90, reason: "laboratory analysis wording" };
  }

  // --- Weighbridge slip: sparse print with the loaded/empty/nett trio.
  // Real sample: "Approved By Haryana ... Qntl. Kg. | Loaded | Empty |
  // Nett Weight".
  //
  // LOADING slip vs client RECEIVING — the confusion the business named.
  // Both are weighbridge prints. What separates them is WHOSE kanta:
  //   receiving → the client's gate: the client's name/site on the slip,
  //                "unloading / inward / gate entry / GRN / MRN / receipt"
  //   weight slip → the vendor's or our plant's kanta: vendor/plant name,
  //                "loading / dispatch / outward"
  // Hindi vocabulary from real dharam-kanta slips: कांटा/काटा (kanta),
  // वजन (weight), गाड़ी (vehicle), खाली गाड़ी (tare), वजन मय गाड़ी (gross),
  // वजन पक्का (net), टन (ton), क्विंटल (quintal).
  const weighWords = ["loaded", "empty", "nett weight", "net weight", "gross", "tare", "weighbridge", "weigh bridge", "kanta", "dharam kanta", "qntl", "weighment",
    "कांटा", "काटा", "कॉटा", "वजन", "गाड़ी", "गाडी", "खाली", "पक्का", "क्विंटल", "टन", "धर्म"];
  const weighHits = weighWords.filter((w) => full.includes(w)).length;
  if (weighHits >= 2 && full.length < 2200 && !/invoice|challan|e[\s-]*way/.test(h)) {
    const clientHit = (knownClients || []).find((c) => c && full.includes(c));
    const vendorHit = (knownVendors || []).find((v) => v && v.length > 3 && full.includes(v));
    const inward = /unload|inward|gate\s*entry|gate\s*pass|grn|mrn|receipt|received|receiving|material\s*receipt|उतराई|प्राप्ति/.test(full);
    const outward = /loading|dispatch|outward|loaded\s*at|gross\s*at\s*loading|लोडिंग|भराई|रवाना/.test(full);
    if ((clientHit && !vendorHit) || (inward && !outward)) {
      return { documentType: "receiving", confidence: 90, reason: clientHit ? `client's weighbridge (${clientHit})` : "inward/unloading wording" };
    }
    return { documentType: "weight_slip", confidence: 88, reason: vendorHit ? `loading weighbridge (${vendorHit})` : "weighbridge slip wording (loaded/empty/nett)" };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Filename rules — what the coordinator called it                  */
/* ------------------------------------------------------------------ */

const NAME_RULES = [
  // Most specific first.
  { re: /consignment\s*tag|consignmenttag/i, type: "consignment_tag" },
  { re: /delivery\s*(?:note|challan)|delivery[\s_-]*note|\bDN\b|BIPL[\/_-]?\d{4}/i, type: "biome_delivery_challan" },
  { re: /e[\s\-._]*way|ewb/i, type: "vendor_eway_bill", sideBy: "name" },
  { re: /tax\s*invoice/i, type: "vendor_tax_invoice", sideBy: "name" },
  // "BILL NO 53.pdf" — in this business that is the bilty (Bill T),
  // not a lab bill and not an invoice.
  { re: /\bbill\s*(?:t|no)\b|bilty|bilti|builty|\blr\b|lorry/i, type: "bilty_lr" },
  { re: /weigh(?:ment|t)?\s*slip|weighment|weightslip|kanta|tulai/i, type: "weight_slip" },
  { re: /lab|test\s*report|analysis|coa\b/i, type: "lab_report" },
  { re: /receiv|grn|unload/i, type: "receiving" },
  { re: /invoice|\binv\b/i, type: "vendor_tax_invoice", sideBy: "name" },
];

function byFileName(fileName) {
  const name = String(fileName || "");
  if (!name) return null;
  for (const r of NAME_RULES) {
    if (!r.re.test(name)) continue;
    let type = r.type;
    // A filename carrying our own marks (BIPL / Biome / BDC) sides the
    // document with us where the type is sided.
    if (r.sideBy === "name" && /bipl|biome|bdc/i.test(name)) {
      type = type.replace(/^vendor_/, "biome_");
    }
    return { documentType: type, confidence: 90, reason: `filename says so ("${name}")` };
  }
  return null;
}

/**
 * The one entry point. Structure first, filename second; when both
 * speak, structure wins UNLESS the page text was too thin to trust
 * (photos of paper often OCR to almost nothing — the filename is then
 * the best evidence in the room).
 *
 * @returns {{documentType, confidence, reason}|null}
 */
function decideType({ text, fileName, clients, vendors }) {
  const knownClients = (clients || []).flatMap((c) => (typeof c === "string" ? [c] : [c?.name, c?.shortName, ...(c?.aliases || [])])).filter(Boolean).map((x) => String(x).toLowerCase()).filter((x) => x.length > 3);
  const knownVendors = (vendors || []).map((v) => (typeof v === "string" ? v : v?.name)).filter(Boolean).map((x) => String(x).toLowerCase());
  const s = byStructure(text, knownClients, knownVendors);
  const f = byFileName(fileName);
  const textLen = norm(text).length;

  if (s && f && s.documentType !== f.documentType) {
    // Thin text (a bad scan) can produce a wrong structural hit; a
    // coordinator's filename is the stronger witness there.
    return textLen < 120 ? { ...f, reason: `${f.reason}; page text too thin to overrule` } : s;
  }
  return s || f || null;
}

module.exports = { decideType, byStructure, byFileName, issuerIsUs, isOurGstin, gstinPositions };
