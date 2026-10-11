/**
 * Biome Platform — plant stock: spare parts, consumables, machines (server only)
 * -------------------------------------------------------------------
 * Three masters and one ledger:
 *
 *   items      what can be stocked — a bearing, a V-belt, a litre of oil —
 *              with part number, unit, re-order level and the machines it fits
 *   machines   what parts are used IN — pelletiser, hammer mill, dryer —
 *              per plant
 *   movements  every receipt (GRN from a registered vendor), issue (to a
 *              machine, to a person), return, adjustment and transfer
 *
 * THE DESIGN DECISION: a balance is never stored. Like PO consumption,
 * stock on hand is COMPUTED from the movements every time. A cancelled
 * GRN, a corrected issue or two people saving at once cannot leave a
 * wrong balance behind, because there is no balance to go wrong — only a
 * sum to recompute. Value is by weighted average cost.
 *
 * Vendors are NOT a separate list here: they are the registered vendors
 * (Partners) whose "handled for" includes spare parts / consumables /
 * machinery service. One vendor master for the whole app.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export const ITEM_CATEGORIES = [
  "Spare part", "Consumable", "Bearing", "Belt / chain", "Electrical", "Hydraulic / pneumatic",
  "Lubricant / oil", "Tool", "Die / roller", "Safety", "Fastener", "Other",
] as const;

export const UNITS = ["Nos", "Set", "Pair", "Kg", "Ltr", "Mtr", "Box", "Roll", "Pkt"] as const;

export type MovementType = "receipt" | "issue" | "return" | "adjust_in" | "adjust_out" | "transfer_out" | "transfer_in";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  receipt: "Receipt (GRN)",
  issue: "Issue to machine",
  return: "Return to store",
  adjust_in: "Adjustment +",
  adjust_out: "Adjustment −",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
};

/** +1 adds to stock, −1 takes away. */
export const SIGN: Record<MovementType, 1 | -1> = {
  receipt: 1, return: 1, adjust_in: 1, transfer_in: 1,
  issue: -1, adjust_out: -1, transfer_out: -1,
};

export interface StockItem {
  id: string;
  code: string;
  name: string;
  partNo: string;
  category: string;
  unit: string;
  make: string;
  specification: string;
  /** Re-order level, per plant. Empty key = applies to every plant. */
  minLevel: Record<string, number>;
  /** Machines this part fits — for suggestions on the issue form. */
  machineIds: string[];
  rack: string;
  /** Location / bin per plant (falls back to `rack`). */
  bins: Record<string, string>;
  active: boolean;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
}

export interface Machine {
  id: string;
  code: string;
  name: string;
  plant: string;
  section: string;
  make: string;
  model: string;
  serialNo: string;
  /** Asset register fields (added with the procurement module). */
  installDate: string;
  warrantyUpto: string;
  capacity: string;
  /** Latest running-hours meter reading and its date. */
  runningHours: number;
  hoursAt: string;
  notes: string;
  active: boolean;
  createdAt: string;
  createdByName: string;
}

export interface Movement {
  id: string;
  /** GRN-REW-0001, ISS-GKD-0012 … */
  no: string;
  type: MovementType;
  date: string;
  plant: string;
  itemId: string;
  qty: number;
  /** Per unit. Receipts carry the purchase rate; others take the running average. */
  rate: number;
  amount: number;
  vendorId: string;
  vendorName: string;
  invoiceNo: string;
  challanNo: string;
  machineId: string;
  issuedTo: string;
  purpose: string;
  remarks: string;
  /** Links the two halves of a transfer. */
  transferId: string;
  cancelled: boolean;
  cancelReason: string;
  cancelledByName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  /** Receipt made by finalising this GRN (procurement flow). */
  grnId?: string;
  /** Issue made by this maintenance log (parts used). */
  maintenanceId?: string;
  /**
   * Adjustments made by someone without `stock.approve` wait here and do
   * not touch the balance until approved. Missing = approved (older data).
   */
  approval?: "pending" | "approved" | "rejected";
  approvalByName?: string;
  approvalAt?: string;
  approvalNote?: string;
  /** Transfer-in still on the road: not in the receiving plant's stock yet. */
  inTransit?: boolean;
  receivedAt?: string;
  receivedByName?: string;
}

/** Does this movement count in the balance right now? */
export function isLive(m: Movement): boolean {
  if (m.cancelled) return false;
  if (m.approval === "pending" || m.approval === "rejected") return false;
  if (m.inTransit) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Procurement flow: indent → PO → GRN → final                        */
/* ------------------------------------------------------------------ */

export type Urgency = "normal" | "urgent" | "breakdown";
export const URGENCY_LABEL: Record<Urgency, string> = { normal: "Normal", urgent: "Urgent", breakdown: "Breakdown — machine stopped" };

export interface IndentLine {
  id: string;
  /** Item master id, or "" for a part that is not in the master yet. */
  itemId: string;
  name: string;
  partNo: string;
  qty: number;
  unit: string;
}

export interface Indent {
  id: string;
  /** IND-REW-0001 */
  no: string;
  plant: string;
  date: string;
  requiredBy: string;
  urgency: Urgency;
  machineId: string;
  reason: string;
  lines: IndentLine[];
  /** The decision procurement takes. What happens after is computed from the linked POs. */
  state: "open" | "approved" | "rejected" | "withdrawn";
  decisionNote: string;
  decidedByName: string;
  decidedAt: string;
  poIds: string[];
  raisedBy: string;
  raisedByName: string;
  createdAt: string;
}

export interface PoLine {
  id: string;
  itemId: string;
  partNo: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  gstPct: number;
}

export interface PoEvent { at: string; byName: string; action: string; note: string }

export interface SparePo {
  id: string;
  /** BI/SPO/REW/2026-27/0001 */
  no: string;
  date: string;
  /** Delivery plant. */
  plant: string;
  vendorId: string;
  vendorName: string;
  vendorGstin: string;
  vendorEmail: string;
  vendorAddress: string;
  lines: PoLine[];
  freight: number;
  expectedDate: string;
  paymentTerms: string;
  deliveryTerms: string;
  terms: string;
  notes: string;
  indentIds: string[];
  /** What a person decided. "partial" and "received" are computed from final GRNs. */
  state: "draft" | "issued" | "closed" | "cancelled";
  issuedAt: string;
  issuedByName: string;
  stateNote: string;
  emails: { at: string; to: string; ok: boolean; note: string }[];
  history: PoEvent[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrnLine {
  poLineId: string;
  itemId: string;
  receivedQty: number;
  damagedQty: number;
  /** Rate on the vendor's invoice; 0 = same as PO. */
  invoiceRate: number;
  remarks: string;
}

export interface Grn {
  id: string;
  /** GRN-REW-0001 */
  no: string;
  poId: string;
  poNo: string;
  plant: string;
  vendorId: string;
  vendorName: string;
  date: string;
  invoiceNo: string;
  invoiceDate: string;
  challanNo: string;
  vehicleNo: string;
  lines: GrnLine[];
  remarks: string;
  state: "draft" | "final";
  /** Required when the match shows an excess or a rate difference. */
  matchNote: string;
  finalAt: string;
  finalByName: string;
  reopens: { at: string; byName: string; reason: string }[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

export interface PmSchedule {
  id: string;
  machineId: string;
  plant: string;
  task: string;
  checklist: string;
  /** Every N days (0 = not by days). */
  everyDays: number;
  /** Every N running hours (0 = not by hours). */
  everyHours: number;
  lastDoneDate: string;
  lastDoneHours: number;
  active: boolean;
  createdAt: string;
  createdByName: string;
}

export type MaintKind = "preventive" | "breakdown" | "inspection" | "overhaul";
export const MAINT_LABEL: Record<MaintKind, string> = { preventive: "Preventive", breakdown: "Breakdown", inspection: "Inspection", overhaul: "Overhaul" };

export interface MaintenanceLog {
  id: string;
  /** MNT-REW-0001 */
  no: string;
  plant: string;
  machineId: string;
  date: string;
  kind: MaintKind;
  scheduleId: string;
  work: string;
  doneBy: string;
  downtimeHours: number;
  labourCost: number;
  otherCost: number;
  /** Value of parts issued for this job at the time it was saved. */
  partsCost: number;
  hoursReading: number;
  cancelled: boolean;
  cancelReason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface StockAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Relative to the stock folder. */
  file: string;
  uploadedAt: string;
  uploadedByName: string;
}

interface StockFile {
  items: StockItem[];
  machines: Machine[];
  movements: Movement[];
  seq: Record<string, number>;
  /** Purchase invoices, kanta parchis, challans — per document number (GRN-REW-0001). */
  attachments: Record<string, StockAttachment[]>;
  indents: Indent[];
  pos: SparePo[];
  grns: Grn[];
  schedules: PmSchedule[];
  maintenance: MaintenanceLog[];
  updatedAt?: string;
}

function file() { return path.join(paths.root, "stock", "stock.json"); }
export function stockDir() { return path.join(paths.root, "stock"); }

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Read the file and bring older records up to the current shape. Purely
 * additive: a field that was never stored gets its empty default, nothing
 * that was stored is changed — so data saved before the procurement module
 * keeps its meaning (a movement with no `approval` is approved, a transfer
 * with no `inTransit` already arrived).
 */
export function loadStock(): StockFile {
  const f = readJson<Partial<StockFile>>(file(), {});
  return {
    items: arr<StockItem>(f.items).map((i) => ({ ...i, bins: i.bins && typeof i.bins === "object" ? i.bins : {}, machineIds: arr<string>(i.machineIds), minLevel: i.minLevel || {} })),
    machines: arr<Machine>(f.machines).map((m) => ({
      ...m, installDate: m.installDate || "", warrantyUpto: m.warrantyUpto || "", capacity: m.capacity || "",
      runningHours: Number(m.runningHours) || 0, hoursAt: m.hoursAt || "", notes: m.notes || "",
    })),
    movements: arr<Movement>(f.movements),
    seq: f.seq && typeof f.seq === "object" ? f.seq : {},
    attachments: f.attachments && typeof f.attachments === "object" ? f.attachments : {},
    indents: arr<Indent>(f.indents),
    pos: arr<SparePo>(f.pos),
    grns: arr<Grn>(f.grns),
    schedules: arr<PmSchedule>(f.schedules),
    maintenance: arr<MaintenanceLog>(f.maintenance),
  };
}

export type { StockFile };

export function saveStock(s: StockFile): void {
  ensureDir(path.join(paths.root, "stock"));
  writeJsonAtomic(file(), { ...s, updatedAt: new Date().toISOString() });
}

export function nextNo(s: StockFile, prefix: string): string {
  const n = (s.seq[prefix] || 0) + 1;
  s.seq[prefix] = n;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export const newId = () => crypto.randomUUID();

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

export interface Balance {
  itemId: string;
  plant: string;
  qty: number;
  value: number;
  avgRate: number;
  received: number;
  issued: number;
  lastReceipt: string;
  lastIssue: string;
}

const key = (itemId: string, plant: string) => `${itemId}|${plant}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Walk the ledger in date order and build qty + weighted-average value per
 * item per plant. Pure: same movements in, same balances out.
 */
export function computeBalances(movements: Movement[]): Map<string, Balance> {
  const out = new Map<string, Balance>();
  const live = movements.filter(isLive).sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  for (const m of live) {
    const k = key(m.itemId, m.plant);
    const b = out.get(k) || { itemId: m.itemId, plant: m.plant, qty: 0, value: 0, avgRate: 0, received: 0, issued: 0, lastReceipt: "", lastIssue: "" };
    if (SIGN[m.type] > 0) {
      const rate = m.type === "receipt" || m.type === "transfer_in" || m.rate > 0 ? m.rate : b.avgRate;
      b.value += m.qty * rate;
      b.qty += m.qty;
      if (m.type === "receipt") { b.received += m.qty; b.lastReceipt = m.date; }
    } else {
      b.value -= m.qty * b.avgRate;
      b.qty -= m.qty;
      if (m.type === "issue") { b.issued += m.qty; b.lastIssue = m.date; }
    }
    b.qty = r2(b.qty);
    b.value = b.qty <= 0 ? 0 : r2(b.value);
    b.avgRate = b.qty > 0 ? r2(b.value / b.qty) : b.avgRate;
    out.set(k, b);
  }
  return out;
}

export function balanceOf(balances: Map<string, Balance>, itemId: string, plant: string): Balance {
  return balances.get(key(itemId, plant)) || { itemId, plant, qty: 0, value: 0, avgRate: 0, received: 0, issued: 0, lastReceipt: "", lastIssue: "" };
}

export function minLevelFor(item: StockItem, plant: string): number {
  const v = item.minLevel?.[plant] ?? item.minLevel?.[""] ?? 0;
  return Number(v) || 0;
}

/* ------------------------------------------------------------------ */
/* Summaries used by the screen and the report builder                 */
/* ------------------------------------------------------------------ */

export interface StockRow {
  itemId: string; code: string; name: string; partNo: string; category: string; unit: string;
  plant: string; qty: number; avgRate: number; value: number; minLevel: number;
  status: "ok" | "low" | "out"; received: number; issued: number; lastReceipt: string; lastIssue: string; rack: string;
  /** Ordered on an issued PO for this plant and not yet received. */
  onOrder: number;
  /** On the road from another plant. */
  inTransit: number;
}

export function stockRows(s: StockFile, plants: string[]): StockRow[] {
  const bal = computeBalances(s.movements);
  const order = onOrderMap(s);
  const transit = new Map<string, number>();
  for (const m of s.movements) if (!m.cancelled && m.inTransit) transit.set(key(m.itemId, m.plant), (transit.get(key(m.itemId, m.plant)) || 0) + m.qty);
  const rows: StockRow[] = [];
  for (const item of s.items) {
    for (const plant of plants) {
      const b = balanceOf(bal, item.id, plant);
      const min = minLevelFor(item, plant);
      // An inactive item with nothing on hand is history, not stock.
      if (!item.active && b.qty === 0) continue;
      // Only show a plant row for an item that has ever moved there, or has a re-order level there.
      const oo = order.get(key(item.id, plant)) || 0;
      const tr = transit.get(key(item.id, plant)) || 0;
      if (b.qty === 0 && b.received === 0 && !min && !oo && !s.movements.some((m) => m.itemId === item.id && m.plant === plant)) continue;
      rows.push({
        itemId: item.id, code: item.code, name: item.name, partNo: item.partNo, category: item.category, unit: item.unit,
        plant, qty: b.qty, avgRate: b.avgRate, value: b.value, minLevel: min,
        status: b.qty <= 0 ? "out" : min && b.qty <= min ? "low" : "ok",
        received: b.received, issued: b.issued, lastReceipt: b.lastReceipt, lastIssue: b.lastIssue, rack: item.bins?.[plant] || item.rack,
        onOrder: r2(oo), inTransit: r2(tr),
      });
    }
  }
  return rows.sort((a, b) => a.plant.localeCompare(b.plant) || a.name.localeCompare(b.name));
}

/** What went into each machine — the "which part was used where" question. */
export function machineUsage(s: StockFile, plants: string[], from = "", to = "") {
  const items = new Map(s.items.map((i) => [i.id, i]));
  const bal = computeBalances(s.movements);
  const rows = s.movements
    .filter((m) => isLive(m) && (m.type === "issue" || m.type === "return") && m.machineId && plants.includes(m.plant))
    .filter((m) => (!from || m.date >= from) && (!to || m.date <= to));
  const byMachine = new Map<string, { machineId: string; parts: number; value: number; lines: number; last: string }>();
  for (const m of rows) {
    const sign = m.type === "issue" ? 1 : -1;
    const avg = m.rate || balanceOf(bal, m.itemId, m.plant).avgRate;
    const e = byMachine.get(m.machineId) || { machineId: m.machineId, parts: 0, value: 0, lines: 0, last: "" };
    e.parts += sign * m.qty;
    e.value += sign * m.qty * avg;
    e.lines += 1;
    if (m.date > e.last) e.last = m.date;
    byMachine.set(m.machineId, e);
  }
  return { rows: rows.map((m) => ({ ...m, itemName: items.get(m.itemId)?.name || "?" })), byMachine: Array.from(byMachine.values()) };
}

/* ------------------------------------------------------------------ */
/* PO / GRN arithmetic — computed, never stored                        */
/* ------------------------------------------------------------------ */

export const lineValue = (l: Pick<PoLine, "qty" | "rate" | "gstPct">) => {
  const taxable = r2(l.qty * l.rate);
  const gst = r2(taxable * (l.gstPct || 0) / 100);
  return { taxable, gst, total: r2(taxable + gst) };
};

export function poTotals(po: Pick<SparePo, "lines" | "freight">) {
  let taxable = 0, gst = 0;
  for (const l of po.lines) { const v = lineValue(l); taxable += v.taxable; gst += v.gst; }
  return { taxable: r2(taxable), gst: r2(gst), freight: r2(po.freight || 0), total: r2(taxable + gst + (po.freight || 0)) };
}

/** Accepted (good) quantity per PO line from FINAL GRNs, optionally leaving one GRN out. */
export function receivedByLine(s: Pick<StockFile, "grns">, poId: string, exceptGrnId = ""): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of s.grns) {
    if (g.poId !== poId || g.state !== "final" || g.id === exceptGrnId) continue;
    for (const l of g.lines) out.set(l.poLineId, r2((out.get(l.poLineId) || 0) + Math.max(0, l.receivedQty - l.damagedQty)));
  }
  return out;
}

export type PoStatus = "draft" | "issued" | "partial" | "received" | "closed" | "cancelled";
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft", issued: "Issued", partial: "Partially received", received: "Closed — fully received", closed: "Closed (short-closed)", cancelled: "Cancelled",
};

export interface PoView extends SparePo {
  status: PoStatus;
  totals: ReturnType<typeof poTotals>;
  lineStatus: { id: string; ordered: number; received: number; pending: number }[];
  receivedValue: number;
  grnNos: string[];
  pendingGrns: number;
  overdue: boolean;
}

export function poView(s: Pick<StockFile, "grns">, po: SparePo): PoView {
  const rec = receivedByLine(s, po.id);
  const lineStatus = po.lines.map((l) => {
    const received = rec.get(l.id) || 0;
    return { id: l.id, ordered: l.qty, received, pending: r2(Math.max(0, l.qty - received)) };
  });
  const any = lineStatus.some((x) => x.received > 0);
  const all = lineStatus.length > 0 && lineStatus.every((x) => x.pending <= 1e-9);
  let status: PoStatus = po.state;
  if (po.state === "issued") status = all ? "received" : any ? "partial" : "issued";
  const grns = s.grns.filter((g) => g.poId === po.id);
  let receivedValue = 0;
  for (const g of grns.filter((x) => x.state === "final")) {
    for (const gl of g.lines) {
      const pl = po.lines.find((x) => x.id === gl.poLineId);
      if (!pl) continue;
      receivedValue += lineValue({ qty: Math.max(0, gl.receivedQty - gl.damagedQty), rate: gl.invoiceRate || pl.rate, gstPct: pl.gstPct }).total;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...po, status, totals: poTotals(po), lineStatus, receivedValue: r2(receivedValue),
    grnNos: grns.map((g) => g.no), pendingGrns: grns.filter((g) => g.state === "draft").length,
    overdue: (status === "issued" || status === "partial") && !!po.expectedDate && po.expectedDate < today,
  };
}

/** Qty on order (issued / partly received POs) per item per plant. */
export function onOrderMap(s: Pick<StockFile, "pos" | "grns">): Map<string, number> {
  const out = new Map<string, number>();
  for (const po of s.pos) {
    if (po.state !== "issued") continue;
    const rec = receivedByLine(s, po.id);
    for (const l of po.lines) {
      if (!l.itemId) continue;
      const pending = Math.max(0, l.qty - (rec.get(l.id) || 0));
      if (pending > 0) out.set(key(l.itemId, po.plant), (out.get(key(l.itemId, po.plant)) || 0) + pending);
    }
  }
  return out;
}

export interface GrnMatchLine {
  poLineId: string; itemId: string; description: string; unit: string;
  ordered: number; receivedBefore: number; pendingBefore: number;
  receivedQty: number; damagedQty: number; acceptedQty: number;
  short: number; excess: number; poRate: number; invoiceRate: number; rateDiff: number;
  flags: ("short" | "excess" | "rate" | "damaged" | "ok")[];
}

/** The GRN laid against its PO: what is short, excess, damaged or at a different rate. */
export function grnMatch(s: Pick<StockFile, "grns">, po: SparePo, grn: Pick<Grn, "id" | "lines">): { lines: GrnMatchLine[]; needsNote: boolean; anyAccepted: boolean } {
  const before = receivedByLine(s, po.id, grn.id);
  const lines: GrnMatchLine[] = po.lines.map((pl) => {
    const gl = grn.lines.find((x) => x.poLineId === pl.id);
    const receivedQty = gl ? gl.receivedQty : 0;
    const damagedQty = gl ? Math.min(gl.damagedQty, receivedQty) : 0;
    const acceptedQty = r2(receivedQty - damagedQty);
    const rb = before.get(pl.id) || 0;
    const pendingBefore = r2(Math.max(0, pl.qty - rb));
    const invoiceRate = gl && gl.invoiceRate > 0 ? gl.invoiceRate : pl.rate;
    const short = r2(Math.max(0, pendingBefore - acceptedQty));
    const excess = r2(Math.max(0, acceptedQty - pendingBefore));
    const rateDiff = r2(invoiceRate - pl.rate);
    const flags: GrnMatchLine["flags"] = [];
    if (receivedQty > 0 || pendingBefore > 0) {
      if (short > 0) flags.push("short");
      if (excess > 0) flags.push("excess");
      if (Math.abs(rateDiff) > 0.004 && receivedQty > 0) flags.push("rate");
      if (damagedQty > 0) flags.push("damaged");
    }
    if (!flags.length) flags.push("ok");
    return {
      poLineId: pl.id, itemId: pl.itemId, description: pl.description, unit: pl.unit,
      ordered: pl.qty, receivedBefore: rb, pendingBefore, receivedQty, damagedQty, acceptedQty,
      short, excess, poRate: pl.rate, invoiceRate, rateDiff, flags,
    };
  });
  return {
    lines,
    needsNote: lines.some((l) => l.flags.includes("excess") || l.flags.includes("rate")),
    anyAccepted: lines.some((l) => l.acceptedQty > 0),
  };
}

/* ------------------------------------------------------------------ */
/* Indent status — what the plant sees                                 */
/* ------------------------------------------------------------------ */

export function indentStatus(s: Pick<StockFile, "pos" | "grns">, ind: Indent): { code: string; label: string; pos: { no: string; status: PoStatus; expectedDate: string }[] } {
  const pos = s.pos.filter((p) => ind.poIds.includes(p.id) && p.state !== "draft").map((p) => poView(s, p));
  const list = pos.map((p) => ({ no: p.no, status: p.status, expectedDate: p.expectedDate }));
  if (ind.state === "rejected") return { code: "rejected", label: "Rejected", pos: list };
  if (ind.state === "withdrawn") return { code: "withdrawn", label: "Withdrawn", pos: list };
  const live = pos.filter((p) => p.status !== "cancelled");
  if (live.length) {
    if (live.every((p) => p.status === "received" || p.status === "closed")) return { code: "received", label: "Received at plant", pos: list };
    if (live.some((p) => p.status === "partial")) return { code: "partial", label: "Partly received", pos: list };
    return { code: "ordered", label: "PO issued — awaiting delivery", pos: list };
  }
  if (ind.state === "approved") return { code: "approved", label: "Approved — PO being prepared", pos: list };
  return { code: "open", label: "Waiting for procurement", pos: list };
}

/* ------------------------------------------------------------------ */
/* Preventive maintenance — what is due                                */
/* ------------------------------------------------------------------ */

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface PmDue {
  scheduleId: string; nextDate: string; nextHours: number; daysLeft: number | null; hoursLeft: number | null;
  status: "ok" | "due" | "overdue";
}

export function pmDue(sch: PmSchedule, machine: Machine | undefined, today = new Date().toISOString().slice(0, 10)): PmDue {
  const base = sch.lastDoneDate || sch.createdAt.slice(0, 10);
  const nextDate = sch.everyDays > 0 ? addDays(base, sch.everyDays) : "";
  const nextHours = sch.everyHours > 0 ? (sch.lastDoneHours || 0) + sch.everyHours : 0;
  const daysLeft = nextDate ? Math.round((Date.parse(nextDate) - Date.parse(today)) / 86400000) : null;
  const hoursLeft = nextHours ? r2(nextHours - (machine?.runningHours || 0)) : null;
  let status: PmDue["status"] = "ok";
  if ((daysLeft !== null && daysLeft < 0) || (hoursLeft !== null && hoursLeft < 0)) status = "overdue";
  else if ((daysLeft !== null && daysLeft <= 3) || (hoursLeft !== null && hoursLeft <= Math.max(8, sch.everyHours * 0.1))) status = "due";
  return { scheduleId: sch.id, nextDate, nextHours, daysLeft, hoursLeft, status };
}

/* ------------------------------------------------------------------ */
/* Number formats                                                      */
/* ------------------------------------------------------------------ */

/** Indian financial year for a date: "2026-27". Same rule as lib/numberSeries. */
export function fyOf(iso: string): string {
  const d = new Date((iso || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** BI/SPO/REW/2026-27/0001 — runs per plant per financial year, never reused. */
export function nextPoNo(s: StockFile, plant: string, date: string): string {
  const fy = fyOf(date);
  const k = `SPO-${plant}-${fy}`;
  const n = (s.seq[k] || 0) + 1;
  s.seq[k] = n;
  return `BI/SPO/${plant}/${fy}/${String(n).padStart(4, "0")}`;
}
