/**
 * Biome Platform — Tally figures self-check
 * -------------------------------------------------------------------
 *   npx next build                      (once, if .next is missing)
 *   node tools/tally-check.mjs          (starts the app itself on :4399)
 *   node tools/tally-check.mjs --app http://localhost:3000
 *                                       (use an app that is already running;
 *                                        needs its BIOME_AUTH_SECRET in env,
 *                                        log-in user via TALLY_CHECK_USER /
 *                                        TALLY_CHECK_PASS, default developer)
 *
 * What it does:
 *   1. Checks the amount/XML readers in lib/tallyFinance.ts directly
 *      ("4,00,000.00 Dr", "(-)5,000.00", RESERVEDNAME before NAME, …).
 *   2. Starts a mock Tally (tools/tally-mock.mjs) loaded with the test
 *      company in tools/tally-fixture.mjs, points the app at it, and
 *      asserts that /api/tally/full, /api/dashboard and /api/tally/ledgers
 *      return EXACTLY the hand-computed figures documented in the fixture.
 *   3. Checks the failure cases: two companies open and none chosen, a
 *      company that isn't open, Tally not running — each must return a
 *      clear error and NO figures.
 *
 * No test framework — it runs on a plain Node install.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// lib/tallyFinance.ts is TypeScript; Node 22 reads it with this flag.
if (!process.execArgv.includes("--experimental-strip-types") && !process.env.__TALLY_CHECK_CHILD) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, __TALLY_CHECK_CHILD: "1" },
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  await main();
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  const { startMockTally } = await import("./tally-mock.mjs");
  const F = await import("./tally-fixture.mjs");

  let passed = 0;
  let failed = 0;
  const close = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);
  function check(name, actual, expected) {
    const ok =
      typeof expected === "number" || expected === null
        ? close(actual ?? null, expected)
        : JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
    }
  }
  function group(name) {
    console.log(`\n${name}`);
  }

  /* ---------------- 1. readers ---------------- */
  group("Amount and XML readers (lib/tallyFinance.ts)");
  let T;
  try {
    T = await import(pathToFileURL(path.join(root, "lib/tallyFinance.ts")).href);
  } catch (e) {
    console.log("  (skipped — this Node can't load TypeScript directly: " + e.message + ")");
  }
  if (T) {
    const p = T.parseTallyAmount;
    check("plain debit", p("-400000.00"), -400000);
    check("plain credit", p("123456.50"), 123456.5);
    check("Indian commas + Dr", p("4,00,000.00 Dr"), -400000);
    check("Indian commas + Cr", p("1,23,456.00 Cr"), 123456);
    check("Dr without space", p("5,000.00Dr"), -5000);
    check("(-) prefix", p("(-)5,000.00"), -5000);
    check("empty", p(""), 0);
    check("null", p(null), 0);
    check("rupee sign", p("₹ 1,000.00"), 1000);
    check("forex", p("-$100.00 @ ₹ 83.00/$ = -₹ 8300.00"), -8300);
    const led = T.parseLedgerBalances(
      `<LEDGER NAME="Cash" RESERVEDNAME=""><PARENT TYPE="String">Cash-in-Hand</PARENT><OPENINGBALANCE TYPE="Amount"/><CLOSINGBALANCE TYPE="Amount">-10.00</CLOSINGBALANCE></LEDGER>` +
        `<LEDGER NAME="Profit &amp; Loss A/c" RESERVEDNAME="Profit &amp; Loss A/c"><PARENT TYPE="String">&#4; Primary</PARENT><CLOSINGBALANCE TYPE="Amount"></CLOSINGBALANCE></LEDGER>`
    );
    check("NAME read even with RESERVEDNAME after it", led.map((l) => l.name), ["Cash", "Profit & Loss A/c"]);
    check("self-closing amount is 0, next tag still read", [led[0].openingBalance, led[0].closingBalance], [0, -10]);
    check("&#4; Primary means top level", led[1].group, null);
    const cls = T.buildGroupClassifier([
      { name: "Sundry Debtors", parent: "Current Assets", reservedName: "Sundry Debtors" },
      { name: "Current Assets", parent: null, reservedName: "Current Assets" },
      { name: "Debtors - NTPC", parent: "Sundry Debtors", reservedName: null },
      { name: "NTPC Plants", parent: "Debtors - NTPC", reservedName: null },
      { name: "Trade Receivables", parent: "Current Assets", reservedName: "Sundry Debtors" },
      { name: "Sundry Creditors for Expenses", parent: "Current Assets", reservedName: null },
    ]);
    check("two-level sub-group is a debtor", cls.classify("NTPC Plants").category, "debtors");
    check("renamed Sundry Debtors still a debtor", cls.classify("Trade Receivables").category, "debtors");
    check("a group only NAMED like creditors is not", cls.classify("Sundry Creditors for Expenses").category, "other");
    const per = T.resolvePeriod({ today: new Date(2026, 9, 4) });
    check("period", [per.from, per.to, per.label], ["2026-04-01", "2026-10-04", "FY 2026-27 till today"]);
    const perJan = T.resolvePeriod({ today: new Date(2027, 0, 15), booksFrom: "2026-06-01" });
    check("period in Jan, books started mid-year", [perJan.from, perJan.to], ["2026-06-01", "2027-01-15"]);
    check("escaping company name", T.escapeXml("A & B <C>"), "A &amp; B &lt;C&gt;");

    group("Periods — validation, labels, chunking, retries (lib/tallyFinance.ts)");
    const day = new Date(2026, 9, 4); // 04-Oct-2026
    const err = (fn) => {
      try {
        fn();
        return null;
      } catch (e) {
        return e.code || e.message;
      }
    };
    check("From after To is refused", err(() => T.resolvePeriod({ fromDate: "2026-06-01", toDate: "2026-05-01", today: day })), "bad-range");
    check("not a date is refused", err(() => T.resolvePeriod({ fromDate: "2026-02-30", toDate: "2026-05-01", today: day })), "bad-range");
    const lastFy = T.resolvePeriod({ fromDate: "2025-04-01", toDate: "2026-03-31", today: day });
    check("Last FY label", [lastFy.label, lastFy.asOn, lastFy.fyCount], ["FY 2025-26", "31-Mar-2026", 1]);
    const three = T.resolvePeriod({ fromDate: "2023-04-01", toDate: "2026-03-31", today: day, booksFrom: "2020-04-01" });
    check("Last 3 FYs label", [three.label, three.fyCount], ["FY 2023-24 to FY 2025-26", 3]);
    const month = T.resolvePeriod({ fromDate: "2026-09-01", toDate: "2026-09-30", today: day });
    check("Last month label", month.label, "Sep 2026");
    const clamp = T.resolvePeriod({ fromDate: "2019-01-01", toDate: "2024-06-30", today: day, booksFrom: "2023-04-01" });
    check("From before books beginning is clamped, with a note", [clamp.from, clamp.notes.length], ["2023-04-01", 1]);
    check(
      "whole range before books beginning is refused",
      err(() => T.resolvePeriod({ fromDate: "2019-01-01", toDate: "2020-06-30", today: day, booksFrom: "2023-04-01" })),
      "bad-range"
    );
    const fut = T.resolvePeriod({ fromDate: "2026-04-01", toDate: "2027-03-31", today: day });
    check("future To runs to today, with a note", [fut.to, fut.notes.length, fut.label], ["2026-10-04", 1, "FY 2026-27 till today"]);
    const books = T.resolvePeriod({ fromDate: "books", toDate: "2026-10-04", today: day, booksFrom: "2021-04-01" });
    check("since books beginning", [books.from, books.label], ["2021-04-01", "Since books beginning (01-Apr-2021) to today"]);
    check(
      "FY pieces of a 3½-year range",
      T.fySegments("2023-05-10", "2026-10-04").map((g) => [g.fyFrom, g.from, g.to]),
      [
        ["2023-04-01", "2023-05-10", "2024-03-31"],
        ["2024-04-01", "2024-04-01", "2025-03-31"],
        ["2025-04-01", "2025-04-01", "2026-03-31"],
        ["2026-04-01", "2026-04-01", "2026-10-04"],
      ]
    );
    const mc = T.monthChunks("2024-02-15", "2026-10-04");
    check("month pieces (first/last partial)", [mc.length, mc[0], mc[1].to, mc[mc.length - 1]], [
      33,
      { from: "2024-02-15", to: "2024-02-29" },
      "2024-03-31",
      { from: "2026-10-01", to: "2026-10-04" },
    ]);
    check("closed period (before this month)", [T.isClosedPeriod("2026-09-30", day), T.isClosedPeriod("2026-10-01", day)], [true, false]);
    let tries = 0;
    const ok = await T.withRetry(
      async () => {
        tries += 1;
        if (tries < 3) throw new T.TallyFetchError("timeout", "slow", 504);
        return "read";
      },
      { delayMs: 0 }
    );
    check("a piece that times out twice is read on the 3rd try", [ok, tries], ["read", 3]);
    tries = 0;
    const permanent = await T.withRetry(
      async () => {
        tries += 1;
        throw new T.TallyFetchError("company-not-open", "no", 409);
      },
      { delayMs: 0 }
    ).catch((e) => e.code);
    check("a permanent error is not retried", [permanent, tries], ["company-not-open", 1]);
  }

  /* ---------------- 2. app against mock Tally ---------------- */
  const argApp = process.argv.indexOf("--app");
  let base = argApp > 0 ? process.argv[argApp + 1] : process.env.BIOME_APP_URL;
  let app = null;
  let dataRoot = null;
  // Sign in as the server PC (the developer must be signed in there before
  // anyone else can). The header is an HMAC of the install's secret.
  const authSecret = process.env.BIOME_AUTH_SECRET || crypto.randomBytes(24).toString("hex");
  if (!base) {
    if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
      console.log("\nNo build found — run `npx next build` first, or pass --app <url>.");
      process.exit(1);
    }
    const port = Number(process.env.TALLY_CHECK_PORT) || 4399;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "biome-tally-check-"));
    app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
      cwd: root,
      env: {
        ...process.env,
        BIOME_DATA_ROOT: dataRoot,
        BIOME_AUTH_SECRET: authSecret,
        // Short pauses / time limits so the retry and slow-piece cases run fast.
        BIOME_TALLY_RETRY_DELAY_MS: "50",
        BIOME_TALLY_CHUNK_TIMEOUT_MS: "2500",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    app.stdout.on("data", (d) => (out += d));
    app.stderr.on("data", (d) => (out += d));
    base = `http://localhost:${port}`;
    for (let i = 0; i < 120; i++) {
      try {
        await fetch(base + "/api/auth/login");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (i === 119) {
        console.log(out);
        throw new Error("App did not start.");
      }
    }
  }

  const M1 = 9911; // both companies open, bridge TDL loaded
  const M2 = 9912; // only company A open, no bridge
  const DEAD = 9913; // nothing listening
  const today = new Date();
  const mock1 = await startMockTally({ port: M1, bridge: true, today });
  const mock2 = await startMockTally({ port: M2, companies: [F.COMPANY_A], bridge: false, today });
  // Multi-year company with injected faults (see the Periods section).
  const M3 = 9914;
  const fyY = Number(F.fyStart(today).slice(0, 4));
  const faults = [
    { kind: "vouchers", from: `${fyY - 2}-06-01`, times: 1, how: "http" }, // fails once, then read
    { kind: "vouchers", from: `${fyY - 2}-09-01`, times: Infinity, how: "http" }, // never answers
    { kind: "ledgers", to: `${fyY - 2}-03-31`, times: 1, how: "http" }, // a FY of balances fails once
  ];
  if (app) faults.push({ kind: "ledgers", to: `${fyY - 1}-03-31`, times: 1, how: "slow", delayMs: 4500 }); // slower than the time limit once
  const mock3 = await startMockTally({ port: M3, companies: [F.COMPANY_C], bridge: true, today, faults });

  try {
    // ---- log in ----
    const user = process.env.TALLY_CHECK_USER || "developer";
    const pass = process.env.TALLY_CHECK_PASS || "biome-admin";
    const serverPc = crypto
      .createHmac("sha256", authSecret)
      .update("biome-server-pc-v1")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-biome-server-pc": serverPc },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!login.ok) throw new Error(`Login failed (${login.status}): ${await login.text()}`);

    const post = async (route, body) => {
      const r = await fetch(base + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, "x-biome-server-pc": serverPc },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };

    const fyFrom = F.fyStart(today);
    const todayIso = F.isoDate(today);

    group(`/api/tally/full — "${F.COMPANY_A}" (two companies open)`);
    const full = await post("/api/tally/full", { host: "127.0.0.1", port: M1, company: F.COMPANY_A });
    check("HTTP status", full.status, 200);
    for (const [k, v] of Object.entries(F.EXPECTED_A)) check(`summary.${k}`, full.json.summary?.[k], v);
    for (const [k, v] of Object.entries(F.EXPECTED_A_COUNTS)) check(`counts.${k}`, full.json.counts?.[k], v);
    check("company", full.json.company, F.COMPANY_A);
    check("period", [full.json.period?.from, full.json.period?.to], [fyFrom, todayIso]);
    check("period label", full.json.period?.label, `FY ${F.fyLabel(today)} till today`);
    check("JPL shows as an advance (negative)", full.json.parties?.debtors?.find((d) => d.name === "Jhajjar Power Limited")?.closingBalance, -200000);
    check("SBI CC is not a bank account", (full.json.parties?.bank || []).map((b) => b.name).sort(), ["HDFC Bank CA 50200012345", "ICICI Bank CA"]);
    check("Electricity Payable is not a vendor", (full.json.parties?.creditors || []).some((c) => c.name === "Electricity Payable"), false);
    check("voucher source", full.json.voucherSource, "bridge");
    check(
      "monthly sales/purchases/receipts from ledger lines",
      (full.json.monthlySeries || []).map(({ month, sales, purchases, receipts }) => ({ month, sales, purchases, receipts })),
      F.expectedMonthly(today)
    );
    const ledgerReq = mock1.log.filter((x) => /<TYPE>Ledger<\/TYPE>/i.test(x)).pop() || "";
    check("ledger request names the company", /<SVCURRENTCOMPANY>Biome Industria Private Limited<\/SVCURRENTCOMPANY>/.test(ledgerReq), true);
    check("ledger request has SVFROMDATE", ledgerReq.includes(`<SVFROMDATE TYPE="Date">${fyFrom.replace(/-/g, "")}</SVFROMDATE>`), true);
    check("ledger request has SVTODATE", ledgerReq.includes(`<SVTODATE TYPE="Date">${todayIso.replace(/-/g, "")}</SVTODATE>`), true);

    group("/api/tally/full — balances only (what the home page asks for)");
    const bal = await post("/api/tally/full", { host: "127.0.0.1", port: M1, company: F.COMPANY_A, includeVouchers: false });
    check("same sales", bal.json.summary?.sales, F.EXPECTED_A.sales);
    check("no vouchers read", bal.json.counts?.vouchers, 0);

    group("/api/dashboard — same numbers");
    const dash = await post("/api/dashboard", { host: "127.0.0.1", port: M1, company: F.COMPANY_A });
    check("HTTP status", dash.status, 200);
    for (const k of ["cashInHand", "bankBalance", "receivables", "payables", "sales", "purchases"]) {
      check(`summary.${k}`, dash.json.summary?.[k], F.EXPECTED_A[k]);
    }

    group("/api/tally/ledgers — names and Tally groups");
    const led = await post("/api/tally/ledgers", { host: "127.0.0.1", port: M1, companyName: F.COMPANY_A });
    const byName = Object.fromEntries((led.json.ledgers || []).map((l) => [l.name, l]));
    check("'&' in names decoded", Boolean(byName["Shree Ram Transport & Co."] && byName["Profit & Loss A/c"]), true);
    check("NTPC Mouda -> Sundry Debtors", byName["NTPC Mouda"]?.reservedGroup, "Sundry Debtors");
    check("NTPC Mouda raw Tally sign (Dr negative)", byName["NTPC Mouda"]?.closingBalance, -8500000);

    group(`Company with "&" in its name ("${F.COMPANY_B}")`);
    const b = await post("/api/tally/full", { host: "127.0.0.1", port: M1, company: F.COMPANY_B, includeVouchers: false });
    check("HTTP status", b.status, 200);
    for (const [k, v] of Object.entries(F.EXPECTED_B)) check(`summary.${k}`, b.json.summary?.[k], v);
    const bReq = mock1.log.filter((x) => /<TYPE>Ledger<\/TYPE>/i.test(x)).pop() || "";
    check("company name escaped as &amp;", bReq.includes("Biome Pellets &amp; Biomass (Old Books)"), true);

    group("Two companies open, none chosen -> clear error, no figures");
    const two = await post("/api/tally/full", { host: "127.0.0.1", port: M1 });
    check("HTTP status", two.status, 409);
    check("code", two.json.code, "choose-company");
    check("lists both companies", (two.json.companies || []).length, 2);
    check("no summary", two.json.summary, undefined);

    group("Company set in Settings is not open -> clear error");
    const notOpen = await post("/api/tally/full", { host: "127.0.0.1", port: M2, company: F.COMPANY_B });
    check("HTTP status", notOpen.status, 409);
    check("code", notOpen.json.code, "company-not-open");

    group("Only one company open, none chosen -> that company");
    const one = await post("/api/tally/full", { host: "127.0.0.1", port: M2 });
    check("HTTP status", one.status, 200);
    check("company", one.json.company, F.COMPANY_A);
    check("sales", one.json.summary?.sales, F.EXPECTED_A.sales);
    check("bridge missing is reported, not hidden", typeof one.json.voucherError === "string" && one.json.voucherError.length > 0, true);

    group("Tally not running -> error, no numbers");
    const dead = await post("/api/tally/full", { host: "127.0.0.1", port: DEAD, company: F.COMPANY_A });
    check("HTTP status", dead.status, 502);
    check("code", dead.json.code, "unreachable");
    check("no summary", dead.json.summary, undefined);

    /* ---------------- Periods (multi-year company C) ---------------- */
    const C = { host: "127.0.0.1", port: M3, company: F.COMPANY_C };
    const fyN = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pretty = (d) => `${d.slice(8, 10)}-${MONS[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
    const ledgerReqs = (from = 0) => mock3.log.slice(from).filter((x) => /<TYPE>Ledger<\/TYPE>/i.test(x));
    const voucherReqs = (from = 0) => mock3.log.slice(from).filter((x) => /BiomeVouchers/.test(x));
    const sv = (x, t) => (new RegExp(`<${t} TYPE="Date">(\\d{8})</${t}>`).exec(x) || [])[1];
    const booksC = `${fyY - 3}-04-01`;

    group("Periods — Last 3 FYs, balances per FY + transactions month by month");
    const l3From = `${fyY - 3}-04-01`;
    const l3To = `${fyY}-03-31`;
    const E3 = F.expectedC(today, l3From, l3To);
    let mark = mock3.log.length;
    const l3 = await post("/api/tally/full", { ...C, fromDate: l3From, toDate: l3To });
    check("HTTP status", l3.status, 200);
    for (const k of ["sales", "purchases", "expenses", "cashInHand", "bankBalance", "receivables", "payables"]) {
      check(`summary.${k} (sum of 3 years / as on ${pretty(l3To)})`, l3.json.summary?.[k], E3[k]);
    }
    check("period label", l3.json.period?.label, `FY ${fyN(fyY - 3)} to FY ${fyN(fyY - 1)}`);
    check("balances as on", l3.json.period?.asOn, pretty(l3To));
    check("3 balance readings, one per FY", l3.json.readings, 3);
    check(
      "each FY asked for separately (SVFROMDATE..SVTODATE)",
      [...new Set(ledgerReqs(mark).map((x) => `${sv(x, "SVFROMDATE")}-${sv(x, "SVTODATE")}`))].sort(),
      [0, 1, 2].map((i) => `${fyY - 3 + i}0401-${fyY - 2 + i}0331`)
    );
    check("a FY reading that failed once was retried", mock3.faults[2].hits, 1);
    if (app) check("a FY reading slower than the time limit was retried", mock3.faults[3].hits, 1);
    check("balances needed a retry", (l3.json.retried ?? 0) >= 1, true);
    const ch = l3.json.voucherChunks || {};
    check("transactions read in 36 monthly pieces", ch.total, 36);
    check("a month that failed once was read on retry", [mock3.faults[0].hits, (ch.retried ?? 0) >= 1], [1, true]);
    check("the month that never answers is listed", (ch.failed || []).map((f) => f.from), [`${fyY - 2}-09-01`]);
    check("…and named in the warning", String(l3.json.voucherError || "").includes(`Sep-${fyY - 2}`), true);
    const sepVouchers = F.expectedC(today, `${fyY - 2}-09-01`, `${fyY - 2}-09-30`).voucherCount;
    check("all other months' transactions are there", l3.json.counts?.vouchers, E3.voucherCount - sepVouchers);
    check("monthly chart covers the other 35 months", (l3.json.monthlySeries || []).length, 35);
    check("chart sales add up (all months but the failed one)",
      (l3.json.monthlySeries || []).reduce((a, m) => a + m.sales, 0),
      E3.sales - F.expectedC(today, `${fyY - 2}-09-01`, `${fyY - 2}-09-30`).sales
    );

    group("Periods — cache: closed past periods reused, Refresh re-reads");
    mark = mock3.log.length;
    const again = await post("/api/tally/full", { ...C, fromDate: l3From, toDate: l3To });
    check("same sales", again.json.summary?.sales, E3.sales);
    check("no balance re-read for closed years", ledgerReqs(mark).length, 0);
    check("only the failed month is asked for again (3 tries)", voucherReqs(mark).length, 3);
    check("fromCache", again.json.fromCache, true);
    mark = mock3.log.length;
    const fresh = await post("/api/tally/full", { ...C, fromDate: l3From, toDate: l3To, includeVouchers: false, fresh: true });
    check("Refresh (fresh) re-reads every FY", [fresh.json.summary?.sales, ledgerReqs(mark).length], [E3.sales, 3]);

    group("Periods — current FY is always read live");
    const todayIsoC = F.isoDate(today);
    const Ecur = F.expectedC(today, `${fyY}-04-01`, todayIsoC);
    await post("/api/tally/full", { ...C, fromDate: `${fyY}-04-01`, toDate: todayIsoC, includeVouchers: false });
    mark = mock3.log.length;
    const cur2 = await post("/api/tally/full", { ...C, fromDate: `${fyY}-04-01`, toDate: todayIsoC, includeVouchers: false });
    check("sales this FY", cur2.json.summary?.sales, Ecur.sales);
    check("second call still reads Tally", [ledgerReqs(mark).length, cur2.json.fromCache], [1, false]);
    check("label", cur2.json.period?.label, `FY ${fyN(fyY)} till today`);

    group("Periods — custom range across 31 March (P&L = movement, balances as on To)");
    const cuFrom = `${fyY - 2}-11-15`;
    const cuTo = `${fyY - 1}-05-20`;
    const Ecu = F.expectedC(today, cuFrom, cuTo);
    const cu = await post("/api/tally/full", { ...C, fromDate: cuFrom, toDate: cuTo, includeVouchers: false });
    check("HTTP status", cu.status, 200);
    for (const k of ["sales", "purchases", "receivables", "payables", "cashInHand", "bankBalance"]) check(`summary.${k}`, cu.json.summary?.[k], Ecu[k]);
    check("opening receivables (as on From)", cu.json.opening?.receivables, Ecu.openingReceivables);
    check("opening cash", cu.json.opening?.cashInHand, Ecu.openingCash);
    check("readings: before-From + 2 FY ends", cu.json.readings, 3);
    check("label is the range", cu.json.period?.label, `${pretty(cuFrom)} to ${pretty(cuTo)}`);

    group("Periods — since books beginning / clamping / bad ranges");
    const Ebk = F.expectedC(today, booksC, todayIsoC);
    const bk = await post("/api/tally/full", { ...C, fromDate: "books", toDate: todayIsoC, includeVouchers: false });
    check("starts at books beginning", bk.json.period?.from, booksC);
    check("label", String(bk.json.period?.label || "").startsWith("Since books beginning"), true);
    check("sales since books beginning", bk.json.summary?.sales, Ebk.sales);
    check("readings: one per FY", bk.json.readings, 4);
    const early = await post("/api/tally/full", { ...C, fromDate: `${fyY - 5}-01-01`, toDate: `${fyY - 3}-06-30`, includeVouchers: false });
    check("From before books -> clamped", [early.status, early.json.period?.from], [200, booksC]);
    check("…with a note saying so", (early.json.period?.notes || []).some((n) => n.includes("books")), true);
    check("…figures from books beginning", early.json.summary?.sales, F.expectedC(today, booksC, `${fyY - 3}-06-30`).sales);
    const before = await post("/api/tally/full", { ...C, fromDate: `${fyY - 6}-01-01`, toDate: `${fyY - 5}-12-31` });
    check("whole range before books -> 400 bad-range", [before.status, before.json.code, before.json.summary], [400, "bad-range", undefined]);
    const rev = await post("/api/dashboard", { ...C, fromDate: `${fyY - 1}-06-01`, toDate: `${fyY - 1}-05-01` });
    check("From after To -> 400 bad-range (dashboard)", [rev.status, rev.json.code], [400, "bad-range"]);
    const revDead = await post("/api/tally/full", { host: "127.0.0.1", port: DEAD, fromDate: "2025-06-01", toDate: "2025-05-01" });
    check("bad range is reported even with Tally closed", revDead.status, 400);

    group("Periods — /api/dashboard and /api/tally/ledgers follow the period");
    const lfFrom = `${fyY - 1}-04-01`;
    const lfTo = `${fyY}-03-31`;
    const Elf = F.expectedC(today, lfFrom, lfTo);
    const dlf = await post("/api/dashboard", { ...C, fromDate: lfFrom, toDate: lfTo });
    check("dashboard Last FY sales", dlf.json.summary?.sales, Elf.sales);
    check("dashboard receivables as on 31-Mar", [dlf.json.summary?.receivables, dlf.json.period?.asOn], [Elf.receivables, pretty(lfTo)]);
    const llf = await post("/api/tally/ledgers", { ...C, companyName: F.COMPANY_C, fromDate: lfFrom, toDate: lfTo });
    const lby = Object.fromEntries((llf.json.ledgers || []).map((l) => [l.name, l]));
    check("Sales C = movement in the period (Cr positive)", [lby["Sales C"]?.closingBalance, lby["Sales C"]?.movement], [Elf.sales, true]);
    check("Customer C = balance as on To (Dr negative)", [lby["Customer C"]?.closingBalance, lby["Customer C"]?.movement], [-Elf.receivables, false]);
    check("Customer C opening = as on From", lby["Customer C"]?.openingBalance, -F.expectedC(today, lfFrom, lfTo).openingReceivables);

    group("Periods — /api/tally/fetch (transactions) month by month");
    const fLf = await post("/api/tally/fetch", { ...C, companyName: F.COMPANY_C, fromDate: lfFrom, toDate: lfTo });
    check("rows for Last FY", [fLf.status, fLf.json.count], [200, Elf.voucherCount]);
    check("12 monthly pieces", fLf.json.chunks?.total, 12);
    check("period label", fLf.json.period?.label, `FY ${fyN(fyY - 1)}`);
    const fBad = await post("/api/tally/fetch", { ...C, companyName: F.COMPANY_C, fromDate: `${fyY - 2}-08-01`, toDate: `${fyY - 2}-10-31` });
    const augOct =
      F.expectedC(today, `${fyY - 2}-08-01`, `${fyY - 2}-08-31`).voucherCount + F.expectedC(today, `${fyY - 2}-10-01`, `${fyY - 2}-10-31`).voucherCount;
    check("a failing month: the others are still returned", [fBad.status, fBad.json.count], [200, augOct]);
    check("…with a warning naming it", String(fBad.json.warning || "").includes(`Sep-${fyY - 2}`), true);

    group("Periods — progress stream (stream: true)");
    const sr = await fetch(base + "/api/tally/full", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "x-biome-server-pc": serverPc },
      body: JSON.stringify({ ...C, fromDate: booksC, toDate: todayIsoC, includeVouchers: false, fresh: true, stream: true }),
    });
    const lines = (await sr.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const last = lines[lines.length - 1] || {};
    check("content type", (sr.headers.get("content-type") || "").includes("ndjson"), true);
    check("progress lines before the result", lines.filter((l) => l.type === "progress").length >= 5, true);
    check("progress names the FY being read", lines.some((l) => l.type === "progress" && /balances 01-Apr-/.test(l.label || "")), true);
    check("result line", [last.type, last.status, last.body?.summary?.sales], ["result", 200, Ebk.sales]);
  } finally {
    await mock3.close();
    await mock1.close();
    await mock2.close();
    if (app) {
      app.kill();
      if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
