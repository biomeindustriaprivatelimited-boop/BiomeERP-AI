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
      env: { ...process.env, BIOME_DATA_ROOT: dataRoot, BIOME_AUTH_SECRET: authSecret },
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
  } finally {
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
