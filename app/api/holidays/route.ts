import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, requirePermission } from "@/lib/authServer";
import {
  loadHolidays, saveHolidays, Holiday, HolidayRegion, REGION_LABEL, datesBetween,
} from "@/lib/leave";
import { recordAudit } from "@/lib/audit";
import { loadEmployees } from "@/lib/payroll";
import { applyHolidayToRegisters, clearHolidayFromRegisters } from "@/lib/attendance";
import type { Role } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGIONS: HolidayRegion[] = ["HR", "MH", "DL"];

/**
 * Announcing, changing or removing a holiday is the DEVELOPER's and the
 * ADMIN's alone — the business asked for it to disappear from the plant
 * manager's screens, and a hidden button is not a control, so the API
 * checks the role too. Everyone signed in still READS the calendar.
 */
const HOLIDAY_EDIT_ROLES: Role[] = ["developer", "admin"];

async function requireHolidayEditor(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth;
  const user = findById(auth.session.uid)!;
  if (!HOLIDAY_EDIT_ROLES.includes(user.role)) {
    return {
      response: NextResponse.json(
        { error: "Only the developer or the admin can announce or change holidays." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Anyone signed in may READ the calendar; only an admin may change it. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const holidays = [...loadHolidays()].sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    holidays,
    regions: REGIONS.map((r) => ({ id: r, label: REGION_LABEL[r] })),
    canEdit: HOLIDAY_EDIT_ROLES.includes(user.role),
    unconfirmed: holidays.filter((h) => h.confirm).length,
  });
}

/**
 * Add one holiday, or a whole shutdown period.
 *
 * A range is stored as one entry per day rather than as a start/end pair.
 * It costs a few more rows and makes everything downstream simple: the
 * attendance grid, the leave calculation and the chase runner all ask the
 * same question — "is this date a holiday?" — and none of them has to
 * understand ranges.
 */
export async function POST(req: NextRequest) {
  const auth = await requireHolidayEditor(req);
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const name = String(body.name || "").trim().slice(0, 80);
  const from = String(body.date || body.fromDate || "").slice(0, 10);
  const to = String(body.toDate || from).slice(0, 10);
  const regions: HolidayRegion[] = Array.isArray(body.regions)
    ? body.regions.filter((r: string) => REGIONS.includes(r as HolidayRegion))
    : [];
  const confirm = Boolean(body.confirm);

  if (!name) return NextResponse.json({ error: "Give the holiday a name." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "Choose the date." }, { status: 400 });
  }
  if (to < from) return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  if (regions.length === 0) {
    return NextResponse.json({ error: "Choose at least one location this applies to." }, { status: 400 });
  }

  const dates = datesBetween(from, to);
  if (dates.length > 60) {
    return NextResponse.json({ error: "That range is longer than 60 days. Add it in shorter blocks." }, { status: 400 });
  }

  const holidays = loadHolidays();
  const added: Holiday[] = [];
  const skipped: string[] = [];

  for (const date of dates) {
    const clash = holidays.find((h) => h.date === date && h.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      // Same day, same name — merge the regions rather than making a
      // duplicate row that the calendar would show twice.
      clash.regions = [...new Set([...clash.regions, ...regions])];
      skipped.push(date);
      continue;
    }
    const entry: Holiday = { date, name, regions, confirm };
    holidays.push(entry);
    added.push(entry);
  }

  saveHolidays(holidays.sort((a, b) => a.date.localeCompare(b.date)));
  // An announced holiday lands in the attendance register as H for every
  // blank day of the people it applies to (rules.autoMarkHolidays).
  const marked = applyHolidayToRegisters(dates, regions, loadEmployees(), user.name);
  recordAudit({
    action: "HOLIDAY_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "holiday", targetLabel: name,
    detail: `${from}${to !== from ? ` to ${to}` : ""} · ${regions.join(", ")}${added.length > 1 ? ` · ${added.length} days` : ""}`,
  });

  return NextResponse.json({
    added: added.length,
    merged: skipped.length,
    attendanceMarked: marked,
    holidays: loadHolidays().sort((a, b) => a.date.localeCompare(b.date)),
  }, { status: 201 });
}

/** Edit one entry — including confirming a movable date. */
export async function PUT(req: NextRequest) {
  const auth = await requireHolidayEditor(req);
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const body = await req.json().catch(() => null);
  const originalDate = String(body?.originalDate || "").slice(0, 10);
  const originalName = String(body?.originalName || "");
  if (!originalDate || !originalName) {
    return NextResponse.json({ error: "Which entry?" }, { status: 400 });
  }

  const holidays = loadHolidays();
  const entry = holidays.find((h) => h.date === originalDate && h.name === originalName);
  if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const beforeRegions = [...entry.regions];

  if (body.date !== undefined) {
    const d = String(body.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    entry.date = d;
  }
  if (body.name !== undefined && String(body.name).trim()) entry.name = String(body.name).trim().slice(0, 80);
  if (Array.isArray(body.regions)) {
    const next = body.regions.filter((r: string) => REGIONS.includes(r as HolidayRegion));
    if (next.length === 0) {
      return NextResponse.json({ error: "A holiday must apply to at least one location." }, { status: 400 });
    }
    entry.regions = next;
  }
  // Confirming is the whole point of the flag — once checked against the
  // gazette it should stop shouting.
  if (body.confirm !== undefined) entry.confirm = Boolean(body.confirm);

  saveHolidays(holidays.sort((a, b) => a.date.localeCompare(b.date)));
  // A moved date: the old day's H comes off, the new day's goes on.
  if (entry.date !== originalDate) {
    const staff = loadEmployees();
    clearHolidayFromRegisters(originalDate, beforeRegions, staff, user.name);
    applyHolidayToRegisters([entry.date], entry.regions, staff, user.name);
  } else if (Array.isArray(body.regions)) {
    applyHolidayToRegisters([entry.date], entry.regions, loadEmployees(), user.name);
  }
  recordAudit({
    action: body.confirm === false ? "HOLIDAY_CONFIRMED" : "HOLIDAY_UPDATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "holiday", targetLabel: `${entry.date} ${entry.name}`,
  });

  return NextResponse.json({ holidays: loadHolidays().sort((a, b) => a.date.localeCompare(b.date)) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireHolidayEditor(req);
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const date = req.nextUrl.searchParams.get("date") || "";
  const name = req.nextUrl.searchParams.get("name") || "";
  if (!date || !name) return NextResponse.json({ error: "Which entry?" }, { status: 400 });

  const holidays = loadHolidays();
  const before = holidays.length;
  const next = holidays.filter((h) => !(h.date === date && h.name === name));
  if (next.length === before) return NextResponse.json({ error: "Not found." }, { status: 404 });

  saveHolidays(next);
  const removed = holidays.find((h) => h.date === date && h.name === name);
  if (removed) clearHolidayFromRegisters(date, removed.regions, loadEmployees(), user.name);
  recordAudit({
    action: "HOLIDAY_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "holiday", targetLabel: `${date} ${name}`,
  });

  return NextResponse.json({ holidays: next });
}
