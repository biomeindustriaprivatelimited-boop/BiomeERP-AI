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

/**
 * How a series numbers its documents — the same three choices Tally
 * gives a voucher type:
 *
 *   automatic              the next number is taken when the entry is saved;
 *                          nobody types one (an admin can still correct it)
 *   auto_manual_override   the next number is taken on save, but a person
 *                          may type a different one (checked for duplicates)
 *   manual                 the number is always typed; duplicates refused
 */
export type NumberingMethod = "automatic" | "auto_manual_override" | "manual";

export const NUMBERING_METHODS: { id: NumberingMethod; label: string; help: string }[] = [
  { id: "automatic", label: "Automatic", help: "Next number on save. Cannot be typed over." },
  { id: "auto_manual_override", label: "Automatic (manual override)", help: "Next number on save; a different number may be typed." },
  { id: "manual", label: "Manual", help: "Always typed. Duplicates are refused." },
];

export interface NumberSeries {
  id: string;
  /** Tally-style numbering method. Older series: automatic with manual override. */
  method?: NumberingMethod;
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
  /**
   * The Tally voucher type this book numbers — "Sales", "Delivery Note"…
   * Free text so a new voucher type in Tally needs no code change.
   */
  voucherType?: string;
  /** Printed where the pattern says {PREFIX} / {SUFFIX}. */
  prefix?: string;
  suffix?: string;
  /** Plant codes (REW, GKD…) the book is for. Empty = any plant. */
  plants?: string[];
  /** State codes (HR, MH…) the book is for. Empty = any state. */
  states?: string[];
  /** Picked first when nothing more specific (client, plant) decides. */
  isDefault?: boolean;
  /** Seeded from the workbook / shipped with the app. Can be retired, not removed. */
  builtIn?: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Tally voucher type a document type maps to when nobody has said otherwise. */
export function defaultVoucherType(docType: DocType): string {
  return docType === "tax_invoice" ? "Sales" : "Delivery Note";
}

export interface SeriesFile {
  series: NumberSeries[];
  /** Numbers handed out, newest first. Kept so a gap can be explained. */
  issued: IssuedNumber[];
  seededAt?: string;
  updatedAt?: string;
  /** One-off changes already applied to this file — each runs once, ever. */
  migrations?: string[];
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
/* Formatting — pure (lib/numberSeriesFormat.ts, shared with the page) */
/* ------------------------------------------------------------------ */

import {
  financialYearFor, formatSeriesNumber, hasSeqToken, rankSeries, seriesApplies,
  resolvedPattern, numberMatchesSeries, type SeriesContext,
} from "@/lib/numberSeriesFormat";
export {
  financialYearFor, formatSeriesNumber, hasSeqToken, rankSeries, seriesApplies,
  resolvedPattern, numberMatchesSeries,
};
export type { SeriesContext };

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
      builtIn: true,
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
      builtIn: true,
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
      builtIn: true,
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
      builtIn: true,
    },
  ];
  return { series, issued: [], seededAt: now, updatedAt: now };
}

/**
 * Maharashtra sales book — asked for by the owner in October 2026 ("the
 * Maharashtra sale number series doesn't appear in the coordination
 * sheet"). Added by a one-time migration so an existing install keeps its
 * four books, their counts and every issued number exactly as they are.
 *
 * The format is a sensible default, not one read off a real invoice:
 * accounts should check prefix, pattern and starting number on the Number
 * series screen before the first Maharashtra invoice is raised.
 */
export const MH_SALE_ID = "ti-mh-sale";

function maharashtraSale(now: string): NumberSeries {
  return {
    id: MH_SALE_ID,
    name: "Maharashtra Sale",
    docType: "tax_invoice",
    voucherType: "Sales",
    business: "both",
    prefix: "BI",
    suffix: "",
    pattern: "{PREFIX}/{FYSHORT}/MH/{SEQ}",
    minDigits: 4,
    nextSeq: 1,
    resetOn: "financial_year",
    fy: financialYearFor(now.slice(0, 10)),
    clientHints: ["NTPC LTD ( SOLAPUR )", "NTPC LIMITED ( Mouda )"],
    plants: ["GKD"],
    states: ["MH"],
    isDefault: false,
    method: "auto_manual_override",
    note: "Added Oct 2026 for Maharashtra (Gangakhed / GKD) sales with a default format. Check the prefix, pattern and starting number against the Maharashtra invoice book before the first number is issued.",
    active: true,
    builtIn: true,
    createdAt: now,
    createdBy: "system",
  };
}

const MIGRATIONS: { id: string; run: (f: SeriesFile, now: string) => void }[] = [
  {
    id: "2026-10-maharashtra-sale",
    run: (f, now) => {
      if (!f.series.some((s) => s.id === MH_SALE_ID)) f.series.push(maharashtraSale(now));
    },
  },
];

function migrate(f: SeriesFile): boolean {
  const done = new Set(f.migrations || []);
  const now = new Date().toISOString();
  let changed = false;
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    m.run(f, now);
    done.add(m.id);
    changed = true;
  }
  f.migrations = [...done];
  return changed;
}

export function loadSeriesFile(): SeriesFile {
  const stored = readJson<Partial<SeriesFile>>(file(), {});
  if (!Array.isArray(stored.series) || stored.series.length === 0) {
    const seeded = seed();
    migrate(seeded);
    saveSeriesFile(seeded);
    return seeded;
  }
  const f: SeriesFile = {
    series: stored.series.map(normaliseSeries),
    issued: Array.isArray(stored.issued) ? stored.issued : [],
    seededAt: stored.seededAt,
    updatedAt: stored.updatedAt,
    migrations: Array.isArray(stored.migrations) ? stored.migrations.map(String) : [],
  };
  if (migrate(f)) saveSeriesFile(f);
  return f;
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
    method: s.method,
    voucherType: String(s.voucherType || "").trim() || defaultVoucherType(s.docType === "tax_invoice" ? "tax_invoice" : "delivery_challan"),
    prefix: String(s.prefix ?? ""),
    suffix: String(s.suffix ?? ""),
    plants: Array.isArray(s.plants) ? s.plants.map((x: any) => String(x).toUpperCase().trim()).filter(Boolean) : [],
    states: Array.isArray(s.states) ? s.states.map((x: any) => String(x).toUpperCase().trim()).filter(Boolean) : [],
    isDefault: s.isDefault === true,
    builtIn: s.builtIn === true || ["ti-hr", "dc-tally", "dc-ntpc-solapur", "dc-ntpc-mouda", MH_SALE_ID].includes(String(s.id)),
    createdAt: s.createdAt, createdBy: s.createdBy, updatedAt: s.updatedAt, updatedBy: s.updatedBy,
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
export function seriesFor(
  docType: DocType,
  business: BusinessType,
  client?: string,
  where: { plant?: string; state?: string } = {}
): NumberSeries[] {
  return rankSeries(loadSeriesFile().series, { docType, business, client, ...where });
}

/**
 * Which book a document number belongs to — for numbers that arrive
 * typed or imported (Tally, the Excel import) rather than issued here.
 * Undefined when no single active-or-retired series fits.
 */
export function seriesForNumber(number: string, docType?: DocType): NumberSeries | undefined {
  const hits = loadSeriesFile().series.filter(
    (s) => (!docType || s.docType === docType) && numberMatchesSeries(s, number)
  );
  return hits.length === 1 ? hits[0] : undefined;
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
export function methodOf(s: Pick<NumberSeries, "method"> | undefined | null): NumberingMethod {
  return s?.method === "automatic" || s?.method === "manual" ? s.method : "auto_manual_override";
}

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
