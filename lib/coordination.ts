/**
 * Biome Platform — supply coordination (server only)
 * -------------------------------------------------------------------
 * One register for every trip from a vendor to a client, modelled on the
 * spreadsheet the business already keeps.
 *
 * Their template is four sheets — Tally DC, Solapur, Mouda, Invoices —
 * but they are the same register with a Location column, split up because
 * a spreadsheet cannot filter across tabs. Here it is ONE table, which is
 * what finally makes "which vendor loses us the most weight" a question
 * that can be answered.
 *
 * THE NUMBER THIS EXISTS FOR: vendor challan weight vs receiving quantity.
 * Their own data has trips like 36,090 → 34,020 — a 2,070 kg shortage that
 * nobody catches until the month is reconciled.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import type { BusinessType, DocType } from "@/lib/numberSeries";
import { toKg } from "@/lib/units";

export type TripStatus =
  | "planned"      // vehicle assigned, not yet loaded
  | "dispatched"   // loaded and gone, no receiving yet
  | "received"     // receiving weight in
  | "accepted"     // client accepted it
  | "shortage"     // received, but outside tolerance
  | "rejected"     // client took it in and then refused it
  | "cancelled";

export const TRIP_STATUS: { id: TripStatus; label: string; help: string }[] = [
  { id: "planned", label: "Planned", help: "Vehicle assigned against a PO. Nothing has moved yet." },
  { id: "dispatched", label: "Dispatched", help: "Loaded and on the road. Waiting for the receiving weight." },
  { id: "received", label: "Received", help: "Receiving weight is in and within tolerance." },
  { id: "accepted", label: "Accepted", help: "Client has accepted the supply. Ready to invoice." },
  { id: "shortage", label: "Shortage", help: "Received weight is short beyond tolerance. Needs a decision." },
  // Their own register carries this separately from Cancelled: a rejected
  // load reached the plant and came back, which is a different argument
  // with the vendor from a trip that never ran.
  { id: "rejected", label: "Rejected", help: "The client refused the material after it arrived. Reason required." },
  { id: "cancelled", label: "Cancelled", help: "Trip did not happen. Reason required." },
];

/**
 * The billing figures, which come out of Tally rather than being typed
 * here. Kept in their own object so an import can fill them without ever
 * touching a weight the coordinator entered by hand — the two numbers
 * disagree often, and which one is right is exactly what the register is
 * for.
 */
export interface TripBilling {
  /** The date on OUR tax invoice / delivery challan, as Tally has it. */
  invoiceDate: string;
  /** The weight we billed, which is not always the receiving weight. */
  invoiceWeightKg: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** "tally-import" or "manual" — so a figure can be traced. */
  source: string;
  importedAt: string;
  importedBy: string;
}

export function blankBilling(): TripBilling {
  return {
    invoiceDate: "", invoiceWeightKg: 0, taxableAmount: 0, taxAmount: 0,
    totalAmount: 0, source: "", importedAt: "", importedBy: "",
  };
}

export interface Trip {
  id: string;
  serial: number;

  /**
   * Which register this row belongs to. Trading rows carry a vendor;
   * manufacturing rows are our own material and have none.
   */
  business: BusinessType;

  /** What we raised against it, and under which number book. */
  docType: DocType;
  seriesId: string;
  ourDocNo: string;
  ourDocDate: string;
  /** True when the number was typed rather than taken from a series. */
  ourDocManual: boolean;

  /**
   * The coordination reference printed on our invoice and quoted on every
   * paper of this supply: COMPANY / OUR DOC NO / VENDOR (or PLANT) CODE /
   * VENDOR DOC NO — e.g. BDC/45/JSR/15. Empty = composed automatically
   * from the trip (lib/tripDocs.ts). WhatsApp documents carrying this
   * reference are linked to the trip, whenever they arrive.
   */
  referenceNo?: string;

  /** Who it went to, and from where. */
  client: string;
  location: string;
  /**
   * Manufacturing only: the plant code the truck left from (REW, GKD…).
   * `location` is the CLIENT's site (it comes from the PO), so it cannot
   * say which plant dispatched — reading the plant from it is why the
   * plant-dispatch match found almost nothing.
   */
  plant?: string;
  poNumber: string;
  /** PO Quantity Intelligence — optional links; balances are computed from these. */
  vendorPoId?: string | null;
  clientPoId?: string | null;
  /** Set when a developer rewrote this record (stays highlighted). */
  devEdited?: { by: string; at: string; fields: string[]; note?: string } | null;
  poDate: string;

  /** Who supplied it. Empty on a manufacturing row, by design. */
  supplier: string;
  supplierCode: string;
  /** Whether the vendor billed us on an invoice or moved it on a challan. */
  vendorDocType: DocType | "";

  vehicleNumber: string;
  vehicleEntryDate: string;

  /** Vendor's paperwork. */
  vendorChallanNo: string;
  vendorChallanDate: string;
  vendorInvoiceNo: string;
  vendorChallanWeight: number;   // KG
  vendorChallanAmount: number;

  /** Ours. */
  biomeChallanNo: string;

  /** The client's end. */
  receivingDate: string;
  receivingQty: number;          // KG
  /** Client's own weighbridge figure where they run one. */
  ccWeight: number;

  /** Debit / credit note numbers raised against this supply, if any. */
  debitNoteNo: string;
  creditNoteNo: string;

  /** What we billed, imported from Tally. */
  billing: TripBilling;

  status: TripStatus;
  cancellationReason: string;
  remarks: string;
  checklistRemarks: string;

  /** Papers attached to this trip — slip, challan, invoice, bilty. */
  attachments: { id: string; name: string; kind: string; file: string }[];

  /**
   * An admin's approval to edit a frozen row, and when it runs out. Held
   * on the trip rather than in a session so it survives a restart and
   * cannot be carried to another row.
   */
  editGrant?: {
    approvedBy: string;
    approvedByName: string;
    approvedAt: string;
    expiresAt: string;
    reason: string;
    requestId: string;
  };

  /** The client's lab report on this supply (GCV, moisture…), when known. */
  lab?: TripLab;

  /**
   * Set when the row came in through the historical data import rather
   * than being typed — so a figure can always be traced back to the
   * spreadsheet and row it came from.
   */
  importSource?: { kind: "data-import"; file: string; sheet: string; row: number; at: string; by: string; byName: string };

  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/** Lab / test report figures for one supply. Zero = not reported. */
export interface TripLab {
  reportNo: string;
  reportDate: string;
  /** Gross calorific value, kcal/kg. */
  gcv: number;
  moisturePct: number;
  ashPct: number;
  volatilePct: number;
  finesPct: number;
}

interface TripFile { trips: Trip[]; updatedAt?: string; }

function tripFile() { return path.join(paths.root, "coordination", "trips.json"); }

export function loadTrips(): Trip[] {
  const f = readJson<TripFile>(tripFile(), { trips: [] });
  return Array.isArray(f.trips) ? f.trips.map(normalise) : [];
}

export function saveTrips(trips: Trip[]): void {
  ensureDir(path.join(paths.root, "coordination"));
  writeJsonAtomic(tripFile(), { trips, updatedAt: new Date().toISOString() });
}

/**
 * Backfills fields added after a record was written.
 *
 * Rows written before document types existed carried one field,
 * `biomeChallanNo`, and every one of them was a delivery challan. They are
 * moved across rather than left blank, because a row with no document
 * number reads as a paperwork gap and would put a false warning on months
 * of history.
 */
function normalise(t: any): Trip {
  const legacyDoc = String(t.biomeChallanNo || "").trim();
  const billing = t.billing && typeof t.billing === "object" ? t.billing : {};
  return {
    ...t,
    business: t.business === "manufacturing" ? "manufacturing" : "trading",
    docType: t.docType === "tax_invoice" ? "tax_invoice" : "delivery_challan",
    seriesId: String(t.seriesId || ""),
    ourDocNo: String(t.ourDocNo || legacyDoc || ""),
    ourDocDate: String(t.ourDocDate || ""),
    ourDocManual: t.ourDocManual === undefined ? Boolean(legacyDoc) : Boolean(t.ourDocManual),
    biomeChallanNo: legacyDoc || String(t.ourDocNo || ""),
    poDate: String(t.poDate || ""),
    referenceNo: String(t.referenceNo || ""),
    plant: String(t.plant || "").toUpperCase(),
    vendorDocType: t.vendorDocType === "tax_invoice" || t.vendorDocType === "delivery_challan" ? t.vendorDocType : "",
    debitNoteNo: String(t.debitNoteNo || ""),
    creditNoteNo: String(t.creditNoteNo || ""),
    billing: {
      invoiceDate: String(billing.invoiceDate || ""),
      invoiceWeightKg: Number(billing.invoiceWeightKg) || 0,
      taxableAmount: Number(billing.taxableAmount) || 0,
      taxAmount: Number(billing.taxAmount) || 0,
      totalAmount: Number(billing.totalAmount) || 0,
      source: String(billing.source || ""),
      importedAt: String(billing.importedAt || ""),
      importedBy: String(billing.importedBy || ""),
    },
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
    ccWeight: Number(t.ccWeight) || 0,
    vendorChallanWeight: Number(t.vendorChallanWeight) || 0,
    receivingQty: Number(t.receivingQty) || 0,
    vendorChallanAmount: Number(t.vendorChallanAmount) || 0,
  } as Trip;
}

/* ------------------------------------------------------------------ */
/* The shortage calculation                                            */
/* ------------------------------------------------------------------ */

/**
 * How much weight a trip may lose before anyone should care.
 *
 * Two things are at work and both are real:
 *   - Every weighbridge disagrees with every other by a little. A flat
 *     percentage covers that.
 *   - **Gangakhed's documents run 400–500 kg above its weighbridge** — a
 *     known, verified quirk of that plant's paperwork, so trips out of
 *     GKD carry an extra allowance. Without it every GKD trip would look
 *     like a shortage and the whole flag would be ignored.
 */
export interface ShortageRules {
  percentAllowance: number;   // of dispatched weight
  flatAllowanceKg: number;    // on top, for weighbridge drift
  gkdExtraKg: number;         // the documented Gangakhed offset
}

export const DEFAULT_SHORTAGE_RULES: ShortageRules = {
  percentAllowance: 0.5,
  flatAllowanceKg: 50,
  gkdExtraKg: 500,
};

export interface ShortageResult {
  dispatched: number;
  received: number;
  /** Positive = received less than dispatched. */
  differenceKg: number;
  differencePct: number;
  allowanceKg: number;
  /** Beyond the allowance — the number worth chasing. */
  excessKg: number;
  verdict: "ok" | "excess" | "shortage" | "pending";
  message: string;
}

function isGangakhed(location: string): boolean {
  return /gangakhed|gkd/i.test(location || "");
}

/**
 * Compare what left with what arrived.
 *
 * Pure — no store, no clock — because this is the number the whole module
 * exists to produce and it has to be testable against their real rows.
 */
export function shortageFor(trip: {
  vendorChallanWeight: number;
  receivingQty: number;
  location?: string;
  status?: TripStatus;
}, rules: ShortageRules = DEFAULT_SHORTAGE_RULES): ShortageResult {
  const dispatched = Number(trip.vendorChallanWeight) || 0;
  const received = Number(trip.receivingQty) || 0;

  if (dispatched <= 0 || received <= 0) {
    return {
      dispatched, received, differenceKg: 0, differencePct: 0,
      allowanceKg: 0, excessKg: 0, verdict: "pending",
      message: received <= 0 ? "Waiting for the receiving weight." : "No dispatch weight recorded.",
    };
  }

  const allowance =
    Math.round(dispatched * (rules.percentAllowance / 100)) +
    rules.flatAllowanceKg +
    (isGangakhed(trip.location || "") ? rules.gkdExtraKg : 0);

  const difference = Math.round((dispatched - received) * 100) / 100;
  const pct = Math.round((difference / dispatched) * 10000) / 100;

  if (difference < 0) {
    // Received MORE than dispatched. Usually a typo, occasionally a real
    // overload, never something to pass silently.
    return {
      dispatched, received, differenceKg: difference, differencePct: pct,
      allowanceKg: allowance, excessKg: 0, verdict: "excess",
      message: `Received ${Math.abs(difference).toLocaleString("en-IN")} kg MORE than dispatched. Check both figures — one of them is usually mistyped.`,
    };
  }

  if (difference <= allowance) {
    return {
      dispatched, received, differenceKg: difference, differencePct: pct,
      allowanceKg: allowance, excessKg: 0, verdict: "ok",
      message: `Within tolerance (${difference.toLocaleString("en-IN")} kg against an allowance of ${allowance.toLocaleString("en-IN")} kg).`,
    };
  }

  const excess = Math.round((difference - allowance) * 100) / 100;
  return {
    dispatched, received, differenceKg: difference, differencePct: pct,
    allowanceKg: allowance, excessKg: excess, verdict: "shortage",
    message: `Short by ${difference.toLocaleString("en-IN")} kg (${pct}%), which is ${excess.toLocaleString("en-IN")} kg beyond the ${allowance.toLocaleString("en-IN")} kg allowance.`,
  };
}

/**
 * The status a trip has earned from its own data.
 *
 * Kept separate from the stored status so the register can flag a row the
 * coordinator marked "accepted" while the weights say otherwise — that
 * disagreement is exactly what a reconciliation is for.
 */
export function derivedStatus(trip: Trip, rules?: ShortageRules): TripStatus {
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "rejected") return "rejected";
  if (!trip.receivingQty) {
    return trip.vehicleNumber && trip.vendorChallanNo ? "dispatched" : "planned";
  }
  const s = shortageFor(trip, rules);
  if (s.verdict === "shortage") return "shortage";
  return trip.status === "accepted" ? "accepted" : "received";
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export interface CoordinationSummary {
  trips: number;
  dispatchedKg: number;
  receivedKg: number;
  shortfallKg: number;
  /** Trips whose shortfall is beyond the allowance. */
  shortageTrips: number;
  pendingReceiving: number;
  cancelled: number;
  rejected: number;
  value: number;
  /** What we actually billed, once Tally figures are in. */
  billedTotal: number;
  billedTrips: number;
  awaitingBilling: number;
}

export function summarise(trips: Trip[], rules?: ShortageRules): CoordinationSummary {
  const live = trips.filter((t) => t.status !== "cancelled");
  let dispatchedKg = 0, receivedKg = 0, shortfallKg = 0, shortageTrips = 0, pendingReceiving = 0, value = 0;
  let billedTotal = 0, billedTrips = 0, awaitingBilling = 0, rejected = 0;

  for (const t of live) {
    dispatchedKg += t.vendorChallanWeight || 0;
    receivedKg += t.receivingQty || 0;
    value += t.vendorChallanAmount || 0;
    if (t.status === "rejected") rejected += 1;
    if (t.billing?.totalAmount) { billedTotal += t.billing.totalAmount; billedTrips += 1; }
    else if (t.ourDocNo) awaitingBilling += 1;
    const s = shortageFor(t, rules);
    if (s.verdict === "pending") pendingReceiving += 1;
    if (s.verdict === "shortage") { shortageTrips += 1; shortfallKg += s.differenceKg; }
  }

  return {
    trips: live.length,
    dispatchedKg, receivedKg, shortfallKg, shortageTrips, pendingReceiving,
    cancelled: trips.length - live.length,
    rejected,
    value,
    billedTotal, billedTrips, awaitingBilling,
  };
}

export interface PartyStat {
  name: string;
  trips: number;
  dispatchedKg: number;
  receivedKg: number;
  shortfallKg: number;
  shortageTrips: number;
  /** Shortfall as a share of what they dispatched — the comparable number. */
  shortfallPct: number;
}

/**
 * Per-supplier or per-client totals.
 *
 * The percentage matters more than the absolute: a supplier who sends
 * twice as much will show twice the shortfall in kilos while being no
 * worse. Sorting on kilos alone would blame the biggest vendor.
 */
export function byParty(trips: Trip[], key: "supplier" | "client", rules?: ShortageRules): PartyStat[] {
  const map = new Map<string, PartyStat>();

  for (const t of trips) {
    if (t.status === "cancelled") continue;
    const name = (t[key] || "").trim() || "—";
    const stat = map.get(name) || {
      name, trips: 0, dispatchedKg: 0, receivedKg: 0, shortfallKg: 0, shortageTrips: 0, shortfallPct: 0,
    };
    stat.trips += 1;
    stat.dispatchedKg += t.vendorChallanWeight || 0;
    stat.receivedKg += t.receivingQty || 0;
    const s = shortageFor(t, rules);
    if (s.verdict === "shortage") { stat.shortageTrips += 1; stat.shortfallKg += s.differenceKg; }
    map.set(name, stat);
  }

  return [...map.values()]
    .map((s) => ({
      ...s,
      shortfallPct: s.dispatchedKg > 0 ? Math.round((s.shortfallKg / s.dispatchedKg) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.shortfallKg - a.shortfallKg);
}

/* ------------------------------------------------------------------ */
/* What is missing from a row                                          */
/* ------------------------------------------------------------------ */

/**
 * Paperwork gaps, which is the other half of coordination: a trip with no
 * challan number cannot be invoiced, and nobody finds out until the client
 * refuses it.
 */
export function gapsFor(trip: Trip): string[] {
  const gaps: string[] = [];
  if (trip.status === "cancelled") {
    if (!trip.cancellationReason.trim()) gaps.push("Cancelled with no reason recorded.");
    return gaps;
  }
  const trading = trip.business !== "manufacturing";

  if (!trip.client.trim()) gaps.push("No client.");
  // A manufacturing row has no vendor by definition, so asking for one
  // would put a permanent warning on every own-material trip.
  if (trading && !trip.supplier.trim()) gaps.push("No supplier.");
  if (!trip.vehicleNumber.trim()) gaps.push("No vehicle number — nothing ties the papers together.");
  if (trading && !trip.vendorChallanNo.trim() && !trip.vendorInvoiceNo.trim()) {
    gaps.push("No vendor challan or invoice number.");
  }
  if (!trip.vendorChallanWeight) gaps.push("No dispatch weight.");
  if (!trip.ourDocNo.trim()) {
    gaps.push(
      trip.docType === "tax_invoice"
        ? "No BIOME invoice number — this cannot be billed."
        : "No BIOME challan number — this cannot be invoiced."
    );
  }
  if (trip.ourDocNo.trim() && !trip.billing.totalAmount && trip.status === "accepted") {
    gaps.push("Accepted, but no billing figures imported from Tally yet.");
  }
  if (trip.receivingQty > 0 && !trip.receivingDate.trim()) gaps.push("Receiving weight recorded with no receiving date.");
  if (!trip.receivingQty && trip.vehicleEntryDate) {
    const days = Math.floor((Date.now() - new Date(trip.vehicleEntryDate + "T00:00:00").getTime()) / 86400000);
    // A truck that left a week ago and has no receiving is either lost or
    // forgotten, and both need chasing today rather than at month end.
    if (days >= 7) gaps.push(`Dispatched ${days} days ago with no receiving weight yet.`);
  }
  return gaps;
}

export function blankTrip(
  serial: number,
  by: { id: string; name: string },
  business: BusinessType = "trading"
): Trip {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    serial,
    business,
    docType: "delivery_challan", seriesId: "", ourDocNo: "", ourDocDate: "", ourDocManual: false,
    client: "", location: "", poNumber: "", poDate: "",
    supplier: "", supplierCode: "", vendorDocType: "",
    vehicleNumber: "", vehicleEntryDate: now.slice(0, 10),
    vendorChallanNo: "", vendorChallanDate: "", vendorInvoiceNo: "",
    vendorChallanWeight: 0, vendorChallanAmount: 0,
    biomeChallanNo: "",
    receivingDate: "", receivingQty: 0, ccWeight: 0,
    debitNoteNo: "", creditNoteNo: "",
    billing: blankBilling(),
    status: "planned",
    cancellationReason: "", remarks: "", checklistRemarks: "",
    attachments: [],
    createdBy: by.id, createdByName: by.name,
    createdAt: now, updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* The freeze                                                          */
/* ------------------------------------------------------------------ */

/**
 * A row freezes one week after the material was unloaded at the client —
 * the receiving date, not the vehicle entry date and not the day the row
 * was typed.
 *
 * That choice matters. Counting from the vehicle's entry would freeze a
 * row that is still waiting for its receiving weight, which is the one
 * thing the coordinator is certain to have to fill in later. Counting from
 * the receiving date starts the clock only once the trip is actually
 * complete, so nothing freezes while it is still live.
 */
export const FREEZE_DAYS = 7;
/** How long an admin's approval stays usable once given. */
export const EDIT_WINDOW_HOURS = 24;

export interface LockState {
  locked: boolean;
  /** The moment it froze, or will freeze. Empty while there is no clock. */
  freezesAt: string;
  daysLeft: number;
  /** An approval currently in force. */
  grantedUntil: string;
  reason: string;
}

function endOfDayUtc(date: string): number {
  return new Date(date + "T00:00:00Z").getTime();
}

/**
 * Pure so it can be tested against real dates, and so the page and the API
 * can never disagree about whether a row is open — the UI greying a field
 * is a courtesy; this is the rule.
 */
export function lockStateFor(
  trip: Pick<Trip, "receivingDate" | "editGrant" | "status">,
  now: Date = new Date(),
  days: number = FREEZE_DAYS
): LockState {
  const grant = trip.editGrant;
  const grantLive = grant ? new Date(grant.expiresAt).getTime() > now.getTime() : false;

  if (!trip.receivingDate || !/^\d{4}-\d{2}-\d{2}$/.test(trip.receivingDate)) {
    return {
      locked: false, freezesAt: "", daysLeft: 0,
      grantedUntil: grantLive ? grant!.expiresAt : "",
      reason: "Not received yet — the week starts when the client unloads.",
    };
  }

  const freezeAt = endOfDayUtc(trip.receivingDate) + days * 86400000;
  const locked = now.getTime() >= freezeAt;
  const daysLeft = Math.max(0, Math.ceil((freezeAt - now.getTime()) / 86400000));

  if (locked && grantLive) {
    return {
      locked: false, freezesAt: new Date(freezeAt).toISOString(), daysLeft: 0,
      grantedUntil: grant!.expiresAt,
      reason: `Open until ${new Date(grant!.expiresAt).toLocaleString("en-IN")} — approved by ${grant!.approvedByName}.`,
    };
  }

  return {
    locked,
    freezesAt: new Date(freezeAt).toISOString(),
    daysLeft,
    grantedUntil: "",
    reason: locked
      ? `Frozen — received on ${trip.receivingDate}, more than ${days} days ago. An admin has to approve any change.`
      : `Freezes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Requests to edit a frozen row                                       */
/* ------------------------------------------------------------------ */

export type EditRequestStatus = "pending" | "approved" | "rejected";

export interface EditRequest {
  id: string;
  tripId: string;
  tripSerial: number;
  tripLabel: string;
  /** What they want to change and why — an admin approving blind is not approving. */
  reason: string;
  fields: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: EditRequestStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  expiresAt?: string;
}

interface RequestFile { requests: EditRequest[]; updatedAt?: string; }

function requestFile() { return path.join(paths.root, "coordination", "edit-requests.json"); }

export function loadEditRequests(): EditRequest[] {
  const f = readJson<RequestFile>(requestFile(), { requests: [] });
  return Array.isArray(f.requests) ? f.requests : [];
}

export function saveEditRequests(requests: EditRequest[]): void {
  ensureDir(path.join(paths.root, "coordination"));
  writeJsonAtomic(requestFile(), { requests, updatedAt: new Date().toISOString() });
}

export function pendingRequestFor(tripId: string): EditRequest | undefined {
  return loadEditRequests().find((r) => r.tripId === tripId && r.status === "pending");
}

/* ------------------------------------------------------------------ */
/* Reading a trip from a request body                                  */
/* ------------------------------------------------------------------ */

function inStr(v: unknown, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}
function inKg(v: unknown): number {
  const kg = toKg(v, { vehicle: true });
  return kg !== null && kg > 0 ? kg : 0;
}
function inNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * The editable fields of a trip, read and cleaned from a request body.
 *
 * Shared by the add/edit API and the historical data import, so an
 * imported row is normalised exactly like one typed into the form —
 * vehicle numbers squeezed, weights in kg ("28.4 MT" → 28,400), no vendor
 * on a manufacturing row.
 */
export function readTripInput(body: any, reg: BusinessType): Partial<Trip> {
  const statuses = TRIP_STATUS.map((s) => s.id) as string[];
  const status = statuses.includes(body.status) ? (body.status as TripStatus) : undefined;
  const docType: DocType = body.docType === "tax_invoice" ? "tax_invoice" : "delivery_challan";
  const out: Partial<Trip> = {
    business: reg,
    docType,
    seriesId: inStr(body.seriesId, 60),
    ourDocDate: inStr(body.ourDocDate, 10),
    client: inStr(body.client), location: inStr(body.location, 60),
    poNumber: inStr(body.poNumber, 60), poDate: inStr(body.poDate, 10),
    vendorPoId: body.vendorPoId ? inStr(body.vendorPoId, 60) : null,
    clientPoId: body.clientPoId ? inStr(body.clientPoId, 60) : null,
    vehicleNumber: inStr(body.vehicleNumber, 20).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    vehicleEntryDate: inStr(body.vehicleEntryDate, 10),
    vendorChallanDate: inStr(body.vendorChallanDate, 10),
    // Weights in kg: "28.4 MT" / "284 qtl" / a bare 28.4 are converted.
    vendorChallanWeight: inKg(body.vendorChallanWeight),
    vendorChallanAmount: inNum(body.vendorChallanAmount),
    referenceNo: inStr(body.referenceNo, 40).toUpperCase().replace(/\s+/g, ""),
    receivingDate: inStr(body.receivingDate, 10),
    receivingQty: inKg(body.receivingQty),
    ccWeight: inKg(body.ccWeight),
    debitNoteNo: inStr(body.debitNoteNo, 40),
    creditNoteNo: inStr(body.creditNoteNo, 40),
    cancellationReason: inStr(body.cancellationReason, 300),
    remarks: inStr(body.remarks, 400),
    checklistRemarks: inStr(body.checklistRemarks, 400),
  };

  // Manufacturing is our own material. Carrying a vendor here would put a
  // supplier's name on a supply they had nothing to do with — and it would
  // land in the per-supplier shortfall table, which is read as blame.
  if (reg === "manufacturing") {
    out.plant = inStr(body.plant, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    out.supplier = "";
    out.supplierCode = "";
    out.vendorDocType = "";
    out.vendorChallanNo = "";
    out.vendorInvoiceNo = "";
  } else {
    out.supplier = inStr(body.supplier);
    out.supplierCode = inStr(body.supplierCode, 20).toUpperCase();
    out.vendorDocType = body.vendorDocType === "tax_invoice" || body.vendorDocType === "delivery_challan" ? body.vendorDocType : "";
    out.vendorChallanNo = inStr(body.vendorChallanNo, 40);
    out.vendorInvoiceNo = inStr(body.vendorInvoiceNo, 40);
  }

  if (status) out.status = status;
  return out;
}
