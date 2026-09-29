/**
 * Biome Platform — WhatsApp Agent / client master
 * -------------------------------------------------------------------
 * Every client wants a different set of papers. This encodes SOP
 * section 7 ("Client-Wise Required Documents List") so the app can tell
 * a coordinator what is still missing for THIS client, rather than
 * applying one generic checklist to all of them.
 *
 * The seed below is written to <DataRoot>/config/clients.json on first
 * run and is editable from the app afterwards — the SOP is the starting
 * point, not a hard-coded rule.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, ensureDir } = require("./paths");
const { SEED_VENDORS, SEED_PLANTS, SEED_CLIENT_NAMES } = require("./masterData");

/** Every kind of paper or data point coordination collects. */
const REQUIREMENTS = {
  tax_invoice: "Tax Invoice",
  delivery_challan: "Delivery Challan",
  eway_bill: "E-Way Bill",
  bilty_lr: "Bilty / LR Copy",
  weight_slip: "Weight Slip",
  fast_tag: "Fast Tag Details",
  consignment_tag: "Consignment Tag",
  coa: "COA (Certificate of Analysis)",
  driver_mobile: "Driver Mobile Number",
};

/**
 * SOP section 7, transcribed exactly.
 *
 * `requires`  — what must be collected for this client.
 * `dscOn`     — documents that must carry a Digital Signature Certificate.
 * `aliases`   — how the client's name actually appears on paperwork, so a
 *               consignee read off an invoice matches the right row.
 */
const SEED_CLIENTS = [
  {
    name: "Jhajjar Power Limited",
    shortName: "JPL",
    aliases: ["jhajjar power limited", "jhajjar power", "jpl"],
    requires: ["tax_invoice", "eway_bill", "bilty_lr", "weight_slip", "coa", "driver_mobile"],
    dscOn: [],
    notes: "",
  },
  {
    name: "Nabha Power Limited",
    shortName: "Nabha",
    aliases: ["nabha power limited", "nabha power", "nabha"],
    requires: ["delivery_challan", "eway_bill"],
    dscOn: ["delivery_challan"],
    notes: "DSC must always be attached to the Delivery Challan.",
  },
  {
    name: "NTPC Limited – Mouda",
    shortName: "NTPC Mouda",
    aliases: ["ntpc mouda", "mouda"],
    requires: ["delivery_challan", "eway_bill", "weight_slip", "fast_tag"],
    dscOn: [],
    notes: "",
  },
  {
    name: "NTPC Limited – Tanda",
    shortName: "NTPC Tanda",
    aliases: ["ntpc tanda", "tanda"],
    requires: ["delivery_challan", "eway_bill", "consignment_tag", "fast_tag", "driver_mobile"],
    dscOn: ["delivery_challan"],
    notes: "DSC must be attached to the Delivery Challan.",
  },
  {
    name: "NTPC Limited – Solapur",
    shortName: "NTPC Solapur",
    aliases: ["ntpc solapur", "solapur"],
    requires: ["delivery_challan", "eway_bill", "weight_slip", "driver_mobile"],
    dscOn: [],
    notes: "",
  },
  {
    name: "Aravali Power Company Private Limited (APCPL Jharli)",
    shortName: "APCPL Jharli",
    aliases: [
      "aravali power company",
      "aravali power company pvt ltd",
      "aravali power company private limited",
      "apcpl",
      "jharli",
      "igstpp",
    ],
    requires: ["delivery_challan", "eway_bill", "consignment_tag"],
    dscOn: ["delivery_challan", "eway_bill"],
    notes: "DSC must be attached to both documents.",
  },
  {
    name: "HTPS Aligarh",
    shortName: "HTPS",
    aliases: ["htps aligarh", "htps", "aligarh"],
    requires: ["delivery_challan", "eway_bill"],
    dscOn: ["delivery_challan", "eway_bill"],
    notes: "DSC must be attached to both documents.",
  },
];

/** Write the SOP seed the first time, then never touch it again — the
 *  user's own edits always win. */
/**
 * Write the vendor master on first run.
 *
 * 53 codes were supplied by the company. Seeding them means references
 * like BDC/841/AA/37 resolve from the very first document, instead of
 * everything sitting unmatched until someone types the list in by hand.
 * Never overwritten once it exists — the user owns it after that.
 */
function seedVendorRows() {
  return SEED_VENDORS.map((v) => ({
    code: v.code,
    name: v.name,
    aliases: v.aliases,
    active: true,
    kyc: [],
    createdAt: new Date().toISOString(),
  }));
}

function ensureVendorsSeeded() {
  // An EMPTY list is not "the user's own list" — it is what an early
  // Registration sync wrote before this file existed, and it left every
  // document unmatched. Put the company's master back; Registration then
  // adds to it.
  try {
    if (fs.existsSync(PATHS.vendorsFile)) {
      const f = JSON.parse(fs.readFileSync(PATHS.vendorsFile, "utf8"));
      if (!Array.isArray(f.vendors) || f.vendors.length === 0) {
        f.vendors = seedVendorRows();
        f.reseededAt = new Date().toISOString();
        fs.writeFileSync(PATHS.vendorsFile, JSON.stringify(f, null, 2), "utf8");
        return;
      }
    }
  } catch { /* unreadable — handled below */ }
  if (fs.existsSync(PATHS.vendorsFile)) {
    // Earlier releases split the shared SGE code into SGE2/SGE3. The
    // business wants the code kept as issued, so those revert to SGE.
    try {
      const f = JSON.parse(fs.readFileSync(PATHS.vendorsFile, "utf8"));
      let changed = false;
      for (const v of f.vendors || []) if ((v.code === "SGE2" || v.code === "SGE3") && /sohi|sss green/i.test(v.name)) { v.code = "SGE"; changed = true; }
      if (changed) fs.writeFileSync(PATHS.vendorsFile, JSON.stringify(f, null, 2), "utf8");
    } catch { /* leave the file as it is */ }
    return;
  }
  ensureDir(PATHS.configDir);
  fs.writeFileSync(
    PATHS.vendorsFile,
    JSON.stringify(
      {
        vendors: seedVendorRows(),
        seededFrom: "Vendor Master Directory supplied by the company",
        seededAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

/** Our own plants, used to recognise manufacturing references. */
/**
 * config/plants.json is SHARED with the app's plant master (lib/plants.ts),
 * which writes { code, label, state, location, active }. The agent needs
 * { code, name, aliases, weightAdjustmentKg }. Each side keeps the other's
 * fields; here the agent's view is derived from whatever is there, with
 * the seed filling what the app never sets (Gangakhed's +500 kg).
 */
const APP_SEED = {
  REW: { label: "Mayan", state: "HR", location: "Mayan Village, Rewari, Haryana" },
  GKD: { label: "Gangakhed", state: "MH", location: "Gangakhed, Maharashtra" },
};

function toAgentPlant(p) {
  const code = String(p.code || "").toUpperCase();
  const seed = SEED_PLANTS.find((s) => s.code === code) || {};
  const label = String(p.label || "").trim();
  const name = String(p.name || (label ? `${label} Plant` : seed.name || code));
  const aliases = Array.from(new Set([
    ...(Array.isArray(p.aliases) ? p.aliases : []),
    ...(seed.aliases || []),
    code.toLowerCase(),
    ...(label ? [label.toLowerCase()] : []),
  ].filter(Boolean)));
  const adj = p.weightAdjustmentKg !== undefined && p.weightAdjustmentKg !== null && p.weightAdjustmentKg !== "" ? Number(p.weightAdjustmentKg) : Number(seed.weightAdjustmentKg || 0);
  return { ...p, code, name, aliases, weightAdjustmentKg: Number.isFinite(adj) ? adj : 0, active: p.active !== false };
}

function loadPlants() {
  try {
    const file = path.join(PATHS.configDir, "plants.json");
    if (!fs.existsSync(file)) {
      ensureDir(PATHS.configDir);
      const now = new Date().toISOString();
      // Written in the shape BOTH readers understand.
      const rows = SEED_PLANTS.map((p) => ({ ...(APP_SEED[p.code] || { label: p.name.replace(/ Plant$/, ""), state: "DL", location: "" }), ...p, active: true, createdAt: now, updatedAt: now }));
      fs.writeFileSync(file, JSON.stringify({ plants: rows, updatedAt: now }, null, 2), "utf8");
      return rows.map(toAgentPlant);
    }
    const list = JSON.parse(fs.readFileSync(file, "utf8")).plants;
    return (Array.isArray(list) && list.length ? list : SEED_PLANTS).map(toAgentPlant).filter((p) => p.active !== false);
  } catch {
    return SEED_PLANTS.map(toAgentPlant);
  }
}

function ensureSeeded() {
  ensureVendorsSeeded();
  loadPlants();
  if (fs.existsSync(PATHS.clientsFile)) return;
  ensureDir(PATHS.configDir);
  // Clients with SOP requirements keep them; the rest are seeded with a
  // sensible default so they're recognised immediately and can be tuned.
  const known = new Map(SEED_CLIENTS.map((c) => [c.name.toLowerCase(), c]));
  const merged = [...SEED_CLIENTS];
  for (const c of SEED_CLIENT_NAMES) {
    const match = [...known.values()].find(
      (k) =>
        k.name.toLowerCase() === c.name.toLowerCase() ||
        (k.aliases || []).some((a) => c.aliases.includes(a))
    );
    if (match) continue;
    merged.push({
      name: c.name,
      shortName: c.name.split(/[\s(,]/)[0],
      aliases: c.aliases,
      requires: ["tax_invoice", "eway_bill"],
      dscOn: [],
      notes: "Seeded from the client list — confirm what this client actually requires.",
    });
  }

  fs.writeFileSync(
    PATHS.clientsFile,
    JSON.stringify(
      {
        clients: merged,
        seededFrom: "SOP for Coordinators, section 7",
        seededAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

function loadClients() {
  try {
    ensureSeeded();
    const data = JSON.parse(fs.readFileSync(PATHS.clientsFile, "utf8"));
    return Array.isArray(data.clients) ? data.clients : [];
  } catch {
    return SEED_CLIENTS;
  }
}

function normalise(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Collapse the spelling variants that appear on real paperwork.
 *
 * A vendor invoice was found spelling the client "Jhajjhar Power
 * Limited" — an extra h. That one letter meant the name didn't match at
 * all, and the only thing left matching was "Jharli", the plant location,
 * which belongs to a DIFFERENT client. Every Jhajjar supply from that
 * vendor was therefore filed under Aravali Power.
 *
 * Doubled letters and h/silent-h differences are the usual culprits in
 * transliterated names, so both are flattened before comparing.
 */
function fuzzyKey(s) {
  return normalise(s)
    .replace(/h/g, "")        // jhajjhar -> jajjar, jhajjar -> jajjar
    .replace(/(.)\1+/g, "$1") // doubled letters collapse
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a consignee name read off a document to a client in the master.
 * Tries exact name, then short name, then aliases, then a containment
 * check both ways — real invoices print "JHAJJAR POWER LIMITED, KHANPUR"
 * and "Jhajjar Power Ltd" for the same plant.
 */
function matchClient(rawName, clients = loadClients()) {
  const target = normalise(rawName);
  if (!target) return null;

  // 1. An exact name or short name always wins.
  for (const c of clients) {
    if (normalise(c.name) === target || normalise(c.shortName) === target) return c;
  }
  for (const c of clients) {
    const candidates = [c.name, c.shortName, ...(c.aliases || [])].map(normalise).filter(Boolean);
    if (candidates.some((a) => a === target)) return c;
  }

  // 2. Same name, spelled differently — "Jhajjhar" for "Jhajjar".
  const fuzzyTarget = fuzzyKey(rawName);
  if (fuzzyTarget.length >= 6) {
    for (const c of clients) {
      const keys = [c.name, c.shortName, ...(c.aliases || [])].map(fuzzyKey).filter((k) => k.length >= 6);
      if (keys.some((k) => fuzzyTarget.includes(k) || k.includes(fuzzyTarget))) return c;
    }
  }

  // 3. Otherwise take the LONGEST alias that appears, not the first one
  //    found.
  //
  //    A vendor invoice for Jhajjar Power prints the plant's location,
  //    "Jharli", in the consignee block — and Jharli is also an alias of
  //    Aravali Power (APCPL Jharli). Returning the first hit read every
  //    Jhajjar supply as an APCPL one. "jhajjar power limited" is far
  //    longer and far more specific than "jharli", so length is a good
  //    proxy for which match is the real one.
  let best = null;
  let bestLength = 0;
  for (const c of clients) {
    const candidates = [c.name, c.shortName, ...(c.aliases || [])].map(normalise).filter(Boolean);
    for (const alias of candidates) {
      if (alias.length < 4) continue;
      if (!target.includes(alias) && !alias.includes(target)) continue;
      // A full company name beats a bare place name of the same length.
      const specificity = alias.length + (/(?:power|limited|ltd|industries|company|ntpc)/.test(alias) ? 10 : 0);
      if (specificity > bestLength) {
        bestLength = specificity;
        best = c;
      }
    }
  }
  return best;
}


/** Which requirement does a given document type satisfy? */
const DOC_TYPE_SATISFIES = {
  biome_tax_invoice: "tax_invoice",
  vendor_tax_invoice: "tax_invoice",
  biome_delivery_challan: "delivery_challan",
  vendor_delivery_challan: "delivery_challan",
  biome_eway_bill: "eway_bill",
  vendor_eway_bill: "eway_bill",
  bilty_lr: "bilty_lr",
  weight_slip: "weight_slip",
  fast_tag: "fast_tag",
  consignment_tag: "consignment_tag",
  coa: "coa",
  receiving: "receiving",
  other: null,
};

module.exports = {
  loadPlants,
  REQUIREMENTS,
  SEED_CLIENTS,
  DOC_TYPE_SATISFIES,
  loadClients,
  ensureSeeded,
  matchClient,
  normalise,
};
