import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { resolvePlantScope } from "@/lib/plantScope";
import { sheetPlant } from "@/lib/plantRegistry";
import { TRANSPORT_COLUMNS } from "@/lib/plantSheets";
import { isEntryRole, canUnlock } from "@/lib/plantSheetStore";
import { buildSheetTemplate, plantPartners } from "@/lib/plantSheetImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// createRequire() is special-cased by webpack and cannot load files by
// absolute path from a server bundle; the runtime require can.
const nodeRequire: NodeRequire = eval("require");

/**
 * The import template for one plant's biomass or transport sheet. Built
 * fresh on every download, so its columns are that plant's columns and
 * its vendor / transporter list is the one registered for that plant today.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
  if ("response" in scoped) return scoped.response;
  const user = findById(scoped.scope.userId);
  if (!(isEntryRole(scoped.scope.role) || canUnlock(user))) {
    return NextResponse.json({ error: "Only the plant manager, accounts, admin or the developer import plant sheets." }, { status: 403 });
  }
  const plant = sheetPlant(scoped.scope.slug);
  if (!plant) return NextResponse.json({ error: "That plant is not in the plant master." }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind") === "transport" ? "transport" : "biomass";

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json({ error: "Run `npm install` in the project folder, then try again." }, { status: 500 });
  }
  const buffer = await buildSheetTemplate(ExcelJS, {
    kind,
    plantName: plant.name,
    columns: kind === "transport" ? TRANSPORT_COLUMNS : plant.biomass,
    partners: plantPartners(scoped.scope.slug),
    generatedBy: scoped.scope.userName,
  });
  const name = `${plant.name} - ${kind === "transport" ? "Transport" : "Biomass"} Import Template.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
