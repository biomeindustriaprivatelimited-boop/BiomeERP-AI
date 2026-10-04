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
 *     Default period = current Indian financial year (1 April) to today.
 *     Sales/Purchase/Expense ledgers are P&L ledgers, so their closing
 *     balance for that period IS the year-to-date movement.
 *
 *  4. NO STALE NUMBERS. Nothing is cached. If Tally can't be read the
 *     caller gets an error, never yesterday's figures dressed up as today's.
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

export interface TallyPeriod {
  from: string; // YYYY-MM-DD
  to: string;
  /** e.g. "FY 2026-27 till today" */
  label: string;
  /** e.g. "01-Apr-2026 to 04-Oct-2026" */
  range: string;
  fy: string; // "2026-27"
}

/** Current Indian FY (1 April) up to today, unless dates are given. The
 *  start is moved forward to the company's books-beginning date if the
 *  books started later in the year. */
export function resolvePeriod(opts: { fromDate?: string; toDate?: string; booksFrom?: string | null; today?: Date }): TallyPeriod {
  const today = opts.today ?? new Date();
  const todayIso = iso(today);
  const toIn = opts.toDate ? fromTallyDate(toTallyDate(opts.toDate)) : null;
  const to = toIn || todayIso;
  const [ty, tm] = to.split("-").map(Number);
  const fyStartYear = tm >= 4 ? ty : ty - 1;
  const fyStart = `${fyStartYear}-04-01`;
  const fromIn = opts.fromDate ? fromTallyDate(toTallyDate(opts.fromDate)) : null;
  let from = fromIn || fyStart;
  if (!fromIn && opts.booksFrom && opts.booksFrom > from && opts.booksFrom <= to) from = opts.booksFrom;
  const fy = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
  const isDefault = !fromIn && to === todayIso;
  return {
    from,
    to,
    fy,
    label: isDefault ? `FY ${fy} till today` : `${prettyDate(from)} to ${prettyDate(to)}`,
    range: `${prettyDate(from)} to ${prettyDate(to)}`,
  };
}

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
}

export interface TallyFinance {
  fetchedAt: string;
  company: string;
  companies: string[];
  period: TallyPeriod;
  ledgers: ClassifiedLedger[];
  buckets: Record<TallyCategory, CategoryBucket>;
  summary: TallySummary;
  classifier: GroupClassifier;
  warnings: string[];
}

export async function fetchTallyFinance(opts: TallyFinanceOptions): Promise<TallyFinance> {
  const loaded = await listCompanies(opts);
  const company = chooseCompany(loaded, opts.company);
  const period = resolvePeriod({
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    booksFrom: company.booksFrom,
    today: opts.today,
  });
  const warnings: string[] = [];

  // Group tree first — small, and it decides what every ledger is.
  let groups: TallyGroupRow[] | null = null;
  try {
    const gxml = await postToTally(opts, buildGroupTreeRequest(company.name));
    const err = tallyLineError(gxml);
    if (err) throw new Error(err);
    groups = parseGroups(gxml);
  } catch (e: any) {
    if (e instanceof TallyFetchError && (e.code === "unreachable" || e.code === "timeout")) throw e;
    warnings.push(
      `The group list couldn't be read (${e?.message || "unknown error"}), so only ledgers sitting directly under Tally's own groups are counted.`
    );
  }
  const classifier = buildGroupClassifier(groups);

  const lxml = await postToTally(opts, buildLedgerBalancesRequest(company.name, period.from, period.to));
  const lerr = tallyLineError(lxml);
  if (lerr) throw new TallyFetchError("tally-error", `Tally reported: "${lerr}"`);
  const raw = parseLedgerBalances(lxml);
  if (!raw.length) {
    throw new TallyFetchError("empty", `Tally answered but returned no ledgers for "${company.name}".`);
  }

  const ledgers = classifyLedgers(raw, classifier);
  const buckets = bucketize(ledgers);
  const summary = summarise(buckets);

  if (summary.cashInHand !== null && summary.cashInHand < 0) {
    warnings.push("Cash-in-Hand shows a credit (negative) balance in Tally — check cash entries.");
  }

  return {
    fetchedAt: new Date().toISOString(),
    company: company.name,
    companies: loaded.map((c) => c.name),
    period,
    ledgers,
    buckets,
    summary,
    classifier,
    warnings,
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
