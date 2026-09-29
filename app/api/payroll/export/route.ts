import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadRuns, Payslip } from "@/lib/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// createRequire() is special-cased by webpack and cannot load files by
// absolute path from a server bundle; the runtime require can.
const nodeRequire: NodeRequire = eval("require");

/**
 * The salary sheet as a real Excel workbook.
 *
 * Written with styling rather than a bare CSV because this sheet is printed
 * and circulated: a banker's-grade header, frozen panes so the names stay
 * visible while scrolling right, grouped earning and deduction blocks, and
 * a totals row that is a real SUM formula so anyone auditing it can see
 * where the figure comes from.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;

  const id = req.nextUrl.searchParams.get("id");
  const run = loadRuns().find((r) => r.id === id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json(
      { error: "Run `npm install exceljs` in the project folder, then try again." },
      { status: 500 }
    );
  }

  const slips: Payslip[] = run.payslips;
  const monthLabel = new Date(run.month + "-01").toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

  // Earning and deduction names differ per person, so the columns are the
  // union of everything that appears — otherwise a one-off allowance would
  // silently vanish from the sheet.
  const earningCols = Array.from(new Set(slips.flatMap((s) => s.earnings.map((e) => e.label))));
  const deductionCols = Array.from(new Set(slips.flatMap((s) => s.deductions.map((d) => d.label))));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria";
  wb.created = new Date();

  const ws = wb.addWorksheet("Salary sheet", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 6 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const INK = "FF0B1F27";
  const LEAF = "FF1F7A4C";
  const SOFT = "FFEFF4F2";
  const RULE = "FFCBD8D3";

  const lastCol = 5 + earningCols.length + 1 + deductionCols.length + 1 + 1;
  const colLetter = (n: number) => {
    let s = "";
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };

  // ---- Title block ----
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = "BIOME INDUSTRIA PRIVATE LIMITED";
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `Salary sheet — ${monthLabel}${run.plant ? ` · ${run.plant}` : " · all locations"}`;
  sub.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  sub.alignment = { horizontal: "center" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEAF } };
  ws.getRow(2).height = 18;

  ws.mergeCells(3, 1, 3, lastCol);
  const meta = ws.getCell(3, 1);
  meta.value =
    `${slips.length} employees · status: ${run.status}` +
    (run.approvedByName ? ` · approved by ${run.approvedByName}` : "") +
    ` · generated ${new Date().toLocaleDateString("en-IN")}`;
  meta.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5A6B66" } };
  meta.alignment = { horizontal: "center" };

  ws.addRow([]);

  // ---- Grouped header ----
  const groupRow = 5;
  const headRow = 6;
  const earnStart = 6;
  const earnEnd = earnStart + earningCols.length; // includes the Gross column
  const dedStart = earnEnd + 1;
  const dedEnd = dedStart + deductionCols.length;

  const band = (from: number, to: number, label: string, colour: string) => {
    if (to < from) return;
    ws.mergeCells(groupRow, from, groupRow, to);
    const c = ws.getCell(groupRow, from);
    c.value = label;
    c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
  };
  band(1, 5, "EMPLOYEE", INK);
  band(earnStart, earnEnd, "EARNINGS", LEAF);
  band(dedStart, dedEnd, "DEDUCTIONS", "FFA6501E");
  band(dedEnd + 1, dedEnd + 1, "NET", INK);

  const headers = [
    "S.No", "Code", "Name", "Designation", "Paid days",
    ...earningCols, "Gross",
    ...deductionCols, "Total deductions",
    "Net pay",
  ];
  const hr = ws.getRow(headRow);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: INK } };
    c.alignment = { horizontal: i < 5 ? "left" : "right", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    c.border = { bottom: { style: "medium", color: { argb: INK } } };
  });
  hr.height = 32;

  // ---- Body ----
  slips.forEach((s, i) => {
    const earnMap = new Map(s.earnings.map((e) => [e.label, e.amount]));
    const dedMap = new Map(s.deductions.map((d) => [d.label, d.amount]));

    const row = ws.addRow([
      i + 1, s.code, s.name, s.designation || "", s.paidDays,
      ...earningCols.map((l) => earnMap.get(l) ?? 0),
      s.grossEarnings,
      ...deductionCols.map((l) => dedMap.get(l) ?? 0),
      s.totalDeductions,
      s.netPay,
    ]);

    row.eachCell((cell: any, col: number) => {
      cell.font = { name: "Calibri", size: 10 };
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
      if (col > 5) {
        cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      if (col === earnEnd || col === dedEnd || col === dedEnd + 1) {
        cell.font = { name: "Calibri", size: 10, bold: true };
      }
    });
    // Banding, so a long row is readable across the page.
    if (i % 2 === 1) {
      row.eachCell((cell: any) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAF9" } };
      });
    }
  });

  // ---- Totals as real formulas ----
  const firstData = headRow + 1;
  const lastData = headRow + slips.length;
  if (slips.length > 0) {
    const totals = ws.addRow([]);
    totals.getCell(1).value = "TOTAL";
    totals.getCell(1).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
    for (let col = 6; col <= lastCol; col++) {
      const L = colLetter(col);
      totals.getCell(col).value = { formula: `SUM(${L}${firstData}:${L}${lastData})` };
      totals.getCell(col).numFmt = '#,##0.00';
      totals.getCell(col).alignment = { horizontal: "right" };
      totals.getCell(col).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
    }
    for (let col = 1; col <= lastCol; col++) {
      totals.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    }
    totals.height = 20;
  }

  // ---- Column widths ----
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 26;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 11;
  for (let col = 6; col <= lastCol; col++) ws.getColumn(col).width = 15;

  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: lastData, column: lastCol } };

  // ---- Employer cost sheet, for the accountant rather than the employee ----
  const ws2 = wb.addWorksheet("Employer cost");
  const empCols = Array.from(new Set(slips.flatMap((s) => s.employerContributions.map((c) => c.label))));
  ws2.addRow(["Code", "Name", "Gross", ...empCols, "Cost to company"]).eachCell((c: any) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
  });
  slips.forEach((s) => {
    const m = new Map(s.employerContributions.map((c) => [c.label, c.amount]));
    const r = ws2.addRow([s.code, s.name, s.grossEarnings, ...empCols.map((l) => m.get(l) ?? 0), s.employerCost]);
    r.eachCell((c: any, col: number) => { if (col > 2) c.numFmt = '#,##0.00'; });
  });
  ws2.getColumn(1).width = 12;
  ws2.getColumn(2).width = 26;
  for (let i = 3; i <= 3 + empCols.length + 1; i++) ws2.getColumn(i).width = 16;

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `Salary-sheet-${run.month}${run.plant ? "-" + run.plant : ""}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
