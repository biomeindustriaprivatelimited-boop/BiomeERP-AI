import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requirePermission, findById } from "@/lib/authServer";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadEmployees } from "@/lib/payroll";
import { loadMonth, totalsFor } from "@/lib/attendance";
import {
  loadLeave, loadRules, loadHolidays, regionForEmployee, chaseStageFor,
} from "@/lib/leave";
import { sendMail } from "@/lib/mailer";
import { templateById, fillTemplate } from "@/lib/letters";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attendance chasing.
 *
 * Who has not marked a day, and what should go to them. Reminders after
 * 3 PM (up to three), a warning after 1 PM the next day if there is still
 * nothing and no leave request.
 *
 * GET reports. POST sends. Deliberately not a background job: a system
 * that emails staff unattended will, the first time it is wrong, email
 * forty people a warning they did not earn. Accounts presses the button
 * and sees exactly who is on the list first.
 */

interface ChaseLog {
  [key: string]: { reminders: number; warned: boolean; lastAt: string };
}

function logFile() { return path.join(paths.root, "attendance", "chase-log.json"); }
function loadLog(): ChaseLog { return readJson<ChaseLog>(logFile(), {}); }
function saveLog(log: ChaseLog) {
  ensureDir(path.join(paths.root, "attendance"));
  writeJsonAtomic(logFile(), log);
}

function buildList(dateArg: string | null) {
  const now = new Date();
  const date = dateArg || now.toISOString().slice(0, 10);
  const month = date.slice(0, 7);
  const dayIndex = Number(date.slice(8, 10)) - 1;

  const rules = loadRules();
  const holidays = loadHolidays();
  const leave = loadLeave();
  const log = loadLog();
  const employees = loadEmployees().filter((e) => e.active);

  // The register is stored per plant, so all three files are read.
  const registers = [loadMonth(month, ""), loadMonth(month, "REW"), loadMonth(month, "GKD")];
  const marked = new Set<string>();
  for (const reg of registers) {
    for (const row of reg.rows) {
      if ((row.days?.[dayIndex] || "") !== "") marked.add(row.employeeId);
    }
  }

  return employees.map((e) => {
    const key = `${e.id}:${date}`;
    const entry = log[key] || { reminders: 0, warned: false, lastAt: "" };
    const region = regionForEmployee(e.plant);

    const hasLeaveRequest = leave.some(
      (r) =>
        r.employeeId === e.id &&
        (r.status === "pending" || r.status === "approved") &&
        r.fromDate <= date && r.toDate >= date
    );

    const { stage, reason } = chaseStageFor({
      date, now, region,
      hasAttendance: marked.has(e.id),
      hasLeaveRequest,
      remindersSent: entry.reminders,
      warningSent: entry.warned,
      rules, holidays,
    });

    return {
      employeeId: e.id, name: e.name, code: e.code, plant: e.plant,
      email: e.email, region,
      marked: marked.has(e.id), hasLeaveRequest,
      remindersSent: entry.reminders, warningSent: entry.warned,
      stage, reason,
      // Said plainly, because an employee with no address can never be
      // chased and somebody has to notice that.
      canEmail: Boolean(e.email),
    };
  });
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.approve");
  if ("response" in auth) return auth.response;

  const date = req.nextUrl.searchParams.get("date");
  const list = buildList(date);

  return NextResponse.json({
    date: date || new Date().toISOString().slice(0, 10),
    rules: loadRules(),
    people: list,
    due: {
      reminder: list.filter((p) => p.stage === "reminder").length,
      warning: list.filter((p) => p.stage === "warning").length,
      noEmail: list.filter((p) => p.stage !== "none" && !p.canEmail).length,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.approve");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => ({}));
  const date = String(body?.date || new Date().toISOString().slice(0, 10));
  const only: string[] | null = Array.isArray(body?.employeeIds) ? body.employeeIds : null;

  const list = buildList(date).filter(
    (p) => p.stage !== "none" && p.canEmail && (!only || only.includes(p.employeeId))
  );

  const log = loadLog();
  const results: { name: string; stage: string; ok: boolean; error?: string }[] = [];
  const prettyDate = new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  for (const p of list) {
    const isWarning = p.stage === "warning";

    const subject = isWarning
      ? `Attendance not recorded — ${prettyDate}`
      : `Reminder: please mark your attendance for ${prettyDate}`;

    let text: string;
    if (isWarning) {
      // The same wording as the letter template, so a warning by email and
      // a warning on paper say exactly the same thing.
      const template = templateById("attendance_warning");
      text = fillTemplate(template?.body || "", {
        employee_name: p.name, employee_code: p.code,
        incident_date: prettyDate,
        company_name: "Biome Industria Private Limited",
        issued_by: user.name,
        today: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }),
      });
    } else {
      text =
        `Dear ${p.name},\n\n` +
        `Your attendance for ${prettyDate} has not been marked in the BIOME app.\n\n` +
        `Please open the app and mark it. If you were not at work, raise a leave request for the day — that is all it takes, and it stops this reminder.\n\n` +
        `Attendance closes at 2:00 PM each day. After that only accounts can mark it for you.\n\n` +
        `If you are having trouble with the app, raise it under Help & Support and someone will sort it out.\n\n` +
        `Biome Industria Private Limited`;
    }

    const sent = await sendMail({ to: p.email!, subject, text });
    results.push({ name: p.name, stage: p.stage, ok: sent.ok, error: sent.error });

    if (sent.ok) {
      const key = `${p.employeeId}:${date}`;
      const entry = log[key] || { reminders: 0, warned: false, lastAt: "" };
      if (isWarning) entry.warned = true;
      else entry.reminders += 1;
      entry.lastAt = new Date().toISOString();
      log[key] = entry;

      recordAudit({
        action: isWarning ? "ATTENDANCE_WARNING_SENT" : "ATTENDANCE_REMINDER_SENT",
        userId: user.id, userName: user.name, role: user.role,
        targetType: "employee", targetId: p.employeeId, targetLabel: p.name,
        detail: `For ${date}${isWarning ? "" : ` · reminder ${entry.reminders}`}`,
        plant: p.plant || null,
      });
      // Gmail refuses a burst; a short gap keeps the run alive.
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  saveLog(log);

  return NextResponse.json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
  });
}
