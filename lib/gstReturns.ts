/**
 * Biome Platform — GST returns
 * -------------------------------------------------------------------
 * Parses the JSON files the GST portal itself hands you, into flat,
 * invoice-wise rows you can read, export and reconcile against books.
 *
 * WHY JSON UPLOAD RATHER THAN AUTOMATED PORTAL LOGIN
 * gst.gov.in login is protected by a captcha and an OTP, and its terms
 * forbid automated access. Driving it with a stored username/password
 * would mean defeating those controls — so this module deliberately does
 * not do that. Instead it reads the official downloads:
 *
 *   GSTR-2B  ->  Returns Dashboard > GSTR-2B > Download > JSON
 *   GSTR-1   ->  Returns Dashboard > GSTR-1 > Download > JSON
 *                (or the GSTR-1 JSON your billing software files)
 *
 * That is a two-click export, works for every taxpayer with no extra
 * subscription, and is exactly as invoice-level as an API pull. For fully
 * hands-off syncing there is a licensed-GSP path — see lib/gstp.ts.
 *
 * Both formats are versioned by the GSTN and vary a little between
 * releases, so every field read here is defensive: a missing or renamed
 * key yields null rather than throwing away the whole file.
 */

// ---------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------

export type GstReturnKind = "GSTR1" | "GSTR2A" | "GSTR2B";

/** One invoice line as it appears in a return, flattened. */
export interface GstInvoiceRow {
  /** Which section of the return it came from: B2B, CDNR, B2BA, ... */
  section: string;
  /** Counterparty GSTIN (supplier for 2B, customer for GSTR-1). */
  counterpartyGstin: string | null;
  counterpartyName: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  /** "Invoice", "Credit Note", "Debit Note" */
  documentType: string;
  /** R = regular, SEZ, DE (deemed export), etc, as filed. */
  supplyType: string | null;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalTax: number;
  /** Invoice value as declared on the document. */
  invoiceValue: number | null;
  /** 2B only: is the ITC available to claim? */
  itcAvailable: boolean | null;
  /** 2B only: reason ITC is blocked, when it is. */
  itcReason: string | null;
  /** 2B only: when the supplier filed the return carrying this invoice. */
  supplierFilingDate: string | null;
  /** e-invoice reference number, when present. */
  irn: string | null;
  /** Distinct GST rates present on the invoice, e.g. [5, 18]. */
  rates: number[];
}

export interface GstReturnSummary {
  kind: GstReturnKind;
  /** Our own GSTIN, as recorded in the file. */
  gstin: string | null;
  /** Return period, normalised to "MM-YYYY". */
  period: string | null;
  rowCount: number;
  counterpartyCount: number;
  totalTaxableValue: number;
  totalIgst: number;
  totalCgst: number;
  totalSgst: number;
  totalCess: number;
  totalTax: number;
  /** Row counts per section, so you can see what the file actually held. */
  sections: Record<string, number>;
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
}

export interface ParsedGstReturn {
  summary: GstReturnSummary;
  rows: GstInvoiceRow[];
}

// ---------------------------------------------------------------------
// Field helpers — every one tolerant of missing / renamed keys
// ---------------------------------------------------------------------

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** GST portal dates are DD-MM-YYYY. Normalise to YYYY-MM-DD. */
function gstDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmySlash = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) return `${dmySlash[3]}-${dmySlash[2]}-${dmySlash[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s; // hand back whatever it was rather than losing it
}

/** Return periods come as "072026" (MMYYYY). Show as "07-2026". */
function gstPeriod(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

function yn(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase() === "Y";
}

// ---------------------------------------------------------------------
// GSTR-2B  (inward supplies — what suppliers reported against us)
// ---------------------------------------------------------------------

/**
 * 2B line items live under `items[]` with keys rt/txval/igst/cgst/sgst/cess.
 * Credit/debit notes use `nt`-prefixed keys for the document itself but the
 * same item keys.
 */
function sum2bItems(items: any[]): {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  rates: number[];
} {
  const rates = new Set<number>();
  let taxableValue = 0,
    igst = 0,
    cgst = 0,
    sgst = 0,
    cess = 0;
  for (const it of Array.isArray(items) ? items : []) {
    taxableValue += num(it.txval);
    igst += num(it.igst);
    cgst += num(it.cgst);
    sgst += num(it.sgst);
    cess += num(it.cess);
    const r = num(it.rt);
    if (r) rates.add(r);
  }
  return { taxableValue, igst, cgst, sgst, cess, rates: [...rates].sort((a, b) => a - b) };
}

const DOC_TYPE_FROM_NT: Record<string, string> = { C: "Credit Note", D: "Debit Note" };

function parseGstr2b(root: any): ParsedGstReturn {
  const warnings: string[] = [];
  const data = root?.data ?? root;
  const docdata = data?.docdata ?? data;

  if (!docdata || typeof docdata !== "object") {
    throw new Error(
      "This doesn't look like a GSTR-2B JSON file — no `docdata` section was found. Download it from Returns Dashboard → GSTR-2B → Download → JSON."
    );
  }

  const rows: GstInvoiceRow[] = [];
  const sections: Record<string, number> = {};

  /** Invoice-style sections: b2b (and its amendment b2ba). */
  const invoiceSections: [string, string][] = [
    ["b2b", "B2B"],
    ["b2ba", "B2B Amendment"],
  ];
  for (const [key, label] of invoiceSections) {
    const groups = docdata[key];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const supplier = {
        gstin: str(g.ctin),
        name: str(g.trdnm),
        filingDate: gstDate(g.supfilingdt),
      };
      for (const inv of Array.isArray(g.inv) ? g.inv : []) {
        const t = sum2bItems(inv.items);
        rows.push({
          section: label,
          counterpartyGstin: supplier.gstin,
          counterpartyName: supplier.name,
          invoiceNo: str(inv.inum),
          invoiceDate: gstDate(inv.dt),
          documentType: "Invoice",
          supplyType: str(inv.typ),
          placeOfSupply: str(inv.pos),
          reverseCharge: yn(inv.rev),
          taxableValue: t.taxableValue,
          igst: t.igst,
          cgst: t.cgst,
          sgst: t.sgst,
          cess: t.cess,
          totalTax: t.igst + t.cgst + t.sgst + t.cess,
          invoiceValue: inv.val === undefined ? null : num(inv.val),
          itcAvailable: inv.itcavl === undefined ? null : yn(inv.itcavl),
          itcReason: str(inv.rsn),
          supplierFilingDate: supplier.filingDate,
          irn: str(inv.irn),
          rates: t.rates,
        });
        sections[label] = (sections[label] || 0) + 1;
      }
    }
  }

  /** Credit / debit note sections use `nt[]` and `ntnum`/`ntdt`/`typ`. */
  const noteSections: [string, string][] = [
    ["cdnr", "Credit/Debit Note"],
    ["cdnra", "Credit/Debit Note Amendment"],
  ];
  for (const [key, label] of noteSections) {
    const groups = docdata[key];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const n of Array.isArray(g.nt) ? g.nt : []) {
        const t = sum2bItems(n.items);
        rows.push({
          section: label,
          counterpartyGstin: str(g.ctin),
          counterpartyName: str(g.trdnm),
          invoiceNo: str(n.ntnum),
          invoiceDate: gstDate(n.ntdt),
          documentType: DOC_TYPE_FROM_NT[String(n.typ ?? "").toUpperCase()] || "Credit/Debit Note",
          supplyType: str(n.suptyp),
          placeOfSupply: str(n.pos),
          reverseCharge: yn(n.rev),
          taxableValue: t.taxableValue,
          igst: t.igst,
          cgst: t.cgst,
          sgst: t.sgst,
          cess: t.cess,
          totalTax: t.igst + t.cgst + t.sgst + t.cess,
          invoiceValue: n.val === undefined ? null : num(n.val),
          itcAvailable: n.itcavl === undefined ? null : yn(n.itcavl),
          itcReason: str(n.rsn),
          supplierFilingDate: gstDate(g.supfilingdt),
          irn: str(n.irn),
          rates: t.rates,
        });
        sections[label] = (sections[label] || 0) + 1;
      }
    }
  }

  /** ISD credit and import of goods, so totals actually tie to the portal. */
  for (const [key, label] of [
    ["isd", "ISD Credit"],
    ["impg", "Import of Goods"],
    ["impgsez", "Import of Goods (SEZ)"],
  ] as [string, string][]) {
    const list = docdata[key];
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      const igst = num(d.igst),
        cgst = num(d.cgst),
        sgst = num(d.sgst),
        cess = num(d.cess);
      rows.push({
        section: label,
        counterpartyGstin: str(d.ctin ?? d.gstin),
        counterpartyName: str(d.trdnm),
        invoiceNo: str(d.docnum ?? d.boenum ?? d.dtnum),
        invoiceDate: gstDate(d.docdt ?? d.boedt ?? d.dtdt),
        documentType: label,
        supplyType: null,
        placeOfSupply: str(d.pos),
        reverseCharge: false,
        taxableValue: num(d.txval),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: igst + cgst + sgst + cess,
        invoiceValue: d.val === undefined ? null : num(d.val),
        itcAvailable: d.itcavl === undefined ? null : yn(d.itcavl),
        itcReason: str(d.rsn),
        supplierFilingDate: null,
        irn: null,
        rates: [],
      });
      sections[label] = (sections[label] || 0) + 1;
    }
  }

  if (!rows.length) {
    warnings.push(
      "The file parsed cleanly but contained no invoices — check you downloaded the right return period."
    );
  }

  return {
    summary: buildSummary("GSTR2B", str(data?.gstin), gstPeriod(data?.rtnprd), rows, sections, warnings),
    rows,
  };
}

// ---------------------------------------------------------------------
// GSTR-1  (outward supplies — what we reported)
// ---------------------------------------------------------------------

/**
 * GSTR-1 nests each rate line as `itms[].itm_det` with keys
 * rt/txval/iamt/camt/samt/csamt — different names from 2B, same meaning.
 */
function sumGstr1Items(items: any[]): {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  rates: number[];
} {
  const rates = new Set<number>();
  let taxableValue = 0,
    igst = 0,
    cgst = 0,
    sgst = 0,
    cess = 0;
  for (const wrapper of Array.isArray(items) ? items : []) {
    const d = wrapper?.itm_det ?? wrapper;
    taxableValue += num(d.txval);
    igst += num(d.iamt);
    cgst += num(d.camt);
    sgst += num(d.samt);
    cess += num(d.csamt);
    const r = num(d.rt);
    if (r) rates.add(r);
  }
  return { taxableValue, igst, cgst, sgst, cess, rates: [...rates].sort((a, b) => a - b) };
}

function parseGstr1(root: any): ParsedGstReturn {
  const warnings: string[] = [];
  // Some tools wrap the payload; accept both shapes.
  const data = root?.data ?? root;
  const rows: GstInvoiceRow[] = [];
  const sections: Record<string, number> = {};

  const push = (r: GstInvoiceRow) => {
    rows.push(r);
    sections[r.section] = (sections[r.section] || 0) + 1;
  };

  // ---- B2B and its amendment ----
  for (const [key, label] of [
    ["b2b", "B2B"],
    ["b2ba", "B2B Amendment"],
  ] as [string, string][]) {
    for (const g of Array.isArray(data[key]) ? data[key] : []) {
      for (const inv of Array.isArray(g.inv) ? g.inv : []) {
        const t = sumGstr1Items(inv.itms);
        push({
          section: label,
          counterpartyGstin: str(g.ctin),
          counterpartyName: str(g.cfs ?? g.trdnm),
          invoiceNo: str(inv.inum ?? inv.oinum),
          invoiceDate: gstDate(inv.idt ?? inv.oidt),
          documentType: "Invoice",
          supplyType: str(inv.inv_typ),
          placeOfSupply: str(inv.pos),
          reverseCharge: yn(inv.rchrg),
          taxableValue: t.taxableValue,
          igst: t.igst,
          cgst: t.cgst,
          sgst: t.sgst,
          cess: t.cess,
          totalTax: t.igst + t.cgst + t.sgst + t.cess,
          invoiceValue: inv.val === undefined ? null : num(inv.val),
          itcAvailable: null,
          itcReason: null,
          supplierFilingDate: null,
          irn: str(inv.irn),
          rates: t.rates,
        });
      }
    }
  }

  // ---- Credit / debit notes to registered parties ----
  for (const [key, label] of [
    ["cdnr", "Credit/Debit Note (Registered)"],
    ["cdnra", "Credit/Debit Note Amendment"],
  ] as [string, string][]) {
    for (const g of Array.isArray(data[key]) ? data[key] : []) {
      for (const n of Array.isArray(g.nt) ? g.nt : []) {
        const t = sumGstr1Items(n.itms);
        push({
          section: label,
          counterpartyGstin: str(g.ctin),
          counterpartyName: str(g.cfs),
          invoiceNo: str(n.nt_num ?? n.ont_num),
          invoiceDate: gstDate(n.nt_dt ?? n.ont_dt),
          documentType: DOC_TYPE_FROM_NT[String(n.ntty ?? "").toUpperCase()] || "Credit/Debit Note",
          supplyType: str(n.inv_typ),
          placeOfSupply: str(n.pos),
          reverseCharge: false,
          taxableValue: t.taxableValue,
          igst: t.igst,
          cgst: t.cgst,
          sgst: t.sgst,
          cess: t.cess,
          totalTax: t.igst + t.cgst + t.sgst + t.cess,
          invoiceValue: n.val === undefined ? null : num(n.val),
          itcAvailable: null,
          itcReason: null,
          supplierFilingDate: null,
          irn: null,
          rates: t.rates,
        });
      }
    }
  }

  // ---- Exports ----
  for (const g of Array.isArray(data.exp) ? data.exp : []) {
    for (const inv of Array.isArray(g.inv) ? g.inv : []) {
      const t = sumGstr1Items(inv.itms);
      push({
        section: "Exports",
        counterpartyGstin: null,
        counterpartyName: null,
        invoiceNo: str(inv.inum),
        invoiceDate: gstDate(inv.idt),
        documentType: "Invoice",
        supplyType: str(g.exp_typ),
        placeOfSupply: null,
        reverseCharge: false,
        taxableValue: t.taxableValue,
        igst: t.igst,
        cgst: t.cgst,
        sgst: t.sgst,
        cess: t.cess,
        totalTax: t.igst + t.cgst + t.sgst + t.cess,
        invoiceValue: inv.val === undefined ? null : num(inv.val),
        itcAvailable: null,
        itcReason: null,
        supplierFilingDate: null,
        irn: null,
        rates: t.rates,
      });
    }
  }

  // ---- B2C large (invoice-wise) ----
  for (const g of Array.isArray(data.b2cl) ? data.b2cl : []) {
    for (const inv of Array.isArray(g.inv) ? g.inv : []) {
      const t = sumGstr1Items(inv.itms);
      push({
        section: "B2C Large",
        counterpartyGstin: null,
        counterpartyName: null,
        invoiceNo: str(inv.inum),
        invoiceDate: gstDate(inv.idt),
        documentType: "Invoice",
        supplyType: null,
        placeOfSupply: str(g.pos),
        reverseCharge: false,
        taxableValue: t.taxableValue,
        igst: t.igst,
        cgst: t.cgst,
        sgst: t.sgst,
        cess: t.cess,
        totalTax: t.igst + t.cgst + t.sgst + t.cess,
        invoiceValue: inv.val === undefined ? null : num(inv.val),
        itcAvailable: null,
        itcReason: null,
        supplierFilingDate: null,
        irn: null,
        rates: t.rates,
      });
    }
  }

  // ---- B2C small: rate-wise only, never invoice-wise. Say so plainly
  //      rather than inventing invoice numbers for it. ----
  const b2cs = Array.isArray(data.b2cs) ? data.b2cs : [];
  if (b2cs.length) {
    for (const r of b2cs) {
      const igst = num(r.iamt),
        cgst = num(r.camt),
        sgst = num(r.samt),
        cess = num(r.csamt);
      push({
        section: "B2C Small (rate-wise)",
        counterpartyGstin: null,
        counterpartyName: null,
        invoiceNo: null,
        invoiceDate: null,
        documentType: "Consolidated",
        supplyType: str(r.typ),
        placeOfSupply: str(r.pos),
        reverseCharge: false,
        taxableValue: num(r.txval),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: igst + cgst + sgst + cess,
        invoiceValue: null,
        itcAvailable: null,
        itcReason: null,
        supplierFilingDate: null,
        irn: null,
        rates: num(r.rt) ? [num(r.rt)] : [],
      });
    }
    warnings.push(
      "B2C Small is filed rate-wise, not invoice-wise, so those lines have no invoice number — that's how GSTR-1 works, not a parsing gap."
    );
  }

  if (!rows.length) {
    throw new Error(
      "No GSTR-1 sections (b2b, cdnr, exp, b2cl, b2cs) were found in this file. Make sure it's a GSTR-1 JSON, not a GSTR-2B or a summary."
    );
  }

  return {
    summary: buildSummary("GSTR1", str(data?.gstin), gstPeriod(data?.fp), rows, sections, warnings),
    rows,
  };
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

function buildSummary(
  kind: GstReturnKind,
  gstin: string | null,
  period: string | null,
  rows: GstInvoiceRow[],
  sections: Record<string, number>,
  warnings: string[]
): GstReturnSummary {
  const counterparties = new Set(rows.map((r) => r.counterpartyGstin).filter(Boolean));
  const total = (pick: (r: GstInvoiceRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return {
    kind,
    gstin,
    period,
    rowCount: rows.length,
    counterpartyCount: counterparties.size,
    totalTaxableValue: total((r) => r.taxableValue),
    totalIgst: total((r) => r.igst),
    totalCgst: total((r) => r.cgst),
    totalSgst: total((r) => r.sgst),
    totalCess: total((r) => r.cess),
    totalTax: total((r) => r.totalTax),
    sections,
    warnings,
  };
}

/** Guess which return a JSON blob is, so the user doesn't have to say. */
/**
 * GSTR-2A is the older, dynamic inward-supplies view. Its invoice sections
 * are structurally close to the B2B portions of 2B, so we reuse the same
 * defensive parser and label the result as 2A. This keeps the app useful for
 * legacy JSON exports without pretending that 2A has 2B's static ITC status.
 */
function parseGstr2a(root: any): ParsedGstReturn {
  const parsed = parseGstr2b(root);
  return {
    ...parsed,
    summary: {
      ...parsed.summary,
      kind: "GSTR2A",
      warnings: [
        "GSTR-2A is a legacy dynamic statement. ITC availability fields may not be present; use GSTR-2B for the static ITC view.",
        ...parsed.summary.warnings,
      ],
    },
  };
}

export function detectReturnKind(root: any): GstReturnKind | null {
  const data = root?.data ?? root;
  if (data?.docdata || root?.data?.docdata) return "GSTR2B";
  if (data?.rtnprd && data?.docdata) return "GSTR2B";
  if (data?.fp && (data?.b2b || data?.b2cs || data?.cdnr || data?.exp || data?.b2cl)) return "GSTR1";
  if (data?.b2b && Array.isArray(data.b2b) && data.b2b[0]?.inv?.[0]?.itms) return "GSTR1";
  if (data?.b2b && Array.isArray(data.b2b) && data.b2b[0]?.inv?.[0]?.items) return "GSTR2B";
  return null;
}

/**
 * Parse a GST return JSON string or object into invoice-wise rows.
 * @param kind pass "auto" to detect from the file's own shape.
 */
export function parseGstReturn(input: string | object, kind: GstReturnKind | "auto" = "auto"): ParsedGstReturn {
  let root: any;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch {
      throw new Error(
        "That file isn't valid JSON. If you downloaded a ZIP from the portal, unzip it first and upload the .json inside."
      );
    }
  } else {
    root = input;
  }

  const resolved = kind === "auto" ? detectReturnKind(root) : kind;
  if (!resolved) {
    throw new Error(
      "Couldn't identify this GST return. Pick GSTR-1, GSTR-2A or GSTR-2B explicitly and try again."
    );
  }
  if (resolved === "GSTR2B") return parseGstr2b(root);
  if (resolved === "GSTR2A") return parseGstr2a(root);
  return parseGstr1(root);
}

// ---------------------------------------------------------------------
// GST vs books reconciliation
// ---------------------------------------------------------------------

export type GstMatchStatus =
  | "Matched"
  | "Tax Amount Mismatch"
  | "Taxable Value Mismatch"
  | "Date Mismatch"
  | "Only in GST Portal"
  | "Only in Books"
  | "Probable Match (different invoice no)";

export interface BooksInvoice {
  invoiceNo: string | null;
  invoiceDate: string | null;
  counterpartyGstin: string | null;
  counterpartyName: string | null;
  taxableValue: number;
  totalTax: number;
}

export interface GstReconRow {
  status: GstMatchStatus;
  invoiceNo: string | null;
  counterpartyGstin: string | null;
  counterpartyName: string | null;
  portalTaxableValue: number | null;
  booksTaxableValue: number | null;
  taxableDifference: number | null;
  portalTax: number | null;
  booksTax: number | null;
  taxDifference: number | null;
  portalDate: string | null;
  booksDate: string | null;
  /** 2B only, and the reason a lot of ITC gets denied. */
  itcAvailable: boolean | null;
  note: string;
}

/** Invoice numbers are written inconsistently everywhere — normalise hard. */
export function gstInvoiceKey(gstin: string | null, invoiceNo: string | null): string {
  const g = (gstin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const i = (invoiceNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  return `${g}|${i}`;
}

export interface GstReconOptions {
  /** Rupee tolerance before a difference is flagged. Default 1. */
  amountTolerance?: number;
  /** Days of date drift allowed before flagging. Default 0. */
  dateToleranceDays?: number;
}

/**
 * Match portal invoices against book invoices, keyed on
 * counterparty GSTIN + normalised invoice number, then fall back to a
 * value-based probable match so a mistyped invoice number still surfaces
 * as "probable" rather than two separate one-sided rows.
 */
export function reconcileGstWithBooks(
  portalRows: GstInvoiceRow[],
  booksRows: BooksInvoice[],
  options: GstReconOptions = {}
): { rows: GstReconRow[]; counts: Record<GstMatchStatus, number> } {
  const tol = options.amountTolerance ?? 1;
  const dayTol = options.dateToleranceDays ?? 0;

  const booksByKey = new Map<string, BooksInvoice[]>();
  for (const b of booksRows) {
    const k = gstInvoiceKey(b.counterpartyGstin, b.invoiceNo);
    if (!booksByKey.has(k)) booksByKey.set(k, []);
    booksByKey.get(k)!.push(b);
  }

  const usedBooks = new Set<BooksInvoice>();
  const out: GstReconRow[] = [];

  const daysApart = (a: string | null, b: string | null): number | null => {
    if (!a || !b) return null;
    const da = new Date(a).getTime(),
      db = new Date(b).getTime();
    if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
    return Math.abs(da - db) / 86400000;
  };

  for (const p of portalRows) {
    // Consolidated B2C rows have no invoice number to match on.
    if (!p.invoiceNo) continue;

    const key = gstInvoiceKey(p.counterpartyGstin, p.invoiceNo);
    const candidates = (booksByKey.get(key) || []).filter((b) => !usedBooks.has(b));
    let match: BooksInvoice | null = candidates.length ? candidates[0] : null;
    let probable = false;

    if (!match) {
      // Same counterparty, same money, different invoice number — almost
      // always a typo on one side rather than a genuinely missing invoice.
      match =
        booksRows.find(
          (b) =>
            !usedBooks.has(b) &&
            (b.counterpartyGstin || "").toUpperCase() === (p.counterpartyGstin || "").toUpperCase() &&
            Math.abs(b.taxableValue - p.taxableValue) <= tol &&
            Math.abs(b.totalTax - p.totalTax) <= tol
        ) || null;
      if (match) probable = true;
    }

    if (!match) {
      out.push({
        status: "Only in GST Portal",
        invoiceNo: p.invoiceNo,
        counterpartyGstin: p.counterpartyGstin,
        counterpartyName: p.counterpartyName,
        portalTaxableValue: p.taxableValue,
        booksTaxableValue: null,
        taxableDifference: null,
        portalTax: p.totalTax,
        booksTax: null,
        taxDifference: null,
        portalDate: p.invoiceDate,
        booksDate: null,
        itcAvailable: p.itcAvailable,
        note:
          p.itcAvailable === false
            ? `In the portal but not in books, and ITC is blocked${p.itcReason ? ` (${p.itcReason})` : ""}.`
            : "Reported in the portal but not found in books — likely an unrecorded purchase.",
      });
      continue;
    }

    usedBooks.add(match);
    const taxableDiff = p.taxableValue - match.taxableValue;
    const taxDiff = p.totalTax - match.totalTax;
    const drift = daysApart(p.invoiceDate, match.invoiceDate);

    let status: GstMatchStatus = "Matched";
    let note = "Portal and books agree.";
    if (probable) {
      status = "Probable Match (different invoice no)";
      note = `Amounts agree but the invoice number differs — portal has "${p.invoiceNo}", books have "${match.invoiceNo}".`;
    } else if (Math.abs(taxDiff) > tol) {
      status = "Tax Amount Mismatch";
      note = `Tax differs by ${taxDiff.toFixed(2)}.`;
    } else if (Math.abs(taxableDiff) > tol) {
      status = "Taxable Value Mismatch";
      note = `Taxable value differs by ${taxableDiff.toFixed(2)}.`;
    } else if (drift !== null && drift > dayTol) {
      status = "Date Mismatch";
      note = `Invoice dates differ by ${Math.round(drift)} day(s).`;
    }

    out.push({
      status,
      invoiceNo: p.invoiceNo,
      counterpartyGstin: p.counterpartyGstin,
      counterpartyName: p.counterpartyName || match.counterpartyName,
      portalTaxableValue: p.taxableValue,
      booksTaxableValue: match.taxableValue,
      taxableDifference: taxableDiff,
      portalTax: p.totalTax,
      booksTax: match.totalTax,
      taxDifference: taxDiff,
      portalDate: p.invoiceDate,
      booksDate: match.invoiceDate,
      itcAvailable: p.itcAvailable,
      note,
    });
  }

  for (const b of booksRows) {
    if (usedBooks.has(b)) continue;
    out.push({
      status: "Only in Books",
      invoiceNo: b.invoiceNo,
      counterpartyGstin: b.counterpartyGstin,
      counterpartyName: b.counterpartyName,
      portalTaxableValue: null,
      booksTaxableValue: b.taxableValue,
      taxableDifference: null,
      portalTax: null,
      booksTax: b.totalTax,
      taxDifference: null,
      portalDate: null,
      booksDate: b.invoiceDate,
      itcAvailable: null,
      note: "Recorded in books but the supplier hasn't reported it — chase them before the ITC deadline.",
    });
  }

  const counts = out.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<GstMatchStatus, number>
  );

  return { rows: out, counts };
}

/** Flatten rows for CSV/Excel export, with human column names. */
export function gstRowsToExportTable(rows: GstInvoiceRow[]): Record<string, any>[] {
  return rows.map((r) => ({
    Section: r.section,
    "Counterparty GSTIN": r.counterpartyGstin ?? "",
    "Counterparty Name": r.counterpartyName ?? "",
    "Document Type": r.documentType,
    "Invoice/Note No": r.invoiceNo ?? "",
    "Invoice/Note Date": r.invoiceDate ?? "",
    "Place of Supply": r.placeOfSupply ?? "",
    "Reverse Charge": r.reverseCharge ? "Yes" : "No",
    "GST Rate(s)": r.rates.join(", "),
    "Taxable Value": r.taxableValue,
    IGST: r.igst,
    CGST: r.cgst,
    SGST: r.sgst,
    Cess: r.cess,
    "Total Tax": r.totalTax,
    "Invoice Value": r.invoiceValue ?? "",
    "ITC Available": r.itcAvailable === null ? "" : r.itcAvailable ? "Yes" : "No",
    "ITC Blocked Reason": r.itcReason ?? "",
    "Supplier Filing Date": r.supplierFilingDate ?? "",
    IRN: r.irn ?? "",
  }));
}

export function gstReconToExportTable(rows: GstReconRow[]): Record<string, any>[] {
  return rows.map((r) => ({
    Status: r.status,
    "Invoice No": r.invoiceNo ?? "",
    "Counterparty GSTIN": r.counterpartyGstin ?? "",
    "Counterparty Name": r.counterpartyName ?? "",
    "Portal Taxable Value": r.portalTaxableValue ?? "",
    "Books Taxable Value": r.booksTaxableValue ?? "",
    "Taxable Difference": r.taxableDifference ?? "",
    "Portal Tax": r.portalTax ?? "",
    "Books Tax": r.booksTax ?? "",
    "Tax Difference": r.taxDifference ?? "",
    "Portal Date": r.portalDate ?? "",
    "Books Date": r.booksDate ?? "",
    "ITC Available": r.itcAvailable === null ? "" : r.itcAvailable ? "Yes" : "No",
    Note: r.note,
  }));
}
