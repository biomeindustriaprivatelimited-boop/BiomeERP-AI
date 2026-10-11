import { NextRequest } from "next/server";
import { loadStock } from "@/lib/stock";
import { stockCtx, spendWorkbook, xlsxResponse, isoDate, today } from "@/lib/spares";

/** GET ?kind=vendor|machine&from=&to=&plant= — spend workbook (procurement). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind") === "machine" ? "machine" : "vendor";
  const plant = p.get("plant");
  const plants = plant && c.plants.includes(plant) ? [plant] : c.plants;
  const buf = await spendWorkbook(kind, loadStock(), { from: isoDate(p.get("from")), to: isoDate(p.get("to")), plants }, c.user.name);
  return xlsxResponse(buf, `Spares-${kind}-wise-spend-${today()}.xlsx`);
}
