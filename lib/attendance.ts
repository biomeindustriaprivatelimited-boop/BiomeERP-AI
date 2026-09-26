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
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

/**
 * Day marks. Deliberately few — a register with twenty codes gets filled
 * with whichever one is nearest the mouse.
 */
export type DayMark = "P" | "A" | "H" | "L" | "HD" | "OT" | "";

export const DAY_MARKS: { id: DayMark; label: string; paid: number; worked: number }[] = [
  { id: "P", label: "Present", paid: 1, worked: 1 },
  { id: "HD", label: "Half day", paid: 0.5, worked: 0.5 },
  { id: "L", label: "Paid leave", paid: 1, worked: 0 },
  { id: "H", label: "Weekly off / holiday", paid: 1, worked: 0 },
  { id: "A", label: "Absent", paid: 0, worked: 0 },
];

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

function file(month: string, plant: string): string {
  const safePlant = /^[A-Z]{0,4}$/.test(plant) ? plant : "";
  return path.join(paths.root, "attendance", `${month}${safePlant ? "-" + safePlant : ""}.json`);
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
  ensureDir(path.join(paths.root, "attendance"));
  writeJsonAtomic(file(data.month, data.plant), { ...data, updatedAt: new Date().toISOString() });
}

export function blankRow(employeeId: string, month: string): AttendanceRow {
  const n = daysInMonth(month);
  // Blank, not "present". Pre-filling a register with attendance nobody
  // recorded is how a month gets approved without anyone reading it.
  return { employeeId, days: Array(n).fill("") as DayMark[], overtimeHours: 0, remark: "" };
}

export interface AttendanceTotals {
  paidDays: number;
  daysWorked: number;
  present: number;
  absent: number;
  leave: number;
  holidays: number;
  halfDays: number;
  unmarked: number;
  overtimeHours: number;
}

export function totalsFor(row: AttendanceRow, month: string): AttendanceTotals {
  const n = daysInMonth(month);
  const t: AttendanceTotals = {
    paidDays: 0, daysWorked: 0, present: 0, absent: 0, leave: 0,
    holidays: 0, halfDays: 0, unmarked: 0, overtimeHours: row.overtimeHours || 0,
  };

  for (let i = 0; i < n; i++) {
    const mark = row.days[i] || "";
    const def = DAY_MARKS.find((d) => d.id === mark);
    if (!def) { t.unmarked += 1; continue; }
    t.paidDays += def.paid;
    t.daysWorked += def.worked;
    if (mark === "P") t.present += 1;
    else if (mark === "A") t.absent += 1;
    else if (mark === "L") t.leave += 1;
    else if (mark === "H") t.holidays += 1;
    else if (mark === "HD") t.halfDays += 1;
  }

  return t;
}
