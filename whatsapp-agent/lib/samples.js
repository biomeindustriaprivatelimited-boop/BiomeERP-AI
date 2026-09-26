/**
 * Biome Platform — WhatsApp Agent / document samples
 * -------------------------------------------------------------------
 * "Main sample upload kar du, agent dekh kar samajh jaye" — this is
 * that, made real and honest.
 *
 * A person uploads a few REAL documents — our tax invoice, TBS's weight
 * slip, the consignment tag format APCPL wants — each labelled with what
 * it is. The agent reads each one the same way it reads WhatsApp
 * arrivals and keeps a FINGERPRINT: the distinctive words of that layout
 * ("weighbridge", "tare", the printer's header, the client's form
 * labels). A new arrival is compared against every fingerprint; a clear
 * match decides the type before any guessing starts.
 *
 * Why fingerprints and not "AI training": there is no model to retrain
 * on an offline plant PC, and pretending otherwise would just hide the
 * errors. Word-overlap against known-good exemplars is simple, fast,
 * inspectable (config/samples.json is plain JSON), and exactly matches
 * the problem — the SAME half-dozen document layouts arrive every day.
 *
 * Accuracy honesty: a match only DECIDES when it is strong AND clearly
 * ahead of the runner-up type. A weak or contested match only advises.
 */

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");

const FILE = () => path.join(PATHS.configDir, "samples.json");

/** Similarity a sample must reach to decide the type outright. */
const DECIDE_AT = 0.55;
/** How far ahead of the best OTHER type it must be to decide. */
const CLEAR_MARGIN = 0.12;

const STOPWORDS = new Set(
  ("the of and to in for a an is are this that with by on at from as be or " +
   "no date total amount state name address gstin india pvt ltd limited private").split(" ")
);

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(raw.samples) ? raw.samples : [];
  } catch {
    return [];
  }
}

function save(samples) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify({ samples, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

/**
 * Text → fingerprint tokens. Numbers collapse to '#' so an invoice's
 * layout matches regardless of which truck or date is on it; short and
 * stop words drop; the rest is capped so one wordy page can't dominate.
 */
function fingerprint(text) {
  const counts = new Map();
  const words = String(text || "")
    .toLowerCase()
    .replace(/\d[\d,./-]*/g, " # ")
    .split(/[^a-z#]+/);
  for (const w of words) {
    if (w.length < 3 && w !== "#") continue;
    if (STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.keys()].slice(0, 120);
}

function similarity(tokensA, tokensB) {
  if (!tokensA?.length || !tokensB?.length) return 0;
  const b = new Set(tokensB);
  let hit = 0;
  for (const t of tokensA) if (b.has(t)) hit += 1;
  // Overlap against the SMALLER set: a one-line weight slip inside a
  // wordy invoice must not look like a strong invoice match.
  return hit / Math.min(tokensA.length, tokensB.length);
}

function addSample({ documentType, label, fileName, text }) {
  const tokens = fingerprint(text);
  if (tokens.length < 8) {
    return { error: "Too little readable text in that file to learn a fingerprint from. A clearer scan of the same document will work." };
  }
  const samples = load();
  const sample = {
    id: `smp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    documentType,
    label: label || fileName || documentType,
    fileName: fileName || null,
    tokens,
    addedAt: new Date().toISOString(),
    matches: 0,
  };
  samples.push(sample);
  save(samples);
  return { sample: publicView(sample) };
}

function removeSample(id) {
  const samples = load();
  const next = samples.filter((s) => s.id !== id);
  save(next);
  return next.length !== samples.length;
}

function listSamples() {
  return load().map(publicView);
}

function publicView(s) {
  return { id: s.id, documentType: s.documentType, label: s.label, fileName: s.fileName, addedAt: s.addedAt, matches: s.matches, tokenCount: s.tokens.length };
}

/**
 * Which taught document does this new arrival look like?
 *
 * @returns {{documentType, similarity, sampleId, label, decide}|null}
 */
function matchSamples(text) {
  const samples = load();
  if (!samples.length) return null;
  const tokens = fingerprint(text);
  if (tokens.length < 8) return null;

  let best = null;
  const bestPerType = new Map();
  for (const s of samples) {
    const sim = similarity(tokens, s.tokens);
    const cur = bestPerType.get(s.documentType) || 0;
    if (sim > cur) bestPerType.set(s.documentType, sim);
    if (!best || sim > best.similarity) best = { documentType: s.documentType, similarity: sim, sampleId: s.id, label: s.label };
  }
  if (!best || best.similarity < 0.35) return null;

  let runnerUp = 0;
  for (const [type, sim] of bestPerType) {
    if (type !== best.documentType && sim > runnerUp) runnerUp = sim;
  }
  best.decide = best.similarity >= DECIDE_AT && best.similarity - runnerUp >= CLEAR_MARGIN;

  if (best.decide) {
    const all = load();
    const hit = all.find((s) => s.id === best.sampleId);
    if (hit) { hit.matches = (hit.matches || 0) + 1; save(all); }
  }
  return best;
}

module.exports = { addSample, removeSample, listSamples, matchSamples, fingerprint };
