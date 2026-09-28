import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import { requirePermission } from "@/lib/authServer";
import { loadTrips, shortageFor, derivedStatus, summarise, byParty, lockStateFor } from "@/lib/coordination";

/** "Tax Invoice" reads better in a workbook than "tax_invoice". */
function docLabel(v: string): string {
  if (v === "tax_invoice") return "Tax Invoice";
  if (v === "delivery_challan") return "Delivery Challan";
  return "";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire = createRequire(import.meta.url);

/**
 * The register as an Excel workbook.
 *
 * Better than the spreadsheet it replaces in one specific way: the four
 * location tabs become ONE register with a Location column, plus derived
 * sheets the original could not produce — shortage per supplier, shortage
 * per client, and a sheet of just the trips that need chasing.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json({ error: "Run `npm install` in the project folder, then try again." }, { status: 500 });
  }

  const p = req.nextUrl.searchParams;
  const month = p.get("month");
  // The export follows the register you were looking at. A workbook that
  // silently mixed trading and manufacturing would undo the split the
  // whole module was reorganised for.
  const business = p.get("business") === "manufacturing" ? "manufacturing" : "trading";
  let trips = loadTrips().filter((t) => t.business === business);
  if (month) trips = trips.filter((t) => (t.vehicleEntryDate || "").slice(0, 7) === month);

  const INK = "FF0B1F27", LEAF = "FF1F7A4C", RED = "FFB3261E", SOFT = "FFEFF4F2", BAND = "FFF8FAF9";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria";
  wb.created = new Date();

  const label = month
    ? new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "All months";

  /* ---- the register ---- */
  const ws = wb.addWorksheet("Coordination", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const COLS = [
    ["S.No", 7], ["Client", 26], ["Location", 16], ["PO No", 14],
    ["Supplier", 26], ["Vehicle No", 14], ["Entry Date", 12],
    ["Vendor Doc Type", 14], ["Vendor Challan No", 18], ["Challan Date", 12], ["Vendor Invoice No", 18],
    ["Dispatch Wt (KG)", 15],
    ["Our Doc Type", 14], ["Our Doc No", 20], ["Our Doc Date", 12], ["Challan Amount", 15],
    ["Receiving Date", 13], ["Receiving Qty (KG)", 16], ["CC Weight", 12],
    ["Difference (KG)", 15], ["Difference %", 12], ["Allowance (KG)", 14],
    ["Beyond Allowance", 16],
    ["Invoice Wt (KG)", 15], ["Taxable", 14], ["Tax", 12], ["Invoice Total", 15],
    ["Status", 13], ["Frozen", 10], ["Reason / Remarks", 34],
  ] as const;

  ws.mergeCells(1, 1, 1, COLS.length);
  const title = ws.getCell(1, 1);
  title.value = "BIOME INDUSTRIA PRIVATE LIMITED";
  title.font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.alignment = { horizontal: "center" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, COLS.length);
  const sub = ws.getCell(2, 1);
  sub.value = `${business === "manufacturing" ? "Manufacturing" : "Trading"} coordination register — ${label}`;
  sub.font = { size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  sub.alignment = { horizontal: "center" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEAF } };

  const s = summarise(trips);
  ws.mergeCells(3, 1, 3, COLS.length);
  const meta = ws.getCell(3, 1);
  meta.value =
    `${s.trips} trips · dispatched ${s.dispatchedKg.toLocaleString("en-IN")} kg · received ${s.receivedKg.toLocaleString("en-IN")} kg · ` +
    `shortfall ${s.shortfallKg.toLocaleString("en-IN")} kg across ${s.shortageTrips} trip(s) · ${s.pendingReceiving} awaiting receiving`;
  meta.font = { size: 9.5, italic: true, color: { argb: "FF5A6B66" } };
  meta.alignment = { horizontal: "center" };

  const head = ws.getRow(4);
  COLS.forEach(([name], i) => {
    const c = head.getCell(i + 1);
    c.value = name;
    c.font = { size: 9.5, bold: true, color: { argb: INK } };
    c.alignment = { horizontal: i < 2 ? "left" : "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    c.border = { bottom: { style: "medium", color: { argb: INK } } };
  });
  head.height = 30;
  COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });

  trips
    .sort((a, b) => (a.vehicleEntryDate || "").localeCompare(b.vehicleEntryDate || ""))
    .forEach((t, i) => {
      const sh = shortageFor(t);
      const lock = lockStateFor(t);
      const row = ws.addRow([
        t.serial, t.client, t.location, t.poNumber,
        t.supplier || (business === "manufacturing" ? "BIOME (own material)" : ""),
        t.vehicleNumber, t.vehicleEntryDate,
        docLabel(t.vendorDocType), t.vendorChallanNo, t.vendorChallanDate, t.vendorInvoiceNo,
        t.vendorChallanWeight || null,
        docLabel(t.docType), t.ourDocNo, t.ourDocDate, t.vendorChallanAmount || null,
        t.receivingDate, t.receivingQty || null, t.ccWeight || null,
        sh.verdict === "pending" ? null : sh.differenceKg,
        sh.verdict === "pending" ? null : sh.differencePct / 100,
        sh.verdict === "pending" ? null : sh.allowanceKg,
        sh.excessKg || null,
        t.billing?.invoiceWeightKg || null,
        t.billing?.taxableAmount || null,
        t.billing?.taxAmount || null,
        t.billing?.totalAmount || null,
        derivedStatus(t),
        lock.locked ? "Frozen" : "",
        [t.cancellationReason, t.remarks, t.checklistRemarks].filter(Boolean).join(" · "),
      ]);

      row.eachCell((c: any, col: number) => {
        c.font = { size: 10 };
        if ([12, 16, 18, 19, 20, 22, 23, 24, 25, 26, 27].includes(col)) c.numFmt = '#,##0;[Red]-#,##0';
        if (col === 21) c.numFmt = '0.00%';
        if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
      });

      // The whole point of the export: a shortage row is impossible to miss.
      if (sh.verdict === "shortage") {
        [20, 21, 23, 28].forEach((col) => {
          row.getCell(col).font = { size: 10, bold: true, color: { argb: RED } };
        });
      }
    });

  if (trips.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + trips.length, column: COLS.length } };
  }

  /* ---- shortage by supplier, then by client ---- */
  for (const [sheetName, key] of [["Shortage by supplier", "supplier"], ["Shortage by client", "client"]] as const) {
    const w2 = wb.addWorksheet(sheetName);
    w2.addRow(["Name", "Trips", "Dispatched (KG)", "Received (KG)", "Shortfall (KG)", "Shortfall %", "Trips short"])
      .eachCell((c: any) => {
        c.font = { bold: true, size: 10 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
      });
    for (const p2 of byParty(trips, key)) {
      const r = w2.addRow([p2.name, p2.trips, p2.dispatchedKg, p2.receivedKg, p2.shortfallKg, p2.shortfallPct / 100, p2.shortageTrips]);
      r.eachCell((c: any, col: number) => {
        if ([3, 4, 5].includes(col)) c.numFmt = '#,##0';
        if (col === 6) c.numFmt = '0.00%';
      });
    }
    w2.getColumn(1).width = 30;
    for (let i = 2; i <= 7; i++) w2.getColumn(i).width = 16;
  }

  /* ---- what needs chasing today ---- */
  const w3 = wb.addWorksheet("Needs attention");
  w3.addRow(["S.No", "Date", "Supplier", "Client", "Vehicle", "Problem"]).eachCell((c: any) => {
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
  });
  for (const t of trips) {
    const sh = shortageFor(t);
    const problems: string[] = [];
    if (sh.verdict === "shortage") problems.push(sh.message);
    if (sh.verdict === "excess") problems.push(sh.message);
    if (sh.verdict === "pending" && t.vendorChallanWeight > 0) problems.push("No receiving weight yet.");
    if (!t.ourDocNo && t.status !== "cancelled") {
      problems.push(t.docType === "tax_invoice" ? "No BIOME invoice number." : "No BIOME challan number — cannot be invoiced.");
    }
    if (t.ourDocNo && !t.billing?.totalAmount && t.status === "accepted") {
      problems.push("Accepted but not yet billed — no figures imported from Tally.");
    }
    if (!problems.length) continue;
    w3.addRow([t.serial, t.vehicleEntryDate, t.supplier, t.client, t.vehicleNumber, problems.join(" ")]);
  }
  [8, 12, 26, 26, 14, 70].forEach((w, i) => { w3.getColumn(i + 1).width = w; });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `Coordination-${business}-${month || "all"}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
