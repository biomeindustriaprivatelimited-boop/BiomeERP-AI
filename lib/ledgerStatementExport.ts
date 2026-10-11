"use client";

/**
 * PDF (A4, letterhead on every page, page x of y) and Excel (the shared
 * lib/excelStyle.ts look) for a Tally ledger statement.
 */
import type { LetterheadInfo } from "@/lib/companyProfile";

export interface StatementLine {
  ledger: string;
  amount: number; // Tally sign: Dr negative
}

export interface StatementRowData {
  date: string;
  particulars: string;
  moreParticulars: number;
  voucherType: string | null;
  voucherNumber: string;
  reference: string | null;
  narration: string | null;
  debit: number;
  credit: number;
  balance: number;
  entries: StatementLine[];
}

export interface PartyBlock {
  /** [label, value] pairs, already filtered to the ones with a value. */
  fields: [string, string][];
}

export interface StatementExportData {
  letterhead: LetterheadInfo;
  ledgerName: string;
  periodText: string; // "1-Apr-2025 to 31-Mar-2026"
  party: PartyBlock;
  opening: number;
  rows: StatementRowData[];
  totals: { debit: number; credit: number };
  closing: number;
  withNarration: boolean;
  generatedBy?: string;
  company: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const tallyDate = (d: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}` : d || "");
export const amt = (n: number) => (n ? Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
export const drcr = (n: number) => (n < 0 ? "Dr" : n > 0 ? "Cr" : "");
export const balText = (n: number) => (n ? `${amt(n)} ${drcr(n)}` : "0.00");
/** jsPDF's built-in fonts have no ₹ and no long dashes. */
const pdfText = (s: string) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[—–]/g, "-").replace(/·/g, "-").replace(/[^\x20-\x7E\n]/g, "");

export function fileBase(ledger: string, periodText: string) {
  return `Ledger - ${ledger} - ${periodText}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const r = await fetch("/icons/icon-192.png");
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onloadend = () => res(fr.result as string);
      fr.onerror = () => rej(new Error("logo"));
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

export async function exportStatementPdf(d: StatementExportData) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await logoDataUrl();
  const INK: [number, number, number] = [22, 30, 45];
  const MUTED: [number, number, number] = [100, 110, 125];
  const BRAND: [number, number, number] = [20, 83, 45];

  /** Letterhead + title — drawn on EVERY page. Returns where content starts. */
  const header = () => {
    doc.setFillColor(...BRAND);
    doc.rect(0, 0, W, 2.5, "F");
    if (logo) {
      try {
        doc.addImage(logo, "PNG", 12, 7, 13, 13);
      } catch {
        /* text-only header */
      }
    }
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(pdfText(d.letterhead.name.toUpperCase()), W / 2, 11, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(d.letterhead.address.join(", ")), W / 2, 15.5, { align: "center" });
    doc.text(pdfText(`GSTIN: ${d.letterhead.gstin}   PAN: ${d.letterhead.pan}   State: ${d.letterhead.state}`), W / 2, 19.5, { align: "center" });
    doc.setDrawColor(210, 216, 222);
    doc.line(12, 23, W - 12, 23);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Ledger Account", W / 2, 28.5, { align: "center" });
    doc.setFontSize(10);
    doc.text(pdfText(d.ledgerName), W / 2, 33.5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(d.periodText), W / 2, 37.8, { align: "center" });
    return 42;
  };

  let y = header();
  // Party block (first page only), two columns.
  if (d.party.fields.length) {
    const half = Math.ceil(d.party.fields.length / 2);
    const cols = [d.party.fields.slice(0, half), d.party.fields.slice(half)];
    doc.setDrawColor(220, 226, 232);
    const boxTop = y;
    let maxY = y;
    cols.forEach((list, ci) => {
      let yy = boxTop + 4.5;
      const x = ci === 0 ? 15 : W / 2 + 3;
      for (const [k, v] of list) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.8);
        doc.setTextColor(...MUTED);
        doc.text(pdfText(k), x, yy);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...INK);
        const lines = doc.splitTextToSize(pdfText(v), W / 2 - 49);
        doc.text(lines, x + 31, yy);
        yy += 4 * Math.max(1, lines.length);
      }
      maxY = Math.max(maxY, yy);
    });
    doc.roundedRect(12, boxTop, W - 24, maxY - boxTop, 1.5, 1.5, "S");
    y = maxY + 4;
  }

  const body: any[] = [];
  const bold = { fontStyle: "bold" as const };
  body.push([
    "",
    { content: "Opening Balance", styles: bold },
    "",
    "",
    { content: d.opening < 0 ? amt(d.opening) : "", styles: bold },
    { content: d.opening > 0 ? amt(d.opening) : "", styles: bold },
    { content: balText(d.opening), styles: bold },
  ]);
  for (const r of d.rows) {
    const part = `${r.particulars}${r.moreParticulars ? ` (+${r.moreParticulars} more)` : ""}${d.withNarration && r.narration ? `\n${r.narration}` : ""}`;
    body.push([tallyDate(r.date), pdfText(part), pdfText(r.voucherType || ""), pdfText(r.voucherNumber), amt(r.debit), amt(r.credit), balText(r.balance)]);
  }
  const shade = { fillColor: [234, 244, 236] as [number, number, number], fontStyle: "bold" as const };
  body.push([
    { content: "", styles: shade },
    { content: "Current Total", styles: shade },
    { content: "", styles: shade },
    { content: "", styles: shade },
    { content: amt(d.totals.debit), styles: shade },
    { content: amt(d.totals.credit), styles: shade },
    { content: "", styles: shade },
  ]);
  body.push([
    { content: "", styles: shade },
    { content: "Closing Balance", styles: shade },
    { content: "", styles: shade },
    { content: "", styles: shade },
    { content: d.closing < 0 ? amt(d.closing) : "", styles: shade },
    { content: d.closing > 0 ? amt(d.closing) : "", styles: shade },
    { content: balText(d.closing), styles: shade },
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit", "Balance"]],
    body,
    theme: "grid",
    rowPageBreak: "avoid",
    styles: { fontSize: 7.6, cellPadding: 1.4, textColor: INK, lineColor: [225, 230, 235], lineWidth: 0.1, valign: "top" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { cellWidth: 19 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 20 },
      3: { cellWidth: 24 },
      4: { cellWidth: 23, halign: "right" },
      5: { cellWidth: 23, halign: "right" },
      6: { cellWidth: 27, halign: "right" },
    },
    // Letterhead on every page after the first; the table header repeats.
    margin: { left: 12, right: 12, top: 44, bottom: 16 },
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1) header();
    },
  });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 226, 232);
    doc.line(12, H - 11, W - 12, H - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...MUTED);
    doc.text(
      pdfText(`${d.letterhead.name} - Ledger: ${d.ledgerName} - From Tally (${d.company}) - Generated ${new Date().toLocaleString("en-IN")}${d.generatedBy ? ` by ${d.generatedBy}` : ""}`).slice(0, 150),
      12,
      H - 6.5
    );
    doc.text(`Page ${i} of ${n}`, W - 12, H - 6.5, { align: "right" });
  }
  doc.save(`${fileBase(d.ledgerName, d.periodText)}.pdf`);
}

export async function exportStatementExcel(d: StatementExportData) {
  const ExcelJS = (await import("exceljs")).default;
  const XL = await import("@/lib/excelStyle");
  const wb = new ExcelJS.Workbook();
  wb.creator = d.letterhead.name;
  wb.created = new Date();
  let logoId: number | null = null;
  try {
    const r = await fetch("/icons/icon-192.png");
    if (r.ok) logoId = XL.addLogo(wb, await r.arrayBuffer());
  } catch {
    /* fine without */
  }
  const cols: import("@/lib/excelStyle").XlColumn[] = [
    { key: "date", header: "Date", type: "date", width: 12 },
    { key: "particulars", header: "Particulars", width: 40 },
    { key: "type", header: "Vch Type", width: 14 },
    { key: "no", header: "Vch No.", width: 18 },
    { key: "debit", header: "Debit", type: "money", width: 16 },
    { key: "credit", header: "Credit", type: "money", width: 16 },
    { key: "balance", header: "Balance", type: "money", width: 17 },
    { key: "side", header: "Dr/Cr", width: 7 },
    ...(d.withNarration ? [{ key: "narration", header: "Narration", width: 44 } as const] : []),
  ];
  const ws = wb.addWorksheet(XL.safeSheetName(d.ledgerName.slice(0, 28) || "Ledger"), {
    properties: { tabColor: { argb: XL.XL_COLORS.leaf }, defaultRowHeight: 18 },
  });
  let row = XL.letterhead(
    ws,
    {
      company: d.letterhead.name.toUpperCase(),
      title: `Ledger Account — ${d.ledgerName}`,
      period: d.periodText,
      generatedBy: d.generatedBy,
      note: `${d.letterhead.address.join(", ")}  ·  GSTIN ${d.letterhead.gstin}  ·  PAN ${d.letterhead.pan}`,
    },
    cols.length,
    logoId
  );
  // Party block
  const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  for (const [k, v] of d.party.fields) {
    ws.getCell(row, 1).value = k;
    ws.getCell(row, 1).font = { bold: true, size: 9.5, color: { argb: XL.XL_COLORS.muted } };
    ws.mergeCells(row, 2, row, Math.min(cols.length, 6));
    ws.getCell(row, 2).value = v;
    ws.getCell(row, 2).font = { size: 10, color: { argb: XL.XL_COLORS.ink } };
    ws.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    row += 1;
  }
  if (d.party.fields.length) row += 1;
  const headerRow = row;
  XL.styleHeaderRow(ws, headerRow, cols);
  row += 1;
  const put = (vals: Record<string, any>, kind: "row" | "opening" | "total" | "closing", band: number) => {
    const r = ws.getRow(row);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      let v = vals[c.key];
      if (c.type === "date" && v) v = XL.excelDate(v) ?? v;
      cell.value = v === "" || v === undefined ? null : v;
      const fmt = XL.numFmtFor(c.type);
      if (fmt) cell.numFmt = fmt;
      cell.font = { size: 10, bold: kind !== "row", color: { argb: kind === "row" ? XL.XL_COLORS.ink : XL.XL_COLORS.brand } };
      cell.alignment = { vertical: "top", wrapText: c.key === "particulars" || c.key === "narration", horizontal: c.type === "money" ? "right" : c.type === "date" ? "center" : "left" };
      cell.border = { bottom: { style: kind === "closing" ? "double" : "thin", color: { argb: XL.XL_COLORS.line } } };
      if (kind !== "row") cell.fill = solid(XL.XL_COLORS.leafSoft);
      else if (band % 2) cell.fill = solid(XL.XL_COLORS.zebra);
    });
    row += 1;
  };
  put({ particulars: "Opening Balance", debit: d.opening < 0 ? -d.opening : null, credit: d.opening > 0 ? d.opening : null, balance: Math.abs(d.opening), side: drcr(d.opening) }, "opening", 0);
  d.rows.forEach((r, i) =>
    put(
      {
        date: r.date,
        particulars: `${r.particulars}${r.moreParticulars ? ` (+${r.moreParticulars} more)` : ""}`,
        type: r.voucherType || "",
        no: r.voucherNumber,
        debit: r.debit || null,
        credit: r.credit || null,
        balance: Math.abs(r.balance),
        side: drcr(r.balance),
        narration: r.narration || "",
      },
      "row",
      i
    )
  );
  put({ particulars: "Current Total", debit: d.totals.debit, credit: d.totals.credit }, "total", 0);
  put({ particulars: "Closing Balance", debit: d.closing < 0 ? -d.closing : null, credit: d.closing > 0 ? d.closing : null, balance: Math.abs(d.closing), side: drcr(d.closing) }, "closing", 0);
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width || 14));
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  XL.printSetup(ws, headerRow, `Ledger ${d.ledgerName}`);
  ws.pageSetup.orientation = "portrait";
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `${fileBase(d.ledgerName, d.periodText)}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
