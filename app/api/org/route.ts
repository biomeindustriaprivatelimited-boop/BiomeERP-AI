import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requirePermission, getSession, findById, loadUsers } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { hasPermission } from "@/lib/permissions";
import { loadOrg, saveOrg, OrgMasters } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "departments" | "designations" | "workLocations";
const KINDS: Kind[] = ["departments", "designations", "workLocations"];

/**
 * Anyone signed in may READ the masters — the employee form needs them.
 * Only an admin may change them, because renaming a department after
 * salaries have been grouped by it quietly rewrites past reports.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });
  }
  return NextResponse.json({
    org: loadOrg(),
    canEdit: hasPermission(user.role, "users"),
    usage: orgUsage(),
  });
}

/**
 * Where each Organisation entry is actually used — employees on payroll and
 * app accounts. Shown beside every department, designation and location so
 * the lists visibly connect to the rest of the app, and so nobody retires a
 * designation that forty payslips still print.
 */
function orgUsage() {
  const count = () => ({ employees: 0, users: 0 });
  const out: Record<"departments" | "designations" | "workLocations", Record<string, { employees: number; users: number }>> =
    { departments: {}, designations: {}, workLocations: {} };
  const bump = (kind: keyof typeof out, name: string | undefined, who: "employees" | "users") => {
    const key = String(name || "").trim();
    if (!key) return;
    (out[kind][key] ||= count())[who] += 1;
  };
  try {
    for (const e of loadEmployees()) {
      if (e.active === false) continue;
      bump("departments", e.department, "employees");
      bump("designations", e.designation, "employees");
      bump("workLocations", e.workLocation, "employees");
    }
  } catch { /* payroll not set up yet */ }
  try {
    for (const u of loadUsers()) {
      if (!u.active || u.deleted) continue;
      bump("departments", u.department, "users");
      bump("designations", u.designation, "users");
    }
  } catch { /* no accounts file yet */ }
  return out;
}

export async function POST(req: NextRequest) {
  // Guarded by `users` — the admin-only permission. Masters shape every
  // employee record, so they sit with account management, not with payroll.
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const kind = String(body?.kind || "") as Kind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Unknown list." }, { status: 400 });

  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });

  const org = loadOrg();
  if ((org[kind] as { name: string }[]).some((x) => x.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: `"${name}" is already on that list.` }, { status: 409 });
  }

  if (kind === "departments") {
    org.departments.push({ id: crypto.randomUUID(), name, active: true });
  } else if (kind === "designations") {
    org.designations.push({
      id: crypto.randomUUID(), name,
      department: String(body?.department || "").trim(), active: true,
    });
  } else {
    const stateKey = String(body?.stateKey || "").trim().toUpperCase();
    // The state key decides professional tax and the minimum-wage floor, so
    // a location without one would silently pay against no floor at all.
    if (!stateKey) {
      return NextResponse.json({ error: "Choose the state — it decides professional tax and the wage floor." }, { status: 400 });
    }
    org.workLocations.push({
      id: crypto.randomUUID(), name,
      plantCode: String(body?.plantCode || "").trim().toUpperCase(),
      state: String(body?.state || "").trim(),
      stateKey,
      address: String(body?.address || "").trim(),
      active: true,
    });
  }

  saveOrg(org);
  return NextResponse.json({ org }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const kind = String(body?.kind || "") as Kind;
  if (!KINDS.includes(kind) || !body?.id) {
    return NextResponse.json({ error: "Which entry?" }, { status: 400 });
  }

  const org = loadOrg();
  const list = org[kind] as any[];
  const item = list.find((x) => x.id === body.id);
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Deactivated rather than deleted: an employee already carrying this
  // designation must keep reading correctly on old payslips.
  if (body.active !== undefined) item.active = Boolean(body.active);
  if (body.name !== undefined && String(body.name).trim()) item.name = String(body.name).trim();
  if (kind === "designations" && body.department !== undefined) item.department = String(body.department).trim();
  if (kind === "workLocations") {
    if (body.stateKey !== undefined) item.stateKey = String(body.stateKey).trim().toUpperCase();
    if (body.state !== undefined) item.state = String(body.state).trim();
    if (body.plantCode !== undefined) item.plantCode = String(body.plantCode).trim().toUpperCase();
    if (body.address !== undefined) item.address = String(body.address).trim();
  }

  saveOrg(org as OrgMasters);
  return NextResponse.json({ org });
}
