/**
 * Biome Platform — WhatsApp Agent / store
 * -------------------------------------------------------------------
 * An append-only JSONL ledger of every document the agent has handled,
 * plus a derived in-memory view grouping them into "supply sets" (all
 * the paperwork sharing one coordination reference).
 *
 * JSONL rather than a single JSON blob so a crash mid-write can never
 * corrupt the whole history — at worst the last line is discarded.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");
const { matchClient, loadClients, REQUIREMENTS, DOC_TYPE_SATISFIES } = require("./clients");
const { dedupeSetDocuments } = require("./setDedupe");

/** Every document we've ever handled, newest last. */
let records = [];
let loaded = false;

function load() {
  if (loaded) return records;
  ensureDir(PATHS.dbDir);
  records = [];
  if (fs.existsSync(PATHS.documentsLog)) {
    const lines = fs.readFileSync(PATHS.documentsLog, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // A torn final line from an interrupted write — skip it.
      }
    }
  }
  loaded = true;
  return records;
}

function append(record) {
  load();
  ensureDir(PATHS.dbDir);
  fs.appendFileSync(PATHS.documentsLog, JSON.stringify(record) + "\n", "utf8");
  records.push(record);
  return record;
}

/** Replace a record in place (used when a document is re-processed or
 *  manually re-classified). The ledger keeps the old line as history and
 *  a newer line with the same id wins. */
function update(id, patch) {
  load();
  const existing = [...records].reverse().find((r) => r.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
  return append(updated);
}

/**
 * Drop records whose file is no longer on disk.
 *
 * People delete documents in Explorer — that's a normal thing to do with
 * a folder of files. The app kept listing them anyway, because the
 * ledger was never checked against reality. A list that shows documents
 * you deleted is worse than no list: you can't tell what you actually
 * have.
 *
 * This is done lazily on read rather than by watching the filesystem,
 * which keeps it correct without a watcher process to go wrong.
 */
function pruneMissing(records) {
  const kept = [];
  const vanished = [];
  for (const r of records) {
    // Staged and unfiled records have no path yet — they aren't missing.
    if (!r.filePath) {
      kept.push(r);
      continue;
    }
    if (fs.existsSync(r.filePath)) {
      kept.push(r);
    } else {
      vanished.push(r);
    }
  }
  // Record the removal so the ledger stays an honest history rather than
  // quietly forgetting.
  for (const r of vanished) {
    try {
      append({ ...r, deleted: true, deletedAt: new Date().toISOString(), deletedReason: "file removed from disk" });
    } catch {
      /* best effort — the filter below still hides it this session */
    }
  }
  return kept;
}

/** Latest version of every document, newest first. */
function all() {
  load();
  const byId = new Map();
  for (const r of records) byId.set(r.id, r);
  // Superseded versions are kept in the ledger as history but leave the
  // active list — otherwise a corrected bill and the bill it corrected
  // both show, with nothing saying which is current.
  const live = [...byId.values()].filter((r) => !r.deleted && !r.superseded);
  return pruneMissing(live).sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  );
}

function byId(id) {
  return all().find((r) => r.id === id) || null;
}

/** Has this exact WhatsApp message already been handled? */
function hasMessage(messageId) {
  load();
  return records.some((r) => r.messageId === messageId);
}

/**
 * Has this exact FILE been handled before, under any name?
 *
 * The same invoice gets forwarded repeatedly in these groups — once by
 * the coordinator, again by accounts, again when someone scrolls back.
 * Matching on message id alone misses all of that, because each forward
 * is a new message. Hashing the content catches every copy regardless
 * of who sent it or what they called it.
 */
function findByHash(sha256) {
  if (!sha256) return null;
  return all().find((r) => r.sha256 === sha256) || null;
}

/**
 * The SAME document arriving as different bytes — a merged PDF page and
 * the single file later, a re-scan, a photo of the same print. Byte
 * hashes miss all of these; the document's own identity catches them:
 * same type and the same number that only that document carries.
 */
function logicalKey(docType, ex) {
  if (!docType || !ex) return null;
  const n = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (docType === "biome_tax_invoice" || docType === "biome_delivery_challan") return n(ex.biomeDocNo) ? `${docType}:${n(ex.biomeDocNo)}` : null;
  if (docType === "vendor_tax_invoice" || docType === "vendor_delivery_challan") return n(ex.vendorDocNo) ? `${docType}:${n(ex.vendorCode)}:${n(ex.vendorDocNo)}` : null;
  if (docType === "biome_eway_bill" || docType === "vendor_eway_bill") return n(ex.ewayBillNo) ? `eway:${n(ex.ewayBillNo)}` : null;
  if (docType === "bilty_lr") return n(ex.grNumber || ex.lrNumber) ? `bilty:${n(ex.grNumber || ex.lrNumber)}` : null;
  if (docType === "receiving") return n(ex.vehicleNo) && ex.documentDate ? `receiving:${n(ex.vehicleNo)}:${String(ex.documentDate).slice(0, 10)}:${n(ex.clientName).slice(0, 12)}` : null;
  if (docType === "weight_slip") return n(ex.vehicleNo) && ex.documentDate && ex.netWeightKg ? `weight:${n(ex.vehicleNo)}:${String(ex.documentDate).slice(0, 10)}:${Math.round(Number(ex.netWeightKg) || 0)}` : null;
  if (docType === "consignment_tag") return n(ex.vehicleNo) && n(ex.biomeDocNo || ex.referenceNo) ? `tag:${n(ex.vehicleNo)}:${n(ex.biomeDocNo || ex.referenceNo)}` : null;
  return null;
}

function findLogicalDuplicate(docType, ex) {
  const key = logicalKey(docType, ex);
  if (!key) return null;
  return all().find((r) => r.bucket !== "_Duplicate" && r.extracted && logicalKey(r.extracted.documentType, r.extracted) === key) || null;
}

/**
 * Group documents into supply sets by coordination reference.
 * Documents without a reference are returned separately so they stay
 * visible instead of disappearing.
 */
/** Everything in kilograms, whatever unit it was written in. */
function toKg(value, unit) {
  const n = Number(String(value ?? "").replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  const u = String(unit || "").toLowerCase().replace(/[^a-z]/g, "");
  if (["qtl", "qntl", "quintal", "quintals"].includes(u)) return n * 100;
  if (["mt", "mts", "ton", "tons", "tonne", "tonnes"].includes(u)) return n * 1000;
  // No unit given: a bare figure under 200 is almost certainly tonnes or
  // quintals rather than a 150 kg truckload.
  if (n < 200) return n * 1000;
  return n;
}

function docKg(ex) {
  if (!ex) return null;
  return (
    toKg(ex.quantityKg) ||
    toKg(ex.netWeight) ||
    toKg(ex.totalQuantity, ex.quantityUnit) ||
    null
  );
}

function plate(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(s) ? s : null;
}

/** Trailing digits, so "545" and "SAI/26-27/0545" compare equal. */
function docNum(v) {
  const raw = String(v || "").toUpperCase().trim();
  if (!raw) return null;
  const tail = raw.match(/(\d+)\s*$/);
  return tail ? tail[1].replace(/^0+(?=\d)/, "") : null;
}

/** Within 2% or 50 kg, whichever is larger — vendors round to whole tonnes. */
function weightsAgree(a, b) {
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(50, a * 0.02);
}

/**
 * Pull unreferenced documents into the set they belong to.
 *
 * Mutates `sets` and removes what it claims from `unmatched`.
 */
function attachUnreferenced(sets, unmatched) {
  if (!sets.size || !unmatched.length) return;

  // What each set knows about itself, taken from OUR documents.
  const profiles = [...sets.values()].map((set) => {
    let vehicle = null;
    let billT = null;
    let kg = null;
    let date = null;
    for (const d of set.documents) {
      const ex = d.extracted || {};
      vehicle = vehicle || plate(ex.vehicleNo);
      billT = billT || docNum(ex.grNumber) || docNum(ex.billOfLadingNo) || docNum(ex.lrNumber);
      kg = kg || docKg(ex);
      date = date || ex.documentDate || null;
    }
    return {
      set,
      vehicle,
      billT,
      kg,
      date,
      vendorDocNo: docNum(set.vendorDocNo),
      vendorCode: String(set.vendorCode || "").toUpperCase(),
    };
  });

  const claimed = new Set();

  for (const doc of unmatched) {
    const ex = doc.extracted || {};
    const type = ex.documentType || "";
    const docVehicle = plate(ex.vehicleNo);
    const docKgValue = docKg(ex);
    const docBillT = docNum(ex.grNumber) || docNum(ex.billOfLadingNo) || docNum(ex.lrNumber);
    const docVendorNo = docNum(ex.vendorDocNo) || docNum(ex.vendorOwnDocNo) || docNum(ex.documentNumber);

    let best = null;
    let bestScore = 0;
    let bestWhy = [];

    for (const p of profiles) {
      let score = 0;
      const why = [];

      // The vendor's own document number, as named in the reference.
      if (p.vendorDocNo && docVendorNo && p.vendorDocNo === docVendorNo) {
        score += 50;
        why.push(`vendor document ${docVendorNo} is the one named in ${p.set.reference}`);
      }

      // Bill T: usually the only field on the page, and our invoice
      // prints the same number.
      if (p.billT && docBillT && p.billT === docBillT) {
        score += 45;
        why.push(`Bill T number ${docBillT} matches our invoice`);
      }

      // Vehicle: one truck carries one consignment, so a DIFFERENT
      // vehicle is evidence against, not merely absent evidence.
      if (p.vehicle && docVehicle) {
        if (p.vehicle === docVehicle) {
          score += 40;
          why.push(`same vehicle ${docVehicle}`);
        } else {
          score -= 40;
        }
      }

      if (weightsAgree(p.kg, docKgValue)) {
        score += 25;
        why.push(`weight agrees (${Math.round(docKgValue)} kg)`);
      }

      // A vendor name matching the code in the reference.
      const vendorName = String(ex.vendorName || "").toUpperCase();
      if (p.vendorCode && vendorName && vendorName.replace(/[^A-Z]/g, "").startsWith(p.vendorCode.replace(/[^A-Z]/g, ""))) {
        score += 15;
        why.push(`vendor name matches ${p.vendorCode}`);
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
        bestWhy = why;
      }
    }

    // 40 lets a bilty in on its Bill T number alone, and a weight slip in
    // on vehicle alone — which is all either document ever carries.
    if (best && bestScore >= 40) {
      doc.attachedBy = bestWhy;
      doc.attachScore = bestScore;
      best.set.documents.push(doc);
      best.set.vehicleNo = best.set.vehicleNo || docVehicle;
      best.set.vendorName = best.set.vendorName || ex.vendorName || null;
      if (new Date(doc.receivedAt) > new Date(best.set.lastSeen)) {
        best.set.lastSeen = doc.receivedAt;
      }
      claimed.add(doc.id);
    }
  }

  // Remove what was claimed, in place.
  for (let i = unmatched.length - 1; i >= 0; i--) {
    if (claimed.has(unmatched[i].id)) unmatched.splice(i, 1);
  }
}

/**
 * Work out which supply an unreferenced document belongs to.
 *
 * Only our own invoice prints the coordination reference. A vendor's
 * paperwork never does — so when someone opens "Tell me what this is"
 * for a vendor invoice, the reference box is blank and they have to go
 * and look it up by hand. That lookup is mechanical, and the app already
 * holds everything needed to do it:
 *
 *   BDC/840/SAI/545  ->  the vendor's document is number 545
 *   SAI/26-27/0545   ->  the vendor's invoice, whose trailing number is 545
 *
 * Match those, confirm with the vehicle and the quantity, and the answer
 * is certain. Returned with its reasons so the person can see WHY before
 * accepting it.
 *
 * @param {object} extracted  fields read off the document
 * @returns {{reference, confidence, reasons, clientName, date}|null}
 */
function suggestReference(extracted) {
  if (!extracted) return null;

  // A receiving is matched on its own terms: vehicle, client, and a
  // three-day window, resolved first-in-first-out when one truck
  // supplied more than once. None of the usual signals apply — the
  // client's slip carries no reference, no vendor and no Bill T.
  if (extracted.documentType === "receiving") {
    try {
      const { matchReceiving } = require("./clientDocs");
      const supplies = [];
      const seen = new Map();
      for (const d of all()) {
        const ref = d.reference?.canonical;
        if (!ref) continue;
        if (!seen.has(ref)) {
          seen.set(ref, {
            reference: ref,
            vehicle: null,
            clientName: null,
            date: null,
            hasReceiving: false,
            receivingWeightKg: null,
            receivingDate: null,
          });
          supplies.push(seen.get(ref));
        }
        const k = seen.get(ref);
        const ex = d.extracted || {};
        k.vehicle = k.vehicle || ex.vehicleNo || null;
        k.clientName = k.clientName || ex.clientName || null;
        k.date = k.date || ex.documentDate || null;
        if (ex.documentType === "receiving") {
          k.hasReceiving = true;
          k.receivingWeightKg = k.receivingWeightKg || Number(String(ex.netWeight || "").replace(/,/g, "")) || null;
          k.receivingDate = k.receivingDate || ex.documentDate || null;
        }
      }
      return matchReceiving(extracted, supplies);
    } catch {
      return null;
    }
  }

  // A lab report belongs to no single supply — it usually covers several
  // vehicles — so it is never matched to a reference.
  if (extracted.documentType === "lab_report") return null;

  const docVehicle = plate(extracted.vehicleNo);
  const docKgValue = docKg(extracted);
  const docNo =
    docNum(extracted.vendorOwnDocNo) ||
    docNum(extracted.vendorDocNo) ||
    docNum(extracted.documentNumber);
  const docBillT = docNum(extracted.grNumber) || docNum(extracted.billOfLadingNo);

  // Every supply we already know about, from documents that carry a
  // reference — that means our own invoices and challans.
  const known = new Map();
  for (const d of all()) {
    const ref = d.reference?.canonical;
    if (!ref) continue;
    if (!known.has(ref)) {
      known.set(ref, {
        reference: ref,
        vendorCode: String(d.reference.vendorCode || "").toUpperCase(),
        vendorDocNo: docNum(d.reference.vendorDocNo),
        vehicle: null,
        kg: null,
        billT: null,
        clientName: null,
        date: null,
      });
    }
    const k = known.get(ref);
    const ex = d.extracted || {};
    k.vehicle = k.vehicle || plate(ex.vehicleNo);
    k.kg = k.kg || docKg(ex);
    k.billT = k.billT || docNum(ex.grNumber) || docNum(ex.billOfLadingNo);
    k.clientName = k.clientName || ex.clientName || null;
    k.date = k.date || ex.documentDate || null;
  }

  let best = null;
  let bestScore = 0;
  let bestReasons = [];

  // The user's own rule, and it is the right one:
  //
  //   "ek din me ek vehicle ek baar hi supply kar sakta hai. but vendor
  //    repeat ho sakta hai, weight repeat ho sakta hai, aur reference no
  //    repeat ho sakta hai."
  //
  // So VEHICLE + DATE is the pair that cannot collide. Two supplies can
  // share a vendor, a weight, even a document number — but one truck
  // makes one trip in a day. That pair is treated as decisive, and
  // everything else corroborates it.
  for (const k of known.values()) {
    let score = 0;
    const reasons = [];

    const sameDay =
      k.date && extracted.documentDate && String(k.date).slice(0, 10) === String(extracted.documentDate).slice(0, 10);

    // The decisive one: our reference names the vendor's document number,
    // and the vendor's own invoice ends in that same number.
    if (k.vendorDocNo && docNo && k.vendorDocNo === docNo) {
      score += 50;
      reasons.push(`their invoice ends in ${docNo}, which is the number named in ${k.reference}`);
    }

    if (k.billT && docBillT && k.billT === docBillT) {
      // Our own invoice names this number under "Bill of Lading/LR-RR
      // No.", and a transporter's serial does not repeat within a day or
      // two. The bilty carries nothing else at all — it is handed over
      // blank — so this one field has to be able to place it on its own.
      // Enough on its own. Our invoice names this number under "Bill of
      // Lading/LR-RR No.", and a transporter's serial does not repeat
      // within a day or two. The bilty is handed over blank apart from
      // this number, so if it could not place the document alone, no
      // bilty would ever file itself.
      score += 92;
      reasons.push(`Bill T number ${docBillT} is the one printed on our invoice under Bill of Lading/LR-RR No.`);
    }

    if (k.vehicle && docVehicle) {
      if (k.vehicle === docVehicle) {
        score += 40;
        reasons.push(`same vehicle ${docVehicle}`);
        // Same truck AND same day is, by the nature of the work, the
        // same consignment. Nothing else needs to agree.
        if (sameDay) {
          score += 35;
          reasons.push(`same day (${String(k.date).slice(0, 10)}) — one truck makes one trip`);
        }
      } else {
        // A different truck rules this supply out entirely.
        score -= 60;
      }
    }

    const weightAgrees =
      k.kg && docKgValue && Math.abs(k.kg - docKgValue) <= Math.max(50, k.kg * 0.02);
    if (weightAgrees) {
      score += 25;
      reasons.push(`quantity agrees (${Math.round(docKgValue)} kg)`);

      // Vehicle AND weight both agreeing is two independent facts about
      // the same load. A weighbridge slip carries nothing else — often
      // not even a legible date — so this pair has to be enough for it
      // to file itself.
      if (k.vehicle && docVehicle && k.vehicle === docVehicle) {
        score += 25;
        reasons.push("vehicle and weight both match — this is that consignment");
      }
    }

    // On a manufacturing supply there is no vendor at all — the material
    // is ours. The weight slip and the Bill T are the only papers, and
    // they carry the vehicle and the Bill T number, nothing else. Without
    // this they could never reach the threshold.
    if (["REW", "GKD"].includes(k.vendorCode)) {
      if (k.vehicle && docVehicle && k.vehicle === docVehicle) {
        score += 20;
        reasons.push(`our own ${k.vendorCode} plant supply, same vehicle`);
      }
    }

    const vendorName = String(extracted.vendorName || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (k.vendorCode && vendorName.startsWith(k.vendorCode.replace(/[^A-Z]/g, ""))) {
      score += 15;
      reasons.push(`vendor name matches ${k.vendorCode}`);
    }

    if (score > bestScore) {
      bestScore = score;
      best = k;
      bestReasons = reasons;
    }
  }

  // ---- Last resort: look for what we already know inside the noise ----
  //
  // A photographed Hindi weighbridge slip OCRs to character soup, so
  // nothing can be extracted from it. But our invoice already states the
  // vehicle, the weight and the Bill T number — so the question is only
  // whether those values appear on this page, allowing for the
  // substitutions OCR makes (4 read as A, G as B). That turns a hopeless
  // extraction into a simple search.
  if (bestScore < 65 && extracted.transcription) {
    try {
      const { matchGarbledText } = require("./garbledMatch");
      const hit = matchGarbledText(
        extracted.transcription,
        [...known.values()].map((k) => ({
          reference: k.reference,
          vehicle: k.vehicle,
          kg: k.kg,
          billT: k.billT,
          date: k.date,
          clientName: k.clientName,
        }))
      );
      if (hit) return hit;
    } catch {
      /* the normal path already returned nothing */
    }
  }

  // 65 needs at least two independent agreements — the document number
  // plus a vehicle, or a vehicle plus a quantity. One signal alone is not
  // enough to fill a field on someone's behalf.
  if (!best || bestScore < 65) return null;

  return {
    reference: best.reference,
    confidence: Math.min(99, bestScore),
    reasons: bestReasons,
    clientName: best.clientName,
    date: best.date,
  };
}

function supplySets() {
  const docs = all();
  const sets = new Map();
  const unmatched = [];

  for (const d of docs) {
    const ref = d.reference?.canonical;
    if (!ref) {
      unmatched.push(d);
      continue;
    }
    if (!sets.has(ref)) {
      sets.set(ref, {
        reference: ref,
        companyCode: d.reference.companyCode,
        biomeDocNo: d.reference.biomeDocNo,
        vendorCode: d.reference.vendorCode,
        vendorDocNo: d.reference.vendorDocNo,
        clientName: null,
        vendorName: null,
        vehicleNo: null,
        receivingWeightKg: null,
        receivingDate: null,
        firstSeen: d.receivedAt,
        lastSeen: d.receivedAt,
        documents: [],
      });
    }
    const set = sets.get(ref);
    set.documents.push(d);
    // Prefer the first non-empty value we see for these summary fields.
    set.clientName = set.clientName || d.extracted?.clientName || null;
    set.vendorName = set.vendorName || d.extracted?.vendorName || null;
    set.vehicleNo = set.vehicleNo || d.extracted?.vehicleNo || null;
    if (d.extracted?.documentType === "receiving") {
      set.receivingWeightKg = set.receivingWeightKg || Number(String(d.extracted?.netWeight || "").replace(/,/g, "")) || null;
      set.receivingDate = set.receivingDate || d.extracted?.documentDate || null;
    }
    if (new Date(d.receivedAt) < new Date(set.firstSeen)) set.firstSeen = d.receivedAt;
    if (new Date(d.receivedAt) > new Date(set.lastSeen)) set.lastSeen = d.receivedAt;
  }

  // ---- Attach the documents that carry no reference of their own ----
  //
  // Only OUR tax invoice or delivery challan prints the coordination
  // reference. A vendor invoice, a weight slip and a bilty never do, so
  // grouping purely on that reference left every one of them stranded in
  // `unmatched` — the set could never be completed no matter how clearly
  // the documents belonged together.
  //
  // They are attached here on what they DO share with our invoice:
  //
  //   Bill T / bilty  — carries only its own number. Our invoice prints
  //                     that same number under "Bill of Lading/LR-RR No."
  //   Weight slip     — carries the vehicle number and the net weight,
  //                     both of which our invoice also states.
  //   Vendor invoice  — its number is named in the reference itself, and
  //                     it repeats the vehicle and the quantity.
  //
  // Weights are compared in kilograms because the same load is written
  // 33,995 KG by us, 33.995 Ton by the vendor and 339.95 QTL elsewhere.
  attachUnreferenced(sets, unmatched);

  const list = [...sets.values()].sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );

  // Work out what is still missing, per client. SOP section 7 gives every
  // client its own list, so a generic checklist would mislead — Jhajjar
  // wants a Tax Invoice and a COA, Nabha wants a Delivery Challan with a
  // DSC on it, and neither wants what the other does.
  const clients = loadClients();
  for (const set of list) {
    // Fold away re-shares BEFORE anything is counted. The same invoice
    // arriving four times was being counted as four documents, and — worse
    // — a copy that classified and a copy that did not were both credited,
    // so a set could read 3/6 collected on the strength of one paper sent
    // three times.
    const folded = dedupeSetDocuments(set.documents);
    set.documents = folded.documents;
    set.duplicates = folded.duplicates;
    set.duplicateCount = folded.duplicates.length;

    const client = matchClient(set.clientName, clients);
    set.clientMatched = Boolean(client);
    set.clientCanonicalName = client?.name || set.clientName || null;
    set.clientNotes = client?.notes || "";

    const required = client?.requires || [];
    const satisfied = new Set();
    let driverMobile = null;
    const dscSeenOn = new Set();

    for (const d of set.documents) {
      const type = d.extracted?.documentType;
      const req = type ? DOC_TYPE_SATISFIES[type] : null;
      if (req) satisfied.add(req);

      // A merged PDF delivers several documents at once. Crediting only
      // its primary type would leave the other three showing as missing
      // when they are sitting right there in the same file.
      for (const contained of d.extracted?.containedDocumentTypes || []) {
        const extra = DOC_TYPE_SATISFIES[contained];
        if (extra) satisfied.add(extra);
      }
      if (d.extracted?.driverMobile) driverMobile = d.extracted.driverMobile;
      if (d.extracted?.hasDigitalSignature && req) dscSeenOn.add(req);
    }
    if (driverMobile) satisfied.add("driver_mobile");
    set.driverMobile = driverMobile;

    set.missing = required
      .filter((r) => !satisfied.has(r))
      .map((r) => ({ key: r, label: REQUIREMENTS[r] || r }));

    // DSC is an attribute of a document, not a document of its own, so it
    // is reported separately rather than as another missing item.
    set.dscMissing = (client?.dscOn || [])
      .filter((r) => satisfied.has(r) && !dscSeenOn.has(r))
      .map((r) => ({ key: r, label: REQUIREMENTS[r] || r }));

    set.complete = client ? set.missing.length === 0 && set.dscMissing.length === 0 : false;
    set.requiredCount = required.length;
    set.satisfiedCount = required.filter((r) => satisfied.has(r)).length;
  }

  return { sets: list, unmatched };
}

/** Counts for the dashboard header. */
function stats() {
  const docs = all();
  const { sets } = supplySets();
  return {
    totalDocuments: docs.length,
    // Held vendor papers plus anything filed without a reference. These
    // are not chores — they're documents waiting on our invoice — but the
    // count is still worth surfacing.
    needsReview: docs.filter((d) => d.bucket === "_Staged" || d.bucket === "unmatched").length,
    staged: docs.filter((d) => d.bucket === "_Staged").length,
    unmatched: docs.filter((d) => d.bucket === "unmatched").length,
    notADocument: docs.filter((d) => d.bucket === "_Not A Document").length,
    filed: docs.filter((d) => d.bucket === "filed").length,
    totalSets: sets.length,
    completeSets: sets.filter((s) => s.complete).length,
    unknownClientSets: sets.filter((s) => !s.clientMatched).length,
  };
}

module.exports = {
  suggestReference, load, append, update, all, byId, hasMessage, findByHash, findLogicalDuplicate, logicalKey, supplySets, stats };
