/**
 * Biome Platform — importing billed figures from Tally
 * -------------------------------------------------------------------
 * Tally already holds what was billed: the date on our tax invoice or
 * delivery challan, the client, the vehicle, the billed weight and the
 * amount split into taxable, tax and total. Re-typing that into the
 * coordination register is both slow and a second chance to get it wrong.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an import may FILL a row, never
 * INVENT one. A spreadsheet row that cannot be tied to a trip with
 * confidence goes to a review list for a person to place. Silently
 * creating a trip would double-count a supply — the register would show
 * two vehicles where one ran, and the shortage figures that the whole
 * module exists to produce would be wrong.
 *
 * Everything here is pure. The route reads the file and writes the store;
 * the decisions are all made in functions that can be run against their
 * real export.
 */

export interface ImportMapping {
  invoiceDate: string;
  docNo: string;
  client: string;
  vehicle: string;
  weight: string;
  taxable: string;
  tax: string;
  total: string;
}

export const BLANK_MAPPING: ImportMapping = {
  invoiceDate: "", docNo: "", client: "", vehicle: "", weight: "",
  taxable: "", tax: "", total: "",
};

/**
 * Header words we have seen, per field. Tally's column titles vary by
 * report and by who saved the file, so this is a starting guess that the
 * person can correct on screen — never a requirement.
 */
const HINTS: Record<keyof ImportMapping, string[]> = {
  invoiceDate: ["invoice date", "date of our tax invoice", "date of invoice", "doc date", "challan date", "voucher date", "date"],
  docNo: ["invoice no", "invoice number", "biome invoice", "voucher no", "challan no", "biome challan", "doc no", "document no", "reference"],
  client: ["client", "sold to party", "party", "party name", "customer", "buyer", "party's name", "particulars"],
  vehicle: ["vehicle no", "vehicle number", "vehicle", "truck no", "lorry no"],
  weight: ["invoice weight", "billed weight", "quantity", "qty", "weight", "net weight"],
  taxable: ["taxable", "taxable value", "taxable amount", "assessable value", "amount without tax", "basic"],
  tax: ["tax", "tax amount", "gst", "gst amount", "igst", "total tax"],
  total: ["total", "invoice value", "total amount", "grand total", "bill amount", "gross total"],
};

function tidy(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Guess which column is which.
 *
 * Longest hint first, so "taxable value" is not claimed by the "tax" rule
 * and "total tax" is not claimed by "total" — that single confusion would
 * put the tax amount in the total column and every figure downstream would
 * be wrong while looking perfectly plausible.
 */
export function detectColumns(headers: string[]): ImportMapping {
  const cleaned = headers.map(tidy);
  const taken = new Set<number>();
  const out: ImportMapping = { ...BLANK_MAPPING };

  const fields = Object.keys(HINTS) as (keyof ImportMapping)[];
  const candidates: { field: keyof ImportMapping; index: number; score: number }[] = [];

  fields.forEach((field) => {
    HINTS[field].forEach((hint) => {
      const h = tidy(hint);
      cleaned.forEach((header, index) => {
        if (!header) return;
        let score = 0;
        if (header === h) score = 1000 + h.length;
        else if (header.includes(h)) score = 500 + h.length;
        else if (h.includes(header) && header.length >= 3) score = 200 + header.length;
        if (score) candidates.push({ field, index, score });
      });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (out[c.field]) continue;
    if (taken.has(c.index)) continue;
    out[c.field] = headers[c.index];
    taken.add(c.index);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading values                                                      */
/* ------------------------------------------------------------------ */

export function normaliseVehicle(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Money and weight out of a spreadsheet cell.
 *
 * Handles "1,26,315.00", "₹1,26,315", "(1,265)" for a negative, and the
 * plain number Excel gives when the cell is not text.
 */
export function readNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  // "(1,265)", "-1,265" and Tally's own "(-)1,265.00" are all negative.
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-") || s.startsWith("(-)");
  s = s.replace(/[()₹,\s]/g, "").replace(/^-/, "").replace(/(cr|dr)\.?$/i, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/**
 * A date out of a cell, as YYYY-MM-DD.
 *
 * Indian exports are day-first and JavaScript is not, so "01-08-2026" read
 * by `new Date()` becomes 8 January. Day-first is assumed wherever the
 * first part could be a day; ISO text is left alone.
 */
export function readDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return "";

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // "29-May-2026" and "29 May 26"
  const named = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,})[-/. ](\d{2,4})$/);
  if (named) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const m = months.indexOf(named[2].slice(0, 3).toLowerCase());
    let y = Number(named[3]);
    if (y < 100) y += 2000;
    if (m >= 0) return `${y}-${String(m + 1).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`;
  }
  return "";
}

export interface ImportRow {
  /** 1-based row number in the sheet, so a problem can be pointed at. */
  rowNumber: number;
  invoiceDate: string;
  docNo: string;
  client: string;
  vehicle: string;
  weightKg: number;
  taxable: number;
  tax: number;
  total: number;
}

export function readRows(
  raw: Record<string, unknown>[],
  mapping: ImportMapping,
  firstRowNumber = 2
): ImportRow[] {
  return raw.map((r, i) => ({
    rowNumber: firstRowNumber + i,
    invoiceDate: readDate(mapping.invoiceDate ? r[mapping.invoiceDate] : ""),
    docNo: String(mapping.docNo ? r[mapping.docNo] ?? "" : "").trim(),
    client: String(mapping.client ? r[mapping.client] ?? "" : "").trim(),
    vehicle: normaliseVehicle(mapping.vehicle ? r[mapping.vehicle] : ""),
    weightKg: readNumber(mapping.weight ? r[mapping.weight] : 0),
    taxable: readNumber(mapping.taxable ? r[mapping.taxable] : 0),
    tax: readNumber(mapping.tax ? r[mapping.tax] : 0),
    total: readNumber(mapping.total ? r[mapping.total] : 0),
  }));
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export interface MatchTarget {
  id: string;
  serial: number;
  ourDocNo: string;
  vehicleNumber: string;
  client: string;
  vehicleEntryDate: string;
  receivingDate: string;
  ourDocDate: string;
  billedAlready: boolean;
}

export type MatchVerdict = "matched" | "ambiguous" | "unmatched" | "already" | "empty";

export interface MatchedRow {
  row: ImportRow;
  verdict: MatchVerdict;
  /** The trip it will fill. Set only for "matched" and "already". */
  tripId: string;
  tripSerial: number;
  how: string;
  /** Every trip it could be, for the person to choose from. */
  candidates: { id: string; serial: number; label: string }[];
  warnings: string[];
}

/** How far apart a Tally date and a trip date may be and still be the same trip. */
const DATE_SLACK_DAYS = 10;

function daysApart(a: string, b: string): number {
  if (!a || !b) return 9999;
  const t1 = new Date(a + "T00:00:00Z").getTime();
  const t2 = new Date(b + "T00:00:00Z").getTime();
  if (isNaN(t1) || isNaN(t2)) return 9999;
  return Math.abs(t1 - t2) / 86400000;
}

function label(t: MatchTarget): string {
  return `#${t.serial} ${t.vehicleNumber || "no vehicle"}${t.client ? ` · ${t.client}` : ""}${
    t.receivingDate ? ` · received ${t.receivingDate}` : ""
  }`;
}

/**
 * Tie each spreadsheet row to a trip.
 *
 * Order matters and is deliberate:
 *   1. Our own document number, when the export carries it. This is exact
 *      and needs no guessing.
 *   2. Vehicle number plus a nearby date. A vehicle can run the same route
 *      twice in a week, so the date is what separates the two runs.
 *
 * Anything that matches more than one trip is returned as ambiguous rather
 * than resolved by picking the closest — "closest" would be right most of
 * the time, and the times it was wrong would be invisible.
 */
export function matchRows(rows: ImportRow[], trips: MatchTarget[]): MatchedRow[] {
  const byDoc = new Map<string, MatchTarget[]>();
  for (const t of trips) {
    const key = t.ourDocNo.trim().toLowerCase();
    if (!key) continue;
    byDoc.set(key, [...(byDoc.get(key) || []), t]);
  }

  const usedTrip = new Map<string, number>(); // tripId -> sheet row that claimed it

  return rows.map((row): MatchedRow => {
    const warnings: string[] = [];
    const empty = !row.vehicle && !row.docNo && !row.total && !row.taxable;
    if (empty) {
      return { row, verdict: "empty", tripId: "", tripSerial: 0, how: "Blank row.", candidates: [], warnings };
    }

    if (row.taxable && row.total && row.tax) {
      const drift = Math.abs(row.taxable + row.tax - row.total);
      // A rupee or two is rounding. More than that means a column is the
      // wrong column, and it is far better to say so than to store it.
      if (drift > 2) {
        warnings.push(
          `Taxable + tax = ${(row.taxable + row.tax).toFixed(2)} but the total column says ${row.total.toFixed(2)}. Check the column mapping.`
        );
      }
    }

    let candidates: MatchTarget[] = [];
    let how = "";

    const docKey = row.docNo.trim().toLowerCase();
    if (docKey && byDoc.has(docKey)) {
      candidates = byDoc.get(docKey)!;
      how = `Matched on our document number ${row.docNo}.`;
    } else {
      const sameVehicle = trips.filter((t) => t.vehicleNumber && t.vehicleNumber === row.vehicle);
      if (sameVehicle.length) {
        const dated = sameVehicle
          .map((t) => ({
            t,
            gap: Math.min(
              daysApart(row.invoiceDate, t.receivingDate),
              daysApart(row.invoiceDate, t.vehicleEntryDate),
              daysApart(row.invoiceDate, t.ourDocDate)
            ),
          }))
          .filter((x) => x.gap <= DATE_SLACK_DAYS)
          .sort((a, b) => a.gap - b.gap);

        if (!row.invoiceDate) {
          candidates = sameVehicle;
          how = "Matched on vehicle number only — no usable date in the sheet.";
        } else if (dated.length) {
          const best = dated[0].gap;
          // Two runs of the same vehicle equally close to the date is
          // exactly the case a person has to decide.
          candidates = dated.filter((x) => x.gap === best).map((x) => x.t);
          how = `Matched on vehicle ${row.vehicle}, ${best === 0 ? "same date" : `${best} day${best === 1 ? "" : "s"} apart`}.`;
        } else {
          candidates = [];
          how = `Vehicle ${row.vehicle} exists in the register but no trip is within ${DATE_SLACK_DAYS} days of ${row.invoiceDate}.`;
        }
      } else {
        how = row.vehicle ? `Vehicle ${row.vehicle} is not in this register.` : "No vehicle number and no document number to match on.";
      }
    }

    if (candidates.length === 0) {
      return { row, verdict: "unmatched", tripId: "", tripSerial: 0, how, candidates: [], warnings };
    }

    if (candidates.length > 1) {
      return {
        row, verdict: "ambiguous", tripId: "", tripSerial: 0,
        how: `${how} ${candidates.length} trips fit — pick one.`,
        candidates: candidates.map((t) => ({ id: t.id, serial: t.serial, label: label(t) })),
        warnings,
      };
    }

    const t = candidates[0];

    // Two sheet rows landing on one trip means the export has duplicates,
    // or the vehicle ran twice and one date is wrong. Either way, stop.
    const claimedBy = usedTrip.get(t.id);
    if (claimedBy) {
      return {
        row, verdict: "ambiguous", tripId: "", tripSerial: t.serial,
        how: `Trip #${t.serial} was already matched by sheet row ${claimedBy}. Two rows cannot bill one trip.`,
        candidates: [{ id: t.id, serial: t.serial, label: label(t) }],
        warnings,
      };
    }
    usedTrip.set(t.id, row.rowNumber);

    if (row.client && t.client && tidy(row.client) !== tidy(t.client)) {
      warnings.push(`Sheet says "${row.client}", the register says "${t.client}".`);
    }

    return {
      row,
      verdict: t.billedAlready ? "already" : "matched",
      tripId: t.id,
      tripSerial: t.serial,
      how: t.billedAlready ? `${how} This trip already carries billing figures — importing will replace them.` : how,
      candidates: [{ id: t.id, serial: t.serial, label: label(t) }],
      warnings,
    };
  });
}

export interface ImportSummary {
  total: number;
  matched: number;
  already: number;
  ambiguous: number;
  unmatched: number;
  empty: number;
  warnings: number;
  billedTotal: number;
}

export function summariseImport(rows: MatchedRow[]): ImportSummary {
  const s: ImportSummary = {
    total: 0, matched: 0, already: 0, ambiguous: 0, unmatched: 0, empty: 0, warnings: 0, billedTotal: 0,
  };
  for (const r of rows) {
    if (r.verdict === "empty") { s.empty += 1; continue; }
    s.total += 1;
    s.warnings += r.warnings.length;
    if (r.verdict === "matched") { s.matched += 1; s.billedTotal += r.row.total; }
    if (r.verdict === "already") { s.already += 1; s.billedTotal += r.row.total; }
    if (r.verdict === "ambiguous") s.ambiguous += 1;
    if (r.verdict === "unmatched") s.unmatched += 1;
  }
  return s;
}
