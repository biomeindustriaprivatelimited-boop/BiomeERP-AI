/**
 * The biomass / transport sheet as a styled Excel workbook (server only).
 * -------------------------------------------------------------------
 * Sheet 1 is the register itself: the plant's columns laid out side by
 * side in the order the grid shows them, every derived column still a
 * LIVE Excel formula (remapped to the new column letters), plus the
 * row's status (Draft / Submitted / Frozen / Unlocked) in colour.
 * Sheet 2 is a summary — by vendor (or transporter) and by month.
 */

import { computeRow, type SheetColumn } from "@/lib/plantSheets";
import { lockInfo, type LockState } from "@/lib/sheetLock";
import {
  addLogo, buildTableSheet, buildSummarySheet, groupSum, monthLabel, periodOf, TONES,
  type XlColumn, type XlTone, type XlType, type SummarySection,
} from "@/lib/excelStyle";
import { logoPng } from "@/lib/excelLogo";

const MONEY = /amount|value|payment|charges?$|daala/i;

function typeOf(c: SheetColumn): XlType {
  if (c.type === "date") return "date";
  if (c.type !== "number") return "text";
  if (c.key === "srNo") return "int";
  if (/pct$/i.test(c.key)) return "pct100";
  if (c.unit === "kg" || /weight/i.test(c.key) || /\(kg\)/i.test(c.label)) return "kg";
  if (MONEY.test(c.key) || c.key === "rate" || /rate$/i.test(c.key)) return "money";
  return "number";
}

function totalled(c: SheetColumn): boolean {
  return c.type === "number" && !/^srNo$|rate$|pct$|allowance$/i.test(c.key) && c.key !== "rate";
}

const STATUS_TEXT: Record<LockState, string> = { draft: "Draft", submitted: "Submitted", frozen: "Frozen", unlocked: "Unlocked" };
const STATUS_TONE: Record<LockState, XlTone> = { draft: TONES.grey, submitted: TONES.blue, frozen: TONES.indigo, unlocked: TONES.amber };

const fileName = (v: unknown) => {
  const s = String(v ?? "");
  const i = s.indexOf("::");
  return i > 0 ? s.slice(i + 2) || "Attached" : s;
};

export async function buildPlantSheetWorkbook(ExcelJS: any, input: {
  kind: "biomass" | "transport";
  plantName: string;
  plantLocation?: string;
  columns: SheetColumn[];
  rows: Record<string, any>[];
  generatedBy: string;
  filterNote?: string;
}): Promise<Buffer> {
  const { kind, columns } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria Private Limited";
  wb.company = "Biome Industria Private Limited";
  wb.created = new Date();
  const logoId = addLogo(wb, logoPng());

  // Original letter → key, so the plant's own formulas can be re-pointed.
  const keyOfCell = new Map(columns.map((c) => [c.cell, c.key]));
  const now = new Date();

  const rows = input.rows.map((r) => {
    const o: Record<string, any> = computeRow(columns, r);
    for (const c of columns) if (c.kind === "upload") o[c.key] = fileName(r[c.key]);
    const lock = lockInfo(r, now);
    o.__status = STATUS_TEXT[lock.state];
    o.__state = lock.state;
    o.__submitted = r.submittedAt ? String(r.submittedAt).slice(0, 10) : "";
    if (kind === "transport") {
      const a = Number(r.weight) || 0;
      const b = Number(r.rWeight) || 0;
      o.__short = a && b ? a - b : null;
    }
    return o;
  });

  const xcols: XlColumn[] = columns.map((c) => ({
    key: c.key,
    header: c.label,
    type: c.kind === "upload" ? "text" : typeOf(c),
    total: totalled(c),
    width: c.kind === "upload" ? 18 : undefined,
    note: c.hint,
    formula: c.kind === "derived" && c.formula
      ? (row, letterOf) =>
          c.formula!.replace(/\b([A-Z]{1,2})\{row\}/g, (_m, L: string) => {
            const k = keyOfCell.get(L);
            return `${k ? letterOf(k) : L}${row}`;
          }).replace(/\{row\}/g, String(row))
      : undefined,
  }));
  if (kind === "transport") {
    xcols.splice(xcols.findIndex((c) => c.key === "actualWeight") + 1, 0, {
      key: "__short", header: "Short (kg)", type: "kg", total: true,
      note: "Dispatch weight minus receiving weight. Red = the client received less.",
    });
  }
  xcols.push({ key: "__status", header: "Status", type: "text", width: 12 });
  xcols.push({ key: "__submitted", header: "Submitted On", type: "date", width: 13 });

  const sheetTitle = kind === "transport" ? "Transport Sheet — Vehicle Dispatch Register" : "Biomass Sheet — Raw Material Purchase Register";
  const meta = {
    title: sheetTitle,
    plant: `${input.plantName}${input.plantLocation ? `, ${input.plantLocation}` : ""}`,
    period: periodOf(rows.map((r) => r.date)),
    generatedBy: input.generatedBy,
    note: [input.filterNote, `${rows.length} consignment${rows.length === 1 ? "" : "s"}`, "All weights in kg", "Lighter-green headings are live formulas"]
      .filter(Boolean).join("   ·   "),
  };

  const { ws } = buildTableSheet(wb, kind === "transport" ? "Transport" : "Biomass", {
    meta,
    columns: xcols,
    rows,
    logoId,
    freezeCols: 2,
    footerLeft: `${input.plantName} — ${kind === "transport" ? "Transport" : "Biomass"} sheet`,
    cellTone: (key, value, row) => {
      if (key === "__status") return STATUS_TONE[row.__state as LockState] || null;
      if (key === "__short" && Number(value) > 0) return TONES.red;
      if (key === "netWeight" && Number(value) <= 0 && (row.grossWeight || row.tareWeight)) return TONES.red;
      return null;
    },
  });
  // Formula columns get a faint green header tint underline so they read as "worked out".
  xcols.forEach((c, i) => {
    if (!c.formula) return;
    const cell = ws.getRow(ws.views[0].ySplit).getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F7A4C" } };
  });

  // ---- Summary ----
  const sections: SummarySection[] = [];
  if (kind === "biomass") {
    const nameKey = columns.some((c) => c.key === "vendorName") ? "vendorName" : "name";
    const weightKeys = ["grossWeight", "netWeight", "payableWeight", "finalWeight"].filter((k) => columns.some((c) => c.key === k));
    const moneyKeys = ["amount", "netPayableAmount", "finalAmount", "finalBiomassValue"].filter((k) => columns.some((c) => c.key === k));
    const label = (k: string) => columns.find((c) => c.key === k)?.label || k;
    const metricCols: XlColumn[] = [
      { key: "count", header: "Consignments", type: "int", total: true },
      ...weightKeys.map((k) => ({ key: k, header: label(k), type: "kg" as XlType, total: true })),
      ...moneyKeys.map((k) => ({ key: k, header: label(k), type: "money" as XlType, total: true })),
    ];
    const byVendor = groupSum(
      rows,
      (r) => `${String(r.vendorCode || "").toUpperCase()}|${String(r[nameKey] || "").trim().toUpperCase()}`,
      [...weightKeys, ...moneyKeys],
      (r) => ({ code: String(r.vendorCode || "").toUpperCase() || "—", vname: String(r[nameKey] || "").trim() || "—" })
    ).sort((a, b) => (b[moneyKeys[moneyKeys.length - 1]] || 0) - (a[moneyKeys[moneyKeys.length - 1]] || 0));
    sections.push({
      title: "By vendor",
      columns: [{ key: "vname", header: "Vendor Name" }, { key: "code", header: "Vendor Code" }, ...metricCols],
      rows: byVendor,
    });
    const byMonth = groupSum(rows, (r) => String(r.date || "").slice(0, 7), [...weightKeys, ...moneyKeys])
      .sort((a, b) => a.group.localeCompare(b.group))
      .map((g) => ({ ...g, month: monthLabel(g.group) }));
    sections.push({ title: "By month", columns: [{ key: "month", header: "Month" }, ...metricCols], rows: byMonth });
  } else {
    const keys = ["weight", "rWeight", "actualWeight", "__short", "amount"];
    const metricCols: XlColumn[] = [
      { key: "count", header: "Trips", type: "int", total: true },
      { key: "weight", header: "Dispatch Wt (kg)", type: "kg", total: true },
      { key: "rWeight", header: "Received Wt (kg)", type: "kg", total: true },
      { key: "actualWeight", header: "Freight Wt (kg)", type: "kg", total: true },
      { key: "__short", header: "Short (kg)", type: "kg", total: true },
      { key: "amount", header: "Freight Amount", type: "money", total: true },
    ];
    const byT = groupSum(
      rows,
      (r) => `${String(r.transporterCode || "").toUpperCase()}|${String(r.transporter || "").trim().toUpperCase()}`,
      keys,
      (r) => ({ code: String(r.transporterCode || "").toUpperCase() || "—", tname: String(r.transporter || "").trim() || "—" })
    ).sort((a, b) => b.amount - a.amount);
    sections.push({ title: "By transporter", columns: [{ key: "tname", header: "Transporter" }, { key: "code", header: "Code" }, ...metricCols], rows: byT });
    const byParty = groupSum(rows, (r) => String(r.partyName || "").trim() || "—", keys).sort((a, b) => b.weight - a.weight);
    sections.push({ title: "By party (client)", columns: [{ key: "group", header: "Party" }, ...metricCols], rows: byParty });
    const byMonth = groupSum(rows, (r) => String(r.date || "").slice(0, 7), keys)
      .sort((a, b) => a.group.localeCompare(b.group))
      .map((g) => ({ ...g, month: monthLabel(g.group) }));
    sections.push({ title: "By month", columns: [{ key: "month", header: "Month" }, ...metricCols], rows: byMonth });
  }
  const states = groupSum(rows, (r) => r.__status, []).map((g) => ({ ...g }));
  sections.push({
    title: "By status",
    columns: [{ key: "group", header: "Status" }, { key: "count", header: "Rows", type: "int", total: true }],
    rows: states,
  });
  buildSummarySheet(wb, "Summary", { ...meta, title: `${sheetTitle} — Summary` }, sections, logoId);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
