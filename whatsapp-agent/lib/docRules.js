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
    // judging them (a real vendor GSTIN arrived as "03ABDFGO879P1Z1", and
    // a photographed one as "06ABCFA1234Q128" — the Z read as 2).
    if (foreignPos === -1 && looksLikeGstin(tok)) foreignPos = m.index;
  }
  return { ourPos, foreignPos };
}

const TO_DIGIT = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6", T: "7" };
const TO_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B", 2: "Z", 6: "G", 7: "T", 4: "A" };

/** A 15-character token that is a GSTIN once OCR look-alikes are folded back. */
function looksLikeGstin(token) {
  const t = String(token || "").toUpperCase();
  if (t.length !== 15) return false;
  const d = (c) => (/\d/.test(c) ? c : TO_DIGIT[c] || "x");
  const l = (c) => (/[A-Z]/.test(c) ? c : TO_LETTER[c] || "x");
  const fixed =
    d(t[0]) + d(t[1]) + [...t.slice(2, 7)].map(l).join("") + [...t.slice(7, 11)].map(d).join("") + l(t[11]) + t[12] +
    (/[Z27]/.test(t[13]) ? "Z" : t[13]) + t[14];
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(fixed);
}

/* ------------------------------------------------------------------ */
/* Who issued the page — seller/supplier/consignor vs buyer/consignee   */
/* ------------------------------------------------------------------ */

/**
 * Every place OUR identity appears on the page: our PAN (inside either
 * GSTIN — 06… Haryana or 27… Maharashtra — or printed alone as
 * "Company's PAN"), tolerant of one misread character and of spaces OCR
 * inserts; the name "Biome Industria" with up to two misread letters; our
 * e-mail and CIN.
 */
function ourMarks(text) {
  const src = String(text || "");
  const marks = [];

  // PAN: compare folded 10-character windows over the alphanumerics only.
  const idx = [];
  let compact = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i].toUpperCase();
    if (/[A-Z0-9]/.test(c)) { compact += c; idx.push(i); }
  }
  const target = foldOcr(OUR_PAN);
  const folded = foldOcr(compact);
  for (let i = 0; i + 10 <= folded.length; i++) {
    let miss = 0;
    for (let k = 0; k < 10 && miss <= 1; k++) if (folded[i + k] !== target[k]) miss++;
    if (miss <= 1 && (miss === 0 || folded.slice(i, i + 5) === target.slice(0, 5) || folded.slice(i + 5, i + 10) === target.slice(5))) {
      marks.push({ pos: idx[i], kind: "pan" });
      i += 9;
    }
  }

  // Name: "biomeindustria" over letters only, up to 2 edits.
  const lidx = [];
  let letters = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i].toLowerCase();
    if (/[a-z0-9|!]/.test(c)) { letters += c.replace(/[1|!]/, "i").replace(/0/, "o"); lidx.push(i); }
  }
  const pat = "biomeindustria";
  for (let i = 0; i < letters.length - 8; i++) {
    if (!"b8".includes(letters[i]) && letters[i + 1] !== "i" && letters.slice(i, i + 4) !== "iome") continue;
    const d = substringDistance(pat, letters.slice(i, i + pat.length + 3));
    if (d <= 2) {
      marks.push({ pos: lidx[i], kind: "name" });
      i += pat.length - 1;
    }
  }

  const lower = src.toLowerCase();
  for (const re of [/biomeindustria@/g, /u23200dl2020ptc368121/g]) {
    let m;
    while ((m = re.exec(lower))) marks.push({ pos: m.index, kind: "id" });
  }
  return marks.sort((a, b) => a.pos - b.pos);
}

/** Edit distance between `pat` and the best-matching PREFIX of `s`. */
function substringDistance(pat, s) {
  const m = pat.length, n = s.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (pat[i - 1] === s[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev.slice(Math.max(0, m - 3)));
}

/** Labels that introduce the ISSUING party. */
const SELLER_LABEL_RE = /\b(?:seller|supplier(?!'?s?\s*(?:ref|code|name\s*:?\s*$))|consignor|sold\s*by|bill(?:ed)?\s*from|dispatch(?:ed)?\s*from|generated\s*by|details\s*of\s*supplier|issued\s*by|company'?s\s*pan|from\s*:)/gi;
/** Labels that introduce the RECEIVING party. */
const BUYER_LABEL_RE = /\b(?:buyer(?!'?s?\s*(?:order|ref))|bill(?:ed)?\s*to|ship(?:ped)?\s*to|consignee|recipient|receiver|purchaser|customer|sold\s*to|details\s*of\s*(?:receiver|recipient|buyer)|m\/s\b)/gi;

function labelsIn(text) {
  const out = [];
  for (const [re, role] of [[SELLER_LABEL_RE, "seller"], [BUYER_LABEL_RE, "buyer"]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      // "(ORIGINAL FOR RECIPIENT)" is a copy marking, not a party label.
      const before = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (/(?:original|duplicate|triplicate|copy)\s*for\s*$|\bfor\s*$/.test(before)) continue;
      out.push({ pos: m.index, end: m.index + m[0].length, role, label: m[0] });
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

const OUR_SERIES_RE = /\bB[I1l]\s?\d{2}\s?[-\/]\s?\d{2}\s?[-\/]\s?[A-Z]{2}\s?\d{3,5}\b|\bB[I1l]PL\s?[\/\-]\s?\d{4}\s?-?\s?\d{2,4}\s?[\/\-]\s?\d{1,6}\b/i;

/**
 * Decide from the page itself whether Biome ISSUED it (seller / supplier /
 * consignor / letterhead) or RECEIVED it (buyer / bill to / consignee /
 * recipient). Each appearance of our identity is judged by the party label
 * closest above it; an unlabelled appearance before any other party is the
 * letterhead. Returns side "us" | "them" | null (no evidence either way).
 */
function issuerSide(text) {
  const src = String(text || "").replace(/[\u00ad\u2010-\u2015]/g, "-");
  const marks = ourMarks(src);
  const labels = labelsIn(src);
  const reasons = [];
  let score = 0;

  // First foreign party GSTIN that is NOT under a buyer label = someone
  // else's letterhead.
  let foreignHead = -1;
  {
    const re = /\b[0-9A-Z]{15}\b/g;
    const up = src.toUpperCase();
    let m;
    while ((m = re.exec(up))) {
      if (isOurGstin(m[0]) || !looksLikeGstin(m[0])) continue;
      const lab = [...labels].reverse().find((l) => l.end <= m.index && m.index - l.end < 240);
      if (lab && lab.role === "buyer") continue;
      foreignHead = m.index;
      break;
    }
  }
  const firstBuyerLabel = labels.find((l) => l.role === "buyer");
  // A "GSTIN" label whose number is NOT ours, printed above our first
  // mention: that block is someone else's letterhead, even when OCR
  // garbled the number itself (so foreignHead above could not see it)
  // and the "Consignee" label above our name.
  let foreignGstinLabel = -1;
  {
    const re = /g\s?s\s?t\s?[i1l|]?\s?n|gst\s*(?:no|reg)/gi;
    let m;
    while ((m = re.exec(src))) {
      const after = src.slice(m.index, m.index + 48);
      if (ourMarks(after).some((k) => k.kind === "pan")) continue;
      if (!/[0-9OQ]{2}\s?[A-Z0-9]{5}/i.test(after.slice(m[0].length))) continue;
      foreignGstinLabel = m.index;
      break;
    }
  }

  marks.forEach((mk, n) => {
    const weight = n === 0 ? 1.5 : 1;
    const prefix = src.slice(Math.max(0, mk.pos - 22), mk.pos).toLowerCase();
    let role = null;
    let why = "";
    if (/\bfor\s*[:\-]?\s*$|signed\s*by\s*[:\-]?\s*$|generated\s*by\s*[:\-]?\s*(?:[0-9a-z]{15}\s*[-,]?\s*)?$/.test(prefix)) {
      role = "seller"; why = "signed/issued by";
    } else {
      const lab = [...labels].reverse().find((l) => l.end <= mk.pos && mk.pos - l.end < 240);
      if (lab) { role = lab.role; why = `under "${lab.label.trim()}"`; }
      // Letterhead = the top of the page, before any other party. A name
      // floating mid-page with its label lost to OCR proves nothing.
      else if ((foreignHead === -1 || mk.pos < foreignHead) && (!firstBuyerLabel || mk.pos < firstBuyerLabel.pos) &&
        (foreignGstinLabel === -1 || mk.pos < foreignGstinLabel) &&
        mk.pos < Math.max(450, src.length * 0.3)) { role = "seller"; why = "letterhead"; }
    }
    if (role === "seller") score += 3 * weight;
    else if (role === "buyer") score -= 3 * weight;
    if (role) reasons.push(`Biome ${mk.kind} ${role === "seller" ? "as issuer" : "as buyer"} (${why})`);
  });

  if (foreignHead !== -1 && (!marks.length || foreignHead < marks[0].pos)) {
    score -= 2;
    reasons.push("another party's GSTIN heads the page");
  }

  // Our own numbering printed against the document's number label.
  const numLabel = /(?:invoice|delivery\s*note|challan|document)\s*(?:no|number)?\.?\s*[:\-]?\s*(?:tax\s*invoice\s*-\s*|delivery\s*challan\s*-\s*)?([^\n]{0,60})/gi;
  let nm;
  let series = false;
  while ((nm = numLabel.exec(src))) if (OUR_SERIES_RE.test(nm[1].split(/\s{2,}/)[0] || nm[1])) { series = true; break; }
  if (series) { score += 2; reasons.push("our invoice/challan number series"); }

  const side = score >= 2 ? "us" : score <= -2 ? "them" : null;
  return { side, score, reasons, marks: marks.length };
}

const AS_BUYER_RE = /(?:billed\s*to|bill\s*to|buyer|shipped\s*to|consignee|recipient)\s*:?[\s\S]{0,200}?biome\s*industria/i;

function issuerIsUs(text) {
  // The party labels decide first (Seller/Supplier/Consignor vs
  // Buyer/Bill to/Consignee/Recipient) — that is what the page states.
  const decided = issuerSide(text);
  if (decided.side) return decided.side === "us";
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
  // The NIC printout: "E-Way Bill No: 3223 0170 5535 … Valid Upto",
  // "Part - A … GSTIN of Supplier … GSTIN of Recipient". OCR and pdfjs
  // keep the hyphen of "E-Way", so the old "eway bill no" test missed
  // every real printout and it was typed as the invoice it lists under
  // Document Details.
  const ewayStructure =
    /e[\s\-.]*way\s*bill\s*details/.test(full) ||
    (/e[\s\-.]*way\s*bill\s*(?:no|date)\.?\s*[:.]?\s*\d/.test(full) && /valid\s*(?:upto|up\s*to|until|from)/.test(full)) ||
    (/gstin\s*of\s*supplier/.test(full) && /gstin\s*of\s*recipient/.test(full) && /e[\s\-.]*way\s*bill/.test(full));
  // OCR of a phone photo reads "E-Way Bill" as "&-Way Bat", "Valid Upto"
  // as "Valk Upto" and "GSTIN of Supplier" as "GST of Supplier" — the
  // exact phrases above then all miss and the printout was typed as the
  // tax invoice it lists under Document Details. Count the printout's
  // distinctive labels instead, each tolerant of a misread letter.
  const ewaySignals = [
    /\b[e&c€][\s\-.]*way\b/,
    /val\w{0,3}\s*up\s*to|valid\s*(?:until|from)/,
    /gen\w{2,8}\s*by/,
    /\bpart\s*[-–]?\s*[ab8]\b/,
    /gst\w{0,3}\s*of\s*(?:supp|recip|rec)/,
    /appro\w*\s*d\w{2,6}nce/,
    /document\s*det/,
    /transaction\s*type/,
    /place\s*of\s*(?:dispatch|d\w{2,4}atch|delivery|d\w{2,4}very)/,
    /vehicle\s*\/?\s*trans/,
  ].filter((re) => re.test(full)).length;
  const ewayTitle = /\b[e&c€][\s\-.]*way\s*b\w{0,3}l?/.test(strip);
  const ewayPrintout = (ewayStructure && /e[\s\-.]*way\s*bill/.test(strip)) || (ewayTitle && ewaySignals >= 4);
  if (ewayPrintout && !/tax\s*invo[il]ce|delivery\s*(?:note|challan)/.test(strip)) {
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
    // Our own plant's weighbridge (Gangakhed / Rewari) names the client as
    // the party it is loading for — it is still OUR loading slip, not the
    // client's receiving.
    const ourKanta = /biome|gangakhed|rewari\s*plant|mayan/.test(strip);
    const clientHit = ourKanta ? null : (knownClients || []).find((c) => c && full.includes(c));
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

module.exports = { decideType, byStructure, byFileName, issuerIsUs, issuerSide, ourMarks, looksLikeGstin, isOurGstin, gstinPositions, OUR_SERIES_RE };
