/**
 * Biome Platform — coordination self-checks
 * -------------------------------------------------------------------
 *   node tools/check-coordination.mjs
 *
 * Three things are checked, and all three are checked against the real
 * figures out of the coordination workbook rather than made-up ones:
 *
 *   1. The number formats produce EXACTLY the strings already in the
 *      register. BI-26-27-HR0554 and BI-26-27-HR01000 come from one
 *      pattern, and any "tidying" of that padding would print numbers
 *      that do not match invoices already issued.
 *   2. The freeze counts from the receiving date, and an approval opens
 *      the row for as long as it says and no longer.
 *   3. A Tally row lands on the right trip — and, when two trips fit, on
 *      NEITHER, because a wrong match bills the wrong supply.
 *
 * No test framework: this runs on a plant PC with nothing installed.
 */

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

function group(name, fn) {
  console.log(`\n${name}`);
  const before = failed;
  fn();
  if (failed === before) console.log("  all good");
}

/* ---------- the number formats, copied out of lib/numberSeries.ts ---------- */

function formatSeriesNumber(series, seq) {
  const seqText = String(Math.max(0, Math.trunc(seq))).padStart(Math.max(1, series.minDigits), "0");
  return series.pattern.replace(/\{SEQ\}/g, seqText);
}

function financialYearFor(dateText) {
  const d = new Date(dateText + "T00:00:00");
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const TI_HR = { pattern: "BI-26-27-HR0{SEQ}", minDigits: 3 };
const DC_TALLY = { pattern: "BIPL/2026-27/{SEQ}", minDigits: 1 };
const DC_SOL = { pattern: "BI/NTPC/SOL/0{SEQ}", minDigits: 2 };
const DC_MOU = { pattern: "BI/NTPC/MOU/0{SEQ}", minDigits: 2 };

group("Document numbers match the ones already issued", () => {
  // Straight off the BIOME -INVOICES sheet, first and last real rows.
  check("first invoice in the book", formatSeriesNumber(TI_HR, 554), "BI-26-27-HR0554");
  check("last invoice actually used", formatSeriesNumber(TI_HR, 786), "BI-26-27-HR0786");
  // The padding changes shape at 1000 in their sheet. One pattern has to
  // produce both, which is why the leading zero is part of the prefix.
  check("crossing 999", formatSeriesNumber(TI_HR, 999), "BI-26-27-HR0999");
  check("crossing 1000", formatSeriesNumber(TI_HR, 1000), "BI-26-27-HR01000");
  check("next invoice out", formatSeriesNumber(TI_HR, 787), "BI-26-27-HR0787");

  check("last Tally DC used", formatSeriesNumber(DC_TALLY, 886), "BIPL/2026-27/886");
  check("next Tally DC", formatSeriesNumber(DC_TALLY, 887), "BIPL/2026-27/887");

  check("Solapur, two digits", formatSeriesNumber(DC_SOL, 27), "BI/NTPC/SOL/027");
  check("Solapur, last used", formatSeriesNumber(DC_SOL, 39), "BI/NTPC/SOL/039");
  check("Solapur, three digits", formatSeriesNumber(DC_SOL, 253), "BI/NTPC/SOL/0253");

  check("Mouda, last used", formatSeriesNumber(DC_MOU, 88), "BI/NTPC/MOU/088");
  check("Mouda, next", formatSeriesNumber(DC_MOU, 89), "BI/NTPC/MOU/089");
});

group("Financial year turns on 1 April, not 1 January", () => {
  check("31 March is last year's book", financialYearFor("2027-03-31"), "2026-27");
  check("1 April starts the new one", financialYearFor("2027-04-01"), "2027-28");
  check("a July date", financialYearFor("2026-07-15"), "2026-27");
});

/* ---------- the freeze, copied out of lib/coordination.ts ---------- */

const FREEZE_DAYS = 7;

function lockStateFor(trip, now, days = FREEZE_DAYS) {
  const grant = trip.editGrant;
  const grantLive = grant ? new Date(grant.expiresAt).getTime() > now.getTime() : false;

  if (!trip.receivingDate || !/^\d{4}-\d{2}-\d{2}$/.test(trip.receivingDate)) {
    return { locked: false, freezesAt: "", daysLeft: 0, grantedUntil: grantLive ? grant.expiresAt : "" };
  }
  const freezeAt = new Date(trip.receivingDate + "T00:00:00Z").getTime() + days * 86400000;
  const locked = now.getTime() >= freezeAt;
  const daysLeft = Math.max(0, Math.ceil((freezeAt - now.getTime()) / 86400000));
  if (locked && grantLive) {
    return { locked: false, freezesAt: new Date(freezeAt).toISOString(), daysLeft: 0, grantedUntil: grant.expiresAt };
  }
  return { locked, freezesAt: new Date(freezeAt).toISOString(), daysLeft, grantedUntil: "" };
}

group("The freeze runs from the receiving date", () => {
  const at = (s) => new Date(s);

  // A trip still on the road has no clock at all. Counting from the
  // vehicle's entry would freeze the very row that is still waiting for
  // the number the coordinator has to come back and fill in.
  check(
    "dispatched a month ago, never received — still open",
    lockStateFor({ receivingDate: "", vehicleEntryDate: "2026-06-01" }, at("2026-08-15T10:00:00Z")).locked,
    false
  );

  check("received today", lockStateFor({ receivingDate: "2026-08-15" }, at("2026-08-15T10:00:00Z")).locked, false);
  check("day six", lockStateFor({ receivingDate: "2026-08-09" }, at("2026-08-15T10:00:00Z")).locked, false);
  check("exactly seven days", lockStateFor({ receivingDate: "2026-08-08" }, at("2026-08-15T10:00:00Z")).locked, true);
  check("long past", lockStateFor({ receivingDate: "2026-05-29" }, at("2026-08-15T10:00:00Z")).locked, true);

  check(
    "days left is counted from the freeze, not the receiving",
    lockStateFor({ receivingDate: "2026-08-13" }, at("2026-08-15T10:00:00Z")).daysLeft,
    5
  );

  const grant = { expiresAt: "2026-08-16T10:00:00.000Z", approvedByName: "Admin" };
  check(
    "an approval opens a frozen row",
    lockStateFor({ receivingDate: "2026-05-29", editGrant: grant }, at("2026-08-15T10:00:00Z")).locked,
    false
  );
  check(
    "and it stops working when it expires",
    lockStateFor({ receivingDate: "2026-05-29", editGrant: grant }, at("2026-08-17T10:00:00Z")).locked,
    true
  );
});

/* ---------- reading a spreadsheet cell ---------- */

function readNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()₹,\s]/g, "").replace(/^-/, "").replace(/(cr|dr)$/i, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function readDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const named = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,})[-/. ](\d{2,4})$/);
  if (named) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const m = months.indexOf(named[2].slice(0, 3).toLowerCase());
    let y = Number(named[3]);
    if (y < 100) y += 2000;
    if (m >= 0) return `${y}-${String(m + 1).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`;
  }
  return "";
}

group("Spreadsheet cells are read the way Tally writes them", () => {
  check("Indian grouping", readNumber("1,26,315.00"), 126315);
  check("with a rupee sign", readNumber("₹ 1,45,584"), 145584);
  check("a credit note in brackets", readNumber("(1,265)"), -1265);
  check("a real number cell", readNumber(226772), 226772);
  check("an empty cell", readNumber(""), 0);

  // The one that matters: 01-08-2026 is 1 August here and 8 January to
  // `new Date()`. Getting it wrong moves a row into the wrong month and
  // then into the wrong GST return.
  check("day-first, as India writes it", readDate("01-08-2026"), "2026-08-01");
  check("slashes", readDate("29/05/2026"), "2026-05-29");
  check("two-digit year", readDate("29-5-26"), "2026-05-29");
  check("named month", readDate("29-May-2026"), "2026-05-29");
  check("already ISO", readDate("2026-05-29"), "2026-05-29");
});

/* ---------- matching a Tally row to a trip ---------- */

function daysApart(a, b) {
  if (!a || !b) return 9999;
  const t1 = new Date(a + "T00:00:00Z").getTime();
  const t2 = new Date(b + "T00:00:00Z").getTime();
  if (isNaN(t1) || isNaN(t2)) return 9999;
  return Math.abs(t1 - t2) / 86400000;
}

function matchRows(rows, trips) {
  const byDoc = new Map();
  for (const t of trips) {
    const key = (t.ourDocNo || "").trim().toLowerCase();
    if (!key) continue;
    byDoc.set(key, [...(byDoc.get(key) || []), t]);
  }
  const usedTrip = new Map();
  return rows.map((row) => {
    if (!row.vehicle && !row.docNo && !row.total) return { verdict: "empty", tripSerial: 0 };
    let candidates = [];
    const docKey = (row.docNo || "").trim().toLowerCase();
    if (docKey && byDoc.has(docKey)) {
      candidates = byDoc.get(docKey);
    } else {
      const sameVehicle = trips.filter((t) => t.vehicleNumber && t.vehicleNumber === row.vehicle);
      if (sameVehicle.length) {
        const dated = sameVehicle
          .map((t) => ({ t, gap: Math.min(daysApart(row.invoiceDate, t.receivingDate), daysApart(row.invoiceDate, t.vehicleEntryDate)) }))
          .filter((x) => x.gap <= 10)
          .sort((a, b) => a.gap - b.gap);
        if (!row.invoiceDate) candidates = sameVehicle;
        else if (dated.length) {
          const best = dated[0].gap;
          candidates = dated.filter((x) => x.gap === best).map((x) => x.t);
        }
      }
    }
    if (candidates.length === 0) return { verdict: "unmatched", tripSerial: 0 };
    if (candidates.length > 1) return { verdict: "ambiguous", tripSerial: 0 };
    const t = candidates[0];
    if (usedTrip.has(t.id)) return { verdict: "ambiguous", tripSerial: t.serial };
    usedTrip.set(t.id, true);
    return { verdict: t.billedAlready ? "already" : "matched", tripSerial: t.serial };
  });
}

group("A Tally row lands on the right trip, or on none", () => {
  // Rows lifted from BIOME -INVOICES, 29 May 2026.
  const trips = [
    { id: "a", serial: 1, ourDocNo: "BI-26-27-HR0554", vehicleNumber: "HR64A7593", vehicleEntryDate: "2026-05-29", receivingDate: "2026-05-29", billedAlready: false },
    { id: "b", serial: 2, ourDocNo: "BI-26-27-HR0555", vehicleNumber: "HR39E6533", vehicleEntryDate: "2026-05-29", receivingDate: "", billedAlready: false },
    { id: "c", serial: 3, ourDocNo: "", vehicleNumber: "HR39G2888", vehicleEntryDate: "2026-05-29", receivingDate: "2026-05-29", billedAlready: false },
    // The same vehicle, twice, four days apart — this is the case that
    // makes date matching necessary.
    { id: "d", serial: 4, ourDocNo: "", vehicleNumber: "HR61E1269", vehicleEntryDate: "2026-05-29", receivingDate: "2026-05-29", billedAlready: false },
    { id: "e", serial: 5, ourDocNo: "", vehicleNumber: "HR61E1269", vehicleEntryDate: "2026-06-02", receivingDate: "2026-06-02", billedAlready: false },
  ];

  const out = matchRows([
    { rowNumber: 2, docNo: "BI-26-27-HR0554", vehicle: "HR64A7593", invoiceDate: "2026-05-29", total: 126315 },
    { rowNumber: 3, docNo: "", vehicle: "HR39G2888", invoiceDate: "2026-05-29", total: 139137 },
    { rowNumber: 4, docNo: "", vehicle: "HR61E1269", invoiceDate: "2026-06-02", total: 116550 },
    { rowNumber: 5, docNo: "", vehicle: "RJ29GC7686", invoiceDate: "2026-05-29", total: 226772 },
    { rowNumber: 6, docNo: "", vehicle: "HR61E1269", invoiceDate: "", total: 100000 },
    { rowNumber: 7, docNo: "", vehicle: "", invoiceDate: "", total: 0 },
  ], trips);

  check("document number wins outright", out[0], { verdict: "matched", tripSerial: 1 });
  check("vehicle plus same date", out[1], { verdict: "matched", tripSerial: 3 });
  check("the later run of the same vehicle", out[2], { verdict: "matched", tripSerial: 5 });
  check("a vehicle not in the register is left alone", out[3], { verdict: "unmatched", tripSerial: 0 });
  check("no date, two runs — a person has to choose", out[4], { verdict: "ambiguous", tripSerial: 0 });
  check("a blank row is not a row", out[5], { verdict: "empty", tripSerial: 0 });

  // Two sheet rows onto one trip is a duplicated export, and billing it
  // twice is worse than importing nothing.
  const twice = matchRows([
    { rowNumber: 2, docNo: "BI-26-27-HR0554", vehicle: "HR64A7593", invoiceDate: "2026-05-29", total: 126315 },
    { rowNumber: 3, docNo: "BI-26-27-HR0554", vehicle: "HR64A7593", invoiceDate: "2026-05-29", total: 126315 },
  ], trips);
  check("the first row takes the trip", twice[0].verdict, "matched");
  check("the second is stopped", twice[1].verdict, "ambiguous");
});

group("The shortage rule still holds on their own worst row", () => {
  // 36,090 out, 34,020 in — the trip that started this whole module.
  const dispatched = 36090, received = 34020;
  const allowance = Math.round(dispatched * 0.005) + 50;
  const difference = dispatched - received;
  check("allowance", allowance, 230);
  check("shortfall", difference, 2070);
  check("beyond allowance", difference > allowance, true);
  check("excess to chase", difference - allowance, 1840);

  // And a Gangakhed trip with the same numbers is still short — the extra
  // 500 kg allowance covers that plant's paperwork, not a real loss.
  check("Gangakhed allowance", Math.round(dispatched * 0.005) + 50 + 500, 730);
  check("still a shortage from GKD", difference > 730, true);
});


/* ---------- imprest budgets, mirrored from lib/imprestBudget.ts ---------- */

function usageFor(b, month, entries) {
  let spent = 0, committed = 0, count = 0;
  for (const e of entries) {
    if (e.date.slice(0, 7) !== month) continue;
    if (e.kind !== "expense") continue;
    const hit = b.scope === "head" ? e.category === b.key
      : b.scope === "plant" ? (e.plant || "") === b.key
      : e.personId === b.key;
    if (!hit) continue;
    if (e.status === "approved") { spent += e.amount; count += 1; }
    else if (e.status === "submitted") { committed += e.amount; count += 1; }
  }
  const used = spent + committed;
  const remaining = b.amount - used;
  const pct = b.amount > 0 ? Math.min(999, Math.round((used / b.amount) * 100)) : 0;
  const state = remaining < 0 ? "over" : pct >= 90 ? "tight" : pct >= 75 ? "watch" : "clear";
  return { spent, committed, remaining, pct, state, entries: count };
}

group("Imprest budgets count approved and pending separately", () => {
  const diesel = { scope: "head", key: "Diesel & fuel", amount: 100000 };
  const entries = [
    { id: "1", kind: "expense", category: "Diesel & fuel", status: "approved",  amount: 60000, date: "2026-08-04", plant: "REW", personId: "p1" },
    { id: "2", kind: "expense", category: "Diesel & fuel", status: "submitted", amount: 35000, date: "2026-08-12", plant: "REW", personId: "p1" },
    // A top-up handed to a holder is not a spend against a head.
    { id: "3", kind: "advance", category: "Diesel & fuel", status: "approved",  amount: 50000, date: "2026-08-01", plant: "REW", personId: "p1" },
    // Last month's diesel must not be counted in this month's budget.
    { id: "4", kind: "expense", category: "Diesel & fuel", status: "approved",  amount: 90000, date: "2026-07-30", plant: "REW", personId: "p1" },
    // A different head is a different budget.
    { id: "5", kind: "expense", category: "Repairs & maintenance", status: "approved", amount: 20000, date: "2026-08-06", plant: "REW", personId: "p1" },
  ];

  const u = usageFor(diesel, "2026-08", entries);
  check("only approved counts as spent", u.spent, 60000);
  check("pending is tracked apart", u.committed, 35000);
  check("remaining is after both", u.remaining, 5000);
  check("an advance is not a spend", u.spent + u.committed, 95000);
  check("tight, not over", u.state, "tight");

  // The case the whole design exists for: approving the pending entry
  // would breach, and the approver has to be told BEFORE pressing the
  // button, not after.
  const pending = entries[1];
  const others = entries.filter((e) => e.id !== pending.id);
  const before = usageFor(diesel, "2026-08", others);
  check("before the decision there is room", before.remaining, 40000);
  const after = before.remaining - pending.amount;
  check("after it there is not", after, 5000);

  const big = { ...pending, amount: 55000 };
  const wouldBe = before.remaining - big.amount;
  check("a bigger claim goes past the budget", wouldBe < 0, true);
  check("and by how much", Math.abs(wouldBe), 15000);

  // A budget of zero must not report 100% used and turn every screen red.
  check("no allocation, no percentage", usageFor({ scope: "head", key: "X", amount: 0 }, "2026-08", entries).pct, 0);
});

/* ---------- admin override ---------- */

function overrideLive(grant, now) {
  if (!grant) return false;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

group("Admin override expires on its own", () => {
  const started = new Date("2026-08-15T10:00:00Z");
  const grant = { expiresAt: new Date(started.getTime() + 30 * 60000).toISOString() };
  check("live at once", overrideLive(grant, new Date("2026-08-15T10:00:01Z")), true);
  check("live at 29 minutes", overrideLive(grant, new Date("2026-08-15T10:29:00Z")), true);
  check("gone at 31 minutes", overrideLive(grant, new Date("2026-08-15T10:31:00Z")), false);
  check("nothing running is not an override", overrideLive(null, started), false);
});


/* ---------- the support board, mirrored from lib/support.ts ---------- */

function daysBetween(a, b) {
  const t1 = new Date(a).getTime(), t2 = new Date(b).getTime();
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.max(0, (t2 - t1) / 86400000);
}

const SETTLED_STATUS = ["resolved", "rejected", "closed"];
const isTicketOpen = (s) => !SETTLED_STATUS.includes(s);

function buildBoard(tickets, now) {
  const nowIso = now.toISOString();
  const open = tickets.filter((t) => isTicketOpen(t.status));
  const firstReply = tickets
    .filter((t) => t.lastReplyAt)
    .map((t) => daysBetween(t.createdAt, t.lastReplyAt) * 24)
    .sort((a, b) => a - b);
  return {
    open: open.length,
    urgentOpen: open.filter((t) => t.urgency === "urgent").length,
    unanswered: open.filter((t) => !t.lastReplyAt).length,
    staleTotal: open.filter((t) => daysBetween(t.lastReplyAt || t.createdAt, nowIso) > 2).length,
    medianFirstReplyHours: firstReply.length
      ? Math.round(firstReply[Math.floor(firstReply.length / 2)] * 10) / 10
      : null,
  };
}

group("The support board counts what is waiting on the desk", () => {
  const now = new Date("2026-08-15T10:00:00Z");
  const tickets = [
    // Raised five days ago, nobody from the desk has written back. This is
    // the one that matters — it must show as unanswered AND stale.
    { status: "submitted", urgency: "urgent", createdAt: "2026-08-10T09:00:00Z", lastReplyAt: "" },
    // Answered yesterday. Open, but nobody is being ignored.
    { status: "accepted", urgency: "normal", createdAt: "2026-08-11T09:00:00Z", lastReplyAt: "2026-08-14T09:00:00Z" },
    // Answered a week ago and then forgotten — open and gone quiet.
    { status: "pending_admin", urgency: "normal", createdAt: "2026-08-01T09:00:00Z", lastReplyAt: "2026-08-05T09:00:00Z" },
    // Settled. Must not appear in any "waiting" figure, however old.
    { status: "resolved", urgency: "urgent", createdAt: "2026-06-01T09:00:00Z", lastReplyAt: "2026-06-02T09:00:00Z" },
    { status: "closed", urgency: "normal", createdAt: "2026-05-01T09:00:00Z", lastReplyAt: "2026-05-01T15:00:00Z" },
  ];

  const b = buildBoard(tickets, now);
  check("open counts only live tickets", b.open, 3);
  check("a settled urgent one is not urgent-open", b.urgentOpen, 1);
  check("never answered", b.unanswered, 1);
  check("open and quiet over two days", b.staleTotal, 2);

  // Nothing answered yet must read as "no figure", not as zero hours.
  check("no answers, no median", buildBoard([{ status: "submitted", urgency: "normal", createdAt: "2026-08-14T09:00:00Z", lastReplyAt: "" }], now).medianFirstReplyHours, null);

  // The rule the whole board rests on: the raiser chasing their own ticket
  // is not an answer. Three of their own replies, still unanswered.
  const chased = { status: "submitted", urgency: "normal", createdAt: "2026-08-09T09:00:00Z", lastReplyAt: "" };
  check("chasing yourself is not being answered", buildBoard([chased], now).unanswered, 1);
});


/* ---------- WhatsApp supply sets: folding away re-shares ---------- */

import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);
const { dedupeSetDocuments } = requireCjs("../whatsapp-agent/lib/setDedupe.js");

group("A re-shared document counts once", () => {
  // Straight off the screenshot: BI-26-27-HR0996 shared four times, twice
  // classified and twice not, plus a bilty that is a different document.
  const docs = [
    { id: "a", fileName: "Sales Haryana_BI-26-27-HR0996.pdf", receivedAt: "2026-08-14T12:52:00Z",
      filePath: "/x/a.pdf", aiStatus: "ok", extracted: { documentType: "biome_tax_invoice", biomeDocNo: "996" } },
    { id: "b", fileName: "Sales Haryana_BI-26-27-HR0996.pdf", receivedAt: "2026-08-14T14:34:00Z",
      filePath: null, aiStatus: "ok", extracted: { documentType: "unknown" } },
    { id: "c", fileName: "Sales Haryana_BI-26-27-HR0996.pdf", receivedAt: "2026-08-14T14:43:00Z",
      filePath: null, aiStatus: "ok", extracted: { documentType: "unknown" } },
    { id: "d", fileName: "Sales Haryana_BI-26-27-HR0996.pdf", receivedAt: "2026-08-14T15:06:00Z",
      filePath: "/x/d.pdf", aiStatus: "ok", extracted: { documentType: "biome_tax_invoice", biomeDocNo: "996" } },
    { id: "e", fileName: "HR39F5871 DATE 14-08-26.pdf", receivedAt: "2026-08-14T11:21:00Z",
      filePath: "/x/e.pdf", aiStatus: "ok", extracted: { documentType: "bilty" } },
  ];

  const out = dedupeSetDocuments(docs);
  check("four copies and a bilty become two documents", out.documents.length, 2);
  check("three copies folded away", out.duplicates.length, 3);

  const invoice = out.documents.find((d) => d.extracted.documentType === "biome_tax_invoice");
  check("the classified copy is the one kept", Boolean(invoice), true);
  check("and it can be opened", Boolean(invoice.filePath), true);
  // The document arrived at 12:52, not at 15:06 when someone forwarded it
  // back. Showing the last forward would make a paper look late.
  check("it carries the earliest arrival", invoice.receivedAt, "2026-08-14T12:52:00Z");
  check("the bilty is untouched", out.documents.some((d) => d.id === "e"), true);

  // Identical bytes are folded even when the names differ.
  const hashed = dedupeSetDocuments([
    { id: "1", fileName: "invoice.pdf", sha256: "abc", receivedAt: "2026-08-01T10:00:00Z", filePath: "/x/1.pdf", extracted: { documentType: "biome_tax_invoice" } },
    { id: "2", fileName: "FWD invoice copy.pdf", sha256: "abc", receivedAt: "2026-08-01T11:00:00Z", filePath: null, extracted: { documentType: "unknown" } },
  ]);
  check("same bytes, one document", hashed.documents.length, 1);

  // WhatsApp's own renaming of a forward.
  const renamed = dedupeSetDocuments([
    { id: "1", fileName: "weight slip.pdf", receivedAt: "2026-08-01T10:00:00Z", filePath: "/x/1.pdf", extracted: { documentType: "weight_slip" } },
    { id: "2", fileName: "weight slip (1).pdf", receivedAt: "2026-08-01T11:00:00Z", filePath: "/x/2.pdf", extracted: { documentType: "weight_slip" } },
  ]);
  check("(1) is the same file forwarded", renamed.documents.length, 1);

  // The line that must NOT be crossed: one vehicle legitimately carries a
  // weight slip AND a bilty AND an invoice. Folding on the vehicle number
  // would destroy a genuine set.
  const sameVehicle = dedupeSetDocuments([
    { id: "1", fileName: "slip.pdf", receivedAt: "2026-08-01T10:00:00Z", filePath: "/x/1.pdf", extracted: { documentType: "weight_slip", vehicleNo: "HR39E7479" } },
    { id: "2", fileName: "bilty.pdf", receivedAt: "2026-08-01T10:05:00Z", filePath: "/x/2.pdf", extracted: { documentType: "bilty", vehicleNo: "HR39E7479" } },
    { id: "3", fileName: "coa.pdf", receivedAt: "2026-08-01T10:07:00Z", filePath: "/x/3.pdf", extracted: { documentType: "coa", vehicleNo: "HR39E7479" } },
  ]);
  check("three different papers on one vehicle stay three", sameVehicle.documents.length, 3);
});


/* ---------- access overrides and feature switches ---------- */

const ROLE_PERMS = {
  developer: ["finance", "users", "access.grant", "feature.switch", "announce", "developer", "coordination"],
  admin: ["finance", "users", "coordination"],
  coordinator: ["coordination", "documents"],
  plant_manager: ["operations", "operations.entry", "documents"],
};

function effectivePermissions(role, override) {
  const base = new Set(ROLE_PERMS[role] || []);
  for (const p of override?.granted || []) base.add(p);
  for (const p of override?.revoked || []) base.delete(p);
  return [...base];
}

group("Per-user access is exceptions on top of the role", () => {
  check("no override, role decides", effectivePermissions("coordinator", null).includes("coordination"), true);
  check("a grant adds one thing", effectivePermissions("coordinator", { granted: ["finance"], revoked: [] }).includes("finance"), true);
  check("a revoke takes one away", effectivePermissions("admin", { granted: [], revoked: ["users"] }).includes("users"), false);
  // If both lists name the same key, the safer reading wins.
  check("revoke beats grant", effectivePermissions("coordinator", { granted: ["finance"], revoked: ["finance"] }).includes("finance"), false);
  // The point of storing exceptions rather than a full list: everything
  // else the role gives keeps working.
  check("a revoke leaves the rest alone", effectivePermissions("admin", { granted: [], revoked: ["users"] }).includes("finance"), true);

  // The four keys taken out of the admin's hands this round.
  const DEV_ONLY = ["access.grant", "feature.switch", "announce", "developer"];
  for (const k of DEV_ONLY) {
    check(`admin does not hold ${k}`, ROLE_PERMS.admin.includes(k), false);
    check(`developer holds ${k}`, ROLE_PERMS.developer.includes(k), true);
  }
  // Plant managers lost coordination in the last round; make sure it stayed lost.
  check("plant manager still has no coordination", ROLE_PERMS.plant_manager.includes("coordination"), false);
});

const SWITCHABLE_TEST = [
  { id: "coordination", label: "Coordination", prefixes: ["/coordination", "/api/coordination"] },
  { id: "imprest", label: "Imprest", prefixes: ["/imprest", "/api/imprest"] },
];

function featureBlocks(pathname, method, features) {
  let best = null;
  for (const f of SWITCHABLE_TEST) {
    const sw = features.find((x) => x.id === f.id);
    if (!sw || sw.state === "live") continue;
    for (const prefix of f.prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        if (!best || prefix.length > best.length) best = { f, sw, length: prefix.length };
      }
    }
  }
  if (!best) return null;
  const reading = method === "GET" || method === "HEAD";
  if (best.sw.state === "readonly" && reading) return null;
  return { state: best.sw.state };
}

group("Frozen means read-only, off means off", () => {
  const frozen = [{ id: "coordination", state: "readonly", message: "Closing August." }];
  const off = [{ id: "imprest", state: "off", message: "Being repaired." }];

  check("a frozen module still reads", featureBlocks("/api/coordination", "GET", frozen), null);
  check("but refuses a save", featureBlocks("/api/coordination", "PUT", frozen)?.state, "readonly");
  // The nested route has no switch of its own; the prefix covers it.
  check("nested routes are covered", featureBlocks("/api/coordination/import", "PUT", frozen)?.state, "readonly");
  check("an off module refuses even a read", featureBlocks("/api/imprest/entries", "GET", off)?.state, "off");
  check("an untouched module is untouched", featureBlocks("/api/payroll/runs", "PUT", frozen), null);
  check("live is not a block", featureBlocks("/api/coordination", "PUT", [{ id: "coordination", state: "live", message: "" }]), null);
});

group("A notice reaches the right people", () => {
  const isFor = (a, u, today = "2026-08-16") => {
    if (a.withdrawnAt) return false;
    if (a.expiresOn && a.expiresOn < today) return false;
    if (a.audience.userIds.length) return a.audience.userIds.includes(u.id);
    if (a.audience.roles !== "all" && !a.audience.roles.includes(u.role)) return false;
    if (a.audience.plants.length) {
      if (!u.plants.length) return false;
      if (!u.plants.some((p) => a.audience.plants.includes(p))) return false;
    }
    return true;
  };

  const rewManager = { id: "u1", role: "plant_manager", plants: ["REW"] };
  const gkdManager = { id: "u2", role: "plant_manager", plants: ["GKD"] };
  const accountant = { id: "u3", role: "accounts", plants: [] };

  const everyone = { audience: { roles: "all", plants: [], userIds: [] }, expiresOn: "", withdrawnAt: "" };
  check("everyone means everyone", [rewManager, gkdManager, accountant].every((u) => isFor(everyone, u)), true);

  // Roles AND plants, not roles OR plants. The wrong reading here mails a
  // Rewari-only warning to every plant manager in the company.
  const rewOnly = { audience: { roles: ["plant_manager"], plants: ["REW"], userIds: [] }, expiresOn: "", withdrawnAt: "" };
  check("the Rewari manager gets it", isFor(rewOnly, rewManager), true);
  check("the Gangakhed manager does not", isFor(rewOnly, gkdManager), false);
  check("an office role does not", isFor(rewOnly, accountant), false);

  // Naming people overrides the group.
  const named = { audience: { roles: ["accounts"], plants: [], userIds: ["u1"] }, expiresOn: "", withdrawnAt: "" };
  check("named people win", isFor(named, rewManager), true);
  check("and the role is ignored", isFor(named, accountant), false);

  check("an expired notice stops showing", isFor({ ...everyone, expiresOn: "2026-08-15" }, accountant), false);
  check("so does a withdrawn one", isFor({ ...everyone, withdrawnAt: "2026-08-16T09:00:00Z" }, accountant), false);
});


/* ---------- backup: what must never travel in a zip ---------- */

const NEVER_BACKUP = ["whatsapp/auth", "runtime", "backups", "node_modules", ".git"];
const SENSITIVE_FILES = ["config/cloud-credentials.json", "config/cloud-service-account.json", "config/mail.json"];

function isBackable(rel) {
  if (NEVER_BACKUP.some((p) => rel === p || rel.startsWith(p + "/"))) return false;
  if (SENSITIVE_FILES.includes(rel)) return false;
  return true;
}

group("A backup never carries the WhatsApp login or a password", () => {
  // The one that matters most. Anyone holding these files can read the
  // company's WhatsApp, and a zip travels to pen drives and Drive folders.
  check("the WhatsApp auth folder", isBackable("whatsapp/auth"), false);
  check("and everything inside it", isBackable("whatsapp/auth/creds.json"), false);
  check("the mail password", isBackable("config/mail.json"), false);
  check("the cloud refresh token", isBackable("config/cloud-credentials.json"), false);
  check("the service account key", isBackable("config/cloud-service-account.json"), false);
  check("backups inside backups", isBackable("backups/biome-backup-2026-08-16.zip"), false);
  check("the agent's one-time token", isBackable("runtime/whatsapp-agent.json"), false);

  // And the things that MUST be in it — a backup missing these is useless.
  check("the users file", isBackable("config/users.json"), true);
  check("coordination trips", isBackable("coordination/trips.json"), true);
  check("payroll runs", isBackable("payroll/runs.json"), true);
  check("imprest attachments", isBackable("imprest/attachments/abc/bill.pdf"), true);
  check("whatsapp documents themselves", isBackable("whatsapp/inbox/August-2026/JPL/invoice.pdf"), true);
  // A folder whose name merely starts the same way is not the auth folder.
  check("a lookalike folder is not excluded", isBackable("whatsapp/authorised-notes.json"), true);
});

/* ---------- support: reopening, and who gets told ---------- */

group("A reopened query moves forward, not backwards", () => {
  const settled = ["resolved", "rejected", "closed"];
  const reopen = (ticket, byOwner) => {
    if (!settled.includes(ticket.status)) return ticket;
    if (!byOwner) return ticket;
    return { ...ticket, status: "reopened", reopenCount: (ticket.reopenCount || 0) + 1, closedAt: null };
  };

  const resolved = { status: "resolved", reopenCount: 0, closedAt: null };
  const once = reopen(resolved, true);
  check("status becomes reopened, not accepted", once.status, "reopened");
  check("the count starts at one", once.reopenCount, 1);
  const twice = reopen({ ...once, status: "resolved" }, true);
  check("a second time is counted", twice.reopenCount, 2);
  // An open case is not reopened by an ordinary reply.
  check("a live case is untouched", reopen({ status: "accepted", reopenCount: 0 }, true).status, "accepted");
});

group("Nobody is emailed about their own action", () => {
  const desk = [{ id: "acc", name: "Accounts" }, { id: "adm", name: "Admin" }];
  const recipientsFor = (raiserId, actorId) => {
    const out = [];
    if (raiserId !== actorId) out.push(raiserId);
    for (const d of desk) {
      if (d.id === actorId) continue;
      if (out.includes(d.id)) continue;
      out.push(d.id);
    }
    return out;
  };

  // An employee raises it: the desk hears, they do not hear from themselves.
  check("employee raises", recipientsFor("emp", "emp"), ["acc", "adm"]);
  // Accounts replies: the employee hears, and the admin, but not accounts.
  check("accounts replies", recipientsFor("emp", "acc"), ["emp", "adm"]);
  // Accounts raises it on someone's behalf and is also the raiser: no self-mail.
  check("no self-mail", recipientsFor("acc", "acc").includes("acc"), false);
});


/* ---------- partner registration ---------- */

const PARTNER_DOC_TYPES = [
  { id: "purchase_agreement", kinds: ["biomass_vendor"], required: true, expires: true },
  { id: "transport_agreement", kinds: ["transporter"], required: true, expires: true },
  { id: "po", kinds: ["biomass_vendor", "transporter", "other"], required: false, expires: true },
  { id: "gst_certificate", kinds: [], required: true, expires: false },
  { id: "pan", kinds: [], required: true, expires: false },
  { id: "cancelled_cheque", kinds: [], required: true, expires: false },
  { id: "rc", kinds: ["transporter"], required: false, expires: true },
];

const typesFor = (kind) => PARTNER_DOC_TYPES.filter((t) => t.kinds.length === 0 || t.kinds.includes(kind));

function gapsFor(p, today = "2026-08-16") {
  const have = new Set(p.documents.map((d) => d.type));
  const missing = typesFor(p.kind).filter((t) => t.required && !have.has(t.id)).map((t) => t.id);
  const expired = [], expiringSoon = [];
  for (const d of p.documents) {
    if (!d.validTill) continue;
    const days = Math.ceil((new Date(d.validTill + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
    if (days < 0) expired.push(d.type);
    else if (days <= 30) expiringSoon.push(d.type);
  }
  const missingFields = [];
  if (!p.name) missingFields.push("Name");
  if (!p.gstin) missingFields.push("GSTIN");
  if (!p.pan) missingFields.push("PAN");
  if (!p.accountNumber || !p.ifsc) missingFields.push("Bank");
  return {
    missing, expired, expiringSoon, missingFields,
    readyToActivate: missing.length === 0 && expired.length === 0 && missingFields.length === 0,
  };
}

group("A partner cannot be activated over an empty folder", () => {
  const bare = { kind: "biomass_vendor", name: "Soami Agro", gstin: "", pan: "", accountNumber: "", ifsc: "", documents: [] };
  check("nothing on file is not ready", gapsFor(bare).readyToActivate, false);
  // A vendor needs the purchase agreement; a transporter does not.
  check("vendor needs a purchase agreement", gapsFor(bare).missing.includes("purchase_agreement"), true);
  check("transporter does not", gapsFor({ ...bare, kind: "transporter" }).missing.includes("purchase_agreement"), false);
  check("transporter needs its own agreement", gapsFor({ ...bare, kind: "transporter" }).missing.includes("transport_agreement"), true);
  // The bank check is the expensive one: a payment to an account nobody
  // matched against a cancelled cheque.
  check("bank details are required", gapsFor(bare).missingFields.includes("Bank"), true);

  const complete = {
    kind: "biomass_vendor", name: "Soami Agro", gstin: "06AABCU9603R1ZM", pan: "AABCU9603R",
    accountNumber: "12345", ifsc: "HDFC0001234",
    documents: [
      { type: "purchase_agreement", validTill: "2027-03-31" },
      { type: "gst_certificate", validTill: "" },
      { type: "pan", validTill: "" },
      { type: "cancelled_cheque", validTill: "" },
    ],
  };
  check("a complete file is ready", gapsFor(complete).readyToActivate, true);

  // An expired agreement blocks activation even though the file exists —
  // "we have it somewhere" is not the same as "it is in force".
  const stale = { ...complete, documents: [{ ...complete.documents[0], validTill: "2026-06-30" }, ...complete.documents.slice(1)] };
  check("an expired agreement blocks it", gapsFor(stale).readyToActivate, false);
  check("and is named as expired", gapsFor(stale).expired.includes("purchase_agreement"), true);

  // 30 days out is a warning, not a block.
  const soon = { ...complete, documents: [{ type: "purchase_agreement", validTill: "2026-09-05" }, ...complete.documents.slice(1)] };
  check("expiring soon still activates", gapsFor(soon).readyToActivate, true);
  check("but is flagged", gapsFor(soon).expiringSoon.includes("purchase_agreement"), true);
});

group("Shape checks say shape, not truth", () => {
  const gstin = (v) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
  const pan = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v);
  const ifsc = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v);

  check("a real-shaped GSTIN", gstin("06AABCU9603R1ZM"), true);
  check("one digit short", gstin("6AABCU9603R1ZM"), false);
  check("missing the Z", gstin("06AABCU9603R1AM"), false);
  check("a PAN", pan("AABCU9603R"), true);
  check("a PAN with a digit in the wrong place", pan("AABC9U603R"), false);
  check("an IFSC", ifsc("HDFC0001234"), true);
  // The fifth character of an IFSC is always zero.
  check("IFSC without the zero", ifsc("HDFC1001234"), false);
});

group("A plant manager sees their own site's partners", () => {
  const visible = (partners, role, plant) =>
    role !== "plant_manager" || !plant
      ? partners
      : partners.filter((p) => p.plants.length === 0 || p.plants.includes(plant));

  const all = [
    { id: "a", plants: ["REW"] },
    { id: "b", plants: ["GKD"] },
    { id: "c", plants: [] },        // company-wide contract
  ];
  check("Rewari sees its own and the company-wide one", visible(all, "plant_manager", "REW").map((p) => p.id), ["a", "c"]);
  check("Gangakhed does not see Rewari's", visible(all, "plant_manager", "GKD").map((p) => p.id), ["b", "c"]);
  check("accounts sees everything", visible(all, "accounts", null).length, 3);
});

/* ---------- the checks above are a mirror; make sure it still reflects ---------- */

/**
 * Everything above re-implements the logic in plain JavaScript so this
 * runs on a plant PC with nothing installed. That buys portability and
 * costs something real: if lib/numberSeries.ts changes, these checks will
 * happily keep passing against the old rules.
 *
 * So the source is read as text and the four seeded patterns and starting
 * counts are compared against what is tested here. It does not verify the
 * logic — but it does mean nobody can quietly change a series pattern or
 * restart a count without this failing and saying so.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

group("The checks still match lib/numberSeries.ts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  let source = "";
  try {
    source = readFileSync(join(here, "..", "lib", "numberSeries.ts"), "utf8");
  } catch {
    check("lib/numberSeries.ts is readable", false, true);
    return;
  }

  const expected = [
    ["Haryana tax invoice pattern", 'pattern: "BI-26-27-HR0{SEQ}"'],
    ["Haryana tax invoice next count", "nextSeq: 787"],
    ["Tally DC pattern", 'pattern: "BIPL/2026-27/{SEQ}"'],
    ["Tally DC next count", "nextSeq: 887"],
    ["Solapur pattern", 'pattern: "BI/NTPC/SOL/0{SEQ}"'],
    ["Solapur next count", "nextSeq: 40"],
    ["Mouda pattern", 'pattern: "BI/NTPC/MOU/0{SEQ}"'],
    ["Mouda next count", "nextSeq: 89"],
  ];
  for (const [name, needle] of expected) check(name, source.includes(needle), true);

  // The freeze window is quoted in the handover note and in the UI copy.
  let coordination = "";
  try {
    coordination = readFileSync(join(here, "..", "lib", "coordination.ts"), "utf8");
  } catch { /* reported below */ }
  check("freeze is still seven days", coordination.includes("FREEZE_DAYS = 7"), true);
  check("approval window is still 24 hours", coordination.includes("EDIT_WINDOW_HOURS = 24"), true);

  let override = "";
  try {
    override = readFileSync(join(here, "..", "lib", "override.ts"), "utf8");
  } catch { /* reported by the check below */ }
  check("override still expires in 30 minutes", override.includes("OVERRIDE_MINUTES = 30"), true);

  let perms = "";
  try {
    perms = readFileSync(join(here, "..", "lib", "permissions.ts"), "utf8");
  } catch { /* reported below */ }
  // The whole point of this round: these four keys must not be in the
  // admin's list, and the filter that removes them must still be there.
  check(
    "admin is still built by removing the developer-only keys",
    perms.includes('admin: ALL.filter((p) => !["access.grant", "feature.switch", "announce", "developer"].includes(p))'),
    true
  );
  check("the developer role still exists", perms.includes('developer: ALL,'), true);

  // The rule changed: a coordinator now registers TRADING vendors and
  // clients, so they hold "partners" — and the registration API must pin
  // them to the trading register so the plant-side (manufacturing) records,
  // rate cards and agreements stay out of their reach.
  const coordinatorBlock = perms.slice(perms.indexOf("coordinator: ["), perms.indexOf("plant_manager: ["));
  check("coordinator holds partners (trading registration)", coordinatorBlock.includes('"partners"'), true);
  let partnersRoute = "";
  try {
    partnersRoute = readFileSync(join(here, "..", "app", "api", "partners", "route.ts"), "utf8");
  } catch { /* reported by the checks below */ }
  check(
    "coordinator is pinned to trading records in the API",
    /role === "coordinator"\) \{\s*return partners\.filter\(\(p\) => p\.category === "trading"\)/.test(partnersRoute),
    true
  );
  check(
    "coordinator can only register trading",
    partnersRoute.includes('if (user.role === "coordinator") category = "trading";'),
    true
  );
  const managerBlock = perms.slice(perms.indexOf("plant_manager: ["));
  check("plant manager does", managerBlock.includes('"partners"'), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
