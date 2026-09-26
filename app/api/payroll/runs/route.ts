import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadRuns, saveRuns, loadEmployees, loadSettings, computePayslip,
  blankAttendance, AttendanceInput, PayrollRun, daysInMonth,
} from "@/lib/payroll";
import { loadMonth, totalsFor, blankRow } from "@/lib/attendance";
import { recordAudit } from "@/lib/audit";
import { isOverrideActive, recordOverrideUse, lockedMessage } from "@/lib/override";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readAttendance(raw: any, employeeId: string, month: string): AttendanceInput {
  const base = blankAttendance(employeeId, month);
  return {
    employeeId,
    paidDays: raw?.paidDays !== undefined ? num(raw.paidDays, base.paidDays) : base.paidDays,
    daysWorked: num(raw?.daysWorked),
    overtimeHours: num(raw?.overtimeHours),
    bonus: num(raw?.bonus),
    incentive: num(raw?.incentive),
    advanceDeduction: num(raw?.advanceDeduction),
    tds: num(raw?.tds),
    otherDeduction: num(raw?.otherDeduction),
    otherDeductionLabel: String(raw?.otherDeductionLabel || "").slice(0, 40),
    remark: String(raw?.remark || "").slice(0, 200),
  };
}

/** Recompute a run's payslips from the current masters. */
function build(run: PayrollRun) {
  const settings = loadSettings();
  const employees = loadEmployees().filter(
    (e) =>
      e.active &&
      (!run.plant || e.plant === run.plant) &&
      // Somebody who left before this month started is not on this sheet.
      (!e.dateOfLeaving || e.dateOfLeaving.slice(0, 7) >= run.month) &&
      e.dateOfJoining.slice(0, 7) <= run.month
  );

  const byId = new Map(run.attendance.map((a) => [a.employeeId, a]));

  /**
   * Pull the register in for anyone not already typed into this run.
   *
   * The point of the attendance module is that a month is counted once.
   * A figure the preparer has already entered here wins — they may be
   * correcting the register — but an untouched row is filled from it
   * rather than left at a default nobody checked.
   */
  const registers = [loadMonth(run.month, ""), loadMonth(run.month, "REW"), loadMonth(run.month, "GKD")];
  const marked = new Map<string, ReturnType<typeof totalsFor>>();
  for (const reg of registers) {
    for (const row of reg.rows) {
      const t = totalsFor(row, run.month);
      // A register with nothing marked tells us nothing; skip it so it
      // cannot zero out a month somebody filled by hand.
      if (t.paidDays > 0 || t.daysWorked > 0 || t.overtimeHours > 0) marked.set(row.employeeId, t);
    }
  }

  const attendance = employees.map((e) => {
    const typed = byId.get(e.id);
    if (typed) return typed;
    const fromRegister = marked.get(e.id);
    if (!fromRegister) return blankAttendance(e.id, run.month);
    return {
      ...blankAttendance(e.id, run.month),
      paidDays: fromRegister.paidDays,
      daysWorked: fromRegister.daysWorked,
      overtimeHours: fromRegister.overtimeHours,
    };
  });
  const attendanceById = new Map(attendance.map((a) => [a.employeeId, a]));
  const payslips = employees.map((e) =>
    computePayslip(e, attendanceById.get(e.id)!, run.month, settings)
  );

  return { attendance, payslips, settings };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const id = req.nextUrl.searchParams.get("id");
  const runs = loadRuns();

  if (!id) {
    return NextResponse.json({
      runs: runs
        .map((r) => ({
          id: r.id, month: r.month, plant: r.plant, status: r.status,
          headcount: r.payslips.length,
          netTotal: r.payslips.reduce((s, p) => s + p.netPay, 0),
          createdAt: r.createdAt, approvedAt: r.approvedAt, paidAt: r.paidAt,
        }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      canApprove: hasPermission(user.role, "payroll.approve"),
    });
  }

  const run = runs.find((r) => r.id === id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // A draft always reflects the masters as they stand right now. An approved
  // run shows exactly what was signed off, even if a salary changed since —
  // that is the whole reason the payslips are frozen into the record.
  if (run.status === "draft") {
    const { attendance, payslips } = build(run);
    return NextResponse.json({ run: { ...run, attendance, payslips }, canApprove: hasPermission(user.role, "payroll.approve") });
  }

  return NextResponse.json({ run, canApprove: hasPermission(user.role, "payroll.approve") });
}

/** Open a month. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  const month = String(body?.month || "");
  const plant = String(body?.plant || "").trim().toUpperCase();

  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  if (month > new Date().toISOString().slice(0, 7)) {
    return NextResponse.json({ error: "That month hasn't started yet." }, { status: 400 });
  }

  const runs = loadRuns();
  if (runs.some((r) => r.month === month && r.plant === plant)) {
    return NextResponse.json({ error: "A run already exists for that month." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const run: PayrollRun = {
    id: crypto.randomUUID(),
    month,
    plant,
    status: "draft",
    attendance: [],
    payslips: [],
    settingsSnapshot: null,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: now,
    approvedBy: null, approvedByName: null, approvedAt: null, paidAt: null,
    note: "",
    updatedAt: now,
  };

  const built = build(run);
  run.attendance = built.attendance;
  run.payslips = built.payslips;

  saveRuns([...runs, run]);
  return NextResponse.json({ run, monthDays: daysInMonth(month) }, { status: 201 });
}

/** Save attendance for a draft, and recompute. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });

  const runs = loadRuns();
  const existing = runs.find((r) => r.id === body.id);
  if (!existing) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: `This month is ${existing.status}. Reopen it before changing attendance.` },
      { status: 409 }
    );
  }

  const attendance: AttendanceInput[] = Array.isArray(body.attendance)
    ? body.attendance
        .filter((a: any) => a?.employeeId)
        .map((a: any) => readAttendance(a, String(a.employeeId), existing.month))
    : existing.attendance;

  const updated: PayrollRun = {
    ...existing,
    attendance,
    note: body.note !== undefined ? String(body.note).slice(0, 400) : existing.note,
    updatedAt: new Date().toISOString(),
  };
  const built = build(updated);
  updated.attendance = built.attendance;
  updated.payslips = built.payslips;

  saveRuns(runs.map((r) => (r.id === updated.id ? updated : r)));
  // `user` and `action` were referenced here without ever being declared.
  // Every attendance save therefore threw AFTER the file had been written:
  // the data landed, the response was a 500, and the screen said it had
  // failed. The user is read the way every other handler in this file
  // reads it; the action is fixed, because this route does one thing.
  const user = findById(auth.session.uid)!;
  recordAudit({
    action: "PAYROLL_ATTENDANCE_SAVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "payroll_run", targetId: updated.id,
    targetLabel: `${updated.month}${updated.plant ? ` · ${updated.plant}` : ""}`,
    detail: `${updated.payslips.length} employees · net ₹${updated.payslips.reduce((s2, p2) => s2 + p2.netPay, 0).toLocaleString("en-IN")}`,
    plant: updated.plant || null,
  });
  return NextResponse.json({ run: updated });
}

/** Approve, reopen, or mark paid. */
export async function PATCH(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.approve");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");
  if (!body?.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });

  const runs = loadRuns();
  const existing = runs.find((r) => r.id === body.id);
  if (!existing) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const now = new Date().toISOString();
  let updated: PayrollRun;

  if (action === "approve") {
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "Only a draft can be approved." }, { status: 409 });
    }
    const built = build(existing);

    // Anything the engine flagged has to be dealt with first. Approving over
    // a negative net or a missing wage is how a wrong salary gets released.
    const blocking = built.payslips.filter((p) => p.netPay < 0);
    if (blocking.length > 0 && !body.force) {
      return NextResponse.json(
        {
          error: `${blocking.length} employee(s) have a negative net pay. Fix the recoveries first.`,
          employees: blocking.map((p) => ({ code: p.code, name: p.name, netPay: p.netPay })),
        },
        { status: 409 }
      );
    }

    updated = {
      ...existing,
      status: "approved",
      attendance: built.attendance,
      payslips: built.payslips,
      // The rates in force at approval are frozen with the sheet, so a slip
      // reprinted next year still shows what was actually deducted.
      settingsSnapshot: built.settings,
      approvedBy: user.id,
      approvedByName: user.name,
      approvedAt: now,
      updatedAt: now,
    };
  } else if (action === "reopen") {
    // A paid month is money that has left the building. It can still be
    // reopened when something genuinely went wrong, but only deliberately:
    // Override on, reason recorded, name attached.
    if (existing.status === "paid" && !isOverrideActive(user.id)) {
      return NextResponse.json(
        { error: lockedMessage(`${existing.month} has already been paid.`), needsOverride: true },
        { status: 409 }
      );
    }
    if (existing.status === "paid") {
      recordOverrideUse(user, {
        targetType: "payroll_run", targetId: existing.id, targetLabel: existing.month,
        detail: "Reopened a month that had already been marked paid.",
      });
    }
    updated = {
      ...existing,
      status: "draft",
      settingsSnapshot: null,
      approvedBy: null, approvedByName: null, approvedAt: null,
      updatedAt: now,
    };
  } else if (action === "paid") {
    if (existing.status !== "approved") {
      return NextResponse.json({ error: "Approve the month before marking it paid." }, { status: 409 });
    }
    updated = { ...existing, status: "paid", paidAt: now, updatedAt: now };
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  saveRuns(runs.map((r) => (r.id === updated.id ? updated : r)));
  recordAudit({
    action: `PAYROLL_${action.toUpperCase()}`,
    userId: user.id, userName: user.name, role: user.role,
    targetType: "payroll_run", targetId: updated.id,
    targetLabel: `${updated.month}${updated.plant ? ` · ${updated.plant}` : ""}`,
    detail: `${updated.payslips.length} employees · net ₹${updated.payslips.reduce((s2, p2) => s2 + p2.netPay, 0).toLocaleString("en-IN")}`,
    plant: updated.plant || null,
  });
  return NextResponse.json({ run: updated });
}
