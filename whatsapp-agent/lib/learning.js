/**
 * Biome Platform — WhatsApp Agent / learning
 * -------------------------------------------------------------------
 * "Agent ko train karo" — made concrete.
 *
 * There is no magic model to retrain offline. What CAN be done, and what
 * actually moves accuracy, is remembering every correction a person
 * makes and refusing to make the same mistake twice:
 *
 *   - A coordinator marks "VDR-843 Weighment.pdf" as a weight slip after
 *     the classifier called it "other" → next time a filename with those
 *     tokens arrives from that chat, it IS a weight slip, no OCR needed.
 *   - A receiving was matched to the wrong client because the slip
 *     spells "Jhajjar TPS" → the alias is learned against the client,
 *     and every future "Jhajjar TPS" resolves instantly.
 *
 * Rules are learned per (filename tokens + chat), because the same
 * coordinator posts the same document shapes to the same group month
 * after month — that regularity is the training data.
 *
 * Everything lives in config/learning.json next to the other settings,
 * owned by the user, readable and editable by hand.
 */

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");

const FILE = () => path.join(PATHS.configDir, "learning.json");

/** A learned rule must have won at least this often to OVERRIDE the
 *  classifier outright; below that it only breaks ties. Corrections are
 *  deliberate human acts, so the bar is low but not zero. */
const OVERRIDE_HITS = 1;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return {
      typeRules: Array.isArray(raw.typeRules) ? raw.typeRules : [],
      nameAliases: Array.isArray(raw.nameAliases) ? raw.nameAliases : [],
      corrections: Number(raw.corrections) || 0,
    };
  } catch {
    return { typeRules: [], nameAliases: [], corrections: 0 };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(data, null, 2), "utf8");
}

/** Filename → stable tokens: lowercase words, digits collapsed, so
 *  "VDR-843 Weighment.pdf" and "VDR-901 weighment.PDF" share a shape. */
function tokensOf(fileName) {
  return String(fileName || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\d+/g, "#")
    .split(/[^a-z#]+/)
    .filter((t) => t.length > 1);
}

function overlap(a, b) {
  const setB = new Set(b);
  const hit = a.filter((t) => setB.has(t)).length;
  return a.length ? hit / a.length : 0;
}

/**
 * A person corrected a document — remember why it was wrong.
 *
 * @param {object} c { fileName, chatJid, senderJid, documentType,
 *                     clientName, vendorCode, seenName }
 */
function recordCorrection(c) {
  const data = load();
  data.corrections += 1;

  // 1. Filename-shape → type rule.
  if (c.documentType && c.fileName) {
    const tokens = tokensOf(c.fileName);
    if (tokens.length) {
      const existing = data.typeRules.find(
        (r) =>
          r.documentType === c.documentType &&
          (r.chatJid || null) === (c.chatJid || null) &&
          overlap(r.tokens, tokens) >= 0.8 && overlap(tokens, r.tokens) >= 0.8
      );
      if (existing) {
        existing.hits += 1;
        existing.lastUsed = new Date().toISOString();
      } else {
        data.typeRules.push({
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          tokens,
          chatJid: c.chatJid || null,
          documentType: c.documentType,
          hits: 1,
          taughtAt: new Date().toISOString(),
          lastUsed: null,
        });
      }
    }
  }

  // 2. Name-as-seen → client/vendor alias. What the OCR actually read is
  // the spelling worth remembering, however mangled it looks.
  if (c.seenName && (c.clientName || c.vendorCode)) {
    const seen = String(c.seenName).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen && !data.nameAliases.some((a) => a.seen === seen)) {
      data.nameAliases.push({
        seen,
        clientName: c.clientName || null,
        vendorCode: c.vendorCode || null,
        taughtAt: new Date().toISOString(),
      });
    }
  }

  save(data);
  return data;
}

/**
 * Before trusting the classifier: has a person already taught us what
 * this shape of document is?
 *
 * @returns {{documentType, ruleId, hits, confidence}|null}
 */
function learnedType({ fileName, chatJid }) {
  const data = load();
  const tokens = tokensOf(fileName);
  if (!tokens.length) return null;

  let best = null;
  for (const r of data.typeRules) {
    // A rule bound to a chat only fires in that chat; an unbound rule
    // fires anywhere but scores lower than an exact chat match.
    const chatOk = !r.chatJid || r.chatJid === chatJid;
    if (!chatOk) continue;
    const score = Math.min(overlap(r.tokens, tokens), overlap(tokens, r.tokens));
    if (score < 0.75) continue;
    const rank = score + (r.chatJid ? 0.1 : 0) + Math.min(r.hits, 5) * 0.02;
    if (!best || rank > best.rank) best = { rule: r, rank, score };
  }
  if (!best) return null;

  best.rule.lastUsed = new Date().toISOString();
  save(data);
  return {
    documentType: best.rule.documentType,
    ruleId: best.rule.id,
    hits: best.rule.hits,
    strong: best.rule.hits >= OVERRIDE_HITS && best.score >= 0.8,
    confidence: Math.round(70 + Math.min(best.rule.hits, 6) * 5),
  };
}

/** Resolve a mangled name the way a person already taught us to. */
function learnedName(seenName) {
  const seen = String(seenName || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!seen) return null;
  const data = load();
  return data.nameAliases.find((a) => a.seen === seen || seen.includes(a.seen) || a.seen.includes(seen)) || null;
}

function summary() {
  const d = load();
  return { typeRules: d.typeRules.length, nameAliases: d.nameAliases.length, corrections: d.corrections };
}

module.exports = { recordCorrection, learnedType, learnedName, summary };
