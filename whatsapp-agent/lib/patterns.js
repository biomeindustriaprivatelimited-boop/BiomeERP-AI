/**
 * Biome Platform — pattern memory
 * -------------------------------------------------------------------
 * How the agent gets better at YOUR paperwork over time.
 *
 * WHAT THIS IS NOT
 * It does not retrain a model. Training a language model needs a GPU,
 * thousands of labelled examples and hours per run — none of which is
 * happening on an office PC while Tally is open. Anyone promising that
 * on this hardware is selling something.
 *
 * WHAT IT ACTUALLY DOES
 * It remembers what worked. Every document that gets filed correctly —
 * and especially every one you correct by hand — leaves behind a
 * pattern:
 *
 *   "files from Rekha Sharma named like HR61D4137_BILL309_… are
 *    vendor tax invoices from A R Trading"
 *   "documents mentioning JHAJJAR go to Jhajjar Power Limited"
 *   "this vendor's e-way bills always have four pages"
 *
 * Next time something similar arrives, those patterns are consulted
 * before anything else. A correction you make once stops being a
 * correction you make again — which is the practical difference between
 * a tool that learns and one that doesn't.
 *
 * Everything is stored as plain JSON on your machine. Nothing is sent
 * anywhere, and you can read or delete it yourself.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");

function patternsFile() {
  return path.join(PATHS.configDir, "learned-patterns.json");
}

const EMPTY = {
  version: 1,
  updatedAt: null,
  /** senderName -> { documentType -> count } */
  senders: {},
  /** a filename shape -> { documentType -> count, vendor -> count } */
  fileNameShapes: {},
  /** a distinctive phrase -> { documentType -> count } */
  phrases: {},
  /** vendorName -> { clientName -> count } — who supplies whom */
  vendorToClient: {},
  /** vendorName -> { documentType -> typical page count } */
  vendorPageCounts: {},
  /** Corrections you made by hand. Weighted far above anything inferred. */
  corrections: [],
  stats: { learned: 0, corrections: 0, applied: 0 },
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(patternsFile())) {
      cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(patternsFile(), "utf8")) };
      return cache;
    }
  } catch {
    // A corrupt file shouldn't stop the agent — start fresh.
  }
  cache = JSON.parse(JSON.stringify(EMPTY));
  return cache;
}

function save() {
  if (!cache) return;
  cache.updatedAt = new Date().toISOString();
  ensureDir(PATHS.configDir);
  const tmp = `${patternsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(tmp, patternsFile());
}

// ---------------------------------------------------------------------
// Turning a filename into a reusable shape
// ---------------------------------------------------------------------

/**
 * "HR61D4137_BILL309_31072026.pdf" -> "AA00A0000_BILL000_00000000"
 *
 * Digits become 0 and letters become A, so the SHAPE survives while the
 * specific vehicle and bill number fall away. That's what lets one
 * example teach the agent about every future file from the same sender.
 */
function fileNameShape(name) {
  return String(name || "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\d/g, "0")
    .replace(/[A-Za-z]/g, (c) => (c === c.toUpperCase() ? "A" : "a"))
    .replace(/0{2,}/g, (m) => "0".repeat(Math.min(m.length, 8)))
    .slice(0, 60);
}

/** Distinctive phrases worth remembering — company and plant names. */
function phrasesFrom(text) {
  const found = new Set();
  const upper = String(text || "").toUpperCase();
  // Runs of 2-4 capitalised words look like proper nouns, which is what
  // distinguishes one vendor's paperwork from another's.
  const re = /\b([A-Z][A-Z&.]{2,}(?:\s+[A-Z][A-Z&.]{2,}){1,3})\b/g;
  let m;
  while ((m = re.exec(upper)) && found.size < 12) {
    const phrase = m[1].trim();
    if (phrase.length >= 8 && phrase.length <= 45) found.add(phrase);
  }
  return [...found];
}

function bump(bucket, key, value, by = 1) {
  if (!key || !value) return;
  if (!bucket[key]) bucket[key] = {};
  bucket[key][value] = (bucket[key][value] || 0) + by;
}

// ---------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------

/**
 * Record what a successfully handled document looked like.
 *
 * @param {object} doc
 *   fileName, senderName, documentType, vendorName, clientName,
 *   transcription, pageCount
 * @param {object} options
 *   @param {boolean} options.corrected  a human fixed this — weigh it heavily
 */
function learn(doc, options = {}) {
  if (!doc?.documentType || doc.documentType === "other") return;
  const p = load();
  // A human correction is worth far more than the agent agreeing with
  // itself, so it lands with five times the weight.
  const weight = options.corrected ? 5 : 1;

  if (doc.senderName) bump(p.senders, doc.senderName, doc.documentType, weight);
  if (doc.fileName) bump(p.fileNameShapes, fileNameShape(doc.fileName), doc.documentType, weight);
  if (doc.vendorName && doc.clientName) bump(p.vendorToClient, doc.vendorName, doc.clientName, weight);

  for (const phrase of phrasesFrom(doc.transcription)) {
    bump(p.phrases, phrase, doc.documentType, weight);
  }

  if (doc.vendorName && doc.pageCount) {
    if (!p.vendorPageCounts[doc.vendorName]) p.vendorPageCounts[doc.vendorName] = {};
    p.vendorPageCounts[doc.vendorName][doc.documentType] = doc.pageCount;
  }

  p.stats.learned += 1;
  if (options.corrected) {
    p.stats.corrections += 1;
    p.corrections.push({
      at: new Date().toISOString(),
      fileName: doc.fileName || null,
      shape: doc.fileName ? fileNameShape(doc.fileName) : null,
      sender: doc.senderName || null,
      correctedTo: doc.documentType,
      vendorName: doc.vendorName || null,
      clientName: doc.clientName || null,
    });
    // Keep the last 500 — enough to spot a pattern, small enough to load
    // instantly.
    if (p.corrections.length > 500) p.corrections = p.corrections.slice(-500);
  }

  save();
}

// ---------------------------------------------------------------------
// Applying what was learned
// ---------------------------------------------------------------------

function best(bucket, key) {
  const counts = bucket?.[key];
  if (!counts) return null;
  let bestValue = null;
  let bestCount = 0;
  let total = 0;
  for (const [value, count] of Object.entries(counts)) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  if (!bestValue || total < 2) return null; // one sighting isn't a pattern
  return { value: bestValue, count: bestCount, share: bestCount / total };
}

/**
 * What do the learned patterns suggest for this document?
 *
 * Returns a suggestion with its own confidence and the reasons behind
 * it, so the caller can decide how much weight to give it — and so the
 * UI can explain why a document was filed the way it was.
 */
function suggest({ fileName, senderName, transcription, vendorName }) {
  const p = load();
  const votes = {};
  const reasons = [];

  const addVote = (type, weight, reason) => {
    if (!type) return;
    votes[type] = (votes[type] || 0) + weight;
    reasons.push(reason);
  };

  // Filename shape is the strongest signal — the same sender producing
  // the same shape almost always means the same document.
  if (fileName) {
    const hit = best(p.fileNameShapes, fileNameShape(fileName));
    if (hit && hit.share >= 0.6) {
      addVote(hit.value, 40 * hit.share, `filenames shaped like this were ${hit.value.replace(/_/g, " ")} ${hit.count} time(s)`);
    }
  }

  if (senderName) {
    const hit = best(p.senders, senderName);
    if (hit && hit.share >= 0.7) {
      addVote(hit.value, 20 * hit.share, `${senderName} usually sends ${hit.value.replace(/_/g, " ")}`);
    }
  }

  for (const phrase of phrasesFrom(transcription)) {
    const hit = best(p.phrases, phrase);
    if (hit && hit.share >= 0.7) {
      addVote(hit.value, 15 * hit.share, `documents mentioning "${phrase}" were ${hit.value.replace(/_/g, " ")}`);
    }
  }

  let documentType = null;
  let score = 0;
  for (const [type, weight] of Object.entries(votes)) {
    if (weight > score) {
      score = weight;
      documentType = type;
    }
  }

  // Which client this vendor usually supplies — useful when the
  // consignee is illegible.
  let clientName = null;
  if (vendorName) {
    const hit = best(p.vendorToClient, vendorName);
    if (hit && hit.share >= 0.6) {
      clientName = hit.value;
      reasons.push(`${vendorName} usually supplies ${hit.value}`);
    }
  }

  if (documentType || clientName) p.stats.applied += 1;

  return {
    documentType,
    clientName,
    confidence: Math.min(75, Math.round(score)), // learned patterns cap below a real read
    reasons,
  };
}

/** What the agent has picked up so far — shown in the UI. */
function summary() {
  const p = load();
  const topShapes = Object.entries(p.fileNameShapes)
    .map(([shape, counts]) => {
      const b = best(p.fileNameShapes, shape);
      return b ? { shape, type: b.value, count: b.count } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    updatedAt: p.updatedAt,
    stats: p.stats,
    knownSenders: Object.keys(p.senders).length,
    knownFileShapes: Object.keys(p.fileNameShapes).length,
    knownPhrases: Object.keys(p.phrases).length,
    vendorClientLinks: Object.keys(p.vendorToClient).length,
    recentCorrections: p.corrections.slice(-10).reverse(),
    topShapes,
  };
}

/**
 * Deliberately NOT offered.
 *
 * Learned patterns are how the agent adapts its own rules to this
 * business, and that knowledge compounds — a correction made in July
 * still pays off in December. Wiping it would silently undo months of
 * accumulated accuracy, and nobody clicking a button labelled "reset"
 * expects to lose that.
 *
 * A wrong pattern doesn't need a reset either: it is outvoted the next
 * time a correction points the other way, because corrections carry
 * five times the weight of an inference.
 */

module.exports = { learn, suggest, summary, fileNameShape, phrasesFrom };
