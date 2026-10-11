/**
 * Biome Platform — the coordination reference, built (pure, client + server)
 * -------------------------------------------------------------------
 * Every supply carries one reference, printed on our tax invoice /
 * delivery challan and quoted on every other paper of that supply:
 *
 *   Trading:        BDC / <our doc no> / <vendor code> / <vendor doc no>   BDC/15/SRN/39
 *   Manufacturing:  BDC / <our doc no> / <plant code>  / <our doc no>      BDC/810/REW/810
 *
 * "Doc no" here is only the NUMBER inside a document number — the last run
 * of digits, leading zeros dropped: BI/26-27/HR/0015 → 15, INV-39 → 39,
 * BIPL/2026-27/886 → 886. The year in the middle is never the number.
 *
 * No `fs`, no store: the coordination page builds the reference live as
 * the coordinator types, the API rebuilds it on save, and the data import
 * fills it for blank rows — all three from this one function, so they can
 * never disagree about what a reference should be.
 */

export const DEFAULT_COMPANY_CODE = "BDC";

/** Message shown when a trading vendor has no code in the registry. */
export const NO_VENDOR_CODE_WARNING = "Vendor has no code — add it in Vendor registration";

/**
 * The number inside a document number: the LAST run of digits, without
 * leading zeros. "" when there is no digit at all.
 *
 *   "BI/26-27/HR/0015" → "15"    "INV-39" → "39"    "BI-26-27-HR0786" → "786"
 *   "0000" → "0"                 "INV-39/A" → "39"  "ABC" → ""
 */
export function numericPart(v: unknown): string {
  const runs = String(v ?? "").match(/\d+/g);
  if (!runs || !runs.length) return "";
  const last = runs[runs.length - 1];
  const stripped = last.replace(/^0+/, "");
  return stripped || "0";
}

/** A code as it may appear inside a reference: letters and digits only. */
export function cleanCode(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface ReferenceInput {
  business: "trading" | "manufacturing";
  /** Our tax invoice / delivery challan number, as issued. */
  ourDocNo: string;
  /** Trading: the vendor's code from the registry. */
  vendorCode?: string;
  /** Trading: the vendor's invoice / challan number. */
  vendorDocNo?: string;
  /** Manufacturing: the plant the truck left from (REW, GKD…). */
  plant?: string;
  /** Company code, normally BDC (Settings → Automation can change it). */
  company?: string;
}

export interface BuiltReference {
  /** The full reference when complete, "" otherwise. */
  reference: string;
  /** What it would look like so far — "?" for each missing part. For display only. */
  partial: string;
  complete: boolean;
  /** Plain-English names of the missing parts. */
  missing: string[];
  /** Set when the vendor has no code — the coordinator must fix the registry. */
  warning: string;
}

/** Which vendor document number the reference quotes. */
export function vendorDocNoOf(t: {
  vendorDocType?: string;
  vendorInvoiceNo?: string;
  vendorChallanNo?: string;
}): string {
  const inv = String(t.vendorInvoiceNo || "").trim();
  const ch = String(t.vendorChallanNo || "").trim();
  if (t.vendorDocType === "tax_invoice") return inv || ch;
  if (t.vendorDocType === "delivery_challan") return ch || inv;
  return inv || ch;
}

export function buildReference(i: ReferenceInput): BuiltReference {
  const company = cleanCode(i.company) || DEFAULT_COMPANY_CODE;
  const our = numericPart(i.ourDocNo);
  const mfg = i.business === "manufacturing";
  const code = mfg ? cleanCode(i.plant) : cleanCode(i.vendorCode);
  const theirs = mfg ? our : numericPart(i.vendorDocNo);

  const missing: string[] = [];
  if (!our) missing.push("our invoice / challan no");
  if (!code) missing.push(mfg ? "plant" : "vendor code");
  if (!mfg && !theirs) missing.push("vendor invoice / challan no");

  const partial = `${company}/${our || "?"}/${code || "?"}/${theirs || "?"}`;
  const complete = missing.length === 0;
  return {
    reference: complete ? partial : "",
    partial,
    complete,
    missing,
    warning: !mfg && !code ? NO_VENDOR_CODE_WARNING : "",
  };
}

/** Same reference, ignoring case and spaces. */
export function sameReference(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "");
  return n(a) !== "" && n(a) === n(b);
}
