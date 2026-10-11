/**
 * Biome Platform — what happened in a ledger, read from Tally's vouchers
 * -------------------------------------------------------------------
 * Two things the balances alone can't say:
 *
 *  1. LAST ENTRY. A figure like "Bank ₹39.8 L" is only as fresh as the last
 *     voucher that touched a bank ledger. fetchLastEntries() finds, for the
 *     chosen period, the date of the last voucher that touched each ledger
 *     and rolls it up per KPI (cash, bank, receivables, payables, sales,
 *     purchases, GST/taxes, expenses). The home page shows it under each
 *     number ("Last entry: 07-Oct-2026").
 *
 *  2. LEDGER STATEMENT. fetchLedgerStatement() is Tally's Ledger Vouchers
 *     screen for any ledger — vendor, client, bank, expense — with the
 *     opening balance as on From, every voucher (date, contra ledger, type,
 *     number, debit, credit, running balance Dr/Cr), and the closing
 *     balance, cross-checked against Tally's own closing balance.
 *
 * HOW IT ASKS TALLY. Both use an inline-TDL Collection of type Voucher —
 * no add-on (BiomeBridge.tdl) needed:
 *
 *   <COLLECTION><TYPE>Voucher</TYPE>
 *     <FETCH>Date, VoucherTypeName, …, AllLedgerEntries.LedgerName, …Amount</FETCH>
 *     <FILTER>…</FILTER>       period, not cancelled / optional, and for a
 *   </COLLECTION>               statement only vouchers that touch the ledger
 *
 * read ONE MONTH AT A TIME (as lib/tallyFinance.ts does for the voucher
 * list — a multi-year voucher export in one go is what makes Tally time
 * out). Each month is retried when Tally is busy, and months that END
 * before the current month are cached (TALLY_CLOSED_TTL_MS); the current
 * month is always read live; `fresh` (Refresh) skips the cache.
 *
 * For the KPI dates the months are read NEWEST FIRST and reading stops as
 * soon as every KPI has its date — usually one or two requests.
 *
 * Amounts keep Tally's sign everywhere: DEBIT NEGATIVE, CREDIT POSITIVE.
 */

import {
  CATEGORY_LABEL,
  PL_CATEGORIES,
  TallyFetchError,
  addDays,
  buildGroupClassifier,
  cacheGet,
  cacheKey,
  cachePut,
  chooseCompany,
  chunkTimeoutMs,
  decodeTally,
  escapeXml,
  fromTallyDate,
  fySegments,
  ledgerSnapshot,
  listCompanies,
  monthChunks,
  monthName,
  parseTallyAmount,
  postToTally,
  prettyDate,
  readGroupTree,
  resolvePeriod,
  round2,
  staticVars,
  tallyLineError,
  ttlFor,
  withRetry,
  xmlChild,
  xmlObjects,
  type GroupClassifier,
  type ProgressFn,
  type StaticVars,
  type TallyCategory,
  type TallyFinanceOptions,
  type TallyGroupRow,
  type TallyPeriod,
  type TallyTargetOptions,
} from "./tallyFinance";

const norm = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** A string constant inside a TDL formula. Tally has no escape for a
 *  double quote inside "…", so a name containing one can't be put in a
 *  formula — the caller then filters on our side instead. */
function tdlString(s: string): string | null {
  return s.includes('"') ? null : `"${s}"`;
}

/**
 * Collection of vouchers for SVFROMDATE..SVTODATE. `ledger` limits it to
 * vouchers with at least one entry on that ledger (Tally does the
 * filtering, so a month of a busy company stays small).
 */
export function buildVoucherCollectionRequest(
  id: string,
  fetch: string,
  v: StaticVars,
  ledger?: string | null
): string {
  const lit = ledger ? tdlString(ledger) : null;
  const formulas: string[] = [
    `<SYSTEM TYPE="Formulae" NAME="${id}Keep">${escapeXml(
      `$Date >= ##SVFromDate AND $Date <= ##SVToDate AND NOT $IsCancelled AND NOT $IsOptional${
        lit ? ` AND $$FilterCount:AllLedgerEntries:${id}Led > 0` : ""
      }`
    )}</SYSTEM>`,
  ];
  if (lit) formulas.push(`<SYSTEM TYPE="Formulae" NAME="${id}Led">${escapeXml(`$LedgerName = ${lit}`)}</SYSTEM>`);
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
      <TYPE>Voucher</TYPE>
      <FETCH>${fetch}</FETCH>
      <FILTER>${id}Keep</FILTER>
     </COLLECTION>
     ${formulas.join("\n     ")}
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

const LAST_ENTRY_ID = "BiomeLastEntry";
const LAST_ENTRY_FETCH = "Date, AllLedgerEntries.LedgerName";
const STATEMENT_ID = "BiomeLedgerStatement";
const STATEMENT_FETCH =
  "Date, VoucherTypeName, VoucherNumber, Reference, Narration, PartyLedgerName, GUID, " +
  "AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, AllLedgerEntries.IsDeemedPositive";

/** Every ledger's name and immediate group — structure only, no figures. */
export function buildLedgerParentsRequest(company: string): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>Biome Ledger Parents</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${staticVars({ company })}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Biome Ledger Parents" ISMODIFY="No">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** One ledger master with its mailing / GST / contact details. */
export function buildLedgerObjectRequest(company: string, ledger: string): string {
  const fields = [
    "Name", "Parent", "Address", "LedgerStateName", "StateName", "PinCode", "CountryName",
    "PartyGSTIN", "GSTRegistrationType", "IncomeTaxNumber", "LedgerPhone", "LedgerMobile",
    "LedgerContact", "Email", "MailingName", "LedMailingDetails", "LedGSTRegDetails",
  ];
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Object</TYPE>
  <SUBTYPE>Ledger</SUBTYPE>
  <ID TYPE="Name">${escapeXml(ledger)}</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${staticVars({ company })}
   </STATICVARIABLES>
   <FETCHLIST>
    ${fields.map((f) => `<FETCH>${f}</FETCH>`).join("\n    ")}
   </FETCHLIST>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** The company master's own address / GSTIN (for the statement header). */
export function buildCompanyProfileRequest(company: string): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>Biome Company Profile</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${staticVars({ company })}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Biome Company Profile" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <FETCH>Name, Address, StateName, PinCode, Email, PhoneNumber, IncomeTaxNumber, GSTRegistrationNumber, TANumber</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface VoucherLine {
  ledger: string;
  /** Tally sign: Dr negative, Cr positive. */
  amount: number;
}

export interface CollectedVoucher {
  date: string | null;
  voucherType: string | null;
  voucherNumber: string;
  reference: string | null;
  narration: string | null;
  party: string | null;
  guid: string | null;
  entries: VoucherLine[];
}

function readLines(body: string, tag: string): VoucherLine[] {
  return xmlObjects(body, tag)
    .map((e) => {
      const ledger = xmlChild(e.body, "LEDGERNAME") || "";
      const raw = xmlChild(e.body, "AMOUNT");
      let amount = parseTallyAmount(raw);
      const deemed = xmlChild(e.body, "ISDEEMEDPOSITIVE");
      // The amount's own sign is Tally's truth; ISDEEMEDPOSITIVE (Yes = Dr)
      // only decides when the amount came without one.
      if (deemed && raw && !/[-(]|dr|cr/i.test(raw)) amount = /^yes$/i.test(deemed) ? -Math.abs(amount) : Math.abs(amount);
      return { ledger, amount: round2(amount) };
    })
    .filter((l) => l.ledger);
}

/** <VOUCHER …><DATE/>…<ALLLEDGERENTRIES.LIST><LEDGERNAME/><AMOUNT/></…></VOUCHER> */
export function parseVoucherCollection(xml: string): CollectedVoucher[] {
  return xmlObjects(xml, "VOUCHER").map((o) => {
    let entries = readLines(o.body, "ALLLEDGERENTRIES.LIST");
    if (!entries.length) {
      // Older releases / invoice-mode vouchers export LEDGERENTRIES.LIST for
      // the party and taxes, and the sales/purchase ledger under each stock
      // line's ACCOUNTINGALLOCATIONS.LIST.
      entries = [...readLines(o.body, "LEDGERENTRIES.LIST"), ...readLines(o.body, "ACCOUNTINGALLOCATIONS.LIST")];
    }
    return {
      date: fromTallyDate(xmlChild(o.body, "DATE")),
      voucherType: xmlChild(o.body, "VOUCHERTYPENAME") || o.attrs.VCHTYPE || null,
      voucherNumber: xmlChild(o.body, "VOUCHERNUMBER") || "",
      reference: xmlChild(o.body, "REFERENCE") || null,
      narration: xmlChild(o.body, "NARRATION") || null,
      party: xmlChild(o.body, "PARTYLEDGERNAME") || null,
      guid: xmlChild(o.body, "GUID") || null,
      entries,
    };
  });
}

export interface LedgerParent {
  name: string;
  group: string | null;
}

export function parseLedgerParents(xml: string): LedgerParent[] {
  return xmlObjects(xml, "LEDGER")
    .map((o) => {
      const parent = xmlChild(o.body, "PARENT");
      return {
        name: (o.attrs.NAME ?? xmlChild(o.body, "NAME") ?? "").trim(),
        group: !parent || /^\W*primary$/i.test(parent.trim()) ? null : parent,
      };
    })
    .filter((l) => l.name);
}

/** Lines of an `<X.LIST><X>line</X>…</X.LIST>` block, or "" lines skipped. */
function listLines(body: string, listTag: string, itemTag: string): string[] {
  const block = xmlObjects(body, listTag)[0];
  if (!block) return [];
  return xmlObjects(block.body, itemTag)
    .map((x) => decodeTally(x.body).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export interface LedgerDetails {
  mailingName: string | null;
  address: string[];
  state: string | null;
  pincode: string | null;
  country: string | null;
  gstin: string | null;
  gstRegistrationType: string | null;
  pan: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
}

export function parseLedgerObject(xml: string): LedgerDetails | null {
  const led = xmlObjects(xml, "LEDGER")[0];
  if (!led) return null;
  const b = led.body;
  const pick = (...vals: (string | null | undefined)[]) => vals.map((v) => (v ?? "").trim()).find(Boolean) || null;
  // TallyPrime 3+ keeps address / state / GSTIN in dated sub-lists; older
  // releases on the ledger itself. Read both, newest list entry first.
  const mailing = xmlObjects(b, "LEDMAILINGDETAILS.LIST");
  const lastMailing = mailing[mailing.length - 1]?.body ?? "";
  const gstReg = xmlObjects(b, "LEDGSTREGDETAILS.LIST");
  const lastGst = gstReg[gstReg.length - 1]?.body ?? "";
  const address = listLines(lastMailing, "ADDRESS.LIST", "ADDRESS");
  return {
    mailingName: pick(xmlChild(lastMailing, "MAILINGNAME"), listLines(b, "MAILINGNAME.LIST", "MAILINGNAME")[0]),
    address: address.length ? address : listLines(b, "ADDRESS.LIST", "ADDRESS"),
    state: pick(xmlChild(lastMailing, "STATE"), xmlChild(b, "LEDGERSTATENAME"), xmlChild(b, "STATENAME")),
    pincode: pick(xmlChild(lastMailing, "PINCODE"), xmlChild(b, "PINCODE")),
    country: pick(xmlChild(lastMailing, "COUNTRY"), xmlChild(b, "COUNTRYNAME")),
    gstin: pick(xmlChild(lastGst, "GSTIN"), xmlChild(b, "PARTYGSTIN")),
    gstRegistrationType: pick(xmlChild(lastGst, "GSTREGISTRATIONTYPE"), xmlChild(b, "GSTREGISTRATIONTYPE")),
    pan: pick(xmlChild(b, "INCOMETAXNUMBER")),
    contactPerson: pick(xmlChild(b, "LEDGERCONTACT")),
    phone: pick(xmlChild(b, "LEDGERMOBILE"), xmlChild(b, "LEDGERPHONE")),
    email: pick(xmlChild(b, "EMAIL")),
  };
}

export interface CompanyProfile {
  name: string;
  address: string[];
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  email: string | null;
  phone: string | null;
}

export function parseCompanyProfile(xml: string, company: string): Partial<CompanyProfile> | null {
  const hit = xmlObjects(xml, "COMPANY").find(
    (o) => norm(o.attrs.NAME ?? xmlChild(o.body, "NAME")) === norm(company)
  );
  if (!hit) return null;
  const b = hit.body;
  const v = (t: string) => xmlChild(b, t) || null;
  return {
    address: listLines(b, "ADDRESS.LIST", "ADDRESS"),
    state: v("STATENAME"),
    pincode: v("PINCODE"),
    gstin: v("GSTREGISTRATIONNUMBER"),
    pan: v("INCOMETAXNUMBER"),
    email: v("EMAIL"),
    phone: v("PHONENUMBER"),
  };
}

/* ------------------------------------------------------------------ */
/* Shared reading helpers                                              */
/* ------------------------------------------------------------------ */

const STRUCTURE_TTL_MS = 2 * 60 * 1000;

async function ledgerParents(target: TallyTargetOptions, company: string, fresh?: boolean): Promise<LedgerParent[]> {
  const key = cacheKey(target, company, "ledger-parents", "", "");
  const hit = cacheGet<LedgerParent[]>(key, fresh);
  if (hit) return hit;
  const xml = await withRetry(() => postToTallyChecked(target, buildLedgerParentsRequest(company)));
  const rows = parseLedgerParents(xml);
  if (!rows.length) throw new TallyFetchError("empty", `Tally answered but returned no ledgers for "${company}".`);
  cachePut(key, rows, STRUCTURE_TTL_MS);
  return rows;
}

async function postToTallyChecked(target: TallyTargetOptions, xml: string): Promise<string> {
  const out = await postToTally(target, xml);
  const err = tallyLineError(out);
  if (err) throw new TallyFetchError("tally-error", `Tally reported: "${err}"`);
  return out;
}

interface Context {
  company: string;
  companies: string[];
  booksFrom: string | null;
  period: TallyPeriod;
  classifier: GroupClassifier;
  ledgers: LedgerParent[];
  warnings: string[];
}

async function openContext(opts: TallyFinanceOptions, progress: ProgressFn): Promise<Context> {
  resolvePeriod({ fromDate: opts.fromDate, toDate: opts.toDate, today: opts.today });
  progress({ phase: "company", done: 0, total: 1, label: "Checking the company in Tally" });
  const loaded = await listCompanies(opts);
  const company = chooseCompany(loaded, opts.company);
  const booksFrom = company.booksFrom || company.startingFrom || null;
  const period = resolvePeriod({ fromDate: opts.fromDate, toDate: opts.toDate, booksFrom, today: opts.today });
  const warnings: string[] = [];
  let groups: TallyGroupRow[] | null = null;
  try {
    groups = await readGroupTree(opts, company.name, opts.fresh);
  } catch (e: any) {
    if (e instanceof TallyFetchError && (e.code === "unreachable" || e.code === "timeout")) throw e;
    warnings.push(`The group list couldn't be read (${e?.message || "unknown error"}), so ledgers are grouped only by their own parent.`);
  }
  const ledgers = await ledgerParents(opts, company.name, opts.fresh);
  return {
    company: company.name,
    companies: loaded.map((c) => c.name),
    booksFrom,
    period,
    classifier: buildGroupClassifier(groups),
    ledgers,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Last entry dates                                                 */
/* ------------------------------------------------------------------ */

/** KPI -> the Tally groups whose vouchers count for it. Keys match the
 *  fields of TallySummary so a screen can put the date under the figure. */
export const LAST_ENTRY_KPIS: Record<string, TallyCategory[]> = {
  cashInHand: ["cash"],
  bankBalance: ["bank"],
  bankOverdraft: ["bankOD"],
  receivables: ["debtors"],
  payables: ["creditors"],
  sales: ["sales"],
  purchases: ["purchases"],
  taxLiability: ["dutiesTaxes"],
  expenses: ["directExpenses", "indirectExpenses"],
  otherIncome: ["directIncomes", "indirectIncomes"],
};

export interface LastEntryOptions extends TallyFinanceOptions {
  /** "summary" (default): stop as soon as every KPI has its date.
   *  "ledgers": the last date of EVERY ledger (reads the whole period). */
  scope?: "summary" | "ledgers";
}

export interface LastEntryResult {
  fetchedAt: string;
  company: string;
  companies: string[];
  period: TallyPeriod;
  /** KPI -> YYYY-MM-DD of the last voucher in the period, null = none. */
  kpis: Record<string, string | null>;
  /** Tally group label ("Bank Accounts") -> last date. */
  categories: Partial<Record<TallyCategory, string | null>>;
  /** Ledger name -> last date (scope "ledgers"; for "summary" only the
   *  ledgers met in the months that were read). */
  ledgers: Record<string, string>;
  scope: "summary" | "ledgers";
  /** False when some months couldn't be read — a date may then be older
   *  than the real last entry. */
  complete: boolean;
  chunks: { total: number; read: number; cached: number; retried: number; failed: { from: string; to: string; error: string }[] };
  warnings: string[];
  error: string | null;
}

async function lastEntryChunk(
  target: TallyTargetOptions,
  company: string,
  from: string,
  to: string,
  fresh: boolean | undefined,
  today?: Date
): Promise<{ map: Record<string, string>; cached: boolean; attempts: number }> {
  const key = cacheKey(target, company, "last-entry", from, to);
  const hit = cacheGet<Record<string, string>>(key, fresh);
  if (hit) return { map: hit, cached: true, attempts: 0 };
  let attempts = 0;
  const xml = await withRetry((a) => {
    attempts = a;
    return postToTallyChecked(target, buildVoucherCollectionRequest(LAST_ENTRY_ID, LAST_ENTRY_FETCH, { company, from, to }));
  });
  const map: Record<string, string> = {};
  for (const v of parseVoucherCollection(xml)) {
    // Belt and braces: a Tally that ignored the period filter must not
    // move a date outside the month asked for.
    if (!v.date || v.date < from || v.date > to) continue;
    for (const e of v.entries) if (!map[e.ledger] || v.date > map[e.ledger]) map[e.ledger] = v.date;
  }
  cachePut(key, map, ttlFor(to, today));
  return { map, cached: false, attempts };
}

export async function fetchLastEntries(opts: LastEntryOptions): Promise<LastEntryResult> {
  const progress = opts.onProgress ?? (() => {});
  const scope = opts.scope === "ledgers" ? "ledgers" : "summary";
  const ctx = await openContext(opts, progress);
  const { period } = ctx;
  const target: TallyTargetOptions = { ...opts, timeoutMs: chunkTimeoutMs(Math.max(opts.timeoutMs ?? 45000, 90000)) };

  const catOf = new Map<string, TallyCategory>();
  for (const l of ctx.ledgers) catOf.set(norm(l.name), ctx.classifier.classify(l.group).category);
  // KPIs this company can have at all (it has a ledger in the group).
  const present = new Set(catOf.values());
  const wanted = Object.entries(LAST_ENTRY_KPIS)
    .filter(([, cats]) => cats.some((c) => present.has(c)))
    .map(([k]) => k);

  const chunks = monthChunks(period.from, period.to).reverse(); // newest first
  const lastByLedger: Record<string, string> = {};
  const lastByNorm = new Map<string, string>();
  const kpis: Record<string, string | null> = Object.fromEntries(Object.keys(LAST_ENTRY_KPIS).map((k) => [k, null]));
  const failed: LastEntryResult["chunks"]["failed"] = [];
  let read = 0;
  let cached = 0;
  let retried = 0;

  const kpiDone = () => wanted.every((k) => kpis[k] !== null);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (scope === "summary" && kpiDone()) break;
    const name = monthName(c.from);
    progress({ phase: "vouchers", done: i, total: chunks.length, label: `Finding last entries — ${name}` });
    try {
      const r = await lastEntryChunk(target, ctx.company, c.from, c.to, opts.fresh, opts.today);
      read += 1;
      if (r.cached) cached += 1;
      if (r.attempts > 1) retried += 1;
      for (const [ledger, date] of Object.entries(r.map)) {
        const k = norm(ledger);
        if (!lastByNorm.has(k) || date > (lastByNorm.get(k) as string)) {
          lastByNorm.set(k, date);
          lastByLedger[ledger] = date;
        }
      }
      for (const [kpi, cats] of Object.entries(LAST_ENTRY_KPIS)) {
        for (const [ledger, date] of Object.entries(r.map)) {
          const cat = catOf.get(norm(ledger));
          if (cat && cats.includes(cat) && (!kpis[kpi] || date > (kpis[kpi] as string))) kpis[kpi] = date;
        }
      }
    } catch (err: any) {
      failed.push({ from: c.from, to: c.to, error: err?.code === "timeout" ? "Tally didn't answer in time" : err?.message || "unknown error" });
      if (err?.code === "unreachable") {
        for (const rest of chunks.slice(i + 1)) failed.push({ from: rest.from, to: rest.to, error: "not read (Tally stopped answering)" });
        break;
      }
    }
  }
  progress({ phase: "vouchers", done: chunks.length, total: chunks.length, label: "Last entries read" });

  const categories: Partial<Record<TallyCategory, string | null>> = {};
  for (const [ledger, date] of Object.entries(lastByLedger)) {
    const cat = catOf.get(norm(ledger));
    if (!cat) continue;
    if (!categories[cat] || date > (categories[cat] as string)) categories[cat] = date;
  }

  let error: string | null = null;
  if (failed.length && !read) {
    error = `Last-entry dates couldn't be read from Tally: ${failed[0].error}.`;
  } else if (failed.length) {
    error = `${failed.length} month(s) couldn't be read (${failed
      .slice(0, 4)
      .map((f) => monthName(f.from))
      .join(", ")}${failed.length > 4 ? ", …" : ""}), so a last-entry date may be older than the real one. Press Refresh to try again.`;
  }

  return {
    fetchedAt: new Date().toISOString(),
    company: ctx.company,
    companies: ctx.companies,
    period,
    kpis,
    categories,
    ledgers: lastByLedger,
    scope,
    complete: failed.length === 0,
    chunks: { total: chunks.length, read, cached, retried, failed },
    warnings: ctx.warnings,
    error,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Ledger statement                                                 */
/* ------------------------------------------------------------------ */

export interface StatementRow {
  date: string;
  /** The contra ledger Tally would show in "Particulars". */
  particulars: string;
  /** Other contra ledgers on the same side (Tally's "as per details"). */
  moreParticulars: number;
  voucherType: string | null;
  voucherNumber: string;
  reference: string | null;
  narration: string | null;
  debit: number;
  credit: number;
  /** Running balance after this voucher, Tally sign (Dr negative). */
  balance: number;
  /** Every line of the voucher (for the expanded view), Tally sign. */
  entries: VoucherLine[];
}

export interface LedgerStatement {
  fetchedAt: string;
  company: string;
  companyProfile: Partial<CompanyProfile> | null;
  period: TallyPeriod;
  ledger: {
    name: string;
    group: string | null;
    primaryGroup: string | null;
    category: TallyCategory;
    categoryLabel: string;
    /** Sales / purchase / expense / income ledger. */
    profitAndLoss: boolean;
    details: LedgerDetails | null;
  };
  /** Balance at the start of period.from, Tally sign. */
  opening: number;
  rows: StatementRow[];
  totals: { debit: number; credit: number; count: number };
  /** opening + every voucher, Tally sign. */
  closing: number;
  /** Tally's own closing balance for the same date (null when not comparable). */
  tallyClosing: number | null;
  /** Set when our closing differs from Tally's — something wasn't read. */
  mismatch: string | null;
  warnings: string[];
  chunks: { total: number; cached: number; retried: number };
}

export interface LedgerStatementOptions extends TallyFinanceOptions {
  ledger: string;
}

async function statementChunk(
  target: TallyTargetOptions,
  company: string,
  ledger: string,
  from: string,
  to: string,
  fresh: boolean | undefined,
  today?: Date
): Promise<{ vouchers: CollectedVoucher[]; cached: boolean; attempts: number }> {
  const key = cacheKey(target, company, `ledger-statement:${norm(ledger)}`, from, to);
  const hit = cacheGet<CollectedVoucher[]>(key, fresh);
  if (hit) return { vouchers: hit, cached: true, attempts: 0 };
  let attempts = 0;
  const xml = await withRetry((a) => {
    attempts = a;
    return postToTallyChecked(target, buildVoucherCollectionRequest(STATEMENT_ID, STATEMENT_FETCH, { company, from, to }, ledger));
  });
  const me = norm(ledger);
  const vouchers = parseVoucherCollection(xml).filter(
    (v) => v.date && v.date >= from && v.date <= to && v.entries.some((e) => norm(e.ledger) === me)
  );
  cachePut(key, vouchers, ttlFor(to, today));
  return { vouchers, cached: false, attempts };
}

/** The contra ledger(s) for this ledger's side of a voucher. */
function particularsOf(entries: VoucherLine[], me: string, net: number): { name: string; more: number } {
  const others = entries.filter((e) => norm(e.ledger) !== me);
  // Opposite side to this ledger: if this ledger is Dr (net < 0), the
  // contra is on the Cr side (amount > 0), and the other way round.
  const opposite = others.filter((e) => (net < 0 ? e.amount > 0 : e.amount < 0));
  const pool = (opposite.length ? opposite : others).slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  if (!pool.length) return { name: "(this ledger only)", more: 0 };
  const names = [...new Set(pool.map((e) => e.ledger))];
  return { name: names[0], more: names.length - 1 };
}

export async function fetchLedgerStatement(opts: LedgerStatementOptions): Promise<LedgerStatement> {
  const progress = opts.onProgress ?? (() => {});
  const wantedName = String(opts.ledger || "").trim();
  if (!wantedName) throw new TallyFetchError("bad-range", "Pick a ledger first.", 400);
  const ctx = await openContext(opts, progress);
  const { period } = ctx;
  const me = norm(wantedName);
  const found = ctx.ledgers.find((l) => norm(l.name) === me);
  if (!found) {
    throw new TallyFetchError(
      "empty",
      `There is no ledger named "${wantedName}" in "${ctx.company}". Check the spelling, or pick it from the ledger list.`,
      404
    );
  }
  const ledgerName = found.name;
  const { category, primaryGroup } = ctx.classifier.classify(found.group);
  const profitAndLoss = PL_CATEGORIES.has(category);
  const warnings = [...ctx.warnings];
  const target: TallyTargetOptions = { ...opts, timeoutMs: chunkTimeoutMs(Math.max(opts.timeoutMs ?? 45000, 90000)) };

  // ---- Opening and Tally's closing (ledger balances, cached like the rest) ----
  const segs = fySegments(period.from, period.to, ctx.booksFrom);
  const first = segs[0];
  const last = segs[segs.length - 1];
  const pick = (rows: { name: string; openingBalance: number; closingBalance: number }[]) =>
    rows.find((r) => norm(r.name) === norm(ledgerName));
  progress({ phase: "balances", done: 0, total: 2, label: "Reading the opening balance" });
  let opening = 0;
  if (period.from > first.fyFrom) {
    const before = await ledgerSnapshot(target, ctx.company, first.fyFrom, addDays(period.from, -1), opts.fresh, opts.today);
    opening = pick(before.rows)?.closingBalance ?? 0;
  } else {
    const at = await ledgerSnapshot(target, ctx.company, first.fyFrom, first.to, opts.fresh, opts.today);
    opening = profitAndLoss ? 0 : pick(at.rows)?.openingBalance ?? 0;
  }
  progress({ phase: "balances", done: 1, total: 2, label: "Reading the closing balance" });
  const end = await ledgerSnapshot(target, ctx.company, last.fyFrom, period.to, opts.fresh, opts.today);
  // A P&L ledger restarts from nil each 1 April, so over several years
  // Tally's closing is that last year's figure only — not comparable.
  const tallyClosing = profitAndLoss && segs.length > 1 ? null : pick(end.rows)?.closingBalance ?? 0;

  // ---- Vouchers, month by month ----
  const chunks = monthChunks(period.from, period.to);
  const vouchers: CollectedVoucher[] = [];
  let cached = 0;
  let retried = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const name = chunks.length > 1 ? monthName(c.from) : `${prettyDate(c.from)} to ${prettyDate(c.to)}`;
    progress({ phase: "vouchers", done: i, total: chunks.length, label: `Reading ${ledgerName} — ${name}` });
    try {
      const r = await statementChunk(target, ctx.company, ledgerName, c.from, c.to, opts.fresh, opts.today);
      vouchers.push(...r.vouchers);
      if (r.cached) cached += 1;
      if (r.attempts > 1) retried += 1;
    } catch (err: any) {
      // A statement with a month missing would show a wrong running
      // balance — stop and say which month instead.
      if (err instanceof TallyFetchError) {
        throw new TallyFetchError(
          err.code,
          `${err.message.replace(/\.$/, "")} (reading ${name}${chunks.length > 1 ? `, month ${i + 1} of ${chunks.length}` : ""}). Press Refresh to try again${chunks.length > 1 ? ", or pick a shorter period" : ""}.`,
          err.status,
          err.companies
        );
      }
      throw err;
    }
  }
  progress({ phase: "vouchers", done: chunks.length, total: chunks.length, label: "Vouchers read" });

  vouchers.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let running = opening;
  let debit = 0;
  let credit = 0;
  const rows: StatementRow[] = vouchers.map((v) => {
    const net = round2(v.entries.filter((e) => norm(e.ledger) === norm(ledgerName)).reduce((s, e) => s + e.amount, 0));
    running = round2(running + net);
    const dr = net < 0 ? -net : 0;
    const cr = net > 0 ? net : 0;
    debit = round2(debit + dr);
    credit = round2(credit + cr);
    const p = particularsOf(v.entries, norm(ledgerName), net);
    return {
      date: v.date as string,
      particulars: p.name,
      moreParticulars: p.more,
      voucherType: v.voucherType,
      voucherNumber: v.voucherNumber,
      reference: v.reference,
      narration: v.narration,
      debit: dr,
      credit: cr,
      balance: running,
      entries: v.entries,
    };
  });
  const closing = round2(running);

  let mismatch: string | null = null;
  if (tallyClosing !== null && Math.abs(closing - tallyClosing) >= 0.01) {
    const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })} ${n < 0 ? "Dr" : n > 0 ? "Cr" : ""}`.trim();
    mismatch = `Tally's closing balance on ${period.asOn} is ${fmt(tallyClosing)}, but opening plus the vouchers read comes to ${fmt(
      closing
    )}. Some vouchers may not have been read (for example item-invoice vouchers on an older Tally release). Check this ledger in Tally before relying on the running balance.`;
  }

  // ---- Party details (best effort — the statement stands without them) ----
  let details: LedgerDetails | null = null;
  try {
    const key = cacheKey(opts, ctx.company, `ledger-object:${norm(ledgerName)}`, "", "");
    details = cacheGet<LedgerDetails>(key, opts.fresh) ?? null;
    if (!details) {
      const xml = await postToTallyChecked(opts, buildLedgerObjectRequest(ctx.company, ledgerName));
      details = parseLedgerObject(xml);
      if (details) cachePut(key, details, STRUCTURE_TTL_MS);
    }
  } catch (e: any) {
    warnings.push(`The ledger's address and GST details couldn't be read from Tally (${e?.message || "unknown error"}).`);
  }
  let companyProfile: Partial<CompanyProfile> | null = null;
  try {
    const key = cacheKey(opts, ctx.company, "company-profile", "", "");
    companyProfile = cacheGet<Partial<CompanyProfile>>(key, opts.fresh) ?? null;
    if (!companyProfile) {
      const xml = await postToTallyChecked(opts, buildCompanyProfileRequest(ctx.company));
      companyProfile = parseCompanyProfile(xml, ctx.company);
      if (companyProfile) cachePut(key, companyProfile, STRUCTURE_TTL_MS);
    }
  } catch {
    /* the header falls back to the company profile kept in the app */
  }

  return {
    fetchedAt: new Date().toISOString(),
    company: ctx.company,
    companyProfile,
    period,
    ledger: {
      name: ledgerName,
      group: found.group,
      primaryGroup,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      profitAndLoss,
      details,
    },
    opening: round2(opening),
    rows,
    totals: { debit, credit, count: rows.length },
    closing,
    tallyClosing,
    mismatch,
    warnings,
    chunks: { total: chunks.length, cached, retried },
  };
}

/** Every ledger name with its group, for the statement's ledger picker. */
export async function listLedgerNames(opts: TallyFinanceOptions): Promise<{
  company: string;
  ledgers: { name: string; group: string | null; category: TallyCategory; categoryLabel: string }[];
}> {
  const ctx = await openContext(opts, opts.onProgress ?? (() => {}));
  return {
    company: ctx.company,
    ledgers: ctx.ledgers
      .map((l) => {
        const c = ctx.classifier.classify(l.group).category;
        return { name: l.name, group: l.group, category: c, categoryLabel: CATEGORY_LABEL[c] };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

