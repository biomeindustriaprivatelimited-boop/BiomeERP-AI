/**
 * Biome Platform — Offline document understanding
 * -------------------------------------------------------------------
 * Turns OCR text into structured fields WITHOUT any cloud API.
 *
 * HOW THIS COMPARES TO GEMINI, HONESTLY
 * A cloud vision model reads an unfamiliar document and reasons about
 * it. This can't do that, and pretending otherwise would waste your
 * time. What it does instead is exploit something the cloud model can't:
 * it knows YOUR documents. Biome invoices look like BI26-27-HR0786.
 * Delivery notes look like BIPL/2026-27/884. References look like
 * BDC/786/MHI/44. Vehicle numbers, GSTINs, e-way bills and weighbridge
 * slips all have fixed shapes.
 *
 * For paperwork that repeats — which is nearly all of yours — pattern
 * matching over good OCR is accurate and instant, and it runs with the
 * network unplugged. For a document it has never seen, it says so with a
 * low confidence rather than inventing an answer.
 *
 * Three tiers, in order:
 *   1. these rules            always, free, offline
 *   2. a local LLM (Ollama)   if installed, for the ones rules miss
 *   3. a cloud API            only if you have explicitly configured one
 *
 * CommonJS on purpose: the WhatsApp agent (plain Node) and the Next.js
 * API routes both load this same file, so there is one engine and one
 * set of rules to maintain.
 */

const { findReferences } = require("./reference");

// ---------------------------------------------------------------------
// Patterns — every one of these is a shape, not a guess
// ---------------------------------------------------------------------

/** 15 characters: 2-digit state, 10-char PAN, entity digit, Z, checksum. */
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;

/** Indian vehicle plates: HR26DK8337, UP22AT1505, RJ29GC7686, and the
 *  older 2-letter series. OCR often drops the spaces, so spaces are
 *  optional throughout. */
const VEHICLE_RE = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{3,4})\b/g;

/** E-way bills are always 12 digits, usually printed in groups of four. */
const EWAY_RE = /\b(\d{4}\s?\d{4}\s?\d{4})\b/g;

/** 10-digit Indian mobile, optionally +91 prefixed. */
const MOBILE_RE = /(?:\+?91[\s-]?)?\b([6-9]\d{9})\b/g;

const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

/** Biome's own invoice and challan numbering. */
const BIOME_INVOICE_RE = /\b(BI[\s\-\/]?\d{2}[\s\-\/]?\d{2}[\s\-\/]?[A-Z]{2}\d{3,5})\b/gi;
const BIOME_CHALLAN_RE = /\b(BIPL\s?[\/\-]\s?\d{4}\s?-?\s?\d{2,4}\s?[\/\-]\s?\d{1,6})\b/gi;

/** Dates as they actually appear: 29-Jul-26, 29/07/2026, 2026-07-29. */
const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function findDates(text) {
  const out = [];
  const named = /\b(\d{1,2})\s?[-\/\s]\s?([A-Za-z]{3,9})\s?[-\/\s]\s?(\d{2,4})\b/g;
  let m;
  while ((m = named.exec(text))) {
    const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mm) continue;
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    out.push(`${yy}-${mm}-${m[1].padStart(2, "0")}`);
  }
  const numeric = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/g;
  while ((m = numeric.exec(text))) {
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    out.push(`${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(text))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  return [...new Set(out)];
}

/** Indian money: 1,18,000.00 / ₹ 59,000 / 1180.50 */
/**
 * Money, not every large number on the page.
 *
 * A CIN like U23200DL2020PTC368121 and a PIN code both used to read as
 * amounts, and the biggest one won — so an invoice for ₹1,18,000 showed
 * ₹3,68,121. Two rules fix it: a number glued to letters is an
 * identifier, not money; and a number sitting next to a money label is
 * trusted far above a bare one.
 */
function findAmounts(text) {
  const labelled = [];
  const bare = [];

  const LABEL = /(?:total|amount|grand\s*total|taxable\s*value|net\s*(?:amount|payable)|invoice\s*value|₹|rs\.?|inr)\s*[:.\-]?\s*((?:\d{1,3}(?:,\d{2,3})+|\d{3,9})(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = LABEL.exec(text))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 100) labelled.push(n);
  }

  const ANY = /(?:^|[^A-Za-z0-9])((?:\d{1,3}(?:,\d{2,3})+)(?:\.\d{1,2})?)(?=$|[^A-Za-z0-9])/g;
  while ((m = ANY.exec(text))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 100) bare.push(n);
  }

  // Comma-grouped bare numbers are written the way money is written, so
  // they're a reasonable fallback. Unformatted digit runs are not.
  return labelled.length ? labelled : bare;
}

// ---------------------------------------------------------------------
// Document type: keyword scoring, with issuer detection
// ---------------------------------------------------------------------

const TYPE_RULES = [
  // Hindi terms appear on almost every weighbridge slip and bilty in
  // this trade. Tesseract with the English pack mangles Devanagari, but
  // these are matched anyway for the cases where Hindi OCR is installed
  // or the form is bilingual — which most of them are.
  // A receiving is the CLIENT's weighbridge slip, taken when the truck
  // unloads at their plant. Its weight is the one that settles the
  // final invoice, so it is a different document from our own or the
  // vendor's weight slip and must not be confused with either.
  // Wording taken from the clients' actual slips. Jhajjar prints
  // "Weighment Slip - Supplier" with a supplier code and a pass date;
  // nothing on it says "receiving" at all, which is why a guessed
  // vocabulary would never have matched.
  { type: "receiving", any: [
      "weighment slip", "weighment details", "nett weight", "pass date",
      "supplier code", "supplier name", "product code", "destination code",
      "time in", "time out", "trans code", "trans name",
      "receiving", "received quantity", "unloading slip", "gate entry weight",
      "receipt weight", "unload weight", "net received", "material received",
      "grn", "goods receipt",
    ], weight: 4 },

  // A lab report is the client's own test of the material.
  // From NTPC Vindhyanchal's real report: a biomass laboratory heading,
  // a sample-collection date, and a Sample ID / Vehicle no. table.
  { type: "lab_report", any: [
      "biomass laboratory", "coal & biomass laboratory", "analysis of biomass",
      "date of collection samples", "date of analysis", "sample drawn by laboratory",
      "sample collection witnessed", "analytical results", "sample id",
      "lab report", "laboratory report", "test report", "analysis report",
      "gcv", "ncv", "gross calorific", "proximate analysis", "moisture",
      "ash%", "ash content", "total fines", "volatile matter", "fixed carbon",
    ], weight: 4 },

  { type: "weight_slip", any: [
      "weighbridge", "weigh bridge", "gross weight", "tare weight", "net weight",
      "gross wt", "tare wt", "weighment", "dharam kanta", "dharm kanta",
      "धर्म कांटा", "वजन", "कुल वजन", "खाली गाड़ी", "qntl", "quintal",
    ], weight: 3 },
  { type: "bilty_lr", any: [
      "bilty", "lorry receipt", "l.r. no", "lr no", "goods consignment note",
      "transport receipt", "consignment note", "बिल्टी", "माल भेजने वाला",
      "माल पाने वाला", "commission bases", "transport co", "trading company",
    ], weight: 3 },
  { type: "consignment_tag", any: ["consignment tag", "gate pass", "gate entry", "gate tag"], weight: 3 },
  { type: "fast_tag", any: ["fastag", "fast tag", "toll plaza", "tag id", "npci"], weight: 3 },
  { type: "coa", any: ["certificate of analysis", "gross calorific", "gcv", "ncv", "proximate analysis", "moisture %", "ash content", "lab report", "test report"], weight: 3 },
  { type: "eway_bill", any: ["e-way bill", "eway bill", "e way bill", "ewaybill"], weight: 3 },
  { type: "debit_note", any: ["debit note", "dn-bi-", "debit memo"], weight: 3 },
  { type: "credit_note", any: ["credit note", "cn-bi-", "credit memo"], weight: 3 },
  { type: "tax_invoice", any: ["tax invoice"], weight: 2 },
  { type: "delivery_challan", any: ["delivery challan", "delivery note", "vehicle challan"], weight: 2 },
];

const BIOME_MARKERS = ["biome industria", "06aajcb1927h1zs", "u23200dl2020ptc368121", "biomeindustria@gmail.com"];

/**
 * Decide the document type and who issued it.
 *
 * The issuer matters more than the words: a tax invoice with Biome on the
 * letterhead is ours; the same words with Biome as "Billed to" is the
 * vendor's. That distinction decides which folder it lands in, so it is
 * worked out from position, not vocabulary.
 */
function classifyFromText(text) {
  const lower = text.toLowerCase();
  const scores = new Map();

  for (const rule of TYPE_RULES) {
    for (const kw of rule.any) {
      if (lower.includes(kw)) {
        scores.set(rule.type, (scores.get(rule.type) || 0) + rule.weight);
      }
    }
  }

  // The TITLE decides, not the vocabulary. Every tax invoice also prints
  // "E-Way Bill No." somewhere, which used to make invoices classify as
  // e-way bills. A phrase in the opening lines is the document's name;
  // the same phrase further down is just a field label.
  // The TITLE decides, not the vocabulary. Every tax invoice also prints
  // "E-Way Bill No." near the top, so position alone isn't enough — a
  // phrase followed by "No.", "Number" or ":" is a FIELD LABEL, never the
  // document's name. That one distinction is what separates an invoice
  // from an e-way bill.
  const head = lower.slice(0, 300);
  const FIELD_LABEL_AFTER = /^\s*(?:no\b|number\b|#|:)/;

  const TITLES = [
    [/\btax\s*invoice\b/g, "tax_invoice"],
    [/\bdelivery\s*(?:challan|note)\b/g, "delivery_challan"],
    [/\bvehicle\s*challan\b/g, "delivery_challan"],
    [/\be[\s\-]?way\s*bill\b/g, "eway_bill"],
    [/\bweighbridge\b|\bweight\s*slip\b/g, "weight_slip"],
    [/\bcertificate\s+of\s+analysis\b/g, "coa"],
    [/\breceiv(?:ing|ed)\s*(?:slip|weight|report)?\b/g, "receiving"],
    [/\b(?:lab|laboratory|test)\s*report\b/g, "lab_report"],
    [/\bdebit\s*note\b/g, "debit_note"],
    [/\bcredit\s*note\b/g, "credit_note"],
    [/\bbilty\b|\blorry\s*receipt\b|\bconsignment\s*note\b/g, "bilty_lr"],
  ];

  for (const [re, type] of TITLES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(head))) {
      const after = head.slice(m.index + m[0].length);
      if (FIELD_LABEL_AFTER.test(after)) continue; // it's a field, skip it
      scores.set(type, (scores.get(type) || 0) + 8);
      break; // one title credit per type
    }
  }

  // ---- The GSTIN decides, not where a name appears ----
  //
  // Guessing from position ("Biome near the top means our letterhead")
  // is fragile: on a vendor invoice our name also appears under
  // "Billed to", and on a merged PDF it appears on every page. A real
  // vendor invoice was being read as ours because of it, which then made
  // the reference look missing — it was never going to be on their paper.
  //
  // The issuer's GSTIN is printed on the letterhead, so it comes FIRST.
  // If that first GSTIN is ours, the document is ours. If it belongs to
  // someone else, it is theirs. That is a fact on the page, not an
  // inference from layout.
  const OUR_GSTIN_CODE = "06AAJCB1927H1ZS";
  const gstinsInOrder = String(text.toUpperCase().match(GSTIN_RE) || []);
  const firstGstin = (text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/) || [])[0] || null;
  const gstinSaysOurs = firstGstin === OUR_GSTIN_CODE;
  const gstinSaysTheirs = Boolean(firstGstin) && firstGstin !== OUR_GSTIN_CODE;

  // Where does Biome appear? Near the top = letterhead = ours.
  const firstBiome = Math.min(
    ...BIOME_MARKERS.map((m) => {
      const i = lower.indexOf(m);
      return i === -1 ? Infinity : i;
    })
  );
  const biomePresent = Number.isFinite(firstBiome);
  const topThird = text.length ? firstBiome < text.length * 0.33 : false;

  // "Billed to Biome" / "Buyer: Biome" means the vendor issued it.
  const biomeIsBuyer =
    /(?:billed\s*to|bill\s*to|buyer|shipped\s*to|consignee)[^\n]{0,120}biome\s*industria/i.test(text);

  // "Billed to :" and the name often land on separate lines, because
  // pdfjs breaks a line whenever the vertical position jumps. A pattern
  // that couldn't cross a newline therefore never matched.
  const biomeIsBuyerMultiline =
    /(?:billed\s*to|bill\s*to|buyer|shipped\s*to|consignee)\s*:?[\s\S]{0,160}?biome\s*industria/i.test(text);

  // GSTIN first, layout only as a tie-breaker.
  const issuedByUs = gstinSaysOurs
    ? true
    : gstinSaysTheirs
      ? false
      : biomePresent && topThird && !biomeIsBuyer && !biomeIsBuyerMultiline;

  let base = null;
  let best = 0;
  for (const [type, score] of scores) {
    if (score > best) {
      best = score;
      base = type;
    }
  }

  // Map the neutral type onto a sided one.
  let documentType = "other";
  // Set when the page's own structure proves the type, which lets a
  // short-text document keep a real confidence score.
  let structurallyConfirmed = false;
  if (base === "tax_invoice") documentType = issuedByUs ? "biome_tax_invoice" : "vendor_tax_invoice";
  else if (base === "delivery_challan") documentType = issuedByUs ? "biome_delivery_challan" : "vendor_delivery_challan";
  else if (base === "eway_bill") documentType = issuedByUs ? "biome_eway_bill" : "vendor_eway_bill";
  else if (base === "receiving") documentType = "receiving";
  else if (base === "lab_report") documentType = "lab_report";
  else if (base === "debit_note") documentType = issuedByUs ? "biome_debit_note" : "vendor_debit_note";
  else if (base === "credit_note") documentType = issuedByUs ? "biome_credit_note" : "vendor_credit_note";
  else if (base) documentType = base;

  // Confidence reflects how much evidence there actually was.
  let confidence = 0;
  if (best >= 6) confidence = 85;
  else if (best >= 3) confidence = 70;
  else if (best >= 2) confidence = 55;
  else confidence = 25;
  if (!biomePresent && ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(documentType)) {
    confidence -= 20;
  }
  // ---- Shape-based fallback for hand-filled Hindi forms ----
  //
  // A weighbridge slip photographed in Hindi yields perhaps 200 English
  // characters of noise. But its SHAPE is unmistakable: three large
  // weights where one is the difference of the other two. That
  // arithmetic is a stronger signal than any keyword, and it survives
  // OCR that mangles every word on the page.
  if (documentType === "other" || confidence < 50) {
    const numbers = (text.match(/\b\d{4,6}\b/g) || []).map(Number).filter((n) => n >= 1000 && n <= 99999);
    const looksLikeWeighing = numbers.some((gross) =>
      numbers.some((tare) =>
        numbers.some((net) => gross > tare && Math.abs(gross - tare - net) <= 20 && net > 500)
      )
    );
    if (looksLikeWeighing) {
      documentType = "weight_slip";
      confidence = Math.max(confidence, 70);
      structurallyConfirmed = true;
    }
  }

  // Short text usually means the OCR failed, so confidence is capped —
  // but not when the structure itself proved what the document is. On a
  // hand-filled Hindi slip the arithmetic is the evidence, and there was
  // never going to be much readable text.
  if (text.length < 120 && !structurallyConfirmed) confidence = Math.min(confidence, 30);

  return { documentType, confidence: Math.max(0, Math.min(100, confidence)), issuedByUs, base };
}

// ---------------------------------------------------------------------
// Party matching against the registries we already have
// ---------------------------------------------------------------------

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchName(text, candidates) {
  const hay = norm(text);
  let best = null;
  let bestLen = 0;
  for (const c of candidates) {
    for (const alias of [c.name, c.shortName, ...(c.aliases || [])].filter(Boolean)) {
      const a = norm(alias);
      if (a.length >= 4 && hay.includes(a) && a.length > bestLen) {
        best = c;
        bestLen = a.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// Weighbridge figures
// ---------------------------------------------------------------------

/**
 * The GR / LR / Bilty number.
 *
 * This is the ONLY thing printed on a bilty — the rest of the form is
 * left blank and filled in by the supervisor after the invoice is
 * raised. Without this field a bilty can never be matched to anything,
 * which is why it kept ending up unmatched.
 *
 * It appears as "GR/RR No. : 242" on a vendor invoice, "Bill of
 * Lading/LR-RR No. 242 dt. 30-Jul-26" on ours, "Doc No. : 242" in the
 * e-way bill's transport section, and as a bare "नं० 242" on the bilty
 * itself.
 */
function findGrNumber(text) {
  const patterns = [
    /\bGR\s*[\/\-]?\s*RR\s*(?:No|Number)?\.?\s*[:\-]?\s*(\d{1,8})/i,
    /\bBill\s+of\s+Lading\s*\/?\s*LR\s*[\-\/]?\s*RR\s*(?:No)?\.?\s*[:\-]?\s*(\d{1,8})/i,
    /\b(?:LR|GR|RR)\s*(?:No|Number)?\.?\s*[:\-\/]?\s*(\d{1,8})\b/i,
    /\bBilty\s*(?:No|Number)?\.?\s*[:\-]?\s*(\d{1,8})/i,
    /\bBooking\s+(?:From|No)?\.?\s*[:\-]?\s*(\d{1,8})/i,
    // The e-way bill's transport block: "Doc No. : 242".
    /\bDoc\s*(?:ument)?\s*No\.?\s*[:\-]\s*(\d{1,6})\b(?![\/\-]\d)/i,
    // Transporters print it as "CONSIGNMENT NOTE NO. 572".
    /\bconsignment\s*note\s*(?:no)?\.?\s*[:\-]?\s*(\d{1,6})\b/i,
    // A bilty's own serial: "नं० 242" or "No. 242" near the top.
    /(?:नं०?|No\.?)\s*[:\-]?\s*(\d{2,6})\b/,
  ];

  // "572 dt. 1-Aug-26" — the LR number sits in its own table cell, with
  // the label in a different row entirely. The value's shape is
  // distinctive enough to match on its own.
  const dated = text.match(/\b(\d{1,6})\s+dt\.?\s*\d{1,2}[-\/][A-Za-z0-9]{3,4}/i);
  if (dated) return dated[1].replace(/^0+(?=\d)/, "");

  // Land-record fields in a vendor's ADDRESS look exactly like a GR
  // number — "Khewat No. 222/206, Khatoni No. 326" was being read as
  // GR 222. Blank them before matching rather than trying to out-guess
  // them afterwards.
  text = text.replace(
    /\b(?:khewat|khatoni|khasra|ward|plot|house|shop|survey|gat)\s*no\.?\s*[:\-]?\s*[\d\/]+/gi,
    " "
  );
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = m[1].replace(/^0+(?=\d)/, "");
      // A GR number is a small serial. Anything long is a document
      // number, an e-way bill, or a phone number.
      if (n.length <= 6 && Number(n) > 0) return n;
    }
  }
  return null;
}

/**
 * Weight, normalised to KILOGRAMS whatever unit it was written in.
 *
 * The same consignment is written three different ways across one set:
 *   weight slip : 42330 KG
 *   vendor bill : 423.30 QTL   (quintals — 1 QTL = 100 KG)
 *   our invoice : 42,330 KG
 *   sometimes   : 42.33 MT     (metric tonnes — 1 MT = 1000 KG)
 *
 * Comparing the raw numbers made 423.30 and 42330 look like completely
 * different consignments. Everything is converted to KG so the three
 * agree exactly, which turns quantity into a reliable matching signal
 * instead of a misleading one.
 */
const UNIT_TO_KG = {
  kg: 1, kgs: 1, kilogram: 1, kilograms: 1,
  qtl: 100, qntl: 100, quintal: 100, quintals: 100, ctl: 100,
  mt: 1000, mts: 1000, ton: 1000, tons: 1000, tonne: 1000, tonnes: 1000,
  "m.t": 1000, mton: 1000, metrictonne: 1000, metricton: 1000,
};

function toKilograms(value, unit) {
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const factor = UNIT_TO_KG[String(unit || "kg").toLowerCase().replace(/[.\s]/g, "")] ?? 1;
  return Math.round(n * factor * 100) / 100;
}

/** Find the consignment quantity and return it in KG. */
function findQuantityKg(text) {
  // A number immediately followed by a unit is the reliable form.
  // Vendors round to whole tons ("34 TON") where we bill exact kilograms
  // (33,995 KG). Both must be readable, and the 2% tolerance in matching
  // absorbs the rounding.
  const re = /([\d,]+(?:\.\d+)?)\s*(KGS?|QTL|QNTL|QUINTALS?|MTS?|M\.?TONS?|METRIC\s?TONN?ES?|TONNES?|TONS?|TON)\b/gi;
  const found = [];
  let m;
  while ((m = re.exec(text))) {
    const kg = toKilograms(m[1], m[2]);
    // Below 100 kg is a rate or a charge, not a truckload.
    if (kg && kg >= 100) found.push(kg);
  }
  if (!found.length) return null;

  // The largest is NOT automatically the consignment. "4,800.00 Ton" is
  // the RATE per tonne sitting in the next column, and taking the max
  // read it as 4,800 tonnes. A truck carries roughly 5-60 tonnes, so
  // anything outside that is a rate, a value or a serial.
  const plausible = found.filter((kg) => kg >= 3000 && kg <= 80000);
  if (plausible.length) return Math.max(...plausible);

  // Nothing in range — return the smallest, which is far more likely to
  // be a real load than a six-figure rupee figure.
  return Math.min(...found);
}

/**
 * The document's own date.
 *
 * Taking the earliest date on the page was wrong: our invoices print the
 * buyer's order date (26-Feb-26) alongside the invoice date (1-Aug-26),
 * and the PO is always older. That put a supply into a February folder.
 *
 * The invoice date is the one printed against the invoice number, or the
 * e-invoice acknowledgement date. Only if neither is found does it fall
 * back — and then to the LATEST date, because the stale one on the page
 * is nearly always a purchase order from months earlier.
 */
function pickDocumentDate(text, dates, ourDocNo) {
  if (!dates.length) return null;

  const one = (re) => {
    const m = text.match(re);
    if (!m) return null;
    const found = findDates(m[0]);
    return found.length ? found[0] : null;
  };

  // On the same line as our own document number.
  if (ourDocNo) {
    const escaped = ourDocNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sameLine = one(new RegExp(`^.*${escaped}.*$`, "im"));
    if (sameLine) return sameLine;
  }

  // "Ack Date : 1-Aug-26" — stamped by the e-invoice portal, so it is the
  // invoice's own date by definition.
  const ack = one(/Ack\s*Date\s*[:\-]?\s*[^\n]{0,24}/i);
  if (ack) return ack;

  // "Invoice No. ... Dated 1-Aug-26"
  const dated = one(/\bDated\s*[:\-]?\s*[^\n]{0,24}/i);
  if (dated) return dated;

  // A weighbridge slip or bilty: whatever single date it carries.
  if (dates.length === 1) return dates[0];

  // Otherwise the most recent — a purchase order date is months old.
  return dates.sort()[dates.length - 1];
}

function findWeights(text) {
  const grab = (labels) => {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:.\\-]?\\s*([\\d,]+(?:\\.\\d+)?)`, "i");
      const m = text.match(re);
      if (m) {
        const n = Number(m[1].replace(/,/g, ""));
        if (Number.isFinite(n)) return String(n);
      }
    }
    return null;
  };
  return {
    grossWeight: grab(["gross\\s*w(?:eigh)?t", "gross"]),
    tareWeight: grab(["tare\\s*w(?:eigh)?t", "tare"]),
    netWeight: grab(["net\\s*w(?:eigh)?t", "net"]),
  };
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

/**
 * @param {string} text      OCR transcription of the document
 * @param {object} ctx       { vendors, clients, companyCodes }
 * @returns extracted fields in the same shape the cloud reader returns,
 *          so callers don't care which engine produced them
 */
function extractOffline(text, ctx = {}) {
  const raw = String(text || "");
  const upper = raw.toUpperCase();

  const cls = classifyFromText(raw);

  const gstins = [...new Set(upper.match(GSTIN_RE) || [])];
  const OUR_GSTIN = "06AAJCB1927H1ZS";
  const otherGstin = gstins.find((g) => g !== OUR_GSTIN) || null;

  // Needed before the vehicle scan, which uses it to reject plate-shaped
  // fragments of our own invoice numbers.
  const biomeDocNoRaw =
    (raw.match(BIOME_INVOICE_RE) || [])[0] || (raw.match(BIOME_CHALLAN_RE) || [])[0] || null;

  // Plates are matched only where they stand alone. Without this,
  // "BI-26-27-HR0786" yields a phantom vehicle "HR0786", and the real
  // one never gets a look in.
  const vehicles = [];
  {
    const standalone = /(?:^|[\s:,;()\[\]])([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})(?=$|[\s.,;()\[\]])/g;
    let m;
    while ((m = standalone.exec(upper))) {
      const v = m[1].replace(/\s/g, "");
      if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}$/.test(v)) continue;
      if (gstins.some((g) => g.includes(v))) continue;
      if (biomeDocNoRaw && biomeDocNoRaw.toUpperCase().includes(v)) continue;
      if (!vehicles.includes(v)) vehicles.push(v);
    }
  }

  const ewayCandidates = [...new Set((upper.match(EWAY_RE) || []).map((e) => e.replace(/\s/g, "")))]
    .filter((e) => e.length === 12);

  const dates = findDates(raw);
  const amounts = findAmounts(raw);
  const weights = findWeights(raw);

  const biomeDocNo = biomeDocNoRaw ? biomeDocNoRaw.replace(/\s/g, "") : null;

  // The vendor's own document number, as printed on their invoice:
  // "Invoice No. SAI/26-27/0545". The reference on OUR invoice says
  // "SAI/545", so the two have to be matchable — without this the
  // vendor's invoice had no number at all and could only ever match on
  // vehicle and weight.
  let vendorOwnDocNo = null;
  {
    // On a table-laid-out invoice the number sits on its own line, so
    // match its SHAPE (VENDORCODE/YY-YY/NNNN) anywhere rather than
    // insisting it follow the label.
    const standalone = raw.match(/\b([A-Z]{2,6}[\/\-]\d{2}[\-\/]\d{2}[\/\-]\d{2,6})\b/);
    const m =
      standalone ||
      raw.match(/\bInvoice\s*No\.?\s*[:\-]?\s*([A-Z]{2,6}[\/\-]\d{2,4}[\/\-]\d{2,4}[\/\-]?\d{0,6})/i) ||
      raw.match(/\bInvoice\s*No\.?\s*[:\-]?\s*(\d{1,6})\b/i) ||
      raw.match(/\bDoc\s*No\.?\s*[:\-]?\s*(?:Tax\s*Invoice\s*[\-–]\s*)?([A-Z]{2,6}[\/\-][\d\/\-]+)/i);
    if (m) vendorOwnDocNo = m[1].toUpperCase().replace(/\s/g, "");
  }

  const references = findReferences(raw, {
    companyCodes: ctx.companyCodes || ["BDC"],
    vendorCodes: (ctx.vendors || []).map((v) => v.code),
  });
  const reference = references[0] || null;

  // Use the shared client matcher rather than a local copy — it knows
  // about spelling variants ("Jhajjhar" for "Jhajjar") and prefers the
  // most specific name, and having two matchers meant fixing one left
  // the other wrong.
  let client = null;
  try {
    const { matchClient } = require("./clients");
    client = matchClient(raw, ctx.clients && ctx.clients.length ? ctx.clients : undefined);
  } catch {
    client = matchName(raw, ctx.clients || []);
  }
  const vendor = matchName(
    raw,
    (ctx.vendors || []).map((v) => ({ name: v.name, shortName: v.code, aliases: [] }))
  );

  const mobiles = [...new Set((raw.match(MOBILE_RE) || []).map((m) => m.replace(/\D/g, "").slice(-10)))];

  // Structured evidence is stronger than raw text length for the two
  // documents that drive settlement. A client receiving slip is trusted
  // when client + vehicle + date + weight are all present. A lab report is
  // trusted when client + vehicle + sample collection date are present.
  // This avoids sending good real-world slips to Review Queue merely because
  // the photographed form contains little OCR-able text.
  let confidence = cls.confidence;
  const hasClient = Boolean(client?.name);
  const hasVehicle = Boolean(vehicles.length);
  const hasDate = Boolean(dates.length);
  const hasWeight = Boolean(weights.netWeight || weights.grossWeight);
  const hasSampleDate = /(?:sample\s*collection|date\s*of\s*collection|date\s*of\s*sampling)/i.test(raw);
  if (cls.documentType === "receiving" && hasClient && hasVehicle && hasDate && hasWeight) confidence = Math.max(confidence, 85);
  if (cls.documentType === "lab_report" && hasClient && hasVehicle && (hasSampleDate || hasDate)) confidence = Math.max(confidence, 85);

  return {
    documentType: cls.documentType,
    confidence,
    issuedBy: cls.issuedByUs ? "Biome Industria Private Limited" : vendor?.name || null,
    referenceNo: reference ? reference.canonical : null,
    biomeDocNo,
    // Prefer the reference (authoritative), else what their own paper says.
    vendorDocNo: reference ? reference.vendorDocNo : vendorOwnDocNo,
    vendorOwnDocNo,
    vendorName: vendor?.name || null,
    vendorGstin: cls.issuedByUs ? otherGstin : gstins.find((g) => g !== OUR_GSTIN) || null,
    clientName: client?.name || null,
    clientGstin: cls.issuedByUs ? otherGstin : null,
    documentDate: pickDocumentDate(raw, dates, biomeDocNoRaw),
    ewayBillNo: ewayCandidates[0] || null,
    vehicleNo: vehicles[0] || null,
    grossWeight: weights.grossWeight,
    tareWeight: weights.tareWeight,
    netWeight: weights.netWeight,
    /** Everything normalised to KG so units can never break a match. */
    quantityKg:
      findQuantityKg(raw) ||
      (weights.netWeight ? toKilograms(weights.netWeight, "kg") : null),
    grNumber: findGrNumber(raw),
    /**
     * When the client drew the sample — which is the day the truck
     * unloaded, so it equals the receiving date. That is what ties a lab
     * report to the supplies it covers.
     */
    sampleCollectionDate: (() => {
      const m = raw.match(
        /(?:date\s*of\s*(?:collection|sampling)[^\n:]{0,24}|sampl(?:e|ing)\s*(?:collection\s*)?date)\s*[:\-]?\s*([^\n]{0,24})/i
      );
      if (!m) return null;
      const found = findDates(m[1]);
      return found.length ? found[0] : null;
    })(),
    taxableValue: amounts.length ? String(Math.max(...amounts)) : null,
    totalAmount: amounts.length ? String(Math.max(...amounts)) : null,
    driverMobile: mobiles[0] || null,
    hasDigitalSignature: /digitally\s+signed|digital\s+signature|dsc\b/i.test(raw),
    transcription: raw,
    /** So the UI can show which engine produced this. */
    engine: "offline-rules",
  };
}

/**
 * Optional second tier: a local LLM served by Ollama on this machine.
 * Entirely offline, but only present if the user installed it — so this
 * returns null rather than failing when it isn't there.
 */
async function extractWithLocalLlm(text, ctx = {}, options = {}) {
  const url = options.ollamaUrl || process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const model = options.model || process.env.OLLAMA_MODEL || "llama3.2";

  const system =
    "You extract fields from Indian commercial documents for a biomass supply company. " +
    "Respond with ONLY a JSON object with these keys: documentType, referenceNo, biomeDocNo, " +
    "vendorDocNo, vendorName, clientName, documentDate (YYYY-MM-DD), ewayBillNo, vehicleNo, " +
    "grossWeight, tareWeight, netWeight, totalAmount, driverMobile. Use null for anything you " +
    "cannot read. Never invent a value.";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `${system}\n\nDOCUMENT TEXT:\n${text.slice(0, 8000)}\n\nJSON:`,
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    return { ...parsed, transcription: text, engine: `ollama:${model}` };
  } catch {
    // Not installed, not running, or too slow — the rules already gave an
    // answer, so this is a bonus rather than a requirement.
    return null;
  }
}

/** Is a local LLM available right now? Used to show status in Settings. */
async function localLlmAvailable(options = {}) {
  const url = options.ollamaUrl || process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { available: false, models: [] };
    const data = await res.json();
    return { available: true, models: (data.models || []).map((m) => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}

module.exports = {
  extractOffline,
  findGrNumber,
  findQuantityKg,
  toKilograms,
  extractWithLocalLlm,
  localLlmAvailable,
  classifyFromText,
  findDates,
  findAmounts,
  findWeights,
  GSTIN_RE,
  VEHICLE_RE,
};
