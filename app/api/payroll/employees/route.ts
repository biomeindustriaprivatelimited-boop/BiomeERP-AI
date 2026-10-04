import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";
import { requirePermission, findById, getSession } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { effectivePermissions } from "@/lib/access";
import {
  loadEmployees, saveEmployees, makeEmployee, blankStructure, PayrollEmployee,
  blankKyc, EmployeeKyc, DOCUMENT_CATEGORIES, LETTER_KINDS,
} from "@/lib/payroll";
import { loadOrg } from "@/lib/org";
import { isApprovedEmployee } from "@/lib/payroll";
import { recordAudit } from "@/lib/audit";
import { loadAnnouncements, saveAnnouncements, makeAnnouncement } from "@/lib/announcements";
import type { User } from "@/lib/authServer";
import { tableForPlant, checkAgainstFloor, checkWageTable, SkillCategory } from "@/lib/wages";

function livePlants() { return plantOptions().map((p) => ({ code: p.code, label: p.label })); }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANT_CODES = { includes: (c: string) => livePlants().some((p) => p.code === c) };

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

  if (e.type === "labour" ? !(e.dailyWage > 0) : !(e.structure.basic > 0)) {
    flags.push({ level: "error", message: "Pay not set yet — accounts must add the salary / daily wage before the next payroll run." });
  }
  if (e.pfApplicable && !e.uan) flags.push({ level: "warning", message: "PF is on but no UAN is recorded — the ECR upload will reject this line." });
  if (e.esicApplicable && !e.esicNumber) flags.push({ level: "warning", message: "ESIC is on but no ESIC number is recorded." });
  if (!e.kyc.pan) flags.push({ level: "warning", message: "No PAN on file." });
  if (!e.kyc.bankAccount) flags.push({ level: "warning", message: "No bank account on file — this person cannot be paid by transfer." });
  if (!e.email) flags.push({ level: "warning", message: "No work email — the payslip cannot be sent." });

  return flags;
}

/**
 * Who approves a plant manager's new-employee request: the admin and the
 * developer — not accounts, and never the person who asked.
 */
function canApproveEmployees(user: User): boolean {
  return user.role === "admin" || user.role === "developer";
}

/** In-app notice through the app's own notice board (/api/notices). */
function notice(
  by: { id: string; name: string },
  audience: { roles: ("admin" | "developer")[] | "all"; userIds: string[] },
  kind: "info" | "warning",
  title: string,
  body: string
) {
  try {
    const list = loadAnnouncements();
    list.push(makeAnnouncement({
      kind, title, body,
      audience: { roles: audience.roles, plants: [], userIds: audience.userIds },
      expiresOn: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      by,
    }));
    saveAnnouncements(list);
  } catch { /* a notice failing must never undo the record */ }
}

/** The request as the screens need it — no pay, no KYC. */
function requestView(e: PayrollEmployee) {
  return {
    id: e.id, code: e.code, name: e.name, designation: e.designation, department: e.department,
    plant: e.plant, type: e.type, dateOfJoining: e.dateOfJoining, approval: e.approval, createdAt: e.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "employee.view");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, user.access);
  const canSeeAll = perms.includes("payroll");

  /**
   * A plant manager sees their own plant's people and nobody else's.
   * The office roles see everyone, because payroll has to. Someone with
   * neither payroll nor a plant on their session sees NOBODY — this used
   * to fall open (`!session.plant` matched every record).
   */
  const inScope = (e: PayrollEmployee) =>
    canSeeAll || (Boolean(auth.session.plant) && e.plant === auth.session.plant);
  const everything = loadEmployees({ includeRequests: true }).filter(inScope);
  const employees = everything.filter(isApprovedEmployee);
  const approver = canApproveEmployees(user);

  /**
   * New-employee requests from plant managers. Office roles see the
   * pending queue (only admin/developer may decide it); a plant manager
   * sees their own plant's requests — pending, rejected and withdrawn —
   * with the status and the reason.
   */
  const requests = everything
    .filter((e) => !isApprovedEmployee(e))
    .filter((e) => !canSeeAll || e.approval?.status === "pending_approval" ||
      // keep a decided request visible to the office for a week
      (e.approval?.decidedAt && Date.now() - Date.parse(e.approval.decidedAt) < 7 * 86400000))
    .sort((a, b) => (b.approval?.requestedAt || "").localeCompare(a.approval?.requestedAt || ""))
    .map(requestView);

  return NextResponse.json({
    employees: employees.map((e) => ({ ...e, compliance: complianceFor(e) })),
    requests,
    pendingCount: requests.filter((r) => r.approval?.status === "pending_approval").length,
    canApprove: approver,
    me: user.id,
    canAdd: perms.includes("employee.add") && (canSeeAll || Boolean(auth.session.plant)),
    canEditRecord: perms.includes("employee.edit"),
    canFreeze: perms.includes("employee.freeze"),
    canUploadDocs: perms.includes("employee.docs"),
    myPlant: canSeeAll ? null : auth.session.plant,
    plants: livePlants(),
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
  const canSeeAll = effectivePermissions(user.role, user.access).includes("payroll");

  // A plant-side adder must be signed in for a plant: without one the
  // record would land at "head office", outside their own scope.
  if (!canSeeAll && !auth.session.plant) {
    return NextResponse.json(
      { error: "Sign in for your plant to add its employees." },
      { status: 403 }
    );
  }

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

  const employees = loadEmployees({ includeRequests: true });
  // A pending request holds its code; a rejected or withdrawn one frees it.
  if (employees.some((e) => e.code === code && (isApprovedEmployee(e) || e.approval?.status === "pending_approval"))) {
    return NextResponse.json({ error: "That employee code is already in use." }, { status: 409 });
  }

  const structure = readStructure(body.structure);
  const dailyWage = Math.max(0, Number(body.dailyWage) || 0);

  // A person with neither a structure nor a day rate would compute to zero
  // every month, which looks like a working payroll and pays nobody.
  // Only enforced for payroll users: a plant manager adds the PERSON (an
  // employee record — no app login) so attendance and imprest can be kept
  // for them; accounts fills the pay later. The compliance list flags a
  // record with no pay so it cannot slip through a salary run unnoticed.
  if (canSeeAll && type === "staff" && structure.basic <= 0) {
    return NextResponse.json({ error: "Staff need a basic pay figure." }, { status: 400 });
  }
  if (canSeeAll && type === "labour" && dailyWage <= 0) {
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

  /**
   * A plant-side adder (no payroll access — a plant manager) only REQUESTS
   * the person: inactive and invisible everywhere until an admin or the
   * developer approves it.
   */
  const needsApproval = !canSeeAll;
  if (needsApproval) {
    employee.active = false;
    employee.approval = {
      status: "pending_approval",
      requestedBy: { uid: user.id, name: user.name, plant },
      requestedAt: new Date().toISOString(),
      decidedBy: null, decidedByName: null, decidedAt: null, reason: null,
    };
  }

  saveEmployees([...employees, employee]);
  recordAudit({
    action: needsApproval ? "EMPLOYEE_REQUESTED" : "EMPLOYEE_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "employee", targetId: employee.id, targetLabel: `${employee.name} (${employee.code})`,
    detail: plant ? `Plant ${plant}` : "Head office",
    plant: plant || null,
  });
  if (needsApproval) {
    notice(
      { id: user.id, name: user.name },
      { roles: ["admin", "developer"], userIds: [] },
      "info",
      `New employee awaiting approval — ${employee.name} (${plant})`,
      `${user.name} asked to add ${employee.name} (${employee.code}) at ${plant}. Approve or reject it under People → Employees → Pending approval.`
    );
  }
  return NextResponse.json({ employee, pending: needsApproval }, { status: 201 });
}

/**
 * Decide a plant manager's request.
 *   { id, action: "approve" }                 admin / developer, not their own
 *   { id, action: "reject", reason }          admin / developer, reason required
 *   { id, action: "withdraw" }                the requester, or a plant manager
 *                                             of the same plant, while pending
 */
export async function PATCH(req: NextRequest) {
  const auth = await requirePermission(req, "employee.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  const reason = String(body?.reason || "").trim().slice(0, 300);

  const all = loadEmployees({ includeRequests: true });
  const e = all.find((x) => x.id === id);
  if (!e || !e.approval) return NextResponse.json({ error: "That request was not found." }, { status: 404 });
  if (e.approval.status !== "pending_approval") {
    return NextResponse.json({ error: `This request is already ${e.approval.status.replace("_", " ")}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  if (action === "approve" || action === "reject") {
    if (!canApproveEmployees(user)) {
      return NextResponse.json({ error: "Only the admin or the developer can approve new employees." }, { status: 403 });
    }
    if (e.approval.requestedBy.uid === user.id) {
      return NextResponse.json({ error: "You can't approve your own request. Ask another approver." }, { status: 403 });
    }
    if (action === "reject" && !reason) {
      return NextResponse.json({ error: "Give a reason so the plant manager knows why." }, { status: 400 });
    }
    if (action === "approve" && all.some((x) => x.id !== e.id && x.code === e.code && isApprovedEmployee(x))) {
      return NextResponse.json({ error: `Code ${e.code} is now used by someone else. Change the code first.` }, { status: 409 });
    }
    e.approval = {
      ...e.approval,
      status: action === "approve" ? "approved" : "rejected",
      decidedBy: user.id, decidedByName: user.name, decidedAt: now,
      reason: action === "reject" ? reason : reason || null,
    };
    e.active = action === "approve";
  } else if (action === "withdraw") {
    const samePlantManager = Boolean(auth.session.plant) && auth.session.plant === e.plant &&
      effectivePermissions(user.role, user.access).includes("employee.add");
    if (e.approval.requestedBy.uid !== user.id && !samePlantManager) {
      return NextResponse.json({ error: "Only the plant that asked can withdraw this request." }, { status: 403 });
    }
    e.approval = { ...e.approval, status: "withdrawn", decidedBy: user.id, decidedByName: user.name, decidedAt: now, reason: reason || "Withdrawn by the plant" };
    e.active = false;
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  e.updatedAt = now;

  saveEmployees(all.map((x) => (x.id === e.id ? e : x)));
  recordAudit({
    action: action === "approve" ? "EMPLOYEE_APPROVED" : action === "reject" ? "EMPLOYEE_REJECTED" : "EMPLOYEE_REQUEST_WITHDRAWN",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "employee", targetId: e.id, targetLabel: `${e.name} (${e.code})`,
    detail: `${e.plant}${e.approval.reason ? ` — ${e.approval.reason}` : ""}`,
    plant: e.plant || null,
  });
  if (action !== "withdraw") {
    notice(
      { id: user.id, name: user.name },
      { roles: "all", userIds: [e.approval.requestedBy.uid] },
      action === "approve" ? "info" : "warning",
      action === "approve"
        ? `Employee approved — ${e.name} (${e.code})`
        : `Employee request rejected — ${e.name} (${e.code})`,
      action === "approve"
        ? `${user.name} approved ${e.name}. You can now keep their attendance, leave and imprest.`
        : `${user.name} rejected ${e.name}: ${reason}`
    );
  }
  return NextResponse.json({ employee: requestView(e) });
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
