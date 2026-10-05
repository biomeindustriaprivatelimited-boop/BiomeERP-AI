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
import { readRows } from "@/lib/plantSheetStore";
import { buildPlantSheetWorkbook } from "@/lib/plantSheetExcel";

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
  /** Ignored — the export reads the stored rows. Kept for old callers. */
  rows?: Record<string, any>[];
  /** Restrict to one vendor (transporter on the transport sheet). */
  vendorCode?: string;
  from?: string;
  to?: string;
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

  // The plant's rows as stored — the server's copy, never the browser's, so
  // the file carries each row's real submit / freeze status.
  let rows: Record<string, any>[] = readRows(body.kind === "transport" ? "transport" : "biomass", scoped.scope.slug);
  const notes: string[] = [];
  if (body.vendorCode) {
    const want = String(body.vendorCode).trim().toUpperCase();
    const field = body.kind === "transport" ? "transporterCode" : "vendorCode";
    rows = rows.filter((r) => String(r[field] ?? "").trim().toUpperCase().includes(want));
    notes.push(`${body.kind === "transport" ? "Transporter" : "Vendor"} code: ${want}`);
  }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || "")) ? String(body.from) : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || "")) ? String(body.to) : "";
  if (from) rows = rows.filter((r) => String(r.date || "").slice(0, 10) >= from);
  if (to) rows = rows.filter((r) => String(r.date || "").slice(0, 10) <= to);

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json(
      { error: "Run `npm install exceljs` in the project folder, then try again." },
      { status: 500 }
    );
  }

  const master = loadPlants().find((p) => slugForCode(p.code) === scoped.scope.slug);
  const buffer = await buildPlantSheetWorkbook(ExcelJS, {
    kind: body.kind === "transport" ? "transport" : "biomass",
    plantName: plant.name,
    plantLocation: master?.location || plant.state,
    columns,
    rows,
    generatedBy: scoped.scope.userName,
    filterNote: notes.join("   ·   "),
  });

  const sheetName = body.kind === "transport" ? "Transport Sheet" : "Biomass Sheet";
  const who = body.vendorCode ? ` - ${String(body.vendorCode).toUpperCase()}` : "";
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
      suggest: c.suggest, suggestField: c.suggestField, pairKey: c.pairKey, required: !!c.required,
    })),
  });
}
