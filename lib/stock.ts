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
  updatedAt?: string;
}

function file() { return path.join(paths.root, "stock", "stock.json"); }
export function stockDir() { return path.join(paths.root, "stock"); }

export function loadStock(): StockFile {
  const f = readJson<Partial<StockFile>>(file(), {});
  return {
    items: Array.isArray(f.items) ? f.items : [],
    machines: Array.isArray(f.machines) ? f.machines : [],
    movements: Array.isArray(f.movements) ? f.movements : [],
    seq: f.seq && typeof f.seq === "object" ? f.seq : {},
    attachments: f.attachments && typeof f.attachments === "object" ? f.attachments : {},
  };
}

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
  const live = movements.filter((m) => !m.cancelled).sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
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
}

export function stockRows(s: StockFile, plants: string[]): StockRow[] {
  const bal = computeBalances(s.movements);
  const rows: StockRow[] = [];
  for (const item of s.items) {
    for (const plant of plants) {
      const b = balanceOf(bal, item.id, plant);
      const min = minLevelFor(item, plant);
      // An inactive item with nothing on hand is history, not stock.
      if (!item.active && b.qty === 0) continue;
      // Only show a plant row for an item that has ever moved there, or has a re-order level there.
      if (b.qty === 0 && b.received === 0 && !min && !s.movements.some((m) => m.itemId === item.id && m.plant === plant)) continue;
      rows.push({
        itemId: item.id, code: item.code, name: item.name, partNo: item.partNo, category: item.category, unit: item.unit,
        plant, qty: b.qty, avgRate: b.avgRate, value: b.value, minLevel: min,
        status: b.qty <= 0 ? "out" : min && b.qty <= min ? "low" : "ok",
        received: b.received, issued: b.issued, lastReceipt: b.lastReceipt, lastIssue: b.lastIssue, rack: item.rack,
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
    .filter((m) => !m.cancelled && (m.type === "issue" || m.type === "return") && m.machineId && plants.includes(m.plant))
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
