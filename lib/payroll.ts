/**
 * Biome Platform — payroll (server only)
 * -------------------------------------------------------------------
 * The calculation engine is deliberately separate from the store and the
 * routes: `computePayslip` is pure, so it can be tested without a file
 * system, and a wrong salary is the one bug in this app that reaches a
 * person's bank account.
 *
 * Every statutory rate is CONFIGURABLE and merely SEEDED with the current
 * Indian defaults. Rates change by notification; a hard-coded 12% becomes
 * wrong silently, and silence is the failure mode to avoid here.
 *
 * The two plants sit in different states — Rewari in Haryana, Gangakhed in
 * Maharashtra — and professional tax is a state subject. That is why PT is
 * held per plant rather than as one company-wide number.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export type EmployeeType = "staff" | "labour";
export type PayrollRunStatus = "draft" | "approved" | "paid";

/* ------------------------------------------------------------------ */
/* Statutory configuration                                             */
/* ------------------------------------------------------------------ */

export interface PayrollSettings {
  pf: {
    enabled: boolean;
    /** Employee share, per cent of PF wages. */
    employeeRate: number;
    /** Employer share, per cent of PF wages. */
    employerRate: number;
    /** Of the employer share, the part that goes to the pension scheme. */
    pensionRate: number;
    /** PF wages are capped at this monthly figure unless the employee opts out. */
    wageCeiling: number;
    /** Apply the ceiling, or compute on full PF wages. */
    applyCeiling: boolean;
    adminChargeRate: number;
    edliRate: number;
  };
  esic: {
    enabled: boolean;
    employeeRate: number;
    employerRate: number;
    /** ESIC applies only while gross stays at or under this. */
    grossCeiling: number;
  };
  /** Professional tax by plant code. Haryana has none; Maharashtra does. */
  professionalTax: Record<string, { enabled: boolean; slabs: { upTo: number; amount: number }[] }>;
  /** A month's paid days are computed against this. */
  dayBasis: "calendar" | "fixed26" | "fixed30";
  overtime: {
    enabled: boolean;
    /** Multiplier on the ordinary hourly rate. Statutory minimum is 2x. */
    multiplier: number;
    /** Hours in a standard working day, used to derive the hourly rate. */
    hoursPerDay: number;
  };
  updatedAt?: string;
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  pf: {
    enabled: true,
    employeeRate: 12,
    employerRate: 12,
    pensionRate: 8.33,
    wageCeiling: 15000,
    applyCeiling: true,
    adminChargeRate: 0.5,
    edliRate: 0.5,
  },
  esic: {
    enabled: true,
    employeeRate: 0.75,
    employerRate: 3.25,
    grossCeiling: 21000,
  },
  professionalTax: {
    // Haryana levies no professional tax.
    REW: { enabled: false, slabs: [] },
    // Maharashtra's usual monthly slabs. February differs for the top slab,
    // which is handled in the calculation rather than the table.
    GKD: {
      enabled: true,
      slabs: [
        { upTo: 7500, amount: 0 },
        { upTo: 10000, amount: 175 },
        { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
      ],
    },
  },
  dayBasis: "calendar",
  overtime: { enabled: true, multiplier: 2, hoursPerDay: 8 },
};

/* ------------------------------------------------------------------ */
/* Employees                                                           */
/* ------------------------------------------------------------------ */

export interface SalaryStructure {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special: number;
  /** Anything the business calls its own. Kept open rather than guessed at. */
  otherAllowances: { label: string; amount: number }[];
}

/**
 * Personal and statutory identity for an employee.
 *
 * Kept on the employee record rather than in a separate KYC store, because
 * two masters for one person drift apart and then nobody knows which is
 * right. Everything here is business data the company already holds on
 * paper; it lives in the same data folder, so one backup covers it.
 */
export interface EmployeeKyc {
  fatherOrSpouse: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  bloodGroup: string;
  personalPhone: string;
  emergencyName: string;
  emergencyPhone: string;
  address: string;
  aadhaar: string;
  pan: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  /** Skill grade — decides which minimum-wage floor applies. */
  skillCategory: "unskilled" | "semiskilled" | "skilled" | "highlyskilled";
}

export interface EmployeeFile {
  id: string;
  /** Aadhaar, PAN, photo, cancelled cheque, qualification, and so on. */
  category: string;
  name: string;
  type: string;
  size: number;
  /** Path relative to the payroll documents folder. */
  file: string;
  uploadedAt: string;
  uploadedByName: string;
}

/** A letter issued to the employee — joining, appraisal, experience. */
export interface EmployeeLetter {
  id: string;
  kind: string;
  title: string;
  /** The letter body as written, so a reissue reproduces the same words. */
  body: string;
  issuedOn: string;
  issuedByName: string;
  /** Set once a signed copy is uploaded back. */
  signedFile: string | null;
}

export const DOCUMENT_CATEGORIES = [
  "Aadhaar card", "PAN card", "Photograph", "Cancelled cheque",
  "Bank passbook", "Qualification certificate", "Experience letter",
  "Police verification", "Medical certificate", "Contract / agreement", "Other",
] as const;

export const LETTER_KINDS = [
  "Joining letter", "Appointment letter", "Appraisal letter",
  "Increment letter", "Confirmation letter", "Experience letter",
  "Relieving letter", "Warning letter", "Other",
] as const;

export function blankKyc(): EmployeeKyc {
  return {
    fatherOrSpouse: "", dateOfBirth: "", gender: "", maritalStatus: "",
    bloodGroup: "", personalPhone: "", emergencyName: "", emergencyPhone: "",
    address: "", aadhaar: "", pan: "", bankName: "", bankAccount: "",
    bankIfsc: "", skillCategory: "unskilled",
  };
}

export interface PayrollEmployee {
  id: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  plant: string;
  type: EmployeeType;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  active: boolean;

  /** Staff are paid a monthly structure. */
  structure: SalaryStructure;
  /** Labour are paid per day worked. */
  dailyWage: number;

  pfApplicable: boolean;
  /** Some employees are on a higher voluntary PF wage; blank means use the rules. */
  pfWageOverride: number | null;
  esicApplicable: boolean;
  uan: string;
  esicNumber: string;

  /** Fixed monthly deductions the business already agreed with the person. */
  recurringDeductions: { label: string; amount: number }[];

  /** Masters, stored by name so a payslip printed later still reads right. */
  workLocation: string;

  kyc: EmployeeKyc;
  documents: EmployeeFile[];
  letters: EmployeeLetter[];

  /** Work email, used for payslips. */
  email: string;

  /**
   * Set when a PLANT MANAGER put this person on the rolls: the record
   * stays inactive and out of every normal list until an admin or the
   * developer approves it. Absent on records added by the office (and on
   * everything created before this existed) — those count as approved.
   */
  approval?: EmployeeApproval;

  createdAt: string;
  updatedAt: string;
}

export type EmployeeApprovalStatus = "pending_approval" | "approved" | "rejected" | "withdrawn";

export interface EmployeeApproval {
  status: EmployeeApprovalStatus;
  requestedBy: { uid: string; name: string; plant: string };
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Why it was rejected (required) or withdrawn. */
  reason: string | null;
}

/** On the rolls for real — not a pending, rejected or withdrawn request. */
export function isApprovedEmployee(e: Pick<PayrollEmployee, "approval">): boolean {
  return !e.approval || e.approval.status === "approved";
}

/* ------------------------------------------------------------------ */
/* Attendance and the computed payslip                                 */
/* ------------------------------------------------------------------ */

export interface AttendanceInput {
  employeeId: string;
  /** Days actually paid for, including paid leave. */
  paidDays: number;
  /** Days present, used for labour who are paid per day worked. */
  daysWorked: number;
  overtimeHours: number;
  /** Anything ad hoc for this month only. */
  bonus: number;
  incentive: number;
  advanceDeduction: number;
  /** Manual TDS. Income-tax computation is not attempted here — see notes. */
  tds: number;
  otherDeduction: number;
  otherDeductionLabel: string;
  remark: string;
}

export interface PayslipLine { label: string; amount: number; }

export interface Payslip {
  employeeId: string;
  code: string;
  name: string;
  designation: string;
  plant: string;
  type: EmployeeType;
  month: string;

  monthDays: number;
  paidDays: number;
  daysWorked: number;
  overtimeHours: number;

  earnings: PayslipLine[];
  grossEarnings: number;

  deductions: PayslipLine[];
  totalDeductions: number;

  /** What the business pays on top — never deducted from the person. */
  employerContributions: PayslipLine[];
  employerCost: number;

  netPay: number;
  /** Anything the preparer should look at before releasing the month. */
  warnings: string[];
}

function round(n: number): number {
  // Rupees to two places at every step; a half-paisa drift across 40 people
  // becomes a reconciliation the accountant has to chase.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Whole rupees, the way statutory challans want them. */
function rupees(n: number): number {
  return Math.round(n);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function basisDays(month: string, settings: PayrollSettings): number {
  if (settings.dayBasis === "fixed26") return 26;
  if (settings.dayBasis === "fixed30") return 30;
  return daysInMonth(month);
}

function professionalTaxFor(plant: string, gross: number, month: string, settings: PayrollSettings): number {
  const rule = settings.professionalTax[plant];
  if (!rule?.enabled || rule.slabs.length === 0) return 0;

  const sorted = [...rule.slabs].sort((a, b) => a.upTo - b.upTo);
  const slab = sorted.find((s) => gross <= s.upTo) ?? sorted[sorted.length - 1];
  let amount = slab.amount;

  // Maharashtra collects the annual balance in February for the top slab.
  // Ignoring this under-deducts every year and the shortfall lands on the
  // employer at assessment.
  const isFebruary = month.slice(5, 7) === "02";
  if (isFebruary && amount === 200) amount = 300;

  return amount;
}

/**
 * Compute one payslip.
 *
 * Pure: same inputs, same outputs, no file system, no clock. That is what
 * makes it testable, and this is the function most worth testing.
 */
export function computePayslip(
  employee: PayrollEmployee,
  attendance: AttendanceInput,
  month: string,
  settings: PayrollSettings
): Payslip {
  const warnings: string[] = [];
  const monthDays = daysInMonth(month);
  const basis = basisDays(month, settings);

  const paidDays = Math.max(0, Math.min(attendance.paidDays, monthDays));
  const daysWorked = Math.max(0, Math.min(attendance.daysWorked, monthDays));
  if (attendance.paidDays > monthDays) {
    warnings.push(`Paid days were capped at ${monthDays} — the month has no more.`);
  }

  const earnings: PayslipLine[] = [];

  if (employee.type === "labour") {
    // Paid for days actually worked; there is no monthly structure to prorate.
    const wage = round(employee.dailyWage * daysWorked);
    earnings.push({ label: `Wages (${daysWorked} days × ₹${employee.dailyWage})`, amount: wage });
    if (employee.dailyWage <= 0) warnings.push("No daily wage is set for this worker.");
  } else {
    // Staff structure, prorated on paid days.
    const factor = basis > 0 ? paidDays / basis : 0;
    const s = employee.structure;
    const add = (label: string, full: number) => {
      if (full > 0) earnings.push({ label, amount: round(full * factor) });
    };
    add("Basic", s.basic);
    add("HRA", s.hra);
    add("Conveyance", s.conveyance);
    add("Medical", s.medical);
    add("Special allowance", s.special);
    for (const a of s.otherAllowances) add(a.label || "Allowance", a.amount);
    if (s.basic <= 0) warnings.push("No basic pay is set for this employee.");
  }

  // Overtime, on the ordinary rate derived from the same basis.
  if (settings.overtime.enabled && attendance.overtimeHours > 0) {
    const ordinaryDaily =
      employee.type === "labour"
        ? employee.dailyWage
        : (employee.structure.basic + employee.structure.special) / basis;
    const hourly = ordinaryDaily / Math.max(1, settings.overtime.hoursPerDay);
    const ot = round(hourly * settings.overtime.multiplier * attendance.overtimeHours);
    earnings.push({ label: `Overtime (${attendance.overtimeHours} hrs)`, amount: ot });
  }

  if (attendance.bonus > 0) earnings.push({ label: "Bonus", amount: round(attendance.bonus) });
  if (attendance.incentive > 0) earnings.push({ label: "Incentive", amount: round(attendance.incentive) });

  const grossEarnings = round(earnings.reduce((sum, e) => sum + e.amount, 0));

  /* ---- PF ---------------------------------------------------------- */
  const deductions: PayslipLine[] = [];
  const employerContributions: PayslipLine[] = [];

  let pfWages = 0;
  if (settings.pf.enabled && employee.pfApplicable) {
    // PF wages are basic + DA. This business has no separate DA line, so
    // basic is it for staff, and the day-wage earning for labour.
    const rawPfWages =
      employee.pfWageOverride !== null && employee.pfWageOverride >= 0
        ? employee.pfWageOverride
        : employee.type === "labour"
        ? round(employee.dailyWage * daysWorked)
        : round(employee.structure.basic * (basis > 0 ? paidDays / basis : 0));

    pfWages = settings.pf.applyCeiling
      ? Math.min(rawPfWages, round(settings.pf.wageCeiling * (basis > 0 ? Math.min(paidDays, basis) / basis : 0)))
      : rawPfWages;

    const employeePf = rupees((pfWages * settings.pf.employeeRate) / 100);
    const pension = rupees((pfWages * settings.pf.pensionRate) / 100);
    const employerPf = rupees((pfWages * settings.pf.employerRate) / 100) - pension;

    if (employeePf > 0) deductions.push({ label: "Provident Fund (employee)", amount: employeePf });
    if (pension > 0) employerContributions.push({ label: "EPS — pension (employer)", amount: pension });
    if (employerPf > 0) employerContributions.push({ label: "EPF (employer)", amount: employerPf });

    const admin = rupees((pfWages * settings.pf.adminChargeRate) / 100);
    const edli = rupees((pfWages * settings.pf.edliRate) / 100);
    if (admin > 0) employerContributions.push({ label: "PF admin charges", amount: admin });
    if (edli > 0) employerContributions.push({ label: "EDLI", amount: edli });

    if (!employee.uan) warnings.push("No UAN recorded — the ECR upload will reject this line.");
  }

  /* ---- ESIC -------------------------------------------------------- */
  if (settings.esic.enabled && employee.esicApplicable) {
    if (grossEarnings <= settings.esic.grossCeiling) {
      // ESIC rounds the employee share up to the next rupee by rule.
      const employeeEsic = Math.ceil((grossEarnings * settings.esic.employeeRate) / 100);
      const employerEsic = Math.ceil((grossEarnings * settings.esic.employerRate) / 100);
      if (employeeEsic > 0) deductions.push({ label: "ESIC (employee)", amount: employeeEsic });
      if (employerEsic > 0) employerContributions.push({ label: "ESIC (employer)", amount: employerEsic });
      if (!employee.esicNumber) warnings.push("No ESIC number recorded for this employee.");
    } else {
      // Crossing the ceiling mid-contribution-period does not stop ESIC
      // until the period ends, so this is flagged rather than silently applied.
      warnings.push(
        `Gross ₹${grossEarnings.toLocaleString("en-IN")} is above the ESIC ceiling, so no ESIC was deducted. If this person was covered at the start of the contribution period, they stay covered until it ends — check before releasing.`
      );
    }
  }

  /* ---- Professional tax, advances, TDS ------------------------------ */
  const pt = professionalTaxFor(employee.plant, grossEarnings, month, settings);
  if (pt > 0) deductions.push({ label: "Professional tax", amount: pt });

  for (const d of employee.recurringDeductions) {
    if (d.amount > 0) deductions.push({ label: d.label || "Deduction", amount: round(d.amount) });
  }

  if (attendance.advanceDeduction > 0) {
    deductions.push({ label: "Advance recovery", amount: round(attendance.advanceDeduction) });
  }
  if (attendance.tds > 0) deductions.push({ label: "TDS", amount: round(attendance.tds) });
  if (attendance.otherDeduction > 0) {
    deductions.push({
      label: attendance.otherDeductionLabel || "Other deduction",
      amount: round(attendance.otherDeduction),
    });
  }

  const totalDeductions = round(deductions.reduce((sum, d) => sum + d.amount, 0));
  const netPay = round(grossEarnings - totalDeductions);
  const employerCost = round(
    grossEarnings + employerContributions.reduce((sum, c) => sum + c.amount, 0)
  );

  // A negative net means the recoveries exceed the month's pay. It is
  // allowed to compute, but it must never be released without a look.
  if (netPay < 0) {
    warnings.push("Deductions exceed this month's earnings — net pay is negative. Reduce the recovery.");
  }
  if (paidDays === 0 && daysWorked === 0 && employee.active) {
    warnings.push("No paid days recorded, so this person earns nothing this month.");
  }

  return {
    employeeId: employee.id,
    code: employee.code,
    name: employee.name,
    designation: employee.designation,
    plant: employee.plant,
    type: employee.type,
    month,
    monthDays,
    paidDays,
    daysWorked,
    overtimeHours: attendance.overtimeHours,
    earnings,
    grossEarnings,
    deductions,
    totalDeductions,
    employerContributions,
    employerCost,
    netPay,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export interface PayrollRun {
  id: string;
  month: string;
  plant: string;
  status: PayrollRunStatus;
  attendance: AttendanceInput[];
  /** Frozen at approval, so a later change to a salary cannot rewrite history. */
  payslips: Payslip[];
  settingsSnapshot: PayrollSettings | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  note: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

function payrollDir() { return path.join(paths.root, "payroll"); }
function employeesFile() { return path.join(payrollDir(), "employees.json"); }
function settingsFile() { return path.join(payrollDir(), "settings.json"); }
function runsFile() { return path.join(payrollDir(), "runs.json"); }

export function loadSettings(): PayrollSettings {
  const stored = readJson<Partial<PayrollSettings>>(settingsFile(), {});
  // Merged rather than replaced, so a settings file written by an older
  // version still gets any keys added since.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    pf: { ...DEFAULT_SETTINGS.pf, ...(stored.pf || {}) },
    esic: { ...DEFAULT_SETTINGS.esic, ...(stored.esic || {}) },
    overtime: { ...DEFAULT_SETTINGS.overtime, ...(stored.overtime || {}) },
    professionalTax: { ...DEFAULT_SETTINGS.professionalTax, ...(stored.professionalTax || {}) },
  };
}

export function saveSettings(settings: PayrollSettings): void {
  ensureDir(payrollDir());
  writeJsonAtomic(settingsFile(), { ...settings, updatedAt: new Date().toISOString() });
}

function readEmployeeFile(): PayrollEmployee[] {
  const f = readJson<{ employees: PayrollEmployee[] }>(employeesFile(), { employees: [] });
  return Array.isArray(f.employees) ? f.employees.map(normaliseEmployee) : [];
}

/**
 * The employee master.
 *
 * By default ONLY approved people — a plant manager's pending (or
 * rejected / withdrawn) request is invisible to attendance, leave,
 * imprest, payroll, letters and every other reader, so nothing can be
 * filed against someone the office has not accepted. The Employees
 * screen and its approval flow pass `includeRequests: true`.
 */
export function loadEmployees(opts?: { includeRequests?: boolean }): PayrollEmployee[] {
  const all = readEmployeeFile();
  return opts?.includeRequests ? all : all.filter(isApprovedEmployee);
}

/**
 * Most callers load the default (approved-only) list, change one person
 * and save the list back. Unapproved requests they never saw are carried
 * over from disk so such a save cannot silently delete them.
 */
export function saveEmployees(employees: PayrollEmployee[]): void {
  ensureDir(payrollDir());
  const ids = new Set(employees.map((e) => e.id));
  const carried = readEmployeeFile().filter((e) => !isApprovedEmployee(e) && !ids.has(e.id));
  writeJsonAtomic(employeesFile(), { employees: [...employees, ...carried], updatedAt: new Date().toISOString() });
}

export function loadRuns(): PayrollRun[] {
  const f = readJson<{ runs: PayrollRun[] }>(runsFile(), { runs: [] });
  return Array.isArray(f.runs) ? f.runs : [];
}

export function saveRuns(runs: PayrollRun[]): void {
  ensureDir(payrollDir());
  writeJsonAtomic(runsFile(), { runs, updatedAt: new Date().toISOString() });
}

export function blankStructure(): SalaryStructure {
  return { basic: 0, hra: 0, conveyance: 0, medical: 0, special: 0, otherAllowances: [] };
}

export function makeEmployee(input: Partial<PayrollEmployee> & { code: string; name: string }): PayrollEmployee {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    code: input.code,
    name: input.name,
    designation: input.designation || "",
    department: input.department || "",
    plant: input.plant || "",
    type: input.type || "staff",
    dateOfJoining: input.dateOfJoining || now.slice(0, 10),
    dateOfLeaving: null,
    active: true,
    structure: input.structure || blankStructure(),
    dailyWage: input.dailyWage || 0,
    pfApplicable: input.pfApplicable ?? true,
    pfWageOverride: input.pfWageOverride ?? null,
    esicApplicable: input.esicApplicable ?? true,
    uan: input.uan || "",
    esicNumber: input.esicNumber || "",
    recurringDeductions: input.recurringDeductions || [],
    workLocation: input.workLocation || "",
    kyc: input.kyc || blankKyc(),
    documents: [],
    letters: [],
    email: input.email || "",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Backfills fields added after a record was first written, so an employee
 * created by an earlier build doesn't arrive with `undefined` where the UI
 * expects an object.
 */
export function normaliseEmployee(e: PayrollEmployee): PayrollEmployee {
  return {
    ...e,
    workLocation: e.workLocation ?? "",
    kyc: { ...blankKyc(), ...(e.kyc || {}) },
    documents: Array.isArray(e.documents) ? e.documents : [],
    letters: Array.isArray(e.letters) ? e.letters : [],
    email: e.email ?? "",
    recurringDeductions: Array.isArray(e.recurringDeductions) ? e.recurringDeductions : [],
  };
}

export function blankAttendance(employeeId: string, month: string): AttendanceInput {
  return {
    employeeId,
    paidDays: daysInMonth(month),
    daysWorked: 0,
    overtimeHours: 0,
    bonus: 0,
    incentive: 0,
    advanceDeduction: 0,
    tds: 0,
    otherDeduction: 0,
    otherDeductionLabel: "",
    remark: "",
  };
}
