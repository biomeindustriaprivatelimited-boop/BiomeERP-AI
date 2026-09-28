/**
 * Weights — everything is stored in KILOGRAMS.
 * -------------------------------------------------------------------
 * A weighbridge slip, a challan or a person may give a weight in kg,
 * quintal or metric tonne. The app keeps one unit so totals, matching and
 * reports never mix them:
 *
 *   "28,400" / "28400 kg"      → 28,400 kg
 *   "284 qtl" / "284 quintal"  → 28,400 kg   (1 quintal = 100 kg)
 *   "28.4 MT" / "28.4 ton"     → 28,400 kg   (1 tonne = 1,000 kg)
 *   "28.4" (a vehicle weight)  → 28,400 kg   — no truck load is under 100 kg,
 *                                 so a bare figure below 100 is tonnes
 *
 * A bare figure is never read as quintals — that guess would be wrong as
 * often as right. Write "qtl" and it converts.
 *
 * Shared by the browser (on leaving a cell) and the server (on saving),
 * so nothing here touches Node.
 */

export type WeightUnit = "kg" | "qtl" | "mt";

const UNIT_RE = /^\s*(-?[\d,]*\.?\d+)\s*(kgs?|kilo(?:gram)?s?|q|qtls?|quintals?|mt|mts|t|tons?|tonnes?|m\.?\s*t\.?)?\s*$/i;

export function unitOf(u: string | undefined): WeightUnit | null {
  if (!u) return null;
  const s = u.toLowerCase().replace(/[\s.]/g, "");
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(s)) return "kg";
  if (/^(q|qtl|qtls|quintal|quintals)$/.test(s)) return "qtl";
  if (/^(mt|mts|t|ton|tons|tonne|tonnes)$/.test(s)) return "mt";
  return null;
}

export const FACTOR: Record<WeightUnit, number> = { kg: 1, qtl: 100, mt: 1000 };

/**
 * Read a weight as kg. `vehicle` turns on the bare-figure rule (a load
 * under 100 is tonnes). Returns null for something that is not a weight.
 */
export function toKg(v: unknown, opts: { vehicle?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return opts.vehicle && v > 0 && v < 100 ? round(v * 1000) : v;
  }
  const m = String(v).match(UNIT_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = unitOf(m[2]);
  if (unit) return round(n * FACTOR[unit]);
  return opts.vehicle && n > 0 && n < 100 ? round(n * 1000) : n;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** "28.4 MT → 28,400 kg" when a conversion happened, else null. */
export function conversionNote(raw: unknown, kg: number | null): string | null {
  if (kg === null) return null;
  const s = String(raw ?? "").trim();
  if (!s || Number(s.replace(/,/g, "")) === kg) return null;
  return `${s} → ${kg.toLocaleString("en-IN")} kg`;
}

/** Sheet columns that hold a vehicle / load weight. */
export const SHEET_WEIGHT_KEYS = ["grossWeight", "tareWeight", "finalWeight", "weight", "rWeight"];

/** Bring every weight field of a sheet row to kg (server side, on save). */
export function normaliseRowWeights<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = { ...row };
  for (const k of SHEET_WEIGHT_KEYS) {
    if (out[k] === undefined || out[k] === "" || out[k] === null) continue;
    const kg = toKg(out[k], { vehicle: true });
    if (kg !== null) out[k] = kg;
  }
  return out as T;
}
