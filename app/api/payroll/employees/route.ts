import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, getSession } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadEmployees, saveEmployees, makeEmployee, blankStructure, PayrollEmployee,
  blankKyc, EmployeeKyc, DOCUMENT_CATEGORIES, LETTER_KINDS,
} from "@/lib/payroll";
import { loadOrg } from "@/lib/org";
import { tableForPlant, checkAgainstFloor, checkWageTable, SkillCategory } from "@/lib/wages";
import { PLANTS } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANT_CODES = PLANTS.map((p) => p.code);

function readKyc(raw: any, existing?: EmployeeKyc): EmployeeKyc {
  const base = existing || blankKyc();
  const str = (k: keyof EmployeeKyc) =>
    raw?.[k] !== undefined ? String(raw[k]).trim() : (base[k] as string);
  const skill = String(raw?.skillCategory || base.skillCategory);
  return {
    fatherOrSpouse: str("fatherOrSpouse"),
    dateOfBirth: str("dateOfBirth").slice(0, 10),
    gender: str("gender"),
    maritalStatus: str("maritalStatus"),
    bloodGroup: str("bloodGroup"),
    personalPhone: str("personalPhone"),
    emergencyName: str("emergencyName"),
    emergencyPhone: str("emergencyPhone"),
    address: str("address"),
    aadhaar: str("aadhaar").replace(/\s+/g, ""),
    pan: str("pan").toUpperCase(),
    bankName: str("bankName"),
    bankAccount: str("bankAccount"),
    bankIfsc: str("bankIfsc").toUpperCase(),
    skillCategory: (["unskilled", "semiskilled", "skilled", "highlyskilled"].includes(skill)
      ? skill
      : base.skillCategory) as EmployeeKyc["skillCategory"],
  };
}

/**
 * Everything the payroll screen needs about one employee's compliance
 * standing, worked out rather than stored — so it follows the wage tables
 * automatically when those are updated.
 */
function complianceFor(e: PayrollEmployee) {
  const flags: { level: "error" | "warning"; message: string }[] = [];

  const paid = e.type === "labour"
    ? { daily: e.dailyWage }
    : { monthly: e.structure.basic + e.structure.hra + e.structure.conveyance + e.structure.medical + e.structure.special };

  const short = checkAgainstFloor(e.plant, e.kyc.skillCategory as SkillCategory, paid);
  if (short) {
    flags.push({
      level: "error",
      message: `Paid below the ${short.state} minimum for ${e.kyc.skillCategory} work — short by ₹${short.shortfall.toLocaleString("en-IN")} per ${short.basis === "daily" ? "day" : "month"} against a floor of ₹${short.floor.toLocaleString("en-IN")}.`,
    });
  }

  const table = tableForPlant(e.plant);
  if (table) {
    const status = checkWageTable(table);
    if (status.status === "expired") flags.push({ level: "error", message: status.message });
    else if (status.status !== "current") flags.push({ level: "warning", message: status.message });
  }

  if (e.pfApplicable && !e.uan) flags.push({ level: "warning", message: "PF is on but no UAN is recorded — the ECR upload will reject this line." });
  if (e.esicApplicable && !e.esicNumber) flags.push({ level: "warning", message: "ESIC is on but no ESIC number is recorded." });
  if (!e.kyc.pan) flags.push({ level: "warning", message: "No PAN on file." });
  if (!e.kyc.bankAccount) flags.push({ level: "warning", message: "No bank account on file — this person cannot be paid by transfer." });
  if (!e.email) flags.push({ level: "warning", message: "No work email — the payslip cannot be sent." });

  return flags;
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "employee.view");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canSeeAll = hasPermission(user.role, "payroll");

  /**
   * A plant manager sees their own plant's people and nobody else's.
   * The office roles see everyone, because payroll has to.
   */
  const employees = loadEmployees().filter(
    (e) => canSeeAll || !auth.session.plant || e.plant === auth.session.plant
  );

  return NextResponse.json({
    employees: employees.map((e) => ({ ...e, compliance: complianceFor(e) })),
    canAdd: hasPermission(user.role, "employee.add"),
    canEditRecord: hasPermission(user.role, "employee.edit"),
    canFreeze: hasPermission(user.role, "employee.freeze"),
    canUploadDocs: hasPermission(user.role, "employee.docs"),
    myPlant: canSeeAll ? null : auth.session.plant,
    plants: PLANTS,
    org: loadOrg(),
    documentCategories: DOCUMENT_CATEGORIES,
    letterKinds: LETTER_KINDS,
    // The business rule: once a record exists, only an admin changes it.
    // Accounts can read everything and raise a helpdesk request for a fix.
    canEdit: hasPermission(user.role, "users"),
  });
}

function readStructure(raw: any) {
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  return {
    basic: num(raw?.basic),
    hra: num(raw?.hra),
    conveyance: num(raw?.conveyance),
    medical: num(raw?.medical),
    special: num(raw?.special),
    otherAllowances: Array.isArray(raw?.otherAllowances)
      ? raw.otherAllowances
          .map((a: any) => ({ label: String(a?.label || "").slice(0, 40), amount: num(a?.amount) }))
          .filter((a: any) => a.label && a.amount > 0)
          .slice(0, 8)
      : [],
  };
}

function readDeductions(raw: any) {
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  return Array.isArray(raw)
    ? raw
        .map((d: any) => ({ label: String(d?.label || "").slice(0, 40), amount: num(d?.amount) }))
        .filter((d: any) => d.label && d.amount > 0)
        .slice(0, 8)
    : [];
}

export async function POST(req: NextRequest) {
  // Everyone but a coordinator may put someone on the rolls.
  const auth = await requirePermission(req, "employee.add");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canSeeAll = hasPermission(user.role, "payroll");

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const type = body.type === "labour" ? "labour" : "staff";
  // A plant manager adds people to THEIR plant. The submitted plant is
  // overridden rather than validated — a mismatch is either a bug or an
  // attempt, and neither deserves a helpful error.
  const plant = canSeeAll
    ? String(body.plant || "").trim().toUpperCase()
    : (auth.session.plant || "");

  if (!/^[A-Z0-9-]{2,14}$/.test(code)) {
    return NextResponse.json({ error: "Give the employee a code — 2 to 14 letters or numbers." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Enter the employee's name." }, { status: 400 });
  if (plant && !PLANT_CODES.includes(plant)) {
    return NextResponse.json({ error: "That plant code isn't recognised." }, { status: 400 });
  }

  const employees = loadEmployees();
  if (employees.some((e) => e.code === code)) {
    return NextResponse.json({ error: "That employee code is already in use." }, { status: 409 });
  }

  const structure = readStructure(body.structure);
  const dailyWage = Math.max(0, Number(body.dailyWage) || 0);

  // A person with neither a structure nor a day rate would compute to zero
  // every month, which looks like a working payroll and pays nobody.
  if (type === "staff" && structure.basic <= 0) {
    return NextResponse.json({ error: "Staff need a basic pay figure." }, { status: 400 });
  }
  if (type === "labour" && dailyWage <= 0) {
    return NextResponse.json({ error: "Labour need a daily wage." }, { status: 400 });
  }

  const employee = makeEmployee({
    code,
    name,
    designation: String(body.designation || "").trim(),
    department: String(body.department || "").trim(),
    plant,
    type,
    dateOfJoining: String(body.dateOfJoining || "").slice(0, 10) || undefined,
    workLocation: String(body.workLocation || "").trim(),
    email: String(body.email || "").trim(),
    kyc: readKyc(body.kyc),
    structure: type === "staff" ? structure : blankStructure(),
    dailyWage: type === "labour" ? dailyWage : 0,
    pfApplicable: body.pfApplicable !== false,
    pfWageOverride: body.pfWageOverride === null || body.pfWageOverride === undefined || body.pfWageOverride === ""
      ? null
      : Math.max(0, Number(body.pfWageOverride) || 0),
    esicApplicable: body.esicApplicable !== false,
    uan: String(body.uan || "").trim(),
    esicNumber: String(body.esicNumber || "").trim(),
    recurringDeductions: readDeductions(body.recurringDeductions),
  });

  saveEmployees([...employees, employee]);
  return NextResponse.json({ employee }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  /**
   * Editing an existing record is admin-only, and so is freezing one.
   *
   * The business set this out directly: anyone but a coordinator may ADD a
   * person, but once the record exists only the admin changes or freezes
   * it. Everyone else raises a correction through Help & Support.
   */
  const auth = await requirePermission(req, "employee.edit");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which employee?" }, { status: 400 });

  const employees = loadEmployees();
  const existing = employees.find((e) => e.id === body.id);
  if (!existing) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const plant = body.plant !== undefined ? String(body.plant).trim().toUpperCase() : existing.plant;
  if (plant && !PLANT_CODES.includes(plant)) {
    return NextResponse.json({ error: "That plant code isn't recognised." }, { status: 400 });
  }

  const updated: PayrollEmployee = {
    ...existing,
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    designation: body.designation !== undefined ? String(body.designation).trim() : existing.designation,
    department: body.department !== undefined ? String(body.department).trim() : existing.department,
    plant,
    type: body.type === "labour" ? "labour" : body.type === "staff" ? "staff" : existing.type,
    dateOfJoining: body.dateOfJoining ? String(body.dateOfJoining).slice(0, 10) : existing.dateOfJoining,
    dateOfLeaving: body.dateOfLeaving !== undefined
      ? (body.dateOfLeaving ? String(body.dateOfLeaving).slice(0, 10) : null)
      : existing.dateOfLeaving,
    active: body.active !== undefined ? Boolean(body.active) : existing.active,
    structure: body.structure !== undefined ? readStructure(body.structure) : existing.structure,
    dailyWage: body.dailyWage !== undefined ? Math.max(0, Number(body.dailyWage) || 0) : existing.dailyWage,
    pfApplicable: body.pfApplicable !== undefined ? Boolean(body.pfApplicable) : existing.pfApplicable,
    pfWageOverride: body.pfWageOverride !== undefined
      ? (body.pfWageOverride === null || body.pfWageOverride === "" ? null : Math.max(0, Number(body.pfWageOverride) || 0))
      : existing.pfWageOverride,
    esicApplicable: body.esicApplicable !== undefined ? Boolean(body.esicApplicable) : existing.esicApplicable,
    uan: body.uan !== undefined ? String(body.uan).trim() : existing.uan,
    esicNumber: body.esicNumber !== undefined ? String(body.esicNumber).trim() : existing.esicNumber,
    recurringDeductions: body.recurringDeductions !== undefined
      ? readDeductions(body.recurringDeductions)
      : existing.recurringDeductions,
    workLocation: body.workLocation !== undefined ? String(body.workLocation).trim() : existing.workLocation,
    email: body.email !== undefined ? String(body.email).trim() : existing.email,
    kyc: body.kyc !== undefined ? readKyc(body.kyc, existing.kyc) : existing.kyc,
    updatedAt: new Date().toISOString(),
  };

  saveEmployees(employees.map((e) => (e.id === updated.id ? updated : e)));
  return NextResponse.json({ employee: updated });
}
