/**
 * Biome Platform — Ledger normalisation
 * -------------------------------------------------------------------
 * Pass 2 of the ledger agent: turn raw sheet rows into clean transactions
 * using the structure the AI worked out in pass 1.
 *
 * This is deliberately plain, deterministic code. The AI decides WHICH
 * column is the debit; this file decides WHAT THE NUMBER IS. Keeping that
 * split means a model can never invent, round or drift a figure that ends
 * up in a reconciliation report.
 */

export type ColumnRole =
  | "date"
  | "docNo"
  | "particulars"
  | "voucherType"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "gstin"
  | "ignore";

export interface LedgerColumn {
  index: number;
  header: string;
  role: ColumnRole;
  why?: string;
}

export interface LedgerStructure {
  ledgerOwner?: string | null;
  counterparty?: string | null;
  period?: string | null;
  headerRowIndex: number;
  firstDataRowIndex: number;
  columns: LedgerColumn[];
  excludeRowPatterns?: string[];
  dateFormat?: string | null;
}

export interface LedgerTxn {
  /** Row number in the original file, so a user can go and look at it. */
  sourceRow: number;
  date: string | null;
  docNo: string | null;
  particulars: string | null;
  voucherType: string | null;
  debit: number;
  credit: number;
  /** debit - credit, the signed movement. */
  net: number;
  gstin: string | null;
}

export interface NormaliseResult {
  transactions: LedgerTxn[];
  excluded: { sourceRow: number; reason: string; text: string }[];
  totals: { debit: number; credit: number; net: number; count: number };
  warnings: string[];
}

/** Lines that are summaries, not transactions. */
const DEFAULT_EXCLUDES = [
  "opening balance",
  "closing balance",
  "carried forward",
  "brought forward",
  "c/f",
  "b/f",
  "total",
  "grand total",
  "sub total",
  "subtotal",
  "by balance",
  "to balance",
];

/** Indian sheets write numbers as "1,18,000.00", "(5,000)", "5000 Dr", "₹ 500". */
export function parseAmount(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;

  let s = String(raw).trim();
  if (!s) return 0;

  // Trailing Dr/Cr markers carry sign meaning in Tally exports — with or
  // without a space ("5,000.00Dr" used to read as 0).
  let sign = 1;
  const drCr = s.match(/(dr|cr)\.?$/i);
  if (drCr && /[\d)\s]$/.test(s.slice(0, drCr.index))) {
    if (drCr[1].toLowerCase() === "cr") sign = -1;
    s = s.slice(0, drCr.index).trim();
  }
  // Tally's own text form of a negative is "(-)5,000.00".
  if (s.startsWith("(-)")) {
    sign *= -1;
    s = s.slice(3);
  } else if (/^\(.*\)$/.test(s)) {
    // Accounting negatives are parenthesised.
    sign *= -1;
    s = s.slice(1, -1);
  }

  s = s.replace(/[₹$,\s]/g, "");
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1);
  }
  if (s === "" || s === "-") return 0;

  const n = Number(s);
  return Number.isFinite(n) ? n * sign : 0;
}

/**
 * Dates arrive as DD-MM-YYYY, DD/MM/YY, "1-Apr-2026", or an Excel serial.
 * Everything normalises to YYYY-MM-DD; anything unreadable returns null
 * rather than a wrong date.
 */
export function parseLedgerDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Excel stores dates as days since 1899-12-30.
  if (typeof raw === "number" && raw > 20000 && raw < 60000) {
    const ms = Math.round((raw - 25569) * 86400000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  // 1-Apr-2026 / 01 April 26
  const named = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,})[-\s\/](\d{2,4})$/);
  if (named) {
    const mm = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mm) {
      const yy = named[3].length === 2 ? `20${named[3]}` : named[3];
      return `${yy}-${mm}-${named[1].padStart(2, "0")}`;
    }
  }

  // DD-MM-YYYY or DD/MM/YY — day-first, which is the Indian convention.
  const dmy = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
}

function cell(row: any[], index: number | undefined): unknown {
  if (index === undefined || index < 0) return null;
  return Array.isArray(row) ? row[index] : null;
}

/**
 * Apply a structure to raw rows and produce clean transactions.
 * Rows that are balances or totals are excluded and reported, never
 * silently dropped — a missing row is a reconciliation bug nobody spots.
 */
export function normaliseLedger(rawRows: any[][], structure: LedgerStructure): NormaliseResult {
  const warnings: string[] = [];
  const byRole = new Map<ColumnRole, number>();
  for (const c of structure.columns || []) {
    if (c.role !== "ignore" && !byRole.has(c.role)) byRole.set(c.role, c.index);
  }

  const iDate = byRole.get("date");
  const iDoc = byRole.get("docNo");
  const iPart = byRole.get("particulars");
  const iVch = byRole.get("voucherType");
  const iDebit = byRole.get("debit");
  const iCredit = byRole.get("credit");
  const iAmount = byRole.get("amount");
  const iGstin = byRole.get("gstin");

  if (iDebit === undefined && iCredit === undefined && iAmount === undefined) {
    warnings.push("No amount column was mapped — every transaction will read as zero.");
  }

  const excludes = [
    ...DEFAULT_EXCLUDES,
    ...(structure.excludeRowPatterns || []).map((p) => p.toLowerCase()),
  ];

  const transactions: LedgerTxn[] = [];
  const excluded: { sourceRow: number; reason: string; text: string }[] = [];

  const start = Math.max(0, structure.firstDataRowIndex ?? (structure.headerRowIndex ?? 0) + 1);

  for (let r = start; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const joined = row.map((c) => String(c ?? "").trim()).join(" ").trim();
    if (!joined) continue; // blank spacer row

    const lower = joined.toLowerCase();
    const hit = excludes.find((p) => lower.includes(p));
    if (hit) {
      excluded.push({ sourceRow: r, reason: `Looks like a "${hit}" line, not a transaction`, text: joined.slice(0, 120) });
      continue;
    }

    let debit = 0;
    let credit = 0;
    if (iAmount !== undefined && iDebit === undefined && iCredit === undefined) {
      // One signed column: positive is a debit, negative a credit.
      const v = parseAmount(cell(row, iAmount));
      if (v >= 0) debit = v;
      else credit = Math.abs(v);
    } else {
      debit = Math.abs(parseAmount(cell(row, iDebit)));
      credit = Math.abs(parseAmount(cell(row, iCredit)));
    }

    const date = parseLedgerDate(cell(row, iDate));
    const docNo = String(cell(row, iDoc) ?? "").trim() || null;

    // A row with no money and no document number carries nothing.
    if (debit === 0 && credit === 0 && !docNo) {
      excluded.push({ sourceRow: r, reason: "No amount and no document number", text: joined.slice(0, 120) });
      continue;
    }

    transactions.push({
      sourceRow: r,
      date,
      docNo,
      particulars: String(cell(row, iPart) ?? "").trim() || null,
      voucherType: String(cell(row, iVch) ?? "").trim() || null,
      debit,
      credit,
      net: debit - credit,
      gstin: String(cell(row, iGstin) ?? "").trim().toUpperCase() || null,
    });
  }

  const totals = transactions.reduce(
    (acc, t) => {
      acc.debit += t.debit;
      acc.credit += t.credit;
      acc.net += t.net;
      acc.count += 1;
      return acc;
    },
    { debit: 0, credit: 0, net: 0, count: 0 }
  );

  if (!transactions.length) {
    warnings.push(
      "No transactions were read. The header row may have been misidentified — check the detected structure."
    );
  }
  const undated = transactions.filter((t) => !t.date).length;
  if (undated > transactions.length * 0.3 && transactions.length > 0) {
    warnings.push(`${undated} of ${transactions.length} rows have no readable date — check the date column.`);
  }

  return { transactions, excluded, totals, warnings };
}

/**
 * Normalise a document number so the same invoice matches however it was
 * typed. Each segment is stripped of its own leading zeros before joining,
 * because the padding is usually internal:
 *
 *   "BI/26-27/0786"  ->  BI 26 27 786  ->  "BI2627786"
 *   "BI-26-27-786"   ->  BI 26 27 786  ->  "BI2627786"   (same)
 *   "0044"           ->  44            ->  "44"
 */
export function docKey(raw: string | null): string {
  return String(raw || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((seg) => {
      // Only numeric segments get de-padded — "007A" is a real code, not 7A.
      if (/^[0-9]+$/.test(seg)) return seg.replace(/^0+/, "") || "0";
      return seg;
    })
    .join("");
}

export interface ReconMatch {
  oursIndex: number | null;
  theirsIndex: number | null;
  category: string;
  difference: number;
  explanation: string;
  action: string;
}

/**
 * Turn the agent's matches into export sheets, one per category — the
 * shape an accountant actually works through.
 */
export function buildLedgerExportSheets(
  matches: ReconMatch[],
  ours: LedgerTxn[],
  theirs: LedgerTxn[]
): Record<string, Record<string, any>[]> {
  const rowFor = (m: ReconMatch) => {
    const o = m.oursIndex !== null ? ours[m.oursIndex] : null;
    const t = m.theirsIndex !== null ? theirs[m.theirsIndex] : null;
    return {
      Category: m.category,
      "Our Row": o ? o.sourceRow + 1 : "",
      "Our Date": o?.date ?? "",
      "Our Doc No": o?.docNo ?? "",
      "Our Particulars": o?.particulars ?? "",
      "Our Debit": o?.debit ?? "",
      "Our Credit": o?.credit ?? "",
      "Their Row": t ? t.sourceRow + 1 : "",
      "Their Date": t?.date ?? "",
      "Their Doc No": t?.docNo ?? "",
      "Their Particulars": t?.particulars ?? "",
      "Their Debit": t?.debit ?? "",
      "Their Credit": t?.credit ?? "",
      Difference: m.difference,
      Explanation: m.explanation,
      "Action Required": m.action,
    };
  };

  const sheets: Record<string, Record<string, any>[]> = {
    "All Differences": matches.map(rowFor),
  };

  const categories = Array.from(new Set(matches.map((m) => m.category)));
  for (const cat of categories) {
    // Excel caps sheet names at 31 characters.
    sheets[cat.slice(0, 31)] = matches.filter((m) => m.category === cat).map(rowFor);
  }

  const summary = categories.map((cat) => {
    const inCat = matches.filter((m) => m.category === cat);
    return {
      Category: cat,
      Count: inCat.length,
      "Total Difference": inCat.reduce((s, m) => s + m.difference, 0),
    };
  });
  sheets["Summary"] = summary.sort(
    (a, b) => Math.abs(b["Total Difference"]) - Math.abs(a["Total Difference"])
  );

  return sheets;
}
