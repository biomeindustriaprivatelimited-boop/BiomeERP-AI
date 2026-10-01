/**
 * Biome Platform — WhatsApp Agent / filing
 * -------------------------------------------------------------------
 * Decides the folder + filename for every downloaded document, and
 * writes it to disk without ever overwriting anything.
 *
 * Layout under <DataRoot>/whatsapp/inbox:
 *
 *   July-2026/                        1. month  (from OUR invoice/challan date)
 *     Jhajjar Power Limited/          2. client
 *       30-07-2026/                   3. date   (from OUR invoice/challan date)
 *         BDC_786_MHI_44/             4. coordination reference, underscored
 *           Biome Tax Invoice - BI26-27-HR0786.pdf
 *           Biome Eway Bill - 322301705535.pdf
 *           Vendor Tax Invoice - 46.pdf
 *           Vendor Eway Bill - 362301888811.pdf
 *           Bilty LR Copy - UP22AT1505.jpg
 *           Weight Slip - UP22AT1505.jpg
 *
 * EVERY document for one supply — the vendor's papers and ours — sits
 * together in that single reference folder, flat, so a whole consignment
 * can be pulled up at any time from one place.
 *
 * THE MONTH AND DATE COME FROM *OUR* DOCUMENT, NOT EACH FILE'S OWN DATE.
 * A vendor invoice dated 25-07 that belongs to our challan dated 30-07
 * must still land under 30-07-2026, or one supply ends up split across
 * two date folders. The caller passes that anchor date in; when it isn't
 * known yet (a vendor document arrived first) the file is placed on its
 * own date and moved once our document turns up — see reanchor() in
 * agent.js.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");
const { referenceToFolder } = require("./reference");
const { DOC_TYPE_LABEL, DOC_TYPE_SIDE } = require("./classify");
const { matchClient } = require("./clients");
const { labReportLocation } = require("./clientDocs");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Step 1: "July-2026". */
function monthFolder(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  return `${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`;
}

/** Step 3: "30-07-2026" (the Indian DD-MM-YYYY the paperwork itself uses). */
function dateFolder(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Indian financial year, still used for reporting elsewhere. */
function financialYear(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // month 3 === April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function isoDate(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Strip anything Windows/macOS refuse in a path segment. */
function sanitizeSegment(raw, fallback = "Unknown") {
  const cleaned = String(raw || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "") // Windows rejects leading/trailing dots & spaces
    .slice(0, 90)
    .trim();
  // Reserved DOS device names, still rejected by Windows today.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `${cleaned}_`;
  return cleaned || fallback;
}

/**
 * One client, one folder — always.
 *
 * Consignee names come off invoices in whatever form the issuer printed:
 * "Jhajjar Power Limited", "JHAJJAR POWER LIMITED, KHANPUR", "APCPL".
 * Left alone those would scatter one client's paperwork across three
 * folders, so the name is resolved through the client master first and
 * only falls back to the raw text when nothing matches.
 */
function clientFolder(name) {
  const matched = matchClient(name);
  if (matched) return sanitizeSegment(matched.name, "_Unknown Client");
  const clean = sanitizeSegment(name, "");
  return clean || "_Unknown Client";
}

function extensionFor(fileName, mimeType) {
  const fromName = path.extname(String(fileName || "")).toLowerCase();
  if (fromName && /^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  const map = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
  };
  return map[mimeType] || ".bin";
}

/**
 * Work out the folder + base filename for one document.
 *
 * @param {object} input
 *   @param {object|null} input.reference  parsed reference, or null
 *   @param {object|null} input.extracted  AI output, or null
 *   @param {string} input.originalName
 *   @param {string} input.mimeType
 *   @param {Date}   input.receivedAt
 *   @param {string} input.senderName
 * @returns {{ dir: string, baseName: string, ext: string, bucket: string }}
 */
function planFiling(input) {
  const { reference, extracted, originalName, mimeType, receivedAt, senderName } = input;
  const ext = extensionFor(originalName, mimeType);
  const docType = extracted?.documentType || null;

  // A lab report belongs to the client and the month, not to one supply.
  // One report typically covers several vehicles, so filing it inside a
  // single reference folder would assert something untrue about every
  // other supply it also describes.
  if (docType === "lab_report") {
    const location = labReportLocation(extracted, monthFolder, clientFolder);
    return {
      bucket: "filed",
      dir: path.join(PATHS.inbox, ...location.folder),
      baseName: buildBaseName(docType, extracted, originalName, ext),
      ext,
      standalone: true,
      labReportFolderReason: location.reason,
    };
  }

  // 1. Genuinely not a business document — a screenshot, a selfie.
  //    This is the only case that gets set aside, and it's the right
  //    one to set aside.
  //    A page that prints a coordination reference is never "not a
  //    document", however unclear its header was.
  if (docType === "other" && !reference && !extracted?.vehicleNo && !extracted?.biomeDocNo) {
    return {
      bucket: "_Not A Document",
      dir: path.join(PATHS.inbox, "_Not A Document", isoDate(receivedAt), sanitizeSegment(senderName, "Unknown Sender")),
      baseName: sanitizeSegment(path.basename(String(originalName || "document"), ext), "document"),
      ext,
    };
  }

  // 2. No coordination reference yet.
  //
  //    This used to mean "_Needs Review", which put the work back on a
  //    person — the exact thing this is meant to remove. A document
  //    without a reference is not unusable: it still knows its client,
  //    its date and usually its vehicle, which is enough to file it
  //    where someone would look for it.
  //
  //    It lands in the normal Month/Client/Date tree under an
  //    "Unmatched" folder, so it is filed, findable, and gets pulled
  //    into the right supply the moment our invoice names it.
  // A manufacturing supply is complete without a reference — file it
  // properly rather than parking it as unmatched.
  if (!reference && input.supplyType === "manufacturing" && extracted?.documentDate) {
    const docDate = parseDate(extracted.documentDate) || receivedAt;
    return {
      bucket: "filed",
      dir: path.join(
        PATHS.inbox,
        monthFolder(docDate),
        clientFolder(extracted?.clientName),
        dateFolder(docDate),
        referenceFolder(reference)
      ),
      baseName: buildBaseName(docType, extracted, originalName, ext),
      ext,
      supplyType: "manufacturing",
    };
  }

  if (!reference) {
    // Low-confidence / unresolved documents must NEVER be silently filed as
    // if they were final business records. They go to an explicit review
    // queue until a human confirms the classification/match.
    const docDate = parseDate(extracted?.documentDate) || receivedAt;
    const vehicle = sanitizeSegment(extracted?.vehicleNo || "", "");
    return {
      bucket: "unmatched",
      dir: path.join(
        PATHS.inbox,
        "_Review Queue",
        monthFolder(docDate),
        clientFolder(extracted?.clientName),
        vehicle ? `Unmatched - ${vehicle}` : "Unmatched"
      ),
      baseName: buildBaseName(docType, extracted, originalName, ext),
      ext,
      needsReference: true,
      reviewRequired: true,
    };
  }

  // 3. The good path: fully identified.
  //    anchorDate is OUR invoice/challan date for this reference. Without
  //    it we fall back to this document's own date and re-file later.
  const anchorDate =
    parseDate(input.anchorDate) || parseDate(extracted?.documentDate) || receivedAt;

  return {
    bucket: "filed",
    dir: path.join(
      PATHS.inbox,
      monthFolder(anchorDate),
      clientFolder(extracted?.clientName),
      dateFolder(anchorDate),
      referenceFolder(reference)
    ),
    baseName: buildBaseName(docType, extracted, originalName, ext),
    ext,
    /** True when this landed on a guessed date and should be revisited. */
    anchored: Boolean(parseDate(input.anchorDate)),
    reference: reference.canonical,
  };
}

/**
 * Manufacturing consignments are identified by our own document and the
 * vehicle, since there is no vendor code to name them by.
 *   "MFG - BI-26-27-HR0809 - RJ32GD6535"
 */
function manufacturingFolder(extracted, reference) {
  const ourDoc = sanitizeSegment(extracted?.biomeDocNo || reference?.biomeDocNo || "", "");
  const vehicle = sanitizeSegment(extracted?.vehicleNo || "", "");
  const parts = ["MFG", ourDoc, vehicle].filter(Boolean);
  return parts.length > 1 ? parts.join(" - ") : "MFG - Unidentified";
}

/** "BDC/786/MHI/44" -> "BDC_786_MHI_44" */
function referenceFolder(reference) {
  return String(reference?.canonical || "")
    .replace(/[\\/\s]+/g, "_")
    .replace(/[^A-Za-z0-9_\-]/g, "")
    .slice(0, 80) || "Unidentified_consignment";
}


function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d;
}

/**
 * Filenames a scanner app or phone produced, which say nothing about
 * what's inside. Vendors also send files under plainly wrong names, so
 * an incoming name is never trusted as a description.
 */
const MEANINGLESS_NAME = /^(doc\s?scanner|docscanner|scan|scanned|image|img|photo|picture|whatsapp\s?image|whatsapp\s?document|new\s?doc|untitled|document|camscanner|adobe\s?scan|\d{8,}|[a-f0-9-]{20,})/i;

function isMeaninglessName(name) {
  const stem = String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return !stem || MEANINGLESS_NAME.test(stem);
}

/**
 * Build a filename from what the document SAYS, never from what it
 * arrived as.
 *
 * "DocScanner Aug 1, 2026 10-17 AM.pdf" tells nobody anything. Reading
 * the page and naming it "Bilty LR Copy - 25" or "Vendor Tax Invoice -
 * 37" is the difference between a folder you can scan in two seconds and
 * one you have to open file by file.
 */
function buildBaseName(docType, extracted, originalName, ext) {
  const label = DOC_TYPE_LABEL[docType] || "Document";
  const side = DOC_TYPE_SIDE[docType];

  let key = null;
  if (side === "biome") key = extracted?.biomeDocNo;
  else if (side === "vendor") key = extracted?.vendorDocNo;
  // Fall back in order of how useful the number is for finding the
  // document later. The GR number comes before the vehicle because a
  // bilty carries nothing else, and the vehicle is appended separately
  // below anyway.
  if (!key) key = extracted?.grNumber || extracted?.ewayBillNo || null;

  // With every document for a date in one folder, the filename alone has
  // to say which supply it belongs to — otherwise two vendors' invoices
  // for the same day are indistinguishable. The vehicle number does that
  // job better than anything else: one truck, one consignment.
  const parts = [label];
  if (key) parts.push(sanitizeSegment(key, ""));
  const vehicle = sanitizeSegment(extracted?.vehicleNo || "", "");
  if (vehicle && !parts.includes(vehicle)) parts.push(vehicle);

  const name = parts.filter(Boolean).join(" - ");

  // Only fall back to the original name if it actually means something.
  const fallback = isMeaninglessName(originalName)
    ? label
    : sanitizeSegment(path.basename(String(originalName || "document"), ext), label);

  return sanitizeSegment(name, fallback);
}

/**
 * Write the file, never overwriting: "name.pdf", "name (2).pdf", ...
 * If a byte-identical file is already there, reuse it instead of making
 * a duplicate — WhatsApp re-sends are common.
 */
function saveFile(plan, buffer) {
  ensureDir(plan.dir);
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  let candidate = path.join(plan.dir, `${plan.baseName}${plan.ext}`);
  let n = 1;
  while (fs.existsSync(candidate)) {
    const existing = fs.readFileSync(candidate);
    if (
      existing.length === buffer.length &&
      crypto.createHash("sha256").update(existing).digest("hex") === hash
    ) {
      return { filePath: candidate, deduped: true, sha256: hash };
    }
    n += 1;
    candidate = path.join(plan.dir, `${plan.baseName} (${n})${plan.ext}`);
  }

  fs.writeFileSync(candidate, buffer);
  return { filePath: candidate, deduped: false, sha256: hash };
}

module.exports = {
  planFiling,
  saveFile,
  monthFolder,
  dateFolder,
  referenceFolder,
  manufacturingFolder,
  isMeaninglessName,
  financialYear,
  isoDate,
  sanitizeSegment,
  extensionFor,
};
