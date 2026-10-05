/**
 * Biome Platform — a tiny stand-in for Tally Prime's XML port
 * -------------------------------------------------------------------
 *   node tools/tally-mock.mjs [port]        (default 9900)
 *
 * Answers the same XML requests the app sends to Tally on port 9000, in
 * the shape Tally Prime sends back:
 *
 *   Collection "Company"  -> <COMPANY NAME=".."><STARTINGFROM/><BOOKSFROM/>
 *   Collection "Group"    -> <GROUP NAME=".." RESERVEDNAME=".."><PARENT>&#4; Primary</PARENT>
 *   Collection "Ledger"   -> <LEDGER NAME=".." RESERVEDNAME=""><PARENT/><OPENINGBALANCE/><CLOSINGBALANCE/>
 *   Report BiomeVersionInfo / BiomeVouchers (only when `bridge` is on)
 *   anything else         -> <LINEERROR>Could not find Report '..'!</LINEERROR>
 *
 * and it behaves like Tally where the old code went wrong:
 *   - amounts are Tally-signed: DEBIT NEGATIVE, CREDIT POSITIVE;
 *   - without SVCURRENTCOMPANY it answers for the company "active on
 *     screen" (here: the second, old company);
 *   - without SVFROMDATE/SVTODATE it uses the "screen period" — books
 *     beginning to 31 March next year — so last year's sales and
 *     post-dated vouchers leak in, exactly as Alt+F2 does in Tally.
 *
 * The fixture and the hand-computed expected figures live in
 * tools/tally-fixture.mjs.
 *
 * Failure injection (period tests): `faults` is a list of
 *   { kind: "ledgers" | "vouchers", from?: "YYYY-MM-DD", to?: "YYYY-MM-DD",
 *     times: n, how: "http" | "slow", delayMs?: n }
 * The first `times` matching requests fail (HTTP 503 "busy", or answered
 * only after delayMs — slower than the app's time limit); later ones are
 * answered normally. times: Infinity = always fails.
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { COMPANY_A, COMPANY_B, COMPANY_C, buildCompanyA, buildCompanyC, fyStart, isoDate } from "./tally-fixture.mjs";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (xml, t) => {
  const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i").exec(xml);
  return m ? unesc(m[1].trim()) : null;
};

/** Tally prints an amount with 2 decimals; a nil balance is an empty tag. */
const amt = (n) => (Math.abs(n) < 0.005 ? "" : n.toFixed(2));

const envelope = (inner, status = 1) =>
  `<ENVELOPE>\r\n <HEADER>\r\n  <VERSION>1</VERSION>\r\n  <STATUS>${status}</STATUS>\r\n </HEADER>\r\n <BODY>\r\n  <DESC>\r\n  </DESC>\r\n  <DATA>\r\n${inner}\r\n  </DATA>\r\n </BODY>\r\n</ENVELOPE>\r\n`;

const lineError = (msg) => envelope(`   <LINEERROR>${esc(msg)}</LINEERROR>`, 0);

const parseTDate = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/**
 * @param {{ port: number, companies?: string[], active?: string, bridge?: boolean, today?: Date }} opts
 */
export function startMockTally(opts) {
  const today = opts.today ?? new Date();
  const A = buildCompanyA(today);
  const all = { [COMPANY_A]: A, [COMPANY_B]: COMPANY_B_DATA, [COMPANY_C]: buildCompanyC(today) };
  const faults = (opts.faults || []).map((f) => ({ ...f, hits: 0 }));
  const loaded = opts.companies ?? [COMPANY_A, COMPANY_B];
  const active = opts.active ?? loaded[loaded.length - 1];
  const log = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      log.push(body);
      const fault = findFault(body);
      if (fault && fault.how === "http") {
        res.statusCode = 503;
        res.end("Tally is busy");
        return;
      }
      const send = () => {
        if (res.destroyed) return;
        res.setHeader("Content-Type", "text/xml; charset=utf-8");
        res.end(answer(body));
      };
      if (fault && fault.how === "slow") setTimeout(send, fault.delayMs ?? 5000);
      else send();
    });
  });

  function findFault(xml) {
    if (!faults.length) return null;
    const isLedger = /<COLLECTION[^>]*>[\s\S]*?<TYPE>\s*Ledger\s*<\/TYPE>/i.test(xml);
    const isVoucher = /BiomeVouchers|Biome Voucher Export/.test(xml);
    const from = parseTDate(tag(xml, "SVFROMDATE"));
    const to = parseTDate(tag(xml, "SVTODATE"));
    for (const f of faults) {
      if (f.kind === "ledgers" && !isLedger) continue;
      if (f.kind === "vouchers" && !isVoucher) continue;
      if (f.from && f.from !== from) continue;
      if (f.to && f.to !== to) continue;
      if (f.hits >= f.times) continue;
      f.hits += 1;
      return f;
    }
    return null;
  }

  function answer(xml) {
    const id = tag(xml, "ID") || tag(xml, "REPORTNAME") || "";
    const reqType = (tag(xml, "TYPE") || "").toLowerCase();
    const wanted = tag(xml, "SVCURRENTCOMPANY");
    if (wanted && !loaded.includes(wanted)) {
      return lineError(`Could not set 'SVCurrentCompany' to '${wanted}'`);
    }
    const companyName = wanted || active;
    const company = all[companyName];
    const from = parseTDate(tag(xml, "SVFROMDATE"));
    const to = parseTDate(tag(xml, "SVTODATE"));

    const collMatch = /<COLLECTION[^>]*>[\s\S]*?<TYPE>([^<]+)<\/TYPE>/i.exec(xml);
    if (reqType === "collection" && collMatch) {
      const ctype = collMatch[1].trim().toLowerCase();
      if (ctype === "company") return envelope(companies());
      if (ctype === "group") return envelope(groups(company));
      if (ctype === "ledger") return envelope(ledgers(company, from, to));
      return envelope("");
    }
    if (id === "BiomeVersionInfo" && opts.bridge) {
      return envelope(
        `<BRIDGE>BIOME_AI_OS_BRIDGE</BRIDGE><VERSION>1.0.0</VERSION><COMPANY>${esc(companyName)}</COMPANY>`
      );
    }
    if (id === "BiomeVouchers" && opts.bridge) return envelope(vouchers(company, from, to));
    return lineError(`Could not find Report '${id}'!`);
  }

  function companies() {
    return loaded
      .map((n) => {
        const c = all[n];
        return `   <COMPANY NAME="${esc(n)}" RESERVEDNAME="">
    <STARTINGFROM TYPE="Date">${c.booksFrom.replace(/-/g, "")}</STARTINGFROM>
    <BOOKSFROM TYPE="Date">${c.booksFrom.replace(/-/g, "")}</BOOKSFROM>
    <NAME TYPE="String">${esc(n)}</NAME>
   </COMPANY>`;
      })
      .join("\r\n");
  }

  function groups(c) {
    return c.groups
      .map(
        (g) => `   <GROUP NAME="${esc(g.name)}" RESERVEDNAME="${esc(g.reserved ?? "")}">
    <PARENT TYPE="String">${g.parent ? esc(g.parent) : "&#4; Primary"}</PARENT>
   </GROUP>`
      )
      .join("\r\n");
  }

  /** Tally's arithmetic: balance-sheet ledgers carry forward from the books
   *  beginning; P&L ledgers only count the period. */
  function ledgers(c, from, to) {
    if (c.static) return c.static;
    const pFrom = from ?? c.booksFrom; // screen period when not sent
    const pTo = to ?? `${Number(fyStart(today).slice(0, 4)) + 1}-03-31`;
    return c.ledgers
      .map((l) => {
        let open = 0;
        let close = 0;
        if (l.pl) {
          for (const t of l.txns) if (t.date >= pFrom && t.date <= pTo) close += t.dr;
        } else {
          open = l.opening;
          for (const t of l.txns) if (t.date < pFrom) open += t.dr;
          close = open;
          for (const t of l.txns) if (t.date >= pFrom && t.date <= pTo) close += t.dr;
        }
        // Tally sign: debit negative.
        return `   <LEDGER NAME="${esc(l.name)}" RESERVEDNAME="${esc(l.reserved ?? "")}">
    <PARENT TYPE="String">${l.parent ? esc(l.parent) : "&#4; Primary"}</PARENT>
    <OPENINGBALANCE TYPE="Amount">${amt(-open)}</OPENINGBALANCE>
    <CLOSINGBALANCE TYPE="Amount">${amt(-close)}</CLOSINGBALANCE>
    <LANGUAGENAME.LIST>
     <NAME.LIST TYPE="String">
      <NAME>${esc(l.name)}</NAME>
     </NAME.LIST>
     <LANGUAGEID TYPE="Number"> 1033</LANGUAGEID>
    </LANGUAGENAME.LIST>
   </LEDGER>`;
      })
      .join("\r\n");
  }

  function vouchers(c, from, to) {
    return (c.vouchers || [])
      .filter((v) => (!from || v.date >= from) && (!to || v.date <= to))
      .map(
        (v) => `   <VOUCHER>
    <DATE>${v.date.replace(/-/g, "")}</DATE>
    <VOUCHERTYPE>${esc(v.type)}</VOUCHERTYPE>
    <VOUCHERNUMBER>${esc(v.no)}</VOUCHERNUMBER>
    <PARTY>${esc(v.party)}</PARTY>
    <AMOUNT>${v.entries[0].dr.toFixed(2)}</AMOUNT>
${v.entries
  .map(
    (e) => `    <ENTRY>
     <LEDGER>${esc(e.ledger)}</LEDGER>
     <AMOUNT>${Math.abs(e.dr).toFixed(2)}</AMOUNT>
     <ISDEBIT>${e.dr > 0 ? "Yes" : "No"}</ISDEBIT>
    </ENTRY>`
  )
  .join("\r\n")}
   </VOUCHER>`
      )
      .join("\r\n");
  }

  return new Promise((resolve) => {
    server.listen(opts.port, "127.0.0.1", () =>
      resolve({
        server,
        log,
        faults,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      })
    );
  });
}

/* Company B: an old company also open in Tally, whose name has "&" in it.
 * Its ledger XML is fixed text and uses the awkward formats a TDL field
 * or older release can send: "(-)1,000.00", "9,99,999.00 Dr", a
 * self-closing empty amount, and a renamed Sundry Debtors group. */
const COMPANY_B_DATA = {
  booksFrom: "2024-04-01",
  groups: [
    { name: "Current Assets", parent: null, reserved: "Current Assets" },
    { name: "Cash-in-Hand", parent: "Current Assets", reserved: "Cash-in-Hand" },
    { name: "Trade Receivables", parent: "Current Assets", reserved: "Sundry Debtors" },
    { name: "Purchase Accounts", parent: null, reserved: "Purchase Accounts" },
  ],
  static: `   <LEDGER NAME="Cash" RESERVEDNAME="">
    <PARENT TYPE="String">Cash-in-Hand</PARENT>
    <OPENINGBALANCE TYPE="Amount"/>
    <CLOSINGBALANCE TYPE="Amount">(-)1,000.00</CLOSINGBALANCE>
   </LEDGER>
   <LEDGER NAME="Old Customer" RESERVEDNAME="">
    <PARENT TYPE="String">Trade Receivables</PARENT>
    <OPENINGBALANCE TYPE="Amount"></OPENINGBALANCE>
    <CLOSINGBALANCE TYPE="Amount">9,99,999.00 Dr</CLOSINGBALANCE>
   </LEDGER>
   <LEDGER NAME="Purchases" RESERVEDNAME="">
    <PARENT TYPE="String">Purchase Accounts</PARENT>
    <OPENINGBALANCE TYPE="Amount"/>
    <CLOSINGBALANCE TYPE="Amount">-300000000.00</CLOSINGBALANCE>
   </LEDGER>`,
};

// Run standalone: node tools/tally-mock.mjs 9900
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number(process.argv[2]) || 9900;
  startMockTally({ port, bridge: true }).then(() => {
    console.log(`Mock Tally on http://127.0.0.1:${port} — companies: "${COMPANY_A}", "${COMPANY_B}" (today ${isoDate(new Date())})`);
  });
}
