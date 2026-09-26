import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requirePermission, findById } from "@/lib/authServer";
import { loadEmployees, saveEmployees } from "@/lib/payroll";
import { LETTER_TEMPLATES, templateById, fillTemplate, missingPlaceholders, PLACEHOLDERS } from "@/lib/letters";
import { sendMail } from "@/lib/mailer";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPANY = "Biome Industria Private Limited";

/** Values pulled from the employee record to fill a draft. */
function valuesFor(e: any, issuedBy: string) {
  const gross = e.type === "labour"
    ? e.dailyWage * 26
    : (e.structure?.basic || 0) + (e.structure?.hra || 0) + (e.structure?.conveyance || 0) +
      (e.structure?.medical || 0) + (e.structure?.special || 0);
  return {
    employee_name: e.name,
    employee_code: e.code,
    designation: e.designation,
    department: e.department,
    work_location: e.workLocation || e.plant || "Head office",
    date_of_joining: e.dateOfJoining,
    today: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }),
    month: new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    gross_salary: gross ? gross.toLocaleString("en-IN") : "",
    company_name: COMPANY,
    issued_by: issuedBy,
  };
}

/** The templates, and a draft when an employee is named. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "employee.view");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const employeeId = req.nextUrl.searchParams.get("employeeId");
  const templateId = req.nextUrl.searchParams.get("template");

  let draft: { subject: string; body: string; missing: string[] } | null = null;
  if (employeeId && templateId) {
    const employee = loadEmployees().find((e) => e.id === employeeId);
    const template = templateById(templateId);
    if (employee && template) {
      const values = valuesFor(employee, user.name);
      const body = fillTemplate(template.body, values);
      draft = {
        subject: fillTemplate(template.subject, values),
        body,
        // Shown before sending. A letter with a hole in it must not go out.
        missing: missingPlaceholders(body),
      };
    }
  }

  return NextResponse.json({ templates: LETTER_TEMPLATES, placeholders: PLACEHOLDERS, draft });
}

/**
 * Issue a letter: store it on the employee record, and optionally email it.
 *
 * Storing comes first and always. If the email fails the letter still
 * exists and can be re-sent — the other way round would leave a letter
 * that was sent but nowhere on record.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "employee.edit");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.employeeId) return NextResponse.json({ error: "Which employee?" }, { status: 400 });

  const employees = loadEmployees();
  const employee = employees.find((e) => e.id === body.employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const kind = String(body.kind || "");
  const template = templateById(kind);
  const subject = String(body.subject || template?.subject || "Letter").trim().slice(0, 180);
  const text = String(body.body || "").trim();

  if (text.length < 40) {
    return NextResponse.json({ error: "The letter is too short to issue — write the content first." }, { status: 400 });
  }

  const holes = missingPlaceholders(text);
  if (holes.length > 0 && !body.force) {
    return NextResponse.json(
      {
        error: `This letter still has ${holes.length} blank${holes.length > 1 ? "s" : ""} in it: ${holes.join(", ")}. Fill them in — a letter with a gap like "Rs. {{new_salary}}" must not go out.`,
        missing: holes,
      },
      { status: 409 }
    );
  }

  const letter = {
    id: crypto.randomUUID(),
    kind: template?.label || kind || "Letter",
    title: subject,
    // The wording as issued, stored verbatim. A template changed later can
    // never rewrite what was handed over.
    body: text,
    issuedOn: String(body.issuedOn || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    issuedByName: user.name,
    signedFile: null as string | null,
  };

  employee.letters = [...(employee.letters || []), letter];
  employee.updatedAt = new Date().toISOString();
  saveEmployees(employees.map((e) => (e.id === employee.id ? employee : e)));

  recordAudit({
    action: "LETTER_ISSUED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "employee", targetId: employee.id, targetLabel: employee.name,
    detail: `${letter.kind} — ${letter.title}`,
    plant: employee.plant || null,
  });

  // ---- Optional email ----
  let mail: { attempted: boolean; ok: boolean; error?: string } = { attempted: false, ok: false };
  if (body.email) {
    if (!employee.email) {
      mail = { attempted: true, ok: false, error: "No work email on this employee's record." };
    } else {
      const sent = await sendMail({
        to: employee.email,
        subject,
        text,
        html: `<div style="font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.7;white-space:pre-wrap;max-width:640px">${
          text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        }</div>`,
      });
      mail = { attempted: true, ok: sent.ok, error: sent.error };
      recordAudit({
        action: "LETTER_EMAILED",
        userId: user.id, userName: user.name, role: user.role,
        targetType: "employee", targetId: employee.id, targetLabel: employee.name,
        detail: `${letter.kind} to ${employee.email}`,
        outcome: sent.ok ? "ok" : "failed",
        errorMessage: sent.error,
      });
    }
  }

  return NextResponse.json({ letter, employee, mail }, { status: 201 });
}
