/**
 * Biome Platform — filename intelligence
 * -------------------------------------------------------------------
 * Reads the filename before touching the file's contents.
 *
 * WHY THIS IS WORTH DOING FIRST
 * The names arriving in the sales group already carry the two hardest
 * fields to extract reliably:
 *
 *   "542. SAI0542 biome HR39F5331.pdf"
 *      542      -> serial in the day's batch
 *      SAI0542  -> the vendor's own document number
 *      HR39F5331-> THE VEHICLE NUMBER
 *
 *   "Sales Haryana_BI-26-27-HR0816.pdf"
 *      BI-26-27-HR0816 -> our tax invoice number
 *
 *   "BILL MH46_merged.pdf"
 *      MH46     -> vendor code MH, document 46
 *      _merged  -> several documents in one file
 *
 * A vehicle number read off a filename is exact. The same number read
 * off a photographed weighbridge slip is a coin flip. Whoever names
 * these files is doing careful work, and ignoring it in favour of OCR
 * throws away the most reliable signal available — for free, with no
 * model, no OCR pass and no latency.
 *
 * Nothing here overrides the document itself. These are strong hints
 * that fill gaps and corroborate what the page says.
 */

/** Indian plates: HR39F5331, UP22AT1505, RJ29GC7686, HR62A3643. */
const VEHICLE_RE = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})\b/g;

/**
 * Our invoice numbering: BI-26-27-HR0816, BI26-27-HR0786.
 *
 * Note the explicit edges instead of \b. In "Sales Haryana_BI-26-27-..."
 * the character before BI is an underscore, which \b counts as a word
 * character — so a word-boundary anchor silently never matched, and our
 * own invoice numbers went unrecognised in exactly the files that
 * carried them.
 */
const EDGE_L = "(?:^|[^A-Za-z0-9])";
const EDGE_R = "(?=$|[^A-Za-z0-9])";

const BIOME_INVOICE_RE = new RegExp(
  `${EDGE_L}(BI[\\s\\-_\\/]?\\d{2}[\\s\\-_\\/]?\\d{2}[\\s\\-_\\/]?[A-Z]{2}\\d{3,5})${EDGE_R}`,
  "i"
);

/** Our challan numbering: BIPL/2026-27/884. */
const BIOME_CHALLAN_RE_LOOSE = new RegExp(
  `${EDGE_L}(BIPL[\\s\\-_\\/]?\\d{4}[\\s\\-_\\/]?\\d{2,4}[\\s\\-_\\/]?\\d{1,6})${EDGE_R}`,
  "i"
);

const BIOME_CHALLAN_RE = new RegExp(
  `${EDGE_L}(BIPL[\\s\\-_\\/]?\\d{4}[\\s\\-_\\/]?\\d{2,4}[\\s\\-_\\/]?\\d{1,6})${EDGE_R}`,
  "i"
);

/** Coordination reference, when someone types it into the filename. */
const REFERENCE_RE = /\b([A-Z]{2,5})[\s\-_\/]+(\d{1,6})[\s\-_\/]+([A-Z]{2,6})[\s\-_\/]+(\d{1,6})\b/i;

/** Words that mark a file as holding several documents at once. */
const MERGED_HINTS = ["merged", "merge", "combined", "all doc", "alldoc", "set", "complete"];

/** Document-type words that appear in filenames. */
// Underscores are word characters, so \b never fires between "Tag" and
// "_0624". Filenames here are full of underscores, so these use explicit
// non-alphanumeric edges instead.
const E = "(?:^|[^A-Za-z0-9])";
const Z = "(?=$|[^A-Za-z0-9])";

const TYPE_HINTS = [
  { pattern: new RegExp(`${E}(?:weigh?t[\\s_-]?slip|weighbridge|wb)${Z}`, "i"), type: "weight_slip" },
  { pattern: new RegExp(`${E}(?:bilty|lr[\\s_-]?copy|bill[\\s_-]?t)${Z}`, "i"), type: "bilty_lr" },
  { pattern: new RegExp(`${E}(?:e[\\s_-]?way|ewb)${Z}`, "i"), type: "eway_bill" },
  { pattern: new RegExp(`${E}(?:challan|dc|delivery[\\s_-]?note)${Z}`, "i"), type: "delivery_challan" },
  { pattern: new RegExp(`${E}(?:consign?h?ment[\\s_-]?tag|consig[hn]ment[\\s_-]?tag|con[\\s_-]?tag|gco)${Z}`, "i"), type: "consignment_tag" },
  { pattern: new RegExp(`${E}(?:fast[\\s_-]?tag|fastag)${Z}`, "i"), type: "fast_tag" },
  { pattern: new RegExp(`${E}(?:coa|certificate[\\s_-]?of[\\s_-]?analysis|lab)${Z}`, "i"), type: "coa" },
  // Debit and credit notes are named plainly — "Debit Note for
  // Haryana_DN-BI-26-27-072.pdf" — so the filename alone identifies them.
  // These are listed BEFORE the invoice pattern, because such a filename
  // also contains "bill"/"note" words that would otherwise match first.
  { pattern: /debit\s?note|(?:^|[^A-Za-z0-9])DN-BI-/i, type: "debit_note" },
  { pattern: /credit\s?note|(?:^|[^A-Za-z0-9])CN-BI-/i, type: "credit_note" },
  { pattern: /\btax\s?invoice\b|\binvoice\b|\bbill\b|\bsales\b/i, type: "tax_invoice" },
];

function normalisePlate(raw) {
  return String(raw || "").toUpperCase().replace(/\s/g, "");
}

/**
 * Read whatever the filename is willing to tell us.
 *
 * @param {string} fileName
 * @param {object} ctx  { vendors: [{code, name}], companyCodes: ["BDC"] }
 */
function parseFileName(fileName, ctx = {}) {
  const name = String(fileName || "").replace(/\.[a-z0-9]{1,5}$/i, ""); // drop extension
  const upper = name.toUpperCase();

  const out = {
    vehicleNo: null,
    biomeDocNo: null,
    vendorDocNo: null,
    vendorCode: null,
    referenceNo: null,
    typeHint: null,
    isMerged: false,
    /** Which side the filename suggests this came from. */
    side: null,
    hints: [],
  };

  // ---- Our own document numbers ----
  const invoice = name.match(BIOME_INVOICE_RE);
  const challan = name.match(BIOME_CHALLAN_RE);
  if (invoice) {
    out.biomeDocNo = invoice[1].toUpperCase().replace(/\s/g, "");
    out.side = "biome";
    out.typeHint = "biome_tax_invoice";
    out.hints.push(`filename carries our invoice number ${out.biomeDocNo}`);
  } else if (challan) {
    out.biomeDocNo = challan[1].toUpperCase().replace(/\s/g, "");
    out.side = "biome";
    out.typeHint = "biome_delivery_challan";
    out.hints.push(`filename carries our challan number ${out.biomeDocNo}`);
  }

  // ---- Vehicle number ----
  // Skip anything that is part of our invoice number: "BI-26-27-HR0816"
  // contains "HR0816", which is not a vehicle.
  const excluded = (out.biomeDocNo || "").toUpperCase();
  VEHICLE_RE.lastIndex = 0;
  let m;
  while ((m = VEHICLE_RE.exec(upper))) {
    const plate = normalisePlate(m[1]);
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}$/.test(plate)) continue;
    if (excluded.includes(plate)) continue;
    out.vehicleNo = plate;
    out.hints.push(`vehicle ${plate} from the filename`);
    break;
  }

  // ---- Vendor code and document number ----
  // "BILL MH46_merged" and "542. SAI0542 biome HR39F5331" both encode a
  // vendor prefix followed by digits. Match against the registry so a
  // random letter pair can't masquerade as a vendor code.
  const vendorCodes = (ctx.vendors || []).map((v) => String(v.code || "").toUpperCase()).filter(Boolean);
  for (const code of vendorCodes.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`${EDGE_L}${code}[\\s\\-_]?(\\d{1,6})${EDGE_R}`, "i");
    const hit = name.match(re);
    if (hit) {
      out.vendorCode = code;
      out.vendorDocNo = hit[1];
      out.side = out.side || "vendor";
      out.hints.push(`vendor ${code} document ${hit[1]} from the filename`);
      break;
    }
  }

  // ---- A full reference typed into the name ----
  const companyCodes = (ctx.companyCodes || ["BDC"]).map((c) => c.toUpperCase());
  const ref = name.match(REFERENCE_RE);
  if (ref && companyCodes.includes(ref[1].toUpperCase())) {
    out.referenceNo = `${ref[1].toUpperCase()}/${ref[2]}/${ref[3].toUpperCase()}/${ref[4]}`;
    out.hints.push(`reference ${out.referenceNo} from the filename`);
  }

  // Our own debit/credit notes are numbered DN-BI-… / CN-BI-…
  if (new RegExp(EDGE_L + "(?:DN|CN)-BI-", "i").test(name)) {
    out.side = "biome";
    const m = name.match(new RegExp(EDGE_L + "((?:DN|CN)-BI-[0-9-]+)", "i"));
    if (m) {
      out.biomeDocNo = m[1].toUpperCase();
      out.hints.push(`filename carries our note number ${out.biomeDocNo}`);
    }
  }

  // "Sales <state>_..." is how outgoing invoices are named here, so it
  // marks the file as ours even when no number parses.
  if (!out.side && /\bsales\s+(haryana|punjab|up|uttar|rajasthan|delhi|mp|madhya)\b/i.test(name)) {
    out.side = "biome";
    out.hints.push("filename follows our outgoing-invoice naming");
  }

  // ---- Merged? ----
  const lower = name.toLowerCase();
  out.isMerged = MERGED_HINTS.some((h) => lower.includes(h));
  if (out.isMerged) out.hints.push("filename suggests several documents in one file");

  // ---- Type hint (only if we don't already know) ----
  if (!out.typeHint) {
    for (const { pattern, type } of TYPE_HINTS) {
      if (pattern.test(name)) {
        out.typeHint = type;
        out.hints.push(`filename suggests a ${type.replace(/_/g, " ")}`);
        break;
      }
    }
  }

  return out;
}

/**
 * Merge filename hints into extracted fields.
 *
 * The page always wins where it actually said something. The filename
 * only fills blanks — which in practice is most of the time, because a
 * vehicle number is far more likely to be legible in a filename than in
 * a photographed weighbridge slip.
 */
function applyFileNameHints(extracted, hints) {
  if (!extracted || !hints) return extracted;
  const merged = { ...extracted };

  for (const field of ["vehicleNo", "biomeDocNo", "vendorDocNo"]) {
    if (!merged[field] && hints[field]) merged[field] = hints[field];
  }
  if (!merged.referenceNo && hints.referenceNo) merged.referenceNo = hints.referenceNo;

  const sided = { tax_invoice: "vendor_tax_invoice", delivery_challan: "vendor_delivery_challan", eway_bill: "vendor_eway_bill" };
  const sideType = (t) =>
    hints.side === "biome" ? (t.startsWith("biome_") ? t : `biome_${t}`) : sided[t] || t;

  // Which filename words are DELIBERATE. Nobody types "Consignment tag"
  // or "Weight slip" into a filename by accident — the coordinator who
  // named the file is telling us what it is, and a blurry OCR keyword
  // score does not get to overrule a person. Generic words ("bill",
  // "invoice") stay weak: too many things are casually called a bill.
  const STRONG_HINTS = new Set([
    "weight_slip", "consignment_tag", "eway_bill", "bilty_lr",
    "delivery_challan", "debit_note", "credit_note", "fast_tag", "coa",
  ]);

  if (hints.typeHint) {
    const named = sideType(hints.typeHint);
    const strong = STRONG_HINTS.has(hints.typeHint);
    const current = merged.documentType;

    if (!current || current === "other") {
      // The reader failed — any hint is better than nothing.
      merged.documentType = named;
      merged.confidence = Math.max(Number(merged.confidence) || 0, strong ? 80 : 55);
    } else if (strong && current !== named && !hints.isMerged) {
      // The reader and an EXPLICIT filename disagree on a single-document
      // file. The filename wins — this is exactly the "Consignment tag
      // ... .pdf filed as a weight slip" failure. Merged files are exempt:
      // there the filename names the set, not each page.
      merged.documentTypeFromReader = current;
      merged.documentType = named;
      merged.confidence = Math.max(Number(merged.confidence) || 0, 80);
      merged.fileNameOverrode = true;
    } else if (!strong && hints.typeHint === "tax_invoice") {
      // "BILL NO 53.pdf" read as a lab report: a weak hint normally
      // yields to the page, but some pairings are simply implausible —
      // nobody names a lab report "BILL NO x". When the reader's answer
      // is one of those AND it isn't highly confident, the name wins.
      const implausible = new Set(["lab_report", "coa", "receiving", "weight_slip", "fast_tag"]);
      if (implausible.has(current) && (Number(merged.confidence) || 0) < 85) {
        merged.documentTypeFromReader = current;
        merged.documentType = named;
        merged.confidence = Math.max(Number(merged.confidence) || 0, 70);
        merged.fileNameOverrode = true;
      }
    }
  }

  if (hints.hints?.length) {
    merged.fileNameHints = hints.hints;
  }
  return merged;
}

module.exports = { parseFileName, applyFileNameHints, VEHICLE_RE };
