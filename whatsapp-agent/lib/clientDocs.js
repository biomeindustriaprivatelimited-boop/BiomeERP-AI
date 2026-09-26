/**
 * Biome Platform — receivings and lab reports
 * -------------------------------------------------------------------
 * Two documents that come from the CLIENT, not from us or the vendor,
 * and each needs a rule of its own.
 *
 * RECEIVING
 * The client weighs the truck when it unloads. That figure — not ours,
 * not the vendor's — is what the final invoice settles on, so every
 * supply set needs its receiving.
 *
 * It carries the vehicle number and the client's name, and it arrives on
 * the day of the supply or within about three days. The awkward case is
 * a vehicle that supplies twice inside that window: two invoices, two
 * receivings, and nothing on either receiving that says which is which.
 *
 * The answer is first-in-first-out. Trucks unload in the order they
 * arrive, so the earlier receiving belongs to the earlier supply. A
 * receiving therefore takes the OLDEST supply for that vehicle that does
 * not already have one — which is both correct and self-correcting: get
 * the first one right and the second follows.
 *
 * LAB REPORT
 * The client tests the material and sends a report back. One report
 * usually covers SEVERAL vehicles, so it belongs to no single supply and
 * must not be filed inside one — it would claim a set it only partly
 * describes. It goes to the client's own Lab Reports folder for the
 * month, where it can be found by any supply that needs it.
 */

/** How far after a supply a receiving can still turn up. */
const RECEIVING_WINDOW_DAYS = 3;

function plate(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(s) ? s : null;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function daysBetween(a, b) {
  const from = new Date(String(a).slice(0, 10));
  const to = new Date(String(b).slice(0, 10));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * Which supply does this receiving belong to?
 *
 * @param {object} receiving  extracted fields from the receiving slip
 * @param {Array}  supplies   [{ reference, vehicle, clientName, date, hasReceiving }]
 * @returns {{reference, confidence, reasons}|null}
 */
function matchReceiving(receiving, supplies) {
  const vehicle = plate(receiving?.vehicleNo);
  if (!vehicle || !supplies?.length) return null;

  const client = norm(receiving?.clientName);
  const receivedOn = receiving?.documentDate || receiving?.receivedAt || null;

  // Same vehicle, same client, and the supply is not in the future
  // relative to the receiving — a truck cannot unload before it loads.
  const candidates = supplies.filter((s) => {
    if (plate(s.vehicle) !== vehicle) return false;
    if (client && s.clientName && !norm(s.clientName).includes(client) && !client.includes(norm(s.clientName))) {
      return false;
    }
    if (!receivedOn || !s.date) return true; // no dates to judge by
    const gap = daysBetween(s.date, receivedOn);
    return gap !== null && gap >= 0 && gap <= RECEIVING_WINDOW_DAYS;
  });

  if (!candidates.length) return null;

  // FIFO: oldest supply first, and skip any that already has its
  // receiving. Two trips by the same truck sort themselves out.
  const ordered = [...candidates].sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || ""))
  );
  const target = ordered.find((s) => !s.hasReceiving) || null;
  if (!target) return null;

  const reasons = [`same vehicle ${vehicle}`];
  if (client && target.clientName) reasons.push(`same client (${target.clientName})`);
  if (receivedOn && target.date) {
    const gap = daysBetween(target.date, receivedOn);
    reasons.push(
      gap === 0
        ? "received the same day as the supply"
        : `received ${gap} day${gap === 1 ? "" : "s"} after the supply`
    );
  }
  if (ordered.length > 1) {
    reasons.push(
      `this vehicle supplied ${ordered.length} times in the window — taken in order, so this is the earliest one still without a receiving`
    );
  }

  return {
    reference: target.reference,
    confidence: ordered.length > 1 ? 88 : 95,
    reasons,
    clientName: target.clientName || null,
    date: target.date || null,
    fifoPosition: ordered.indexOf(target) + 1,
    fifoTotal: ordered.length,
  };
}

/**
 * Where a lab report is filed.
 *
 * Deliberately NOT inside a supply folder. One report usually covers
 * several vehicles, so filing it under a single reference would assert
 * something untrue about the other supplies it also describes.
 *
 * @returns {{ folder: string[], reason: string }} folder segments below the inbox
 */
function parseLooseDate(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const iso = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  let m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  m = s.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i);
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const idx = months.findIndex(x => m[2].toLowerCase().startsWith(x));
    const d = new Date(Number(m[3]), idx, Number(m[1]));
    if (idx >= 0 && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function labReportDateRange(extracted) {
  const source = `${extracted?.sampleCollectionDate || ''} ${extracted?.documentDate || ''} ${extracted?.transcription || ''}`;
  const dates = [];
  const seen = new Set();
  const patterns = [
    /\b\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}\b/g,
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
    /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}\b/gi,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) {
      const d = parseLooseDate(match[0]);
      if (d) { const key = d.toISOString().slice(0,10); if (!seen.has(key)) { seen.add(key); dates.push(d); } }
    }
  }
  const explicit = parseLooseDate(extracted?.sampleCollectionDate || extracted?.documentDate);
  if (explicit && !seen.has(explicit.toISOString().slice(0,10))) dates.push(explicit);
  dates.sort((a,b)=>a-b);
  return dates;
}

function formatRangeDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function labReportLocation(extracted, monthFolder, clientFolder) {
  const dates = labReportDateRange(extracted);
  const fallback = parseLooseDate(extracted?.documentDate) || new Date();
  const start = dates[0] || fallback;
  const end = dates[dates.length - 1] || start;
  const range = formatRangeDate(start) === formatRangeDate(end)
    ? formatRangeDate(start)
    : `${formatRangeDate(start)} To ${formatRangeDate(end)}`;
  return {
    folder: [monthFolder(start), clientFolder(extracted?.clientName), range],
    reason:
      dates.length > 1
        ? `Lab report covers ${dates.length} detected sample dates; saved using the first-to-last sample collection date range.`
        : "Lab report is kept separate from supply sets and filed under the client's sample collection date.",
  };
}

/** Vehicle numbers named on a lab report — often several. */
function vehiclesOnLabReport(text) {
  const found = new Set();
  const re = /(?:^|[\s:,;(])([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})(?=$|[\s.,;)])/g;
  let m;
  while ((m = re.exec(String(text || "").toUpperCase()))) {
    const p = plate(m[1]);
    if (p) found.add(p);
  }
  return [...found];
}

/**
 * Which supplies a lab report describes.
 *
 * The client draws the sample on the day the truck unloads, so the
 * report's collection date IS the receiving date. Combined with the
 * vehicle numbers printed on it — usually several — that is enough to
 * say which supplies it covers, without filing it inside any of them.
 *
 * @returns {Array<{reference, vehicle}>}
 */
function suppliesCoveredByLabReport(extracted, supplies) {
  const vehicles = vehiclesOnLabReport(
    `${extracted?.transcription || ""} ${extracted?.vehicleNo || ""}`
  );
  if (!vehicles.length || !supplies?.length) return [];

  const collected = extracted?.sampleCollectionDate || extracted?.documentDate || null;

  return supplies
    .filter((s) => {
      if (!vehicles.includes(plate(s.vehicle))) return false;
      if (!collected || !s.date) return true;
      // The sample is drawn at unloading, so it falls in the same window
      // a receiving does.
      const gap = daysBetween(s.date, collected);
      return gap !== null && gap >= 0 && gap <= RECEIVING_WINDOW_DAYS;
    })
    .map((s) => ({ reference: s.reference, vehicle: plate(s.vehicle) }));
}

module.exports = {
  suppliesCoveredByLabReport,
  matchReceiving,
  labReportLocation,
  labReportDateRange,
  vehiclesOnLabReport,
  RECEIVING_WINDOW_DAYS,
};
