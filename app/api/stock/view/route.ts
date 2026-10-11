import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";
import { loadStock, poView, grnMatch, stockRows, PO_STATUS_LABEL } from "@/lib/stock";
import { stockCtx, poPdf, pdfResponse, poFileName, spendWorkbook, xlsxResponse, isoDate, today, vendorSpend, machineSpend } from "@/lib/spares";

/**
 * Read-only spare-part purchases for accounts (`stock.view`).
 *
 *   GET                         POs with values and received value, GRNs,
 *                               stock value per plant, vendor/machine spend
 *   GET ?pdf=<poId>             the PO PDF
 *   GET ?xlsx=vendor|machine    spend workbook
 *
 * GET only — nothing here can change stock, a PO or a GRN.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock.view");
  if ("response" in c) return c.response;
  const s = loadStock();
  const p = req.nextUrl.searchParams;
  const plant = p.get("plant");
  const plants = plant && c.plants.includes(plant) ? [plant] : c.plants;

  const pdfId = p.get("pdf");
  if (pdfId) {
    const po = s.pos.find((x) => x.id === pdfId);
    if (!po || !plants.includes(po.plant) || po.state === "draft") return NextResponse.json({ error: "PO not found." }, { status: 404 });
    return pdfResponse(poPdf(po, s), poFileName(po.no));
  }
  const filter = { from: isoDate(p.get("from")), to: isoDate(p.get("to")), plants };
  const xl = p.get("xlsx");
  if (xl) return xlsxResponse(await spendWorkbook(xl === "machine" ? "machine" : "vendor", s, filter, c.user.name), `Spares-${xl === "machine" ? "machine" : "vendor"}-wise-spend-${today()}.xlsx`);

  // Drafts are procurement's working papers; accounts see what was issued.
  const pos = s.pos.filter((x) => plants.includes(x.plant) && x.state !== "draft").map((x) => poView(s, x)).sort((a, b) => b.date.localeCompare(a.date));
  const grns = s.grns.filter((g) => plants.includes(g.plant) && g.state === "final").sort((a, b) => b.date.localeCompare(a.date)).map((g) => {
    const po = s.pos.find((x) => x.id === g.poId);
    const match = po ? grnMatch(s, po, g) : null;
    const value = match ? match.lines.reduce((t, l) => {
      const pl = po!.lines.find((x) => x.id === l.poLineId);
      const taxable = l.acceptedQty * l.invoiceRate;
      return t + taxable * (1 + (pl?.gstPct || 0) / 100);
    }, 0) : 0;
    return { id: g.id, no: g.no, poNo: g.poNo, plant: g.plant, vendorName: g.vendorName, date: g.date, invoiceNo: g.invoiceNo, invoiceDate: g.invoiceDate, challanNo: g.challanNo, finalByName: g.finalByName, value: Math.round(value * 100) / 100, flags: match ? Array.from(new Set(match.lines.flatMap((l) => l.flags).filter((f) => f !== "ok"))) : [], matchNote: g.matchNote };
  });
  const rows = stockRows(s, plants);
  const byPlant = plants.map((pc) => ({ plant: pc, value: Math.round(rows.filter((r) => r.plant === pc).reduce((t, r) => t + r.value, 0)) }));
  return NextResponse.json({
    plants: plantOptions().filter((x) => c.plants.includes(x.code)),
    pos, grns, byPlant, statusLabels: PO_STATUS_LABEL,
    vendorSpend: vendorSpend(s, filter).summary,
    machineSpend: machineSpend(s, filter).summary,
  });
}
