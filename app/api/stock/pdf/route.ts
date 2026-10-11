import { NextRequest, NextResponse } from "next/server";
import { loadStock } from "@/lib/stock";
import { stockCtx, poPdf, pdfResponse, poFileName } from "@/lib/spares";

/** GET ?po=<id> — the spare-part PO as a PDF with the Biome letterhead (procurement). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const s = loadStock();
  const po = s.pos.find((p) => p.id === req.nextUrl.searchParams.get("po"));
  if (!po || !c.plants.includes(po.plant)) return NextResponse.json({ error: "PO not found." }, { status: 404 });
  return pdfResponse(poPdf(po, s), poFileName(po.no || `DRAFT-${po.id.slice(0, 8)}`));
}
