import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadTrips, shortageFor, derivedStatus, summarise, byParty, lockStateFor, TRIP_STATUS } from "@/lib/coordination";
import {
  addLogo, buildTableSheet, buildSummarySheet, groupSum, monthLabel, TONES,
  type XlColumn, type XlTone,
} from "@/lib/excelStyle";
import { logoPng } from "@/lib/excelLogo";

/** "Tax Invoice" reads better in a workbook than "tax_invoice". */
function docLabel(v: string): string {
  if (v === "tax_invoice") return "Tax Invoice";
  if (v === "delivery_challan") return "Delivery Challan";
  return "";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// createRequire() is special-cased by webpack and cannot load files by
// absolute path from a server bundle; the runtime require can.
const nodeRequire: NodeRequire = eval("require");

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

  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria Private Limited";
  wb.company = "Biome Industria Private Limited";
  wb.created = new Date();
  const logoId = addLogo(wb, logoPng());

  const label = month
    ? new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "All months";
  const registerName = business === "manufacturing" ? "Manufacturing" : "Trading";
  const s = summarise(trips);
  const meta = {
    title: `${registerName} Coordination Register`,
    period: label,
    generatedBy: auth.session.name || "",
    note:
      `${s.trips} trips · dispatched ${s.dispatchedKg.toLocaleString("en-IN")} kg · received ${s.receivedKg.toLocaleString("en-IN")} kg · ` +
      `shortfall ${s.shortfallKg.toLocaleString("en-IN")} kg across ${s.shortageTrips} trip(s) · ${s.pendingReceiving} awaiting receiving`,
  };

  /* ---- the register ---- */
  const COLS: XlColumn[] = [
    { key: "serial", header: "S.No", type: "int", width: 7 },
    { key: "client", header: "Client", width: 24 },
    { key: "location", header: "Location", width: 15 },
    { key: "poNumber", header: "PO No", width: 14 },
    { key: "supplier", header: "Supplier", width: 24 },
    { key: "vehicleNumber", header: "Vehicle No", width: 14 },
    { key: "vehicleEntryDate", header: "Entry Date", type: "date", width: 12 },
    { key: "vendorDocType", header: "Vendor Doc Type", width: 14 },
    { key: "vendorChallanNo", header: "Vendor Challan No", width: 16 },
    { key: "vendorChallanDate", header: "Challan Date", type: "date", width: 12 },
    { key: "vendorInvoiceNo", header: "Vendor Invoice No", width: 16 },
    { key: "dispatchKg", header: "Dispatch Wt (kg)", type: "kg", total: true, width: 14 },
    { key: "docType", header: "Our Doc Type", width: 14 },
    { key: "ourDocNo", header: "Our Doc No", width: 18 },
    { key: "ourDocDate", header: "Our Doc Date", type: "date", width: 12 },
    { key: "challanAmount", header: "Challan Amount", type: "money", total: true, width: 15 },
    { key: "receivingDate", header: "Receiving Date", type: "date", width: 12 },
    { key: "receivingQty", header: "Receiving Qty (kg)", type: "kg", total: true, width: 15 },
    { key: "ccWeight", header: "CC Weight", type: "kg", total: true, width: 12 },
    { key: "differenceKg", header: "Difference (kg)", type: "kg", total: true, width: 14 },
    { key: "differencePct", header: "Difference %", type: "pct", width: 11 },
    { key: "allowanceKg", header: "Allowance (kg)", type: "kg", total: true, width: 13 },
    { key: "excessKg", header: "Beyond Allowance (kg)", type: "kg", total: true, width: 15 },
    { key: "invoiceKg", header: "Invoice Wt (kg)", type: "kg", total: true, width: 14 },
    { key: "taxable", header: "Taxable", type: "money", total: true, width: 15 },
    { key: "tax", header: "Tax", type: "money", total: true, width: 13 },
    { key: "invoiceTotal", header: "Invoice Total", type: "money", total: true, width: 15 },
    { key: "status", header: "Status", width: 12 },
    { key: "frozen", header: "Frozen", width: 9 },
    { key: "remarks", header: "Reason / Remarks", width: 34 },
  ];
  const statusLabel = (id: string) => TRIP_STATUS.find((x) => x.id === id)?.label || id;
  const rows = trips
    .slice()
    .sort((a, b) => (a.vehicleEntryDate || "").localeCompare(b.vehicleEntryDate || ""))
    .map((t) => {
      const sh = shortageFor(t);
      const lock = lockStateFor(t);
      const pending = sh.verdict === "pending";
      return {
        serial: t.serial, client: t.client, location: t.location, poNumber: t.poNumber,
        supplier: t.supplier || (business === "manufacturing" ? "BIOME (own material)" : ""),
        vehicleNumber: t.vehicleNumber, vehicleEntryDate: t.vehicleEntryDate,
        vendorDocType: docLabel(t.vendorDocType), vendorChallanNo: t.vendorChallanNo,
        vendorChallanDate: t.vendorChallanDate, vendorInvoiceNo: t.vendorInvoiceNo,
        dispatchKg: t.vendorChallanWeight || null,
        docType: docLabel(t.docType), ourDocNo: t.ourDocNo, ourDocDate: t.ourDocDate,
        challanAmount: t.vendorChallanAmount || null,
        receivingDate: t.receivingDate, receivingQty: t.receivingQty || null, ccWeight: t.ccWeight || null,
        differenceKg: pending ? null : sh.differenceKg,
        differencePct: pending ? null : sh.differencePct / 100,
        allowanceKg: pending ? null : sh.allowanceKg,
        excessKg: sh.excessKg || null,
        invoiceKg: t.billing?.invoiceWeightKg || null,
        taxable: t.billing?.taxableAmount || null,
        tax: t.billing?.taxAmount || null,
        invoiceTotal: t.billing?.totalAmount || null,
        status: statusLabel(derivedStatus(t)),
        __status: derivedStatus(t),
        __verdict: sh.verdict,
        frozen: lock.locked ? "Frozen" : "",
        remarks: [t.cancellationReason, t.remarks, t.checklistRemarks].filter(Boolean).join(" · "),
      };
    });

  const STATUS_TONE: Record<string, XlTone> = {
    planned: TONES.grey, dispatched: TONES.blue, received: TONES.green, accepted: TONES.green,
    shortage: TONES.red, rejected: TONES.red, cancelled: TONES.grey,
  };
  buildTableSheet(wb, "Coordination", {
    meta,
    columns: COLS,
    rows,
    logoId,
    freezeCols: 3,
    footerLeft: `${registerName} coordination register — ${label}`,
    rowTone: (r) => (r.__status === "cancelled" ? TONES.grey : null),
    cellTone: (key, value, r) => {
      if (key === "status") return STATUS_TONE[r.__status] || null;
      if (key === "frozen" && value) return TONES.indigo;
      // The whole point of the export: a shortage row is impossible to miss.
      if (r.__verdict === "shortage" && (key === "differenceKg" || key === "differencePct" || key === "excessKg")) return TONES.red;
      if (r.__verdict === "excess" && key === "differenceKg") return TONES.amber;
      return null;
    },
  });

  /* ---- summary: shortage by supplier and by client, and by month ---- */
  const partyCols = (name: string): XlColumn[] => [
    { key: "name", header: name },
    { key: "trips", header: "Trips", type: "int", total: true },
    { key: "dispatchedKg", header: "Dispatched (kg)", type: "kg", total: true },
    { key: "receivedKg", header: "Received (kg)", type: "kg", total: true },
    { key: "shortfallKg", header: "Shortfall (kg)", type: "kg", total: true },
    { key: "shortfallPct", header: "Shortfall %", type: "pct" },
    { key: "shortageTrips", header: "Trips Short", type: "int", total: true },
  ];
  const party = (key: "supplier" | "client") => byParty(trips, key).map((p2) => ({ ...p2, shortfallPct: p2.shortfallPct / 100 }));
  const months = groupSum(
    rows.filter((r) => r.__status !== "cancelled"),
    (r) => String(r.vehicleEntryDate || "").slice(0, 7),
    ["dispatchKg", "receivingQty", "invoiceTotal"]
  ).sort((a, b) => a.group.localeCompare(b.group)).map((g) => ({ ...g, month: monthLabel(g.group) }));
  buildSummarySheet(wb, "Summary", { ...meta, title: `${registerName} Coordination — Summary` }, [
    { title: "Shortage by supplier", columns: partyCols("Supplier"), rows: party("supplier") },
    { title: "Shortage by client", columns: partyCols("Client"), rows: party("client") },
    {
      title: "By month",
      columns: [
        { key: "month", header: "Month" },
        { key: "count", header: "Trips", type: "int", total: true },
        { key: "dispatchKg", header: "Dispatched (kg)", type: "kg", total: true },
        { key: "receivingQty", header: "Received (kg)", type: "kg", total: true },
        { key: "invoiceTotal", header: "Invoiced (₹)", type: "money", total: true },
      ],
      rows: months,
    },
  ], logoId);

  /* ---- what needs chasing today ---- */
  const attention: Record<string, any>[] = [];
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
    attention.push({
      serial: t.serial, date: t.vehicleEntryDate, supplier: t.supplier, client: t.client,
      vehicle: t.vehicleNumber, problem: problems.join(" "), __short: sh.verdict === "shortage",
    });
  }
  buildTableSheet(wb, "Needs attention", {
    meta: { ...meta, title: `${registerName} Coordination — Needs attention`, note: `${attention.length} trip(s) to chase` },
    columns: [
      { key: "serial", header: "S.No", type: "int", width: 8 },
      { key: "date", header: "Date", type: "date", width: 12 },
      { key: "supplier", header: "Supplier", width: 26 },
      { key: "client", header: "Client", width: 26 },
      { key: "vehicle", header: "Vehicle", width: 14 },
      { key: "problem", header: "Problem", width: 70 },
    ],
    rows: attention,
    logoId,
    totals: false,
    tabColor: "FFB42318",
    cellTone: (key, _v, r) => (key === "problem" && r.__short ? TONES.red : null),
  });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `Coordination-${business}-${month || "all"}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
