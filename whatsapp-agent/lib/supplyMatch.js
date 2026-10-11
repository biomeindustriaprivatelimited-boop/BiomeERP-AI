/**
 * Biome Platform — WhatsApp Agent / supply-set matching (precise rules)
 * -------------------------------------------------------------------
 * Which supply set does a paper belong to? Answered by the owner's own
 * rules, strongest first, and never by a single weak coincidence:
 *
 *   1. OUR reference BDC/<our no>/<vendor code | plant>/<vendor no | our no>
 *      is the key of every set (printed on our tax invoice / challan).
 *   2. Our e-way bill / consignment tag: our document number or the e-way
 *      number printed on our invoice.
 *   3. Vendor tax invoice / e-way bill: the vendor document number named
 *      in the reference, confirmed by the vehicle, the vendor (code →
 *      name / GSTIN) or the e-way number cross-link. A vendor e-way bill
 *      also links through the e-way number its vendor invoice prints.
 *   4. Bill T (always blank): the LR / GR number our invoice (or the
 *      vendor invoice) prints, or the transporter named on the vendor
 *      invoice / e-way bill.
 *   5. Weight slip: vehicle + net weight (Gangakhed documents are raised
 *      400–500 kg over the slip) + date within 3 days.
 *   6. Pages of one merged PDF travel together: a page with nothing to
 *      match on joins the set its sibling pages were matched to.
 *   7. Only when nothing above decides, a Bill T / weight slip sent in
 *      the same burst as one of our invoices that still lacks one is put
 *      in that set as "Needs check" — the coordinator confirms it when
 *      verifying the set.
 *
 * The vehicle alone never puts a paper into a set: the same truck makes
 * several trips (HR66C7460 carried BI-26-27-HR0789 and HR0810 a day
 * apart).
 */

const { containsApprox, containsNumber } = require("./garbledMatch");

function plate(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]{2})O/, "$10");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(s) ? s : null;
}
function core(no) {
  const s = String(no || "").toUpperCase().trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,6})\s*\/\s*20\d{2}-?\d{2}$/);
  if (m) return String(Number(m[1]));
  m = s.match(/(\d+)\s*$/);
  return m ? String(Number(m[1])) : null;
}
function alnum(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function days(a, b) {
  const x = new Date(String(a || "").slice(0, 10));
  const y = new Date(String(b || "").slice(0, 10));
  if (isNaN(x) || isNaN(y)) return null;
  return Math.round((x - y) / 86400000);
}
function nearPlate(a, b) {
  if (!a || !b || a === b) return a === b;
  if (a.length !== b.length || a.slice(0, 4) !== b.slice(0, 4)) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d === 1;
}
function normName(v) {
  return String(v || "").toLowerCase().replace(/\b(m\/?s|pvt|private|ltd|limited|llp|the|co|company)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function sameTransporter(a, b) {
  const x = normName(a).replace(/\s/g, "");
  const y = normName(b).replace(/\s/g, "");
  if (!x || !y || x.length < 5 || y.length < 5) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * What a set knows about itself, from every document already in it.
 * @param {object} set { reference (parsed), supplyType, plantAdjustmentKg, docs: [records] }
 */
function profile(set) {
  const p = {
    key: set.reference?.canonical,
    reference: set.reference,
    supplyType: set.supplyType || (set.reference?.plantCode ? "manufacturing" : "trading"),
    plantCode: set.reference?.plantCode || null,
    plantAdjustmentKg: Number(set.plantAdjustmentKg) || 0,
    final: Boolean(set.final),
    ourNo: null,
    ourCore: core(set.reference?.biomeDocNo),
    vendorCode: set.reference?.plantCode ? null : String(set.reference?.vendorCode || "").toUpperCase() || null,
    vendorCore: set.reference?.plantCode ? null : core(set.reference?.vendorDocNo),
    vehicle: null,
    date: null,
    kg: null,
    lr: new Set(),
    ourEways: new Set(),
    vendorEways: new Set(),
    vendorGstins: new Set(),
    vendorVehicles: new Set(),
    transporters: [],
    transporterGstins: new Set(),
    bundles: new Set(),
    arrivals: [],
    chats: new Set(),
    has: new Set(),
    count: {},
    vendorNames: [],
  };
  const docs = set.docs || [];
  const our = docs.find((d) => /^biome_(tax_invoice|delivery_challan)$/.test(d.extracted?.documentType || ""));
  if (our) {
    const e = our.extracted || {};
    p.ourNo = alnum(e.biomeDocNo);
    p.ourCore = core(e.biomeDocNo) || p.ourCore;
    p.vehicle = plate(e.vehicleNo);
    p.date = e.documentDate || null;
    p.kg = num(e.quantityKg) || num(e.netWeight);
    if (e.grNumber) p.lr.add(String(Number(String(e.grNumber).replace(/\D/g, "")) || ""));
    if (e.ewayBillNo) p.ourEways.add(String(e.ewayBillNo).replace(/\D/g, ""));
  }
  for (const d of docs) {
    const e = d.extracted || {};
    const t = e.documentType || "";
    p.has.add(t);
    p.count[t] = (p.count[t] || 0) + 1;
    if (d.bundleId) p.bundles.add(d.bundleId);
    if (d.receivedAt) p.arrivals.push({ at: new Date(d.receivedAt).getTime(), chat: d.sender?.chatJid || null, our: /^biome_/.test(t) });
    if (d.sender?.chatJid) p.chats.add(d.sender.chatJid);
    if (/^biome_/.test(t) && e.ewayBillNo) p.ourEways.add(String(e.ewayBillNo).replace(/\D/g, ""));
    if (/^vendor_/.test(t)) {
      if (e.ewayBillNo) p.vendorEways.add(String(e.ewayBillNo).replace(/\D/g, ""));
      if (e.vendorGstin) p.vendorGstins.add(String(e.vendorGstin).toUpperCase());
      if (e.vehicleNo && plate(e.vehicleNo)) p.vendorVehicles.add(plate(e.vehicleNo));
      if (e.grNumber) p.lr.add(String(Number(String(e.grNumber).replace(/\D/g, "")) || ""));
      if (e.vendorName) p.vendorNames.push(e.vendorName);
    }
    if (e.transporterName) p.transporters.push(e.transporterName);
    if (e.transporterGstin) p.transporterGstins.add(String(e.transporterGstin).toUpperCase());
    if (!p.vehicle && e.vehicleNo && /^biome_/.test(t)) p.vehicle = plate(e.vehicleNo);
  }
  p.lr.delete("");
  p.lr.delete("0");
  return p;
}

function weightFits(p, slipKg) {
  if (!p.kg || !slipKg) return null;
  const diff = p.kg - slipKg; // our document minus the slip
  if (p.plantAdjustmentKg > 0) {
    // Gangakhed: our papers are raised 400–500 kg over the weighbridge.
    return diff >= -60 && diff <= p.plantAdjustmentKg + 150;
  }
  return Math.abs(diff) <= Math.max(60, p.kg * 0.01);
}

/**
 * Evidence that `doc` belongs to the set profiled as `p`.
 * @returns {{ level: "sure"|"check"|null, conflict?: string, reasons: string[] }}
 */
function evaluate(doc, p) {
  const e = doc.extracted || {};
  const t = e.documentType || "other";
  const reasons = [];
  const vehicle = plate(e.vehicleNo);
  const anyVehicle = p.vehicle || [...p.vendorVehicles][0] || null;
  const vehicleSame = vehicle && (vehicle === p.vehicle || p.vendorVehicles.has(vehicle));
  const vehicleNear = vehicle && !vehicleSame && (nearPlate(vehicle, p.vehicle) || [...p.vendorVehicles].some((v) => nearPlate(vehicle, v)));
  const vehicleConflict = vehicle && anyVehicle && !vehicleSame && !vehicleNear;
  const dd = p.date && e.documentDate ? days(p.date, e.documentDate) : null;

  if (t === "biome_eway_bill" || t === "biome_credit_note" || t === "biome_debit_note") {
    const ew = String(e.ewayBillNo || "").replace(/\D/g, "");
    if (ew && p.ourEways.has(ew)) return { level: "sure", reasons: [`e-way bill ${ew} is the one printed on our document`] };
    const n = alnum(e.biomeDocNo || e.ewayDocNo);
    if (n && p.ourNo && n === p.ourNo) return { level: "sure", reasons: [`covers our document ${e.biomeDocNo || e.ewayDocNo}`] };
    return { level: null, reasons };
  }

  if (t === "consignment_tag") {
    const n = alnum(e.biomeDocNo);
    if (n && p.ourNo && n === p.ourNo) return { level: "sure", reasons: [`batch number is our document ${e.biomeDocNo}`] };
    if (vehicleSame && weightFits({ ...p, plantAdjustmentKg: 0 }, num(e.netWeight) || num(e.quantityKg)) && (dd === null || Math.abs(dd) <= 3)) {
      return { level: "sure", reasons: [`same vehicle ${vehicle}`, `same weight ${num(e.netWeight) || num(e.quantityKg)} kg`] };
    }
    if (vehicleSame && dd !== null && Math.abs(dd) <= 1) return { level: "check", reasons: [`same vehicle ${vehicle} on the same day — weight not confirmed`] };
    return { level: null, reasons };
  }

  if (/^vendor_/.test(t)) {
    if (p.supplyType === "manufacturing") return { level: null, reasons: ["a plant supply has no vendor papers"] };
    const vcore = core(e.vendorOwnDocNo || e.vendorDocNo || e.ewayDocNo);
    const ew = String(e.ewayBillNo || "").replace(/\D/g, "");
    const gst = String(e.vendorGstin || "").toUpperCase();
    const confirmations = [];
    if (vehicleSame) confirmations.push(`same vehicle ${vehicle}`);
    if (ew && p.vendorEways.has(ew)) confirmations.push(`same e-way bill ${ew} as the vendor invoice in this set`);
    if (gst && p.vendorGstins.has(gst)) confirmations.push(`same vendor GSTIN ${gst}`);
    if (p.vendorCode && e.vendorName && codeMatchesName(p.vendorCode, e.vendorName, doc.__vendors)) confirmations.push(`vendor ${e.vendorName} has code ${p.vendorCode}`);
    if (vehicleConflict) return { level: null, conflict: `different vehicle (${vehicle} vs ${anyVehicle})`, reasons };
    if (vcore && p.vendorCore && vcore === p.vendorCore) {
      reasons.push(`vendor document ${e.vendorOwnDocNo || e.vendorDocNo || e.ewayDocNo} is the one named in ${p.key}`);
      if (confirmations.length) return { level: "sure", reasons: reasons.concat(confirmations) };
      return { level: "check", reasons: reasons.concat(["vehicle / vendor not printed — please confirm"]) };
    }
    if (vcore && p.vendorCore && vcore !== p.vendorCore) return { level: null, conflict: `vendor document ${vcore} is not ${p.vendorCore}`, reasons };
    // No document number (e.g. an e-way bill print that lost it): the e-way
    // cross-link or GSTIN + vehicle decide.
    if (ew && p.vendorEways.has(ew)) return { level: "sure", reasons: [`same e-way bill ${ew} as the vendor invoice in this set`] };
    if (gst && p.vendorGstins.has(gst) && vehicleSame) return { level: "sure", reasons: [`same vendor GSTIN ${gst}`, `same vehicle ${vehicle}`] };
    return { level: null, reasons };
  }

  if (t === "bilty_lr") {
    const lr = e.grNumber ? String(Number(String(e.grNumber).replace(/\D/g, "")) || "") : "";
    if (vehicleConflict) return { level: null, conflict: `different vehicle (${vehicle} vs ${anyVehicle})`, reasons };
    if (lr && p.lr.has(lr)) return { level: "sure", reasons: [`Bill T number ${lr} is the LR printed on this supply's invoice`] };
    if (e.transporterGstin && p.transporterGstins.has(String(e.transporterGstin).toUpperCase())) return { level: "sure", reasons: [`transporter GSTIN ${e.transporterGstin} is named on this supply's papers`] };
    if (e.transporterName && p.transporters.some((x) => sameTransporter(x, e.transporterName))) return { level: "sure", reasons: [`transporter ${e.transporterName} is named on this supply's papers`] };
    if (doc.transcription && p.transporters.some((x) => normName(x).length >= 8 && containsApprox(doc.transcription, normName(x).replace(/\s/g, ""), 2))) {
      return { level: "sure", reasons: [`transporter named on this supply's papers appears on the Bill T`] };
    }
    return { level: null, reasons };
  }

  if (t === "weight_slip") {
    const kg = num(e.netWeight) || num(e.quantityKg);
    const fits = weightFits(p, kg);
    const dateOk = dd === null || Math.abs(dd) <= 3;
    if (vehicleConflict) return { level: null, conflict: `different vehicle (${vehicle} vs ${anyVehicle})`, reasons };
    if ((vehicleSame || vehicleNear) && fits && dateOk) {
      return { level: "sure", reasons: [`${vehicleSame ? "same" : "nearly the same"} vehicle ${vehicle}`, `net weight ${kg} kg fits ${p.kg} kg${p.plantAdjustmentKg ? " (plant adds 400–500 kg)" : ""}`] };
    }
    if ((vehicleSame || vehicleNear) && fits === false) return { level: null, conflict: `weight ${kg} kg does not fit ${p.kg} kg`, reasons };
    // garbled photo: look for the set's vehicle and weight inside the text
    const text = doc.transcription || e.transcription || "";
    if (text && anyVehicle) {
      const vHit = containsApprox(text, anyVehicle, 2) || loosePlate(text, anyVehicle);
      const kgHit = p.kg ? containsNumber(text, Math.round(p.kg - (p.plantAdjustmentKg ? 450 : 0)), 1) || containsNumber(text, Math.round(p.kg), 1) : false;
      if (vHit && kgHit) return { level: "sure", reasons: [`vehicle ${anyVehicle} and weight ${p.kg} kg read on the slip`] };
      if ((vehicleSame || vehicleNear || vHit) && dateOk && fits === null) return { level: "check", reasons: [`vehicle ${anyVehicle} on the slip, weight unreadable`] };
    }
    return { level: null, reasons };
  }
  return { level: null, reasons };
}

/** Dot-matrix "HROST7460" for HR66C7460: same state letters and the same last four digits on one token. */
function loosePlate(text, plateNo) {
  const p = String(plateNo || "");
  const st = p.slice(0, 2);
  const tail = p.slice(-4);
  if (!/^[A-Z]{2}$/.test(st) || !/^\d{4}$/.test(tail)) return false;
  const tokens = String(text || "").toUpperCase().match(/[A-Z0-9]{8,11}/g) || [];
  return tokens.some((tk) => tk.startsWith(st) && tk.endsWith(tail));
}

function codeMatchesName(code, name, vendors) {
  const list = (vendors || []).filter((v) => String(v.code || "").toUpperCase() === code);
  const n = normName(name);
  if (!n) return false;
  return list.some((v) => [v.name, ...(v.aliases || [])].some((a) => {
    const x = normName(a);
    return x && x.length >= 4 && (n.includes(x) || x.includes(n));
  }));
}

const BURST_MS = 30 * 60 * 1000;

/**
 * A plant supply carries one Bill T and one weight slip; a trading supply
 * at most two of each (the vendor's and ours). A set that already has
 * them cannot take another — the same LR number on a second Bill T means
 * another trip (Shiv Logistics "317" on HR0789 and HR0810).
 */
function full(p, t) {
  if (t !== "bilty_lr" && t !== "weight_slip") return false;
  const cap = p.supplyType === "manufacturing" ? 1 : 2;
  return (p.count[t] || 0) >= cap;
}

function proximity(doc, p) {
  const at = new Date(doc.receivedAt || 0).getTime();
  const chat = doc.sender?.chatJid || null;
  let best = Infinity;
  for (const a of p.arrivals) {
    if (chat && a.chat && a.chat !== chat) continue;
    best = Math.min(best, Math.abs(a.at - at));
  }
  return best;
}

/**
 * The set this document belongs to.
 * @param {object} doc     a ledger record (extracted, bundleId, receivedAt, sender, transcription)
 * @param {Array}  sets    [{ reference, supplyType, plantAdjustmentKg, final, docs }]
 * @param {object} opts    { vendors, bundleHome: Map(bundleId → set key) }
 * @returns {null | { set, key, level, reasons } | { ambiguous: true, candidates }}
 */
function bestSetFor(doc, sets, opts = {}) {
  const profiles = sets.map((s) => ({ set: s, p: s.__profile || profile(s) }));
  doc.__vendors = opts.vendors || [];
  const scored = [];
  const t0 = doc.extracted?.documentType || "other";
  for (const { set, p } of profiles) {
    if (full(p, t0)) continue;
    const r = evaluate(doc, p);
    if (r.level) scored.push({ set, p, ...r, dist: proximity(doc, p) });
  }
  delete doc.__vendors;
  const pick = (list, level) => {
    const l = list.filter((x) => x.level === level);
    if (!l.length) return null;
    if (l.length === 1) return l[0];
    l.sort((a, b) => a.dist - b.dist);
    // two equally good homes: the burst it arrived in decides, if clearly
    if (l[0].dist <= BURST_MS && l[1].dist >= 2 * l[0].dist + 60000) {
      return { ...l[0], reasons: l[0].reasons.concat([`sent together with this supply's papers (${l.length} sets fit the numbers)`]) };
    }
    return { ambiguous: true, candidates: l.map((x) => ({ reference: x.p.key, level: x.level, reasons: x.reasons })) };
  };
  const sure = pick(scored, "sure");
  if (sure) return sure.ambiguous ? sure : { set: sure.set, key: sure.p.key, level: "sure", reasons: sure.reasons };

  // Pages of the same merged PDF follow their siblings.
  const t = doc.extracted?.documentType || "other";
  if (doc.bundleId && opts.bundleHome && opts.bundleHome.has(doc.bundleId)) {
    const key = opts.bundleHome.get(doc.bundleId);
    const home = profiles.find((x) => x.p.key === key);
    if (home && !full(home.p, t)) {
      const r = evaluate(doc, home.p);
      if (!r.conflict && !(home.p.supplyType === "manufacturing" && /^vendor_/.test(t))) {
        return { set: home.set, key, level: "sure", reasons: [`arrived in the same merged PDF as this supply's other papers`, ...r.reasons] };
      }
    }
  }

  const check = pick(scored, "check");
  if (check) return check.ambiguous ? check : { set: check.set, key: check.p.key, level: "check", reasons: check.reasons };

  // Last resort for blank papers (Bill T, weight slip): the burst. The
  // coordinator posts a supply's papers first and OUR invoice for them
  // right after, so only an invoice that arrived AFTER this paper (in the
  // same chat, within 30 minutes) can claim it. A page of a merged PDF
  // never uses this — it follows its sibling pages.
  if (["bilty_lr", "weight_slip"].includes(t) && !doc.bundleId) {
    const docAt = new Date(doc.receivedAt || 0).getTime();
    const chat = doc.sender?.chatJid || null;
    const wanting = profiles
      .filter(({ p }) => !p.final && !full(p, t) && !(p.supplyType === "trading" && p.has.has(t)))
      .map((x) => {
        const ours = x.p.arrivals.filter((a) => a.our && a.at >= docAt - 60000 && (!chat || !a.chat || a.chat === chat));
        const dist = ours.length ? Math.min(...ours.map((a) => a.at - docAt)) : Infinity;
        return { ...x, dist, r: evaluate(doc, x.p) };
      })
      .filter((x) => x.dist <= BURST_MS && !x.r.conflict)
      .sort((a, b) => a.dist - b.dist);
    if (wanting.length === 1 || (wanting.length > 1 && wanting[1].dist >= 2 * wanting[0].dist + 60000)) {
      const w = wanting[0];
      return {
        set: w.set,
        key: w.p.key,
        level: "check",
        reasons: [`nothing printed to match on — sent ${Math.max(0, Math.round(w.dist / 60000))} min before this supply's invoice, which has no ${t === "bilty_lr" ? "Bill T" : "weight slip"} yet`],
      };
    }
  }
  return null;
}

module.exports = { bestSetFor, profile, evaluate, plate, core, weightFits };
