/**
 * Biome Platform — Delivery Challan Generator
 * -------------------------------------------------------------------
 * Shared field list, per-client defaults and the weight calculation for
 * the NTPC Mouda / NTPC Solapur delivery challan. Both the form page and
 * the PDF/Excel API routes import this so the three never drift apart —
 * a field added here shows up in the form AND both exports for free.
 */

export type ChallanClient = "ntpc_mouda" | "ntpc_solapur";

export interface ChallanFormData {
  client: ChallanClient;

  // Header & dispatch
  challanNo: string;
  challanDate: string; // DD-MM-YYYY
  poNo: string; // P.O. No. / LOA No.
  loaDate: string;
  bdcRefNo: string; // Other References / BDC Ref No.
  ewayBillNo: string;
  vendorCode: string;

  // Logistics
  transporterName: string;
  vehicleNo: string;
  lrNo: string; // L.R. / R.R. No.
  driverMobile: string;
  driverLicenseNo: string;
  destination: string;

  // Goods & weight
  itemDescription: string;
  hsnCode: string;
  grossWeightKg: string;
  tareWeightKg: string;

  // Annexure-II / consignment tag
  batchNumber: string;
  pelletSpec: string;
  baseMaterialPct: string;
  mixingMaterialPct: string;
  additivePct: string;
}

export const CLIENT_LABELS: Record<ChallanClient, string> = {
  ntpc_mouda: "NTPC Limited (Mouda)",
  ntpc_solapur: "NTPC Ltd (Solapur)",
};

/** Per-client defaults, applied when the client selector changes — the
 *  user can still edit any of them, this just saves re-typing what's
 *  the same on every challan for that client. */
export const CHALLAN_DEFAULTS: Record<ChallanClient, Partial<ChallanFormData>> = {
  ntpc_mouda: {
    itemDescription: "AGRO RESIDUE BIOMASS PELLETS",
    hsnCode: "440110",
    pelletSpec: "18MM with GCV 4000 Kcal/Kg",
    baseMaterialPct: "Agro Residue Pellets- 80%",
    mixingMaterialPct: "Other Agro Residue Pellets- 20%",
    additivePct: "NIL",
  },
  ntpc_solapur: {
    itemDescription: "AGRO RESIDUE BIOMASS PELLETS",
    hsnCode: "4401",
    pelletSpec: "18MM with GCV 4000 Kcal/Kg",
    baseMaterialPct: "Agro Residue Pellets- 80%",
    mixingMaterialPct: "Other Agro Residue Pellets- 20%",
    additivePct: "NIL",
  },
};

export const BLANK_CHALLAN: ChallanFormData = {
  client: "ntpc_mouda",
  challanNo: "",
  challanDate: "",
  poNo: "",
  loaDate: "",
  bdcRefNo: "",
  ewayBillNo: "",
  vendorCode: "",
  transporterName: "",
  vehicleNo: "",
  lrNo: "",
  driverMobile: "",
  driverLicenseNo: "",
  destination: "",
  itemDescription: CHALLAN_DEFAULTS.ntpc_mouda.itemDescription || "",
  hsnCode: CHALLAN_DEFAULTS.ntpc_mouda.hsnCode || "",
  grossWeightKg: "",
  tareWeightKg: "",
  batchNumber: "",
  pelletSpec: CHALLAN_DEFAULTS.ntpc_mouda.pelletSpec || "",
  baseMaterialPct: CHALLAN_DEFAULTS.ntpc_mouda.baseMaterialPct || "",
  mixingMaterialPct: CHALLAN_DEFAULTS.ntpc_mouda.mixingMaterialPct || "",
  additivePct: CHALLAN_DEFAULTS.ntpc_mouda.additivePct || "",
};

/** Net Material Weight = Gross Weight - Tare Weight, floored at 0 so a
 *  half-filled form never shows a negative weight. */
export function calcNetWeightKg(grossWeightKg: string, tareWeightKg: string): number {
  const g = Number(grossWeightKg) || 0;
  const t = Number(tareWeightKg) || 0;
  const n = g - t;
  return n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function kgToMt(kg: number): number {
  return Math.round((kg / 1000) * 1000) / 1000;
}
