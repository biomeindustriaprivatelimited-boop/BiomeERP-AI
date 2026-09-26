import { NextRequest, NextResponse } from "next/server";
import { getSession, findById } from "@/lib/authServer";
import { hasPermission, Role } from "@/lib/permissions";
import { loadEmployees } from "@/lib/payroll";
import {
  loadMonth, saveMonth, blankRow, totalsFor, daysInMonth,
  DAY_MARKS, DayMark, AttendanceRow,
} from "@/lib/attendance";
import {
  loadRules, loadHolidays, loadLeave, regionForEmployee, canEmployeeMark,
  isNonWorkingDay, isHoliday,
} from "@/lib/leave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const VALID: DayMark[] = ["P", "A", "H", "L", "HD", ""];

/**
 * Which employees this person may mark.
 *
 * A plant manager gets their plant's people; accounts and admin get
 * everyone; anyone else gets only themselves, matched on their work email
 * or employee code. Returning an empty list is the correct answer for
 * someone with nobody to mark — the UI says so rather than showing a grid
 * of other people's names.
 */
function scopeFor(role: Role, sessionPlant: string | null, userEmail: string, userName: string) {
  const all = loadEmployees().filter((e) => e.active);
  if (hasPermission(role, "attendance.approve") || hasPermission(role, "payroll")) {
    return { employees: all, canMarkOthers: true, scope: "everyone" as const };
  }
  if (hasPermission(role, "attendance.entry") && sessionPlant) {
    return {
      employees: all.filter((e) => e.plant === sessionPlant),
      canMarkOthers: true,
      scope: "plant" as const,
    };
  }
  const mine = all.filter(
    (e) =>
      (userEmail && e.email && e.email.toLowerCase() === userEmail.toLowerCase()) ||
      e.name.toLowerCase() === userName.toLowerCase()
  );
  return { employees: mine, canMarkOthers: false, scope: "self" as const };
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });

  const scoped = scopeFor(user.role, session.plant, "", user.name);
  const plant = scoped.scope === "plant" ? session.plant || "" : "";
  const stored = loadMonth(month, plant);

  const byId = new Map(stored.rows.map((r) => [r.employeeId, r]));
  const rows = scoped.employees.map((e) => byId.get(e.id) || blankRow(e.id, month));

  /**
   * The calendar this person is judged against, plus the cut-off.
   *
   * The client needs both to draw the grid honestly: a Sunday or a state
   * holiday should not look like a day somebody forgot to mark, and a
   * locked day should not offer a button that will be refused.
   */
  const rules = loadRules();
  const holidays = loadHolidays();
  const leave = loadLeave();
  const canApprove = hasPermission(user.role, "attendance.approve");
  const today = new Date();
  const n = daysInMonth(month);

  // One region per row, because a plant manager's own region and their
  // staff's are the same, but accounts sees people across all three.
  const regionOf = new Map(scoped.employees.map((e) => [e.id, regionForEmployee(e.plant)]));

  const dayInfo = Array.from({ length: n }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const perRegion = (["HR", "MH", "DL"] as const).map((r) => ({
      region: r,
      off: isNonWorkingDay(date, r, holidays),
      holiday: isHoliday(date, r, holidays)?.name ?? null,
    }));
    const lock = canEmployeeMark(date, today, rules);
    return {
      date,
      perRegion,
      // Accounts and the admin are never locked out — the cut-off is a
      // discipline for self-marking, not a wall against correction.
      locked: canApprove ? false : !lock.allowed,
      lockReason: canApprove ? undefined : lock.reason,
    };
  });

  const leaveByEmployee: Record<string, { date: string; type: string; status: string }[]> = {};
  for (const r of leave) {
    if (r.status !== "approved" && r.status !== "pending") continue;
    if (!regionOf.has(r.employeeId)) continue;
    for (let i = 0; i < n; i++) {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      if (r.fromDate <= date && r.toDate >= date) {
        (leaveByEmployee[r.employeeId] ||= []).push({ date, type: r.type, status: r.status });
      }
    }
  }

  return NextResponse.json({
    month,
    plant,
    days: daysInMonth(month),
    marks: DAY_MARKS,
    rules,
    dayInfo,
    leaveByEmployee,
    regions: Object.fromEntries(regionOf),
    canApprove,
    locked: stored.locked,
    canMarkOthers: scoped.canMarkOthers,
    scope: scoped.scope,
    employees: scoped.employees.map((e) => ({
      id: e.id, code: e.code, name: e.name, type: e.type,
      designation: e.designation, plant: e.plant,
    })),
    rows: rows.map((r) => ({ ...r, totals: totalsFor(r, month) })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const month = String(body?.month || "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  if (month > new Date().toISOString().slice(0, 7)) {
    return NextResponse.json({ error: "That month hasn't started yet." }, { status: 400 });
  }

  const scoped = scopeFor(user.role, session.plant, "", user.name);
  if (scoped.employees.length === 0) {
    return NextResponse.json({ error: "You have nobody to mark attendance for." }, { status: 403 });
  }

  const plant = scoped.scope === "plant" ? session.plant || "" : "";
  const stored = loadMonth(month, plant);
  if (stored.locked && !hasPermission(user.role, "payroll.approve")) {
    return NextResponse.json(
      { error: "This month is locked because payroll has been approved. Ask accounts to reopen it." },
      { status: 409 }
    );
  }

  const n = daysInMonth(month);
  const allowed = new Set(scoped.employees.map((e) => e.id));

  /**
   * The 2 PM cut-off, enforced here and not only in the UI.
   *
   * An approver is exempt: somebody has to be able to correct a day after
   * the fact, and that person is accounts or the admin.
   */
  const rules = loadRules();
  const canApprove = hasPermission(user.role, "attendance.approve");
  const now = new Date();
  const lockedDays = new Set<number>();
  if (!canApprove) {
    for (let i = 0; i < n; i++) {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      if (!canEmployeeMark(date, now, rules).allowed) lockedDays.add(i);
    }
  }
  const incoming: AttendanceRow[] = Array.isArray(body.rows) ? body.rows : [];

  const cleaned: AttendanceRow[] = incoming
    // Silently dropping out-of-scope rows is the point: a request holding
    // another plant's employee simply loses them rather than being trusted.
    .filter((r) => r?.employeeId && allowed.has(r.employeeId))
    .map((r) => ({
      employeeId: String(r.employeeId),
      days: Array.from({ length: n }, (_, i) => {
        const v = Array.isArray(r.days) ? String(r.days[i] ?? "") : "";
        const cleaned = (VALID.includes(v as DayMark) ? v : "") as DayMark;
        if (!lockedDays.has(i)) return cleaned;
        // A locked day keeps whatever was already stored. Silently
        // discarding the edit is right: the UI already greys the cell, so
        // anything arriving here for a closed day is stale or forged.
        const existing = stored.rows.find((x) => x.employeeId === r.employeeId);
        return (existing?.days?.[i] ?? "") as DayMark;
      }),
      overtimeHours: Math.max(0, Math.min(400, Number(r.overtimeHours) || 0)),
      remark: String(r.remark || "").slice(0, 200),
    }));

  // Rows outside this person's scope are preserved, not wiped — two people
  // can be filling different parts of the same month.
  const kept = stored.rows.filter((r) => !allowed.has(r.employeeId));

  saveMonth({
    month,
    plant,
    rows: [...kept, ...cleaned],
    locked: stored.locked,
    updatedAt: new Date().toISOString(),
    updatedByName: user.name,
  });

  return NextResponse.json({
    ok: true,
    rows: cleaned.map((r) => ({ ...r, totals: totalsFor(r, month) })),
  });
}
