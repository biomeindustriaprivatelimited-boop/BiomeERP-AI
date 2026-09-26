/**
 * Biome Platform — verifying a document set
 * -------------------------------------------------------------------
 * Two jobs the coordinator does by eye before anything gets saved, now
 * done in code.
 *
 * 1. CHECK THE VENDOR'S OWN PAPERS AGAINST EACH OTHER
 *    The weight slip's vehicle and net weight must agree with the
 *    vendor's tax invoice; the e-way bill and bilty must agree with it
 *    too. A set that disagrees with itself is a set that will cause a
 *    problem at the plant gate, and it is worth saying so before the
 *    documents are filed rather than after.
 *
 * 2. CHECK OUR DOCUMENT AGAINST THE VENDOR'S
 *    Between our invoice and the vendor's, **only the rate may differ** —
 *    that difference is our margin. Vehicle, weight and bilty number
 *    must be identical. Anything else differing means someone typed
 *    something wrong, and that is exactly what should be caught here.
 *
 * The bilty number matters more than it looks: a transporter's serial
 * does not repeat within a day or two, which makes it a genuinely unique
 * key for a consignment.
 */

/** Everything compares in kilograms; see offlineExtract. */
function toKg(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normPlate(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(s) ? s : null;
}

function normNo(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s ? s.replace(/^0+(?=\d)/, "") : null;
}

/** Weights agree within 2% or 50 kg, whichever is larger. */
function weightsAgree(a, b) {
  if (!a || !b) return null; // can't tell
  return Math.abs(a - b) <= Math.max(50, a * 0.02);
}

// ---------------------------------------------------------------------
// 1. The vendor's set, checked against itself
// ---------------------------------------------------------------------

/**
 * @param {Array} docs  extracted fields from one vendor's documents
 * @returns {{ ok, issues, agreed }}
 */
function verifyVendorSet(docs) {
  const issues = [];

  const invoice = docs.find((d) =>
    ["vendor_tax_invoice", "vendor_delivery_challan"].includes(d.documentType)
  );
  const weightSlip = docs.find((d) => d.documentType === "weight_slip");
  const ewayBill = docs.find((d) => d.documentType === "vendor_eway_bill");
  const bilty = docs.find((d) => d.documentType === "bilty_lr");

  // The invoice is the reference point — everything else is checked
  // against it, the way a coordinator does it.
  if (!invoice) {
    return {
      ok: true,
      agreed: {},
      issues: [],
      note: "No vendor invoice in this set yet, so there is nothing to check against.",
    };
  }

  const invVehicle = normPlate(invoice.vehicleNo);
  const invQty = toKg(invoice.quantityKg) ?? toKg(invoice.netWeight);
  const invGr = normNo(invoice.grNumber);
  const invEway = normNo(invoice.ewayBillNo);

  if (weightSlip) {
    const wsVehicle = normPlate(weightSlip.vehicleNo);
    if (invVehicle && wsVehicle && invVehicle !== wsVehicle) {
      issues.push({
        severity: "high",
        field: "vehicle",
        message: `Weight slip says ${wsVehicle} but the vendor invoice says ${invVehicle}.`,
      });
    }
    const wsQty = toKg(weightSlip.quantityKg) ?? toKg(weightSlip.netWeight);
    const agree = weightsAgree(invQty, wsQty);
    if (agree === false) {
      issues.push({
        severity: "high",
        field: "weight",
        message: `Weight slip shows ${Math.round(wsQty)} kg but the invoice bills ${Math.round(invQty)} kg.`,
      });
    }
  }

  if (ewayBill) {
    const ebVehicle = normPlate(ewayBill.vehicleNo);
    if (invVehicle && ebVehicle && invVehicle !== ebVehicle) {
      issues.push({
        severity: "high",
        field: "vehicle",
        message: `E-way bill says ${ebVehicle} but the invoice says ${invVehicle}.`,
      });
    }
    const ebNo = normNo(ewayBill.ewayBillNo);
    if (invEway && ebNo && invEway !== ebNo) {
      issues.push({
        severity: "medium",
        field: "ewayBill",
        message: `The invoice quotes e-way bill ${invEway}, but the e-way bill itself is ${ebNo}.`,
      });
    }
  }

  if (bilty) {
    const biltyGr = normNo(bilty.grNumber);
    if (invGr && biltyGr && invGr !== biltyGr) {
      issues.push({
        severity: "medium",
        field: "grNumber",
        message: `Bilty number ${biltyGr} doesn't match the ${invGr} quoted on the invoice.`,
      });
    }
  }

  return {
    ok: issues.filter((i) => i.severity === "high").length === 0,
    issues,
    agreed: { vehicle: invVehicle, quantityKg: invQty, grNumber: invGr, ewayBillNo: invEway },
  };
}

// ---------------------------------------------------------------------
// 2. Our document against the vendor's
// ---------------------------------------------------------------------

/**
 * Only the RATE may differ. Everything else must be identical.
 *
 * @param {object} ours    our extracted fields
 * @param {object} theirs  the vendor's
 */
function verifyAgainstOurs(ours, theirs) {
  const issues = [];

  const ourVehicle = normPlate(ours.vehicleNo);
  const theirVehicle = normPlate(theirs.vehicleNo);
  if (ourVehicle && theirVehicle && ourVehicle !== theirVehicle) {
    issues.push({
      severity: "high",
      field: "vehicle",
      message: `Our invoice says vehicle ${ourVehicle}, the vendor's says ${theirVehicle}.`,
    });
  }

  const ourQty = toKg(ours.quantityKg) ?? toKg(ours.netWeight);
  const theirQty = toKg(theirs.quantityKg) ?? toKg(theirs.netWeight);
  const qtyAgree = weightsAgree(ourQty, theirQty);
  if (qtyAgree === false) {
    issues.push({
      severity: "high",
      field: "quantity",
      message: `We bill ${Math.round(ourQty)} kg, the vendor billed ${Math.round(theirQty)} kg — a difference of ${Math.round(Math.abs(ourQty - theirQty))} kg.`,
    });
  }

  const ourGr = normNo(ours.grNumber);
  const theirGr = normNo(theirs.grNumber);
  if (ourGr && theirGr && ourGr !== theirGr) {
    issues.push({
      severity: "high",
      field: "grNumber",
      message: `Bilty number differs: ours ${ourGr}, theirs ${theirGr}.`,
    });
  }

  // The rate SHOULD differ — that's the margin. Reported as information,
  // never as a problem.
  const info = [];
  const ourAmt = toKg(ours.totalAmount);
  const theirAmt = toKg(theirs.totalAmount);
  if (ourAmt && theirAmt && ourQty) {
    const margin = ourAmt - theirAmt;
    const perKg = margin / ourQty;
    info.push(
      `Margin on this consignment: ₹${Math.round(margin).toLocaleString("en-IN")} ` +
        `(₹${perKg.toFixed(2)}/kg).`
    );
  }

  return {
    ok: issues.filter((i) => i.severity === "high").length === 0,
    issues,
    info,
  };
}

// ---------------------------------------------------------------------
// 3. Trading or manufacturing?
// ---------------------------------------------------------------------

/**
 * Manufacturing supplies look completely different from trading ones.
 *
 * In trading, a vendor sells to us and we sell on: their invoice, their
 * e-way bill, a weight slip and a bilty all arrive.
 *
 * In manufacturing the material is our own. Only two documents come from
 * the plant — **our own** weight slip, on Biome letterhead, and the
 * bilty. There is no vendor and no vendor invoice, so a coordination
 * reference in the usual `BDC/809/MHI/47` form doesn't exist either.
 *
 * Treating a manufacturing supply as an incomplete trading one would
 * leave it permanently "waiting for a vendor invoice" that is never
 * coming. So it is detected and filed on its own terms.
 */
function detectSupplyType(docs, reference) {
  const types = docs.map((d) => d.documentType).filter(Boolean);

  const hasVendorPaper = types.some((t) => t.startsWith("vendor_"));
  const hasOurPaper = types.some((t) => t.startsWith("biome_"));
  const weightSlip = docs.find((d) => d.documentType === "weight_slip");

  // A weight slip on our own letterhead is the clearest signal: the
  // material was weighed at our plant, so it is ours.
  const ourWeighbridge =
    weightSlip &&
    /biome\s*industria/i.test(String(weightSlip.transcription || weightSlip.issuedBy || ""));

  // A reference naming a vendor means trading, whatever else is present.
  if (reference?.vendorCode) {
    return { type: "trading", confidence: 95, reason: `reference names vendor ${reference.vendorCode}` };
  }
  if (hasVendorPaper) {
    return { type: "trading", confidence: 85, reason: "vendor paperwork is present" };
  }
  if (ourWeighbridge) {
    return { type: "manufacturing", confidence: 85, reason: "the weight slip is on our own letterhead" };
  }
  if (hasOurPaper && !hasVendorPaper) {
    return {
      type: "manufacturing",
      confidence: 60,
      reason: "only our own documents are present, with no vendor invoice",
    };
  }
  return { type: "unknown", confidence: 0, reason: "not enough documents yet to tell" };
}

/**
 * What a manufacturing supply still needs.
 *
 * Deliberately short: only our own weight slip and the bilty come from
 * the plant, and then whichever document the client requires. Asking for
 * a vendor invoice here would be asking for something that does not
 * exist.
 */
function manufacturingChecklist(docs, client) {
  const types = new Set(docs.map((d) => d.documentType).filter(Boolean));
  const missing = [];

  if (!types.has("weight_slip")) missing.push({ key: "weight_slip", label: "Weight Slip (ours)" });
  if (!types.has("bilty_lr")) missing.push({ key: "bilty_lr", label: "Bilty / LR Copy" });

  const wantsChallan = (client?.requires || []).includes("delivery_challan");
  const hasOurDoc = types.has("biome_tax_invoice") || types.has("biome_delivery_challan");
  if (!hasOurDoc) {
    missing.push({
      key: wantsChallan ? "delivery_challan" : "tax_invoice",
      label: wantsChallan ? "Biome Delivery Challan" : "Biome Tax Invoice",
    });
  }
  if ((client?.requires || []).includes("eway_bill") && !types.has("biome_eway_bill")) {
    missing.push({ key: "eway_bill", label: "Biome E-Way Bill" });
  }

  return missing;
}

module.exports = {
  verifyVendorSet,
  verifyAgainstOurs,
  detectSupplyType,
  manufacturingChecklist,
  weightsAgree,
  normPlate,
  normNo,
};
