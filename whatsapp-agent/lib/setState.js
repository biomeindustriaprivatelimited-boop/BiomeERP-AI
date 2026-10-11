/**
 * Biome Platform — WhatsApp Agent / supply-set verification state
 * -------------------------------------------------------------------
 * A supply set moves  Collecting → Ready to verify → Final.
 *
 * "Final" is the coordinator's double-check: they open the set, see the
 * checklist (every paper the client requires, our / vendor numbers,
 * vehicle, weights, dates agreeing) and press OK. From then on the set
 * is frozen: the agent never adds, moves or re-files anything in it, and
 * its documents cannot be moved out. Only admin / developer can reopen
 * it, with a reason, and every step is kept in the history.
 *
 * Stored at <DataRoot>/whatsapp/db/set-state.json, written through a
 * temp file so a reader never sees half of it.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");

function file() {
  return path.join(PATHS.dbDir, "set-state.json");
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return j && typeof j === "object" && j.sets ? j : { sets: {} };
  } catch {
    return { sets: {} };
  }
}

function save(state) {
  ensureDir(PATHS.dbDir);
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  fs.renameSync(tmp, file());
}

function get(reference) {
  return load().sets[reference] || null;
}

function isFinal(reference) {
  const s = get(reference);
  return Boolean(s && s.status === "final");
}

function finalReferences() {
  const out = new Set();
  for (const [ref, s] of Object.entries(load().sets)) if (s.status === "final") out.add(ref);
  return out;
}

function finalise(reference, by, snapshot = {}) {
  const state = load();
  const prev = state.sets[reference] || { history: [] };
  if (prev.status === "final") return { ok: false, error: "This supply set is already final." };
  const at = new Date().toISOString();
  state.sets[reference] = {
    ...prev,
    status: "final",
    finalisedAt: at,
    finalisedBy: by || null,
    documentIds: snapshot.documentIds || [],
    checklist: snapshot.checklist || null,
    note: snapshot.note || null,
    history: [...(prev.history || []), { action: "finalised", at, by: by || null, note: snapshot.note || null, documents: (snapshot.documentIds || []).length }],
  };
  save(state);
  return { ok: true, state: state.sets[reference] };
}

function reopen(reference, by, reason) {
  const state = load();
  const prev = state.sets[reference];
  if (!prev || prev.status !== "final") return { ok: false, error: "This supply set is not final." };
  const at = new Date().toISOString();
  state.sets[reference] = {
    ...prev,
    status: "open",
    reopenedAt: at,
    reopenedBy: by || null,
    reopenReason: reason,
    history: [...(prev.history || []), { action: "reopened", at, by: by || null, reason }],
  };
  save(state);
  return { ok: true, state: state.sets[reference] };
}

/** A set renamed (provisional → full reference) keeps its state. */
function rename(oldRef, newRef) {
  const state = load();
  if (!state.sets[oldRef] || state.sets[newRef]) return;
  state.sets[newRef] = state.sets[oldRef];
  delete state.sets[oldRef];
  save(state);
}

module.exports = { get, isFinal, finalReferences, finalise, reopen, rename, load };
