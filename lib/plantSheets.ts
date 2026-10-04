/**
 * Plant sheets — biomass purchase and transport.
 * -------------------------------------------------------------------
 * The two plants keep different books, and the difference is real
 * rather than cosmetic: Rewari deducts for dust and moisture against
 * agreed allowances and settles a shifter separately; Gangakhed takes a
 * single deduction and pays on a final weight. Forcing one schema on
 * both would mean either inventing columns Gangakhed does not use or
 * dropping ones Rewari depends on.
 *
 * So each plant keeps its own column list, and every formula here is
 * taken verbatim from the plant's own workbook — not re-derived. A
 * derived column is computed in the app AND written back as a real Excel
 * formula on export, so the exported file behaves exactly like the sheet
 * the plant manager already works in.
 */

export type SuggestKind = "vendor" | "transporter" | "client";

/** Sheet folder of a plant: "rewari" (Mayan), "gangakhed", or a new plant's code. */
export type PlantId = string;

export interface SheetColumn {
  /** Excel column letter, so an export lands where the plant expects it. */
  cell: string;
  key: string;
  label: string;
  /** entry = the manager types it; derived = the sheet works it out. */
  kind: "entry" | "derived" | "upload";
  type?: "text" | "number" | "date" | "yesno";
  /** Excel formula, with {row} replaced by the row number. */
  formula?: string;
  /** How the app computes the same thing for on-screen totals. */
  compute?: (r: Record<string, any>) => number | string;
  width?: number;
  hint?: string;
  /** Weight entry: typed in kg, qtl or MT, stored in kg. */
  unit?: "kg";
  /**
   * Typeahead fed by the partners register — only this plant's registered
   * vendors / transporters / clients (see /api/partners/suggest).
   */
  suggest?: SuggestKind | SuggestKind[];
  /** What the typeahead matches and fills: the partner's name or its code. */
  suggestField?: "name" | "code";
  /** Sibling column filled with the other half (code ↔ name) on pick. */
  pairKey?: string;
}

const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------
// Rewari, Haryana
// ---------------------------------------------------------------------

export const REWARI_COLUMNS: SheetColumn[] = [
  { cell: "B", key: "srNo", label: "Sr. No.", kind: "entry", type: "number", width: 60 },
  { cell: "C", key: "date", label: "Date", kind: "entry", type: "date", width: 110 },
  { cell: "D", key: "materialType", label: "Material Type", kind: "entry", width: 130 },
  { cell: "E", key: "weightSlipNo", label: "Weight Slip No.", kind: "entry", width: 120 },
  // Added so the uploaded slip can be checked against the entry — the slip
  // always carries a vehicle number, and it is the field that tells a typo
  // apart from the wrong slip being attached.
  { cell: "EA", key: "vehicleNo", label: "Vehicle No.", kind: "entry", width: 120, hint: "Checked against the weight slip" },
  { cell: "F", key: "vendorCode", label: "Vendor Code", kind: "entry", width: 110, suggest: "vendor", suggestField: "code", pairKey: "name" },
  { cell: "G", key: "name", label: "Name", kind: "entry", width: 150, suggest: "vendor", suggestField: "name", pairKey: "vendorCode" },
  { cell: "H", key: "village", label: "Village Location", kind: "entry", width: 140 },
  { cell: "I", key: "fs", label: "F/S", kind: "entry", width: 60, hint: "Farmer or Supplier" },
  { cell: "J", key: "grossWeight", label: "Gross Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 110 },
  { cell: "K", key: "tareWeight", label: "Tare Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 110 },
  {
    cell: "L", key: "netWeight", label: "Net. Weight (kg)", kind: "derived", type: "number", width: 110,
    formula: "=J{row}-K{row}",
    compute: (r) => num(r.grossWeight) - num(r.tareWeight),
  },
  { cell: "M", key: "dustPct", label: "Dust %", kind: "entry", type: "number", width: 90 },
  { cell: "N", key: "dustAllowance", label: "Dust Allowance", kind: "entry", type: "number", width: 120 },
  {
    cell: "O", key: "actualDust", label: "Actual Dust", kind: "derived", type: "number", width: 110,
    // Nothing is deducted while dust stays within the agreed allowance.
    formula: '=IF(M{row}>N{row},(L{row}*(M{row}-N{row})/100),0)',
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      return num(r.dustPct) > num(r.dustAllowance)
        ? (net * (num(r.dustPct) - num(r.dustAllowance))) / 100
        : 0;
    },
  },
  { cell: "P", key: "moisturePct", label: "Moisture %", kind: "entry", type: "number", width: 100 },
  { cell: "Q", key: "moistureAllowance", label: "Moisture Allowance", kind: "entry", type: "number", width: 140 },
  {
    cell: "R", key: "actualMoisture", label: "Actual Moisture", kind: "derived", type: "number", width: 130,
    formula: '=IF(P{row}>Q{row},(L{row}*(P{row}-Q{row})/100),0)',
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      return num(r.moisturePct) > num(r.moistureAllowance)
        ? (net * (num(r.moisturePct) - num(r.moistureAllowance))) / 100
        : 0;
    },
  },
  {
    cell: "S", key: "payableWeight", label: "Payble Weight (kg)", kind: "derived", type: "number", width: 120,
    formula: "=L{row}-O{row}-R{row}",
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      const dust = num(r.dustPct) > num(r.dustAllowance) ? (net * (num(r.dustPct) - num(r.dustAllowance))) / 100 : 0;
      const moist = num(r.moisturePct) > num(r.moistureAllowance) ? (net * (num(r.moisturePct) - num(r.moistureAllowance))) / 100 : 0;
      return net - dust - moist;
    },
  },
  { cell: "T", key: "rate", label: "Rate", kind: "entry", type: "number", width: 90 },
  {
    cell: "U", key: "amount", label: "Amount", kind: "derived", type: "number", width: 120,
    formula: "=S{row}*T{row}",
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      const dust = num(r.dustPct) > num(r.dustAllowance) ? (net * (num(r.dustPct) - num(r.dustAllowance))) / 100 : 0;
      const moist = num(r.moisturePct) > num(r.moistureAllowance) ? (net * (num(r.moisturePct) - num(r.moistureAllowance))) / 100 : 0;
      return (net - dust - moist) * num(r.rate);
    },
  },
  { cell: "V", key: "weighbridgeCharges", label: "Weightbridge charges", kind: "entry", type: "number", width: 150 },
  {
    cell: "W", key: "netPayableAmount", label: "Net Payble Amount", kind: "derived", type: "number", width: 150,
    formula: "=U{row}-V{row}",
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      const dust = num(r.dustPct) > num(r.dustAllowance) ? (net * (num(r.dustPct) - num(r.dustAllowance))) / 100 : 0;
      const moist = num(r.moisturePct) > num(r.moistureAllowance) ? (net * (num(r.moisturePct) - num(r.moistureAllowance))) / 100 : 0;
      return (net - dust - moist) * num(r.rate) - num(r.weighbridgeCharges);
    },
  },
  { cell: "X", key: "kantaParchi", label: "Kanta Parchi", kind: "upload", width: 140, hint: "The weighbridge slip — upload the photo or PDF" },
  { cell: "Y", key: "reference", label: "Reference", kind: "entry", width: 120 },
  { cell: "Z", key: "plantManagerRemarks", label: "Plant Manager Remarks", kind: "entry", width: 180 },
  { cell: "AA", key: "accountsRemarks", label: "Accounts Team Remarks", kind: "entry", width: 180 },

  // ---- Shifting: paid to a second party who moves the material ----
  { cell: "AC", key: "shiftingApplicable", label: "Shifting Applicable", kind: "entry", type: "yesno", width: 130 },
  { cell: "AD", key: "shifterName", label: "Name of Shifter", kind: "entry", width: 150, suggest: ["transporter", "vendor"], suggestField: "name", pairKey: "shifterVendorCode" },
  { cell: "AE", key: "shifterVendorCode", label: "Shifter Vendor Code", kind: "entry", width: 140, suggest: ["transporter", "vendor"], suggestField: "code", pairKey: "shifterName" },
  {
    cell: "AF", key: "shiftPayableWeight", label: "Payble Weight", kind: "derived", type: "number", width: 120,
    formula: '=IF(AC{row}="YES",L{row},"0")',
    compute: (r) =>
      String(r.shiftingApplicable || "").toUpperCase() === "YES"
        ? num(r.grossWeight) - num(r.tareWeight)
        : 0,
  },
  { cell: "AG", key: "shiftRate", label: "Payble Rate", kind: "entry", type: "number", width: 110 },
  {
    cell: "AH", key: "shiftAmount", label: "Payble Amount", kind: "derived", type: "number", width: 130,
    formula: "=AF{row}*AG{row}",
    compute: (r) => {
      const w = String(r.shiftingApplicable || "").toUpperCase() === "YES" ? num(r.grossWeight) - num(r.tareWeight) : 0;
      return w * num(r.shiftRate);
    },
  },
  { cell: "AI", key: "shiftWeighbridge", label: "Weightbridge charges", kind: "entry", type: "number", width: 150 },
  {
    cell: "AJ", key: "shiftFinalPayment", label: "Final Payment Amount", kind: "derived", type: "number", width: 160,
    formula: "=AH{row}-AI{row}",
    compute: (r) => {
      const w = String(r.shiftingApplicable || "").toUpperCase() === "YES" ? num(r.grossWeight) - num(r.tareWeight) : 0;
      return w * num(r.shiftRate) - num(r.shiftWeighbridge);
    },
  },
  {
    cell: "AK", key: "finalBiomassValue", label: "Final Biomass Value", kind: "derived", type: "number", width: 160,
    formula: "=W{row}+AJ{row}",
    compute: (r) => {
      const net = num(r.grossWeight) - num(r.tareWeight);
      const dust = num(r.dustPct) > num(r.dustAllowance) ? (net * (num(r.dustPct) - num(r.dustAllowance))) / 100 : 0;
      const moist = num(r.moisturePct) > num(r.moistureAllowance) ? (net * (num(r.moisturePct) - num(r.moistureAllowance))) / 100 : 0;
      const payable = (net - dust - moist) * num(r.rate) - num(r.weighbridgeCharges);
      const w = String(r.shiftingApplicable || "").toUpperCase() === "YES" ? net : 0;
      return payable + (w * num(r.shiftRate) - num(r.shiftWeighbridge));
    },
  },
];

// ---------------------------------------------------------------------
// Gangakhed, Maharashtra — a shorter book
// ---------------------------------------------------------------------

export const GANGAKHED_COLUMNS: SheetColumn[] = [
  { cell: "B", key: "srNo", label: "Sr. No.", kind: "entry", type: "number", width: 60 },
  { cell: "C", key: "date", label: "Date", kind: "entry", type: "date", width: 110 },
  { cell: "D", key: "materialType", label: "Material Type", kind: "entry", width: 130 },
  { cell: "E", key: "weightSlipNo", label: "Weight Slip No.", kind: "entry", width: 120 },
  // Added so the uploaded slip can be checked against the entry — the slip
  // always carries a vehicle number, and it is the field that tells a typo
  // apart from the wrong slip being attached.
  { cell: "EA", key: "vehicleNo", label: "Vehicle No.", kind: "entry", width: 120, hint: "Checked against the weight slip" },
  { cell: "F", key: "vendorCode", label: "Vendor Code", kind: "entry", width: 110, suggest: "vendor", suggestField: "code", pairKey: "vendorName" },
  { cell: "G", key: "vendorName", label: "Vendor Name", kind: "entry", width: 170, suggest: "vendor", suggestField: "name", pairKey: "vendorCode" },
  { cell: "H", key: "grossWeight", label: "Gross Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 110 },
  { cell: "I", key: "tareWeight", label: "Tare Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 110 },
  {
    cell: "J", key: "netWeight", label: "Net. Weight (kg)", kind: "derived", type: "number", width: 110,
    formula: "=H{row}-I{row}",
    compute: (r) => num(r.grossWeight) - num(r.tareWeight),
  },
  { cell: "K", key: "anyDeduction", label: "Any Deduction", kind: "entry", type: "number", width: 120 },
  {
    cell: "L", key: "payableWeight", label: "Payble Weight (kg)", kind: "derived", type: "number", width: 120,
    formula: "=J{row}-K{row}",
    compute: (r) => num(r.grossWeight) - num(r.tareWeight) - num(r.anyDeduction),
  },
  { cell: "M", key: "finalWeight", label: "Final Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 110 },
  { cell: "N", key: "rate", label: "Rate", kind: "entry", type: "number", width: 90 },
  {
    cell: "O", key: "amount", label: "Amount", kind: "derived", type: "number", width: 120,
    formula: "=M{row}*N{row}",
    compute: (r) => num(r.finalWeight) * num(r.rate),
  },
  { cell: "P", key: "weighbridgeCharge", label: "Weight-Bridge Charge", kind: "entry", type: "number", width: 150 },
  {
    cell: "Q", key: "finalAmount", label: "Final Amount", kind: "derived", type: "number", width: 130,
    formula: "=O{row}-P{row}",
    compute: (r) => num(r.finalWeight) * num(r.rate) - num(r.weighbridgeCharge),
  },
  { cell: "R", key: "remarks", label: "Remarks", kind: "entry", width: 180 },
  { cell: "S", key: "weightSlipCopy", label: "Weight Slip Copy", kind: "upload", width: 150, hint: "Upload the weighbridge slip" },
  { cell: "T", key: "accountsRemarks", label: "Account Team Remarks", kind: "entry", width: 180 },
];

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

export const TRANSPORT_COLUMNS: SheetColumn[] = [
  { cell: "A", key: "srNo", label: "S/No.", kind: "entry", type: "number", width: 60 },
  { cell: "B", key: "date", label: "Date", kind: "entry", type: "date", width: 110 },
  { cell: "C", key: "kantaParchi", label: "Kanta Parchi", kind: "entry", width: 120 },
  { cell: "D", key: "partyName", label: "Party Name", kind: "entry", width: 140, suggest: "client", suggestField: "name" },
  { cell: "E", key: "to", label: "To", kind: "entry", width: 130 },
  { cell: "F", key: "inTime", label: "In Time", kind: "entry", width: 100 },
  { cell: "G", key: "weight", label: "Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 100, hint: "Dispatch weight" },
  { cell: "H", key: "rWeight", label: "R. Weight (kg)", kind: "entry", type: "number", unit: "kg", width: 100, hint: "Receiving weight at the client" },
  {
    cell: "I", key: "actualWeight", label: "Actual Calculation Weight (kg)", kind: "derived", type: "number", width: 170,
    // The lower of the two. Freight is never paid on more material than
    // actually arrived, and the plant's own sheet already works this way.
    formula: "=MIN(G{row},H{row})",
    compute: (r) => {
      const a = num(r.weight);
      const b = num(r.rWeight);
      if (!a) return b;
      if (!b) return a;
      return Math.min(a, b);
    },
  },
  { cell: "J", key: "outTime", label: "Out Time", kind: "entry", width: 100 },
  { cell: "K", key: "vehicleNo", label: "Vehicle No.", kind: "entry", width: 120 },
  // The receiving slip from the client end. Its net weight is what
  // R. Weight above is checked against — that difference is the shortage
  // the coordination register exists to catch.
  { cell: "KA", key: "weightSlipCopy", label: "Weight Slip", kind: "upload", width: 150, hint: "Upload the receiving slip — its net weight is matched against R. Weight" },
  { cell: "L", key: "driver", label: "Driver", kind: "entry", width: 130 },
  // Added at the company's request: a driver without a number is a driver
  // nobody can reach when a truck is late at the gate.
  { cell: "M", key: "driverMobile", label: "Driver Mobile", kind: "entry", width: 130, hint: "10-digit mobile" },
  { cell: "N", key: "transporter", label: "Transporter", kind: "entry", width: 150, suggest: "transporter", suggestField: "name" },
  { cell: "O", key: "rate", label: "Rate", kind: "entry", type: "number", width: 90 },
  { cell: "P", key: "daala", label: "Daala", kind: "entry", type: "number", width: 90 },
  {
    cell: "Q", key: "amount", label: "Amount", kind: "derived", type: "number", width: 120,
    formula: "=(O{row}*I{row})-P{row}",
    compute: (r) => {
      const a = num(r.weight);
      const b = num(r.rWeight);
      const w = !a ? b : !b ? a : Math.min(a, b);
      return num(r.rate) * w - num(r.daala);
    },
  },
  { cell: "R", key: "exemptFromTds", label: "Exempt from TDS", kind: "entry", type: "yesno", width: 130 },
  // Trips are not all deliveries: the same vehicle goes out for machine
  // repairs and other errands, and those must not be read as supplies.
  { cell: "S", key: "tripPurpose", label: "Trip Purpose", kind: "entry", width: 140, hint: "Supply, Machine Repair, Other" },
  { cell: "T", key: "remarks", label: "Remarks", kind: "entry", width: 180 },
];

export const PLANTS: Record<
  PlantId,
  { id: PlantId; name: string; state: string; code: string; biomass: SheetColumn[] }
> = {
  rewari: {
    id: "rewari",
    name: "Mayan Plant",
    state: "Haryana",
    code: "REW",
    biomass: REWARI_COLUMNS,
  },
  gangakhed: {
    id: "gangakhed",
    name: "Gangakhed Plant",
    state: "Maharashtra",
    code: "GKD",
    biomass: GANGAKHED_COLUMNS,
  },
};

/** Fill in every derived column for a row, so totals are live on screen. */
export function computeRow(columns: SheetColumn[], row: Record<string, any>): Record<string, any> {
  const out = { ...row };
  for (const col of columns) {
    if (col.kind === "derived" && col.compute) out[col.key] = col.compute(out);
  }
  return out;
}

/** Column totals for the numeric columns, used in the footer. */
export function totals(columns: SheetColumn[], rows: Record<string, any>[]) {
  const sums: Record<string, number> = {};
  for (const col of columns) {
    if (col.type !== "number") continue;
    sums[col.key] = rows.reduce((s, r) => s + num(computeRow(columns, r)[col.key]), 0);
  }
  return sums;
}

export const TRIP_PURPOSES = ["Supply", "Machine Repair", "Maintenance", "Other"] as const;
