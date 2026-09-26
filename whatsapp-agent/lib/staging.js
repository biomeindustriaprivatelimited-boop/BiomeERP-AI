/**
 * Biome Platform — staging and matching
 * -------------------------------------------------------------------
 * Vendor paperwork is READ on arrival but NOT filed. It waits here until
 * our own tax invoice or delivery challan turns up, because only our
 * document carries the coordination reference — the "BDC/811/AA/32" in
 * the Other References box — that says which supply everything belongs
 * to.
 *
 * WHY WAIT INSTEAD OF FILING IMMEDIATELY
 * A vendor invoice on its own does not know which of our supplies it
 * belongs to. Filing it on arrival means guessing, and a guess puts it
 * in the wrong client folder, on the wrong date, under the wrong
 * reference. Holding it costs nothing and removes the guess entirely:
 * when our document lands it states the answer outright.
 *
 * WHY NOT TRUST VENDOR FILENAMES
 * They are inconsistent — "HR61D4137_BILL309_31072026.pdf" one day and
 * something else the next, from the same vendor. Filenames are used as
 * a weak corroborating hint only. Matching runs on what is printed
 * inside the documents.
 *
 * HOW A MATCH IS DECIDED
 *   Reference (BDC/811/AA/32)  -> vendor code AA + their document 32
 *   Vehicle number             -> the strongest physical link
 *   Quantity / net weight      -> corroboration, within tolerance
 *
 * The reference alone is enough. Vehicle and quantity raise confidence
 * and catch the case where a vendor's document number was misread.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");

/** Vendor documents live here until they're matched to one of ours. */
function stagingDir() {
  return path.join(PATHS.root, "whatsapp", "staging");
}

function stagingIndex() {
  return path.join(PATHS.dbDir, "staging.jsonl");
}

// ---------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------

let cache = null;

function load() {
  if (cache) return cache;
  ensureDir(PATHS.dbDir);
  cache = [];
  const file = stagingIndex();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        cache.push(JSON.parse(trimmed));
      } catch {
        // A torn final line from an interrupted write.
      }
    }
  }
  return cache;
}

function append(entry) {
  load();
  ensureDir(PATHS.dbDir);
  fs.appendFileSync(stagingIndex(), JSON.stringify(entry) + "\n", "utf8");
  cache.push(entry);
  return entry;
}

/** Latest state of every staged item, newest first. Consumed ones drop out. */
function pending() {
  const byId = new Map();
  for (const e of load()) byId.set(e.id, e);
  return [...byId.values()]
    .filter((e) => e.status === "waiting")
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

/**
 * Latest known state of one staged item, waiting or already consumed.
 * Used to serve a file back to the browser even after it's been matched
 * and moved — `pending()` alone would say nothing, since a consumed item
 * correctly drops out of that list.
 */
function findById(id) {
  if (!id) return null;
  return [...load()].reverse().find((e) => e.id === id) || null;
}

function markConsumed(id, reference, filedPath) {
  const entry = [...load()].reverse().find((e) => e.id === id);
  if (!entry) return null;
  return append({
    ...entry,
    status: "filed",
    matchedReference: reference,
    filedPath,
    filedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// Holding a vendor document
// ---------------------------------------------------------------------

/**
 * Save a vendor document into staging and index what was read from it.
 * The file is written to disk (not held in memory) so a restart never
 * loses paperwork that hasn't been matched yet.
 */
function stage({ id, messageId, buffer, fileName, mimeType, receivedAt, sender, extracted, caption }) {
  const dir = path.join(stagingDir(), String(id).replace(/[^A-Za-z0-9_-]/g, "_"));
  ensureDir(dir);

  const safeName = String(fileName || "document")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";

  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);

  return append({
    id,
    messageId,
    status: "waiting",
    receivedAt: receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt,
    stagedAt: new Date().toISOString(),
    sender,
    fileName: safeName,
    filePath,
    mimeType,
    caption: caption || null,
    extracted,
    // The fields matching actually runs on, lifted out for speed.
    match: {
      vehicleNo: normPlate(extracted?.vehicleNo),
      vendorDocNo: normDocNo(extracted?.vendorDocNo),
      vendorDocCore: docCore(extracted?.vendorDocNo),
      vendorName: normName(extracted?.vendorName),
      vendorGstin: (extracted?.vendorGstin || "").toUpperCase() || null,
      ewayBillNo: (extracted?.ewayBillNo || "").replace(/\D/g, "") || null,
      netWeight: toNumber(extracted?.netWeight),
      // Normalised to KG, so QTL/MT/KG all compare directly.
      quantityKg: toNumber(extracted?.quantityKg),
      // Often the ONLY field a bilty carries.
      grNumber: normDocNo(extracted?.grNumber),
      amount: toNumber(extracted?.totalAmount),
      documentTypes: extracted?.containedDocumentTypes?.length
        ? extracted.containedDocumentTypes
        : [extracted?.documentType].filter(Boolean),
    },
  });
}

// ---------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------

function normPlate(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(s) ? s : null;
}

/** "0032", "32", "AA/32" all reduce to "32". */
function normDocNo(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return null;
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * The numeric CORE of a document number — the trailing run of digits,
 * read before separators are stripped away.
 *
 * A vendor's own invoice is commonly numbered "MHI/2026-27/588", but our
 * reference only ever states the bare core, "588" — the financial-year
 * prefix isn't repeated there. Comparing full normalised strings
 * ("MHI202627588" vs "588") never matches; comparing just the trailing
 * digit run does, which is exactly the rule the SOP describes: match the
 * numeric core, don't fail over a missing prefix/suffix.
 */
function docCore(v) {
  const m = String(v || "").match(/(\d+)(?!.*\d)/);
  if (!m) return null;
  return m[1].replace(/^0+(?=\d)/, "");
}

function normName(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------

/**
 * Score how well a staged vendor document matches our document.
 *
 * The reference is authoritative: our invoice states the vendor code and
 * their document number, and that is the answer. Vehicle and quantity
 * exist to catch the case where OCR misread a digit of that number —
 * without them, one bad character would orphan a whole set.
 */
function scoreMatch(staged, ours) {
  const reasons = [];
  let score = 0;

  const wantVendorCode = (ours.reference?.vendorCode || "").toUpperCase();
  const wantVendorDoc = normDocNo(ours.reference?.vendorDocNo);
  const wantVendorDocCore = docCore(ours.reference?.vendorDocNo);

  // --- vendor document number from the reference ---
  //
  // Try the full normalised string first (covers the common case where
  // the reference states the vendor's number exactly as they printed
  // it). Fall back to comparing just the numeric core so a vendor
  // invoice numbered "MHI/2026-27/588" still matches a reference that
  // states only "588" — a missing prefix/suffix must never be treated
  // as a mismatch.
  if (wantVendorDoc && staged.match.vendorDocNo && staged.match.vendorDocNo === wantVendorDoc) {
    score += 50;
    reasons.push(`vendor document number ${wantVendorDoc} matches the reference`);
  } else if (wantVendorDocCore && staged.match.vendorDocCore && staged.match.vendorDocCore === wantVendorDocCore) {
    score += 50;
    reasons.push(
      `vendor document number matches the reference by numeric core (${wantVendorDocCore}, full number on file: ${staged.match.vendorDocNo || "—"})`
    );
  }

  // --- vendor identity ---
  if (wantVendorCode && staged.match.vendorName) {
    const vendorEntry = (ours.vendors || []).find(
      (v) => String(v.code || "").toUpperCase() === wantVendorCode
    );
    if (vendorEntry && normName(vendorEntry.name)) {
      const a = normName(vendorEntry.name);
      const b = staged.match.vendorName;
      if (a && b && (a.includes(b) || b.includes(a))) {
        score += 20;
        reasons.push(`vendor name matches ${vendorEntry.name}`);
      }
    }
  }

  // --- vehicle: the strongest physical link ---
  const ourVehicle = normPlate(ours.extracted?.vehicleNo);
  if (ourVehicle && staged.match.vehicleNo) {
    if (ourVehicle === staged.match.vehicleNo) {
      score += 40;
      reasons.push(`same vehicle ${ourVehicle}`);
    } else {
      // A different vehicle is strong evidence AGAINST, not just absence
      // of evidence — one truck carries one consignment.
      score -= 40;
      reasons.push(`different vehicle (${staged.match.vehicleNo} vs ${ourVehicle})`);
    }
  }

  // --- GR / LR / bilty number ---
  //
  // A bilty is handed over blank apart from this number — the rest is
  // filled in by the supervisor after our invoice is raised. So for that
  // one document this is not a corroborating signal, it is the ONLY
  // signal, and it has to carry the match on its own.
  const ourGr = normDocNo(ours.extracted?.grNumber);
  if (ourGr && staged.match.grNumber && ourGr === staged.match.grNumber) {
    score += 45;
    reasons.push(`GR/LR number ${ourGr} matches`);
  }

  // --- quantity, compared in kilograms ---
  //
  // The same load is written 42,330 KG by us, 423.30 QTL by the vendor
  // and 42.33 MT elsewhere. Comparing raw numbers made those look like
  // three different consignments; comparing kilograms makes them agree
  // exactly.
  const ourQty = toNumber(ours.extracted?.quantityKg) || toNumber(ours.extracted?.netWeight);
  const theirQty = staged.match.quantityKg || staged.match.netWeight;
  if (ourQty && theirQty) {
    const diff = Math.abs(ourQty - theirQty);
    // Gangakhed documents are deliberately raised 400-500 kg above the
    // weighbridge figure. Without allowing for that, every single GKD
    // supply reads as a quantity mismatch.
    const plantAdjustment = Number(ours.plantAdjustmentKg) || 0;
    const tolerance = Math.max(50, ourQty * 0.02) + plantAdjustment;
    if (diff <= tolerance) {
      score += 25;
      reasons.push(`quantity agrees (${Math.round(theirQty)} kg)`);
    } else {
      reasons.push(`quantity differs by ${Math.round(diff)} kg`);
    }
  }

  // --- e-way bill printed on both ---
  const ourEway = (ours.extracted?.ewayBillNo || "").replace(/\D/g, "");
  if (ourEway && staged.match.ewayBillNo && ourEway === staged.match.ewayBillNo) {
    score += 15;
    reasons.push("same e-way bill number");
  }

  return { score, reasons };
}

/**
 * A staged document by the WhatsApp message it arrived in.
 *
 * When our invoice is sent as a REPLY to a vendor's document — which is
 * exactly how this team works — that reply IS the pairing. A person
 * deliberately linked the two. No amount of field matching is more
 * reliable than that, so it short-circuits the scoring entirely.
 */
function findByMessageId(messageId) {
  if (!messageId) return null;
  return pending().find((e) => e.messageId === messageId) || null;
}

/**
 * Find the staged vendor documents belonging to one of our documents.
 *
 * @param {object} ours  { reference, extracted, vendors }
 * @param {object} options
 *   @param {number} options.minScore  default 50 — the reference alone clears it
 * @returns {Array<{ entry, score, reasons }>} best first
 */
function findMatches(ours, options = {}) {
  // 45 lets a bilty through on its GR number alone — that document has
  // nothing else printed on it, and holding it back forever was worse
  // than the small risk of a wrong match on a colliding serial.
  const minScore = options.minScore ?? 45;
  if (!ours.reference) return [];

  return pending()
    .map((entry) => ({ entry, ...scoreMatch(entry, ours) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/** Staged items older than this are worth flagging — a supply that never
 *  got our invoice usually means something went wrong upstream. */
function stale(hours = 48) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return pending().filter((e) => new Date(e.stagedAt).getTime() < cutoff);
}

function stats() {
  const waiting = pending();
  return {
    waiting: waiting.length,
    stale: stale().length,
    oldest: waiting.length ? waiting[waiting.length - 1].stagedAt : null,
    byVendor: waiting.reduce((acc, e) => {
      const key = e.extracted?.vendorName || "Unknown vendor";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  stage,
  findByMessageId,
  findById,
  pending,
  findMatches,
  markConsumed,
  scoreMatch,
  stale,
  stats,
  stagingDir,
  normPlate,
  normDocNo,
};
