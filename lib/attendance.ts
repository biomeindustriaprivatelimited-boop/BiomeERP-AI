/**
 * Biome Platform — attendance (server only)
 * -------------------------------------------------------------------
 * One record per employee per month, holding a day-by-day mark. Payroll
 * reads the totals from here so a salary sheet stops being retyped from a
 * register.
 *
 * Who fills what, as the business set it out:
 *   plant managers  — their own plant's staff and labour
 *   accounts        — their own, and anyone at head office
 *   coordinators    — their own
 *   admin           — everyone
 * A plant manager filling the other plant's register would defeat the same
 * separation the sheets already enforce, so scope is checked on the server.
 *
 * STORAGE (unchanged format, payroll reads it):
 *   attendance/<YYYY-MM>-<PLANT>.json   one file per plant
 *   attendance/<YYYY-MM>.json           people with no plant (head office)
 * Every row lives in the file of the employee's OWN plant, whoever saved
 * it. Earlier builds wrote the office/admin view into the plant-less file,
 * which left a plant manager and accounts looking at two different
 * registers for the same person; `loadRegister` still reads those legacy
 * rows and `saveRegisterRows` moves them home on the next save.
 */

import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadRules, loadHolidays, regionForEmployee, AttendanceRules } from "@/lib/leave";

/**
 * Day marks. Deliberately few — a register with twenty codes gets filled
 * with whichever one is nearest the mouse.
 */
export type DayMark = "P" | "A" | "H" | "L" | "HD" | "WO" | "LT" | "OT" | "";

export const DAY_MARKS: { id: DayMark; label: string; paid: number; worked: number }[] = [
  { id: "P", label: "Present", paid: 1, worked: 1 },
  { id: "LT", label: "Late", paid: 1, worked: 1 },
  { id: "HD", label: "Half day", paid: 0.5, worked: 0.5 },
  { id: "L", label: "Paid leave", paid: 1, worked: 0 },
  { id: "H", label: "Holiday", paid: 1, worked: 0 },
  { id: "WO", label: "Week off", paid: 1, worked: 0 },
  { id: "A", label: "Absent", paid: 0, worked: 0 },
];

export const VALID_MARKS: DayMark[] = ["P", "A", "H", "L", "HD", "WO", "LT", ""];

export interface AttendanceRow {
  employeeId: string;
  /** Index 0 is the 1st of the month. */
  days: DayMark[];
  overtimeHours: number;
  remark: string;
}

export interface AttendanceMonth {
  month: string;
  plant: string;
  rows: AttendanceRow[];
  /** Locked once payroll has been approved for the month. */
  locked: boolean;
  updatedAt: string;
  updatedByName: string;
}

/** Register file key for a plant code ("" = head office / no plant). */
export function registerKey(plant: string | null | undefined): string {
  const p = String(plant || "").toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(p) ? p : "";
}

function dir() { return path.join(paths.root, "attendance"); }

function file(month: string, plant: string): string {
  const safePlant = registerKey(plant);
  return path.join(dir(), `${month}${safePlant ? "-" + safePlant : ""}.json`);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function loadMonth(month: string, plant: string): AttendanceMonth {
  const stored = readJson<AttendanceMonth | null>(file(month, plant), null);
  if (stored && Array.isArray(stored.rows)) return stored;
  return { month, plant, rows: [], locked: false, updatedAt: "", updatedByName: "" };
}

export function saveMonth(data: AttendanceMonth): void {
  ensureDir(dir());
  writeJsonAtomic(file(data.month, data.plant), { ...data, updatedAt: new Date().toISOString() });
}

/** Every register file that exists for a month — including newer plants. */
export function loadAllRegisters(month: string): AttendanceMonth[] {
  const out: AttendanceMonth[] = [loadMonth(month, "")];
  try {
    for (const f of fs.readdirSync(dir())) {
      const m = f.match(/^(\d{4}-\d{2})-([A-Z0-9]{1,8})\.json$/);
      if (m && m[1] === month) out.push(loadMonth(month, m[2]));
    }
  } catch { /* no attendance folder yet */ }
  return out;
}

export function blankRow(employeeId: string, month: string): AttendanceRow {
  const n = daysInMonth(month);
  // Blank, not "present". Pre-filling a register with attendance nobody
  // recorded is how a month gets approved without anyone reading it.
  return { employeeId, days: Array(n).fill("") as DayMark[], overtimeHours: 0, remark: "" };
}

const marksIn = (r: AttendanceRow | undefined) => (r?.days || []).filter((d) => d).length;

/**
 * The register for a set of employees, one row each, read from wherever
 * the row lives. The employee's own plant file wins; a legacy row in the
 * plant-less file is used only when the plant file has nothing marked.
 */
export function loadRegister(
  month: string,
  employees: { id: string; plant: string }[]
): Map<string, AttendanceRow> {
  const cache = new Map<string, AttendanceMonth>();
  const reg = (key: string) => {
    if (!cache.has(key)) cache.set(key, loadMonth(month, key));
    return cache.get(key)!;
  };
  const out = new Map<string, AttendanceRow>();
  for (const e of employees) {
    const key = registerKey(e.plant);
    const own = reg(key).rows.find((r) => r.employeeId === e.id);
    const legacy = key ? reg("").rows.find((r) => r.employeeId === e.id) : undefined;
    const pick = own && (marksIn(own) > 0 || !legacy || marksIn(legacy) === 0) ? own : legacy || own;
    out.set(e.id, normaliseRow(pick, e.id, month));
  }
  return out;
}

function normaliseRow(r: AttendanceRow | undefined, employeeId: string, month: string): AttendanceRow {
  const n = daysInMonth(month);
  if (!r) return blankRow(employeeId, month);
  return {
    employeeId,
    days: Array.from({ length: n }, (_, i) => {
      const v = String(r.days?.[i] ?? "") as DayMark;
      return VALID_MARKS.includes(v) ? v : "";
    }),
    overtimeHours: Number(r.overtimeHours) || 0,
    remark: String(r.remark || ""),
  };
}

/**
 * Write rows into each employee's own plant file, and drop any legacy copy
 * from the plant-less file so payroll never reads two versions.
 */
export function saveRegisterRows(
  month: string,
  rows: AttendanceRow[],
  plantOf: (employeeId: string) => string,
  byName: string
): void {
  const byKey = new Map<string, AttendanceRow[]>();
  for (const r of rows) {
    const key = registerKey(plantOf(r.employeeId));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const moved = new Set<string>();
  for (const [key, list] of byKey) {
    const stored = loadMonth(month, key);
    const ids = new Set(list.map((r) => r.employeeId));
    if (key) list.forEach((r) => moved.add(r.employeeId));
    saveMonth({
      ...stored,
      month,
      plant: key,
      rows: [...stored.rows.filter((r) => !ids.has(r.employeeId)), ...list],
      updatedAt: new Date().toISOString(),
      updatedByName: byName,
    });
  }
  if (moved.size) {
    const legacy = loadMonth(month, "");
    if (legacy.rows.some((r) => moved.has(r.employeeId))) {
      saveMonth({ ...legacy, rows: legacy.rows.filter((r) => !moved.has(r.employeeId)) });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Month lock                                                          */
/* ------------------------------------------------------------------ */

export interface MonthLock { locked: boolean; by: string; byName: string; at: string; }

function locksFile() { return path.join(dir(), "locks.json"); }

export function loadLocks(): Record<string, MonthLock> {
  return readJson<Record<string, MonthLock>>(locksFile(), {});
}

/** A month is locked by the lock file, or by an older register flag. */
export function monthLock(month: string): MonthLock | null {
  const l = loadLocks()[month];
  if (l?.locked) return l;
  if (loadAllRegisters(month).some((r) => r.locked)) {
    return { locked: true, by: "", byName: "payroll", at: "" };
  }
  return null;
}

export function setMonthLock(month: string, locked: boolean, by: { id: string; name: string }): void {
  ensureDir(dir());
  const locks = loadLocks();
  locks[month] = { locked, by: by.id, byName: by.name, at: new Date().toISOString() };
  writeJsonAtomic(locksFile(), locks);
  // Keep the per-file flag in step so older readers agree.
  for (const reg of loadAllRegisters(month)) {
    if (reg.rows.length && reg.locked !== locked) saveMonth({ ...reg, locked });
  }
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

export interface AttendanceTotals {
  paidDays: number;
  daysWorked: number;
  present: number;
  absent: number;
  leave: number;
  holidays: number;
  weekOffs: number;
  halfDays: number;
  late: number;
  /** Pay cut for repeated late marks (rules.latesPerHalfDay). */
  lateDeduction: number;
  unmarked: number;
  overtimeHours: number;
}

export function totalsFor(
  row: AttendanceRow,
  month: string,
  rules: Pick<AttendanceRules, "latesPerHalfDay"> = loadRules()
): AttendanceTotals {
  const n = daysInMonth(month);
  const t: AttendanceTotals = {
    paidDays: 0, daysWorked: 0, present: 0, absent: 0, leave: 0, holidays: 0, weekOffs: 0,
    halfDays: 0, late: 0, lateDeduction: 0, unmarked: 0, overtimeHours: row.overtimeHours || 0,
  };

  for (let i = 0; i < n; i++) {
    const mark = row.days[i] || "";
    const def = DAY_MARKS.find((d) => d.id === mark);
    if (!def) { t.unmarked += 1; continue; }
    t.paidDays += def.paid;
    t.daysWorked += def.worked;
    if (mark === "P") t.present += 1;
    else if (mark === "LT") { t.present += 1; t.late += 1; }
    else if (mark === "A") t.absent += 1;
    else if (mark === "L") t.leave += 1;
    else if (mark === "H") t.holidays += 1;
    else if (mark === "WO") t.weekOffs += 1;
    else if (mark === "HD") t.halfDays += 1;
  }

  if (rules.latesPerHalfDay > 0 && t.late >= rules.latesPerHalfDay) {
    t.lateDeduction = Math.floor(t.late / rules.latesPerHalfDay) * 0.5;
    t.paidDays = Math.max(0, t.paidDays - t.lateDeduction);
  }

  return t;
}

/* ------------------------------------------------------------------ */
/* Holidays into the register                                          */
/* ------------------------------------------------------------------ */

/**
 * Writes H on the given dates for every active employee whose plant follows
 * one of `regions`. Only blank days are touched — a person who actually
 * worked the holiday keeps their P — and a locked month is left alone.
 * Returns how many cells were set.
 */
export function applyHolidayToRegisters(
  dates: string[],
  regions: string[],
  employees: { id: string; plant: string; active: boolean }[],
  byName: string
): number {
  if (!loadRules().autoMarkHolidays) return 0;
  const people = employees.filter((e) => e.active && regions.includes(regionForEmployee(e.plant)));
  if (!people.length) return 0;
  let set = 0;
  const byMonth = new Map<string, string[]>();
  for (const d of dates) {
    const m = d.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(d);
  }
  for (const [month, ds] of byMonth) {
    if (monthLock(month)) continue;
    const reg = loadRegister(month, people);
    const changed: AttendanceRow[] = [];
    for (const p of people) {
      const row = reg.get(p.id)!;
      let touched = false;
      for (const d of ds) {
        const i = Number(d.slice(8, 10)) - 1;
        if (!row.days[i]) { row.days[i] = "H"; touched = true; set += 1; }
      }
      if (touched) changed.push(row);
    }
    if (changed.length) {
      const plantOf = new Map(people.map((p) => [p.id, p.plant]));
      saveRegisterRows(month, changed, (id) => plantOf.get(id) || "", byName);
    }
  }
  return set;
}

/** Undo for a removed holiday: H back to blank on that date (unlocked months only). */
export function clearHolidayFromRegisters(
  date: string,
  regions: string[],
  employees: { id: string; plant: string; active: boolean }[],
  byName: string
): number {
  const month = date.slice(0, 7);
  if (monthLock(month)) return 0;
  // Another holiday on the same date for the same region keeps its H.
  const still = loadHolidays().filter((h) => h.date === date).flatMap((h) => h.regions);
  const people = employees.filter((e) => {
    const r = regionForEmployee(e.plant);
    return regions.includes(r) && !still.includes(r);
  });
  if (!people.length) return 0;
  const reg = loadRegister(month, people);
  const i = Number(date.slice(8, 10)) - 1;
  const changed: AttendanceRow[] = [];
  for (const p of people) {
    const row = reg.get(p.id)!;
    if (row.days[i] === "H") { row.days[i] = ""; changed.push(row); }
  }
  if (changed.length) {
    const plantOf = new Map(people.map((p) => [p.id, p.plant]));
    saveRegisterRows(month, changed, (id) => plantOf.get(id) || "", byName);
  }
  return changed.length;
}
