/**
 * Biome Platform — document number series (server only)
 * -------------------------------------------------------------------
 * The tax invoice and delivery challan numbers the business actually
 * issues. Every format here was read out of their own coordination
 * workbook, not invented:
 *
 *   BIPL/2026-27/886        Tally DC register  (started life as plain 463)
 *   BI-26-27-HR0786         Haryana tax invoice book
 *   BI/NTPC/SOL/039         NTPC Solapur delivery challans
 *   BI/NTPC/MOU/088         NTPC Mouda delivery challans
 *
 * TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
 *
 * 1. **The workbook's last number is not the last used number.** The
 *    invoice column is filled down to BI-26-27-HR02600 while the last row
 *    carrying a vehicle is BI-26-27-HR0786; Solapur reads 0253 against 039
 *    in use. Seeding from the bottom of the column would have skipped
 *    1,800 invoice numbers. The seeds below are the last USED ones.
 *
 * 2. **A number, once issued, is never handed out again** — not after a
 *    cancellation, not after a deletion. A tax invoice book with a reused
 *    or missing serial is a GST problem, and it is found at assessment,
 *    long after anyone remembers why. Cancelled trips keep their number
 *    and stay in the register marked cancelled.
 *
 * The business type (trading or manufacturing) does NOT split the series.
 * A number book belongs to a GSTIN, and their own sheet proves the point:
 * manufacturing rows sit in the same invoice run under the supplier name
 * BIOME. Trading and manufacturing are separate REGISTERS to work in,
 * sharing one statutory numbering.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export type DocType = "tax_invoice" | "delivery_challan";

export const DOC_TYPES: { id: DocType; label: string; short: string }[] = [
  { id: "tax_invoice", label: "Tax Invoice", short: "TI" },
  { id: "delivery_challan", label: "Delivery Challan", short: "DC" },
];

export type BusinessType = "trading" | "manufacturing";

export const BUSINESS_TYPES: { id: BusinessType; label: string; help: string }[] = [
  {
    id: "trading",
    label: "Trading",
    help: "Bought from a vendor and supplied straight to the client. The vendor's own paperwork travels with it.",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    help: "Our own produced material. There is no vendor, so the vendor side of the register stays closed.",
  },
];

export interface NumberSeries {
  id: string;
  /** What a person calls it — shown in the picker. */
  name: string;
  docType: DocType;
  /**
   * Which register may use it. "both" is the honest default: their invoice
   * book is shared between trading and manufacturing.
   */
  business: BusinessType | "both";
  /**
   * The number itself. `{SEQ}` is the running count; everything else is
   * literal. `{FY}`, `{YY}` and `{MM}` are filled from the document date.
   */
  pattern: string;
  /** Zero-pad the running count to at least this many digits. */
  minDigits: number;
  /** The count the NEXT document will carry. */
  nextSeq: number;
  /** Reset the count when the financial year turns, or never. */
  resetOn: "never" | "financial_year";
  /** Which financial year `nextSeq` belongs to — "2026-27". */
  fy: string;
  /** Clients this series is normally used for — used to pre-select it. */
  clientHints: string[];
  /** Where the seed came from, so nobody has to guess later. */
  note: string;
  active: boolean;
  lastIssued?: { number: string; at: string; by: string; tripId: string };
}

export interface SeriesFile {
  series: NumberSeries[];
  /** Numbers handed out, newest first. Kept so a gap can be explained. */
  issued: IssuedNumber[];
  seededAt?: string;
  updatedAt?: string;
}

export interface IssuedNumber {
  number: string;
  seriesId: string;
  seq: number;
  tripId: string;
  at: string;
  by: string;
  byName: string;
  /** Set when the trip that held it was cancelled — the number stays used. */
  voidedAt?: string;
  voidReason?: string;
}

function file(): string {
  return path.join(paths.configDir, "number-series.json");
}

/* ------------------------------------------------------------------ */
/* Formatting — pure                                                   */
/* ------------------------------------------------------------------ */

/** Financial year label for a date: 1 April starts a new one in India. */
export function financialYearFor(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date + (date.length === 10 ? "T00:00:00" : "")) : date;
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const y = valid.getFullYear();
  const start = valid.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Build the printed number.
 *
 * Their padding is genuinely irregular and it is copied rather than
 * corrected: the invoice book reads HR0554 and HR01000, which is a literal
 * "0" in the prefix followed by a count padded to three. Tidying that up
 * would produce numbers that do not match the invoices already issued.
 */
export function formatSeriesNumber(
  series: Pick<NumberSeries, "pattern" | "minDigits">,
  seq: number,
  date?: string
): string {
  const d = date || new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(d);
  const seqText = String(Math.max(0, Math.trunc(seq))).padStart(Math.max(1, series.minDigits), "0");
  return series.pattern
    .replace(/\{SEQ\}/g, seqText)
    .replace(/\{FY\}/g, fy)
    .replace(/\{FYSHORT\}/g, fy.slice(2))
    .replace(/\{YYYY\}/g, d.slice(0, 4))
    .replace(/\{YY\}/g, d.slice(2, 4))
    .replace(/\{MM\}/g, d.slice(5, 7));
}

/** What the next document from this series would be called. */
export function previewNext(series: NumberSeries, date?: string): string {
  return formatSeriesNumber(series, seqForDate(series, date), date);
}

/**
 * The count to use for a date, honouring a financial-year reset.
 *
 * Kept pure and separate because the reset is the one place a series can
 * silently start issuing numbers that clash with last year's.
 */
export function seqForDate(series: NumberSeries, date?: string): number {
  if (series.resetOn !== "financial_year") return series.nextSeq;
  const fy = financialYearFor(date || new Date().toISOString().slice(0, 10));
  return fy === series.fy ? series.nextSeq : 1;
}

/* ------------------------------------------------------------------ */
/* The seeds — read out of their workbook                              */
/* ------------------------------------------------------------------ */

function seed(): SeriesFile {
  const now = new Date().toISOString();
  const series: NumberSeries[] = [
    {
      id: "ti-hr",
      name: "Tax Invoice — Haryana",
      docType: "tax_invoice",
      business: "both",
      pattern: "BI-26-27-HR0{SEQ}",
      minDigits: 3,
      nextSeq: 787,
      resetOn: "never",
      fy: "2026-27",
      clientHints: ["JPL", "Jhajjar Power Limited", "NTPC DADRI", "NTPC TANDA"],
      note: "Seeded from BIOME -INVOICES. Last number actually against a vehicle: BI-26-27-HR0786. The column below it is filled down to 02600 — those were never issued.",
      active: true,
    },
    {
      id: "dc-tally",
      name: "Delivery Challan — Tally register",
      docType: "delivery_challan",
      business: "both",
      pattern: "BIPL/2026-27/{SEQ}",
      minDigits: 1,
      nextSeq: 887,
      resetOn: "never",
      fy: "2026-27",
      clientHints: [
        "NABHA POWER LIMITED", "ARAVALI POWER COMPANY PVT LTD",
        "NTPC- VINDHYANCHAL", "NTPC- TANDA", "NTPC - DADRI",
      ],
      note: "Seeded from BIOME- Tally DC. Ran as plain numbers from 463 and changed to BIPL/2026-27/ mid-book; the count carried straight on, so the count here continues too. Last used: BIPL/2026-27/886.",
      active: true,
    },
    {
      id: "dc-ntpc-solapur",
      name: "Delivery Challan — NTPC Solapur",
      docType: "delivery_challan",
      business: "both",
      pattern: "BI/NTPC/SOL/0{SEQ}",
      minDigits: 2,
      nextSeq: 40,
      resetOn: "never",
      fy: "2026-27",
      clientHints: ["NTPC SOLAPUR", "NTPC LTD ( SOLAPUR )"],
      note: "Seeded from SOLAPUR -DC. Last used: BI/NTPC/SOL/039. The column is filled down to 0253 — not issued.",
      active: true,
    },
    {
      id: "dc-ntpc-mouda",
      name: "Delivery Challan — NTPC Mouda",
      docType: "delivery_challan",
      business: "both",
      pattern: "BI/NTPC/MOU/0{SEQ}",
      minDigits: 2,
      nextSeq: 89,
      resetOn: "never",
      fy: "2026-27",
      clientHints: ["NTPC MOUDA"],
      note: "Seeded from MOUDA - DC. Last used: BI/NTPC/MOU/088. The column is filled down to 0154 — not issued.",
      active: true,
    },
  ];
  return { series, issued: [], seededAt: now, updatedAt: now };
}

export function loadSeriesFile(): SeriesFile {
  const stored = readJson<Partial<SeriesFile>>(file(), {});
  if (!Array.isArray(stored.series) || stored.series.length === 0) {
    const seeded = seed();
    saveSeriesFile(seeded);
    return seeded;
  }
  return {
    series: stored.series.map(normaliseSeries),
    issued: Array.isArray(stored.issued) ? stored.issued : [],
    seededAt: stored.seededAt,
    updatedAt: stored.updatedAt,
  };
}

export function saveSeriesFile(f: SeriesFile): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { ...f, updatedAt: new Date().toISOString() });
}

function normaliseSeries(s: any): NumberSeries {
  return {
    id: String(s.id || ""),
    name: String(s.name || ""),
    docType: s.docType === "tax_invoice" ? "tax_invoice" : "delivery_challan",
    business: ["trading", "manufacturing", "both"].includes(s.business) ? s.business : "both",
    pattern: String(s.pattern || "{SEQ}"),
    minDigits: Number(s.minDigits) > 0 ? Number(s.minDigits) : 1,
    nextSeq: Number(s.nextSeq) > 0 ? Math.trunc(Number(s.nextSeq)) : 1,
    resetOn: s.resetOn === "financial_year" ? "financial_year" : "never",
    fy: String(s.fy || financialYearFor(new Date())),
    clientHints: Array.isArray(s.clientHints) ? s.clientHints.map(String) : [],
    note: String(s.note || ""),
    active: s.active !== false,
    lastIssued: s.lastIssued,
  };
}

export function seriesById(id: string): NumberSeries | undefined {
  return loadSeriesFile().series.find((s) => s.id === id);
}

/**
 * Series that fit a document type and register, best guess first.
 *
 * The client hint does the useful work: a Solapur trip should not offer
 * the Mouda challan book as its first option, because at 40 trips a day
 * the first option is the one that gets picked.
 */
export function seriesFor(docType: DocType, business: BusinessType, client?: string): NumberSeries[] {
  const all = loadSeriesFile().series.filter(
    (s) => s.active && s.docType === docType && (s.business === "both" || s.business === business)
  );
  const name = (client || "").trim().toLowerCase();
  if (!name) return all;
  const score = (s: NumberSeries) =>
    s.clientHints.some((h) => {
      const hint = h.trim().toLowerCase();
      return hint && (hint === name || name.includes(hint) || hint.includes(name));
    })
      ? 0
      : 1;
  return [...all].sort((a, b) => score(a) - score(b));
}

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

export interface IssueResult {
  ok: boolean;
  number?: string;
  seq?: number;
  error?: string;
}

/**
 * Take the next number from a series and advance it.
 *
 * Read-modify-write on one small file. This is the same single-process
 * store the rest of the app uses, and it is the point at which the
 * still-undecided multi-PC question bites hardest: two coordinators on two
 * PCs with their own copies of this file will both issue the same invoice
 * number and neither will know. Until sync exists, ONE machine should be
 * the one that issues numbers.
 */
export function issueNumber(
  seriesId: string,
  ctx: { tripId: string; by: string; byName: string; date?: string }
): IssueResult {
  const f = loadSeriesFile();
  const idx = f.series.findIndex((s) => s.id === seriesId);
  if (idx === -1) return { ok: false, error: "That number series no longer exists." };

  const s = f.series[idx];
  if (!s.active) return { ok: false, error: `The series "${s.name}" is switched off.` };

  const date = ctx.date || new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(date);
  let seq = s.nextSeq;

  // A financial-year reset moves the book on. Doing it here rather than on
  // a timer means it happens on the first document of the new year, which
  // is the only moment it can be got right.
  if (s.resetOn === "financial_year" && fy !== s.fy) {
    seq = 1;
    s.fy = fy;
  }

  const number = formatSeriesNumber(s, seq, date);

  // Belt and braces: never hand out a number this file has already seen.
  if (f.issued.some((i) => i.number === number)) {
    return {
      ok: false,
      error: `${number} has already been issued. The series count is behind the register — an admin has to correct it on the Number series screen before anything else can be saved.`,
    };
  }

  s.nextSeq = seq + 1;
  s.lastIssued = { number, at: new Date().toISOString(), by: ctx.byName, tripId: ctx.tripId };
  f.series[idx] = s;
  f.issued = [
    { number, seriesId: s.id, seq, tripId: ctx.tripId, at: new Date().toISOString(), by: ctx.by, byName: ctx.byName },
    ...f.issued,
  ].slice(0, 5000);

  saveSeriesFile(f);
  return { ok: true, number, seq };
}

/**
 * Mark an issued number void — the trip was cancelled.
 *
 * Deliberately does NOT give the number back. The register keeps the row
 * so the book has no hole in it, which is what an auditor is looking for.
 */
export function voidNumber(number: string, reason: string): void {
  if (!number) return;
  const f = loadSeriesFile();
  const rec = f.issued.find((i) => i.number === number && !i.voidedAt);
  if (!rec) return;
  rec.voidedAt = new Date().toISOString();
  rec.voidReason = reason || "Trip cancelled.";
  saveSeriesFile(f);
}

/** Is this number already on the books, on some other trip? */
export function numberClash(number: string, tripId: string): IssuedNumber | undefined {
  if (!number.trim()) return undefined;
  return loadSeriesFile().issued.find(
    (i) => i.number.trim().toLowerCase() === number.trim().toLowerCase() && i.tripId !== tripId
  );
}

/**
 * Record a number that was typed in by hand rather than taken from a
 * series — historic rows being entered, or a document raised outside the
 * app. Registered so the clash check can still see it.
 */
export function registerManualNumber(
  number: string,
  ctx: { tripId: string; by: string; byName: string; seriesId?: string }
): void {
  if (!number.trim()) return;
  const f = loadSeriesFile();
  if (f.issued.some((i) => i.number === number.trim() && i.tripId === ctx.tripId)) return;
  f.issued = [
    {
      number: number.trim(), seriesId: ctx.seriesId || "manual", seq: 0,
      tripId: ctx.tripId, at: new Date().toISOString(), by: ctx.by, byName: ctx.byName,
    },
    ...f.issued,
  ].slice(0, 5000);
  saveSeriesFile(f);
}
