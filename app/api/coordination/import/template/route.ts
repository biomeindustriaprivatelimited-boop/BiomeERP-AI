import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { buildTemplate } from "@/lib/coordinationImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// createRequire() is special-cased by webpack and cannot load files by
// absolute path from a server bundle; the runtime require can.
const nodeRequire: NodeRequire = eval("require");

/**
 * The app's own Excel template for importing previous working data into
 * the coordination register. Built fresh on every download, so its
 * vendor / plant / client lists are the ones registered today.
 */
export async function GET(req: NextRequest) {
  // Whoever can add a trip can import trips, and so can fetch the template.
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json({ error: "Run `npm install` in the project folder, then try again." }, { status: 500 });
  }

  const buffer = await buildTemplate(ExcelJS);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Biome-Coordination-Import-Template.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
