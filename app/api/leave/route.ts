import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { loadEmployees } from "@/lib/payroll";
import {
  loadLeave, saveLeave, LEAVE_TYPES, leaveSpec, balancesFor, workingDaysIn,
  checkLeaveRequest, regionForEmployee, loadHolidays, LeaveRequest, LeaveType,
} from "@/lib/leave";
import { recordAudit } from "@/lib/audit";
import { effectivePermissions } from "@/lib/access";
import { loadRules } from "@/lib/leave";
import type { User } from "@/lib/authServer";

/**
 * Who decides, and whose leave a person may raise.
 *
 * Approvers (attendance.approve) decide and may raise for anyone. A plant
 * manager (attendance.entry + employee.view, signed in for a plant) may
 * RAISE leave for their own plant's people when the developer's rule
 * `plantManagerLeave` is on — most of them are labour with no login.
 * They never decide it.
 */
function leaveContext(user: User, sessionPlant: string | null) {
  const perms = effectivePermissions(user.role, user.access);
  const canDecide = perms.includes("attendance.approve");
  const staff = !canDecide && sessionPlant && perms.includes("employee.view") &&
    perms.includes("attendance.entry") && loadRules().plantManagerLeave
    ? loadEmployees().filter((e) => e.active && e.plant === sessionPlant)
    : [];
  return { canDecide, staff };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The employee record behind a login, matched on work email then name. */
function employeeFor(user: { id: string; name: string }) {
  const all = loadEmployees().filter((e) => e.active);
  return all.find((e) => e.name.toLowerCase() === user.name.toLowerCase()) ?? null;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { canDecide, staff } = leaveContext(user, session.plant || null);
  const me = employeeFor(user);
  const all = loadLeave();
  const staffIds = new Set(staff.map((e) => e.id));

  // An employee sees their own requests; whoever approves sees the queue;
  // a plant manager sees their plant's. Nobody browses another plant's.
  const requests = canDecide
    ? all
    : all.filter((r) => r.employeeId === me?.id || r.raisedBy === user.id || staffIds.has(r.employeeId));

  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);

  return NextResponse.json({
    requests: [...requests].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)),
    types: LEAVE_TYPES,
    canDecide,
    canApplyFor: canDecide || staff.length > 0,
    // The people this person may raise leave for (approvers: everyone active).
    staff: (canDecide ? loadEmployees().filter((e) => e.active) : staff)
      .map((e) => ({ id: e.id, name: e.name, code: e.code, plant: e.plant })),
    me: me ? { id: me.id, name: me.name, code: me.code, plant: me.plant } : null,
    balances: me ? balancesFor(me.id, month, all) : [],
    holidays: loadHolidays(),
    pending: all.filter((r) => r.status === "pending").length,
  });
}

/** Raise a request. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { canDecide, staff } = leaveContext(user, session.plant || null);
  const employees = loadEmployees().filter((e) => e.active);
  // Accounts and the admin may apply on someone's behalf — a labourer with
  // no login still needs their leave on record. A plant manager may, for
  // their own plant's people only.
  const target = body.employeeId && canDecide
    ? employees.find((e) => e.id === body.employeeId)
    : body.employeeId && staff.some((e) => e.id === body.employeeId)
      ? staff.find((e) => e.id === body.employeeId)
      : employeeFor(user);

  if (!target) {
    return NextResponse.json(
      { error: "No employee record is linked to your login. Ask the admin to add one before applying for leave." },
      { status: 400 }
    );
  }

  const type = String(body.type || "") as LeaveType;
  const spec = leaveSpec(type);
  if (!spec) return NextResponse.json({ error: "Choose a leave type." }, { status: 400 });

  const fromDate = String(body.fromDate || "").slice(0, 10);
  const toDate = String(body.toDate || fromDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: "Choose the dates." }, { status: 400 });
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  }

  const reason = String(body.reason || "").trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: "Write a short reason — it is what the approver has to go on." }, { status: 400 });
  }

  const region = regionForEmployee(target.plant);
  const days = workingDaysIn(fromDate, toDate, region);

  const all = loadLeave();

  // Overlapping requests are how a day gets counted twice against an
  // entitlement, and how payroll ends up disagreeing with the register.
  const clash = all.find(
    (r) =>
      r.employeeId === target.id &&
      (r.status === "pending" || r.status === "approved") &&
      !(r.toDate < fromDate || r.fromDate > toDate)
  );
  if (clash) {
    return NextResponse.json(
      { error: `You already have a ${clash.status} request covering ${clash.fromDate} to ${clash.toDate}. Cancel it first if this replaces it.` },
      { status: 409 }
    );
  }

  const verdict = checkLeaveRequest({
    employeeId: target.id, type, fromDate, toDate, days,
    month: fromDate.slice(0, 7), requests: all,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 409 });

  if (spec.needsDocument && !(Array.isArray(body.attachments) && body.attachments.length)) {
    return NextResponse.json(
      { error: `${spec.label} needs the certificate or prescription attached.` },
      { status: 400 }
    );
  }

  const request: LeaveRequest = {
    id: crypto.randomUUID(),
    employeeId: target.id,
    employeeName: target.name,
    employeeCode: target.code,
    plant: target.plant,
    type, fromDate, toDate, days, reason,
    status: "pending",
    attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [],
    raisedBy: user.id,
    raisedAt: new Date().toISOString(),
    decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null,
  };

  saveLeave([...all, request]);
  recordAudit({
    action: "ATTENDANCE_LEAVE_REQUESTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "employee", targetId: target.id, targetLabel: target.name,
    detail: `${spec.label} · ${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ""} · ${days} day(s)`,
    plant: target.plant || null,
  });

  return NextResponse.json({ request }, { status: 201 });
}

/** Approve, reject, or cancel. */
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which request?" }, { status: 400 });

  const all = loadLeave();
  const request = all.find((r) => r.id === body.id);
  if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { canDecide } = leaveContext(user, session.plant || null);
  const me = employeeFor(user);
  const isOwn = me?.id === request.employeeId || request.raisedBy === user.id;
  const action = String(body.action || "");

  if (action === "cancel") {
    if (!isOwn && !canDecide) return NextResponse.json({ error: "Not yours to cancel." }, { status: 403 });
    if (request.status === "approved" && !canDecide) {
      return NextResponse.json(
        { error: "This was already approved — ask accounts to cancel it." },
        { status: 409 }
      );
    }
    request.status = "cancelled";
  } else if (action === "approve" || action === "reject") {
    if (!canDecide) return NextResponse.json({ error: "Only accounts or the admin can decide leave." }, { status: 403 });
    if (request.status !== "pending") {
      return NextResponse.json({ error: `This request is already ${request.status}.` }, { status: 409 });
    }
    // Nobody signs off their own leave, whatever their role — the same rule
    // that makes imprest approvals mean something.
    if (isOwn) {
      return NextResponse.json({ error: "You can't decide your own leave. Ask another approver." }, { status: 403 });
    }
    const note = String(body.note || "").trim();
    if (action === "reject" && !note) {
      return NextResponse.json({ error: "Give a reason so the person knows why." }, { status: 400 });
    }
    request.status = action === "approve" ? "approved" : "rejected";
    request.decidedBy = user.id;
    request.decidedByName = user.name;
    request.decidedAt = new Date().toISOString();
    request.decisionNote = note || null;
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  saveLeave(all.map((r) => (r.id === request.id ? request : r)));
  recordAudit({
    action: `ATTENDANCE_LEAVE_${action.toUpperCase()}`,
    userId: user.id, userName: user.name, role: user.role,
    targetType: "employee", targetId: request.employeeId, targetLabel: request.employeeName,
    detail: `${request.fromDate}${request.toDate !== request.fromDate ? ` to ${request.toDate}` : ""}${request.decisionNote ? ` — ${request.decisionNote}` : ""}`,
    plant: request.plant || null,
  });

  return NextResponse.json({ request });
}
