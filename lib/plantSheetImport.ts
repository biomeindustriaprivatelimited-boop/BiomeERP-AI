/**
 * Biome Platform — importing previous data into a plant's biomass or
 * transport sheet (server only)
 * -------------------------------------------------------------------
 * Same shape as the coordination import (lib/coordinationImport.ts):
 *
 *   1. The app's own Excel template — the sheet's entry columns, an
 *      Instructions sheet, a yellow EXAMPLE row (skipped on import),
 *      dropdowns, and the plant's registered vendor / transporter list.
 *   2. Upload → every row is checked and shown (missing required fields,
 *      bad dates / numbers, unknown vendor or transporter for THIS plant,
 *      duplicates against the sheet and within the file). Nothing is
 *      written until a person presses "Import valid rows".
 *   3. The confirm call re-checks the rows on the server against the
 *      sheet as it is THEN, and writes only the valid ones — into the
 *      plant the session is scoped to, never another.
 *
 * Imported rows arrive SUBMITTED (they are history, every required field
 * is present), so they get the same five days to be checked as a row
 * typed today, then freeze (lib/sheetLock.ts).
 */

import * as XLSX from "xlsx";
import { parseDateCell } from "@/lib/coordinationImport";
import { partnerSuggestions } from "@/lib/partners";
import { toKg } from "@/lib/units";
import { missingRequired, TRIP_PURPOSES, type SheetColumn } from "@/lib/plantSheets";
import { plantFile, readList, type SheetKind } from "@/lib/plantSheetStore";
import { slugToCode } from "@/lib/plantScope";
import {
  addLogo, letterhead, XL_COLORS,
} from "@/lib/excelStyle";
import { logoPng } from "@/lib/excelLogo";

export const EXAMPLE_MARK = "EXAMPLE";
export const MAX_IMPORT_ROWS = 5000;

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const plateOf = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Columns a person can import: what they type, never formulas, uploads or the accounts' remarks. */
export function importColumns(columns: SheetColumn[]): SheetColumn[] {
  return columns.filter((c) => c.kind === "entry" && c.key !== "accountsRemarks");
}

/* ------------------------------------------------------------------ */
/* Partners of THIS plant                                              */
/* ------------------------------------------------------------------ */

export interface PlantPartner {
  code: string;
  name: string;
  legalName: string;
  source: "registered" | "plant list";
}

export interface PlantPartners {
  vendors: PlantPartner[];
  transporters: PlantPartner[];
  clients: PlantPartner[];
}

/**
 * The partners a row of this plant may name: manufacturing partners
 * registered FOR this plant (never trading, never another plant's), plus
 * the plant's own vendor code list ("Import vendors" on the sheet).
 */
export function plantPartners(plantSlug: string): PlantPartners {
  const code = slugToCode(plantSlug) || "";
  const reg = partnerSuggestions({ plantCode: code }, ["vendor", "transporter", "client"]);
  const of = (k: string) =>
    reg.filter((p) => p.kind === k).map((p) => ({ code: String(p.code || "").toUpperCase(), name: p.name, legalName: p.legalName || "", source: "registered" as const }));
  const vendors: PlantPartner[] = of("vendor");
  const seen = new Set(vendors.map((v) => `${v.code}|${norm(v.name)}`));
  for (const v of readList<{ code: string; name: string }>(plantFile("vendors", plantSlug), "vendors")) {
    const k = `${String(v.code || "").toUpperCase()}|${norm(v.name)}`;
    if (!v.name || seen.has(k)) continue;
    seen.add(k);
    vendors.push({ code: String(v.code || "").toUpperCase(), name: v.name, legalName: "", source: "plant list" });
  }
  return { vendors, transporters: of("transporter"), clients: of("client") };
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

function formatHelp(c: SheetColumn): string {
  if (c.type === "date") return "Date — DD-MM-YYYY (e.g. 05-04-2025). A real Excel date also works.";
  if (c.type === "yesno") return "Yes or No (dropdown).";
  if (c.unit === "kg") return "Weight in kg (e.g. 28400). '28.4 MT' or '284 qtl' is converted; a bare number under 100 is read as tonnes.";
  if (c.type === "number") return /pct$/i.test(c.key) ? "Number — percent without the % sign (e.g. 4.5)." : "Number (no commas needed, no ₹ sign).";
  if (/time$/i.test(c.key)) return "Time — HH:MM (e.g. 14:35).";
  return "Text.";
}

function noteFor(c: SheetColumn, kind: SheetKind): string {
  const bits: string[] = [];
  if (c.suggest) {
    const what = c.key.toLowerCase().includes("transporter") ? "transporter" : c.key === "partyName" ? "client" : c.key.startsWith("shifter") ? "shifter (transporter or vendor)" : "vendor";
    if (what === "vendor" || what === "transporter") {
      bits.push(`Must be a ${what} registered for THIS plant (see the 'Registered' sheet). Give the code, the name, or both — the other is filled in. A code and name that disagree stop the row.`);
    } else bits.push(`Checked against this plant's registered ${what}s; an unknown name is imported with a warning.`);
  }
  if (c.key === "fs") bits.push("F = Farmer, S = Supplier.");
  if (c.key === "tripPurpose") bits.push(`${TRIP_PURPOSES.join(", ")}. Blank means Supply.`);
  if (kind === "transport" && ["partyName", "kantaParchi", "weight"].includes(c.key)) bits.push("Required for a Supply trip (not for Machine Repair / Maintenance / Other).");
  if (c.key === "vehicleNo") bits.push("e.g. HR55AB1234 — spaces are removed.");
  if (c.key === "driverMobile") bits.push("10-digit mobile.");
  if (c.key === "srNo") bits.push("Optional — numbered automatically after the sheet's last row when blank.");
  if (c.hint && !bits.length) bits.push(c.hint);
  return bits.join(" ");
}

function exampleValue(c: SheetColumn, kind: SheetKind, p: PlantPartners): any {
  const v = p.vendors[0], t = p.transporters[0], cl = p.clients[0];
  const map: Record<string, any> = kind === "transport"
    ? {
        srNo: 1, date: "05-04-2025", kantaParchi: "4411", partyName: cl?.name || "NTPC Dadri", to: "Dadri", inTime: "09:30",
        weight: 28400, rWeight: 28250, outTime: "10:15", vehicleNo: "HR55AB1234", driver: "Ramesh", driverMobile: "9876543210",
        transporterCode: t?.code || "TR01", transporter: t?.name || "Example Transport Co.", rate: 1.2, daala: 0,
        exemptFromTds: "No", tripPurpose: "Supply", remarks: `${EXAMPLE_MARK} — this row is skipped. Delete it or type over it.`,
      }
    : {
        srNo: 1, date: "05-04-2025", materialType: "Paddy Straw", weightSlipNo: "4411", vehicleNo: "HR55AB1234",
        vendorCode: v?.code || "BIO01", name: v?.name || "Example Vendor", vendorName: v?.name || "Example Vendor",
        village: "Khaleta", fs: "F", grossWeight: 28400, tareWeight: 9200, dustPct: 3, dustAllowance: 2,
        moisturePct: 12, moistureAllowance: 10, rate: 2.4, weighbridgeCharges: 100, anyDeduction: 150, finalWeight: 19050,
        weighbridgeCharge: 100, reference: "", shiftingApplicable: "No",
        plantManagerRemarks: `${EXAMPLE_MARK} — this row is skipped. Delete it or type over it.`,
        remarks: `${EXAMPLE_MARK} — this row is skipped. Delete it or type over it.`,
      };
  return map[c.key] ?? "";
}

export async function buildSheetTemplate(ExcelJS: any, input: {
  kind: SheetKind;
  plantName: string;
  columns: SheetColumn[];
  partners: PlantPartners;
  generatedBy: string;
}): Promise<Buffer> {
  const { kind, partners } = input;
  const cols = importColumns(input.columns);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria Private Limited";
  wb.created = new Date();
  const logoId = addLogo(wb, logoPng());
  const sheetLabel = kind === "transport" ? "Transport" : "Biomass";
  const LAST = 2003;

  /* ---- the data sheet ---- */
  const ws = wb.addWorksheet(`${sheetLabel} Data`, { properties: { tabColor: { argb: XL_COLORS.leaf } } });
  const head = letterhead(ws, {
    title: `${sheetLabel} Sheet — Import Template`,
    plant: input.plantName,
    generatedBy: input.generatedBy,
    note: "Fill one row per consignment under the green headings. Red headings are required. Keep the heading row as it is.",
  }, cols.length, logoId);
  const hr = ws.getRow(head);
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, size: 10, color: { argb: XL_COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? XL_COLORS.red : XL_COLORS.brand } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = { left: { style: "thin", color: { argb: "FF2F6B47" } }, right: { style: "thin", color: { argb: "FF2F6B47" } } };
    const n = [c.required ? "REQUIRED." : "", formatHelp(c), noteFor(c, kind)].filter(Boolean).join(" ");
    cell.note = n;
    ws.getColumn(i + 1).width = Math.max(11, Math.min(30, Math.round((c.width || 110) / 7)));
  });
  hr.height = 34;
  ws.views = [{ state: "frozen", ySplit: head, xSplit: 0, showGridLines: true }];

  const exRow = ws.getRow(head + 1);
  cols.forEach((c, i) => {
    const cell = exRow.getCell(i + 1);
    cell.value = exampleValue(c, kind, partners);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_COLORS.amberSoft } };
    cell.font = { italic: true, color: { argb: XL_COLORS.amber } };
  });

  const regSheet = kind === "transport" ? "Registered Transporters" : "Registered Vendors";
  const list = kind === "transport" ? partners.transporters : partners.vendors;
  cols.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const range = `${letter}${head + 1}:${letter}${LAST}`;
    // Dates kept as TEXT so 05-04-2025 stays day-first whatever the PC's locale.
    if (c.type === "date" || /time$/i.test(c.key) || c.key === "driverMobile" || c.key === "vehicleNo") {
      for (let r = head + 1; r <= Math.min(LAST, head + 400); r++) ws.getCell(`${letter}${r}`).numFmt = "@";
    }
    if (c.type === "yesno") {
      ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: ['"Yes,No"'], showErrorMessage: true, errorTitle: c.label, error: "Choose Yes or No." });
    } else if (c.key === "fs") {
      ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: ['"F,S"'], showErrorMessage: true, errorStyle: "warning", errorTitle: "F/S", error: "F = Farmer, S = Supplier." });
    } else if (c.key === "tripPurpose") {
      ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`"${TRIP_PURPOSES.join(",")}"`], showErrorMessage: true, errorStyle: "warning", errorTitle: "Trip purpose", error: `One of: ${TRIP_PURPOSES.join(", ")}.` });
    } else if (c.type === "number" && c.unit !== "kg") {
      ws.dataValidations.add(range, { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: "warning", errorTitle: c.label, error: "Enter a number (0 or more)." });
    } else if (c.suggest && list.length && (c.pairKey && (c.key.includes("transporter") ? kind === "transport" : kind === "biomass")) && !c.key.startsWith("shifter")) {
      const col = c.suggestField === "code" ? "B" : "A";
      ws.dataValidations.add(range, {
        type: "list", allowBlank: true, formulae: [`'${regSheet}'!$${col}$2:$${col}$${list.length + 1}`],
        showErrorMessage: true, errorStyle: "warning", errorTitle: c.label,
        error: "Not in this plant's registered list — the row will be refused on import.",
      });
    }
  });

  /* ---- instructions ---- */
  const ins = wb.addWorksheet("Instructions", { properties: { tabColor: { argb: XL_COLORS.brand } } });
  const iHead = letterhead(ins, { title: `How to import previous ${sheetLabel.toLowerCase()} data`, plant: input.plantName, generatedBy: input.generatedBy }, 4, logoId);
  ins.getColumn(1).width = 9;
  ins.getColumn(2).width = 28;
  ins.getColumn(3).width = 12;
  ins.getColumn(4).width = 90;
  const steps = [
    `Fill the '${sheetLabel} Data' sheet — one row per consignment (one vehicle / one weight slip). Do not rename or remove the heading row; extra columns are ignored.`,
    "Red headings are required. A row missing any of them is shown as an error and is not imported.",
    "Dates: DD-MM-YYYY (e.g. 05-04-2025) — day first, always. Real Excel dates are read correctly too.",
    "Weights are in kg. '28.4 MT' or '284 qtl' is converted to kg; a bare number under 100 is read as tonnes (×1000).",
    kind === "transport"
      ? `Transporter Code / Transporter must be a transporter registered for ${input.plantName} (see 'Registered Transporters'). Give the code, the name, or both.`
      : `Vendor Code / Name must be a vendor registered for ${input.plantName} (see 'Registered Vendors'). Give the code, the name, or both — the other is filled in. A code and name that disagree stop the row.`,
    "Duplicates — a row already in the sheet, or the same consignment twice in this file — are shown as errors and skipped.",
    `Upload it on the ${sheetLabel} sheet → Import. You see every row with its problems first; nothing is saved until you press "Import valid rows". Cancel leaves the sheet untouched.`,
    "Imported rows are added to THIS plant's sheet only, as Submitted. They stay editable for 5 days, then freeze — later changes need approval (Request edit).",
    `The yellow example row is skipped automatically (its remarks start with ${EXAMPLE_MARK}); you can delete it.`,
  ];
  let r = iHead;
  steps.forEach((s, i) => {
    ins.getCell(r, 1).value = i + 1;
    ins.getCell(r, 1).font = { bold: true, color: { argb: XL_COLORS.white } };
    ins.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_COLORS.leaf } };
    ins.getCell(r, 1).alignment = { horizontal: "center", vertical: "top" };
    ins.mergeCells(r, 2, r, 4);
    ins.getCell(r, 2).value = s;
    ins.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    ins.getRow(r).height = s.length > 120 ? 32 : 18;
    r += 1;
  });
  r += 1;
  ["Column", "Required", "What to enter"].forEach((h, i) => {
    const cell = ins.getCell(r, i + 2);
    cell.value = h;
    cell.font = { bold: true, color: { argb: XL_COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_COLORS.brand } };
  });
  r += 1;
  for (const c of cols) {
    ins.getCell(r, 2).value = c.label;
    ins.getCell(r, 3).value = c.required ? "Yes" : kind === "transport" && ["partyName", "kantaParchi", "weight"].includes(c.key) ? "Supply trips" : "";
    if (c.required) ins.getCell(r, 2).font = { bold: true, color: { argb: XL_COLORS.red } };
    ins.getCell(r, 4).value = [formatHelp(c), noteFor(c, kind)].filter(Boolean).join(" ");
    ins.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
    r += 1;
  }

  /* ---- the plant's registered list ---- */
  const ls = wb.addWorksheet(regSheet, { properties: { tabColor: { argb: XL_COLORS.blue } } });
  ls.columns = [{ header: kind === "transport" ? "Transporter" : "Vendor Name", width: 36 }, { header: "Code", width: 14 }, { header: "Source", width: 16 }];
  list.forEach((p) => ls.addRow([p.name, p.code, p.source]));
  ls.getRow(1).eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: XL_COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_COLORS.brand } };
  });
  ls.views = [{ state: "frozen", ySplit: 1 }];
  if (!list.length) ls.addRow([`No ${kind === "transport" ? "transporters" : "vendors"} registered for ${input.plantName} yet — register them first (Registration → Partners).`]);

  wb.views = [{ activeTab: 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ */
/* Reading the upload                                                  */
/* ------------------------------------------------------------------ */

export interface RawSheetRow {
  rowNumber: number;
  cells: Record<string, unknown>;
}

const SKIP_SHEETS = /instruction|registered|^lists?$|help|readme|summary/i;

/**
 * Heading → the keys it can mean, in sheet order. Mayan's book carries two
 * columns both called "Weightbridge charges" (the purchase's and the
 * shifter's); the first such heading is the first column, the second the
 * second — exactly as in their workbook and in the template.
 */
function headerIndex(cols: SheetColumn[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const put = (h: string, k: string) => {
    if (!h) return;
    const list = m.get(h) || [];
    if (!list.includes(k)) list.push(k);
    m.set(h, list);
  };
  for (const c of cols) {
    put(norm(c.label), c.key);
    put(norm(c.key), c.key);
    put(norm(c.label.replace(/\(.*?\)/g, "")), c.key);
  }
  // A few headings their old sheets use.
  const alias: Record<string, string> = {
    srno: "srNo", sno: "srNo", serialno: "srNo", vehicle: "vehicleNo", vehiclenumber: "vehicleNo", truckno: "vehicleNo",
    slipno: "weightSlipNo", weightslip: "weightSlipNo", gross: "grossWeight", tare: "tareWeight",
    vendor: cols.some((c) => c.key === "vendorName") ? "vendorName" : "name", vendorname: cols.some((c) => c.key === "vendorName") ? "vendorName" : "name",
    transportername: "transporter", party: "partyName", purpose: "tripPurpose", dispatchweight: "weight", receivingweight: "rWeight",
  };
  for (const [a, k] of Object.entries(alias)) if (!m.has(a) && cols.some((c) => c.key === k)) m.set(a, [k]);
  return m;
}

export function readSheetWorkbook(
  buffer: Buffer, fileName: string, columns: SheetColumn[]
): { rows: RawSheetRow[]; sheet: string; ignoredColumns: string[]; exampleRowsSkipped: number } | { error: string } {
  const cols = importColumns(columns);
  const index = headerIndex(cols);
  let wb: XLSX.WorkBook;
  try {
    const csv = /\.csv$/i.test(fileName);
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: csv });
  } catch (err) {
    return { error: `That file could not be read as a spreadsheet: ${(err as Error).message}` };
  }
  for (const name of wb.SheetNames) {
    if (SKIP_SHEETS.test(name.trim())) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    let headerAt = -1;
    for (let i = 0; i < Math.min(12, grid.length); i++) {
      const hits = new Set((grid[i] || []).map((h) => index.get(norm(h))?.[0]).filter(Boolean)).size;
      if (hits >= 3) { headerAt = i; break; }
    }
    if (headerAt < 0) continue;
    const ignored = new Set<string>();
    const used = new Set<string>();
    const keys = (grid[headerAt] || []).map((h) => {
      const options = index.get(norm(h)) || [];
      const k = options.find((x) => !used.has(x)) || null;
      if (k) used.add(k);
      else if (String(h ?? "").trim()) ignored.add(String(h).trim());
      return k;
    });
    const rows: RawSheetRow[] = [];
    let exampleRowsSkipped = 0;
    for (let r = headerAt + 1; r < grid.length; r++) {
      const line = grid[r] || [];
      const cells: Record<string, unknown> = {};
      let any = false;
      let example = false;
      keys.forEach((k, ci) => {
        if (!k) return;
        let v = line[ci];
        if (typeof v === "string") v = v.trim();
        if (v === "" || v === undefined) v = null;
        if (v !== null) any = true;
        if (typeof v === "string" && v.toUpperCase().startsWith(EXAMPLE_MARK)) example = true;
        if (cells[k] === undefined || cells[k] === null) cells[k] = v;
      });
      if (!any) continue;
      if (example) { exampleRowsSkipped += 1; continue; }
      rows.push({ rowNumber: r + 1, cells });
    }
    return { rows, sheet: name, ignoredColumns: [...ignored], exampleRowsSkipped };
  }
  return { error: "No sheet in that file has the sheet's column headings. Download the template, paste your data under its headings and upload it again." };
}

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

export interface SheetRowCheck {
  rowNumber: number;
  label: string;
  verdict: "ok" | "error";
  errors: string[];
  warnings: string[];
  /** The row as it would be stored. Present only when there are no errors. */
  values?: Record<string, any>;
}

function parseNumber(v: unknown): number | null | "bad" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : "bad";
  const s = String(v).trim().replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[,\s₹%]/g, "").replace(/\/-$/, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "bad";
}

function parseTime(v: unknown): string | "bad" | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const frac = v % 1;
    if (v < 0 || (v >= 1 && frac === 0 && v > 24)) return "bad";
    const mins = Math.round((v >= 1 && v <= 24 && frac === 0 ? v / 24 : frac) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!m) return s.length <= 20 ? s : "bad";
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) { const pm = /^p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return "bad";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function yesNo(v: unknown): "Yes" | "No" | "" | "bad" {
  const s = norm(v);
  if (!s) return "";
  if (["yes", "y", "true", "1", "haan", "ha"].includes(s)) return "Yes";
  if (["no", "n", "false", "0", "nahi"].includes(s)) return "No";
  return "bad";
}

function matchPartner(
  codeVal: string, nameVal: string, list: PlantPartner[]
): { ok: true; code: string; name: string; note?: string } | { ok: false; why: string } | null {
  const code = codeVal.trim().toUpperCase();
  const name = nameVal.trim();
  if (!code && !name) return null;
  if (code) {
    const hits = list.filter((p) => p.code && p.code === code);
    if (!hits.length) return { ok: false, why: `code ${code} is not registered for this plant` };
    if (name) {
      const same = hits.find((p) => norm(p.name) === norm(name) || (p.legalName && norm(p.legalName) === norm(name)));
      if (!same) return { ok: false, why: `code ${code} is registered as "${hits[0].name}", but the row says "${name}"` };
      return { ok: true, code, name: same.name };
    }
    return { ok: true, code, name: hits[0].name };
  }
  const hits = list.filter((p) => norm(p.name) === norm(name) || (p.legalName && norm(p.legalName) === norm(name)));
  const distinct = new Map(hits.map((p) => [`${p.code}|${norm(p.name)}`, p]));
  if (!distinct.size) return { ok: false, why: `"${name}" is not registered for this plant` };
  if (distinct.size > 1) return { ok: false, why: `"${name}" matches ${distinct.size} registered entries — give the code` };
  const p = [...distinct.values()][0];
  return { ok: true, code: p.code, name: p.name, note: p.name !== name ? `name read as "${p.name}"` : undefined };
}

export function dupKey(kind: SheetKind, r: Record<string, any>): string[] {
  const date = String(r.date || "").slice(0, 10);
  const plate = plateOf(r.vehicleNo);
  const keys: string[] = [];
  if (kind === "biomass") {
    const slip = norm(r.weightSlipNo);
    if (slip && date) keys.push(`slip|${date}|${slip}`);
    if (plate && date && r.grossWeight !== undefined && r.grossWeight !== "" && r.grossWeight !== null) keys.push(`veh|${date}|${plate}|${Number(r.grossWeight)}`);
  } else {
    const parchi = norm(r.kantaParchi);
    if (parchi && date) keys.push(`parchi|${date}|${parchi}|${plate}`);
    else if (plate && date) keys.push(`veh|${date}|${plate}|${Number(r.weight) || 0}|${norm(r.partyName)}|${norm(r.tripPurpose)}`);
  }
  return keys;
}

export function rowTitle(kind: SheetKind, v: Record<string, any>): string {
  const d = String(v.date || "").slice(0, 10).split("-").reverse().join("-");
  const bits = kind === "transport"
    ? [d, v.vehicleNo, v.kantaParchi && `Parchi ${v.kantaParchi}`, v.transporter || v.partyName]
    : [d, v.vehicleNo, v.weightSlipNo && `Slip ${v.weightSlipNo}`, v.name || v.vendorName];
  return bits.filter((b) => b !== undefined && b !== null && String(b).trim()).join(" · ") || "(blank row)";
}

export function checkSheetRows(
  rows: RawSheetRow[],
  ctx: { kind: SheetKind; columns: SheetColumn[]; existing: Record<string, any>[]; partners: PlantPartners }
): SheetRowCheck[] {
  const { kind } = ctx;
  const cols = importColumns(ctx.columns);
  const existing = new Set<string>();
  for (const r of ctx.existing) for (const k of dupKey(kind, r)) existing.add(k);
  const inFile = new Map<string, number>();
  const out: SheetRowCheck[] = [];

  for (const raw of rows) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const v: Record<string, any> = {};
    // A field already reported as wrong is not reported again as missing.
    const bad = new Set<string>();

    for (const c of cols) {
      const cell = raw.cells[c.key];
      if (cell === null || cell === undefined || cell === "") continue;
      if (c.type === "date") {
        const d = parseDateCell(cell);
        if (!d) continue;
        if ("error" in d) { errors.push(`${c.label}: ${d.error}`); bad.add(c.key); }
        else {
          if (d.iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) errors.push(`${c.label}: ${d.iso.split("-").reverse().join("-")} is in the future`);
          v[c.key] = d.iso;
        }
      } else if (c.unit === "kg") {
        const kg = toKg(typeof cell === "string" ? cell.replace(/,/g, "") : cell, { vehicle: true });
        if (kg === null || !Number.isFinite(kg)) { errors.push(`${c.label}: "${cell}" is not a weight`); bad.add(c.key); }
        else if (kg < 0) { errors.push(`${c.label}: cannot be negative`); bad.add(c.key); }
        else {
          v[c.key] = Math.round(kg * 100) / 100;
          if (typeof cell === "number" && cell > 0 && cell < 100) warnings.push(`${c.label}: ${cell} read as tonnes → ${v[c.key]} kg`);
        }
      } else if (c.type === "number") {
        const n = parseNumber(cell);
        if (n === "bad") { errors.push(`${c.label}: "${cell}" is not a number`); bad.add(c.key); }
        else if (n !== null) {
          if (n < 0 && c.key !== "srNo") errors.push(`${c.label}: cannot be negative`);
          v[c.key] = n;
        }
      } else if (c.type === "yesno") {
        const y = yesNo(cell);
        if (y === "bad") errors.push(`${c.label}: "${cell}" — use Yes or No`);
        else if (y) v[c.key] = y;
      } else if (/time$/i.test(c.key)) {
        const t = parseTime(cell);
        if (t === "bad") errors.push(`${c.label}: "${cell}" is not a time (HH:MM)`);
        else if (t) v[c.key] = t;
      } else {
        v[c.key] = String(cell).trim().slice(0, 300);
      }
    }

    // Clean-ups a person would make by hand.
    if (v.vehicleNo) v.vehicleNo = plateOf(v.vehicleNo);
    if (v.fs) {
      const f = norm(v.fs);
      if (f === "farmer" || f === "f") v.fs = "F";
      else if (f === "supplier" || f === "s") v.fs = "S";
      else warnings.push(`F/S: "${v.fs}" is neither F (Farmer) nor S (Supplier)`);
    }
    if (v.tripPurpose) {
      const hit = TRIP_PURPOSES.find((p) => norm(p) === norm(v.tripPurpose));
      if (hit) v.tripPurpose = hit;
      else warnings.push(`Trip Purpose: "${v.tripPurpose}" is not one of ${TRIP_PURPOSES.join(", ")}`);
    }
    if (v.driverMobile) {
      const digits = String(v.driverMobile).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
      if (digits.length !== 10) warnings.push(`Driver Mobile: "${v.driverMobile}" is not a 10-digit number`);
      else v.driverMobile = digits;
    }
    if (v.grossWeight !== undefined && v.tareWeight !== undefined && Number(v.tareWeight) > Number(v.grossWeight)) {
      errors.push("Tare weight is more than gross weight");
    }
    if (kind === "transport" && v.weight && v.rWeight && Number(v.rWeight) > Number(v.weight) * 1.1) {
      warnings.push("Receiving weight is more than 10% above the dispatch weight");
    }

    // The partner: registered for THIS plant, or the row stops.
    if (kind === "biomass") {
      const nameKey = cols.some((c) => c.key === "vendorName") ? "vendorName" : "name";
      const m = matchPartner(String(v.vendorCode || ""), String(v[nameKey] || ""), ctx.partners.vendors);
      if (m && !m.ok) { errors.push(`Vendor: ${m.why}`); bad.add(nameKey); }
      else if (m && m.ok) {
        if (m.code) v.vendorCode = m.code;
        v[nameKey] = m.name;
        if (m.note) warnings.push(`Vendor ${m.note}`);
      }
      if (v.shifterName || v.shifterVendorCode) {
        const sm = matchPartner(String(v.shifterVendorCode || ""), String(v.shifterName || ""), [...ctx.partners.transporters, ...ctx.partners.vendors]);
        if (sm && !sm.ok) warnings.push(`Shifter: ${sm.why} — imported as typed`);
        else if (sm && sm.ok) { if (sm.code) v.shifterVendorCode = sm.code; v.shifterName = sm.name; }
      }
    } else {
      const m = matchPartner(String(v.transporterCode || ""), String(v.transporter || ""), ctx.partners.transporters);
      if (m && !m.ok) { errors.push(`Transporter: ${m.why}`); bad.add("transporter"); }
      else if (m && m.ok) {
        if (m.code) v.transporterCode = m.code;
        v.transporter = m.name;
        if (m.note) warnings.push(`Transporter ${m.note}`);
      }
      if (v.partyName) {
        const pm = matchPartner("", String(v.partyName), ctx.partners.clients);
        if (pm && pm.ok) v.partyName = pm.name;
        else if (ctx.partners.clients.length) warnings.push(`Party "${v.partyName}" is not a registered client of this plant — imported as typed`);
      }
    }

    const missing = missingRequired(kind, ctx.columns, v)
      .filter((label) => !ctx.columns.some((c) => c.label === label && bad.has(c.key)));
    if (missing.length) errors.unshift(`Missing: ${missing.join(", ")}`);

    // Duplicates — against the sheet, then against earlier rows of this file.
    const keys = dupKey(kind, v);
    if (keys.some((k) => existing.has(k))) errors.push("Already in the sheet (same date and slip / parchi / vehicle and weight)");
    else {
      const earlier = keys.map((k) => inFile.get(k)).find((n) => n !== undefined);
      if (earlier !== undefined) errors.push(`Same consignment as row ${earlier} of this file`);
    }
    if (!errors.length) for (const k of keys) inFile.set(k, raw.rowNumber);

    out.push({
      rowNumber: raw.rowNumber,
      label: rowTitle(kind, v),
      verdict: errors.length ? "error" : "ok",
      errors,
      warnings,
      values: errors.length ? undefined : v,
    });
  }
  return out;
}
