/**
 * Biome Platform — Tally balances, read the way Tally itself reports them
 * -------------------------------------------------------------------
 * One server-side module that every finance screen (home KPIs, Analytics,
 * Reports, the AI assistant, the Ledgers table) uses, so they can never
 * disagree with each other or with Tally's own Balance Sheet / P&L.
 *
 * The rules below are Tally's rules, not guesses:
 *
 *  1. SIGN. In Tally's XML a DEBIT balance is NEGATIVE and a CREDIT balance
 *     is POSITIVE ("-400000.00" = ₹4,00,000 Dr). Text-formatted amounts
 *     ("4,00,000.00 Dr", "(-)5,000.00") are read with the same meaning.
 *     Nothing is ever turned into a magnitude: a customer with a credit
 *     balance is an ADVANCE and reduces receivables; a vendor with a debit
 *     balance is an advance paid and reduces payables.
 *
 *  2. GROUPS. A ledger belongs to whatever predefined (reserved) group sits
 *     above it in the group tree — "NTPC Plants" under "Debtors - NTPC"
 *     under "Sundry Debtors" is a debtor. We walk the tree using each
 *     group's PARENT and RESERVEDNAME (so a renamed "Sundry Debtors" still
 *     counts). We never classify by words in a name.
 *
 *  3. PERIOD. Every request carries SVCURRENTCOMPANY, SVFROMDATE and
 *     SVTODATE. Without them Tally answers for whatever company is active
 *     on its screen and whatever period was last chosen with Alt+F2 —
 *     which is how one financial year's sales turn into three years' worth.
 *     Default period = current Indian financial year (1 April) to today;
 *     any other From–To can be asked for (resolvePeriod validates it).
 *     A reading never crosses 31 March: a long period is read one FY at a
 *     time and P&L movements are added up (fetchTallyFinance explains how).
 *     Balance-sheet figures are closing balances AS ON the To date.
 *
 *  4. NO STALE NUMBERS. Anything that touches the current month is read
 *     live every time; only readings of CLOSED past months are cached
 *     (a few hours), the company list is always read live, and Refresh
 *     bypasses the cache. Each piece of a long read is retried (busy or
 *     slow Tally). If Tally can't be read the caller gets an error, never
 *     old figures.
 */

export interface TallyRequestSettings {
  mode?: "direct" | "agent";
  host?: string;
  port?: number;
  agentUrl?: string;
  agentApiKey?: string;
}

/** Where to send a Tally XML request: straight to Tally's port (same PC or
 *  LAN) or through the Biome Tally Agent (cross-network). */
export function resolveTallyTarget(settings: TallyRequestSettings): {
  url: string;
  headers: Record<string, string>;
} {
  if (settings.mode === "agent") {
    const base = (settings.agentUrl || "").trim().replace(/\/+$/, "");
    return {
      url: `${base}/tally`,
      headers: {
        "Content-Type": "text/xml",
        Authorization: `Bearer ${settings.agentApiKey || ""}`,
        // Without this, ngrok's free-tier warning page comes back instead
        // of the actual response for any non-browser request.
        "ngrok-skip-browser-warning": "biome-platform",
      },
    };
  }
  const host = (settings.host || "localhost").trim() || "localhost";
  const port = Number(settings.port) > 0 ? Number(settings.port) : 9000;
  return { url: `http://${host}:${port}`, headers: { "Content-Type": "text/xml" } };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export type TallyCategory =
  | "cash"
  | "bank"
  | "bankOD"
  | "debtors"
  | "creditors"
  | "sales"
  | "purchases"
  | "dutiesTaxes"
  | "directExpenses"
  | "indirectExpenses"
  | "directIncomes"
  | "indirectIncomes"
  | "other";

/** Tally's predefined groups that decide what a ledger IS. Keys are
 *  normalised (lower case, single spaces). */
const RESERVED_GROUPS: Record<string, TallyCategory> = {
  "cash-in-hand": "cash",
  "cash in hand": "cash",
  "bank accounts": "bank",
  "bank od a/c": "bankOD",
  "bank occ a/c": "bankOD",
  "bank o/d a/c": "bankOD",
  "sundry debtors": "debtors",
  "sundry creditors": "creditors",
  "sales accounts": "sales",
  "purchase accounts": "purchases",
  "duties & taxes": "dutiesTaxes",
  "direct expenses": "directExpenses",
  "indirect expenses": "indirectExpenses",
  "direct incomes": "directIncomes",
  "indirect incomes": "indirectIncomes",
};

/** Display names, as Tally shows them. */
export const CATEGORY_LABEL: Record<TallyCategory, string> = {
  cash: "Cash-in-Hand",
  bank: "Bank Accounts",
  bankOD: "Bank OD A/c",
  debtors: "Sundry Debtors",
  creditors: "Sundry Creditors",
  sales: "Sales Accounts",
  purchases: "Purchase Accounts",
  dutiesTaxes: "Duties & Taxes",
  directExpenses: "Direct Expenses",
  indirectExpenses: "Indirect Expenses",
  directIncomes: "Direct Incomes",
  indirectIncomes: "Indirect Incomes",
  other: "Other",
};

/** Categories whose normal balance is a CREDIT (liabilities, income). */
const CREDIT_NATURE = new Set<TallyCategory>([
  "bankOD",
  "creditors",
  "sales",
  "dutiesTaxes",
  "directIncomes",
  "indirectIncomes",
]);

const norm = (s: string | null | undefined) =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* XML reading                                                         */
/* ------------------------------------------------------------------ */

/** Tally's entities. &#4; is Tally's marker in front of system values
 *  such as "&#4; Primary" and "&#4; Not Applicable" — it is dropped. */
export function decodeTally(s: string): string {
  return s
    .replace(/&#4;/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseAttrs(open: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(open))) out[m[1].toUpperCase()] = decodeTally(m[2]);
  return out;
}

export interface XmlObject {
  attrs: Record<string, string>;
  body: string;
}

/** Every `<TAG …>…</TAG>` (not self-closing) in the text. Attributes are
 *  read individually — a greedy `[^>]*NAME="…"` would pick up
 *  RESERVEDNAME="" instead of NAME="Cash" and blank every ledger name. */
export function xmlObjects(xml: string, tag: string): XmlObject[] {
  const re = new RegExp(`<${tag}((?:\\s[^>]*?)?)(?<!/)>([\\s\\S]*?)</${tag}>`, "gi");
  const out: XmlObject[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: parseAttrs(m[1] || ""), body: m[2] });
  return out;
}

/** Text of a child tag. A self-closing or empty tag reads as "". */
export function xmlChild(body: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(?:/>|(?<!/)>([\\s\\S]*?)</${tag}>)`, "i");
  const m = re.exec(body);
  if (!m) return null;
  return decodeTally(m[1] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * An amount as Tally sends it, in Tally's XML sign convention:
 * DEBIT = negative, CREDIT = positive.
 *
 *   "-400000.00"        -> -400000      (Dr)
 *   "1,23,456.50"       ->  123456.5    (Cr)
 *   "4,00,000.00 Dr"    -> -400000
 *   "4,00,000.00 Cr"    ->  400000
 *   "(-)5,000.00"       -> -5000        (Tally's text form of a negative)
 *   "-$100 @ ₹83/$ = -₹8300" -> -8300   (foreign currency: the rupee part)
 *   "" / missing        ->  0
 */
export function parseTallyAmount(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  let s = decodeTally(String(raw)).trim();
  if (!s) return 0;
  // Foreign-currency amounts carry the base-currency value after "=".
  if (s.includes("=")) s = s.slice(s.lastIndexOf("=") + 1).trim();

  let suffix: "dr" | "cr" | null = null;
  const dc = s.match(/\s*(dr|cr)\.?$/i);
  if (dc) {
    suffix = dc[1].toLowerCase() as "dr" | "cr";
    s = s.slice(0, dc.index).trim();
  }

  let sign = 1;
  if (s.startsWith("(-)")) {
    sign = -1;
    s = s.slice(3);
  } else if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr|[,\s]/gi, "").replace(/^[^\d+\-.]+/, "");
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || s === "") return 0;
  let v = sign * n;
  if (suffix === "dr") v = -Math.abs(v);
  if (suffix === "cr") v = Math.abs(v);
  return round2(v);
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** "2026-04-01" / "20260401" / Date -> "20260401". */
export function toTallyDate(d: string | Date): string {
  if (d instanceof Date) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }
  return String(d).replace(/-/g, "").slice(0, 8);
}

/** "20260401" -> "2026-04-01". Also accepts "1-Apr-2026". */
export function fromTallyDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const n = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (n) {
    const m = MONTHS.indexOf(n[2].slice(0, 3).toLowerCase());
    if (m >= 0) {
      const y = n[3].length === 2 ? `20${n[3]}` : n[3];
      return `${y}-${String(m + 1).padStart(2, "0")}-${n[1].padStart(2, "0")}`;
    }
  }
  return null;
}

interface StaticVars {
  company?: string;
  from?: string;
  to?: string;
}

function staticVars(v: StaticVars): string {
  return [
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>`,
    v.company ? `<SVCURRENTCOMPANY>${escapeXml(v.company)}</SVCURRENTCOMPANY>` : "",
    v.from ? `<SVFROMDATE TYPE="Date">${toTallyDate(v.from)}</SVFROMDATE>` : "",
    v.to ? `<SVTODATE TYPE="Date">${toTallyDate(v.to)}</SVTODATE>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
}

function collectionRequest(id: string, type: string, fetch: string, v: StaticVars): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>${id}</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${staticVars(v)}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="${id}" ISMODIFY="No">
      <TYPE>${type}</TYPE>
      <FETCH>${fetch}</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** Companies currently LOADED in Tally (not every company on disk). */
export const buildCompanyListRequest = () =>
  collectionRequest("Biome Company List", "Company", "Name, StartingFrom, BooksFrom", {});

/** The whole group tree of one company. */
export const buildGroupTreeRequest = (company: string) =>
  collectionRequest("Biome Group Tree", "Group", "Name, Parent, ReservedName", { company });

/** Every ledger of one company with balances for the period. */
export const buildLedgerBalancesRequest = (company: string, from: string, to: string) =>
  collectionRequest("Biome Ledger Balances", "Ledger", "Name, Parent, OpeningBalance, ClosingBalance", {
    company,
    from,
    to,
  });

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface TallyCompany {
  name: string;
  startingFrom: string | null; // YYYY-MM-DD
  booksFrom: string | null;
}

export interface TallyGroupRow {
  name: string;
  parent: string | null;
  reservedName: string | null;
}

export interface TallyLedgerRow {
  name: string;
  /** Immediate parent group, exactly as in Tally. */
  group: string | null;
  /** Tally XML sign: Dr negative, Cr positive. */
  openingBalance: number;
  closingBalance: number;
}

function objectName(o: XmlObject): string {
  return (o.attrs.NAME ?? xmlChild(o.body, "NAME") ?? "").trim();
}

export function parseCompanies(xml: string): TallyCompany[] {
  return xmlObjects(xml, "COMPANY")
    .map((o) => ({
      name: objectName(o),
      startingFrom: fromTallyDate(xmlChild(o.body, "STARTINGFROM")),
      booksFrom: fromTallyDate(xmlChild(o.body, "BOOKSFROM")),
    }))
    .filter((c) => c.name);
}

const isRootParent = (p: string | null) => !p || /^\W*primary$/i.test(p.trim());

export function parseGroups(xml: string): TallyGroupRow[] {
  return xmlObjects(xml, "GROUP")
    .map((o) => {
      const parent = xmlChild(o.body, "PARENT");
      const reserved = o.attrs.RESERVEDNAME ?? xmlChild(o.body, "RESERVEDNAME");
      return {
        name: objectName(o),
        parent: isRootParent(parent) ? null : parent,
        reservedName: reserved ? reserved : null,
      };
    })
    .filter((g) => g.name);
}

export function parseLedgerBalances(xml: string): TallyLedgerRow[] {
  return xmlObjects(xml, "LEDGER")
    .map((o) => {
      const parent = xmlChild(o.body, "PARENT");
      return {
        name: objectName(o),
        group: isRootParent(parent) ? null : parent,
        openingBalance: parseTallyAmount(xmlChild(o.body, "OPENINGBALANCE")),
        closingBalance: parseTallyAmount(xmlChild(o.body, "CLOSINGBALANCE")),
      };
    })
    .filter((l) => l.name);
}

export function tallyLineError(xml: string): string | null {
  const e = xmlChild(xml, "LINEERROR");
  return e ? e : null;
}

/* ------------------------------------------------------------------ */
/* Group tree                                                          */
/* ------------------------------------------------------------------ */

export interface GroupClassifier {
  /** Category and top-level (primary) group for a ledger's parent group. */
  classify(group: string | null): { category: TallyCategory; primaryGroup: string | null };
  /** True when the full tree was available (false = parent-only fallback). */
  fromTree: boolean;
}

export function buildGroupClassifier(groups: TallyGroupRow[] | null): GroupClassifier {
  const index = new Map<string, TallyGroupRow>();
  for (const g of groups || []) index.set(norm(g.name), g);
  const cache = new Map<string, { category: TallyCategory; primaryGroup: string | null }>();

  function classify(group: string | null) {
    const key = norm(group);
    if (!key) return { category: "other" as TallyCategory, primaryGroup: null };
    const hit = cache.get(key);
    if (hit) return hit;

    let category: TallyCategory = "other";
    let primary: string | null = group;
    let cur: string | null = group;
    const seen = new Set<string>();
    while (cur && !seen.has(norm(cur))) {
      seen.add(norm(cur));
      const g = index.get(norm(cur));
      primary = g?.name ?? cur;
      const reservedCat =
        (g?.reservedName && RESERVED_GROUPS[norm(g.reservedName)]) || RESERVED_GROUPS[norm(cur)];
      if (reservedCat && category === "other") category = reservedCat;
      cur = g ? g.parent : null;
    }
    const result = { category, primaryGroup: primary };
    cache.set(key, result);
    return result;
  }

  return { classify, fromTree: Boolean(groups && groups.length) };
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export interface ClassifiedLedger extends TallyLedgerRow {
  category: TallyCategory;
  primaryGroup: string | null;
  /** Balance in the account's natural direction: for assets/expenses a
   *  debit is positive, for liabilities/income a credit is positive. A
   *  negative value means the "wrong" side — a customer advance, a vendor
   *  advance, an overdrawn bank account. */
  natural: number;
  /** "Dr", "Cr" or "" for nil. */
  side: "Dr" | "Cr" | "";
}

export function classifyLedgers(ledgers: TallyLedgerRow[], classifier: GroupClassifier): ClassifiedLedger[] {
  return ledgers.map((l) => {
    const { category, primaryGroup } = classifier.classify(l.group);
    const natural = round2(CREDIT_NATURE.has(category) ? l.closingBalance : -l.closingBalance);
    return {
      ...l,
      category,
      primaryGroup,
      natural: natural === 0 ? 0 : natural,
      side: l.closingBalance < 0 ? "Dr" : l.closingBalance > 0 ? "Cr" : "",
    };
  });
}

export interface TallySummary {
  cashInHand: number | null;
  /** Bank Accounts group only, net. Overdraft / cash-credit is NOT here. */
  bankBalance: number | null;
  /** Bank OD A/c group, credit balance = owed to the bank. */
  bankOverdraft: number | null;
  /** Cash + bank (excluding OD). */
  liquidTotal: number | null;
  /** Sundry Debtors NET (advances received already subtracted). */
  receivables: number | null;
  receivablesGross: number | null;
  advancesFromCustomers: number | null;
  /** Sundry Creditors NET (advances paid already subtracted). */
  payables: number | null;
  payablesGross: number | null;
  advancesToVendors: number | null;
  /** Sales Accounts for the period, net of sales returns, excluding GST. */
  sales: number | null;
  /** Purchase Accounts for the period, net of returns, excluding GST. */
  purchases: number | null;
  /** Duties & Taxes net credit (positive = payable, negative = net input credit). */
  taxLiability: number | null;
  expenses: number | null;
  otherIncome: number | null;
  /** Sales minus purchases. Not a P&L gross profit (no stock adjustment). */
  grossMargin: number | null;
  salesSource: "ledger balances";
}

export interface CategoryBucket {
  total: number;
  count: number; // ledgers with a non-zero balance
  ledgers: ClassifiedLedger[];
}

export function bucketize(rows: ClassifiedLedger[]): Record<TallyCategory, CategoryBucket> {
  const out = {} as Record<TallyCategory, CategoryBucket>;
  (Object.keys(CATEGORY_LABEL) as TallyCategory[]).forEach((c) => (out[c] = { total: 0, count: 0, ledgers: [] }));
  for (const r of rows) {
    const b = out[r.category];
    b.ledgers.push(r);
    b.total = round2(b.total + r.natural);
    if (r.natural !== 0) b.count += 1;
  }
  for (const c of Object.keys(out) as TallyCategory[]) {
    out[c].ledgers.sort((a, b) => b.natural - a.natural);
  }
  return out;
}

export function summarise(b: Record<TallyCategory, CategoryBucket>): TallySummary {
  const has = (c: TallyCategory) => b[c].ledgers.length > 0;
  const total = (c: TallyCategory) => (has(c) ? b[c].total : null);
  const pos = (c: TallyCategory) => (has(c) ? round2(b[c].ledgers.reduce((s, l) => s + Math.max(l.natural, 0), 0)) : null);
  const neg = (c: TallyCategory) => (has(c) ? round2(b[c].ledgers.reduce((s, l) => s + Math.max(-l.natural, 0), 0)) : null);
  const add = (...v: (number | null)[]) => (v.every((x) => x === null) ? null : round2(v.reduce<number>((s, x) => s + (x ?? 0), 0)));

  const sales = total("sales");
  const purchases = total("purchases");
  return {
    cashInHand: total("cash"),
    bankBalance: total("bank"),
    bankOverdraft: total("bankOD"),
    liquidTotal: add(total("cash"), total("bank")),
    receivables: total("debtors"),
    receivablesGross: pos("debtors"),
    advancesFromCustomers: neg("debtors"),
    payables: total("creditors"),
    payablesGross: pos("creditors"),
    advancesToVendors: neg("creditors"),
    sales,
    purchases,
    taxLiability: total("dutiesTaxes"),
    expenses: add(total("directExpenses"), total("indirectExpenses")),
    otherIncome: add(total("directIncomes"), total("indirectIncomes")),
    grossMargin: sales !== null && purchases !== null ? round2(sales - purchases) : null,
    salesSource: "ledger balances",
  };
}

/* ------------------------------------------------------------------ */
/* Period                                                              */
/* ------------------------------------------------------------------ */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const prettyDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${MON[Number(m) - 1]}-${y}`;
};

/** "2026-04-01" + n days, calendar arithmetic (no time-zone drift). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** 1 April of the Indian financial year the date falls in. */
export function fyStartOf(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** "2026-04-01" -> "2026-27" */
export function fyName(isoDate: string): string {
  const y = Number(fyStartOf(isoDate).slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const lastDayOfMonth = (isoDate: string) => {
  const [y, m] = isoDate.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
};

export interface TallyPeriod {
  from: string; // YYYY-MM-DD
  to: string;
  /** e.g. "FY 2026-27 till today", "FY 2025-26", "Sep 2026",
   *  "FY 2024-25 to today", "15-May-2026 to 20-Jun-2026" */
  label: string;
  /** e.g. "01-Apr-2026 to 04-Oct-2026" */
  range: string;
  /** FY of the "to" date, e.g. "2026-27" */
  fy: string;
  /** Balance-sheet figures (cash, bank, receivables, payables) are closing
   *  balances on this date: "as on 04-Oct-2026". */
  asOn: string;
  /** Opening balances are as at the start of this date. */
  openingOn: string;
  /** Financial years the range touches (1 = within one FY). */
  fyCount: number;
  /** What was changed from the request, in plain words (dates clamped to
   *  the books beginning / today). Empty when nothing was changed. */
  notes: string[];
  /** The dates exactly as asked for (null = default). */
  requested: { from: string | null; to: string | null };
}

function parseDateInput(raw: string | undefined, which: "From" | "To"): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const t = String(raw).trim();
  const s = fromTallyDate(/^\d{4}-\d{2}-\d{2}T/.test(t) ? t.slice(0, 10) : t);
  const ok = s && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
  if (!ok) throw new TallyFetchError("bad-range", `${which} date "${raw}" isn't a valid date (use YYYY-MM-DD).`, 400);
  return s as string;
}

/**
 * The period to read, validated:
 *  - nothing given  -> current Indian FY (1 April, or the books beginning
 *    if the books started later that year) up to today;
 *  - From after To  -> error (nothing is guessed);
 *  - dates after today -> today, with a note;
 *  - From before the company's books beginning -> books beginning, with a note;
 *  - the whole range before the books beginning -> error.
 */
export function resolvePeriod(opts: {
  fromDate?: string;
  toDate?: string;
  booksFrom?: string | null;
  today?: Date;
}): TallyPeriod {
  const today = opts.today ?? new Date();
  const todayIso = iso(today);
  const notes: string[] = [];
  // "books" = from the company's books beginning (the "Since books
  // beginning" preset — the screen doesn't know that date, Tally does).
  const sinceBooks = String(opts.fromDate ?? "").trim().toLowerCase() === "books";
  const fromIn = sinceBooks ? null : parseDateInput(opts.fromDate, "From");
  const toIn = parseDateInput(opts.toDate, "To");
  if (fromIn && toIn && fromIn > toIn) {
    throw new TallyFetchError(
      "bad-range",
      `The From date (${prettyDate(fromIn)}) is after the To date (${prettyDate(toIn)}). Pick a From date on or before the To date.`,
      400
    );
  }

  let to = toIn || todayIso;
  if (to > todayIso) {
    notes.push(`The end date ${prettyDate(to)} is in the future, so figures run up to today (${prettyDate(todayIso)}).`);
    to = todayIso;
  }

  const books = opts.booksFrom || null;
  let from: string;
  if (fromIn) {
    from = fromIn;
    if (from > todayIso) {
      notes.push(`The start date ${prettyDate(from)} is in the future, so the period is just today.`);
      from = todayIso;
    }
    if (books && from < books) {
      if (to < books) {
        throw new TallyFetchError(
          "bad-range",
          `The whole period (${prettyDate(from)} to ${prettyDate(to)}) is before this company's books begin in Tally (${prettyDate(books)}). Pick dates from ${prettyDate(books)} onwards.`,
          400
        );
      }
      notes.push(`This company's books in Tally begin on ${prettyDate(books)}, so the period starts there (you asked from ${prettyDate(from)}).`);
      from = books;
    }
  } else if (sinceBooks) {
    if (books && books <= to) {
      from = books;
    } else {
      from = fyStartOf(to);
      if (!books) notes.push(`Tally didn't give this company's books-beginning date, so the period starts at the beginning of the financial year (${prettyDate(from)}).`);
    }
  } else {
    from = fyStartOf(to);
    if (books && books > from && books <= to) from = books;
  }

  const fyFirst = Number(fyStartOf(from).slice(0, 4));
  const fyLast = Number(fyStartOf(to).slice(0, 4));
  const fy = fyName(to);
  const startsFy = from.endsWith("-04-01") || (books !== null && from === books);
  const endsFy = to.endsWith("-03-31");
  const range = `${prettyDate(from)} to ${prettyDate(to)}`;

  let label: string;
  if (sinceBooks && books && from === books) {
    label = `Since books beginning (${prettyDate(books)}) to ${to === todayIso ? "today" : prettyDate(to)}`;
  } else if (startsFy && to === todayIso) {
    label = fyFirst === fyLast ? `FY ${fy} till today` : `FY ${fyName(from)} to today`;
  } else if (startsFy && endsFy) {
    label = fyFirst === fyLast ? `FY ${fy}` : `FY ${fyName(from)} to FY ${fy}`;
  } else if (from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7) && (to === lastDayOfMonth(to) || to === todayIso)) {
    const [y, m] = from.split("-");
    label = `${MON[Number(m) - 1]} ${y}${to === todayIso && to !== lastDayOfMonth(to) ? " till today" : ""}`;
  } else {
    label = range;
  }

  return {
    from,
    to,
    fy,
    label,
    range,
    asOn: prettyDate(to),
    openingOn: prettyDate(from),
    fyCount: fyLast - fyFirst + 1,
    notes,
    requested: { from: sinceBooks ? "books" : fromIn, to: toIn },
  };
}

/** One piece of a period that sits inside a single financial year.
 *  `fyFrom` is what Tally gets as SVFROMDATE (1 April or the books
 *  beginning) — P&L ledgers start again from nil each FY, so a reading
 *  never crosses a year end. */
export interface FySegment {
  fyFrom: string;
  from: string;
  to: string;
}

export function fySegments(from: string, to: string, booksFrom?: string | null): FySegment[] {
  const out: FySegment[] = [];
  let s = from;
  while (s <= to) {
    let fyFrom = fyStartOf(s);
    if (booksFrom && booksFrom > fyFrom && booksFrom <= s) fyFrom = booksFrom;
    const fyEnd = `${Number(fyStartOf(s).slice(0, 4)) + 1}-03-31`;
    const e = fyEnd < to ? fyEnd : to;
    out.push({ fyFrom, from: s, to: e });
    s = addDays(e, 1);
  }
  return out;
}

/** Calendar months covering the period (first/last may be partial). */
export function monthChunks(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let s = from;
  while (s <= to) {
    const end = lastDayOfMonth(s);
    const e = end < to ? end : to;
    out.push({ from: s, to: e });
    s = addDays(e, 1);
  }
  return out;
}

const monthName = (isoDate: string) => `${MON[Number(isoDate.slice(5, 7)) - 1]}-${isoDate.slice(0, 4)}`;

/* ------------------------------------------------------------------ */
/* Short-lived cache                                                   */
/* ------------------------------------------------------------------ */

/** Readings are cached per (Tally address, company, kind, from, to):
 *   - a reading that ends before the current month (a CLOSED period) is
 *     kept for TALLY_CLOSED_TTL_MS, so a multi-year range doesn't pull
 *     every past month again each time a page opens;
 *   - a reading that touches the current month is NEVER cached — it is
 *     always read from Tally, so today's figures are always today's;
 *   - "Refresh" (fresh: true) skips the cache entirely and re-reads all.
 *  The company list is never cached, so if Tally is closed the caller
 *  still gets an error, not remembered figures. */
export const TALLY_CLOSED_TTL_MS = 6 * 60 * 60 * 1000;
/** Group tree (structure, not figures). */
const GROUPS_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 600;
type CacheEntry = { at: number; ttl: number; value: unknown };
const tallyCache: Map<string, CacheEntry> =
  ((globalThis as any).__biomeTallyCache as Map<string, CacheEntry>) ||
  ((globalThis as any).__biomeTallyCache = new Map<string, CacheEntry>());

function cacheKey(target: TallyRequestSettings, company: string, kind: string, from: string, to: string) {
  return [resolveTallyTarget(target).url, norm(company), kind, from, to].join("|");
}
/** True when `to` is before the first day of the current month. */
export function isClosedPeriod(to: string, today: Date = new Date()): boolean {
  return to < `${iso(today).slice(0, 7)}-01`;
}
function cacheGet<T>(key: string, fresh?: boolean): T | undefined {
  if (fresh) return undefined;
  const hit = tallyCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    tallyCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}
function cachePut(key: string, value: unknown, ttl: number) {
  if (ttl <= 0) return;
  tallyCache.delete(key);
  tallyCache.set(key, { at: Date.now(), ttl, value });
  while (tallyCache.size > CACHE_MAX) {
    const oldest = tallyCache.keys().next().value;
    if (oldest === undefined) break;
    tallyCache.delete(oldest);
  }
}
/** Cache time for a reading ending on `to` (0 = don't cache). */
const ttlFor = (to: string, today?: Date) => (isClosedPeriod(to, today) ? TALLY_CLOSED_TTL_MS : 0);
/** For tests / "clear". */
export function clearTallyCache() {
  tallyCache.clear();
}

/** Errors worth asking Tally again for: it was busy, slow, or briefly
 *  unreachable. A "company not open" or bad TDL won't fix itself. */
const RETRYABLE = new Set<TallyErrorCode>(["timeout", "unreachable", "http", "not-tally"]);
export const TALLY_CHUNK_ATTEMPTS = 3;

/** Time limit for ONE piece of a long read (a FY of balances, a month of
 *  vouchers) — generous, because a big month can take Tally a while.
 *  BIOME_TALLY_CHUNK_TIMEOUT_MS overrides it (tests, very slow servers). */
function chunkTimeoutMs(fallback: number): number {
  const env = Number(process.env.BIOME_TALLY_CHUNK_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : fallback;
}

/** Run one Tally reading, retrying up to `attempts` times with a short
 *  pause (Tally serves one request at a time; a busy moment passes). */
export async function withRetry<T>(
  run: (attempt: number) => Promise<T>,
  opts: { attempts?: number; onRetry?: (attempt: number, err: TallyFetchError) => void; delayMs?: number } = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? TALLY_CHUNK_ATTEMPTS);
  let last: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await run(a);
    } catch (err) {
      last = err;
      if (!(err instanceof TallyFetchError) || !RETRYABLE.has(err.code) || a === attempts) throw err;
      opts.onRetry?.(a + 1, err);
      const wait = (opts.delayMs ?? Number(process.env.BIOME_TALLY_RETRY_DELAY_MS ?? 1500)) * a;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** Progress of a multi-part read, for the loading bar. */
export interface TallyProgress {
  phase: "company" | "balances" | "vouchers";
  done: number;
  total: number;
  /** "Balances 01-Apr-2024 to 31-Mar-2025" */
  label: string;
}
export type ProgressFn = (p: TallyProgress) => void;

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export type TallyErrorCode =
  | "unreachable"
  | "timeout"
  | "http"
  | "not-tally"
  | "tally-error"
  | "no-company"
  | "company-not-open"
  | "choose-company"
  | "bad-range"
  | "empty";

export class TallyFetchError extends Error {
  code: TallyErrorCode;
  status: number;
  companies?: string[];
  constructor(code: TallyErrorCode, message: string, status = 502, companies?: string[]) {
    super(message);
    this.code = code;
    this.status = status;
    this.companies = companies;
  }
}

export interface TallyTargetOptions extends TallyRequestSettings {
  timeoutMs?: number;
}

/** POST one XML request to Tally (or the Biome Tally Agent). Throws a
 *  TallyFetchError with a message an accountant can act on. */
export async function postToTally(target: TallyTargetOptions, xml: string): Promise<string> {
  const { url, headers } = resolveTallyTarget(target);
  const timeoutMs = target.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
      cache: "no-store",
    });
    text = await res.text();
    if (res.status === 401) {
      throw new TallyFetchError("http", "The Biome Tally Agent rejected the request — check the API key in Settings → Tally.");
    }
    if (!res.ok) throw new TallyFetchError("http", `Tally replied with HTTP ${res.status} at ${url}.`);
  } catch (err: any) {
    if (err instanceof TallyFetchError) throw err;
    if (err?.name === "AbortError") {
      throw new TallyFetchError("timeout", `Tally didn't answer within ${Math.round(timeoutMs / 1000)}s at ${url}.`, 504);
    }
    throw new TallyFetchError(
      "unreachable",
      `Can't reach Tally at ${url}. Open Tally Prime on the server PC, load the company, and set F1 (Help) → Settings → Connectivity → "TallyPrime acts as" = Both, port 9000.`
    );
  } finally {
    clearTimeout(timer);
  }
  if (!/<ENVELOPE[\s>]/i.test(text)) {
    throw new TallyFetchError("not-tally", `${url} answered, but not with Tally XML: ${text.slice(0, 160).trim() || "(empty)"}`);
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Company                                                             */
/* ------------------------------------------------------------------ */

export async function listCompanies(target: TallyTargetOptions): Promise<TallyCompany[]> {
  const xml = await postToTally(target, buildCompanyListRequest());
  const err = tallyLineError(xml);
  if (err) throw new TallyFetchError("tally-error", `Tally reported: "${err}"`);
  return parseCompanies(xml);
}

/** Pick the company to read. Never guesses between two open companies —
 *  mixing up the current year's books with an old split company is
 *  exactly the kind of error that produces confident wrong numbers. */
export function chooseCompany(loaded: TallyCompany[], wanted?: string | null): TallyCompany {
  const names = loaded.map((c) => c.name);
  if (!loaded.length) {
    throw new TallyFetchError("no-company", "Tally is open but no company is loaded. Load the company in Tally (F3 / Alt+F3) and refresh.", 409);
  }
  const w = norm(wanted);
  if (w) {
    const hit = loaded.find((c) => norm(c.name) === w);
    if (hit) return hit;
    throw new TallyFetchError(
      "company-not-open",
      `The company "${wanted}" set in Settings → Tally is not open in Tally. Open companies: ${names.join(", ")}.`,
      409,
      names
    );
  }
  if (loaded.length === 1) return loaded[0];
  throw new TallyFetchError(
    "choose-company",
    `${loaded.length} companies are open in Tally (${names.join(", ")}). Enter the exact company name in Settings → Tally so the right books are read.`,
    409,
    names
  );
}

/* ------------------------------------------------------------------ */
/* The one call everything uses                                        */
/* ------------------------------------------------------------------ */

export interface TallyFinanceOptions extends TallyTargetOptions {
  company?: string;
  fromDate?: string;
  toDate?: string;
  today?: Date;
  /** Skip the short-lived cache (the Refresh button). */
  fresh?: boolean;
  onProgress?: ProgressFn;
}

export interface TallyFinance {
  fetchedAt: string;
  company: string;
  companies: string[];
  /** Books beginning of the company in Tally (YYYY-MM-DD) if known. */
  booksFrom: string | null;
  period: TallyPeriod;
  /** Per ledger: openingBalance = balance as on period.from (start of day),
   *  closingBalance = balance as on period.to for balance-sheet ledgers and
   *  the movement within the period for P&L ledgers (Sales, Purchase,
   *  Expenses, Incomes). Tally sign: Dr negative, Cr positive. */
  ledgers: ClassifiedLedger[];
  buckets: Record<TallyCategory, CategoryBucket>;
  summary: TallySummary;
  classifier: GroupClassifier;
  warnings: string[];
  /** How many separate Tally readings the balances needed. */
  readings: number;
  /** Readings that needed more than one try. */
  retried: number;
  /** True when every reading came from the cache (closed months only). */
  fromCache: boolean;
  /** Balance-sheet figures at the START of the period (as on period.from). */
  opening: OpeningSummary;
}

export interface OpeningSummary {
  asOn: string;
  cashInHand: number | null;
  bankBalance: number | null;
  bankOverdraft: number | null;
  receivables: number | null;
  payables: number | null;
}

/** Ledgers whose balance is a period movement (they restart each FY). */
export const PL_CATEGORIES = new Set<TallyCategory>([
  "sales",
  "purchases",
  "directExpenses",
  "indirectExpenses",
  "directIncomes",
  "indirectIncomes",
]);

/** Re-throw a Tally error with which part of a long period failed. */
function chunkError(err: unknown, what: string, i: number, n: number): never {
  if (err instanceof TallyFetchError) {
    const where = n > 1 ? ` (${what}, part ${i + 1} of ${n})` : "";
    const msg =
      err.code === "timeout" && n > 1
        ? `${err.message.replace(/\.$/, "")}${where}. Long periods are read one piece at a time — try Refresh, or a shorter period.`
        : `${err.message.replace(/\.$/, "")}${where}.`;
    throw new TallyFetchError(err.code, msg, err.status, err.companies);
  }
  throw err;
}

/** One reading of every ledger's balance, SVFROMDATE..SVTODATE. */
async function ledgerSnapshot(
  target: TallyTargetOptions,
  company: string,
  svFrom: string,
  svTo: string,
  fresh: boolean | undefined,
  today: Date | undefined,
  onRetry?: (attempt: number, err: TallyFetchError) => void
): Promise<{ rows: TallyLedgerRow[]; cached: boolean; attempts: number }> {
  const key = cacheKey(target, company, "ledgers", svFrom, svTo);
  const hit = cacheGet<TallyLedgerRow[]>(key, fresh);
  if (hit) return { rows: hit, cached: true, attempts: 0 };
  let attempts = 0;
  const xml = await withRetry(
    (a) => {
      attempts = a;
      return postToTally(target, buildLedgerBalancesRequest(company, svFrom, svTo));
    },
    { onRetry }
  );
  const err = tallyLineError(xml);
  if (err) throw new TallyFetchError("tally-error", `Tally reported: "${err}"`);
  const rows = parseLedgerBalances(xml);
  if (!rows.length) {
    throw new TallyFetchError("empty", `Tally answered but returned no ledgers for "${company}".`);
  }
  cachePut(key, rows, ttlFor(svTo, today));
  return { rows, cached: false, attempts };
}

/**
 * Balances for ANY period, the way Tally computes them:
 *
 *  - The period is split at each 31 March. For each financial-year piece
 *    [s, e] Tally is asked for SVFROMDATE = 1 April (or books beginning)
 *    up to e, and — if s is after 1 April — up to the day before s.
 *  - P&L ledgers (Sales, Purchase, Expenses, Incomes): movement of a piece
 *    = closing at e − closing at (s − 1); pieces are added up. So "15 May to
 *    20 June" is exactly that, and "FY 2023-24 to today" is the sum of each
 *    year, never one year's figure.
 *  - Balance-sheet ledgers (cash, bank, debtors, creditors, taxes, …):
 *    closing = balance on the "to" date (as on); opening = balance at the
 *    start of the "from" date.
 *
 * Pieces are read one after another (Tally serves one request at a time)
 * with progress reported. A piece that fails (slow / busy Tally) is asked
 * for again up to TALLY_CHUNK_ATTEMPTS times; if it still fails the read
 * stops with a message saying which piece — partial balances are never
 * shown. Pieces that end before the current month are cached (closed).
 */
export async function fetchTallyFinance(opts: TallyFinanceOptions): Promise<TallyFinance> {
  const progress = opts.onProgress ?? (() => {});
  // A bad range (From after To, not a date) is answered before Tally is asked.
  resolvePeriod({ fromDate: opts.fromDate, toDate: opts.toDate, today: opts.today });
  progress({ phase: "company", done: 0, total: 1, label: "Checking the company in Tally" });
  const loaded = await listCompanies(opts);
  const company = chooseCompany(loaded, opts.company);
  const booksFrom = company.booksFrom || company.startingFrom || null;
  const period = resolvePeriod({
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    booksFrom,
    today: opts.today,
  });
  const warnings: string[] = [];

  // Plan the readings. The LAST one is always (FY start of "to") .. "to".
  const segs = fySegments(period.from, period.to, booksFrom);
  type Step = { seg: number; kind: "before" | "end"; svFrom: string; svTo: string };
  const steps: Step[] = [];
  segs.forEach((g, i) => {
    if (g.from > g.fyFrom) steps.push({ seg: i, kind: "before", svFrom: g.fyFrom, svTo: addDays(g.from, -1) });
    steps.push({ seg: i, kind: "end", svFrom: g.fyFrom, svTo: g.to });
  });
  const total = steps.length + 1;
  // Each reading gets its own, longer, time limit when the period is long.
  const target: TallyTargetOptions = {
    ...opts,
    timeoutMs: chunkTimeoutMs(Math.max(opts.timeoutMs ?? 45000, 60000)),
  };

  // Group tree first — small, and it decides what every ledger is.
  progress({ phase: "balances", done: 0, total, label: "Reading the group list" });
  let groups: TallyGroupRow[] | null = null;
  try {
    const gkey = cacheKey(opts, company.name, "groups", "", "");
    groups = cacheGet<TallyGroupRow[]>(gkey, opts.fresh) ?? null;
    if (!groups) {
      const gxml = await postToTally(opts, buildGroupTreeRequest(company.name));
      const err = tallyLineError(gxml);
      if (err) throw new Error(err);
      groups = parseGroups(gxml);
      cachePut(gkey, groups, GROUPS_TTL_MS);
    }
  } catch (e: any) {
    if (e instanceof TallyFetchError && (e.code === "unreachable" || e.code === "timeout")) throw e;
    warnings.push(
      `The group list couldn't be read (${e?.message || "unknown error"}), so only ledgers sitting directly under Tally's own groups are counted.`
    );
  }
  const classifier = buildGroupClassifier(groups);

  const snaps: TallyLedgerRow[][] = [];
  let allCached = true;
  let retried = 0;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const what = `balances ${prettyDate(st.svFrom)} to ${prettyDate(st.svTo)}`;
    progress({ phase: "balances", done: i + 1, total, label: `Reading ${what}` });
    try {
      const r = await ledgerSnapshot(target, company.name, st.svFrom, st.svTo, opts.fresh, opts.today, (a) =>
        progress({ phase: "balances", done: i + 1, total, label: `Tally was slow — asking again for ${what} (try ${a} of ${TALLY_CHUNK_ATTEMPTS})` })
      );
      snaps.push(r.rows);
      if (!r.cached) allCached = false;
      if (r.attempts > 1) retried += 1;
    } catch (e) {
      chunkError(e, what, i, steps.length);
    }
  }
  progress({ phase: "balances", done: total, total, label: "Balances read" });

  // ---- Merge the readings ----
  const byName = (rows: TallyLedgerRow[]) => new Map(rows.map((r) => [norm(r.name), r] as const));
  const maps = snaps.map(byName);
  const last = snaps[snaps.length - 1];
  const order: TallyLedgerRow[] = [...last];
  const seen = new Set(last.map((r) => norm(r.name)));
  for (const s of snaps) for (const r of s) if (!seen.has(norm(r.name))) { seen.add(norm(r.name)); order.push(r); }

  const firstStep = steps[0];
  const raw: TallyLedgerRow[] = order.map((r) => {
    const key = norm(r.name);
    const latest = maps[maps.length - 1].get(key) ?? r;
    const { category } = classifier.classify(latest.group);
    if (PL_CATEGORIES.has(category)) {
      let mv = 0;
      segs.forEach((_, si) => {
        steps.forEach((st, k) => {
          if (st.seg !== si) return;
          const v = maps[k].get(key)?.closingBalance ?? 0;
          mv += st.kind === "end" ? v : -v;
        });
      });
      return { name: r.name, group: latest.group, openingBalance: 0, closingBalance: round2(mv) };
    }
    const closing = maps[maps.length - 1].get(key)?.closingBalance ?? 0;
    const opening =
      firstStep.kind === "before"
        ? maps[0].get(key)?.closingBalance ?? 0
        : maps[0].get(key)?.openingBalance ?? 0;
    return { name: r.name, group: latest.group, openingBalance: round2(opening), closingBalance: round2(closing) };
  });

  const ledgers = classifyLedgers(raw, classifier);
  const buckets = bucketize(ledgers);
  const summary = summarise(buckets);
  const openSum = summarise(
    bucketize(classifyLedgers(raw.map((r) => ({ ...r, closingBalance: r.openingBalance })), classifier))
  );
  const opening: OpeningSummary = {
    asOn: period.openingOn,
    cashInHand: openSum.cashInHand,
    bankBalance: openSum.bankBalance,
    bankOverdraft: openSum.bankOverdraft,
    receivables: openSum.receivables,
    payables: openSum.payables,
  };

  if (summary.cashInHand !== null && summary.cashInHand < 0) {
    warnings.push("Cash-in-Hand shows a credit (negative) balance in Tally — check cash entries.");
  }

  return {
    opening,
    fetchedAt: new Date().toISOString(),
    company: company.name,
    companies: loaded.map((c) => c.name),
    booksFrom,
    period,
    ledgers,
    buckets,
    summary,
    classifier,
    warnings,
    readings: steps.length,
    retried,
    fromCache: allCached,
  };
}

/** Which KPI groups the company has no ledgers in, for an honest "—". */
export function missingGroups(b: Record<TallyCategory, CategoryBucket>): string[] {
  return (["cash", "bank", "debtors", "creditors", "sales", "purchases"] as TallyCategory[])
    .filter((c) => b[c].ledgers.length === 0)
    .map((c) => CATEGORY_LABEL[c]);
}

/** JSON body for an error, with the HTTP status to send it with. */
export function tallyErrorBody(err: unknown): { status: number; body: Record<string, any> } {
  if (err instanceof TallyFetchError) {
    return {
      status: err.status,
      body: { error: err.message, code: err.code, companies: err.companies ?? null },
    };
  }
  return { status: 500, body: { error: (err as any)?.message || "Reading Tally failed.", code: "internal" } };
}

/* ------------------------------------------------------------------ */
/* Vouchers (best effort — balances never depend on them)              */
/* ------------------------------------------------------------------ */

export interface TallyVoucherEntry {
  ledger: string;
  /** Tally sign: Dr negative, Cr positive. */
  amount: number;
}

export interface TallyVoucher {
  invoiceNo: string;
  date: string | null;
  party: string | null;
  voucherType: string | null;
  narration: string | null;
  /** Party-side value, as a positive number (includes GST on invoices). */
  amount: number | null;
  entries: TallyVoucherEntry[];
}

function bridgeVoucherRequest(company: string, from: string, to: string) {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>BiomeVouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${staticVars({ company, from, to })}
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

function legacyVoucherRequest(company: string, from: string, to: string) {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <EXPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Biome Voucher Export</REPORTNAME>
    <STATICVARIABLES>
     ${staticVars({ company, from, to })}
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;
}

function partyValue(entries: TallyVoucherEntry[], party: string | null): number | null {
  if (!entries.length) return null;
  const p = norm(party);
  const hit = p ? entries.find((e) => norm(e.ledger) === p) : undefined;
  const chosen = hit ?? entries.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
  return round2(Math.abs(chosen.amount));
}

/** BiomeBridge.tdl "BiomeVouchers": <VOUCHER><DATE/><VOUCHERTYPE/>…<ENTRY><LEDGER/><AMOUNT/><ISDEBIT/></ENTRY></VOUCHER> */
export function parseBridgeVouchers(xml: string): TallyVoucher[] {
  return xmlObjects(xml, "VOUCHER").map((o) => {
    const entries = xmlObjects(o.body, "ENTRY").map((e) => {
      const amt = parseTallyAmount(xmlChild(e.body, "AMOUNT"));
      const isDebit = xmlChild(e.body, "ISDEBIT");
      // ISDEBIT (IsDeemedPositive) is the reliable side; the amount text
      // from a TDL field may or may not carry a sign.
      const signed = isDebit ? (/^yes$/i.test(isDebit) ? -Math.abs(amt) : Math.abs(amt)) : amt;
      return { ledger: xmlChild(e.body, "LEDGER") || "", amount: signed };
    });
    const party = xmlChild(o.body, "PARTY") || null;
    const own = xmlChild(o.body, "AMOUNT");
    return {
      invoiceNo: xmlChild(o.body, "VOUCHERNUMBER") || "",
      date: fromTallyDate(xmlChild(o.body, "DATE")),
      party,
      voucherType: xmlChild(o.body, "VOUCHERTYPE") || null,
      narration: xmlChild(o.body, "NARRATION") || null,
      amount: partyValue(entries, party) ?? (own ? Math.abs(parseTallyAmount(own)) : null),
      entries,
    };
  });
}

/** Older BiomePlatformExport.tdl "Biome Voucher Export". */
export function parseLegacyVouchers(xml: string): TallyVoucher[] {
  return xmlObjects(xml, "VOUCHER")
    .map((o) => {
      const entries = xmlObjects(o.body, "LEDGERENTRY").map((e) => ({
        ledger: xmlChild(e.body, "LEDGERNAME") || "",
        amount: parseTallyAmount(xmlChild(e.body, "AMOUNT")),
      }));
      const party = xmlChild(o.body, "PARTYLEDGERNAME") || null;
      return {
        invoiceNo: xmlChild(o.body, "VOUCHERNUMBER") || "",
        date: fromTallyDate(xmlChild(o.body, "DATE")),
        party,
        voucherType: xmlChild(o.body, "VOUCHERTYPE") || null,
        narration: xmlChild(o.body, "NARRATION") || null,
        amount: partyValue(entries, party),
        entries,
      };
    })
    .filter((v) => v.invoiceNo || v.party);
}

export interface VoucherFetch {
  vouchers: TallyVoucher[];
  source: "bridge" | "legacy" | null;
  error: string | null;
}

/** Transactions for the period: the BiomeBridge TDL first, the older
 *  export report second. A missing TDL is reported, not hidden. */
export async function fetchVouchers(
  target: TallyTargetOptions,
  company: string,
  from: string,
  to: string
): Promise<VoucherFetch> {
  try {
    const xml = await postToTally(target, bridgeVoucherRequest(company, from, to));
    if (!tallyLineError(xml)) return { vouchers: parseBridgeVouchers(xml), source: "bridge", error: null };
    const legacy = await postToTally(target, legacyVoucherRequest(company, from, to));
    if (!tallyLineError(legacy)) return { vouchers: parseLegacyVouchers(legacy), source: "legacy", error: null };
    return {
      vouchers: [],
      source: null,
      error:
        "Transactions need the Biome bridge loaded in Tally (Settings → Tally → Download BiomeBridge.tdl). Balances are unaffected.",
    };
  } catch (err: any) {
    return {
      vouchers: [],
      source: null,
      error:
        err?.code === "timeout"
          ? "Transactions took too long to fetch — try a shorter date range. Balances are unaffected."
          : `Transactions couldn't be fetched: ${err?.message ?? "unknown error"}. Balances are unaffected.`,
    };
  }
}

export interface VoucherChunkFailure {
  from: string;
  to: string;
  error: string;
}

export interface VoucherRangeFetch extends VoucherFetch {
  /** How the period was split and which pieces couldn't be read. */
  chunks: { total: number; read: number; failed: VoucherChunkFailure[]; retried: number; cached: number };
}

async function voucherChunk(
  target: TallyTargetOptions,
  company: string,
  from: string,
  to: string,
  source: "bridge" | "legacy" | null,
  fresh: boolean | undefined,
  today?: Date
): Promise<{ vouchers: TallyVoucher[]; source: "bridge" | "legacy" | null; missingTdl: boolean; cached?: boolean }> {
  const key = cacheKey(target, company, `vouchers:${source ?? "auto"}`, from, to);
  const hit = cacheGet<{ vouchers: TallyVoucher[]; source: "bridge" | "legacy" }>(key, fresh);
  if (hit) return { ...hit, missingTdl: false, cached: true };
  const put = (v: TallyVoucher[], src: "bridge" | "legacy") => {
    cachePut(key, { vouchers: v, source: src }, ttlFor(to, today));
    return { vouchers: v, source: src, missingTdl: false };
  };
  if (source !== "legacy") {
    const xml = await postToTally(target, bridgeVoucherRequest(company, from, to));
    if (!tallyLineError(xml)) return put(parseBridgeVouchers(xml), "bridge");
    if (source === "bridge") throw new TallyFetchError("tally-error", `Tally reported: "${tallyLineError(xml)}"`);
  }
  const legacy = await postToTally(target, legacyVoucherRequest(company, from, to));
  if (!tallyLineError(legacy)) return put(parseLegacyVouchers(legacy), "legacy");
  if (source === "legacy") throw new TallyFetchError("tally-error", `Tally reported: "${tallyLineError(legacy)}"`);
  return { vouchers: [], source: null, missingTdl: true };
}

/**
 * Transactions for any period, read ONE MONTH AT A TIME (a multi-year
 * voucher export in one request is what makes Tally time out). Each month
 * gets its own, longer time limit; months that fail are listed and the
 * rest are still returned. Balances never depend on this.
 */
export async function fetchVouchersRange(
  target: TallyTargetOptions,
  company: string,
  from: string,
  to: string,
  opts: { fresh?: boolean; onProgress?: ProgressFn; today?: Date } = {}
): Promise<VoucherRangeFetch> {
  const progress = opts.onProgress ?? (() => {});
  const chunks = monthChunks(from, to);
  const t: TallyTargetOptions = { ...target, timeoutMs: chunkTimeoutMs(Math.max(target.timeoutMs ?? 45000, 90000)) };
  const failed: VoucherChunkFailure[] = [];
  const vouchers: TallyVoucher[] = [];
  let source: "bridge" | "legacy" | null = null;
  let read = 0;
  let retried = 0;
  let cached = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const name = chunks.length > 1 ? monthName(c.from) : `${prettyDate(c.from)} to ${prettyDate(c.to)}`;
    progress({ phase: "vouchers", done: i, total: chunks.length, label: `Reading transactions ${name}` });
    try {
      let tries = 0;
      const r = await withRetry(
        (a) => {
          tries = a;
          return voucherChunk(t, company, c.from, c.to, source, opts.fresh, opts.today);
        },
        {
          onRetry: (a) =>
            progress({
              phase: "vouchers",
              done: i,
              total: chunks.length,
              label: `Tally was slow — asking again for ${name} (try ${a} of ${TALLY_CHUNK_ATTEMPTS})`,
            }),
        }
      );
      if (tries > 1) retried += 1;
      if (r.cached) cached += 1;
      if (r.missingTdl) {
        return {
          vouchers: [],
          source: null,
          error:
            "Transactions need the Biome bridge loaded in Tally (Settings → Tally → Download BiomeBridge.tdl). Balances are unaffected.",
          chunks: { total: chunks.length, read: 0, failed: [], retried, cached },
        };
      }
      source = r.source;
      vouchers.push(...r.vouchers);
      read += 1;
    } catch (err: any) {
      const msg =
        err?.code === "timeout"
          ? `Tally didn't answer within ${Math.round((t.timeoutMs ?? 0) / 1000)}s`
          : err?.message || "unknown error";
      failed.push({ from: c.from, to: c.to, error: msg });
      if (err?.code === "unreachable") {
        // Tally went away — no point asking for the remaining months.
        for (const rest of chunks.slice(i + 1)) failed.push({ from: rest.from, to: rest.to, error: "not read (Tally stopped answering)" });
        break;
      }
    }
  }
  progress({ phase: "vouchers", done: chunks.length, total: chunks.length, label: "Transactions read" });

  let error: string | null = null;
  if (failed.length && !read) {
    error = failed[0].error.includes("didn't answer")
      ? `Transactions took too long to fetch (${failed[0].error}). Try a shorter period. Balances are unaffected.`
      : `Transactions couldn't be fetched: ${failed[0].error}. Balances are unaffected.`;
  } else if (failed.length) {
    const names = failed.slice(0, 6).map((f) => `${chunks.length > 1 ? monthName(f.from) : `${prettyDate(f.from)} to ${prettyDate(f.to)}`} (${f.error})`);
    error = `${failed.length} of ${chunks.length} months couldn't be read from Tally: ${names.join("; ")}${failed.length > 6 ? "; …" : ""}. Transactions for those months are missing from the chart and list — press Refresh to try again. Balances are unaffected.`;
  }
  vouchers.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { vouchers, source, error, chunks: { total: chunks.length, read, failed, retried, cached } };
}
