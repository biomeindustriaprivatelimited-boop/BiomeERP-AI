import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { plantOptions } from "@/lib/plants";
import { loadStock, saveStock, indentStatus, URGENCY_LABEL } from "@/lib/stock";
import { stockCtx, str, buildIndent } from "@/lib/spares";

/**
 * The plant's side of spare parts: raise a requirement, follow it.
 *
 * Needs `stock.indent`. Someone without `stock.manage` / `stock.view` is
 * pinned to the plant of their SESSION. What comes back is deliberately
 * thin: part names, quantities, status, PO number and expected date — no
 * rates, no values, no vendor, no stock balances (those are procurement's).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock.indent");
  if ("response" in c) return c.response;
  const s = loadStock();
  const indents = s.indents
    .filter((i) => c.plants.includes(i.plant))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => {
      const st = indentStatus(s, i);
      return {
        id: i.id, no: i.no, plant: i.plant, date: i.date, requiredBy: i.requiredBy, urgency: i.urgency, reason: i.reason,
        machineId: i.machineId, lines: i.lines, raisedByName: i.raisedByName, decisionNote: i.decisionNote, decidedByName: i.decidedByName,
        state: i.state, mine: i.raisedBy === c.user.id, status: { code: st.code, label: st.label, pos: st.pos },
      };
    });
  return NextResponse.json({
    indents,
    plants: plantOptions().filter((p) => c.plants.includes(p.code)),
    myPlant: c.session.plant || "",
    machines: s.machines.filter((m) => m.active && c.plants.includes(m.plant)).map((m) => ({ id: m.id, code: m.code, name: m.name, plant: m.plant, section: m.section })),
    items: s.items.filter((i) => i.active).map((i) => ({ id: i.id, code: i.code, name: i.name, partNo: i.partNo, unit: i.unit, machineIds: i.machineIds })),
    urgencyLabels: URGENCY_LABEL,
  });
}

export async function POST(req: NextRequest) {
  const c = await stockCtx(req, "stock.indent");
  if ("response" in c) return c.response;
  const body = await req.json().catch(() => null);
  const s = loadStock();
  const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });
  const action = str(body?.action, 30) || "create";

  if (action === "create") {
    const r = buildIndent(s, body, c.plants, c.user);
    if ("error" in r) return deny(r.error, 400);
    s.indents.push(r.indent);
    saveStock(s);
    recordAudit({ action: "INDENT_RAISED", userId: c.user.id, userName: c.user.name, role: c.user.role, plant: r.indent.plant, targetType: "spare_purchase", targetId: r.indent.id, targetLabel: r.indent.no, detail: `${r.indent.lines.length} line(s) · ${r.indent.urgency}` });
    return NextResponse.json({ indent: { id: r.indent.id, no: r.indent.no } }, { status: 201 });
  }

  if (action === "withdraw") {
    const ind = s.indents.find((i) => i.id === body?.id);
    if (!ind || !c.plants.includes(ind.plant)) return deny("Requirement not found.", 404);
    if (ind.raisedBy !== c.user.id && !c.manage) return deny("Only the person who raised it can withdraw it.");
    if (ind.state !== "open" || ind.poIds.length) return deny("Procurement has already acted on this requirement — ask them to cancel it.", 409);
    ind.state = "withdrawn"; ind.decisionNote = str(body?.note, 200) || "Withdrawn by the plant"; ind.decidedByName = c.user.name; ind.decidedAt = new Date().toISOString();
    saveStock(s);
    recordAudit({ action: "INDENT_WITHDRAWN", userId: c.user.id, userName: c.user.name, role: c.user.role, plant: ind.plant, targetType: "spare_purchase", targetId: ind.id, targetLabel: ind.no });
    return NextResponse.json({ ok: true });
  }

  return deny("Unknown action.", 400);
}
