/**
 * Biome Platform — finding known values inside garbled OCR
 * -------------------------------------------------------------------
 * A photographed Hindi weighbridge slip OCRs to something like:
 *
 *   gr E—C, | >a A°
 *   A HRA7B7716 2
 *   Ey ori =121@ 05/08/2026
 *
 * Extracting fields from that is hopeless. HR47G7716 came out as
 * HRA7B7716 — a 4 read as A, a G read as B.
 *
 * But the problem can be turned around. We are not trying to learn
 * something new from the page: our own invoice already told us the
 * vehicle is HR47G7716, the weight is 15,510 kg and the Bill T is 210.
 * The only question is whether THIS page is about THAT supply. So
 * instead of reading the page and hoping, we look for values we already
 * know, allowing for the substitutions OCR actually makes.
 *
 * That converts an impossible extraction problem into an easy search.
 */

/**
 * Characters OCR routinely swaps. Grouped by what they look like, so a
 * comparison can treat everything in a group as equal.
 */
const CONFUSABLE_GROUPS = [
  "0OQD",
  "1IL|!",
  "2Z",
  "4A",
  "5S",
  "6G",
  "8B",
  "7T",
  "9g",
  "UV",
  "CG",
  "EF",
];

const CONFUSION_MAP = (() => {
  const map = new Map();
  for (const group of CONFUSABLE_GROUPS) {
    const canonical = group[0];
    for (const ch of group) map.set(ch.toUpperCase(), canonical);
  }
  return map;
})();

/** Fold a string so that OCR-confusable characters compare equal. */
function fold(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .split("")
    .map((ch) => CONFUSION_MAP.get(ch) || ch)
    .join("");
}

/**
 * Is `needle` present in `haystack`, allowing OCR confusions and up to
 * `slack` further character errors?
 *
 * A sliding window with a per-character mismatch count. Short and exact
 * enough for plate-length strings, which is all this is used for.
 */
function containsApprox(haystack, needle, slack = 1) {
  const h = fold(haystack);
  const n = fold(needle);
  if (!n || n.length < 5) return false;
  if (h.includes(n)) return true;

  for (let start = 0; start + n.length <= h.length; start++) {
    let wrong = 0;
    for (let i = 0; i < n.length; i++) {
      if (h[start + i] !== n[i]) {
        wrong += 1;
        if (wrong > slack) break;
      }
    }
    if (wrong <= slack) return true;
  }
  return false;
}

/** Does a number appear, allowing digits to have been misread? */
function containsNumber(haystack, value, slack = 1) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return false;
  return containsApprox(haystack, digits, slack);
}

/**
 * Which known supply does this page belong to?
 *
 * @param {string} text        whatever OCR produced, however poor
 * @param {Array}  candidates  [{ reference, vehicle, kg, billT, date }]
 * @returns {{reference, confidence, reasons}|null}
 */
function matchGarbledText(text, candidates) {
  if (!text || !candidates?.length) return null;

  let best = null;
  let bestScore = 0;
  let bestReasons = [];

  for (const c of candidates) {
    let score = 0;
    const reasons = [];

    // The vehicle number is the strongest single signal, and it survives
    // OCR better than most things because of its fixed shape.
    if (c.vehicle && containsApprox(text, c.vehicle, 2)) {
      score += 55;
      reasons.push(`vehicle ${c.vehicle} appears on the page`);
    }

    // Weighbridge slips print the net weight, and our invoice bills it.
    if (c.kg && containsNumber(text, Math.round(c.kg), 1)) {
      score += 35;
      reasons.push(`the weight ${Math.round(c.kg)} appears on the page`);
    }

    // A bilty carries its number and nothing else.
    if (c.billT && containsNumber(text, c.billT, 0)) {
      score += 35;
      reasons.push(`Bill T number ${c.billT} appears on the page`);
    }

    // The date, written as it appears on a slip: 05/08/2026.
    if (c.date) {
      const [y, m, d] = String(c.date).slice(0, 10).split("-");
      if (y && m && d) {
        const forms = [`${d}/${m}/${y}`, `${d}-${m}-${y}`, `${d}.${m}.${y}`, `${d}${m}${y}`];
        if (forms.some((f) => containsApprox(text, f, 1))) {
          score += 20;
          reasons.push(`dated ${d}/${m}/${y}, the same day as the supply`);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestReasons = reasons;
    }
  }

  // 55 means at least the vehicle was found, or two weaker signals
  // together. One number alone is not enough — a four-digit figure can
  // appear on a page by chance.
  if (!best || bestScore < 55) return null;

  return {
    reference: best.reference,
    confidence: Math.min(99, bestScore + 35),
    reasons: bestReasons,
    clientName: best.clientName || null,
    date: best.date || null,
  };
}

module.exports = { matchGarbledText, containsApprox, containsNumber, fold };
