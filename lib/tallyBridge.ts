/**
 * Biome AI OS — Tally Bridge client
 * -------------------------------------------------------------------
 * Talks to the reports declared in tally/BiomeBridge.tdl.
 *
 * WHY THIS REPLACES THE OLD APPROACH
 * The previous code used Tally's stock exports, which return a thin
 * slice: a name, a group, a closing balance. No GSTIN, no registration
 * type, no address, no bill-by-bill allocations, no voucher line items.
 * That is why party-wise and GST-wise views came out empty — the data
 * was never in the response to begin with.
 *
 * The TDL declares exactly the fields we want, so one request returns a
 * complete picture. This is the same technique ClearTax, Computax and
 * Saral use.
 *
 * GRACEFUL DEGRADATION
 * If the TDL isn't loaded yet, `probeBridge` says so clearly and the
 * caller can fall back to the legacy path rather than showing an error.
 */

import { parseTallyAmount, escapeXml, toTallyDate } from "./tallyFinance";

export interface TallyConn {
  host: string;
  port: number;
  company?: string;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------

function envelope(reportName: string, conn: TallyConn, extra = ""): string {
  const company = conn.company?.trim();
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${company ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` : ""}
        ${extra}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Tally wants dates as YYYYMMDD. */
const tallyDate = (d: string) => toTallyDate(d);

/** Balances are "as on" SVTODATE and P&L figures are for SVFROMDATE ..
 *  SVTODATE. Without these Tally uses whatever period was last chosen on
 *  its screen (Alt+F2), so every balance request carries them. */
const period = (from?: string, to?: string) =>
  from && to
    ? `<SVFROMDATE TYPE="Date">${tallyDate(from)}</SVFROMDATE>
        <SVTODATE TYPE="Date">${tallyDate(to)}</SVTODATE>`
    : "";

export const requests = {
  version: (c: TallyConn) => envelope("BiomeVersionInfo", c),
  ledgers: (c: TallyConn, from?: string, to?: string) => envelope("BiomeLedgerMasters", c, period(from, to)),
  balanceSheet: (c: TallyConn, from?: string, to?: string) => envelope("BiomeBalanceSheet", c, period(from, to)),
  profitLoss: (c: TallyConn, from?: string, to?: string) => envelope("BiomeProfitLoss", c, period(from, to)),
  stock: (c: TallyConn, from?: string, to?: string) => envelope("BiomeStockItems", c, period(from, to)),
  vouchers: (c: TallyConn, from: string, to: string) => envelope("BiomeVouchers", c, period(from, to)),
};

// ---------------------------------------------------------------------
// XML reading — deliberately tolerant
// ---------------------------------------------------------------------

/**
 * Tally's XML is not always well-formed: unescaped ampersands in party
 * names, stray control characters, occasional unclosed tags. A strict
 * parser throws away the whole response over one bad ledger name, so
 * these read tag-by-tag instead.
 */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const v = m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return v === "" ? null : v;
}

/** Amounts from TDL fields often arrive as text ("18,65,432.00 Dr",
 *  "(-)5,000.00"); a plain Number() turned all of those into 0. Result is
 *  in Tally's XML convention: Dr negative, Cr positive. */
function tagNumber(block: string, tag: string): number {
  return parseTallyAmount(tagText(block, tag));
}

function tagBool(block: string, tag: string): boolean {
  return String(tagText(block, tag) || "").toLowerCase() === "yes";
}

/** Tally dates arrive as YYYYMMDD or DD-MMM-YYYY. Normalise to ISO. */
function readDate(raw: string | null): string | null {
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (named) {
    const mm = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mm) {
      const yy = named[3].length === 2 ? `20${named[3]}` : named[3];
      return `${yy}-${mm}-${named[1].padStart(2, "0")}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}

// ---------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------

export interface BridgeLedger {
  name: string;
  group: string | null;
  openingBalance: number;
  closingBalance: number;
  gstin: string | null;
  gstRegistrationType: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  pincode: string | null;
  pan: string | null;
  creditDays: number;
  creditLimit: number;
  billWise: boolean;
  bankAccount: string | null;
  ifsc: string | null;
  bankName: string | null;
  /** Convenience: is this a GST-registered party? */
  isGstRegistered: boolean;
}

export interface BridgeVoucherEntry {
  ledger: string | null;
  amount: number;
  isDebit: boolean;
  billRefs: string | null;
}

export interface BridgeVoucher {
  guid: string | null;
  date: string | null;
  voucherType: string | null;
  voucherNumber: string | null;
  party: string | null;
  reference: string | null;
  referenceDate: string | null;
  narration: string | null;
  amount: number;
  entries: BridgeVoucherEntry[];
}

export interface BridgeGroup {
  name: string;
  parent: string | null;
  openingBalance: number;
  closingBalance: number;
  nature: string | null;
}

export interface BridgeStockItem {
  name: string;
  group: string | null;
  units: string | null;
  closingQty: string | null;
  closingValue: number;
  closingRate: string | null;
  hsn: string | null;
}

// ---------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------

export function parseLedgers(xml: string): BridgeLedger[] {
  return blocks(xml, "LEDGER").map((b) => {
    const gstin = tagText(b, "GSTIN");
    const regType = tagText(b, "GSTREGISTRATIONTYPE");
    return {
      name: tagText(b, "NAME") ?? "",
      group: tagText(b, "GROUP"),
      openingBalance: tagNumber(b, "OPENINGBALANCE"),
      closingBalance: tagNumber(b, "CLOSINGBALANCE"),
      gstin,
      gstRegistrationType: regType,
      state: tagText(b, "STATE"),
      phone: tagText(b, "PHONE"),
      email: tagText(b, "EMAIL"),
      address: tagText(b, "ADDRESS"),
      pincode: tagText(b, "PINCODE"),
      pan: tagText(b, "PAN"),
      creditDays: tagNumber(b, "CREDITDAYS"),
      creditLimit: tagNumber(b, "CREDITLIMIT"),
      billWise: tagBool(b, "BILLWISE"),
      bankAccount: tagText(b, "BANKACCOUNT"),
      ifsc: tagText(b, "IFSC"),
      bankName: tagText(b, "BANKNAME"),
      // A 15-character GSTIN is the reliable signal; the registration
      // type field is often left as "Unknown" even on registered parties.
      isGstRegistered: Boolean(gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(gstin)),
    };
  }).filter((l) => l.name);
}

export function parseVouchers(xml: string): BridgeVoucher[] {
  return blocks(xml, "VOUCHER").map((b) => ({
    guid: tagText(b, "GUID"),
    date: readDate(tagText(b, "DATE")),
    voucherType: tagText(b, "VOUCHERTYPE"),
    voucherNumber: tagText(b, "VOUCHERNUMBER"),
    party: tagText(b, "PARTY"),
    reference: tagText(b, "REFERENCE"),
    referenceDate: readDate(tagText(b, "REFERENCEDATE")),
    narration: tagText(b, "NARRATION"),
    amount: tagNumber(b, "AMOUNT"),
    entries: blocks(b, "ENTRY").map((e) => {
      const isDebit = tagBool(e, "ISDEBIT");
      const amt = Math.abs(tagNumber(e, "AMOUNT"));
      return {
        ledger: tagText(e, "LEDGER"),
        // Tally convention, decided by IsDeemedPositive: Dr negative.
        amount: isDebit ? -amt : amt,
        isDebit,
        billRefs: tagText(e, "BILLREFS"),
      };
    }),
  }));
}

export function parseGroups(xml: string): BridgeGroup[] {
  return blocks(xml, "GROUP")
    .map((b) => ({
      name: tagText(b, "NAME") ?? "",
      parent: tagText(b, "PARENT"),
      openingBalance: tagNumber(b, "OPENINGBALANCE"),
      closingBalance: tagNumber(b, "CLOSINGBALANCE"),
      nature: tagText(b, "NATURE"),
    }))
    .filter((g) => g.name);
}

export function parseStock(xml: string): BridgeStockItem[] {
  return blocks(xml, "STOCKITEM")
    .map((b) => ({
      name: tagText(b, "NAME") ?? "",
      group: tagText(b, "GROUP"),
      units: tagText(b, "UNITS"),
      closingQty: tagText(b, "CLOSINGQTY"),
      closingValue: tagNumber(b, "CLOSINGVALUE"),
      closingRate: tagText(b, "CLOSINGRATE"),
      hsn: tagText(b, "HSN"),
    }))
    .filter((s) => s.name);
}

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

export async function askTally(conn: TallyConn, xml: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), conn.timeoutMs ?? 60000);
  try {
    const res = await fetch(`http://${conn.host}:${conn.port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tally replied with HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface BridgeProbe {
  reachable: boolean;
  bridgeLoaded: boolean;
  version: string | null;
  company: string | null;
  message: string;
}

/**
 * Is Tally up, and is our TDL loaded? Distinguishing those two is the
 * whole point — "can't connect" and "connected but the bridge isn't
 * installed" need completely different fixes.
 */
export async function probeBridge(conn: TallyConn): Promise<BridgeProbe> {
  let xml: string;
  try {
    xml = await askTally({ ...conn, timeoutMs: 10000 }, requests.version(conn));
  } catch (err: any) {
    return {
      reachable: false,
      bridgeLoaded: false,
      version: null,
      company: null,
      message:
        err?.name === "AbortError"
          ? `Tally didn't answer within 10s at ${conn.host}:${conn.port}.`
          : `Can't reach Tally at ${conn.host}:${conn.port}. Open Tally, load the company, and set Gateway of Tally → F1 → Advanced Configuration → Client/Server to "Both".`,
    };
  }

  const bridge = tagText(xml, "BRIDGE");
  if (bridge !== "BIOME_AI_OS_BRIDGE") {
    return {
      reachable: true,
      bridgeLoaded: false,
      version: null,
      company: null,
      message:
        "Tally is reachable, but the Biome bridge isn't loaded. In Tally press F1 → TDL & Add-On → F4 (Manage Local TDL), set 'Loading TDLs on startup' to Yes, add the full path to BiomeBridge.tdl, then restart Tally.",
    };
  }

  return {
    reachable: true,
    bridgeLoaded: true,
    version: tagText(xml, "VERSION"),
    company: tagText(xml, "COMPANY"),
    message: "Connected — the Biome bridge is loaded and answering.",
  };
}
