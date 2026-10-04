/**
 * Biome Platform — historical data import for the coordination register
 * -------------------------------------------------------------------
 * Brings the business's previous working sheets (challan, tax invoice,
 * receiving and lab report figures) into the register, from the app's own
 * Excel template.
 *
 * Three rules shape everything here:
 *
 *   1. A trading row must name a vendor REGISTERED in the app (Registration
 *      → vendors, or the vendor master the WhatsApp agent reads). Imported
 *      history that is not tied to a registered vendor cannot be matched to
 *      papers, POs or the shortfall-by-supplier table, so it is refused.
 *   2. Nothing is written until a person has seen, row by row, what is
 *      missing and what is wrong — and chosen to import with the gaps, to
 *      import only complete rows, or to cancel and correct the sheet.
 *   3. An imported row goes through the same reader as a typed one
 *      (readTripInput), takes the next serial, carries createdBy, and obeys
 *      the same freeze. Its document number is kept as a MANUAL number —
 *      a historical number must never consume a serial from a live series.
 */

import crypto from "crypto";
import * as XLSX from "xlsx";
import { paths, readJson } from "@/lib/dataRoot";
import type { Client, Vendor } from "@/lib/whatsapp";
import { loadPartners } from "@/lib/partners";
import { loadPlants } from "@/lib/plants";
import { toKg } from "@/lib/units";
import { parseRef } from "@/lib/tripDocs";
import { loadSeriesFile, saveSeriesFile, type BusinessType } from "@/lib/numberSeries";
import {
  blankTrip, lockStateFor, readTripInput, TRIP_STATUS,
  type Trip, type TripLab, type TripStatus,
} from "@/lib/coordination";

/* ------------------------------------------------------------------ */
/* The template's columns                                              */
/* ------------------------------------------------------------------ */

export type ColumnKind = "text" | "date" | "weight" | "amount" | "percent" | "gcv" | "doctype" | "status" | "business";

export interface ImportColumn {
  key: string;
  header: string;
  /** Other headings accepted for this column (their old sheets). */
  aliases: string[];
  kind: ColumnKind;
  /** Which register's sheet carries it. */
  registers: BusinessType[];
  /** One line for the Instructions sheet. */
  help: string;
  width?: number;
  /** Counted as "missing" when blank (a warning, never a block). */
  expected?: boolean;
}

const BOTH: BusinessType[] = ["trading", "manufacturing"];
const TRADING: BusinessType[] = ["trading"];
const MFG: BusinessType[] = ["manufacturing"];

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "business", header: "Business", aliases: ["register", "business type"], kind: "business", registers: BOTH, width: 14,
    help: "Trading or Manufacturing. Optional — the sheet name (Trading / Manufacturing) decides it when blank." },
  { key: "docType", header: "Our Doc Type", aliases: ["doc type", "document type", "biome doc type"], kind: "doctype", registers: BOTH, width: 18,
    help: "Tax Invoice or Delivery Challan — what WE raised. Blank = Delivery Challan." },
  { key: "ourDocNo", header: "Our Doc No", aliases: ["our document no", "biome challan no", "biome invoice no", "our challan no", "our invoice no", "doc no", "dc no"], kind: "text", registers: BOTH, width: 18, expected: true,
    help: "Our tax invoice / delivery challan number. Kept exactly as typed (a manual number) — no number is taken from a series." },
  { key: "ourDocDate", header: "Our Doc Date", aliases: ["our document date", "doc date", "challan date (our)", "dc date"], kind: "date", registers: BOTH, width: 14, expected: true,
    help: "Date of our invoice / challan. DD-MM-YYYY." },
  { key: "referenceNo", header: "Reference No", aliases: ["reference", "ref no", "coordination reference"], kind: "text", registers: BOTH, width: 20,
    help: "Optional. e.g. BDC/45/JSR/15. Blank = built automatically from the trip." },
  { key: "client", header: "Client", aliases: ["client name", "customer", "party"], kind: "text", registers: BOTH, width: 24,
    help: "REQUIRED. Client as in the client master (short names and aliases are recognised)." },
  { key: "location", header: "Client Location", aliases: ["location", "site", "delivery location"], kind: "text", registers: BOTH, width: 18, expected: true,
    help: "The client's site, e.g. Mouda, Solapur." },
  { key: "poNumber", header: "PO Number", aliases: ["po no", "po", "purchase order"], kind: "text", registers: BOTH, width: 18, expected: true,
    help: "The client's purchase order number." },
  { key: "poDate", header: "PO Date", aliases: ["purchase order date"], kind: "date", registers: BOTH, width: 14,
    help: "DD-MM-YYYY." },
  { key: "vendorName", header: "Vendor Name", aliases: ["vendor", "supplier", "supplier name", "party name"], kind: "text", registers: TRADING, width: 26,
    help: "REQUIRED (trading). Must match a vendor REGISTERED in the app — see the 'Registered Vendors' sheet. Otherwise the row is refused." },
  { key: "vendorCode", header: "Vendor Code", aliases: ["supplier code", "code"], kind: "text", registers: TRADING, width: 12,
    help: "Optional when the name is given. Must belong to the same registered vendor." },
  { key: "vendorDocType", header: "Vendor Doc Type", aliases: ["vendor document type"], kind: "doctype", registers: TRADING, width: 18,
    help: "Tax Invoice or Delivery Challan — what the VENDOR sent. Blank = worked out from the numbers given." },
  { key: "vendorChallanNo", header: "Vendor Challan No", aliases: ["challan no", "vendor challan", "vendor dc no"], kind: "text", registers: TRADING, width: 16,
    help: "The vendor's challan number." },
  { key: "vendorChallanDate", header: "Vendor Challan Date", aliases: ["challan date", "vendor invoice date", "vendor doc date"], kind: "date", registers: TRADING, width: 16, expected: true,
    help: "DD-MM-YYYY." },
  { key: "vendorInvoiceNo", header: "Vendor Invoice No", aliases: ["vendor invoice", "vendor bill no", "supplier invoice no"], kind: "text", registers: TRADING, width: 16,
    help: "The vendor's tax invoice number. Give the challan no or the invoice no (or both)." },
  { key: "plant", header: "Plant Code", aliases: ["plant", "from plant", "dispatch plant"], kind: "text", registers: MFG, width: 12,
    help: "REQUIRED (manufacturing). The plant the truck left from — see the 'Plants' sheet (e.g. REW, GKD)." },
  { key: "vehicleNumber", header: "Vehicle No", aliases: ["vehicle", "vehicle number", "truck no", "lorry no"], kind: "text", registers: BOTH, width: 15, expected: true,
    help: "e.g. HR55AB1234. Spaces and dashes are removed." },
  { key: "vehicleEntryDate", header: "Dispatch Date", aliases: ["vehicle entry date", "entry date", "loading date", "date"], kind: "date", registers: BOTH, width: 14, expected: true,
    help: "The day the vehicle left. Decides the month the trip belongs to. Blank = the challan / our doc date." },
  { key: "vendorChallanWeight", header: "Challan Weight (kg)", aliases: ["dispatch weight", "dispatch weight (kg)", "challan weight", "vendor challan weight", "weight", "dispatch qty"], kind: "weight", registers: BOTH, width: 16, expected: true,
    help: "Weight on the challan / dispatch slip in kg. '28.4 MT' or a bare 28.4 (tonnes) is converted." },
  { key: "vendorChallanAmount", header: "Challan Amount (Rs)", aliases: ["challan amount", "amount", "vendor amount"], kind: "amount", registers: BOTH, width: 16,
    help: "Value on the vendor's challan / invoice, in rupees." },
  { key: "receivingDate", header: "Receiving Date", aliases: ["received date", "unloading date", "receipt date"], kind: "date", registers: BOTH, width: 14, expected: true,
    help: "The day the client unloaded. DD-MM-YYYY." },
  { key: "receivingQty", header: "Receiving Qty (kg)", aliases: ["receiving qty", "received qty", "receiving weight", "received weight", "r weight"], kind: "weight", registers: BOTH, width: 16, expected: true,
    help: "Weight the client accepted, in kg (MT allowed)." },
  { key: "ccWeight", header: "Client Weighbridge (kg)", aliases: ["cc weight", "client weight", "weighbridge weight"], kind: "weight", registers: BOTH, width: 16,
    help: "Optional. The client's own weighbridge figure." },
  { key: "invoiceDate", header: "Invoice Date", aliases: ["our invoice date", "billing date", "tax invoice date"], kind: "date", registers: BOTH, width: 14, expected: true,
    help: "Date of our TAX INVOICE for this supply (billing)." },
  { key: "invoiceWeightKg", header: "Invoice Weight (kg)", aliases: ["billed weight", "invoice qty", "invoice weight"], kind: "weight", registers: BOTH, width: 16, expected: true,
    help: "The weight we billed." },
  { key: "taxableAmount", header: "Taxable Amount", aliases: ["taxable", "taxable value", "basic amount"], kind: "amount", registers: BOTH, width: 16, expected: true,
    help: "Rupees, before GST." },
  { key: "taxAmount", header: "Tax Amount", aliases: ["tax", "gst", "gst amount"], kind: "amount", registers: BOTH, width: 14,
    help: "GST total." },
  { key: "totalAmount", header: "Invoice Total", aliases: ["total", "total amount", "invoice amount", "grand total"], kind: "amount", registers: BOTH, width: 16, expected: true,
    help: "Taxable + tax." },
  { key: "debitNoteNo", header: "Debit Note No", aliases: ["debit note"], kind: "text", registers: BOTH, width: 14, help: "If raised." },
  { key: "creditNoteNo", header: "Credit Note No", aliases: ["credit note"], kind: "text", registers: BOTH, width: 14, help: "If raised." },
  { key: "labReportNo", header: "Lab Report No", aliases: ["test report no", "lab report", "report no"], kind: "text", registers: BOTH, width: 16, expected: true,
    help: "The client's lab / test report number." },
  { key: "labReportDate", header: "Lab Report Date", aliases: ["test report date", "report date"], kind: "date", registers: BOTH, width: 14, help: "DD-MM-YYYY." },
  { key: "gcv", header: "GCV (kcal/kg)", aliases: ["gcv", "calorific value", "gross calorific value"], kind: "gcv", registers: BOTH, width: 13, expected: true,
    help: "Gross calorific value, e.g. 3850." },
  { key: "moisturePct", header: "Moisture %", aliases: ["moisture", "total moisture", "tm"], kind: "percent", registers: BOTH, width: 11, expected: true, help: "0–100." },
  { key: "ashPct", header: "Ash %", aliases: ["ash"], kind: "percent", registers: BOTH, width: 9, help: "0–100." },
  { key: "volatilePct", header: "Volatile Matter %", aliases: ["volatile", "vm", "volatile %"], kind: "percent", registers: BOTH, width: 14, help: "0–100." },
  { key: "finesPct", header: "Fines %", aliases: ["fines"], kind: "percent", registers: BOTH, width: 9, help: "0–100." },
  { key: "status", header: "Status", aliases: ["trip status"], kind: "status", registers: BOTH, width: 13,
    help: "Optional: Planned, Dispatched, Received, Accepted, Rejected, Cancelled. Blank = worked out from the weights." },
  { key: "cancellationReason", header: "Cancel / Reject Reason", aliases: ["cancellation reason", "rejection reason", "reason"], kind: "text", registers: BOTH, width: 22,
    help: "Required when Status is Rejected or Cancelled." },
  { key: "remarks", header: "Remarks", aliases: ["remark", "notes"], kind: "text", registers: BOTH, width: 26, help: "Anything else." },
];

const COL_BY_KEY = new Map(IMPORT_COLUMNS.map((c) => [c.key, c]));

/** The header shown to a person for a column key. */
export function headerOf(key: string): string {
  return COL_BY_KEY.get(key)?.header || key;
}

export function columnsFor(reg: BusinessType): ImportColumn[] {
  return IMPORT_COLUMNS.filter((c) => c.key !== "business" && c.registers.includes(reg));
}

/** Marker in Remarks that makes the parser skip the template's example row. */
export const EXAMPLE_MARK = "EXAMPLE";

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  // Exact headers first, so an alias can never steal a real header.
  for (const c of IMPORT_COLUMNS) m.set(norm(c.header), c.key);
  for (const c of IMPORT_COLUMNS) for (const a of c.aliases) if (!m.has(norm(a))) m.set(norm(a), c.key);
  return m;
})();

/* ------------------------------------------------------------------ */
/* Masters                                                             */
/* ------------------------------------------------------------------ */

export interface RegisteredVendor {
  code: string;
  name: string;
  /** trading or raw_material (manufacturing). */
  category: "trading" | "raw_material";
  blocked: boolean;
  onHold: boolean;
  keys: string[];
  source: "registration" | "vendor master";
}

/**
 * Every vendor registered in the app. Registration (partners) is the
 * source of truth; config/vendors.json is derived from it but also holds
 * the seeded trading supply list, so both are read. Registration wins
 * where they overlap.
 */
export function registeredVendors(): RegisteredVendor[] {
  const out: RegisteredVendor[] = [];
  const seen = new Set<string>();
  for (const p of loadPartners()) {
    if (p.kind !== "biomass_vendor") continue;
    const aliases: string[] = Array.isArray((p as any).aliases) ? (p as any).aliases : [];
    const v: RegisteredVendor = {
      code: String(p.code || "").toUpperCase(), name: p.name,
      category: p.category === "trading" ? "trading" : "raw_material",
      blocked: p.status === "blocked", onHold: p.status === "on_hold",
      keys: [p.name, p.legalName, ...aliases].map(norm).filter(Boolean),
      source: "registration",
    };
    out.push(v);
    if (v.code) seen.add(v.code);
    seen.add("n:" + norm(p.name));
  }
  const master = readJson<{ vendors: (Vendor & { aliases?: string[]; category?: string })[] }>(paths.vendorsFile, { vendors: [] });
  for (const m of Array.isArray(master.vendors) ? master.vendors : []) {
    const code = String(m.code || "").toUpperCase();
    if (!m.name || (code && seen.has(code)) || seen.has("n:" + norm(m.name))) continue;
    const manufacturing = m.category === "raw_material" || m.supplyType === "manufacturing";
    out.push({
      code, name: m.name,
      category: manufacturing ? "raw_material" : "trading",
      blocked: m.active === false, onHold: false,
      keys: [m.name, m.legalName || "", ...(m.aliases || [])].map(norm).filter(Boolean),
      source: "vendor master",
    });
  }
  return out;
}

function loadClients(): Client[] {
  const f = readJson<{ clients: Client[] }>(paths.clientsFile, { clients: [] });
  return Array.isArray(f.clients) ? f.clients : [];
}

/* ------------------------------------------------------------------ */
/* Cell readers                                                        */
/* ------------------------------------------------------------------ */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function isoOf(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 31-02 and friends
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A date cell → YYYY-MM-DD. Always DAY first: an Indian sheet's 05-04-2025
 * is the 5th of April, never May 4th. Excel serials (a real date cell) are
 * read through SheetJS's own calendar so there is no timezone drift.
 */
export function parseDateCell(v: unknown): { iso: string } | { error: string } | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return { error: `${v} is not a date` };
    const p = XLSX.SSF.parse_date_code(v);
    const iso = p ? isoOf(p.y, p.m, p.d) : null;
    return iso ? { iso } : { error: `${v} is not a date` };
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { error: "not a date" };
    const iso = isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return iso ? { iso } : { error: "not a date" };
  }
  const s = String(v).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, "");
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/);
  if (m) {
    const iso = isoOf(Number(m[3]), Number(m[2]), Number(m[1]));
    return iso ? { iso } : { error: `"${s}" is not a real date (use DD-MM-YYYY)` };
  }
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    const iso = isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { iso } : { error: `"${s}" is not a real date` };
  }
  m = s.match(/^(\d{1,2})[-\s\/.]*([A-Za-z]{3,9})[-\s\/.,]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    const iso = mon >= 0 ? isoOf(Number(m[3]), mon + 1, Number(m[1])) : null;
    return iso ? { iso } : { error: `"${s}" is not a real date` };
  }
  if (/^\d{5}$/.test(s)) return parseDateCell(Number(s));
  return { error: `"${s}" is not a date (use DD-MM-YYYY)` };
}

function parseNumberCell(v: unknown): number | null | "bad" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : "bad";
  const s = String(v).trim().replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[,\s₹%]/g, "").replace(/\/-$/, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "bad";
}

function parseDocType(v: string): "tax_invoice" | "delivery_challan" | "" | "bad" {
  const s = norm(v);
  if (!s) return "";
  if (["taxinvoice", "invoice", "ti", "inv", "bill"].includes(s)) return "tax_invoice";
  if (["deliverychallan", "challan", "dc", "deliverynote"].includes(s)) return "delivery_challan";
  return "bad";
}

function parseStatus(v: string): TripStatus | "" | "bad" {
  const s = norm(v);
  if (!s) return "";
  const hit = TRIP_STATUS.find((x) => norm(x.id) === s || norm(x.label) === s);
  return hit ? hit.id : "bad";
}

/* ------------------------------------------------------------------ */
/* Reading the workbook                                                */
/* ------------------------------------------------------------------ */

export interface RawRow {
  sheet: string;
  /** The row number as Excel shows it. */
  rowNumber: number;
  business: BusinessType | "bad";
  cells: Record<string, unknown>;
}

export interface ParsedFile {
  rows: RawRow[];
  sheetsRead: string[];
  ignoredColumns: string[];
  exampleRowsSkipped: number;
}

const SKIP_SHEETS = /^(instructions?|registered vendors|vendors|clients|plants|lists?|help|readme)$/i;

function businessOfSheet(name: string): BusinessType | null {
  if (/manuf|mfg|plant/i.test(name)) return "manufacturing";
  if (/trad/i.test(name)) return "trading";
  return null;
}

/**
 * Reads every data sheet. The header row is FOUND (the first row in the
 * top ten with three or more known headings), so a title or two above it
 * does no harm and their own old sheets with renamed columns still read.
 */
export function readWorkbook(buffer: Buffer, fileName: string, fallback: BusinessType): ParsedFile | { error: string } {
  let wb: XLSX.WorkBook;
  try {
    const csv = /\.csv$/i.test(fileName);
    // raw for CSV: SheetJS would otherwise read 05-04-2025 the American way.
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: csv });
  } catch (err) {
    return { error: `That file could not be read as a spreadsheet: ${(err as Error).message}` };
  }
  const rows: RawRow[] = [];
  const sheetsRead: string[] = [];
  const ignored = new Set<string>();
  let exampleRowsSkipped = 0;

  for (const name of wb.SheetNames) {
    if (SKIP_SHEETS.test(name.trim())) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    let headerAt = -1;
    for (let i = 0; i < Math.min(10, grid.length); i++) {
      const hits = (grid[i] || []).filter((h) => HEADER_INDEX.has(norm(h))).length;
      if (hits >= 3) { headerAt = i; break; }
    }
    if (headerAt < 0) continue;
    sheetsRead.push(name);
    const keys = (grid[headerAt] || []).map((h) => {
      const k = HEADER_INDEX.get(norm(h));
      if (!k && String(h ?? "").trim()) ignored.add(String(h).trim());
      return k || null;
    });
    const sheetBusiness = businessOfSheet(name) || fallback;

    for (let r = headerAt + 1; r < grid.length; r++) {
      const line = grid[r] || [];
      const cells: Record<string, unknown> = {};
      let any = false;
      keys.forEach((k, ci) => {
        if (!k) return;
        let v = line[ci];
        if (typeof v === "string") v = v.trim();
        if (v === "" || v === undefined) v = null;
        if (v !== null) any = true;
        if (cells[k] === undefined || cells[k] === null) cells[k] = v;
      });
      if (!any) continue;
      if (String(cells.remarks ?? "").trim().toUpperCase().startsWith(EXAMPLE_MARK)) { exampleRowsSkipped += 1; continue; }
      let business: BusinessType | "bad" = sheetBusiness;
      const b = norm(cells.business);
      if (b) business = /^manuf|^mfg/.test(b) ? "manufacturing" : /^trad/.test(b) ? "trading" : "bad";
      rows.push({ sheet: name, rowNumber: r + 1, business, cells });
    }
  }
  if (!sheetsRead.length) {
    return { error: "No sheet in that file has the template's column headings. Download the template, paste your data under its headings and upload it again." };
  }
  return { rows, sheetsRead, ignoredColumns: [...ignored], exampleRowsSkipped };
}

/* ------------------------------------------------------------------ */
/* Checking each consignment                                           */
/* ------------------------------------------------------------------ */

export type RowVerdict = "ok" | "missing" | "error";

export interface RowCheck {
  sheet: string;
  rowNumber: number;
  business: BusinessType;
  /** What a person reads to find the consignment: vehicle · date · doc no. */
  label: string;
  vendor: string;
  client: string;
  verdict: RowVerdict;
  /** Blocking — the row cannot be imported until the sheet is corrected. */
  errors: string[];
  /** Blank fields the row would be imported without. */
  missing: string[];
  /** Worth knowing, never blocking (client not in master, alias matched…). */
  warnings: string[];
  /** Imported rows older than the freeze are frozen straight away. */
  willFreeze: boolean;
  /** Present only when there are no errors. */
  body?: Record<string, any>;
}

export interface ImportContext {
  trips: Trip[];
  /** Numbers already on the books (issued or typed), lower-cased. */
  issuedNumbers: Set<string>;
  vendors: RegisteredVendor[];
  clients: Client[];
  plants: { code: string; label: string; keys: string[] }[];
  today: string;
}

export function loadImportContext(trips: Trip[]): ImportContext {
  const issued = new Set(loadSeriesFile().issued.map((i) => String(i.number || "").trim().toLowerCase()).filter(Boolean));
  return {
    trips,
    issuedNumbers: issued,
    vendors: registeredVendors(),
    clients: loadClients(),
    plants: loadPlants().filter((p) => p.active).map((p) => ({
      code: p.code, label: p.label,
      keys: [p.code, p.label, p.name || "", ...(p.aliases || [])].map(norm).filter(Boolean),
    })),
    today: new Date().toISOString().slice(0, 10),
  };
}

const text = (v: unknown, max = 120) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));
const plateOf = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
}

/** Check every row against the masters, the register and each other. Pure apart from the context. */
export function checkRows(rows: RawRow[], ctx: ImportContext): RowCheck[] {
  // Keys of what is already in the register.
  const existingDoc = new Map<string, Trip>();
  const existingRef = new Map<string, Trip>();
  const existingTrip = new Map<string, Trip>();
  const existingChallan = new Map<string, Trip>();
  for (const t of ctx.trips) {
    if (t.ourDocNo) existingDoc.set(t.ourDocNo.trim().toLowerCase(), t);
    if (t.referenceNo) existingRef.set(t.referenceNo.trim().toUpperCase(), t);
    const party = t.business === "manufacturing" ? String(t.plant || "").toUpperCase() : norm(t.supplier);
    if (t.vehicleNumber && t.vehicleEntryDate) existingTrip.set(`${t.business}|${plateOf(t.vehicleNumber)}|${t.vehicleEntryDate}|${party}`, t);
    if (t.vendorChallanNo && t.supplier) existingChallan.set(`${norm(t.supplier)}|${t.vendorChallanNo.toLowerCase()}`, t);
  }
  // And of what came earlier in this file.
  const seenDoc = new Map<string, number>();
  const seenRef = new Map<string, number>();
  const seenTrip = new Map<string, number>();
  const seenChallan = new Map<string, number>();
  const knownClients = new Set(ctx.trips.map((t) => t.client.trim().toLowerCase()).filter(Boolean));
  const latest = addDays(ctx.today, 1);

  return rows.map((row) => {
    const c = row.cells;
    const errors: string[] = [];
    const missing: string[] = [];
    const warnings: string[] = [];
    const reg: BusinessType = row.business === "bad" ? "trading" : row.business;
    if (row.business === "bad") errors.push(`Business "${text(c.business)}" is not Trading or Manufacturing.`);
    const isTrading = reg === "trading";

    const blank = (k: string) => c[k] === null || c[k] === undefined || String(c[k]).trim() === "";
    const miss = (k: string) => { if (blank(k)) missing.push(headerOf(k)); };

    // ---- dates
    const dates: Record<string, string> = {};
    for (const k of ["ourDocDate", "poDate", "vendorChallanDate", "vehicleEntryDate", "receivingDate", "invoiceDate", "labReportDate"]) {
      const d = parseDateCell(c[k]);
      if (!d) continue;
      if ("error" in d) { errors.push(`${headerOf(k)}: ${d.error}.`); continue; }
      if (d.iso > latest) { errors.push(`${headerOf(k)} ${d.iso} is in the future.`); continue; }
      dates[k] = d.iso;
    }

    // ---- weights (kg; MT / qtl / bare tonnes converted the same way as the form)
    const weights: Record<string, number> = {};
    for (const k of ["vendorChallanWeight", "receivingQty", "ccWeight", "invoiceWeightKg"]) {
      if (blank(k)) continue;
      const kg = toKg(c[k], { vehicle: true });
      if (kg === null || !Number.isFinite(kg)) { errors.push(`${headerOf(k)}: "${text(c[k])}" is not a weight.`); continue; }
      if (kg < 0) { errors.push(`${headerOf(k)} cannot be negative.`); continue; }
      if (kg > 200000) { errors.push(`${headerOf(k)} ${kg.toLocaleString("en-IN")} kg is more than any truck carries — check the unit.`); continue; }
      weights[k] = kg;
    }

    // ---- money and lab figures
    const nums: Record<string, number> = {};
    for (const k of ["vendorChallanAmount", "taxableAmount", "taxAmount", "totalAmount", "gcv", "moisturePct", "ashPct", "volatilePct", "finesPct"]) {
      const n = parseNumberCell(c[k]);
      if (n === null) continue;
      if (n === "bad") { errors.push(`${headerOf(k)}: "${text(c[k])}" is not a number.`); continue; }
      if (n < 0) { errors.push(`${headerOf(k)} cannot be negative.`); continue; }
      const kind = COL_BY_KEY.get(k)?.kind;
      if (kind === "percent" && n > 100) { errors.push(`${headerOf(k)} ${n} is over 100%.`); continue; }
      if (kind === "gcv" && n > 10000) { errors.push(`${headerOf(k)} ${n} is not a GCV in kcal/kg.`); continue; }
      nums[k] = n;
    }

    // ---- choices
    const docType = parseDocType(text(c.docType));
    if (docType === "bad") errors.push(`Our Doc Type "${text(c.docType)}" — use Tax Invoice or Delivery Challan.`);
    let vendorDocType = isTrading ? parseDocType(text(c.vendorDocType)) : "";
    if (vendorDocType === "bad") { errors.push(`Vendor Doc Type "${text(c.vendorDocType)}" — use Tax Invoice or Delivery Challan.`); vendorDocType = ""; }
    const status = parseStatus(text(c.status));
    if (status === "bad") errors.push(`Status "${text(c.status)}" — use ${TRIP_STATUS.map((s) => s.label).join(", ")}.`);
    if ((status === "cancelled" || status === "rejected") && blank("cancellationReason")) {
      errors.push(`Status is ${status === "rejected" ? "Rejected" : "Cancelled"} but no Cancel / Reject Reason is given.`);
    }

    // ---- client: required (a trip with no client is refused by the form too)
    let client = text(c.client);
    if (!client) errors.push("Client is missing — every trip needs a client.");
    else {
      const k = norm(client);
      const hit = ctx.clients.find((cl) => [cl.name, cl.shortName, ...(cl.aliases || [])].some((x) => norm(x) === k && k));
      if (hit) {
        if (hit.name !== client) warnings.push(`Client "${client}" read as "${hit.name}" (client master).`);
        client = hit.name;
      } else if (knownClients.has(client.toLowerCase())) {
        warnings.push(`Client "${client}" is not in the client master, but older trips use the same name.`);
      } else {
        warnings.push(`Client "${client}" is not in the client master — it will be saved as typed. Add it under Clients so its POs and number book apply.`);
      }
    }

    // ---- vendor (trading) / plant (manufacturing)
    let supplier = "", supplierCode = "", plant = "";
    if (isTrading) {
      const name = text(c.vendorName), code = text(c.vendorCode, 20).toUpperCase();
      if (!name && !code) {
        errors.push("Vendor Name is missing — imported trading data must be linked to a vendor registered in the app.");
      } else {
        const byCode = code ? ctx.vendors.find((v) => v.code && v.code === code) : undefined;
        const byName = name ? ctx.vendors.find((v) => v.keys.includes(norm(name))) : undefined;
        let v: RegisteredVendor | undefined;
        if (name && code) {
          if (byName && byCode && byName === byCode) v = byName;
          else if (byName && byCode) errors.push(`Vendor Code ${code} belongs to "${byCode.name}", not "${name}".`);
          else if (byName) errors.push(`Vendor Code ${code} is not the code of "${byName.name}"${byName.code ? ` (registered code ${byName.code})` : ""}.`);
          else if (byCode) errors.push(`Vendor "${name}" does not match the vendor registered under code ${code} ("${byCode.name}").`);
          else errors.push(`Vendor "${name}" (${code}) is not registered in the app. Register it first (Registration → Vendors) or correct the name.`);
        } else if (name) {
          if (byName) v = byName;
          else errors.push(`Vendor "${name}" is not registered in the app. Register it first (Registration → Vendors) or correct the name.`);
        } else {
          if (byCode) v = byCode;
          else errors.push(`Vendor Code ${code} is not registered in the app.`);
        }
        if (v) {
          if (v.category !== "trading") errors.push(`"${v.name}" is registered as a Manufacturing (plant) vendor, not a Trading vendor.`);
          else if (v.blocked) errors.push(`"${v.name}" is blocked in Registration — unblock it before importing its trips.`);
          else {
            if (v.onHold) warnings.push(`"${v.name}" is on hold in Registration.`);
            if (name && v.name !== name) warnings.push(`Vendor "${name}" read as registered vendor "${v.name}"${v.code ? ` (${v.code})` : ""}.`);
            supplier = v.name;
            supplierCode = v.code;
          }
        }
      }
    } else {
      const p = text(c.plant, 20);
      if (!p) errors.push("Plant Code is missing — a manufacturing trip must say which plant the truck left from.");
      else {
        const hit = ctx.plants.find((x) => x.keys.includes(norm(p)));
        if (!hit) errors.push(`Plant "${p}" is not a plant in the app. Use one of: ${ctx.plants.map((x) => `${x.code} (${x.label})`).join(", ")}.`);
        else plant = hit.code;
      }
    }

    // ---- identity of the consignment
    const vehicle = plateOf(c.vehicleNumber).slice(0, 20);
    const ourDocNo = text(c.ourDocNo, 60);
    const vendorChallanNo = isTrading ? text(c.vendorChallanNo, 40) : "";
    const vendorInvoiceNo = isTrading ? text(c.vendorInvoiceNo, 40) : "";
    if (!vehicle && !ourDocNo && !vendorChallanNo && !vendorInvoiceNo) {
      errors.push("Nothing identifies this consignment — give at least the Vehicle No or a document number.");
    }

    // The month a trip belongs to comes from the vehicle's date; fall back
    // to the papers rather than letting it default to today.
    let entryDate = dates.vehicleEntryDate || "";
    // (A Dispatch Date that is there but unreadable is already an error.)
    if (!entryDate && blank("vehicleEntryDate")) {
      entryDate = dates.vendorChallanDate || dates.ourDocDate || dates.invoiceDate || dates.receivingDate || "";
      if (entryDate) warnings.push(`Dispatch Date is blank — taken as ${entryDate} from the papers.`);
      else errors.push("No date at all — give the Dispatch Date (DD-MM-YYYY).");
    }

    // ---- what is missing (imported anyway if the person chooses)
    miss("ourDocNo"); miss("ourDocDate");
    miss("location"); miss("poNumber");
    if (isTrading) {
      if (!vendorChallanNo && !vendorInvoiceNo) missing.push("Vendor Challan No / Vendor Invoice No");
      miss("vendorChallanDate");
    }
    miss("vehicleNumber");
    miss("vendorChallanWeight");
    miss("receivingDate"); miss("receivingQty");
    const billingCols = ["invoiceDate", "invoiceWeightKg", "taxableAmount", "totalAmount"];
    if (billingCols.every(blank) && blank("taxAmount")) missing.push("Tax invoice / billing figures (Invoice Date, Weight, Taxable, Total)");
    else billingCols.forEach(miss);
    const labCols = ["labReportNo", "gcv", "moisturePct"];
    const anyLab = ["labReportNo", "labReportDate", "gcv", "moisturePct", "ashPct", "volatilePct", "finesPct"].some((k) => !blank(k));
    if (!anyLab) missing.push("Lab report (Report No, GCV, Moisture %)");
    else labCols.forEach(miss);

    // Sense checks — warnings, because history is history.
    if (nums.taxableAmount && nums.taxAmount && nums.totalAmount && Math.abs(nums.taxableAmount + nums.taxAmount - nums.totalAmount) > 2) {
      warnings.push(`Taxable + Tax (${(nums.taxableAmount + nums.taxAmount).toLocaleString("en-IN")}) does not equal the Invoice Total (${nums.totalAmount.toLocaleString("en-IN")}).`);
    }
    if (dates.receivingDate && entryDate && dates.receivingDate < entryDate) warnings.push("Receiving Date is before the Dispatch Date.");

    // ---- duplicates: against the register, then within the file
    const refNo = text(c.referenceNo, 40).toUpperCase().replace(/\s+/g, "");
    if (refNo && !parseRef(refNo)) warnings.push(`Reference No "${refNo}" is not in the COMPANY/OUR NO/CODE/VENDOR NO shape — WhatsApp papers may not link to it.`);
    const party = isTrading ? norm(supplier) : plant;
    const tripKey = vehicle && entryDate && party ? `${reg}|${vehicle}|${entryDate}|${party}` : "";
    const challanKey = isTrading && vendorChallanNo && supplier ? `${norm(supplier)}|${vendorChallanNo.toLowerCase()}` : "";
    const docKey = ourDocNo.toLowerCase();

    if (docKey) {
      const t = existingDoc.get(docKey);
      if (t) errors.push(`Our Doc No ${ourDocNo} is already in the register as ${t.business} trip #${t.serial}.`);
      else if (ctx.issuedNumbers.has(docKey)) errors.push(`Our Doc No ${ourDocNo} is already on the books (number register).`);
      else if (seenDoc.has(docKey)) errors.push(`Our Doc No ${ourDocNo} repeats row ${seenDoc.get(docKey)} of this file.`);
    }
    if (refNo) {
      const t = existingRef.get(refNo);
      if (t) errors.push(`Reference No ${refNo} is already on trip #${t.serial}.`);
      else if (seenRef.has(refNo)) errors.push(`Reference No ${refNo} repeats row ${seenRef.get(refNo)} of this file.`);
    }
    if (tripKey) {
      const t = existingTrip.get(tripKey);
      if (t) errors.push(`Already in the register: trip #${t.serial} has the same vehicle ${vehicle}, date ${entryDate} and ${isTrading ? "vendor" : "plant"}.`);
      else if (seenTrip.has(tripKey)) errors.push(`Same vehicle, date and ${isTrading ? "vendor" : "plant"} as row ${seenTrip.get(tripKey)} of this file.`);
    }
    if (challanKey) {
      const t = existingChallan.get(challanKey);
      if (t) errors.push(`Challan ${vendorChallanNo} from ${supplier} is already entered as trip #${t.serial}.`);
      else if (seenChallan.has(challanKey)) errors.push(`Challan ${vendorChallanNo} from ${supplier} repeats row ${seenChallan.get(challanKey)} of this file.`);
    }
    // Only a row that will actually be imported claims its keys, so a bad
    // row never makes a later good one look like a duplicate.
    if (!errors.length) {
      const here = row.rowNumber;
      if (docKey) seenDoc.set(docKey, here);
      if (refNo) seenRef.set(refNo, here);
      if (tripKey) seenTrip.set(tripKey, here);
      if (challanKey) seenChallan.set(challanKey, here);
    }

    const label = [vehicle || "no vehicle", entryDate || "no date", ourDocNo || vendorChallanNo || vendorInvoiceNo].filter(Boolean).join(" · ");
    const check: RowCheck = {
      sheet: row.sheet, rowNumber: row.rowNumber, business: reg, label,
      vendor: isTrading ? supplier || text(c.vendorName) || text(c.vendorCode) : plant || text(c.plant),
      client,
      verdict: errors.length ? "error" : missing.length ? "missing" : "ok",
      errors, missing, warnings,
      willFreeze: false,
    };
    if (errors.length) return check;

    const tripStatus: TripStatus = status && status !== "bad" ? status
      : weights.receivingQty ? "received"
      : vehicle && (vendorChallanNo || vendorInvoiceNo || ourDocNo) ? "dispatched"
      : "planned";

    check.body = {
      business: reg,
      docType: docType === "tax_invoice" ? "tax_invoice" : "delivery_challan",
      ourDocNo,
      ourDocDate: dates.ourDocDate || "",
      referenceNo: refNo,
      client,
      location: text(c.location, 60),
      poNumber: text(c.poNumber, 60), poDate: dates.poDate || "",
      supplier, supplierCode,
      vendorDocType: vendorDocType || (isTrading ? (vendorChallanNo ? "delivery_challan" : vendorInvoiceNo ? "tax_invoice" : "") : ""),
      vendorChallanNo, vendorInvoiceNo,
      vendorChallanDate: dates.vendorChallanDate || "",
      plant,
      vehicleNumber: vehicle,
      vehicleEntryDate: entryDate,
      // Passed with their unit so the shared reader converts nothing twice.
      vendorChallanWeight: weights.vendorChallanWeight ? `${weights.vendorChallanWeight} kg` : "",
      vendorChallanAmount: nums.vendorChallanAmount ?? "",
      receivingDate: dates.receivingDate || "",
      receivingQty: weights.receivingQty ? `${weights.receivingQty} kg` : "",
      ccWeight: weights.ccWeight ? `${weights.ccWeight} kg` : "",
      debitNoteNo: text(c.debitNoteNo, 40), creditNoteNo: text(c.creditNoteNo, 40),
      status: tripStatus,
      cancellationReason: text(c.cancellationReason, 300),
      remarks: text(c.remarks, 400),
      billing: {
        invoiceDate: dates.invoiceDate || "",
        invoiceWeightKg: weights.invoiceWeightKg || 0,
        taxableAmount: nums.taxableAmount || 0,
        taxAmount: nums.taxAmount || 0,
        totalAmount: nums.totalAmount || (nums.taxableAmount || 0) + (nums.taxAmount || 0),
      },
      lab: anyLab ? {
        reportNo: text(c.labReportNo, 40), reportDate: dates.labReportDate || "",
        gcv: nums.gcv || 0, moisturePct: nums.moisturePct || 0, ashPct: nums.ashPct || 0,
        volatilePct: nums.volatilePct || 0, finesPct: nums.finesPct || 0,
      } as TripLab : undefined,
    };
    check.willFreeze = lockStateFor({ receivingDate: dates.receivingDate || "", status: tripStatus }).locked;
    return check;
  });
}

export interface ImportSummary {
  rows: number;
  ok: number;
  missing: number;
  error: number;
  willFreeze: number;
}

export function summariseChecks(checks: RowCheck[]): ImportSummary {
  return {
    rows: checks.length,
    ok: checks.filter((c) => c.verdict === "ok").length,
    missing: checks.filter((c) => c.verdict === "missing").length,
    error: checks.filter((c) => c.verdict === "error").length,
    willFreeze: checks.filter((c) => c.verdict !== "error" && c.willFreeze).length,
  };
}

/* ------------------------------------------------------------------ */
/* Building the trips                                                  */
/* ------------------------------------------------------------------ */

/**
 * Turn checked rows into trips. Serials continue each register's own
 * count, in the file's order. Document numbers are registered as manual
 * numbers in ONE write to the number book, so the clash check sees them
 * and no series counter moves.
 */
export function buildTrips(
  checks: RowCheck[],
  existing: Trip[],
  user: { id: string; name: string },
  file: string
): Trip[] {
  const now = new Date().toISOString();
  const nextSerial: Record<BusinessType, number> = {
    trading: existing.filter((t) => t.business === "trading").reduce((m, t) => Math.max(m, t.serial), 0),
    manufacturing: existing.filter((t) => t.business === "manufacturing").reduce((m, t) => Math.max(m, t.serial), 0),
  };
  const out: Trip[] = [];
  for (const c of checks) {
    if (!c.body) continue;
    const reg = c.business;
    nextSerial[reg] += 1;
    const b = c.body;
    const trip: Trip = { ...blankTrip(nextSerial[reg], user, reg), ...readTripInput(b, reg) };
    if (b.ourDocNo) {
      trip.ourDocNo = b.ourDocNo;
      trip.biomeChallanNo = b.ourDocNo;
      trip.ourDocManual = true;
    }
    trip.billing = {
      ...trip.billing,
      ...b.billing,
      source: b.billing.totalAmount || b.billing.taxableAmount || b.billing.invoiceDate ? "data-import" : "",
      importedAt: b.billing.totalAmount || b.billing.taxableAmount || b.billing.invoiceDate ? now : "",
      importedBy: b.billing.totalAmount || b.billing.taxableAmount || b.billing.invoiceDate ? user.name : "",
    };
    if (b.lab) trip.lab = b.lab;
    trip.importSource = { kind: "data-import", file: file.slice(0, 120), sheet: c.sheet, row: c.rowNumber, at: now, by: user.id, byName: user.name };
    trip.createdAt = now;
    trip.updatedAt = now;
    out.push(trip);
  }
  return out;
}

export function registerImportedNumbers(trips: Trip[], user: { id: string; name: string }): void {
  const withNo = trips.filter((t) => t.ourDocNo);
  if (!withNo.length) return;
  const f = loadSeriesFile();
  const now = new Date().toISOString();
  const fresh = withNo.map((t) => ({
    number: t.ourDocNo.trim(), seriesId: "manual", seq: 0,
    tripId: t.id, at: now, by: user.id, byName: user.name,
  }));
  f.issued = [...fresh, ...f.issued].slice(0, Math.max(5000, fresh.length + 1000));
  saveSeriesFile(f);
}

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

const EXAMPLES: Record<BusinessType, Record<string, string | number>> = {
  trading: {
    docType: "Delivery Challan", ourDocNo: "BDC/24-25/0145", ourDocDate: "05-04-2025", client: "NTPC Mouda", location: "Mouda",
    poNumber: "4500123456", poDate: "01-03-2025", vendorName: "(a registered vendor)", vendorCode: "", vendorDocType: "Delivery Challan",
    vendorChallanNo: "215", vendorChallanDate: "05-04-2025", vendorInvoiceNo: "", vehicleNumber: "MH40AB1234", vehicleEntryDate: "05-04-2025",
    vendorChallanWeight: "28.4 MT", vendorChallanAmount: 156200, receivingDate: "07-04-2025", receivingQty: 28150, ccWeight: "",
    invoiceDate: "08-04-2025", invoiceWeightKg: 28150, taxableAmount: 160455, taxAmount: 8023, totalAmount: 168478,
    labReportNo: "CCL/2025/118", labReportDate: "10-04-2025", gcv: 3850, moisturePct: 9.2, ashPct: 6.1, volatilePct: "", finesPct: 2.5,
    status: "", cancellationReason: "", remarks: `${EXAMPLE_MARK} — delete this row before importing (rows starting EXAMPLE are skipped).`,
  },
  manufacturing: {
    docType: "Tax Invoice", ourDocNo: "BI/24-25/0398", ourDocDate: "12-04-2025", client: "Jhajjar Power Limited", location: "Jhajjar",
    poNumber: "JPL/PO/7781", poDate: "15-02-2025", plant: "REW", vehicleNumber: "HR55K4321", vehicleEntryDate: "12-04-2025",
    vendorChallanWeight: 29600, vendorChallanAmount: "", receivingDate: "13-04-2025", receivingQty: 29480, ccWeight: 29470,
    invoiceDate: "12-04-2025", invoiceWeightKg: 29480, taxableAmount: 171184, taxAmount: 8559, totalAmount: 179743,
    labReportNo: "JPL/LAB/552", labReportDate: "15-04-2025", gcv: 3920, moisturePct: 8.4, ashPct: "", volatilePct: "", finesPct: "",
    status: "", cancellationReason: "", remarks: `${EXAMPLE_MARK} — delete this row before importing (rows starting EXAMPLE are skipped).`,
  },
};

/**
 * The app's own Excel template: one sheet per register, an Instructions
 * sheet, and the masters the rows must match (registered trading vendors,
 * plants, clients) — with drop-down lists pointing at them.
 */
export async function buildTemplate(ExcelJS: any): Promise<Buffer> {
  const INK = "FF0B1F27", LEAF = "FF1F7A4C", AMBER = "FFFFF4D6";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria";
  wb.created = new Date();

  const vendors = registeredVendors().filter((v) => v.category === "trading" && !v.blocked).sort((a, b) => a.name.localeCompare(b.name));
  const plants = loadPlants().filter((p) => p.active);
  const clients = loadClients();

  const statusLabels = TRIP_STATUS.filter((s) => s.id !== "shortage").map((s) => s.label);

  /* ---- the two data sheets ---- */
  const LAST = 2000;
  for (const reg of ["trading", "manufacturing"] as BusinessType[]) {
    const ws = wb.addWorksheet(reg === "trading" ? "Trading" : "Manufacturing", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 0 }],
      properties: { tabColor: { argb: reg === "trading" ? "FF2563EB" : "FF7C3AED" } },
    });
    const cols = columnsFor(reg);
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || 14 }));
    const head = ws.getRow(1);
    head.height = 30;
    head.eachCell((cell: any, n: number) => {
      const col = cols[n - 1];
      const required = /^REQUIRED/.test(col.help);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: required ? "FFB3261E" : col.kind === "date" ? LEAF : INK } };
      cell.alignment = { wrapText: true, vertical: "middle" };
      cell.note = col.help;
    });
    const ex = ws.addRow(cols.map((c) => EXAMPLES[reg][c.key] ?? ""));
    ex.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
      cell.font = { italic: true, color: { argb: "FF6B5B00" } };
    });

    cols.forEach((c, i) => {
      const letter = ws.getColumn(i + 1).letter;
      const range = `${letter}2:${letter}${LAST}`;
      // Dates kept as TEXT so 05-04-2025 stays day-first whatever the PC's locale.
      if (c.kind === "date") ws.getColumn(i + 1).numFmt = "@";
      if (c.kind === "doctype") {
        ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`Lists!$A$2:$A$3`],
          showErrorMessage: true, errorTitle: "Doc type", error: "Choose Tax Invoice or Delivery Challan." });
      }
      if (c.kind === "status") {
        ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`Lists!$B$2:$B$${statusLabels.length + 1}`],
          showErrorMessage: true, errorTitle: "Status", error: "Choose a status from the list." });
      }
      if (c.key === "plant" && plants.length) {
        ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`Plants!$A$2:$A$${plants.length + 1}`],
          showErrorMessage: true, errorTitle: "Plant", error: "Use a plant code from the Plants sheet." });
      }
      if (c.key === "vendorName" && vendors.length) {
        // Warning style: the list helps, the app does the real check.
        ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`'Registered Vendors'!$A$2:$A$${vendors.length + 1}`],
          showErrorMessage: true, errorStyle: "warning", errorTitle: "Vendor", error: "This vendor is not in the registered list — the row will be refused on import." });
      }
      if (c.key === "client" && clients.length) {
        ws.dataValidations.add(range, { type: "list", allowBlank: true, formulae: [`Clients!$A$2:$A$${clients.length + 1}`],
          showErrorMessage: true, errorStyle: "information", errorTitle: "Client", error: "Not in the client master — it will be imported as typed." });
      }
      if (c.kind === "date") {
        ws.getCell(`${letter}1`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: /^REQUIRED/.test(c.help) ? "FFB3261E" : LEAF } };
      }
    });
  }
  /* ---- Instructions ---- */
  const ins = wb.addWorksheet("Instructions", { properties: { tabColor: { argb: LEAF } } });
  ins.columns = [{ width: 26 }, { width: 14 }, { width: 100 }];
  ins.addRow(["Biome — Coordination data import template"]).font = { bold: true, size: 14, color: { argb: INK } };
  ins.addRow([]);
  const steps = [
    "1. Fill the 'Trading' sheet for bought-and-sold supplies (vendor → client) and the 'Manufacturing' sheet for our own plant's material (plant → client). Leave a sheet empty if you have nothing for it.",
    "2. One row = one consignment (one vehicle). Keep the heading row as it is; the column order can change.",
    "3. Dates: DD-MM-YYYY (e.g. 05-04-2025). Weights: kg (e.g. 28400). '28.4 MT' or a bare 28.4 is read as tonnes and converted to kg.",
    "4. Trading rows: the Vendor Name MUST be a vendor registered in the app (see 'Registered Vendors'). An unregistered vendor stops that row — register the vendor first, then import.",
    "5. Manufacturing rows: Plant Code is required (see 'Plants').",
    "6. Client is required on every row. A client not in the client master is imported as typed, with a warning.",
    "7. Upload in Coordination → Import data. The app first shows, per consignment, what is MISSING (blank fields) and what is WRONG (errors). Nothing is saved until you choose:",
    "     • Import all valid rows (with missing data)  • Import only complete rows  • Cancel — correct the sheet and upload again.",
    "8. Rows with errors are never imported. Duplicates (same Our Doc No, same vendor challan, or same vehicle + date + vendor/plant as a trip already in the register or earlier in the file) are errors.",
    "9. Our Doc No is kept exactly as written (as a manual number); no number is taken from the live number series. A trip whose Receiving Date is more than 7 days old is frozen on import like any other — later corrections need an admin's approval.",
    "10. The yellow example row on each sheet is skipped automatically (its Remarks start with EXAMPLE); you can delete it.",
  ];
  for (const s of steps) {
    const r = ins.addRow([s]);
    ins.mergeCells(`A${r.number}:C${r.number}`);
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    r.height = s.length > 140 ? 32 : 18;
  }
  ins.addRow([]);
  const hdr = ins.addRow(["Column", "Sheet", "What to enter"]);
  hdr.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  });
  for (const col of IMPORT_COLUMNS) {
    if (col.key === "business") continue;
    const where = col.registers.length === 2 ? "Both" : col.registers[0] === "trading" ? "Trading" : "Manufacturing";
    const r = ins.addRow([col.header, where, col.help]);
    r.getCell(3).alignment = { wrapText: true };
    if (/^REQUIRED/.test(col.help)) r.getCell(1).font = { bold: true, color: { argb: "FFB3261E" } };
  }

  /* ---- master lists ---- */
  const vs = wb.addWorksheet("Registered Vendors");
  vs.columns = [{ header: "Vendor Name", width: 36 }, { header: "Vendor Code", width: 14 }, { header: "Source", width: 18 }];
  vendors.forEach((v) => vs.addRow([v.name, v.code, v.source]));
  const ps = wb.addWorksheet("Plants");
  ps.columns = [{ header: "Plant Code", width: 12 }, { header: "Plant", width: 24 }];
  plants.forEach((p) => ps.addRow([p.code, p.label]));
  const cs = wb.addWorksheet("Clients");
  cs.columns = [{ header: "Client", width: 36 }, { header: "Short Name", width: 16 }];
  clients.forEach((c) => cs.addRow([c.name, c.shortName || ""]));
  const ls = wb.addWorksheet("Lists");
  ls.columns = [{ header: "Doc Type", width: 18 }, { header: "Status", width: 14 }];
  ["Tax Invoice", "Delivery Challan"].forEach((d, i) => { ls.getCell(i + 2, 1).value = d; });
  statusLabels.forEach((s, i) => { ls.getCell(i + 2, 2).value = s; });
  for (const s of [vs, ps, cs, ls]) {
    s.getRow(1).font = { bold: true };
    s.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** A stable id for a check-and-commit pair: the same bytes give the same id. */
export function fileFingerprint(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}
