/**
 * Biome AI OS — PO Quantity Intelligence (server only)
 * -------------------------------------------------------------------
 * Vendor purchase orders and client POs / work orders, with balances the
 * user never maintains by hand.
 *
 * THE ONE DESIGN DECISION THAT MAKES IT SAFE
 * Consumed quantity is never stored and never incremented. It is
 * COMPUTED, every time, from the coordination trips linked to the PO:
 *
 *   vendor PO  ← sum of vendorChallanWeight of linked, non-cancelled trips
 *   client PO  ← sum of the quantity the client is billed for: the
 *                invoice weight when invoiced, else the receiving weight,
 *                else the dispatched weight — of linked, non-cancelled,
 *                non-rejected trips
 *
 * So a cancelled trip, a corrected weight, a deleted record or a double
 * submit can never leave a wrong balance: there is no balance to
 * corrupt, only a sum to recompute. The stored PO carries what only a
 * person can know (number, dates, total, thresholds, attachments) plus
 * the alert flags that make notifications idempotent.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadTrips, type Trip } from "@/lib/coordination";
import { recordAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { loadUsers } from "@/lib/authServer";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export type PoType = "vendor" | "client";
export type PoStatus = "draft" | "active" | "low_balance" | "exhausted" | "expired" | "closed" | "cancelled";

export interface PoAdjustment {
  at: string; byId: string; byName: string; field: string; oldValue: string; newValue: string; reason: string;
}

export interface PurchaseOrder {
  id: string;
  type: PoType;
  /** Vendor code (vendor PO) or client name (client PO) — the master's own key, not a copy. */
  partyKey: string;
  partyName: string;
  poNumber: string;
  workOrderNumber: string;
  poDate: string;
  material: string;
  totalQuantity: number;
  unit: "MT" | "KG";
  rate: number | null;
  value: number | null;
  startDate: string;
  expiryDate: string;
  status: PoStatus;
  /** Manual statuses (draft/closed/cancelled) stick; computed ones don't. */
  manualStatus: "draft" | "closed" | "cancelled" | null;
  thresholds: number[]; // percent, e.g. [75, 90, 95]
  minRemainingKg: number; // absolute floor, e.g. 500 MT
  attachment: { name: string; file: string } | null;
  notes: string;
  /** Alert flags — set once, so each threshold notifies exactly once. */
  alerted: Record<string, string>; // key → ISO time
  adjustments: PoAdjustment[];
  devEdited?: { by: string; at: string; fields: string[]; note?: string } | null;
  createdBy: string; createdByName: string; createdAt: string;
  updatedBy: string; updatedAt: string;
}

export interface PoConfig {
  /** What happens when a new supply would exceed the balance. */
  overConsumption: "block" | "approve" | "exception";
  recipients: { vendorExhausted: string[]; clientExhausted: string[]; lowBalance: string[]; expiry: string[] };
  emailOnLowBalance: boolean;
  emailOnExpiry: boolean;
  expiryAlertDays: number[];
  defaultThresholds: number[];
  defaultMinRemainingKg: number;
}

export interface PoComputed extends PurchaseOrder {
  consumedKg: number;
  remainingKg: number;
  utilisationPct: number;
  linkedTrips: number;
  avgDailyKg: number | null;
  predictedExhaustionDays: number | null;
  predictionConfidence: "low" | "medium" | "high" | null;
  daysToExpiry: number | null;
  effectiveStatus: PoStatus;
  alerts: PoAlert[];
}

export interface PoAlert {
  key: string;
  level: "info" | "warning" | "high" | "critical";
  kind: "utilisation" | "low_balance" | "exhausted" | "expiry" | "predicted";
  title: string;
  detail: string;
  action: string;
}

interface PoFile { pos: PurchaseOrder[]; config: PoConfig }

const KG_PER_MT = 1000;
export const DEFAULT_PO_CONFIG: PoConfig = {
  overConsumption: "approve",
  recipients: { vendorExhausted: [], clientExhausted: [], lowBalance: [], expiry: [] },
  emailOnLowBalance: false,
  emailOnExpiry: false,
  expiryAlertDays: [30, 15, 7, 1],
  defaultThresholds: [75, 90, 95],
  defaultMinRemainingKg: 500 * KG_PER_MT,
};

function file(): string { return path.join(paths.root, "po", "purchase-orders.json"); }
export function loadPoFile(): PoFile {
  const f = readJson<PoFile>(file(), { pos: [], config: DEFAULT_PO_CONFIG });
  return { pos: Array.isArray(f.pos) ? f.pos : [], config: { ...DEFAULT_PO_CONFIG, ...(f.config || {}), recipients: { ...DEFAULT_PO_CONFIG.recipients, ...(f.config?.recipients || {}) } } };
}
export function savePoFile(f: PoFile): void { ensureDir(path.dirname(file())); writeJsonAtomic(file(), f); }

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
export const fmtQty = (kg: number) => (Math.abs(kg) >= KG_PER_MT ? `${(kg / KG_PER_MT).toLocaleString("en-IN", { maximumFractionDigits: 2 })} MT` : `${Math.round(kg).toLocaleString("en-IN")} kg`);

export function blankPo(by: { id: string; name: string }, type: PoType, cfg: PoConfig): PurchaseOrder {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), type, partyKey: "", partyName: "", poNumber: "", workOrderNumber: "", poDate: today(), material: "",
    totalQuantity: 0, unit: "MT", rate: null, value: null, startDate: today(), expiryDate: "", status: "active", manualStatus: null,
    thresholds: [...cfg.defaultThresholds], minRemainingKg: cfg.defaultMinRemainingKg, attachment: null, notes: "",
    alerted: {}, adjustments: [], createdBy: by.id, createdByName: by.name, createdAt: now, updatedBy: by.id, updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Consumption — computed from trips                                   */
/* ------------------------------------------------------------------ */

/** The quantity a trip consumes from a client PO: what the client is billed for. */
export function clientQtyOf(t: Trip): number {
  const inv = Number((t as any).billing?.invoiceWeightKg) || 0;
  if (inv > 0) return inv;
  const rec = Number(t.receivingQty) || 0;
  if (rec > 0) return rec;
  return Number(t.vendorChallanWeight) || 0;
}
/** The quantity a trip consumes from a vendor PO: what the vendor dispatched. */
export function vendorQtyOf(t: Trip): number { return Number(t.vendorChallanWeight) || 0; }

function counts(t: Trip, type: PoType): boolean {
  const s = t.status;
  if (s === "cancelled") return false;
  if (type === "client" && s === "rejected") return false;
  return true;
}

export function computePo(po: PurchaseOrder, trips: Trip[], cfg: PoConfig): PoComputed {
  const key = po.type === "vendor" ? "vendorPoId" : "clientPoId";
  const linked = trips.filter((t) => (t as any)[key] === po.id && counts(t, po.type));
  const consumedKg = linked.reduce((s, t) => s + (po.type === "vendor" ? vendorQtyOf(t) : clientQtyOf(t)), 0);
  const totalKg = (po.unit === "MT" ? po.totalQuantity * KG_PER_MT : po.totalQuantity) || 0;
  const remainingKg = Math.max(0, totalKg - consumedKg);
  const utilisationPct = totalKg ? Math.min(999, Math.round((consumedKg / totalKg) * 1000) / 10) : 0;

  // Consumption rate from the last 30 days of linked activity.
  const t0 = today();
  const recent = linked.filter((t) => t.vehicleEntryDate && daysBetween(t.vehicleEntryDate, t0) <= 30);
  const recentKg = recent.reduce((s, t) => s + (po.type === "vendor" ? vendorQtyOf(t) : clientQtyOf(t)), 0);
  const span = recent.length ? Math.max(1, daysBetween(recent.map((t) => t.vehicleEntryDate).sort()[0], t0)) : 0;
  const avgDailyKg = recent.length >= 2 ? recentKg / span : null;
  const predictedExhaustionDays = avgDailyKg && avgDailyKg > 0 && remainingKg > 0 ? Math.ceil(remainingKg / avgDailyKg) : null;
  const predictionConfidence = avgDailyKg === null ? null : recent.length >= 8 ? "high" : recent.length >= 4 ? "medium" : "low";
  const daysToExpiry = po.expiryDate ? daysBetween(t0, po.expiryDate) : null;

  let effectiveStatus: PoStatus = po.manualStatus || "active";
  if (!po.manualStatus) {
    if (totalKg > 0 && consumedKg >= totalKg) effectiveStatus = "exhausted";
    else if (daysToExpiry !== null && daysToExpiry < 0) effectiveStatus = "expired";
    else if (totalKg > 0 && (utilisationPct >= Math.max(...po.thresholds, 90) || remainingKg <= po.minRemainingKg)) effectiveStatus = "low_balance";
  }

  const alerts: PoAlert[] = [];
  const party = `${po.partyName} · ${po.poNumber}`;
  if (effectiveStatus === "exhausted") {
    alerts.push({ key: "exhausted", level: "critical", kind: "exhausted", title: `${po.type === "vendor" ? "VENDOR" : "CLIENT"} PO EXHAUSTED — ${party}`, detail: `${fmtQty(consumedKg)} consumed of ${fmtQty(totalKg)}. Remaining 0.`, action: "Review before any further billing or supply; start a new PO / extension." });
  } else if (totalKg > 0) {
    for (const th of [...po.thresholds].sort((a, b) => a - b)) {
      if (utilisationPct >= th) alerts.push({ key: `util-${th}`, level: th >= 95 ? "critical" : th >= 90 ? "high" : "warning", kind: "utilisation", title: `${th}% consumed — ${party}`, detail: `${fmtQty(remainingKg)} remaining (${utilisationPct}% used).`, action: th >= 90 ? "Plan the next PO now." : "Watch the balance." });
    }
    if (remainingKg <= po.minRemainingKg && !alerts.some((a) => a.level === "critical"))
      alerts.push({ key: "min-remaining", level: "high", kind: "low_balance", title: `Below ${fmtQty(po.minRemainingKg)} remaining — ${party}`, detail: `${fmtQty(remainingKg)} left.`, action: "Initiate PO renewal / extension." });
    if (predictedExhaustionDays !== null && predictedExhaustionDays <= 7)
      alerts.push({ key: "predicted", level: predictedExhaustionDays <= 3 ? "high" : "warning", kind: "predicted", title: `Predicted exhaustion in ${predictedExhaustionDays} day(s) — ${party}`, detail: `Estimate: ~${fmtQty(avgDailyKg || 0)}/day over the last 30 days (confidence ${predictionConfidence}). This is a prediction, not the PO expiry.`, action: "Initiate new PO / extension process." });
  }
  if (daysToExpiry !== null && effectiveStatus !== "exhausted") {
    if (daysToExpiry < 0) alerts.push({ key: "expired", level: "critical", kind: "expiry", title: `PO EXPIRED with ${fmtQty(remainingKg)} unused — ${party}`, detail: `Expired ${po.expiryDate}.`, action: "Stop supplies against it; extend or close." });
    else for (const d of cfg.expiryAlertDays) if (daysToExpiry <= d) { alerts.push({ key: `expiry-${d}`, level: d <= 7 ? "high" : "warning", kind: "expiry", title: `PO expires in ${daysToExpiry} day(s) with ${fmtQty(remainingKg)} unused — ${party}`, detail: `Expiry ${po.expiryDate}.`, action: "Consume, extend, or close before expiry." }); break; }
  }
  return { ...po, consumedKg, remainingKg, utilisationPct, linkedTrips: linked.length, avgDailyKg, predictedExhaustionDays, predictionConfidence, daysToExpiry, effectiveStatus, alerts };
}

export function computeAll(): { pos: PoComputed[]; config: PoConfig } {
  const f = loadPoFile();
  let trips: Trip[] = [];
  try { trips = loadTrips(); } catch { /* none */ }
  return { pos: f.pos.map((p) => computePo(p, trips, f.config)), config: f.config };
}

/** Over-consumption check for a proposed supply quantity. */
export function checkConsumption(poId: string, qtyKg: number): { ok: true } | { ok: false; exceedsKg: number; remainingKg: number; po: PoComputed } | { ok: false; error: string } {
  const { pos } = computeAll();
  const po = pos.find((p) => p.id === poId);
  if (!po) return { ok: false, error: "PO not found." };
  if (po.effectiveStatus === "exhausted" || po.effectiveStatus === "expired" || po.manualStatus) return { ok: false, exceedsKg: qtyKg, remainingKg: po.remainingKg, po };
  if (qtyKg > po.remainingKg) return { ok: false, exceedsKg: qtyKg - po.remainingKg, remainingKg: po.remainingKg, po };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Sync — statuses, alerts, the accounts email; idempotent             */
/* ------------------------------------------------------------------ */

function recipientsFor(cfg: PoConfig, kind: keyof PoConfig["recipients"]): string[] {
  const listed = cfg.recipients[kind].filter(Boolean);
  if (listed.length) return listed;
  // Role-based fallback: every active accounts/admin login with an email.
  return loadUsers().filter((u) => u.active && (u.role === "accounts" || u.role === "admin") && (u as any).email).map((u) => (u as any).email as string);
}

export interface PoSyncResult { statusChanges: number; emailsSent: number; alertsRaised: number; notes: string[] }

/** Runs inside the autopilot: persists status flips, sends each alert email once. */
export async function syncPurchaseOrders(actor?: { id: string; name: string; role: string }): Promise<PoSyncResult> {
  const f = loadPoFile();
  let trips: Trip[] = [];
  try { trips = loadTrips(); } catch { /* none */ }
  const res: PoSyncResult = { statusChanges: 0, emailsSent: 0, alertsRaised: 0, notes: [] };
  const now = new Date().toISOString();

  for (const po of f.pos) {
    const c = computePo(po, trips, f.config);
    if (c.effectiveStatus !== po.status) {
      recordAudit({ action: "po.status", userId: actor?.id || "system", userName: actor?.name || "Autopilot", role: actor?.role || "system", targetType: "po", targetId: po.id, targetLabel: `${po.partyName} ${po.poNumber}`, detail: `${po.status} → ${c.effectiveStatus} (automation)` });
      po.status = c.effectiveStatus; po.updatedAt = now; res.statusChanges += 1;
    }
    for (const a of c.alerts) {
      if (po.alerted[a.key]) continue; // notified once
      res.alertsRaised += 1;
      let emailed = false;
      const wantsMail = a.kind === "exhausted" || (a.kind === "expiry" && f.config.emailOnExpiry) || ((a.kind === "utilisation" || a.kind === "low_balance" || a.kind === "predicted") && f.config.emailOnLowBalance);
      if (wantsMail) {
        const to = recipientsFor(f.config, a.kind === "exhausted" ? (po.type === "vendor" ? "vendorExhausted" : "clientExhausted") : a.kind === "expiry" ? "expiry" : "lowBalance");
        if (to.length) {
          const linked = trips.filter((t) => (t as any)[po.type === "vendor" ? "vendorPoId" : "clientPoId"] === po.id).map((t) => t.ourDocNo || t.vehicleNumber).filter(Boolean).slice(0, 25);
          const subject = a.kind === "exhausted" ? `PO EXHAUSTION ALERT — ${po.partyName} · ${po.poNumber}` : `PO alert — ${a.title}`;
          const body = [
            a.kind === "exhausted" ? "PO EXHAUSTION ALERT" : "PO ALERT",
            `PO Type: ${po.type === "vendor" ? "Vendor PO" : "Client PO"}`, `Party Name: ${po.partyName}`, `PO Number: ${po.poNumber}`,
            `Total PO Quantity: ${fmtQty((po.unit === "MT" ? po.totalQuantity * KG_PER_MT : po.totalQuantity))}`, `Consumed Quantity: ${fmtQty(c.consumedKg)}`, `Remaining Quantity: ${fmtQty(c.remainingKg)}`,
            a.kind === "exhausted" ? `Exhaustion Date: ${new Date().toLocaleDateString("en-IN")}` : `Expiry Date: ${po.expiryDate || "—"}`,
            `Related Supply / Coordination References: ${linked.join(", ") || "—"}`, "",
            a.kind === "exhausted" ? "PO quantity has been fully consumed. Please review before processing any further billing, accounting or related transactions against this PO." : `${a.detail} ${a.action}`,
            "", "— Biome AI OS (automated alert)",
          ].join("\n");
          let ok = true;
          for (const addr of to) { const r = await sendMail({ to: addr, subject, text: body, html: `<pre style="font-family:Segoe UI,Arial;font-size:13px;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</pre>` }); if (!r.ok) { ok = false; res.notes.push(`Email to ${addr} failed: ${r.error}`); } else res.emailsSent += 1; }
          emailed = ok;
          recordAudit({ action: "po.email", userId: "system", userName: "Autopilot", role: "system", targetType: "po", targetId: po.id, targetLabel: `${po.partyName} ${po.poNumber}`, detail: `${a.key} → ${to.join(", ")}`, outcome: ok ? "ok" : "failed" });
        } else res.notes.push(`No recipients configured for ${a.kind} alerts (Settings → PO Control).`);
      }
      // Mark notified whether or not mail is configured, so alerts don't nag every run; the alert stays visible on screen.
      po.alerted[a.key] = now;
      recordAudit({ action: `po.alert.${a.kind}`, userId: "system", userName: "Autopilot", role: "system", targetType: "po", targetId: po.id, targetLabel: `${po.partyName} ${po.poNumber}`, detail: `${a.title}${emailed ? " (emailed)" : ""}` });
    }
  }
  savePoFile(f);
  return res;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                            */
/* ------------------------------------------------------------------ */

export function poAnalytics() {
  const { pos } = computeAll();
  const byParty = (type: PoType) => {
    const m = new Map<string, { party: string; total: number; consumed: number; count: number }>();
    for (const p of pos.filter((x) => x.type === type)) {
      const cur = m.get(p.partyKey) || { party: p.partyName, total: 0, consumed: 0, count: 0 };
      cur.total += p.unit === "MT" ? p.totalQuantity * KG_PER_MT : p.totalQuantity; cur.consumed += p.consumedKg; cur.count += 1; m.set(p.partyKey, cur);
    }
    return [...m.values()].map((x) => ({ ...x, utilisationPct: x.total ? Math.round((x.consumed / x.total) * 100) : 0 }));
  };
  const exhausted = pos.filter((p) => p.effectiveStatus === "exhausted");
  const expiredUnused = pos.filter((p) => p.effectiveStatus === "expired").reduce((s, p) => s + p.remainingKg, 0);
  return {
    vendors: byParty("vendor"), clients: byParty("client"),
    avgDaysToExhaust: exhausted.length ? Math.round(exhausted.reduce((s, p) => s + Math.max(1, daysBetween(p.startDate || p.poDate, p.alerted.exhausted?.slice(0, 10) || today())), 0) / exhausted.length) : null,
    unusedAtExpiryKg: expiredUnused,
    overConsumptionAttempts: pos.reduce((s, p) => s + p.adjustments.filter((a) => a.field === "over-consumption").length, 0),
  };
}
