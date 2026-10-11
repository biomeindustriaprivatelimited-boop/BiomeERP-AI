/**
 * Biome Platform — number series formatting and matching (pure)
 * -------------------------------------------------------------------
 * The parts of the number-series master that need no store, so the
 * coordination page can preview a number and choose a series with exactly
 * the rules the server uses. lib/numberSeries.ts re-exports all of it.
 *
 * PATTERN TOKENS (case-insensitive; anything else is printed as typed):
 *
 *   {SEQ} or {n}           the running number, zero-padded to `minDigits`
 *   {PREFIX} / {SUFFIX}    the series' own prefix / suffix fields
 *   {FY} or {yyyy-yy}      financial year of the document date — 2026-27
 *   {FYSHORT} or {yy-yy}   short financial year — 26-27
 *   {YYYY} / {YY} / {MM}   calendar year / 2-digit year / month of the date
 *
 * Every pattern the business already prints ({SEQ} plus literal text) comes
 * out byte-for-byte the same as before — tools/check-coordination.mjs holds
 * the seeded books to the numbers already issued.
 */

export interface SeriesFormatLike {
  pattern: string;
  minDigits: number;
  prefix?: string;
  suffix?: string;
}

/** Financial year label for a date: 1 April starts a new one in India. */
export function financialYearFor(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date + (date.length === 10 ? "T00:00:00" : "")) : date;
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const y = valid.getFullYear();
  const start = valid.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Does the pattern say where the running number goes? */
export function hasSeqToken(pattern: string): boolean {
  return /\{\s*(seq|n)\s*\}/i.test(String(pattern || ""));
}

/**
 * Build the printed number.
 *
 * Their padding is genuinely irregular and it is copied rather than
 * corrected: the invoice book reads HR0554 and HR01000, which is a literal
 * "0" in the pattern followed by a count padded to three. Tidying that up
 * would produce numbers that do not match the invoices already issued.
 */
export function formatSeriesNumber(series: SeriesFormatLike, seq: number, date?: string): string {
  const d = date || new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(d);
  const seqText = String(Math.max(0, Math.trunc(seq))).padStart(Math.max(1, series.minDigits), "0");
  const values: Record<string, string> = {
    seq: seqText,
    n: seqText,
    prefix: String(series.prefix || ""),
    suffix: String(series.suffix || ""),
    fy,
    "yyyy-yy": fy,
    fyshort: fy.slice(2),
    "yy-yy": fy.slice(2),
    yyyy: d.slice(0, 4),
    yy: d.slice(2, 4),
    mm: d.slice(5, 7),
  };
  return String(series.pattern || "").replace(/\{\s*([A-Za-z-]+)\s*\}/g, (whole, key: string) => {
    const v = values[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/* ------------------------------------------------------------------ */
/* Which series fits a document                                        */
/* ------------------------------------------------------------------ */

export interface SeriesMatchLike {
  id: string;
  docType: string;
  business: string;
  active?: boolean;
  clientHints: string[];
  /** Plant codes it is for (REW, GKD…). Empty = any plant. */
  plants?: string[];
  /** State codes it is for (HR, MH…). Empty = any state. */
  states?: string[];
  isDefault?: boolean;
}

export interface SeriesContext {
  docType: string;
  business: string;
  client?: string;
  /** The plant the supply left from, when known (manufacturing). */
  plant?: string;
  /** That plant's state code, when known. */
  state?: string;
}

const up = (v: unknown) => String(v ?? "").trim().toUpperCase();

function clientHit(s: SeriesMatchLike, client?: string): boolean {
  const name = String(client || "").trim().toLowerCase();
  if (!name) return false;
  return s.clientHints.some((h) => {
    const hint = h.trim().toLowerCase();
    return hint && (hint === name || name.includes(hint) || hint.includes(name));
  });
}

/**
 * Whether a series may be used for this document at all.
 *
 * Document type, register and "in use" are hard rules. A plant / state
 * restriction is hard only when the supply's plant is KNOWN (a
 * manufacturing row): a Maharashtra book must not number a Rewari
 * dispatch. A trading row has no plant, so a restricted book stays
 * available there and is simply ranked below the ones that fit.
 */
export function seriesApplies(s: SeriesMatchLike, ctx: SeriesContext): boolean {
  if (s.active === false) return false;
  if (s.docType !== ctx.docType) return false;
  if (!(s.business === "both" || s.business === ctx.business)) return false;
  const plant = up(ctx.plant);
  if (plant) {
    const plants = (s.plants || []).map(up).filter(Boolean);
    const states = (s.states || []).map(up).filter(Boolean);
    if (plants.length && !plants.includes(plant)) return false;
    if (!plants.length && states.length && ctx.state && !states.includes(up(ctx.state))) return false;
  }
  return true;
}

/** Lower is better: client's own book, then plant/state fit, then the default. */
export function seriesScore(s: SeriesMatchLike, ctx: SeriesContext): number {
  const plant = up(ctx.plant);
  const state = up(ctx.state);
  const plants = (s.plants || []).map(up).filter(Boolean);
  const states = (s.states || []).map(up).filter(Boolean);
  const scoped = plants.length > 0 || states.length > 0;
  const scopeFit = scoped && ((plant && plants.includes(plant)) || (state && states.includes(state)));
  return (clientHit(s, ctx.client) ? 0 : 4) + (scopeFit ? 0 : scoped ? 3 : 2) + (s.isDefault ? 0 : 1);
}

/** The series a person may pick for this document, best first. Stable for ties. */
export function rankSeries<T extends SeriesMatchLike>(all: T[], ctx: SeriesContext): T[] {
  return all
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => seriesApplies(s, ctx))
    .sort((a, b) => seriesScore(a.s, ctx) - seriesScore(b.s, ctx) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * The pattern with prefix / suffix written in, the running number and
 * dates left as tokens — two series with the same resolved pattern would
 * print the same numbers, which is a duplicate waiting to happen.
 */
export function resolvedPattern(s: SeriesFormatLike): string {
  return String(s.pattern || "")
    .replace(/\{\s*prefix\s*\}/gi, String(s.prefix || ""))
    .replace(/\{\s*suffix\s*\}/gi, String(s.suffix || ""))
    .replace(/\{\s*(seq|n)\s*\}/gi, "{SEQ}")
    .replace(/\{\s*(fy|yyyy-yy)\s*\}/gi, "{FY}")
    .replace(/\{\s*(fyshort|yy-yy)\s*\}/gi, "{FYSHORT}")
    .trim()
    .toUpperCase();
}

/**
 * Does a typed or imported document number belong to this series? Used to
 * file a number into the right book (Tally import, Excel import) so the
 * duplicate check is per series. The date tokens accept any year.
 */
export function numberMatchesSeries(s: SeriesFormatLike, number: string): boolean {
  const target = String(number || "").trim().toUpperCase();
  if (!target) return false;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = resolvedPattern(s);
  let rx = "";
  let rest = pattern;
  const tokenRx = /\{(SEQ|FY|FYSHORT|YYYY|YY|MM)\}/;
  while (rest) {
    const m = rest.match(tokenRx);
    if (!m || m.index === undefined) { rx += esc(rest); break; }
    rx += esc(rest.slice(0, m.index));
    rx += m[1] === "SEQ" ? "(\\d+)" : m[1] === "FY" ? "\\d{4}-\\d{2}" : m[1] === "FYSHORT" ? "\\d{2}-\\d{2}" : m[1] === "YYYY" ? "\\d{4}" : "\\d{2}";
    rest = rest.slice(m.index + m[0].length);
  }
  if (!rx.includes("(\\d+)")) return false;
  return new RegExp(`^${rx}$`).test(target);
}
