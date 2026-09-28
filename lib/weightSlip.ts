/**
 * Biome Platform — weight slip reading and cross-check
 * -------------------------------------------------------------------
 * A weighbridge slip is a small, rigid document: a vehicle number, three
 * weights and a party name. That rigidity is what makes it worth checking
 * automatically — if the sheet says 42,330 and the slip says 42,530, one
 * of the two is wrong, and today nobody finds out until accounts
 * reconciles weeks later.
 *
 * The parser is deliberately pure text-in, fields-out: no OCR engine, no
 * file system. The engine is swapped in by the route, and this can be
 * tested against the exact strings their weighbridges print.
 *
 * IMPORTANT: net is NOT recomputed from gross − tare when the slip prints
 * its own net. If a weighbridge prints three figures that don't agree,
 * that is itself the finding, and silently fixing it would hide it.
 */

import { toKg } from "@/lib/units";

export interface WeightSlipFields {
  vehicleNo: string | null;
  slipNo: string | null;
  partyName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  date: string | null;
  /** Everything the parser could not place, kept for the reviewer. */
  rawLines: string[];
}

/* ------------------------------------------------------------------ */
/* Normalising                                                         */
/* ------------------------------------------------------------------ */

/**
 * OCR reliably confuses a handful of glyphs. These substitutions are only
 * applied inside a candidate vehicle number, never to the whole document —
 * turning every O into 0 across a name would do more damage than good.
 */
const DIGIT_FIXES: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2" };
const LETTER_FIXES: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z" };

function cleanNumber(raw: string): number | null {
  // Weighbridges print 42,330 / 42330 / 42 330 / 42330.00, and OCR adds
  // stray spaces. Commas and spaces go; a single decimal point stays.
  const cleaned = raw.replace(/[,\s]/g, "").replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const parts = cleaned.split(".");
  const value = parts.length > 2 ? Number(parts[0] + "." + parts[1]) : Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Indian registration plates: two letters, two digits, one or two letters,
 * four digits. Reads are put through the glyph fixes position by position,
 * which recovers most misreads without inventing a plate.
 */
export function normaliseVehicleNo(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 8 || compact.length > 11) return null;

  const fix = (chars: string, table: Record<string, string>) =>
    chars.split("").map((c) => table[c] ?? c).join("");

  // Try the two common shapes: XX00XX0000 and XX00X0000.
  for (const letters of [2, 1]) {
    const expected = 2 + 2 + letters + 4;
    if (compact.length !== expected) continue;
    const state = fix(compact.slice(0, 2), LETTER_FIXES);
    const district = fix(compact.slice(2, 4), DIGIT_FIXES);
    const series = fix(compact.slice(4, 4 + letters), LETTER_FIXES);
    const number = fix(compact.slice(4 + letters), DIGIT_FIXES);
    const candidate = `${state}${district}${series}${number}`;
    if (/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Labels seen on the weighbridge slips in use, plus obvious variants. */
const LABELS = {
  gross: /\b(gross|grosswt|gross\s*wt|gross\s*weight|g\.?w\.?)\b/i,
  tare: /\b(tare|tare\s*wt|tare\s*weight|trare|tar\s*wt|t\.?w\.?)\b/i,
  net: /\b(net|nett|net\s*wt|nett\s*wt|net\s*weight|nett\s*weight|n\.?w\.?)\b/i,
  vehicle: /\b(vehicle|vehical|veh|truck|lorry|vehicle\s*no|rc\s*no)\b/i,
  slip: /\b(slip\s*no|slip|ticket|serial|sr\.?\s*no|rst\s*no|receipt)\b/i,
  party: /\b(party|name|supplier|customer|farmer|vendor|consignor)\b/i,
  date: /\b(date|dt)\b/i,
};

/** Labels that commonly stack up: "Party Name :", "Vehicle No :". */
const TRAILING_LABEL = /^(name|no\.?|number|nos?|wt\.?|weight|of)\b[\s:.\-–—=]*/i;

function valueAfterLabel(line: string, label: RegExp): string {
  const at = line.search(label);
  if (at < 0) return "";
  let rest = line.slice(at).replace(label, "").replace(/^[\s:.\-–—=]+/, "");
  // "Party Name : M.H INDUSTRIES" matches on "Party", leaving "Name : ...".
  // Strip any further label words before the value, or the name comes back
  // as "Name M.H INDUSTRIES" and never matches the sheet.
  while (TRAILING_LABEL.test(rest)) rest = rest.replace(TRAILING_LABEL, "");
  return rest.trim();
}

export function parseWeightSlip(text: string): WeightSlipFields {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out: WeightSlipFields = {
    vehicleNo: null, slipNo: null, partyName: null,
    grossWeight: null, tareWeight: null, netWeight: null,
    date: null, rawLines: lines,
  };

  for (const line of lines) {
    // ---- weights ----
    // Tare is checked before gross, because "gross" can appear on a tare
    // line as context ("Tare 12000 Gross 42330") and first-match wins.
    for (const [key, label] of [["tare", LABELS.tare], ["gross", LABELS.gross], ["net", LABELS.net]] as const) {
      if (out[`${key}Weight` as keyof WeightSlipFields] !== null) continue;
      if (!label.test(line)) continue;
      const after = valueAfterLabel(line, label);
      const head = after.split(/\s{2,}|\||;/)[0] || after;
      // Slips print kg, quintal or MT — everything is kept in kg.
      const unitM = after.match(/^[^A-Za-z]*?([\d,]+\.?\d*)\s*(kgs?|qtls?|quintals?|mts?|tons?|tonnes?)\b/i);
      let num = cleanNumber(head);
      if (unitM) {
        const kg = toKg(`${unitM[1]} ${unitM[2]}`);
        if (kg !== null) num = kg;
      } else if (num !== null && num > 0 && num < 100 && /\d\.\d/.test(head)) {
        // "42.330" on a slip with no unit is tonnes.
        num = Math.round(num * 1000);
      }
      // A weighbridge figure under 100 is a misread, not a weight.
      if (num !== null && num >= 100 && num <= 200000) {
        (out as any)[`${key}Weight`] = num;
      }
    }

    // ---- vehicle ----
    if (!out.vehicleNo) {
      const tokens = line.toUpperCase().match(/[A-Z0-9][A-Z0-9\s-]{6,14}[A-Z0-9]/g) || [];
      for (const token of tokens) {
        const v = normaliseVehicleNo(token);
        if (v) { out.vehicleNo = v; break; }
      }
    }

    // ---- slip number ----
    if (!out.slipNo && LABELS.slip.test(line)) {
      const after = valueAfterLabel(line, LABELS.slip);
      const m = after.match(/[A-Z0-9][A-Z0-9\/-]{0,19}/i);
      if (m) out.slipNo = m[0].trim();
    }

    // ---- party ----
    if (!out.partyName && LABELS.party.test(line)) {
      const after = valueAfterLabel(line, LABELS.party);
      const cleaned = after.replace(/[^A-Za-z0-9 .&()\-]/g, "").trim();
      if (cleaned.length >= 3 && /[A-Za-z]/.test(cleaned)) out.partyName = cleaned;
    }

    // ---- date ----
    if (!out.date) {
      const m = line.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
      if (m) {
        const [, d, mo, y] = m;
        const year = y.length === 2 ? `20${y}` : y;
        out.date = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
  }

  // A slip that prints only two of the three weights is common; the third
  // is inferred, but ONLY when it is genuinely absent.
  if (out.grossWeight !== null && out.tareWeight !== null && out.netWeight === null) {
    out.netWeight = Math.round((out.grossWeight - out.tareWeight) * 100) / 100;
  }
  if (out.grossWeight !== null && out.netWeight !== null && out.tareWeight === null) {
    out.tareWeight = Math.round((out.grossWeight - out.netWeight) * 100) / 100;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export interface FieldCheck {
  field: string;
  label: string;
  entered: string | number | null;
  onSlip: string | number | null;
  status: "match" | "mismatch" | "missing_on_slip" | "not_entered";
  difference?: number;
  message?: string;
}

export interface SlipVerification {
  ok: boolean;
  readable: boolean;
  checks: FieldCheck[];
  mismatches: number;
  /** Set when the slip looks like it belongs to a different supply. */
  wrongSlipSuspected: boolean;
  summary: string;
}

export interface SheetRowValues {
  vehicleNo?: string;
  weightSlipNo?: string;
  name?: string;
  grossWeight?: number | string;
  tareWeight?: number | string;
  netWeight?: number | string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  // Entered weights may still say "28.4 MT" / "284 qtl" — compare in kg.
  const kg = toKg(typeof v === "string" ? v.trim() : v);
  if (kg !== null) return kg;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Loose name comparison — OCR mangles case, punctuation and spacing. */
function nameLooksSame(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(PVT|PRIVATE|LTD|LIMITED|AND)/g, "");
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // Allow a couple of wrong characters on a long name.
  if (Math.abs(x.length - y.length) <= 2 && x.length > 6) {
    let diff = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) diff++;
    return diff <= 2;
  }
  return false;
}

/**
 * Compare what the plant manager typed against what the slip says.
 *
 * `toleranceKg` exists because a weighbridge and a keyboard will differ by
 * a few kilos legitimately; anything past that is a real discrepancy the
 * manager has to look at.
 */
export function verifyAgainstSlip(
  row: SheetRowValues,
  slip: WeightSlipFields,
  toleranceKg = 10
): SlipVerification {
  const checks: FieldCheck[] = [];
  const readable =
    slip.grossWeight !== null || slip.netWeight !== null || slip.vehicleNo !== null;

  const weight = (field: keyof SheetRowValues, label: string, onSlip: number | null) => {
    const entered = num(row[field]);
    if (entered === null) {
      checks.push({ field, label, entered: null, onSlip, status: "not_entered" });
      return;
    }
    if (onSlip === null) {
      checks.push({ field, label, entered, onSlip: null, status: "missing_on_slip" });
      return;
    }
    const difference = Math.round((entered - onSlip) * 100) / 100;
    checks.push({
      field, label, entered, onSlip,
      status: Math.abs(difference) <= toleranceKg ? "match" : "mismatch",
      difference,
      message:
        Math.abs(difference) > toleranceKg
          ? `Sheet says ${entered.toLocaleString("en-IN")}, slip says ${onSlip.toLocaleString("en-IN")} — ${difference > 0 ? "over" : "under"} by ${Math.abs(difference).toLocaleString("en-IN")} kg.`
          : undefined,
    });
  };

  weight("grossWeight", "Gross weight", slip.grossWeight);
  weight("tareWeight", "Tare weight", slip.tareWeight);
  weight("netWeight", "Net weight", slip.netWeight);

  // ---- vehicle ----
  const enteredVehicle = String(row.vehicleNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!enteredVehicle) {
    checks.push({ field: "vehicleNo", label: "Vehicle no.", entered: null, onSlip: slip.vehicleNo, status: "not_entered" });
  } else if (!slip.vehicleNo) {
    checks.push({ field: "vehicleNo", label: "Vehicle no.", entered: enteredVehicle, onSlip: null, status: "missing_on_slip" });
  } else {
    const same = enteredVehicle === slip.vehicleNo;
    checks.push({
      field: "vehicleNo", label: "Vehicle no.",
      entered: enteredVehicle, onSlip: slip.vehicleNo,
      status: same ? "match" : "mismatch",
      message: same ? undefined : `Sheet says ${enteredVehicle}, slip says ${slip.vehicleNo}.`,
    });
  }

  // ---- name ----
  const enteredName = String(row.name || "").trim();
  if (!enteredName) {
    checks.push({ field: "name", label: "Name", entered: null, onSlip: slip.partyName, status: "not_entered" });
  } else if (!slip.partyName) {
    checks.push({ field: "name", label: "Name", entered: enteredName, onSlip: null, status: "missing_on_slip" });
  } else {
    const same = nameLooksSame(enteredName, slip.partyName);
    checks.push({
      field: "name", label: "Name",
      entered: enteredName, onSlip: slip.partyName,
      status: same ? "match" : "mismatch",
      message: same ? undefined : `Sheet says "${enteredName}", slip says "${slip.partyName}".`,
    });
  }

  const mismatches = checks.filter((c) => c.status === "mismatch").length;

  /**
   * Distinguishing "you typed it wrong" from "you attached the wrong slip".
   *
   * One field out is a typing slip. The vehicle number differing AND the
   * weights differing means this piece of paper is about a different lorry
   * — and telling the manager that is far more useful than three separate
   * "check this figure" messages.
   */
  const vehicleWrong = checks.find((c) => c.field === "vehicleNo")?.status === "mismatch";
  const weightsWrong = checks.filter(
    (c) => ["grossWeight", "tareWeight", "netWeight"].includes(c.field) && c.status === "mismatch"
  ).length;
  const wrongSlipSuspected = vehicleWrong && weightsWrong >= 2;

  let summary: string;
  if (!readable) {
    summary = "The slip couldn't be read — it may be blurred, at an angle, or too dark. Re-photograph it in good light, or check the figures yourself.";
  } else if (wrongSlipSuspected) {
    summary = "The vehicle number AND the weights are both different. This looks like the wrong slip for this row — check which supply it belongs to.";
  } else if (mismatches === 0) {
    summary = "Everything on the slip matches the entry.";
  } else if (mismatches === 1) {
    summary = `One figure doesn't match the slip: ${checks.find((c) => c.status === "mismatch")!.label.toLowerCase()}. Correct the entry, or attach the right slip.`;
  } else {
    summary = `${mismatches} figures don't match the slip. Correct the entry, or attach the right slip.`;
  }

  return { ok: readable && mismatches === 0, readable, checks, mismatches, wrongSlipSuspected, summary };
}
