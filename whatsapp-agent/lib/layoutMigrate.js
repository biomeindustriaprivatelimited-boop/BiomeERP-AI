/**
 * Biome Platform — WhatsApp Agent / folder layout migration
 * -------------------------------------------------------------------
 * The owner's layout is   Month / Client / OUR document date / files,
 * every file name starting with its reference (BDC_841_AA_37 - …).
 * Older builds put one more folder per reference under the date. This
 * moves every already-filed supply onto the new layout ONCE:
 *
 *   - copy first, delete the old copy only after the new one is on disk
 *     (anchor.reanchorReference does exactly that);
 *   - FINAL sets are never touched;
 *   - afterwards every filed document is checked: its file must exist and
 *     have the same bytes (sha256) as before. Any problem → the marker is
 *     NOT written, so the check runs again next start, and it is logged;
 *   - running it again moves nothing (idempotent).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PATHS } = require("./paths");
const store = require("./store");
const { reanchorAll } = require("./anchor");

const LAYOUT_VERSION = "month-client-date-refprefix-v1";

function hashFile(p) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
}

/** Remove now-empty folders under the inbox (deepest first), never the inbox itself. */
function pruneEmpty(dir, depth = 0) {
  let removed = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) if (e.isDirectory()) removed += pruneEmpty(path.join(dir, e.name), depth + 1);
  if (depth >= 3) {
    try {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        removed += 1;
      }
    } catch {
      /* non-fatal */
    }
  }
  return removed;
}

function markerFile() {
  return path.join(PATHS.root, "runtime", "wa-layout.json");
}

function migrateLayout(logFn = () => {}, { force = false } = {}) {
  let done = null;
  try {
    done = JSON.parse(fs.readFileSync(markerFile(), "utf8"));
  } catch {
    /* first run */
  }
  if (!force && done && done.version === LAYOUT_VERSION && !done.problems) return { skipped: true, ...done };

  // 1. What is on disk now.
  const before = new Map();
  for (const r of store.all()) {
    if (r.bucket !== "filed" || !r.filePath || !fs.existsSync(r.filePath)) continue;
    before.set(r.id, hashFile(r.filePath));
  }

  // 2. Move.
  const { moved, references } = reanchorAll(logFn);

  // 3. Verify nothing was lost.
  const problems = [];
  for (const [id, sha] of before) {
    const r = store.byId(id);
    if (!r || !r.filePath || !fs.existsSync(r.filePath)) {
      problems.push(`${id}: file missing after the move`);
      continue;
    }
    if (sha && hashFile(r.filePath) !== sha) problems.push(`${id}: file changed during the move`);
  }
  const pruned = pruneEmpty(PATHS.inbox);
  const result = { version: LAYOUT_VERSION, at: new Date().toISOString(), references, documents: before.size, moved, emptyFoldersRemoved: pruned, problems: problems.length ? problems.slice(0, 50) : null };
  if (problems.length) {
    logFn(`folder layout: ${problems.length} problem(s) after moving — will check again next start: ${problems.slice(0, 5).join("; ")}`);
  } else {
    if (moved || !done) logFn(`folder layout: ${moved} file(s) moved to Month / Client / Date (${before.size} filed document(s) verified, ${pruned} empty folder(s) removed)`);
  }
  try {
    fs.mkdirSync(path.dirname(markerFile()), { recursive: true });
    if (!problems.length) fs.writeFileSync(markerFile(), JSON.stringify(result, null, 2), "utf8");
  } catch {
    /* runs again next start */
  }
  return result;
}

module.exports = { migrateLayout, LAYOUT_VERSION };
