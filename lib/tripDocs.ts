/**
 * Coordination ↔ WhatsApp documents (server only)
 * -------------------------------------------------------------------
 * Every supply carries one coordination reference, printed on our
 * invoice and quoted on the rest of the paperwork:
 *
 *        BDC  /  45  /  JSR  /  15
 *         |      |      |      +-- vendor's invoice / challan no
 *         |      |      +--------- vendor code (plant code for manufacturing)
 *         |      +---------------- our invoice / challan no
 *         +----------------------- our company code
 *
 * The coordinator saves a trip with that reference (typed, or composed
 * from the trip's own fields). Every document the WhatsApp agent has read
 * — filed OR still waiting in staging — whose reference, document numbers
 * or vehicle point at the same supply is linked to the trip, category by
 * category. It does not matter which came first: a document scanned last
 * week links the moment the trip is saved, and one that arrives next week
 * links the moment it is read.
 *
 * Each linked document is then compared with what the coordinator typed
 * (vehicle, document numbers, weights, amount, date, client). Differences
 * are returned as notices, never silently "corrected" — the register is
 * for finding disagreements, not hiding them.
 *
 * Reads the agent's ledgers straight from disk, so it works even when the
 * WhatsApp agent is not running.
 */

import fs from "fs";
import path from "path";
import { paths, readJson } from "@/lib/dataRoot";
import type { Trip } from "@/lib/coordination";
import { loadPlants } from "@/lib/plants";

/* ------------------------------------------------------------------ */
/* Reference                                                           */
/* ------------------------------------------------------------------ */

export interface TripReference {
  canonical: string;
  company: string;
  ourNo: string;
  vendorCode: string;
  vendorNo: string;
  /** "typed" when the coordinator entered it, "composed" when built from the trip. */
  source: "typed" | "composed" | "incomplete";
  missing: string[];
}

const up = (v: unknown) => String(v ?? "").toUpperCase().trim();
/** Trailing number without leading zeros: "BI26-27-HR0786" → "786", "15" → "15". */
export function docTail(v: unknown): string {
  const m = up(v).match(/(\d+)\s*$/);
  return m ? String(Number(m[1])) : up(v).replace(/[^A-Z0-9]/g, "");
}
export const plate = (v: unknown) => up(v).replace(/[^A-Z0-9]/g, "");

export function companyCodes(): string[] {
  const s = readJson<{ companyCodes?: string[] }>(paths.settingsFile, {});
  return Array.isArray(s.companyCodes) && s.companyCodes.length ? s.companyCodes.map(up) : ["BDC"];
}

function plantOfTrip(t: Trip): string {
  const chosen = up((t as any).plant);
  if (chosen && loadPlants().some((p) => up(p.code) === chosen)) return chosen;
  const loc = up(t.location);
  for (const p of loadPlants()) if (loc.includes(p.code) || (p.label && loc.includes(up(p.label)))) return p.code;
  return "";
}

export function parseRef(raw: string): { company: string; ourNo: string; vendorCode: string; vendorNo: string } | null {
  const parts = up(raw).split(/[\/\\|]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length !== 4) return null;
  return { company: parts[0], ourNo: docTail(parts[1]), vendorCode: parts[2].replace(/[^A-Z0-9]/g, ""), vendorNo: docTail(parts[3]) };
}

export function tripReference(t: Trip): TripReference {
  const typed = parseRef(t.referenceNo || "");
  if (typed) {
    return { canonical: `${typed.company}/${typed.ourNo}/${typed.vendorCode}/${typed.vendorNo}`, ...typed, source: "typed", missing: [] };
  }
  const company = companyCodes()[0];
  const ourNo = t.ourDocNo ? docTail(t.ourDocNo) : "";
  const mfg = t.business === "manufacturing";
  const vendorCode = mfg ? plantOfTrip(t) : up(t.supplierCode).replace(/[^A-Z0-9]/g, "");
  const vendorNo = mfg ? ourNo : docTail(t.vendorInvoiceNo || t.vendorChallanNo || "");
  const missing: string[] = [];
  if (!ourNo) missing.push("our invoice / challan no");
  if (!vendorCode) missing.push(mfg ? "plant (From plant)" : "vendor code");
  if (!vendorNo) missing.push(mfg ? "our invoice no" : "vendor invoice / challan no");
  const canonical = `${company}/${ourNo || "?"}/${vendorCode || "?"}/${vendorNo || "?"}`;
  return { canonical, company, ourNo, vendorCode, vendorNo, source: missing.length ? "incomplete" : "composed", missing };
}

/* ------------------------------------------------------------------ */
/* Documents the agent has read                                         */
/* ------------------------------------------------------------------ */

export const DOC_LABEL: Record<string, string> = {
  biome_tax_invoice: "Biome Tax Invoice",
  biome_delivery_challan: "Biome Delivery Challan",
  biome_eway_bill: "Biome E-way Bill",
  vendor_tax_invoice: "Vendor Tax Invoice",
  vendor_delivery_challan: "Vendor Delivery Challan",
  vendor_eway_bill: "Vendor E-way Bill",
  bilty_lr: "Bilty / LR",
  weight_slip: "Weight Slip",
  fast_tag: "Fast Tag",
  consignment_tag: "Consignment Tag",
  coa: "COA",
  receiving: "Receiving (client)",
  lab_report: "Lab Report",
  biome_debit_note: "Biome Debit Note",
  vendor_debit_note: "Vendor Debit Note",
  biome_credit_note: "Biome Credit Note",
  vendor_credit_note: "Vendor Credit Note",
  other: "Other",
};

export const CATEGORY_OF: Record<string, string> = {
  biome_tax_invoice: "Our documents", biome_delivery_challan: "Our documents", biome_eway_bill: "Our documents",
  biome_debit_note: "Our documents", biome_credit_note: "Our documents",
  vendor_tax_invoice: "Vendor documents", vendor_delivery_challan: "Vendor documents", vendor_eway_bill: "Vendor documents",
  vendor_debit_note: "Vendor documents", vendor_credit_note: "Vendor documents",
  bilty_lr: "Transport & weighment", weight_slip: "Transport & weighment", fast_tag: "Transport & weighment", consignment_tag: "Transport & weighment",
  receiving: "Client side", coa: "Client side", lab_report: "Client side",
  other: "Other",
};

export interface AgentDoc {
  id: string;
  source: "filed" | "staged";
  type: string;
  label: string;
  category: string;
  fileName: string;
  filePath: string;
  receivedAt: string;
  reference: string;
  extracted: Record<string, any>;
}

function readJsonl(file: string): any[] {
  try {
    if (!fs.existsSync(file)) return [];
    const out: any[] = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* torn line */ }
    }
    return out;
  } catch { return []; }
}

export function loadAgentDocs(): AgentDoc[] {
  const dbDir = path.join(paths.root, "whatsapp", "db");
  const latest = new Map<string, any>();
  for (const r of readJsonl(path.join(dbDir, "documents.jsonl"))) latest.set(r.id, r);
  const staged = new Map<string, any>();
  for (const e of readJsonl(path.join(dbDir, "staging.jsonl"))) staged.set(e.id, e);

  const docs: AgentDoc[] = [];
  const seen = new Set<string>();
  const push = (r: any, source: "filed" | "staged", filePath: string) => {
    const ex = r.extracted || {};
    const type = String(ex.documentType || "other");
    if (!filePath || !fs.existsSync(filePath) || seen.has(r.id)) return;
    seen.add(r.id);
    docs.push({
      id: r.id, source, type, label: DOC_LABEL[type] || type, category: CATEGORY_OF[type] || "Other",
      fileName: r.fileName || path.basename(filePath), filePath, receivedAt: r.receivedAt || r.stagedAt || "",
      reference: r.reference?.canonical || ex.referenceNo || r.matchedReference || "",
      extracted: ex,
    });
  };
  for (const r of latest.values()) {
    if (r.deleted || r.superseded) continue;
    if (r.bucket === "_Not A Document" || r.bucket === "_Duplicate") continue;
    if (r.filePath) push(r, "filed", r.filePath);
  }
  for (const e of staged.values()) {
    if (e.status === "waiting") push(e, "staged", e.filePath);
    // Filed from staging: the ledger normally carries it (above); this
    // covers a staged paper whose ledger line was never written.
    else if (e.status === "filed" && e.filedPath) push({ ...e, reference: { canonical: e.matchedReference } }, "filed", e.filedPath);
  }
  return docs;
}

/* ------------------------------------------------------------------ */
/* Linking + comparison                                                 */
/* ------------------------------------------------------------------ */

export interface LinkedDoc extends Omit<AgentDoc, "filePath"> {
  how: "reference" | "document number" | "vehicle & date";
  strength: "sure" | "likely";
  checks: { field: string; ok: boolean; doc: string; trip: string; note?: string }[];
}

export interface Notice { level: "warning" | "info"; text: string; docId?: string }

const daysApart = (a: string, b: string) =>
  Math.abs((new Date(String(a).slice(0, 10) + "T00:00:00Z").getTime() - new Date(String(b).slice(0, 10) + "T00:00:00Z").getTime()) / 86400000);

function kg(v: unknown, unit?: unknown): number {
  const n = Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n) || !n) return 0;
  const u = String(unit || "").toLowerCase();
  if (/qtl|quintal/.test(u)) return n * 100;
  if (/mt|ton/.test(u) || n < 200) return n * 1000;
  return n;
}
function docKg(ex: Record<string, any>): number {
  return kg(ex.quantityKg) || kg(ex.netWeightKg) || kg(ex.netWeight) || kg(ex.totalQuantity, ex.quantityUnit);
}
const close = (a: number, b: number, pct = 1, flat = 50) => Math.abs(a - b) <= Math.max(flat, (Math.max(a, b) * pct) / 100);
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function linkReason(t: Trip, ref: TripReference, d: AgentDoc): LinkedDoc["how"] | null {
  const ex = d.extracted;
  const dr = parseRef(d.reference || "");
  if (dr && ref.ourNo && dr.ourNo === ref.ourNo && ref.vendorCode && dr.vendorCode === ref.vendorCode) return "reference";
  const isOurs = d.type.startsWith("biome_");
  const isVendor = d.type.startsWith("vendor_");
  if (isOurs && ref.ourNo && ex.biomeDocNo && docTail(ex.biomeDocNo) === ref.ourNo) return "document number";
  if (isVendor && ref.vendorCode && ex.vendorCode && up(ex.vendorCode) === ref.vendorCode && ref.vendorNo && ex.vendorDocNo && docTail(ex.vendorDocNo) === ref.vendorNo) return "document number";
  const date = t.vehicleEntryDate || t.ourDocDate;
  if (t.vehicleNumber && ex.vehicleNo && plate(ex.vehicleNo) === plate(t.vehicleNumber) && date && ex.documentDate && daysApart(date, ex.documentDate) <= 2) return "vehicle & date";
  return null;
}

function checksFor(t: Trip, ref: TripReference, d: AgentDoc): LinkedDoc["checks"] {
  const ex = d.extracted;
  const out: LinkedDoc["checks"] = [];
  const add = (field: string, ok: boolean, doc: string, trip: string, note?: string) => out.push({ field, ok, doc, trip, note });

  if (ex.vehicleNo && t.vehicleNumber) add("Vehicle", plate(ex.vehicleNo) === plate(t.vehicleNumber), plate(ex.vehicleNo), plate(t.vehicleNumber));
  const date = t.vehicleEntryDate || t.ourDocDate;
  if (ex.documentDate && date) add("Date", daysApart(ex.documentDate, date) <= 3, String(ex.documentDate).slice(0, 10), date, "within 3 days");

  if (d.type.startsWith("biome_") && ex.biomeDocNo && t.ourDocNo) add("Our doc no", docTail(ex.biomeDocNo) === docTail(t.ourDocNo), String(ex.biomeDocNo), t.ourDocNo);
  if ((d.type === "vendor_tax_invoice" || d.type === "vendor_delivery_challan") && ex.vendorDocNo) {
    const tripNo = t.vendorInvoiceNo || t.vendorChallanNo;
    if (tripNo) add("Vendor doc no", docTail(ex.vendorDocNo) === docTail(tripNo), String(ex.vendorDocNo), tripNo);
    const q = docKg(ex);
    if (q && t.vendorChallanWeight) add("Vendor weight (kg)", close(q, t.vendorChallanWeight), q.toLocaleString("en-IN"), t.vendorChallanWeight.toLocaleString("en-IN"));
    const amt = Number(ex.totalAmount) || 0;
    if (amt && t.vendorChallanAmount) add("Amount", close(amt, t.vendorChallanAmount, 1, 10), inr(amt), inr(t.vendorChallanAmount));
  }
  if (d.type === "weight_slip") {
    const q = docKg(ex);
    if (q && t.vendorChallanWeight) add("Slip net weight (kg)", close(q, t.vendorChallanWeight), q.toLocaleString("en-IN"), t.vendorChallanWeight.toLocaleString("en-IN"));
  }
  if (d.type === "receiving") {
    const q = docKg(ex);
    if (q && t.receivingQty) add("Received weight (kg)", close(q, t.receivingQty, 0.5, 20), q.toLocaleString("en-IN"), t.receivingQty.toLocaleString("en-IN"));
    else if (q && !t.receivingQty) add("Received weight (kg)", false, q.toLocaleString("en-IN"), "not entered", "receiving slip arrived — enter the receiving weight");
  }
  if (ex.clientName && t.client && d.type !== "vendor_tax_invoice") {
    const a = up(ex.clientName).replace(/[^A-Z]/g, ""), b = up(t.client).replace(/[^A-Z]/g, "");
    add("Client", !!a && !!b && (a.includes(b.slice(0, 8)) || b.includes(a.slice(0, 8))), String(ex.clientName), t.client);
  }
  const dr = parseRef(d.reference || "");
  if (dr && ref.source !== "incomplete" && `${dr.ourNo}/${dr.vendorCode}/${dr.vendorNo}` !== `${ref.ourNo}/${ref.vendorCode}/${ref.vendorNo}`) {
    add("Reference", false, d.reference, ref.canonical);
  }
  return out;
}

/** The paper a complete supply is expected to have. */
function expectedFor(t: Trip): { type: string[]; label: string }[] {
  const ours = { type: ["biome_tax_invoice", "biome_delivery_challan"], label: t.docType === "tax_invoice" ? "Our tax invoice" : "Our delivery challan" };
  const common = [
    ours,
    { type: ["biome_eway_bill", "vendor_eway_bill"], label: "E-way bill" },
    { type: ["weight_slip"], label: "Weight slip" },
    { type: ["bilty_lr"], label: "Bilty / LR" },
  ];
  const vendor = t.business === "trading"
    ? [{ type: ["vendor_tax_invoice", "vendor_delivery_challan"], label: "Vendor invoice / challan" }]
    : [];
  const client = t.receivingQty || ["received", "accepted", "shortage"].includes(t.status) ? [{ type: ["receiving"], label: "Receiving slip" }] : [];
  return [...common, ...vendor, ...client];
}

export interface TripDocs {
  reference: TripReference;
  docs: LinkedDoc[];
  byCategory: Record<string, LinkedDoc[]>;
  missing: string[];
  notices: Notice[];
}

export function docsForTrip(t: Trip, all: AgentDoc[] = loadAgentDocs()): TripDocs {
  const ref = tripReference(t);
  const docs: LinkedDoc[] = [];
  for (const d of all) {
    const how = linkReason(t, ref, d);
    if (!how) continue;
    const { filePath: _fp, ...rest } = d;
    docs.push({ ...rest, how, strength: how === "vehicle & date" ? "likely" : "sure", checks: checksFor(t, ref, d) });
  }
  docs.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  const byCategory: Record<string, LinkedDoc[]> = {};
  for (const d of docs) (byCategory[d.category] ||= []).push(d);

  const have = new Set(docs.filter((d) => d.strength === "sure" || d.how === "vehicle & date").map((d) => d.type));
  const missing = t.status === "cancelled" ? [] : expectedFor(t).filter((e) => !e.type.some((x) => have.has(x))).map((e) => e.label);

  const notices: Notice[] = [];
  if (ref.source === "incomplete") notices.push({ level: "info", text: `Reference incomplete (${ref.missing.join(", ")}) — fill these or type the reference so WhatsApp documents can link.` });
  for (const d of docs) {
    for (const c of d.checks.filter((c) => !c.ok)) {
      notices.push({ level: "warning", docId: d.id, text: `${d.label}: ${c.field} on the document is ${c.doc}, the trip says ${c.trip}${c.note ? ` (${c.note})` : ""}.` });
    }
    if (d.strength === "likely") notices.push({ level: "info", docId: d.id, text: `${d.label} linked by vehicle and date only — confirm it belongs to this supply.` });
  }
  return { reference: ref, docs, byCategory, missing, notices };
}

/** Where a linked document's file is — only for a document linked to this trip. */
export function filePathFor(t: Trip, docId: string): { filePath: string; fileName: string } | null {
  const all = loadAgentDocs();
  const d = all.find((x) => x.id === docId);
  if (!d || !linkReason(t, tripReference(t), d)) return null;
  return { filePath: d.filePath, fileName: d.fileName };
}
