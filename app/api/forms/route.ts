import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { paths, ensureDir, sanitizeSegment } from "@/lib/dataRoot";
import { loadForms, saveForms, FORM_TEMPLATES, type FormDef, type FormSubmission } from "@/lib/ops";
import { loadWork, saveWork, today, type WorkTask } from "@/lib/work";

/** Smart form builder: definitions, submissions (with files), templates. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const data = loadForms();
  const formId = req.nextUrl.searchParams.get("form");
  return NextResponse.json({
    forms: data.forms, templates: FORM_TEMPLATES,
    submissions: (formId ? data.submissions.filter((s) => s.formId === formId) : data.submissions).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 300),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));
  const data = loadForms();

  if (body.action === "create") {
    const perm = await requirePermission(req, "settings");
    if ("response" in perm) return perm.response;
    const f: FormDef = {
      id: crypto.randomUUID(), name: String(body.name || "").trim(), description: String(body.description || ""),
      fields: (Array.isArray(body.fields) ? body.fields : []).map((x: any) => ({ id: crypto.randomUUID(), label: String(x.label || "Field"), type: x.type, required: Boolean(x.required), options: Array.isArray(x.options) ? x.options.map(String) : undefined })),
      taskOnSubmit: body.taskOnSubmit ? String(body.taskOnSubmit) : null, active: true, createdBy: user.name, createdAt: new Date().toISOString(),
    };
    if (!f.name || !f.fields.length) return NextResponse.json({ error: "A form needs a name and at least one field." }, { status: 400 });
    data.forms.unshift(f); saveForms(data);
    recordAudit({ action: "form.create", userId: user.id, userName: user.name, role: user.role, targetType: "form", targetId: f.id, targetLabel: f.name });
    return NextResponse.json({ form: f });
  }

  if (body.action === "toggle") {
    const f = data.forms.find((x) => x.id === body.id); if (!f) return NextResponse.json({ error: "Form not found." }, { status: 404 });
    f.active = !f.active; saveForms(data); return NextResponse.json({ form: f });
  }

  if (body.action === "submit") {
    const f = data.forms.find((x) => x.id === body.formId && x.active);
    if (!f) return NextResponse.json({ error: "Form not found or inactive." }, { status: 404 });
    for (const field of f.fields) {
      if (field.required && (body.values?.[field.id] === undefined || body.values?.[field.id] === "" || body.values?.[field.id] === false)) {
        return NextResponse.json({ error: `"${field.label}" is required.` }, { status: 400 });
      }
    }
    const sub: FormSubmission = {
      id: crypto.randomUUID(), formId: f.id, values: body.values || {}, files: [], submittedBy: user.id, submittedByName: user.name,
      submittedAt: new Date().toISOString(), plant: auth.session.plant ?? null, taskId: null,
    };
    // Files/photos/signatures arrive as base64 → data root.
    for (const file of Array.isArray(body.files) ? body.files : []) {
      if (!file?.fieldId || !file?.base64) continue;
      const dir = path.join(paths.root, "forms", f.id, sub.id); ensureDir(dir);
      const name = sanitizeSegment(String(file.name || "file")) || "file";
      fs.writeFileSync(path.join(dir, name), Buffer.from(String(file.base64), "base64"));
      sub.files.push({ fieldId: String(file.fieldId), name, file: path.join("forms", f.id, sub.id, name) });
      sub.values[file.fieldId] = name;
    }
    if (f.taskOnSubmit) {
      const w = loadWork(); const now = new Date().toISOString();
      const summary = f.fields.slice(0, 2).map((x) => `${x.label}: ${sub.values[x.id] ?? "—"}`).join(" · ");
      const t: WorkTask = {
        id: crypto.randomUUID(), key: `form:${sub.id}`, kind: "followup", module: "Forms", title: `${f.name} — ${summary}`.slice(0, 120),
        why: `Submitted by ${user.name}.`, nextAction: "Review the submission.", href: `/forms?form=${f.id}`, priority: "normal", status: "open", source: "auto",
        ownerRoles: [f.taskOnSubmit], assigneeId: null, assigneeName: null, plant: sub.plant, dueOn: today(), createdAt: now, updatedAt: now,
        resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0, amount: null, evidence: [`Form: ${f.name}`],
      };
      w.tasks.unshift(t); saveWork(w); sub.taskId = t.id;
    }
    data.submissions.unshift(sub); saveForms(data);
    recordAudit({ action: "form.submit", userId: user.id, userName: user.name, role: user.role, targetType: "form", targetId: f.id, targetLabel: f.name, plant: sub.plant });
    return NextResponse.json({ submission: sub });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
