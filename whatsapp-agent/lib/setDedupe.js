"use strict";

/**
 * Biome Platform — collapsing duplicates inside a supply set
 * -------------------------------------------------------------------
 * The same invoice gets shared into the group more than once, all the
 * time: the coordinator sends it, the plant asks again, someone forwards
 * it back, WhatsApp re-compresses it on the way. Every one of those
 * arrives as a fresh message and became a separate row in the set.
 *
 * What that broke:
 *
 *   - The count lied. "4 documents" against one invoice shared four times.
 *   - Rows would not open. A re-share is often stored once and pointed at
 *     by several ledger rows; when the extra copy is not on disk, the row
 *     opens to "file is no longer on disk".
 *   - Some copies classify and some do not — the screenshot shows the same
 *     PDF as "Biome Tax Invoice" twice and "Unclassified" twice, because
 *     the AI ran again on a re-compressed copy and was less sure.
 *
 * So duplicates are collapsed to ONE row, and the one kept is the best of
 * them rather than the newest. Nothing is deleted: the copies stay on the
 * set as `duplicates` so the page can say how many were folded away and
 * anyone can still reach them.
 */

/**
 * How two rows are judged to be the same document.
 *
 * In order of trust:
 *   1. sha256 — identical bytes. Beyond argument.
 *   2. Our document number plus the type. WhatsApp re-encodes a PDF on
 *      re-share, so identical bytes cannot be relied on, but the invoice
 *      number printed inside it does not change.
 *   3. The file name, normalised. A forward keeps the name; the copies in
 *      the screenshot are all "Sales Haryana_BI-26-27-HR0996.pdf".
 *
 * Deliberately NOT used: the vehicle number on its own. One vehicle can
 * legitimately carry a weight slip AND a bilty AND an invoice, and keying
 * on it would fold three different documents into one.
 */
function knownType(doc) {
  const t = doc.extracted?.documentType;
  return t && t !== "unknown" && t !== "unclassified" ? t : null;
}

/** Identical bytes. Beyond argument. */
function hashKey(doc) {
  return doc.sha256 ? `sha:${doc.sha256}` : null;
}

/**
 * Our own document number plus the type. WhatsApp re-encodes a PDF on
 * re-share so the bytes change, but the invoice number printed inside it
 * does not.
 */
function documentKey(doc) {
  const type = knownType(doc);
  const ourNo =
    doc.extracted?.biomeDocNo ||
    doc.reference?.biomeDocNo ||
    doc.extracted?.invoiceNo ||
    "";
  return type && ourNo ? `doc:${type}:${String(ourNo).trim().toLowerCase()}` : null;
}

/**
 * The file name, normalised. A forward keeps the name — the four copies in
 * the screenshot are all "Sales Haryana_BI-26-27-HR0996.pdf".
 *
 * Ignored when it is too short to mean anything ("scan.pdf"), because a
 * generic name is not evidence that two papers are the same paper.
 */
function nameKey(doc) {
  const name = normaliseName(doc.fileName || doc.name || "");
  return name.length >= 6 ? `name:${name}` : null;
}

/**
 * File names as WhatsApp mangles them: "invoice.pdf", "invoice (1).pdf"
 * and "invoice-2.pdf" are the same document forwarded three times.
 */
function normaliseName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,6}$/, "")
    .replace(/[\s_]+/g, " ")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[-\s]+\d{1,2}$/, "")
    .trim();
}

/**
 * Group documents that are the same document.
 *
 * Three kinds of evidence, merged transitively — which matters more than
 * it sounds. In the real case that prompted this, two copies classified as
 * a tax invoice and two did not. Keyed on the invoice number, the first
 * pair grouped; keyed on the file name, all four did. Taking only the
 * strongest available key per document split one document into two, and
 * the set still over-counted. They have to be unioned, not ranked.
 *
 * The name is the weakest evidence and carries a veto: if a group of
 * same-named files contains two DIFFERENT known document types, the name
 * is a coincidence and they are left apart. One vehicle really does carry
 * a weight slip, a bilty and an invoice, and folding those together would
 * destroy a genuine set rather than tidy a duplicated one.
 */
function groupDocuments(documents) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const d of documents) parent.set(d.id, d.id);

  const byKey = new Map();
  const push = (key, doc) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(doc);
  };

  for (const d of documents) {
    push(hashKey(d), d);
    push(documentKey(d), d);
  }
  for (const [, docs] of byKey) {
    for (let i = 1; i < docs.length; i++) union(docs[0].id, docs[i].id);
  }

  // The name pass, with its veto.
  const byName = new Map();
  for (const d of documents) {
    const k = nameKey(d);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(d);
  }
  for (const [, docs] of byName) {
    const types = new Set(docs.map(knownType).filter(Boolean));
    if (types.size > 1) continue;
    for (let i = 1; i < docs.length; i++) union(docs[0].id, docs[i].id);
  }

  const groups = new Map();
  for (const d of documents) {
    const root = find(d.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(d);
  }
  return [...groups.values()];
}

/**
 * Which copy to keep.
 *
 * A classified copy always beats an unclassified one — that is the whole
 * point, since the set's requirement count is built from the type. After
 * that, the copy that extracted the most, then the earliest, because the
 * first time a document arrived is when it actually arrived.
 */
function score(doc) {
  let s = 0;
  const type = doc.extracted?.documentType;
  if (type && type !== "unknown" && type !== "unclassified") s += 1000;
  if (doc.aiStatus === "ok") s += 200;
  if (doc.filePath) s += 400;               // a copy that can be opened
  if (doc.extracted) s += Object.values(doc.extracted).filter(Boolean).length;
  if (doc.reviewRequired) s -= 50;
  return s;
}

/**
 * Fold a set's documents down to one row per real document.
 *
 * Returns the kept rows and the copies that were folded away. Pure — the
 * caller decides what to do with each, and it can be run over a real
 * export to check it against what a person would have said.
 */
function dedupeSetDocuments(documents) {
  const kept = [];
  const duplicates = [];

  for (const group of groupDocuments(documents || [])) {
    if (group.length === 1) { kept.push(group[0]); continue; }

    const ranked = [...group].sort(
      (a, b) => score(b) - score(a) || String(a.receivedAt).localeCompare(String(b.receivedAt))
    );
    const winner = ranked[0];
    const rest = ranked.slice(1);

    // The kept row carries the EARLIEST arrival time, not its own. The
    // document reached us when the first copy landed; showing the time of
    // the third forward would make a paper look late that was not.
    const earliest = group.reduce(
      (min, d) => (String(d.receivedAt) < String(min) ? d.receivedAt : min),
      group[0].receivedAt
    );

    kept.push({
      ...winner,
      receivedAt: earliest,
      duplicateCount: rest.length,
      duplicateIds: rest.map((d) => d.id),
      // If the chosen copy has no bytes on disk but another does, point at
      // that one. This is the row that would otherwise refuse to open.
      filePath: winner.filePath || rest.find((d) => d.filePath)?.filePath || null,
    });
    duplicates.push(...rest);
  }

  kept.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  return { documents: kept, duplicates };
}

module.exports = { dedupeSetDocuments, groupDocuments, normaliseName, score };
