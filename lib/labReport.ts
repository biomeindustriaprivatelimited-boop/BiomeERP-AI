import type { LabReportData } from "./aiExtract";
import { tableCell } from "./ocr";

/* ------------------------------------------------------------------ */
/*  Lab / test report export — dedicated PDF and Excel builders for    */
/*  the structured header + metadata grid + table + footer shape used  */
/*  by NTPC Coal and Combustion Laboratory reports (and similarly       */
/*  structured test reports from other plants/vendors).                */
/* ------------------------------------------------------------------ */

const METADATA_ROWS: { key: keyof LabReportData["metadata"]; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "testReportNo", label: "Test Report No" },
  { key: "vendorName", label: "Vendor Name" },
  { key: "poNo", label: "PO No" },
  { key: "materialSupplied", label: "Material Supplied" },
  { key: "sampleDrawnBy", label: "Sample Drawn by Lab" },
];

function dash(v: string | null | undefined): string {
  return v && v.trim() ? v : "—";
}

/** Builds a branded, print-ready PDF for a single lab report — Biome's
 *  own letterhead at the top (consistent with every other export in the
 *  platform), followed by the source document's own header, metadata
 *  grid, full results table, and footer (remarks + signatories). */
export async function downloadLabReportPdf(report: LabReportData, fileName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { drawLetterhead, drawFooter } = await import("./pdfBranding");

  const doc = new jsPDF({ orientation: "landscape" });
  const green: [number, number, number] = [124, 179, 66];
  const ink: [number, number, number] = [22, 30, 45];
  const muted: [number, number, number] = [110, 120, 140];
  const pageWidth = doc.internal.pageSize.getWidth();

  let y = await drawLetterhead(
    doc,
    "Coal & Combustion Lab Report — Extracted Data",
    `Generated ${new Date().toLocaleString("en-IN")}`
  );

  // --- Header Information (from the source document) ------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...ink);
  doc.text(dash(report.organizationName), 14, y);
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(dash(report.department), 14, y);
  y += 5;
  doc.text(dash(report.address), 14, y);
  y += 8;

  // --- Metadata Grid ----------------------------------------------------
  const metaRows: string[][] = [];
  for (let i = 0; i < METADATA_ROWS.length; i += 2) {
    const a = METADATA_ROWS[i];
    const b = METADATA_ROWS[i + 1];
    metaRows.push([
      a.label,
      dash(report.metadata?.[a.key]),
      b ? b.label : "",
      b ? dash(report.metadata?.[b.key]) : "",
    ]);
  }
  autoTable(doc, {
    startY: y,
    body: metaRows,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: muted, cellWidth: 38 },
      1: { textColor: ink, cellWidth: 92 },
      2: { fontStyle: "bold", textColor: muted, cellWidth: 38 },
      3: { textColor: ink },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- Data Table ---------------------------------------------------------
  const table = report.table;
  if (table && table.headers.length) {
    autoTable(doc, {
      startY: y,
      head: [table.headers],
      body: table.rows.map((row) => table.headers.map((h, i) => tableCell(row, h, i))),
      theme: "striped",
      headStyles: { fillColor: green, textColor: 255, fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  const ensureSpace = (needed: number) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + needed > pageHeight - 16) {
      doc.addPage();
      y = 16;
    }
  };

  // --- Remarks --------------------------------------------------------
  if (report.remarks?.length) {
    ensureSpace(8 + report.remarks.length * 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    doc.text("Remarks", 14, y);
    y += 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    for (const remark of report.remarks) {
      const lines = doc.splitTextToSize(`•  ${remark}`, pageWidth - 28);
      doc.text(lines, 14, y);
      y += 4.6 * lines.length;
    }
    y += 3;
  }

  // --- Signatories ------------------------------------------------------
  if (report.signatories?.length) {
    ensureSpace(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    doc.text("Signatories", 14, y);
    y += 7;

    const colWidth = (pageWidth - 28) / Math.max(1, report.signatories.length);
    report.signatories.forEach((s, i) => {
      const x = 14 + i * colWidth;
      doc.setDrawColor(...muted);
      doc.line(x, y, x + colWidth - 10, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...ink);
      doc.text(dash(s.name), x, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(dash(s.designation), x, y + 9.5);
    });
  }

  drawFooter(doc);
  doc.save(fileName);
}

/** Builds a structured, sheet-per-report Excel export. Uses cell merges
 *  and column widths (both supported by the community SheetJS build this
 *  project already ships) to lay the report out clearly; true cell
 *  coloring/bold would need the paid "xlsx-style" fork, so headers are
 *  distinguished by row structure and label text instead. */
export async function downloadLabReportExcel(report: LabReportData, fileName: string) {
  const XLSX = await import("xlsx");

  const table = report.table;
  const colCount = Math.max(4, table?.headers.length ?? 0);

  const aoa: (string | number)[][] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  const pushMergedRow = (text: string) => {
    aoa.push([text, ...Array(colCount - 1).fill("")]);
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: colCount - 1 } });
  };

  pushMergedRow(dash(report.organizationName));
  pushMergedRow(dash(report.department));
  pushMergedRow(dash(report.address));
  aoa.push([]);

  pushMergedRow("REPORT METADATA");
  for (const { key, label } of METADATA_ROWS) {
    aoa.push([label, dash(report.metadata?.[key]), ...Array(Math.max(0, colCount - 2)).fill("")]);
  }
  aoa.push([]);

  if (table && table.headers.length) {
    pushMergedRow("DATA TABLE");
    aoa.push([...table.headers]);
    const headerRowIndex = aoa.length - 1;
    for (const row of table.rows) {
      aoa.push(table.headers.map((h, i) => tableCell(row, h, i)));
    }
    aoa.push([]);
  }

  if (report.remarks?.length) {
    pushMergedRow("REMARKS");
    for (const r of report.remarks) aoa.push([r]);
    aoa.push([]);
  }

  if (report.signatories?.length) {
    pushMergedRow("SIGNATORIES");
    aoa.push(["Name", "Designation"]);
    for (const s of report.signatories) aoa.push([dash(s.name), dash(s.designation)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;

  const colWidths = Array.from({ length: colCount }, (_, c) => {
    let max = 10;
    for (const row of aoa) {
      const v = row[c];
      if (v !== undefined && v !== null) max = Math.max(max, String(v).length + 2);
    }
    return { wch: Math.min(max, 45) };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lab Report".slice(0, 31));
  XLSX.writeFile(wb, fileName);
}
