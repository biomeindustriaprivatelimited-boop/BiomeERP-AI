import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { requirePermission, findById, getSession } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, ensureDir } from "@/lib/dataRoot";
import { loadEmployees, saveEmployees, DOCUMENT_CATEGORIES, LETTER_KINDS } from "@/lib/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Employee documents and letters.
 *
 * Reading is open to payroll (accounts and admin). Adding, replacing and
 * removing is admin-only — the business rule is that once a document is on
 * file, accounts may look at it but not change it, and a correction goes
 * through Help & Support.
 */

const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
]);
const MAX_BYTES = 12 * 1024 * 1024;

function docsDir() { return path.join(paths.root, "payroll", "documents"); }

/** Serve a stored document. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "employee.view");
  if ("response" in auth) return auth.response;

  const employeeId = req.nextUrl.searchParams.get("employeeId") || "";
  const documentId = req.nextUrl.searchParams.get("documentId") || "";

  const employee = loadEmployees().find((e) => e.id === employeeId);
  if (!employee) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const doc = employee.documents.find((d) => d.id === documentId);
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const base = docsDir();
  const full = path.resolve(base, doc.file);
  if (!full.startsWith(path.resolve(base) + path.sep) || !fs.existsSync(full)) {
    return NextResponse.json({ error: "That file is missing from disk." }, { status: 404 });
  }

  const data = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** Upload a document, or issue a letter. */
export async function POST(req: NextRequest) {
  // Uploading a supporting document is open to whoever may add people —
  // a plant manager collecting an Aadhaar copy on site is the normal case.
  // Issuing a LETTER stays with the admin; that is checked below.
  const auth = await requirePermission(req, "employee.docs");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const canSeeAll = hasPermission(user.role, "payroll");

  /** A plant manager may only touch their own plant's people. */
  const inScope = (employeePlant: string) =>
    canSeeAll || !auth.session.plant || employeePlant === auth.session.plant;

  const contentType = req.headers.get("content-type") || "";

  // ---- Issuing a letter (JSON) ----
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body?.employeeId) return NextResponse.json({ error: "Which employee?" }, { status: 400 });

    // A letter is a company undertaking, not a scan — admin only.
    if (!hasPermission(user.role, "employee.edit")) {
      return NextResponse.json(
        { error: "Only an admin can issue a letter. Upload a document instead, or raise it under Help & Support." },
        { status: 403 }
      );
    }

    const kind = String(body.kind || "");
    const title = String(body.title || "").trim().slice(0, 160);
    const letterBody = String(body.body || "").trim();
    if (!LETTER_KINDS.includes(kind as any)) {
      return NextResponse.json({ error: "Choose the kind of letter." }, { status: 400 });
    }
    if (letterBody.length < 20) {
      return NextResponse.json({ error: "Write the letter before issuing it." }, { status: 400 });
    }

    const employees = loadEmployees();
    const employee = employees.find((e) => e.id === body.employeeId);
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    const letter = {
      id: crypto.randomUUID(),
      kind,
      title: title || kind,
      // The wording is stored, not just a reference to a template — a
      // template that changes must not rewrite a letter already handed over.
      body: letterBody,
      issuedOn: String(body.issuedOn || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      issuedByName: user.name,
      signedFile: null,
    };

    employee.letters = [...employee.letters, letter];
    employee.updatedAt = new Date().toISOString();
    saveEmployees(employees.map((e) => (e.id === employee.id ? employee : e)));
    return NextResponse.json({ letter, employee }, { status: 201 });
  }

  // ---- Uploading a document (multipart) ----
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const employeeId = String(form.get("employeeId") || "");
  const category = String(form.get("category") || "Other");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Documents can be photos (JPG, PNG, WEBP) or PDF." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 12 MB." }, { status: 400 });
  }

  const employees = loadEmployees();
  const employee = employees.find((e) => e.id === employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (!inScope(employee.plant)) {
    return NextResponse.json({ error: "That employee isn't at your plant." }, { status: 404 });
  }

  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const id = crypto.randomUUID();
  const dir = path.join(docsDir(), employee.id);
  ensureDir(dir);
  // Generated name, never the browser's — an uploaded name can carry path
  // separators and walk out of the folder.
  fs.writeFileSync(path.join(dir, `${id}.${ext || "bin"}`), Buffer.from(await file.arrayBuffer()));

  const doc = {
    id,
    category: DOCUMENT_CATEGORIES.includes(category as any) ? category : "Other",
    name: file.name.slice(0, 180),
    type: file.type,
    size: file.size,
    file: path.join(employee.id, `${id}.${ext || "bin"}`),
    uploadedAt: new Date().toISOString(),
    uploadedByName: user.name,
  };

  employee.documents = [...employee.documents, doc];
  employee.updatedAt = doc.uploadedAt;
  saveEmployees(employees.map((e) => (e.id === employee.id ? employee : e)));

  return NextResponse.json({ document: doc, employee }, { status: 201 });
}

/** Remove a document reference. Admin only. */
export async function DELETE(req: NextRequest) {
  // Removing a document is a change to a settled record — admin only.
  const auth = await requirePermission(req, "employee.edit");
  if ("response" in auth) return auth.response;

  const employeeId = req.nextUrl.searchParams.get("employeeId") || "";
  const documentId = req.nextUrl.searchParams.get("documentId") || "";

  const employees = loadEmployees();
  const employee = employees.find((e) => e.id === employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  // The reference goes; the file stays on disk. Deleting an employee's
  // proof of identity on a single click is not something an HR record
  // should permit.
  employee.documents = employee.documents.filter((d) => d.id !== documentId);
  employee.updatedAt = new Date().toISOString();
  saveEmployees(employees.map((e) => (e.id === employee.id ? employee : e)));

  return NextResponse.json({ employee });
}
