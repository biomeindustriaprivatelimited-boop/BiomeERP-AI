import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import {
  loadStock, saveStock, nextNo, newId, computeBalances, balanceOf,
  type PmSchedule, type MaintenanceLog, type MaintKind, type Movement,
} from "@/lib/stock";
import { stockCtx, str, num, today, isoDate } from "@/lib/spares";

/**
 * Machines' upkeep: preventive-maintenance schedules and the maintenance log.
 *
 *   schedule.save   every N days and/or every N running hours
 *   log.save        a job done on a machine — parts used are ISSUED from
 *                   the plant's stock under the job number (MNT-REW-0001),
 *                   downtime and cost recorded, a linked schedule marked done
 *   log.cancel      cancels the job AND its parts issue (stores in-charge)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const { user } = c;
  const body = await req.json().catch(() => null);
  const action = str(body?.action, 40);
  const s = loadStock();
  const now = new Date().toISOString();
  const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });

  if (action === "schedule.save") {
    const existing = body?.id ? s.schedules.find((x) => x.id === body.id) : null;
    const machine = s.machines.find((m) => m.id === (existing?.machineId || body?.machineId));
    if (!machine || !c.plants.includes(machine.plant)) return deny("Choose the machine.", 400);
    const task = str(body?.task, 160);
    if (!task) return deny("Write the maintenance task (greasing, die change, belt check…).", 400);
    const everyDays = Math.max(0, Math.round(num(body?.everyDays)));
    const everyHours = Math.max(0, Math.round(num(body?.everyHours)));
    if (!everyDays && !everyHours) return deny("Set how often: every N days and/or every N running hours.", 400);
    const sch: PmSchedule = {
      id: existing?.id || newId(), machineId: machine.id, plant: machine.plant, task,
      checklist: str(body?.checklist, 800), everyDays, everyHours,
      lastDoneDate: isoDate(body?.lastDoneDate) || existing?.lastDoneDate || "",
      lastDoneHours: body?.lastDoneHours !== undefined && body?.lastDoneHours !== "" ? Math.max(0, num(body.lastDoneHours)) : existing?.lastDoneHours ?? machine.runningHours,
      active: body?.active === false ? false : true,
      createdAt: existing?.createdAt || now, createdByName: existing?.createdByName || user.name,
    };
    s.schedules = existing ? s.schedules.map((x) => (x.id === sch.id ? sch : x)) : [...s.schedules, sch];
    saveStock(s);
    recordAudit({ action: existing ? "PM_SCHEDULE_EDITED" : "PM_SCHEDULE_CREATED", userId: user.id, userName: user.name, role: user.role, plant: machine.plant, targetType: "machine", targetId: machine.id, targetLabel: `${machine.code} · ${task}` });
    return NextResponse.json({ schedule: sch });
  }

  if (action === "log.save") {
    const machine = s.machines.find((m) => m.id === body?.machineId);
    if (!machine || !c.plants.includes(machine.plant)) return deny("Choose the machine.", 400);
    const kind = (["preventive", "breakdown", "inspection", "overhaul"].includes(body?.kind) ? body.kind : "preventive") as MaintKind;
    const date = isoDate(body?.date) || today();
    if (date > today()) return deny("The date cannot be in the future.", 400);
    const work = str(body?.work, 600);
    if (!work) return deny("Write what was done.", 400);
    const doneBy = str(body?.doneBy, 80);
    if (!doneBy) return deny("Who did the work? (fitter / technician / vendor)", 400);
    const sch = body?.scheduleId ? s.schedules.find((x) => x.id === body.scheduleId && x.machineId === machine.id) : null;
    const hoursReading = Math.max(0, num(body?.hoursReading));
    if (hoursReading && hoursReading < machine.runningHours && !c.manage) return deny(`The hour meter cannot go back (last ${machine.runningHours} h).`, 400);

    const no = nextNo(s, `MNT-${machine.plant}`);
    const id = newId();
    const bal = computeBalances(s.movements);
    const pending = new Map<string, number>();
    const issues: Movement[] = [];
    for (const l of Array.isArray(body?.parts) ? body.parts : []) {
      const item = s.items.find((i) => i.id === l?.itemId && i.active);
      const qty = Math.round(num(l?.qty) * 1000) / 1000;
      if (!item && !qty) continue;
      if (!item) return deny("A part line has no part chosen.", 400);
      if (qty <= 0) return deny(`Quantity for ${item.name} must be more than 0.`, 400);
      const b = balanceOf(bal, item.id, machine.plant);
      const already = pending.get(item.id) || 0;
      if (qty + already > b.qty + 1e-9) return deny(`Not enough ${item.name} at ${machine.plant}: on hand ${b.qty} ${item.unit}.`, 409);
      pending.set(item.id, already + qty);
      issues.push({
        id: newId(), no, type: "issue", date, plant: machine.plant, itemId: item.id, qty, rate: b.avgRate,
        amount: Math.round(qty * b.avgRate * 100) / 100, vendorId: "", vendorName: "", invoiceNo: "", challanNo: "",
        machineId: machine.id, issuedTo: doneBy, purpose: `Maintenance ${no}: ${work.slice(0, 120)}`, remarks: "",
        transferId: "", cancelled: false, cancelReason: "", cancelledByName: "",
        createdBy: user.id, createdByName: user.name, createdAt: now, maintenanceId: id,
      });
    }
    const log: MaintenanceLog = {
      id, no, plant: machine.plant, machineId: machine.id, date, kind, scheduleId: sch?.id || "", work, doneBy,
      downtimeHours: Math.max(0, num(body?.downtimeHours)), labourCost: Math.max(0, num(body?.labourCost)), otherCost: Math.max(0, num(body?.otherCost)),
      partsCost: Math.round(issues.reduce((t, m) => t + m.amount, 0) * 100) / 100, hoursReading,
      cancelled: false, cancelReason: "", createdBy: user.id, createdByName: user.name, createdAt: now,
    };
    s.movements.push(...issues);
    s.maintenance.push(log);
    if (hoursReading > machine.runningHours) { machine.runningHours = hoursReading; machine.hoursAt = date; }
    if (sch) { sch.lastDoneDate = date; sch.lastDoneHours = hoursReading || machine.runningHours; }
    saveStock(s);
    recordAudit({ action: "MAINTENANCE_LOGGED", userId: user.id, userName: user.name, role: user.role, plant: machine.plant, targetType: "machine", targetId: machine.id, targetLabel: `${no} · ${machine.code} ${machine.name}`, detail: `${kind} · ${issues.length} part line(s) · downtime ${log.downtimeHours} h` });
    return NextResponse.json({ log }, { status: 201 });
  }

  if (action === "log.cancel") {
    if (!c.manage) return deny("Cancelling a job needs Spare parts — manage.");
    const log = s.maintenance.find((l) => l.id === body?.id);
    if (!log || !c.plants.includes(log.plant)) return deny("Job not found.", 404);
    if (log.cancelled) return deny("Already cancelled.", 409);
    const reason = str(body?.reason, 200);
    if (!reason) return deny("Give the reason.", 400);
    log.cancelled = true; log.cancelReason = reason;
    s.movements = s.movements.map((m) => (m.maintenanceId === log.id && !m.cancelled ? { ...m, cancelled: true, cancelReason: `Job cancelled: ${reason}`, cancelledByName: user.name } : m));
    saveStock(s);
    recordAudit({ action: "MAINTENANCE_CANCELLED", userId: user.id, userName: user.name, role: user.role, plant: log.plant, targetType: "machine", targetId: log.machineId, targetLabel: log.no, detail: reason });
    return NextResponse.json({ ok: true });
  }

  return deny("Unknown action.", 400);
}
