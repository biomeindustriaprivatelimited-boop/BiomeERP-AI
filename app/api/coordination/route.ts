import { toKg } from "@/lib/units";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, readJson } from "@/lib/dataRoot";
import { Client, Vendor } from "@/lib/whatsapp";
import { checkConsumption, loadPoFile, savePoFile, vendorQtyOf, clientQtyOf } from "@/lib/po";
import {
  loadTrips, saveTrips, blankTrip, shortageFor, derivedStatus, summarise,
  byParty, gapsFor, lockStateFor, pendingRequestFor, loadEditRequests,
  TRIP_STATUS, DEFAULT_SHORTAGE_RULES, FREEZE_DAYS, Trip, TripStatus,
} from "@/lib/coordination";
import {
  issueNumber, voidNumber, numberClash, registerManualNumber, seriesById, methodOf,
  previewNext, loadSeriesFile, BUSINESS_TYPES, DOC_TYPES, BusinessType, DocType,
} from "@/lib/numberSeries";
import { recordAudit } from "@/lib/audit";
import { isOverrideActive, recordOverrideUse, lockedMessage } from "@/lib/override";
import { devStamp } from "@/lib/devEdit";
import { agentFetch } from "@/lib/whatsappAgent";

/**
 * A saved trip is a matching anchor for WhatsApp paperwork: ask the agent
 * to file any vendor document that was waiting for this reference. Fire
 * and forget — a stopped agent must never fail a save, and it sweeps on
 * its own every 20 minutes anyway.
 */
function pokeAgentSweep() {
  agentFetch("/staged/sweep", { method: "POST", timeoutMs: 15000 }).catch(() => { /* agent off */ });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = TRIP_STATUS.map((s) => s.id);

function kgOf(v: unknown): number {
  const kg = toKg(v, { vehicle: true });
  return kg !== null && kg > 0 ? kg : 0;
}

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function str(v: unknown, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}
function business(v: unknown): BusinessType {
  return v === "manufacturing" ? "manufacturing" : "trading";
}
function docTypeOf(v: unknown, fallback: DocType = "delivery_challan"): DocType {
  return v === "tax_invoice" ? "tax_invoice" : v === "delivery_challan" ? "delivery_challan" : fallback;
}

function loadClients(): Client[] {
  const f = readJson<{ clients: Client[] }>(paths.clientsFile, { clients: [] });
  return Array.isArray(f.clients) ? f.clients : [];
}
function loadVendors(): Vendor[] {
  const f = readJson<{ vendors: Vendor[] }>(paths.vendorsFile, { vendors: [] });
  return Array.isArray(f.vendors) ? f.vendors : [];
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const all = loadTrips();
  const p = req.nextUrl.searchParams;
  const now = new Date();

  // The register is chosen first and everything else narrows within it —
  // trading and manufacturing are two different conversations, and mixing
  // them was the point of the request to split them.
  const reg = business(p.get("business"));
  let trips = all.filter((t) => t.business === reg);

  // The two registers belong to two different people, and each must not
  // see the other's book. A coordinator runs trading; a plant manager runs
  // their own site's manufacturing. Enforced here rather than in the page,
  // so the rule holds for anyone calling the API directly.
  // The coordination team keeps BOTH registers: trading, and the
  // manufacturing sheet of supplies leaving our plants. The plant
  // manager's own dispatch (transport) sheet is a separate book; the two
  // are compared by /api/plant-match, which hands each side only a
  // matched / not-matched verdict — never the other side's figures.
  if (user.role === "plant_manager") {
    if (reg !== "manufacturing") {
      return NextResponse.json(
        { error: "The trading register belongs to the coordinators. A plant manager sees their own site's manufacturing register.", trips: [] },
        { status: 403 }
      );
    }
    // And only their own site within it.
    const myPlant = auth.session.plant;
    if (myPlant) trips = trips.filter((t) => (t.location || "").toUpperCase().includes(myPlant.toUpperCase()));
  }

  const month = p.get("month");
  const client = p.get("client");
  const supplier = p.get("supplier");
  const location = p.get("location");
  const status = p.get("status");
  const doc = p.get("docType");
  const search = (p.get("search") || "").trim().toLowerCase();

  // The date a trip belongs to is when the vehicle left, not when the
  // paperwork caught up — a challan entered late still belongs to its month.
  if (month) trips = trips.filter((t) => (t.vehicleEntryDate || "").slice(0, 7) === month);
  if (client) trips = trips.filter((t) => t.client === client);
  if (supplier) trips = trips.filter((t) => t.supplier === supplier);
  if (location) trips = trips.filter((t) => t.location === location);
  if (doc && doc !== "all") trips = trips.filter((t) => t.docType === doc);
  if (status && status !== "all") {
    trips = trips.filter((t) => (status === "shortage" ? shortageFor(t).verdict === "shortage" : derivedStatus(t) === status));
  }
  if (search) {
    trips = trips.filter((t) =>
      [t.client, t.supplier, t.vehicleNumber, t.vendorChallanNo, t.ourDocNo, t.poNumber, t.vendorInvoiceNo]
        .join(" ").toLowerCase().includes(search)
    );
  }

  const requests = loadEditRequests();

  const enriched = trips
    .map((t) => {
      const pending = requests.find((r) => r.tripId === t.id && r.status === "pending");
      return {
        ...t,
        shortage: shortageFor(t),
        derived: derivedStatus(t),
        gaps: gapsFor(t),
        lock: lockStateFor(t, now),
        pendingRequest: pending ? { id: pending.id, by: pending.requestedByName, at: pending.requestedAt } : null,
      };
    })
    .sort((a, b) => (b.vehicleEntryDate || "").localeCompare(a.vehicleEntryDate || "") || b.serial - a.serial);

  const clients = loadClients();
  const vendors = loadVendors().filter((v) => v.active !== false);
  const seriesAll = loadSeriesFile().series.filter((s) => s.active);

  return NextResponse.json({
    business: reg,
    trips: enriched,
    summary: summarise(trips),
    bySupplier: byParty(trips, "supplier").slice(0, 12),
    byClient: byParty(trips, "client").slice(0, 12),
    statuses: TRIP_STATUS,
    docTypes: DOC_TYPES,
    businesses: BUSINESS_TYPES,
    rules: DEFAULT_SHORTAGE_RULES,
    freezeDays: FREEZE_DAYS,
    pendingRequests: requests.filter((r) => r.status === "pending").length,
    series: seriesAll.map((s) => ({
      id: s.id, name: s.name, docType: s.docType, business: s.business,
      pattern: s.pattern, clientHints: s.clientHints, next: previewNext(s),
    })),
    // Masters lead the pickers. Names that only exist in old rows are kept
    // separately so a historic entry never vanishes from the filters, but
    // nobody picks one by accident when adding something new.
    options: {
      clients: clients.map((c) => ({
        name: c.name,
        shortName: c.shortName,
        needsSetup: !(c.requires || []).length,
        poNumbers: (c.poNumbers || []).filter((po) => po.active !== false),
      })),
      vendors: vendors.map((v) => ({ code: v.code, name: v.name, supplyType: v.supplyType })),
      unlistedClients: [...new Set(all.map((t) => t.client).filter(Boolean))]
        .filter((n) => !clients.some((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase()))
        .sort(),
      unlistedSuppliers: [...new Set(all.map((t) => t.supplier).filter(Boolean))]
        .filter((n) => !vendors.some((v) => v.name.trim().toLowerCase() === n.trim().toLowerCase()))
        .sort(),
      locations: [...new Set(all.map((t) => t.location).filter(Boolean))].sort(),
      months: [...new Set(all.map((t) => (t.vehicleEntryDate || "").slice(0, 7)).filter(Boolean))].sort().reverse(),
    },
    canEdit: hasPermission(user.role, "vendors"),
    canApprove: hasPermission(user.role, "users"),
    canManageSeries: hasPermission(user.role, "settings"),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const reg = business(body.business);
  const all = loadTrips();
  // Serials run per register, so trading #412 and manufacturing #7 are both
  // sensible things to say out loud.
  const serial = all.filter((t) => t.business === reg).reduce((m, t) => Math.max(m, t.serial), 0) + 1;
  const trip: Trip = { ...blankTrip(serial, { id: user.id, name: user.name }, reg), ...readTrip(body, reg) };
  const guard = poGuard(trip, null, Boolean(body.poOverride) && hasPermission(user.role, "finance"));
  if (guard) return NextResponse.json({ error: guard.error, poWarning: true }, { status: guard.status });

  if (!trip.client) return NextResponse.json({ error: "A trip needs a client." }, { status: 400 });
  if (reg === "trading" && !trip.supplier) {
    return NextResponse.json(
      { error: "A trading trip needs a supplier. Use the Manufacturing register for our own material." },
      { status: 400 }
    );
  }

  // Two rows for one challan is how a supply gets counted twice.
  if (trip.vendorChallanNo) {
    const clash = all.find(
      (t) => t.vendorChallanNo && t.vendorChallanNo.toLowerCase() === trip.vendorChallanNo.toLowerCase() && t.supplier === trip.supplier
    );
    if (clash) {
      return NextResponse.json(
        { error: `Challan ${trip.vendorChallanNo} from ${trip.supplier} is already entered as trip #${clash.serial}.` },
        { status: 409 }
      );
    }
  }

  const assigned = assignDocumentNumber(trip, body, user);
  if (assigned.error) return NextResponse.json({ error: assigned.error }, { status: assigned.status || 400 });

  saveTrips([...all, trip]);

  pokeAgentSweep();
  recordAudit({
    action: "COORDINATION_TRIP_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "trip", targetId: trip.id,
    targetLabel: `#${trip.serial} ${trip.vehicleNumber || ""}`.trim(),
    detail: `${reg} · ${trip.supplier || "BIOME"} → ${trip.client}${trip.ourDocNo ? ` · ${trip.ourDocNo}` : ""}${
      trip.vendorChallanWeight ? ` · ${trip.vendorChallanWeight} kg` : ""
    }`,
  });

  return NextResponse.json({ trip, shortage: shortageFor(trip) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which trip?" }, { status: 400 });

  const all = loadTrips();
  const existing = all.find((t) => t.id === body.id);
  if (!existing) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const isAdmin = hasPermission(user.role, "users");
  // An admin is no longer waved through a frozen row simply for being an
  // admin. They turn Override on, with a reason — otherwise the freeze that
  // everyone else obeys is decorative for the one person most likely to be
  // asked to change something.
  const overriding = isAdmin && isOverrideActive(user.id);
  const lock = lockStateFor(existing);

  // The freeze is enforced here, not in the browser. A greyed-out field is
  // a courtesy; this is the rule, and it is the only one that survives a
  // hand-written request.
  if (lock.locked && !overriding) {
    const pending = pendingRequestFor(existing.id);
    return NextResponse.json(
      {
        error: isAdmin
          ? lockedMessage(`Trip #${existing.serial} froze ${FREEZE_DAYS} days after the client received the material.`)
          : pending
          ? `This entry is frozen and your request is still with an admin (raised ${pending.requestedAt.slice(0, 10)}).`
          : `This entry froze ${FREEZE_DAYS} days after the client received the material. Ask an admin to open it.`,
        locked: true,
        canRequest: !isAdmin && !pending,
        needsOverride: isAdmin,
      },
      { status: 423 }
    );
  }

  const reg = existing.business;
  const updated: Trip = devStamp({ ...existing, ...readTrip(body, reg), updatedAt: new Date().toISOString() }, existing, { name: user.name, role: user.role }, body.devNote);
  const guard = poGuard(updated, existing, Boolean(body.poOverride) && hasPermission(user.role, "finance"));
  if (guard) return NextResponse.json({ error: guard.error, poWarning: true }, { status: guard.status });

  // A cancellation with no reason tells nobody anything three months later.
  if ((updated.status === "cancelled" || updated.status === "rejected") && !updated.cancellationReason.trim()) {
    return NextResponse.json(
      { error: `Give a reason for the ${updated.status === "rejected" ? "rejection" : "cancellation"}.` },
      { status: 400 }
    );
  }

  const assigned = assignDocumentNumber(updated, body, user);
  if (assigned.error) return NextResponse.json({ error: assigned.error }, { status: assigned.status || 400 });

  // A cancelled trip keeps its number — the book must not develop a hole —
  // but the number is marked, so anyone reading the register knows why it
  // carries no supply.
  if (updated.status === "cancelled" && existing.status !== "cancelled" && updated.ourDocNo) {
    voidNumber(updated.ourDocNo, updated.cancellationReason || "Trip cancelled.");
  }

  const before = shortageFor(existing);
  const after = shortageFor(updated);

  // An approval is spent once it has been used. An unlock that stays open
  // is an unlock nobody remembers granting.
  const usedGrant = Boolean(lock.grantedUntil) && !overriding;
  if (usedGrant) delete updated.editGrant;

  saveTrips(all.map((t) => (t.id === updated.id ? updated : t)));

  pokeAgentSweep();

  if (lock.locked && overriding) {
    recordOverrideUse(user, {
      targetType: "trip", targetId: updated.id,
      targetLabel: `#${updated.serial} ${updated.vehicleNumber}`,
      detail: "Edited a frozen coordination entry.",
    });
  } else if (usedGrant) {
    recordAudit({
      action: "COORDINATION_APPROVED_EDIT_USED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "trip", targetId: updated.id, targetLabel: `#${updated.serial} ${updated.vehicleNumber}`,
      detail: `Used the approval from ${existing.editGrant?.approvedByName || "an admin"}.`,
    });
  }

  // A shortage appearing is worth its own line in the log — that is the
  // moment somebody should have chased it.
  if (after.verdict === "shortage" && before.verdict !== "shortage") {
    recordAudit({
      action: "COORDINATION_SHORTAGE_FOUND",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "trip", targetId: updated.id,
      targetLabel: `#${updated.serial} ${updated.vehicleNumber}`,
      detail: `${updated.supplier} → ${updated.client}: ${after.message}`,
    });
  } else {
    recordAudit({
      action: "COORDINATION_TRIP_UPDATED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "trip", targetId: updated.id,
      targetLabel: `#${updated.serial} ${updated.vehicleNumber}`,
    });
  }

  return NextResponse.json({ trip: updated, shortage: after, lock: lockStateFor(updated) });
}

/* ------------------------------------------------------------------ */

/**
 * Give the trip its document number, from a series or by hand.
 *
 * Mutates `trip`, which is the honest shape here: issuing a number has a
 * side effect on the series file, so pretending it were pure would hide
 * the one thing about it worth knowing.
 */
function assignDocumentNumber(
  trip: Trip,
  body: any,
  user: { id: string; name: string }
): { error?: string; status?: number } {
  let typed = str(body.ourDocNo, 60);
  const series = trip.seriesId ? seriesById(trip.seriesId) : undefined;
  const method = methodOf(series);

  // Re-number: the document type or book changed after a number was taken.
  // The old number is voided (it stays in the register, never reused) and
  // the next one comes from the chosen series — Tally's "change voucher type".
  if (body.reissue === true && trip.ourDocNo) {
    if (!trip.seriesId) return { error: "Pick the number series to re-number from." };
    voidNumber(trip.ourDocNo, `Re-numbered by ${user.name} into ${series?.name || trip.seriesId}`);
    trip.ourDocNo = "";
    trip.biomeChallanNo = "";
    typed = "";
    body.issueNumber = true;
  } else if (method === "automatic" && typed && typed !== trip.ourDocNo && !body.adminOverride) {
    return { error: `"${series?.name}" numbers automatically — the number cannot be typed. An admin can change the series to allow manual override.`, status: 400 };
  }
  if (method === "manual" && !typed && !trip.ourDocNo && body.issueNumber === true) {
    return { error: `"${series?.name}" is a manual series — type the document number.`, status: 400 };
  }

  if (typed && typed !== trip.ourDocNo) {
    const clash = numberClash(typed, trip.id);
    if (clash) {
      return {
        error: `${typed} is already on another entry (recorded ${clash.at.slice(0, 10)} by ${clash.byName}).`,
        status: 409,
      };
    }
    trip.ourDocNo = typed;
    trip.biomeChallanNo = typed;
    trip.ourDocManual = true;
    registerManualNumber(typed, { tripId: trip.id, by: user.id, byName: user.name, seriesId: trip.seriesId });
    return {};
  }
  if (typed) {
    trip.ourDocNo = typed;
    trip.biomeChallanNo = typed;
    return {};
  }

  // Nothing typed and nothing issued yet: take the next number from the
  // chosen book — but only when asked. Numbering a row that is still being
  // drafted burns a serial that can never be reused.
  if (!trip.ourDocNo && body.issueNumber === true) {
    if (!trip.seriesId) return { error: "Pick which number series this document comes from." };
    const result = issueNumber(trip.seriesId, {
      tripId: trip.id, by: user.id, byName: user.name,
      date: trip.ourDocDate || trip.vehicleEntryDate,
    });
    if (!result.ok) return { error: result.error, status: 409 };
    trip.ourDocNo = result.number!;
    trip.biomeChallanNo = result.number!;
    trip.ourDocManual = false;
    if (!trip.ourDocDate) trip.ourDocDate = trip.vehicleEntryDate || new Date().toISOString().slice(0, 10);
  }
  return {};
}

/**
 * PO over-consumption policy. Computed against the live balance, minus
 * this trip's own current contribution when editing, so a re-save of an
 * unchanged trip never counts itself twice.
 */
function poGuard(trip: Trip, existing: Trip | null, override: boolean): { error: string; status: number } | null {
  const cfg = loadPoFile().config;
  for (const [key, qty] of [["vendorPoId", vendorQtyOf(trip)], ["clientPoId", clientQtyOf(trip)]] as const) {
    const poId = (trip as any)[key];
    if (!poId) continue;
    const own = existing && (existing as any)[key] === poId ? (key === "vendorPoId" ? vendorQtyOf(existing) : clientQtyOf(existing)) : 0;
    const check = checkConsumption(poId, Math.max(0, qty - own));
    if (check.ok) continue;
    if ("error" in check) return { error: check.error, status: 400 };
    const msg = `PO BALANCE WARNING — ${check.po.partyName} ${check.po.poNumber}: remaining ${Math.round(check.remainingKg).toLocaleString("en-IN")} kg, this supply exceeds it by ${Math.round(check.exceedsKg).toLocaleString("en-IN")} kg.`;
    if (cfg.overConsumption === "block") return { error: `${msg} Creation is blocked (Admin setting).`, status: 409 };
    if (cfg.overConsumption === "approve" && !override) return { error: `${msg} Needs manager approval — re-submit with override after approval.`, status: 409 };
    // "exception" (or approved override): allowed, recorded as a high-risk exception on the PO.
    const f = loadPoFile(); const po = f.pos.find((p) => p.id === poId);
    if (po) { po.adjustments.push({ at: new Date().toISOString(), byId: "system", byName: "Coordination", field: "over-consumption", oldValue: String(Math.round(check.remainingKg)), newValue: String(Math.round(qty)), reason: override ? "manager override" : "allowed as exception (Admin setting)" }); savePoFile(f); }
  }
  return null;
}
function readTrip(body: any, reg: BusinessType): Partial<Trip> {
  const status = STATUSES.includes(body.status) ? (body.status as TripStatus) : undefined;
  const out: Partial<Trip> = {
    business: reg,
    docType: docTypeOf(body.docType),
    seriesId: str(body.seriesId, 60),
    ourDocDate: str(body.ourDocDate, 10),
    client: str(body.client), location: str(body.location, 60),
    poNumber: str(body.poNumber, 60), poDate: str(body.poDate, 10),
    vendorPoId: body.vendorPoId ? str(body.vendorPoId, 60) : null,
    clientPoId: body.clientPoId ? str(body.clientPoId, 60) : null,
    vehicleNumber: str(body.vehicleNumber, 20).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    vehicleEntryDate: str(body.vehicleEntryDate, 10),
    vendorChallanDate: str(body.vendorChallanDate, 10),
    // Weights in kg: "28.4 MT" / "284 qtl" / a bare 28.4 are converted.
    vendorChallanWeight: kgOf(body.vendorChallanWeight),
    vendorChallanAmount: num(body.vendorChallanAmount),
    referenceNo: str(body.referenceNo, 40).toUpperCase().replace(/\s+/g, ""),
    receivingDate: str(body.receivingDate, 10),
    receivingQty: kgOf(body.receivingQty),
    ccWeight: kgOf(body.ccWeight),
    debitNoteNo: str(body.debitNoteNo, 40),
    creditNoteNo: str(body.creditNoteNo, 40),
    cancellationReason: str(body.cancellationReason, 300),
    remarks: str(body.remarks, 400),
    checklistRemarks: str(body.checklistRemarks, 400),
  };

  // Manufacturing is our own material. Carrying a vendor here would put a
  // supplier's name on a supply they had nothing to do with — and it would
  // land in the per-supplier shortfall table, which is read as blame.
  if (reg === "manufacturing") {
    out.supplier = "";
    out.supplierCode = "";
    out.vendorDocType = "";
    out.vendorChallanNo = "";
    out.vendorInvoiceNo = "";
  } else {
    out.supplier = str(body.supplier);
    out.supplierCode = str(body.supplierCode, 20).toUpperCase();
    out.vendorDocType = body.vendorDocType === "tax_invoice" || body.vendorDocType === "delivery_challan" ? body.vendorDocType : "";
    out.vendorChallanNo = str(body.vendorChallanNo, 40);
    out.vendorInvoiceNo = str(body.vendorInvoiceNo, 40);
  }

  if (status) out.status = status;
  return out;
}
