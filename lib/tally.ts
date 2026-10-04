/** Tally ERP 9 / Tally Prime integration over Tally's built-in HTTP/XML
 *  gateway (Gateway of Tally → F11 → enable "ODBC/HTTP Server", default
 *  port 9000). No third-party service is involved — this talks directly,
 *  request/response, to Tally running on the same PC or same network.
 *
 *  This pairs with the custom TDL report defined in
 *  `tally/BiomePlatformExport.tdl` (report name "Biome Voucher Export"),
 *  which must be loaded inside Tally first (see the comments at the top
 *  of that file for exact steps).
 *
 *  IMPORTANT — this was written without access to a real Tally
 *  installation to test against. The request/response shapes below
 *  follow Tally's documented XML gateway conventions as closely as
 *  possible, but if the very first fetch fails, the error message
 *  returned here should say exactly what Tally sent back — share that
 *  and the TDL/parsing can be corrected quickly.
 */

// Transport lives in tallyFinance.ts (one implementation for every route).
import {
  resolveTallyTarget,
  type TallyRequestSettings,
  parseLedgerBalances,
  escapeXml,
  decodeTally,
  parseTallyAmount,
  toTallyDate as toTallyDateShared,
} from "./tallyFinance";
export { resolveTallyTarget };
export type { TallyRequestSettings };

export interface TallyConnectionSettings {
  host: string; // e.g. "localhost" or a LAN IP like "192.168.1.20"
  port: number; // default 9000
  companyName?: string; // exact Tally company name, optional
}

export interface TallyVoucherRow {
  invoiceNo: string;
  date: string | null;
  party: string | null;
  voucherType: string | null;
  narration: string | null;
  amount: number | null;
}

const DEFAULT_PORT = 9000;


export function normalizeTallySettings(s: Partial<TallyConnectionSettings>): TallyConnectionSettings {
  return {
    host: (s.host || "localhost").trim(),
    port: s.port && s.port > 0 ? s.port : DEFAULT_PORT,
    companyName: s.companyName?.trim() || undefined,
  };
}

function toTallyDate(d: string): string {
  // Accepts "YYYY-MM-DD" (from <input type=date>) and returns Tally's
  // expected "YYYYMMDD".
  return toTallyDateShared(d);
}

/** Minimal request Tally will always respond to (even a "company not
 *  found" style error) — used purely to confirm the HTTP gateway is up
 *  and reachable at all, before we care about actual data. */
export function buildPingRequestXml(): string {
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>List of Companies</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of Companies" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <FETCH>Name</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

/** Requests the custom "Biome Voucher Export" report (defined in the TDL)
 *  for the given date range. */
export function buildVoucherFetchRequestXml(
  fromDate: string,
  toDate: string,
  companyName?: string
): string {
  const company = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : "";
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
     <SVFROMDATE>${toTallyDate(fromDate)}</SVFROMDATE>
     <SVTODATE>${toTallyDate(toDate)}</SVTODATE>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
     ${company}
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;
}

/** Tally's XML output is a little loose (its own &#4; marker, unescaped
 *  characters in older versions), so a tolerant tag reader is used. */
function decodeTallyEntities(s: string): string {
  return decodeTally(s).trim();
}

function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(xml);
  return m ? decodeTallyEntities(m[1]) : null;
}

/** Parses the response of the custom "Biome Voucher Export" report into
 *  flat rows, one per voucher, with the amount taken from the ledger
 *  entry that matches the voucher's party ledger (falling back to the
 *  largest-magnitude entry if no exact name match is found). */
export function parseVoucherExportXml(xml: string): TallyVoucherRow[] {
  const voucherBlocks = extractBlocks(xml, "VOUCHER");
  const rows: TallyVoucherRow[] = [];

  for (const block of voucherBlocks) {
    const invoiceNo = extractTag(block, "VOUCHERNUMBER") || "";
    const date = extractTag(block, "DATE");
    const voucherType = extractTag(block, "VOUCHERTYPE");
    const party = extractTag(block, "PARTYLEDGERNAME");
    const narration = extractTag(block, "NARRATION");

    const entryBlocks = extractBlocks(block, "LEDGERENTRY");
    const entries = entryBlocks.map((eb) => ({
      ledgerName: extractTag(eb, "LEDGERNAME") || "",
      amount: parseTallyAmount(extractTag(eb, "AMOUNT")),
    }));

    let amount: number | null = null;
    if (entries.length) {
      const partyEntry = entries.find(
        (e) => party && e.ledgerName.trim().toLowerCase() === party.trim().toLowerCase()
      );
      const chosen =
        partyEntry ?? entries.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
      amount = Math.abs(chosen.amount);
    }

    if (!invoiceNo && !party) continue; // skip anything that didn't parse at all
    rows.push({ invoiceNo, date, party, voucherType, narration, amount });
  }

  return rows;
}

/** Converts parsed Tally vouchers into the same {fileName, headers, rows}
 *  shape the reconciliation module already uses for uploaded Excel/CSV
 *  files, so fetched Tally data can be dropped straight into the
 *  existing column-mapping + matching pipeline with no separate code path. */
export function tallyRowsToParsedFile(
  rows: TallyVoucherRow[],
  fileName: string
): { fileName: string; headers: string[]; rows: Record<string, any>[] } {
  const headers = ["Voucher No", "Date", "Party", "Voucher Type", "Amount", "Narration"];
  return {
    fileName,
    headers,
    rows: rows.map((r) => ({
      "Voucher No": r.invoiceNo,
      Date: r.date,
      Party: r.party,
      "Voucher Type": r.voucherType,
      Amount: r.amount,
      Narration: r.narration,
    })),
  };
}

/** Fetches Ledger MASTERS (name, group, opening/closing balance) through
 *  Tally's generic inline collection (no custom TDL needed).
 *
 *  Always pass the company and period: without SVCURRENTCOMPANY Tally
 *  answers for whichever company is active on its screen, and without
 *  SVFROMDATE/SVTODATE for whatever period was last chosen there. */
export function buildLedgerMastersRequestXml(opts: { company?: string; from?: string; to?: string } = {}): string {
  const sv = [
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>`,
    opts.company ? `<SVCURRENTCOMPANY>${escapeXml(opts.company)}</SVCURRENTCOMPANY>` : "",
    opts.from ? `<SVFROMDATE TYPE="Date">${toTallyDate(opts.from)}</SVFROMDATE>` : "",
    opts.to ? `<SVTODATE TYPE="Date">${toTallyDate(opts.to)}</SVTODATE>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>EXPORT</TALLYREQUEST>
  <TYPE>COLLECTION</TYPE>
  <ID>Biome Ledger Masters</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    ${sv}
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Biome Ledger Masters" ISMODIFY="No">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, OpeningBalance, ClosingBalance</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
}

export interface TallyLedgerMaster {
  name: string;
  /** Immediate parent group. */
  group: string | null;
  /** Tally XML sign: Dr negative, Cr positive. */
  openingBalance: number;
  closingBalance: number;
  /** Set by /api/tally/ledgers: Tally's predefined group above this
   *  ledger (e.g. "Sundry Debtors"), found by walking the group tree. */
  reservedGroup?: string | null;
  primaryGroup?: string | null;
}

/** Parses the <COLLECTION> response from buildLedgerMastersRequestXml. */
export function parseLedgerMastersXml(xml: string): TallyLedgerMaster[] {
  return parseLedgerBalances(xml);
}

/** True if the response at least looks like Tally XML (vs. an HTML error
 *  page, a plain connection failure, etc). Tally always wraps responses
 *  in an ENVELOPE, error or not. */
export function looksLikeTallyResponse(xml: string): boolean {
  return /<ENVELOPE>/i.test(xml);
}

/** Tally's own error text, when the report/company/etc. wasn't found —
 *  Tally reports these as plain <LINEERROR> tags inside the envelope
 *  rather than an HTTP error status. */
export function extractTallyLineError(xml: string): string | null {
  return extractTag(xml, "LINEERROR");
}
