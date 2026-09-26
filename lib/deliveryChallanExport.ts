// Biome Platform — Delivery Challan Generator: PDF & Excel export
// -------------------------------------------------------------------
// Runs entirely client-side (same pattern the rest of the platform's
// exports use) — jsPDF + jspdf-autotable for the PDF, ExcelJS for the
// spreadsheet. No server round-trip, no file ever leaves the browser
// until the user chooses to save it.

import jsPDF from "jspdf";
import "jspdf-autotable";
import ExcelJS from "exceljs";
import { drawLetterhead, drawFooter } from "./pdfBranding";
import { CLIENT_LABELS, calcNetWeightKg, kgToMt, type ChallanFormData } from "./deliveryChallan";

function parseChallanDate(value: string): Date | null {
  if (!value) return null;
  const dmy = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFileBase(data: ChallanFormData): string {
  const raw = data.challanNo || "Delivery-Challan";
  return raw.replace(/[\\/:*?"<>|]/g, "-").trim() || "Delivery-Challan";
}

/**
 * Page 1: the Delivery Note / Delivery Challan itself.
 * Page 2: Annexure-II — the consignment tag table for non-torrefied
 * biomass pellets, which NTPC Mouda and Solapur both require attached.
 */
export async function generateChallanPdf(data: ChallanFormData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const net = calcNetWeightKg(data.grossWeightKg, data.tareWeightKg);

  // ---- Page 1: Delivery Note ----
  let y = await drawLetterhead(
    doc,
    "Delivery Note / Delivery Challan",
    `${CLIENT_LABELS[data.client]} · Challan No. ${data.challanNo || "—"}`
  );

  const headerRows: [string, string][] = [
    ["Challan No.", data.challanNo || "—"],
    ["Challan Date", data.challanDate || "—"],
    ["P.O. No. / LOA No.", data.poNo || "—"],
    ["LOA Date", data.loaDate || "—"],
    ["Other References / BDC Ref No.", data.bdcRefNo || "—"],
    ["E-Way Bill No.", data.ewayBillNo || "—"],
    ["Vendor Code", data.vendorCode || "—"],
  ];
  const logisticsRows: [string, string][] = [
    ["Transporter Name", data.transporterName || "—"],
    ["Lorry / Vehicle No.", data.vehicleNo || "—"],
    ["L.R. / R.R. No.", data.lrNo || "—"],
    ["Driver Mobile No.", data.driverMobile || "—"],
    ["Driver Licence No.", data.driverLicenseNo || "—"],
    ["Destination / Place of Dispatch", data.destination || "—"],
  ];

  // Two side-by-side info blocks (header/dispatch, then logistics),
  // each rendered as a borderless two-column key/value table.
  (doc as any).autoTable({
    startY: y,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55, textColor: [90, 100, 120] }, 1: { cellWidth: 80 } },
    body: headerRows,
    margin: { left: 14 },
    tableWidth: 135,
  });
  const afterHeader = (doc as any).lastAutoTable.finalY;

  (doc as any).autoTable({
    startY: y,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 45, textColor: [90, 100, 120] }, 1: { cellWidth: 45 } },
    body: logisticsRows,
    margin: { left: 155 },
    tableWidth: 90,
  });
  const afterLogistics = (doc as any).lastAutoTable.finalY;

  y = Math.max(afterHeader, afterLogistics) + 6;

  // ---- Goods & weight table ----
  (doc as any).autoTable({
    startY: y,
    head: [["Item Description", "HSN/SAC", "Gross Wt (Kg)", "Tare Wt (Kg)", "Net Wt (Kg)", "Net Wt (MT)"]],
    body: [
      [
        data.itemDescription || "—",
        data.hsnCode || "—",
        data.grossWeightKg || "—",
        data.tareWeightKg || "—",
        String(net),
        String(kgToMt(net)),
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [90, 156, 78], textColor: 255 },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ---- Signatory block ----
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 68, 84);
  doc.text("For BIOME INDUSTRIA PRIVATE LIMITED", 140, y);
  doc.text("Authorised Signatory", 140, y + 22);
  doc.setDrawColor(210, 214, 222);
  doc.line(140, y + 20, 195, y + 20);

  drawFooter(doc);

  // ---- Page 2: Annexure-II ----
  doc.addPage();
  let y2 = await drawLetterhead(
    doc,
    "Annexure-II",
    "Tag for Consignment — Non-Torrefied Biomass Pellets"
  );

  (doc as any).autoTable({
    startY: y2,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 70, textColor: [90, 100, 120] }, 1: { cellWidth: 95 } },
    body: [
      ["Challan No.", data.challanNo || "—"],
      ["Batch Number", data.batchNumber || "—"],
      ["Pellet Diameter & Specification", data.pelletSpec || "—"],
      ["Base Material %", data.baseMaterialPct || "—"],
      ["Mixing Material %", data.mixingMaterialPct || "—"],
      ["Additive %", data.additivePct || "—"],
      ["Vehicle No.", data.vehicleNo || "—"],
      ["Net Weight", `${net} Kg (${kgToMt(net)} MT)`],
    ],
    margin: { left: 14, right: 14 },
  });

  drawFooter(doc);

  // Mouda's supplied workbook has a third print page. Keep the PDF
  // pagination consistent with that template instead of silently
  // returning a two-page generic challan.
  if (data.client === "ntpc_mouda") {
    doc.addPage();
    let y3 = await drawLetterhead(doc, "NTPC Mouda — Page 3", "Template-aligned consignment details");
    (doc as any).autoTable({
      startY: y3,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 3 },
      head: [["Field", "Value"]],
      body: [
        ["Challan No.", data.challanNo || "—"],
        ["Challan Date", data.challanDate || "—"],
        ["Vehicle No.", data.vehicleNo || "—"],
        ["Transporter", data.transporterName || "—"],
        ["L.R. / R.R. No.", data.lrNo || "—"],
        ["E-Way Bill No.", data.ewayBillNo || "—"],
        ["Gross Weight (Kg)", data.grossWeightKg || "—"],
        ["Tare Weight (Kg)", data.tareWeightKg || "—"],
        ["Material Weight (Kg)", String(net)],
        ["Batch Number", data.batchNumber || "—"],
        ["Pellet Specification", data.pelletSpec || "—"],
      ],
      margin: { left: 14, right: 14 },
    });
    drawFooter(doc);
  }

  doc.save(`${safeFileBase(data)}.pdf`);
}

/** Formula-based Excel export — Net Weight is a live SUBTRACT formula,
 *  not a baked-in number, so re-opening the sheet and changing gross or
 *  tare recalculates it automatically. */
export async function generateChallanExcel(data: ChallanFormData): Promise<void> {
  // Use the supplied NTPC workbooks as the actual export template. This keeps
  // merged cells, print areas, page setup, wording and the 3-sheet/2-sheet
  // structure intact instead of producing a generic spreadsheet.
  const template = data.client === "ntpc_mouda"
    ? "/templates/challan/ntpc-mouda.xlsx"
    : "/templates/challan/ntpc-solapur.xlsx";
  const response = await fetch(template, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the ${data.client === "ntpc_mouda" ? "Mouda" : "Solapur"} challan template.`);

  const buffer = await response.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const net = calcNetWeightKg(data.grossWeightKg, data.tareWeightKg);

  if (data.client === "ntpc_mouda") {
    const cover = wb.getWorksheet("Table 1");
    const annexure = wb.getWorksheet("Table 1 (3)");
    const challan = wb.getWorksheet("Table 1 (2)");
    if (!cover || !annexure || !challan) throw new Error("The supplied Mouda template sheets are incomplete.");

    cover.getCell("E6").value = data.challanNo || "";
    cover.getCell("H6").value = data.challanDate ? parseChallanDate(data.challanDate) : null;
    cover.getCell("E10").value = data.transporterName || "";
    cover.getCell("E11").value = data.vehicleNo || "";
    cover.getCell("E14").value = data.poNo || "";
    cover.getCell("E16").value = data.vendorCode || "";
    cover.getCell("E17").value = data.ewayBillNo || "";
    cover.getCell("C21").value = data.itemDescription || "AGRO RESIDUE BIOMASS PELLETS";
    cover.getCell("D21").value = data.hsnCode || "440110";
    cover.getCell("E21").value = kgToMt(net);
    cover.getCell("F21").value = "MTS";

    annexure.getCell("E8").value = data.challanDate ? parseChallanDate(data.challanDate) : null;
    annexure.getCell("E9").value = data.batchNumber || "";
    annexure.getCell("E10").value = data.vehicleNo || "";
    annexure.getCell("F11").value = Number(data.grossWeightKg) || 0;
    annexure.getCell("F12").value = Number(data.tareWeightKg) || 0;
    annexure.getCell("F13").value = { formula: "F11-F12" };
    annexure.getCell("E17").value = data.pelletSpec || "";
    annexure.getCell("E18").value = data.baseMaterialPct || "";
    annexure.getCell("E19").value = data.mixingMaterialPct || "";
    annexure.getCell("E20").value = data.additivePct || "";

    challan.getCell("D6").value = data.bdcRefNo || "";
    challan.getCell("D7").value = data.ewayBillNo || "";
    challan.getCell("D8").value = data.challanNo || "";
    challan.getCell("D9").value = data.challanDate ? parseChallanDate(data.challanDate) : null;
    challan.getCell("D10").value = data.vehicleNo || "";
    challan.getCell("D11").value = data.driverMobile || "";
    challan.getCell("D12").value = data.transporterName || "";
    challan.getCell("D13").value = data.driverLicenseNo || "";
    challan.getCell("D14").value = data.destination || "MOUDA, NAGPUR";
    challan.getCell("D17").value = kgToMt(net);
    challan.getCell("D18").value = kgToMt(net);
  } else {
    const cover = wb.getWorksheet("Delivery Challans");
    const annexure = wb.getWorksheet("Annexure");
    if (!cover || !annexure) throw new Error("The supplied Solapur template sheets are incomplete.");

    cover.getCell("F7").value = data.challanNo || "";
    cover.getCell("I7").value = data.challanDate ? parseChallanDate(data.challanDate) : null;
    cover.getCell("F11").value = data.vehicleNo || "";
    cover.getCell("F13").value = data.vendorCode || "";
    cover.getCell("F14").value = data.poNo || "";
    cover.getCell("F15").value = data.bdcRefNo || "";
    cover.getCell("F16").value = data.vendorCode || "";
    cover.getCell("F17").value = data.ewayBillNo || "";
    cover.getCell("F21").value = Number(data.grossWeightKg) || net;

    annexure.getCell("D9").value = data.challanDate ? parseChallanDate(data.challanDate) : null;
    annexure.getCell("D10").value = data.batchNumber || data.challanNo || "";
    annexure.getCell("D11").value = data.vehicleNo || "";
    annexure.getCell("E12").value = Number(data.grossWeightKg) || 0;
    annexure.getCell("E13").value = Number(data.tareWeightKg) || 0;
    annexure.getCell("E14").value = { formula: "E12-E13" };
    annexure.getCell("D18").value = data.pelletSpec || "";
    annexure.getCell("D19").value = data.baseMaterialPct || "";
    annexure.getCell("D20").value = data.mixingMaterialPct || "";
    annexure.getCell("D21").value = data.additivePct || "";
  }

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileBase(data)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  // Released after the save has started, not on the same tick.
  window.setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
