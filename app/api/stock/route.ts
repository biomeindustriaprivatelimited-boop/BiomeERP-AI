import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";
import { recordAudit } from "@/lib/audit";
import {
  loadStock, saveStock, nextNo, newId, computeBalances, balanceOf, stockRows, machineUsage, isLive,
  poView, grnMatch, indentStatus, pmDue,
  ITEM_CATEGORIES, UNITS, MOVEMENT_LABEL, SIGN, URGENCY_LABEL, MAINT_LABEL, PO_STATUS_LABEL,
  StockItem, Machine, Movement, MovementType,
} from "@/lib/stock";
import { stockCtx, stockVendors, str, num, today } from "@/lib/spares";

/**
 * Spare parts & machinery — procurement's module.
 *
 * `stock`          the module: dashboard, stock, issue to machine, return,
 *                  masters, requirements, POs, GRNs, maintenance.
 * `stock.manage`   every plant, editing masters, adjustments, transfers,
 *                  cancellations.
 * `stock.approve`  approves adjustments (an adjustment by anyone else
 *                  waits and does not touch the balance until approved).
 *
 * Receipts are no longer typed in directly: stock comes in only when a
 * GRN against an issued PO is matched and made FINAL (/api/stock/purchase).
 * Opening stock is an adjustment (+) with its reason.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const s = loadStock();
  const plantFilter = req.nextUrl.searchParams.get("plant");
  const plants = plantFilter && c.plants.includes(plantFilter) ? [plantFilter] : c.plants;

  const rows = stockRows(s, plants);
  const machines = s.machines.filter((m) => plants.includes(m.plant));
  const movements = s.movements
    .filter((m) => plants.includes(m.plant))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
    .slice(0, 1500);
  const usage = machineUsage(s, plants);
  const month = today().slice(0, 7);
  const monthIssues = s.movements.filter((m) => isLive(m) && m.type === "issue" && plants.includes(m.plant) && m.date.startsWith(month));
  const bal = computeBalances(s.movements);

  const pos = s.pos.filter((p) => plants.includes(p.plant)).map((p) => poView(s, p)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const grns = s.grns.filter((g) => plants.includes(g.plant)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((g) => {
    const po = s.pos.find((p) => p.id === g.poId);
    return { ...g, match: po ? grnMatch(s, po, g) : null };
  });
  const indents = s.indents.filter((i) => plants.includes(i.plant)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => ({ ...i, status: indentStatus(s, i) }));
  const mById = new Map(s.machines.map((m) => [m.id, m]));
  const schedules = s.schedules.filter((x) => plants.includes(x.plant)).map((x) => ({ ...x, due: pmDue(x, mById.get(x.machineId)) }));
  const maintenance = s.maintenance.filter((l) => plants.includes(l.plant)).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 800);
  const inTransit = s.movements.filter((m) => !m.cancelled && m.inTransit && plants.includes(m.plant));
  const pendingAdjust = s.movements.filter((m) => !m.cancelled && m.approval === "pending" && plants.includes(m.plant));

  return NextResponse.json({
    items: s.items,
    attachments: Object.fromEntries(Object.entries(s.attachments)
      .filter(([no]) => movements.some((m) => m.no === no) || grns.some((g) => g.no === no))
      .map(([no, list]) => [no, list.map(({ file: _f, ...a }) => a)])),
    machines,
    movements,
    rows,
    usage: usage.byMachine,
    vendors: stockVendors().filter((v) => !v.plants.length || v.plants.some((p) => plants.includes(p))),
    plants: plantOptions().filter((p) => c.plants.includes(p.code)),
    allPlants: plantOptions(),
    myPlant: c.session.plant,
    canManage: c.manage,
    canApprove: c.approve,
    categories: ITEM_CATEGORIES,
    units: UNITS,
    movementLabels: MOVEMENT_LABEL,
    urgencyLabels: URGENCY_LABEL,
    maintLabels: MAINT_LABEL,
    poStatusLabels: PO_STATUS_LABEL,
    pos, grns, indents, schedules, maintenance,
    summary: {
      items: s.items.filter((i) => i.active).length,
      machines: machines.filter((m) => m.active).length,
      value: Math.round(rows.reduce((t, r) => t + r.value, 0)),
      low: rows.filter((r) => r.status === "low").length,
      out: rows.filter((r) => r.status === "out" && r.minLevel > 0).length,
      issuedThisMonth: Math.round(monthIssues.reduce((t, m) => t + m.qty * (m.rate || balanceOf(bal, m.itemId, m.plant).avgRate), 0)),
      openIndents: indents.filter((i) => i.status.code === "open" || i.status.code === "approved").length,
      urgentIndents: indents.filter((i) => (i.status.code === "open" || i.status.code === "approved") && i.urgency !== "normal").length,
      openPos: pos.filter((p) => p.status === "issued" || p.status === "partial").length,
      overduePos: pos.filter((p) => p.overdue).length,
      draftPos: pos.filter((p) => p.status === "draft").length,
      openPoValue: Math.round(pos.filter((p) => p.status === "issued" || p.status === "partial").reduce((t, p) => t + p.totals.total - p.receivedValue, 0)),
      pendingGrns: grns.filter((g) => g.state === "draft").length,
      maintenanceDue: schedules.filter((x) => x.active && x.due.status === "due").length,
      maintenanceOverdue: schedules.filter((x) => x.active && x.due.status === "overdue").length,
      inTransit: new Set(inTransit.map((m) => m.no)).size,
      pendingAdjust: new Set(pendingAdjust.map((m) => m.no)).size,
    },
  });
}

export async function POST(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const { user } = c;
  const body = await req.json().catch(() => null);
  const action = str(body?.action, 40);
  const s = loadStock();
  const now = new Date().toISOString();
  const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });

  /* ---------------- Item master ---------------- */
  if (action === "item.save") {
    const name = str(body?.name);
    if (!name) return deny("Give the part a name.", 400);
    const existing = body?.id ? s.items.find((i) => i.id === body.id) : null;
    if (existing && !c.manage) return deny("Editing an item needs Plant stock — manage (procurement / stores).");
    const partNo = str(body?.partNo, 60);
    const clash = s.items.find((i) => i.id !== existing?.id && i.active && (
      (partNo && i.partNo.toLowerCase() === partNo.toLowerCase()) ||
      (!partNo && i.name.toLowerCase() === name.toLowerCase())
    ));
    if (clash) return deny(`Already in the item master as ${clash.code} · ${clash.name}.`, 409);
    const minLevel: Record<string, number> = {};
    if (body?.minLevel && typeof body.minLevel === "object") {
      for (const [k, v] of Object.entries(body.minLevel)) if (num(v) > 0) minLevel[k === "all" ? "" : k] = num(v);
    }
    const item: StockItem = {
      id: existing?.id || newId(),
      code: existing?.code || nextNo(s, "SP"),
      name, partNo,
      category: str(body?.category, 40) || "Spare part",
      unit: str(body?.unit, 12) || "Nos",
      make: str(body?.make, 80),
      specification: str(body?.specification, 300),
      minLevel,
      machineIds: Array.isArray(body?.machineIds) ? body.machineIds.map(String).filter((id: string) => s.machines.some((m) => m.id === id)) : [],
      rack: str(body?.rack, 40),
      bins: (() => {
        const out: Record<string, string> = {};
        if (body?.bins && typeof body.bins === "object") for (const [k, v] of Object.entries(body.bins)) if (str(v, 40)) out[str(k, 10).toUpperCase()] = str(v, 40);
        return out;
      })(),
      active: body?.active === false ? false : true,
      createdAt: existing?.createdAt || now,
      createdByName: existing?.createdByName || user.name,
      updatedAt: now,
    };
    s.items = existing ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item];
    saveStock(s);
    recordAudit({ action: existing ? "STOCK_ITEM_EDITED" : "STOCK_ITEM_CREATED", userId: user.id, userName: user.name, role: user.role, targetType: "stock_item", targetId: item.id, targetLabel: `${item.code} ${item.name}` });
    return NextResponse.json({ item });
  }

  /* ---------------- Machine master ---------------- */
  if (action === "machine.save") {
    const name = str(body?.name);
    const plant = str(body?.plant, 10).toUpperCase();
    if (!name) return deny("Give the machine a name.", 400);
    if (!c.plants.includes(plant)) return deny("Choose one of your plants.", 400);
    const existing = body?.id ? s.machines.find((m) => m.id === body.id) : null;
    if (existing && !c.manage) return deny("Editing a machine needs Plant stock — manage.");
    const m: Machine = {
      id: existing?.id || newId(),
      code: existing?.code || nextNo(s, `MC-${plant}`),
      name, plant,
      section: str(body?.section, 60),
      make: str(body?.make, 60),
      model: str(body?.model, 60),
      serialNo: str(body?.serialNo, 60),
      installDate: /^\d{4}-\d{2}-\d{2}$/.test(str(body?.installDate, 10)) ? str(body.installDate, 10) : "",
      warrantyUpto: /^\d{4}-\d{2}-\d{2}$/.test(str(body?.warrantyUpto, 10)) ? str(body.warrantyUpto, 10) : "",
      capacity: str(body?.capacity, 60),
      runningHours: existing?.runningHours ?? Math.max(0, num(body?.runningHours)),
      hoursAt: existing?.hoursAt || (num(body?.runningHours) > 0 ? today() : ""),
      notes: str(body?.notes, 300),
      active: body?.active === false ? false : true,
      createdAt: existing?.createdAt || now,
      createdByName: existing?.createdByName || user.name,
    };
    s.machines = existing ? s.machines.map((x) => (x.id === m.id ? m : x)) : [...s.machines, m];
    saveStock(s);
    recordAudit({ action: existing ? "MACHINE_EDITED" : "MACHINE_CREATED", userId: user.id, userName: user.name, role: user.role, plant, targetType: "machine", targetId: m.id, targetLabel: `${m.code} ${m.name}` });
    return NextResponse.json({ machine: m });
  }

  /* ---------------- Running-hours meter reading ---------------- */
  if (action === "machine.hours") {
    const m = s.machines.find((x) => x.id === body?.id);
    if (!m || !c.plants.includes(m.plant)) return deny("Machine not found.", 404);
    const hours = num(body?.hours);
    if (hours < 0) return deny("Hours cannot be negative.", 400);
    if (hours < m.runningHours && !c.manage) return deny(`The meter cannot go back (last reading ${m.runningHours} h).`, 400);
    const before = m.runningHours;
    m.runningHours = hours; m.hoursAt = today();
    saveStock(s);
    recordAudit({ action: "MACHINE_HOURS", userId: user.id, userName: user.name, role: user.role, plant: m.plant, targetType: "machine", targetId: m.id, targetLabel: `${m.code} ${m.name}`, detail: `${before} → ${hours} h` });
    return NextResponse.json({ machine: m });
  }

  /* ---------------- Transfer arrives at the receiving plant ---------------- */
  if (action === "transfer.receive") {
    const no = str(body?.no, 40);
    const lines = s.movements.filter((m) => m.no === no && m.type === "transfer_in" && m.inTransit && !m.cancelled);
    if (!lines.length) return deny("Nothing in transit under that number.", 404);
    if (!c.plants.includes(lines[0].plant)) return deny("That plant is not yours.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(body?.date, 10)) ? str(body.date, 10) : today();
    for (const m of lines) { m.inTransit = false; m.receivedAt = now; m.receivedByName = user.name; m.date = date; }
    saveStock(s);
    recordAudit({ action: "STOCK_TRANSFER_RECEIVED", userId: user.id, userName: user.name, role: user.role, plant: lines[0].plant, targetType: "stock_movement", targetId: no, targetLabel: no });
    return NextResponse.json({ ok: true });
  }

  /* ---------------- Approve / reject an adjustment ---------------- */
  if (action === "adjust.decide") {
    if (!c.approve) return deny("Approving an adjustment needs Spare parts — approve (admin).");
    const no = str(body?.no, 40);
    const decision = body?.decision === "reject" ? "rejected" : "approved";
    const lines = s.movements.filter((m) => m.no === no && m.approval === "pending" && !m.cancelled);
    if (!lines.length) return deny("No pending adjustment under that number.", 404);
    if (!lines.every((m) => c.plants.includes(m.plant))) return deny("Not your plant.");
    if (decision === "approved") {
      const trial = s.movements.map((m) => (m.no === no && m.approval === "pending" ? { ...m, approval: "approved" as const } : m));
      const bal = computeBalances(trial);
      for (const m of lines) {
        if (balanceOf(bal, m.itemId, m.plant).qty < -1e-9) {
          const item = s.items.find((i) => i.id === m.itemId);
          return deny(`Cannot approve: ${item?.name || "a part"} at ${m.plant} would go negative.`, 409);
        }
      }
    }
    for (const m of lines) { m.approval = decision; m.approvalByName = user.name; m.approvalAt = now; m.approvalNote = str(body?.note, 200); }
    saveStock(s);
    recordAudit({ action: decision === "approved" ? "STOCK_ADJUST_APPROVED" : "STOCK_ADJUST_REJECTED", userId: user.id, userName: user.name, role: user.role, plant: lines[0].plant, targetType: "stock_movement", targetId: no, targetLabel: no, detail: str(body?.note, 200) });
    return NextResponse.json({ ok: true });
  }

  /* ---------------- Movements (one document, many lines) ---------------- */
  if (action === "move") {
    const type = str(body?.type, 20) as MovementType;
    if (!(type in SIGN)) return deny("Unknown movement.", 400);
    if ((type === "adjust_in" || type === "adjust_out" || type === "transfer_out") && !c.manage) {
      return deny("Adjustments and transfers need Plant stock — manage (procurement / stores).");
    }
    if (type === "transfer_in") return deny("A transfer-in is created by its transfer-out.", 400);
    if (type === "receipt") return deny("Parts come into stock through a GRN against a spare-part PO (Goods receipt tab). For opening stock use Adjustment + with the reason.", 400);
    const plant = str(body?.plant, 10).toUpperCase();
    if (!c.plants.includes(plant)) return deny("That plant is not yours.", 403);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(body?.date, 10)) ? str(body.date, 10) : today();
    if (date > today()) return deny("The date cannot be in the future.", 400);
    const lines: any[] = Array.isArray(body?.lines) ? body.lines : [];
    if (!lines.length) return deny("Add at least one part.", 400);

    const vendorId = "", vendorName = "";
    const isAdjust = type === "adjust_in" || type === "adjust_out";
    let machineId = "";
    if (type === "issue") {
      const m = s.machines.find((x) => x.id === body?.machineId && x.plant === plant && x.active);
      if (!m && !str(body?.purpose, 200)) return deny("Choose the machine the parts go into (or write the purpose for general use).", 400);
      machineId = m?.id || "";
      if (!str(body?.issuedTo, 80)) return deny("Who took the parts? (fitter / operator name)", 400);
    }
    if (type === "return") machineId = s.machines.find((x) => x.id === body?.machineId && x.plant === plant)?.id || "";
    let toPlant = "";
    if (type === "transfer_out") {
      toPlant = str(body?.toPlant, 10).toUpperCase();
      if (!plantOptions().some((p) => p.code === toPlant) || toPlant === plant) return deny("Choose the plant receiving the transfer.", 400);
    }
    if ((type === "adjust_in" || type === "adjust_out") && !str(body?.purpose, 200)) return deny("Give the reason for the adjustment (physical count, damage…).", 400);

    // Validate every line against live balances, counting earlier lines of this same document.
    const bal = computeBalances(s.movements);
    const pending = new Map<string, number>();
    const prefix = { receipt: "GRN", issue: "ISS", return: "RET", adjust_in: "ADJ", adjust_out: "ADJ", transfer_out: "TRF", transfer_in: "TRF" }[type];
    const docNo = nextNo(s, `${prefix}-${plant}`);
    const transferId = type === "transfer_out" ? newId() : "";
    const made: Movement[] = [];
    for (const l of lines) {
      const item = s.items.find((i) => i.id === l?.itemId && i.active);
      if (!item) return deny("A line has no part chosen (or the part is inactive).", 400);
      const qty = Math.round(num(l?.qty) * 1000) / 1000;
      if (qty <= 0) return deny(`Quantity for ${item.name} must be more than 0.`, 400);
      const b = balanceOf(bal, item.id, plant);
      if (SIGN[type] < 0) {
        const already = pending.get(item.id) || 0;
        if (qty + already > b.qty + 1e-9) {
          return deny(`Not enough ${item.name} at ${plant}: on hand ${b.qty} ${item.unit}, asked ${qty + already}.`, 409);
        }
        pending.set(item.id, already + qty);
      }
      const rate = type === "adjust_in" && num(l?.rate) > 0 ? num(l.rate) : b.avgRate;
      made.push({
        id: newId(), no: docNo, type, date, plant, itemId: item.id, qty, rate, amount: Math.round(qty * rate * 100) / 100,
        vendorId, vendorName,
        invoiceNo: str(body?.invoiceNo, 40), challanNo: str(body?.challanNo, 40),
        machineId, issuedTo: str(body?.issuedTo, 80),
        purpose: str(body?.purpose, 200) || (toPlant ? `Transfer to ${toPlant}` : ""),
        remarks: str(l?.remarks, 200) || str(body?.remarks, 200),
        transferId, cancelled: false, cancelReason: "", cancelledByName: "",
        createdBy: user.id, createdByName: user.name, createdAt: now,
        ...(isAdjust ? (c.approve ? { approval: "approved" as const, approvalByName: user.name, approvalAt: now } : { approval: "pending" as const }) : {}),
      });
    }
    if (type === "transfer_out") {
      const inNo = nextNo(s, `TRF-${toPlant}`);
      for (const m of [...made]) {
        // On the road until the receiving plant confirms it arrived.
        made.push({ ...m, id: newId(), no: inNo, type: "transfer_in", plant: toPlant, purpose: `Transfer from ${plant} (${docNo})`, inTransit: true });
      }
    }
    s.movements = [...s.movements, ...made];
    saveStock(s);
    recordAudit({
      action: `STOCK_${type.toUpperCase()}`, userId: user.id, userName: user.name, role: user.role, plant,
      targetType: "stock_movement", targetId: docNo, targetLabel: docNo,
      detail: `${MOVEMENT_LABEL[type]} · ${made.filter((m) => m.plant === plant).length} line(s)${vendorName ? ` · ${vendorName}` : ""}`,
    });
    return NextResponse.json({ no: docNo, movements: made, pendingApproval: isAdjust && !c.approve }, { status: 201 });
  }

  /* ---------------- Cancel a whole document ---------------- */
  if (action === "cancel") {
    if (!c.manage) return deny("Cancelling needs Plant stock — manage.");
    const no = str(body?.no, 40);
    const reason = str(body?.reason, 200);
    if (!reason) return deny("Give the reason for cancelling.", 400);
    const target = s.movements.filter((m) => m.no === no && !m.cancelled);
    if (!target.length) return deny("Not found.", 404);
    if (!target.every((m) => c.plants.includes(m.plant))) return deny("Not your plant.");
    if (target.some((m) => m.grnId)) return deny("This receipt belongs to a FINAL GRN. Ask an admin to reopen the GRN instead.", 409);
    if (target.some((m) => m.maintenanceId)) return deny("These parts were issued by a maintenance job — cancel the job in Maintenance.", 409);
    const ids = new Set(target.map((m) => m.id));
    const tIds = new Set(target.map((m) => m.transferId).filter(Boolean));
    // Cancelling a receipt must not leave later issues drawing on stock that no longer exists.
    const trial = s.movements.map((m) => (ids.has(m.id) || (m.transferId && tIds.has(m.transferId)) ? { ...m, cancelled: true } : m));
    const bal = computeBalances(trial);
    for (const m of target) {
      const b = balanceOf(bal, m.itemId, m.plant);
      if (b.qty < -1e-9) {
        const item = s.items.find((i) => i.id === m.itemId);
        return deny(`Cannot cancel: ${item?.name || "a part"} at ${m.plant} would go negative (${b.qty}). Cancel the later issues first.`, 409);
      }
    }
    s.movements = s.movements.map((m) =>
      ids.has(m.id) || (m.transferId && tIds.has(m.transferId)) ? { ...m, cancelled: true, cancelReason: reason, cancelledByName: user.name } : m
    );
    saveStock(s);
    recordAudit({ action: "STOCK_CANCELLED", userId: user.id, userName: user.name, role: user.role, targetType: "stock_movement", targetId: no, targetLabel: no, detail: reason });
    return NextResponse.json({ ok: true });
  }

  return deny("Unknown action.", 400);
}
