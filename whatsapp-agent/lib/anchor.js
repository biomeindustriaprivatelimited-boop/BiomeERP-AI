/**
 * Biome Platform — WhatsApp Agent / anchoring
 * -------------------------------------------------------------------
 * Keeps one supply's paperwork in one folder.
 *
 * The folder a document belongs in is decided by the date on OUR tax
 * invoice or delivery challan for that reference — not by the date on the
 * document itself. Vendor papers usually arrive first, before that date
 * is known, so they get placed on their own date and moved here once our
 * document turns up.
 */

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");
const { planFiling, saveFile } = require("./filing");
const store = require("./store");

/**
 * The date the whole supply set is filed under: the date on OUR tax
 * invoice or delivery challan for this reference.
 *
 * Returns null until one of our documents for that reference has been
 * read, which is why vendor papers arriving first get placed on their own
 * date and moved later by reanchorReference().
 */
function anchorDateFor(referenceCanonical) {
  if (!referenceCanonical) return null;
  for (const d of store.all()) {
    if (d.reference?.canonical !== referenceCanonical) continue;
    const t = d.extracted?.documentType;
    if (t === "biome_tax_invoice" || t === "biome_delivery_challan") {
      if (d.extracted?.documentDate) return d.extracted.documentDate;
    }
  }
  return null;
}

/**
 * Pull every already-filed document for a reference onto the correct
 * anchor date. Runs the moment one of our invoices/challans lands, so a
 * set that trickled in over three days still ends up in one folder.
 */
function reanchorReference(referenceCanonical, anchorDate, logFn = () => {}) {
  if (!referenceCanonical || !anchorDate) return 0;
  let moved = 0;

  for (const rec of store.all()) {
    if (rec.reference?.canonical !== referenceCanonical) continue;
    if (rec.bucket !== "filed" || !rec.filePath) continue;
    if (!fs.existsSync(rec.filePath)) continue;

    const plan = planFiling({
      reference: rec.reference,
      extracted: rec.extracted,
      originalName: rec.originalName,
      mimeType: rec.mimeType,
      receivedAt: new Date(rec.receivedAt),
      senderName: rec.sender?.name || rec.sender?.chatJid || "Unknown",
      anchorDate,
    });

    const targetDir = plan.dir;
    if (path.resolve(path.dirname(rec.filePath)) === path.resolve(targetDir)) continue;

    try {
      const buffer = fs.readFileSync(rec.filePath);
      const saved = saveFile(plan, buffer);
      if (saved.filePath !== rec.filePath) {
        // Only unlink once the new copy is safely on disk.
        try {
          fs.unlinkSync(rec.filePath);
        } catch {
          /* a stray duplicate is better than a lost document */
        }
        // Tidy up the folder we just emptied, but never anything above it.
        try {
          const oldDir = path.dirname(rec.filePath);
          if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir);
        } catch {
          /* non-fatal */
        }
        store.update(rec.id, {
          filePath: saved.filePath,
          relativePath: path.relative(PATHS.inbox, saved.filePath),
          anchored: true,
        });
        moved += 1;
        logFn(`re-anchored ${path.basename(saved.filePath)} -> ${path.relative(PATHS.inbox, saved.filePath)}`);
      }
    } catch (err) {
      logFn(`could not re-anchor ${rec.id}: ${err.message}`);
    }
  }
  return moved;
}


/** Sweep every known reference onto its anchor date. */
function reanchorAll(logFn = () => {}) {
  const refs = new Set(store.all().map((d) => d.reference?.canonical).filter(Boolean));
  let moved = 0;
  for (const ref of refs) {
    const anchor = anchorDateFor(ref);
    if (anchor) moved += reanchorReference(ref, anchor, logFn);
  }
  return { references: refs.size, moved };
}

module.exports = { anchorDateFor, reanchorReference, reanchorAll };
