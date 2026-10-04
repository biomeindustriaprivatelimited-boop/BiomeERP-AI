import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, User } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { Permission } from "@/lib/permissions";
import { loadEmployees, PayrollEmployee } from "@/lib/payroll";
import { plantOptions } from "@/lib/plants";
import {
  loadRegister, saveRegisterRows, totalsFor, daysInMonth, monthLock, setMonthLock,
  DAY_MARKS, DayMark, AttendanceRow, VALID_MARKS,
} from "@/lib/attendance";
import {
  loadRules, loadHolidays, loadLeave, regionForEmployee, canEmployeeMark, canManagerMark,
  isHoliday, isWeeklyOff, leaveSpec, localDate, AttendanceRules, Holiday, LeaveRequest,
} from "@/lib/leave";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Scope = "everyone" | "plant" | "self";

interface Ctx {
  user: User;
  perms: Permission[];
  sessionPlant: string | null;
}

async function context(req: NextRequest): Promise<Ctx | NextResponse> {
  // requirePermission also enforces the server-ready gate, a changed
  // access version, blocked devices and the developer's feature switches.
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, user.access);
  return { user, perms, sessionPlant: auth.session.plant || null };
}

/**
 * Which employees this person may mark.
 *
 * Office approvers (attendance.approve / payroll) get everyone. A plant
 * manager — attendance.entry AND employee.view, signed in for a plant —
 * gets that plant's people and nobody else's. Anyone else gets only
 * themselves. The employee.view requirement is what keeps a coordinator
 * who happens to carry a plant on their account out of a plant's staff
 * list: coordinators never hold it.
 */
function scopeFor(ctx: Ctx): { employees: PayrollEmployee[]; scope: Scope } {
  const all = loadEmployees().filter((e) => e.active);
  const { perms, user, sessionPlant } = ctx;
  if (perms.includes("attendance.approve") || perms.includes("payroll")) {
    return { employees: all, scope: "everyone" };
  }
  if (sessionPlant && perms.includes("employee.view")) {
    return { employees: all.filter((e) => e.plant === sessionPlant), scope: "plant" };
  }
  const mine = all.filter((e) => e.name.toLowerCase() === user.name.toLowerCase());
  return { employees: mine, scope: "self" };
}

const isDeveloper = (ctx: Ctx) => ctx.user.role === "developer" || ctx.perms.includes("developer");

/** Can this scope change this date? (Lock of the whole month is separate.) */
function dayGate(date: string, scope: Scope, now: Date, rules: AttendanceRules): { allowed: boolean; reason?: string } {
  if (date > localDate(now) && !rules.allowFutureMarks) {
    return { allowed: false, reason: "That day hasn't happened yet." };
  }
  if (scope === "everyone") return { allowed: true };
  if (scope === "plant") return canManagerMark(date, now, rules);
  return canEmployeeMark(date, now, rules);
}

/**
 * What a blank day should read as, by rule: a holiday, the weekly off, or
 * an approved leave. Returned separately so the screen can show it as
 * "filled by the rules" rather than as something a person typed.
 */
function ruleMark(
  date: string, region: string, employeeId: string, rules: AttendanceRules,
  holidays: Holiday[], leave: LeaveRequest[]
): DayMark {
  const lv = leave.find((r) => r.employeeId === employeeId && r.status === "approved" && r.fromDate <= date && r.toDate >= date);
  if (rules.autoMarkHolidays && isHoliday(date, region, holidays)) return "H";
  if (rules.autoMarkWeekOff && isWeeklyOff(date, rules.weekOffDays)) return "WO";
  if (lv) return leaveSpec(lv.type)?.paid === false ? "A" : "L";
  return "";
}

const dateOf = (month: string, i: number) => `${month}-${String(i + 1).padStart(2, "0")}`;

export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if (ctx instanceof NextResponse) return ctx;

  const month = req.nextUrl.searchParams.get("month") || localDate(new Date()).slice(0, 7);
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });

  const scoped = scopeFor(ctx);
  const rules = loadRules();
  const holidays = loadHolidays();
  const leave = loadLeave();
  const now = new Date();
  const n = daysInMonth(month);
  const lock = monthLock(month);

  const register = loadRegister(month, scoped.employees);
  const regionOf = new Map(scoped.employees.map((e) => [e.id, regionForEmployee(e.plant)]));
  const regionsInView = [...new Set(regionOf.values())];

  const dayInfo = Array.from({ length: n }, (_, i) => {
    const date = dateOf(month, i);
    const gate = dayGate(date, scoped.scope, now, rules);
    const hol: Record<string, string> = {};
    for (const r of regionsInView) {
      const h = isHoliday(date, r, holidays);
      if (h) hol[r] = h.name;
    }
    return {
      date,
      weekday: new Date(`${date}T00:00:00`).getDay(),
      weekOff: isWeeklyOff(date, rules.weekOffDays),
      holidays: hol,
      editable: gate.allowed && !lock,
      lockReason: lock ? "This month is locked." : gate.reason,
    };
  });

  const leaveByEmployee: Record<string, { date: string; type: string; status: string }[]> = {};
  for (const r of leave) {
    if (r.status !== "approved" && r.status !== "pending") continue;
    if (!regionOf.has(r.employeeId)) continue;
    for (let i = 0; i < n; i++) {
      const date = dateOf(month, i);
      if (r.fromDate <= date && r.toDate >= date) {
        (leaveByEmployee[r.employeeId] ||= []).push({ date, type: r.type, status: r.status });
      }
    }
  }

  const rows = scoped.employees.map((e) => {
    const row = register.get(e.id)!;
    const auto: number[] = [];
    const days = row.days.map((m, i) => {
      if (m) return m;
      const rm = ruleMark(dateOf(month, i), regionOf.get(e.id)!, e.id, rules, holidays, leave);
      if (rm) auto.push(i);
      return rm;
    });
    const filled = { ...row, days };
    return { ...filled, auto, totals: totalsFor(filled, month, rules) };
  });

  const departments = [...new Set(scoped.employees.map((e) => e.department).filter(Boolean))].sort();
  const plants = scoped.scope === "everyone"
    ? plantOptions().map((p) => ({ code: p.code, label: p.label }))
    : [];

  return NextResponse.json({
    month,
    today: localDate(now),
    days: n,
    marks: DAY_MARKS,
    rules,
    dayInfo,
    leaveByEmployee,
    holidaysThisMonth: holidays
      .filter((h) => h.date.startsWith(month))
      .map((h) => ({ date: h.date, name: h.name, regions: h.regions })),
    locked: Boolean(lock),
    lock,
    scope: scoped.scope,
    plant: scoped.scope === "plant" ? ctx.sessionPlant : null,
    plants,
    departments,
    canMarkOthers: scoped.scope !== "self",
    canApprove: ctx.perms.includes("attendance.approve"),
    canLock: ctx.perms.includes("attendance.approve"),
    canUnlock: isDeveloper(ctx),
    canConfigure: isDeveloper(ctx),
    canAnnounce: ctx.user.role === "developer" || ctx.user.role === "admin",
    employees: scoped.employees.map((e) => ({
      id: e.id, code: e.code, name: e.name, type: e.type,
      designation: e.designation, department: e.department, plant: e.plant,
      region: regionOf.get(e.id),
    })),
    rows,
  });
}

export async function PUT(req: NextRequest) {
  const ctx = await context(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  const month = String(body?.month || "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });
  const rules = loadRules();
  const now = new Date();
  if (month > localDate(now).slice(0, 7) && !rules.allowFutureMarks) {
    return NextResponse.json({ error: "That month hasn't started yet." }, { status: 400 });
  }

  const scoped = scopeFor(ctx);
  if (scoped.employees.length === 0) {
    return NextResponse.json({ error: "You have nobody to mark attendance for." }, { status: 403 });
  }

  if (monthLock(month)) {
    return NextResponse.json(
      { error: "This month is locked. Only the developer can unlock it." },
      { status: 409 }
    );
  }

  const n = daysInMonth(month);
  const byId = new Map(scoped.employees.map((e) => [e.id, e]));
  const stored = loadRegister(month, scoped.employees);
  const holidays = loadHolidays();
  const leave = loadLeave();
  const gates = Array.from({ length: n }, (_, i) => dayGate(dateOf(month, i), scoped.scope, now, rules).allowed);

  const incoming: AttendanceRow[] = Array.isArray(body.rows) ? body.rows : [];
  const cleaned: AttendanceRow[] = incoming
    // Out-of-scope rows are dropped, not trusted: a request holding another
    // plant's employee simply loses them.
    .filter((r) => r?.employeeId && byId.has(String(r.employeeId)))
    .map((r) => {
      const id = String(r.employeeId);
      const existing = stored.get(id)!;
      const region = regionForEmployee(byId.get(id)!.plant);
      return {
        employeeId: id,
        days: Array.from({ length: n }, (_, i) => {
          const v = Array.isArray(r.days) ? String(r.days[i] ?? "") : "";
          const asked = (VALID_MARKS.includes(v as DayMark) ? v : "") as DayMark;
          if (gates[i]) return asked;
          // A closed day keeps what was stored — except that a blank one
          // may take the mark the RULES give it (holiday / week off /
          // approved leave). That isn't an edit, and without it a Sunday
          // nobody could reach stays unpaid in payroll.
          const prev = (existing.days[i] || "") as DayMark;
          if (prev) return prev;
          // Future days are left to the rules of the day they arrive —
          // a week off changed later must not find old WOs already saved.
          if (dateOf(month, i) > localDate(now)) return "";
          const rm = ruleMark(dateOf(month, i), region, id, rules, holidays, leave);
          return asked && asked === rm ? rm : "";
        }),
        overtimeHours: Math.max(0, Math.min(400, Number(r.overtimeHours) || 0)),
        remark: String(r.remark || "").slice(0, 200),
      };
    });

  if (!cleaned.length) return NextResponse.json({ ok: true, rows: [] });

  saveRegisterRows(month, cleaned, (id) => byId.get(id)?.plant || "", ctx.user.name);
  recordAudit({
    action: "ATTENDANCE_SAVED",
    userId: ctx.user.id, userName: ctx.user.name, role: ctx.user.role,
    targetType: "attendance", targetLabel: month,
    detail: `${cleaned.length} employee row(s)${scoped.scope === "plant" ? ` · ${ctx.sessionPlant}` : ""}`,
    plant: scoped.scope === "plant" ? ctx.sessionPlant : null,
  });

  return NextResponse.json({
    ok: true,
    rows: cleaned.map((r) => ({ ...r, totals: totalsFor(r, month, rules) })),
  });
}

/** Lock (approvers) or unlock (developer only) a month. */
export async function POST(req: NextRequest) {
  const ctx = await context(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  const month = String(body?.month || "");
  const action = String(body?.action || "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month." }, { status: 400 });

  if (action === "lock") {
    if (!ctx.perms.includes("attendance.approve")) {
      return NextResponse.json({ error: "Only accounts, the admin or the developer can lock a month." }, { status: 403 });
    }
  } else if (action === "unlock") {
    if (!isDeveloper(ctx)) {
      return NextResponse.json({ error: "Only the developer can unlock a month." }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  setMonthLock(month, action === "lock", { id: ctx.user.id, name: ctx.user.name });
  recordAudit({
    action: action === "lock" ? "ATTENDANCE_MONTH_LOCKED" : "ATTENDANCE_MONTH_UNLOCKED",
    userId: ctx.user.id, userName: ctx.user.name, role: ctx.user.role,
    targetType: "attendance", targetLabel: month,
  });
  return NextResponse.json({ ok: true, lock: monthLock(month) });
}
