/**
 * Plant dispatch ↔ coordination manufacturing register — vehicle match
 * -------------------------------------------------------------------
 * The plant manager keeps a transport sheet: every vehicle that leaves the
 * plant with our material. The coordination team keeps the manufacturing
 * register: every supply from a plant to a client. Both are about the SAME
 * trucks, and neither side should read the other's book.
 *
 * So this module compares them on the server and hands each side only a
 * verdict about ITS OWN rows:
 *
 *   matched          same plant, same vehicle, dates within the window,
 *                    and (where both carry one) weights within tolerance
 *   weight_differs   the vehicle and date match but the weights do not
 *   unmatched        nothing on the other side
 *
 * The plant manager learns "this dispatch is / is not in coordination";
 * the coordinator learns "this trip is / is not in the plant's dispatch
 * sheet". Neither sees the other's figures. Accounts / admin / developer
 * get the full side-by-side, because they may read both books anyway.
 */

import path from "path";
import { paths, readJson } from "@/lib/dataRoot";
import { loadTrips, Trip } from "@/lib/coordination";
import { loadPlants } from "@/lib/plants";
import { slugForCode } from "@/lib/plantRegistry";

export type MatchStatus = "matched" | "weight_differs" | "unmatched";

/**
 * Days either side that still count as the same trip. Two, because the
 * plant writes the day the truck left while the coordinator may write the
 * vehicle-entry date or our invoice date — a late-evening dispatch is
 * routinely invoiced the next morning.
 */
export const DATE_WINDOW_DAYS = 2;
/** Weight tolerance: the larger of this share or the flat kg allowance. */
const WEIGHT_PCT = 1.0;
const WEIGHT_FLAT_KG = 100;



export function normVehicle(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The key the plant sheet uses for a row — computable on the client from the row itself. */
export function plantRowKey(date: string, vehicle: string): string {
  return `${String(date || "").slice(0, 10)}|${normVehicle(vehicle)}`;
}

function days(a: string, b: string): number {
  return Math.abs((new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000);
}

/** Bring both weights to kg: a plant sheet in MT (e.g. 28.4) against a register in kg (28,400). */
function toKg(n: number): number {
  return n > 0 && n < 200 ? n * 1000 : n;
}

export interface PlantDispatch {
  key: string;
  plant: string;
  date: string;
  vehicle: string;
  vehicleRaw: string;
  party: string;
  to: string;
  weightKg: number;
  /** Receiving weight at the client (R. Weight), when the plant has it. */
  rWeightKg: number;
  purpose: string;
}

export function loadPlantDispatches(plantCodes: string[]): PlantDispatch[] {
  const out: PlantDispatch[] = [];
  for (const code of plantCodes) {
    const slug = slugForCode(code);
    if (!slug) continue;
    const f = readJson<{ rows?: any[] }>(path.join(paths.configDir, "plants", `${slug}-transport.json`), {});
    for (const r of Array.isArray(f.rows) ? f.rows : []) {
      const purpose = String(r.tripPurpose || "").trim();
      // Machine repairs and errands are not supplies — they would never be in the register.
      if (purpose && !/^supply$/i.test(purpose)) continue;
      const vehicle = normVehicle(r.vehicleNo);
      const date = String(r.date || "").slice(0, 10);
      if (!vehicle || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        key: plantRowKey(date, r.vehicleNo), plant: code, date, vehicle, vehicleRaw: String(r.vehicleNo || ""),
        party: String(r.partyName || ""), to: String(r.to || ""), weightKg: toKg(Number(r.weight) || 0),
        rWeightKg: toKg(Number(r.rWeight) || 0), purpose,
      });
    }
  }
  return out;
}

/**
 * Which plant a manufacturing trip left from.
 *
 *   1. the "From plant" chosen on the trip;
 *   2. the plant code inside its reference (BDC/45/REW/15);
 *   3. older rows: a plant named in the location text.
 *
 * Null when none of these says — the match then finds the plant from the
 * vehicle itself (the plant whose transport sheet has that truck that day).
 */
export function tripPlant(t: Trip): string | null {
  const plants = loadPlants();
  const codes = new Set(plants.map((p) => p.code.toUpperCase()));
  const chosen = String((t as any).plant || "").toUpperCase();
  if (chosen && codes.has(chosen)) return chosen;
  const parts = String(t.referenceNo || "").toUpperCase().split(/[\/\\|]/).map((x) => x.trim());
  if (parts.length === 4 && codes.has(parts[2].replace(/[^A-Z0-9]/g, ""))) return parts[2].replace(/[^A-Z0-9]/g, "");
  const loc = String(t.location || "").toUpperCase();
  for (const p of plants) {
    if (new RegExp(`\\b${p.code.toUpperCase()}\\b`).test(loc) || (p.label && loc.includes(p.label.toUpperCase()))) return p.code;
  }
  return null;
}

export interface MatchPair {
  plantKey: string | null;
  tripId: string | null;
  plant: string;
  status: MatchStatus;
  dispatch: PlantDispatch | null;
  trip: { id: string; serial: number; date: string; vehicle: string; client: string; location: string; weightKg: number; ourDocNo: string } | null;
  weightDiffKg: number | null;
}

/**
 * One-to-one match: for each plant dispatch, the closest-dated unused trip
 * with the same vehicle inside the window — same plant when the trip names
 * one; a trip whose plant is unknown is matched by the vehicle alone and
 * takes the dispatch's plant.
 *
 * Weights: the plant's dispatch weight against our invoice weight (or the
 * challan weight on the trip), and the plant's R. Weight against the
 * trip's receiving quantity — both within the tolerance.
 */
export function matchAll(plantCodes: string[]): MatchPair[] {
  const dispatches = loadPlantDispatches(plantCodes).sort((a, b) => a.date.localeCompare(b.date));
  const isoDate = (v: unknown) => {
    const x = String(v || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "";
  };
  const trips = loadTrips()
    .filter((t) => t.business === "manufacturing" && t.status !== "cancelled")
    .map((t) => {
      const dates = [isoDate(t.vehicleEntryDate), isoDate(t.ourDocDate), isoDate(t.billing?.invoiceDate)].filter(Boolean);
      return { t, plant: tripPlant(t), dates, date: dates[0] || "", vehicle: normVehicle(t.vehicleNumber) };
    })
    .filter((x) => x.vehicle && x.dates.length && (x.plant === null || plantCodes.includes(x.plant)));

  const gap = (x: (typeof trips)[number], d: string) => Math.min(...x.dates.map((td) => days(td, d)));

  const used = new Set<string>();
  const pairs: MatchPair[] = [];
  const tripView = (x: (typeof trips)[number]) => ({
    id: x.t.id, serial: x.t.serial, date: x.date, vehicle: x.t.vehicleNumber, client: x.t.client,
    location: x.t.location,
    weightKg: toKg(Number(x.t.billing?.invoiceWeightKg) || Number(x.t.vendorChallanWeight) || 0),
    ourDocNo: x.t.ourDocNo,
  });
  const allow = (kg: number) => Math.max(WEIGHT_FLAT_KG, (kg * WEIGHT_PCT) / 100);

  for (const d of dispatches) {
    const candidates = trips
      .filter((x) => !used.has(x.t.id) && x.vehicle === d.vehicle && (x.plant === null || x.plant === d.plant) && gap(x, d.date) <= DATE_WINDOW_DAYS)
      // A trip that names this plant beats one that names none; then the closest date.
      .sort((a, b) => (a.plant ? 0 : 1) - (b.plant ? 0 : 1) || gap(a, d.date) - gap(b, d.date));
    const hit = candidates[0];
    if (!hit) {
      pairs.push({ plantKey: d.key, tripId: null, plant: d.plant, status: "unmatched", dispatch: d, trip: null, weightDiffKg: null });
      continue;
    }
    used.add(hit.t.id);
    const tv = tripView(hit);
    let status: MatchStatus = "matched";
    let diff: number | null = null;
    if (d.weightKg > 0 && tv.weightKg > 0) {
      diff = Math.round(tv.weightKg - d.weightKg);
      if (Math.abs(diff) > allow(d.weightKg)) status = "weight_differs";
    }
    const recv = toKg(Number(hit.t.receivingQty) || 0);
    if (d.rWeightKg > 0 && recv > 0 && Math.abs(recv - d.rWeightKg) > allow(d.rWeightKg)) {
      status = "weight_differs";
      if (diff === null) diff = Math.round(recv - d.rWeightKg);
    }
    pairs.push({ plantKey: d.key, tripId: hit.t.id, plant: d.plant, status, dispatch: d, trip: tv, weightDiffKg: diff });
  }
  for (const x of trips) {
    if (used.has(x.t.id)) continue;
    pairs.push({ plantKey: null, tripId: x.t.id, plant: x.plant || "", status: "unmatched", dispatch: null, trip: tripView(x), weightDiffKg: null });
  }
  return pairs;
}

export function summarise(pairs: MatchPair[]) {
  return {
    matched: pairs.filter((p) => p.status === "matched").length,
    weightDiffers: pairs.filter((p) => p.status === "weight_differs").length,
    onlyInPlant: pairs.filter((p) => p.status === "unmatched" && p.dispatch).length,
    onlyInCoordination: pairs.filter((p) => p.status === "unmatched" && p.trip).length,
  };
}
