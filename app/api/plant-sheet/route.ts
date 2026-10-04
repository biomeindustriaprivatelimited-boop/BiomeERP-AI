import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  TRANSPORT_COLUMNS,
  type SheetColumn,
  type PlantId,
} from "@/lib/plantSheets";
import { sheetPlant, sheetPlants } from "@/lib/plantRegistry";
import { resolvePlantScope } from "@/lib/plantScope";
import { loadPlants } from "@/lib/plants";
import { slugForCode } from "@/lib/plantRegistry";
import fs from "fs";
import path from "path";

/**
 * Export a biomass or transport sheet.
 *
 * Derived columns are written as REAL Excel formulas, not as the numbers
 * the app worked out. That matters: the plant manager opens the export,
 * corrects a gross weight, and every dependent figure updates the way it
 * does in the sheet they already use. Exporting frozen values would
 * hand them a dead document.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire: NodeRequire = eval("require");

interface ExportRequest {
  kind: "biomass" | "transport";
  plant?: PlantId;
  rows?: Record<string, any>[];
  /** Restrict to one vendor — "kisi bhi biomass vendor ka data". */
  vendorCode?: string;
  title?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  let body: ExportRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // The export is scoped like everything else — otherwise a manager could
  // simply download the other plant's book instead of reading it on screen.
  const scoped = await resolvePlantScope(req, body.plant);
  if ("response" in scoped) return scoped.response;
  const plant = sheetPlant(scoped.scope.slug);
  if (!plant) return NextResponse.json({ error: "That plant is not in the plant master." }, { status: 404 });
  const columns: SheetColumn[] =
    body.kind === "transport" ? TRANSPORT_COLUMNS : plant.biomass;

  let rows = Array.isArray(body.rows) ? body.rows : [];
  if (body.vendorCode) {
    const want = String(body.vendorCode).trim().toUpperCase();
    rows = rows.filter(
      (r) => String(r.vendorCode ?? "").trim().toUpperCase() === want
    );
  }

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json(
      { error: "Run `npm install exceljs` in the project folder, then try again." },
      { status: 500 }
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Biome Industria Private Limited";
  workbook.created = new Date();

  const sheetName =
    body.kind === "transport" ? "TRANSPORT" : `BIOMASS ${plant.name.toUpperCase()}`;
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));

  // ---- Letterhead: company, plant, sheet title — above the plant's own columns ----
  const colIndex = (letters: string) => letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  const colLetter = (n: number) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const idx = Array.from(new Set(columns.map((c) => colIndex(c.cell)))).sort((a, b) => a - b);
  // The main block of columns (a few sit far to the right on purpose — the
  // heading spans the block people actually read).
  let lastIdx = idx[0];
  for (const n of idx) { if (n - lastIdx > 1) break; lastIdx = n; }
  const firstCol = colLetter(idx[0]);
  const lastCol = colLetter(lastIdx);
  const master = loadPlants().find((p) => slugForCode(p.code) === scoped.scope.slug);
  const dates = rows.map((r) => String(r.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const fmt = (d: string) => d.split("-").reverse().join("-");
  const title = body.kind === "transport" ? "TRANSPORT SHEET — VEHICLE DISPATCH REGISTER" : "BIOMASS SHEET — RAW MATERIAL PURCHASE REGISTER";
  const lines: { text: string; size: number; bold: boolean; color: string; fill?: string; height: number }[] = [
    { text: "BIOME INDUSTRIA PRIVATE LIMITED", size: 18, bold: true, color: "FFFFFFFF", fill: "FF1F5130", height: 32 },
    { text: `${plant.name.toUpperCase()}${master?.location ? `  ·  ${master.location}` : ""}`, size: 12, bold: true, color: "FF1F5130", fill: "FFE8F0E3", height: 22 },
    {
      text: `${title}${body.vendorCode ? `  ·  Vendor ${String(body.vendorCode).toUpperCase()}` : ""}${dates.length ? `  ·  ${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}` : ""}`,
      size: 11, bold: true, color: "FF2E2E2E", height: 20,
    },
    { text: `All weights in kg  ·  Exported ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${scoped.scope.userName}`, size: 9, bold: false, color: "FF6B7280", height: 16 },
  ];
  lines.forEach((l, i) => {
    const r = i + 1;
    if (lastCol !== firstCol) sheet.mergeCells(`${firstCol}${r}:${lastCol}${r}`);
    const cell = sheet.getCell(`${firstCol}${r}`);
    cell.value = l.text;
    cell.font = { name: "Calibri", size: l.size, bold: l.bold, color: { argb: l.color } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    if (l.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.fill } };
    sheet.getRow(r).height = l.height;
  });
  // Company logo in the corner of the first line, when the file is there.
  try {
    const logo = path.join(process.cwd(), "public", "assets", "logo.png");
    if (fs.existsSync(logo)) {
      const id = workbook.addImage({ buffer: fs.readFileSync(logo), extension: "png" });
      sheet.addImage(id, { tl: { col: idx[0] - 1 + 0.1, row: 0.1 }, ext: { width: 40, height: 40 } });
    }
  } catch { /* the heading reads fine without it */ }
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:5", paperSize: 9 };
  sheet.headerFooter = { oddFooter: `&L${plant.name} — ${body.kind === "transport" ? "Transport" : "Biomass"} sheet&RPage &P of &N` };

  // ---- Header row, at the plant's own column letters ----
  const HEADER_ROW = 5;
  for (const col of columns) {
    const cell = sheet.getCell(`${col.cell}${HEADER_ROW}`);
    cell.value = col.label;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F7D4E" } };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
    sheet.getColumn(col.cell).width = Math.max(10, Math.round((col.width || 110) / 8));
  }
  sheet.getRow(HEADER_ROW).height = 36;
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];

  // ---- Data ----
  rows.forEach((row, i) => {
    const r = HEADER_ROW + 1 + i;
    for (const col of columns) {
      const cell = sheet.getCell(`${col.cell}${r}`);

      if (col.kind === "derived" && col.formula) {
        // A live formula, so the exported sheet recalculates like theirs.
        cell.value = { formula: col.formula.replace(/\{row\}/g, String(r)).replace(/^=/, "") };
      } else if (col.type === "number") {
        const n = Number(row[col.key]);
        cell.value = Number.isFinite(n) && row[col.key] !== "" ? n : null;
      } else {
        cell.value = row[col.key] ?? null;
      }

      if (col.type === "number") cell.numFmt = "#,##0.00";
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      cell.alignment = { vertical: "middle", horizontal: col.type === "number" ? "right" : "left" };
      // Zebra rows, so a long register reads across without a ruler.
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F9F4" } };
    }
  });

  // ---- Totals, also as formulas ----
  if (rows.length) {
    const totalRow = HEADER_ROW + 1 + rows.length;
    const first = HEADER_ROW + 1;
    const last = totalRow - 1;
    for (const col of columns) {
      if (col.type !== "number" || col.key === "srNo" || /pct|allowance|rate/i.test(col.key)) continue;
      const cell = sheet.getCell(`${col.cell}${totalRow}`);
      cell.value = { formula: `SUM(${col.cell}${first}:${col.cell}${last})` };
      cell.font = { bold: true };
      cell.numFmt = "#,##0.00";
      cell.border = { top: { style: "double" }, bottom: { style: "thin" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E3" } };
    }
    const label = sheet.getCell(`${columns[0].cell}${totalRow}`);
    label.value = "TOTAL";
    label.font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const who = body.vendorCode ? ` - ${body.vendorCode}` : "";
  // The plant goes in the filename. Two managers exporting the same month
  // otherwise produce two identically named files, and whichever lands in
  // the folder second silently replaces the first.
  const name = `${plant.name} - ${sheetName}${who} - ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(
    /[\\/:*?"<>|]/g,
    "-"
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** The schemas, so the UI can build its grid from the same definition. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  const kind = req.nextUrl.searchParams.get("kind") || "biomass";

  const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
  if ("response" in scoped) return scoped.response;
  const plant = sheetPlant(scoped.scope.slug);
  if (!plant) return NextResponse.json({ error: "That plant is not in the plant master." }, { status: 404 });

  // A field role is offered ONE plant in the switcher — theirs. Listing both
  // and refusing the other would still tell them the other one is there.
  const offered = scoped.scope.unrestricted ? sheetPlants() : [plant];

  return NextResponse.json({
    plants: offered.map((p) => ({
      id: p.id, name: p.name, state: p.state, code: p.code, layout: p.layout,
    })),
    lockedToPlant: !scoped.scope.unrestricted,
    kind,
    plant: { id: plant.id, name: plant.name, state: plant.state, code: plant.code, layout: plant.layout },
    columns: (kind === "transport" ? TRANSPORT_COLUMNS : plant.biomass).map((c) => ({
      cell: c.cell, key: c.key, label: c.label, kind: c.kind,
      type: c.type || "text", width: c.width, hint: c.hint,
      suggest: c.suggest, suggestField: c.suggestField, pairKey: c.pairKey,
    })),
  });
}
