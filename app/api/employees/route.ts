import { NextRequest, NextResponse } from "next/server";
import { getSession, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { loadEmployees } from "@/lib/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/employees — the plant-scoped employee PICK-LIST.
 *
 * For other modules (imprest, attendance pickers, stock issue-to) that need
 * "who works at this plant" without the payroll record: no pay, no KYC, no
 * documents — id, code, name, designation, department, plant, type, active.
 *
 * Scope, decided from the session and never from the query:
 *   - payroll / imprest.viewAll holders (accounts, admin, developer): every
 *     employee; `?plant=REW` narrows the list, `?plant=-` = head office.
 *   - everyone else: ONLY the plant their session is signed in for
 *     (`?plant=` is ignored). No plant on the session → empty list.
 * Allowed for holders of employee.view, imprest.viewPlant, imprest.manage
 * or imprest.approve; coordinators hold none of them and get a 403.
 *
 * Query: ?plant=CODE  ?q=text  ?includeInactive=1
 * Response: { scope: "all" | "plant", plant: string | null, employees: [...] }
 *
 * Plant-manager-added employees are records only — they have no app login.
 * Imprest entries for them should store the employee `id` (+ name/code for
 * display), and be filed against the same plant.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });

  const perms = effectivePermissions(user.role, user.access);
  const allowed = ["employee.view", "imprest.viewPlant", "imprest.manage", "imprest.approve"] as const;
  if (!allowed.some((p) => perms.includes(p))) {
    return NextResponse.json({ error: "Your role does not have access to this." }, { status: 403 });
  }

  const seeAll = perms.includes("payroll") || perms.includes("imprest.viewAll");
  const sp = req.nextUrl.searchParams;
  const includeInactive = sp.get("includeInactive") === "1";
  const q = (sp.get("q") || "").trim().toLowerCase();
  const requested = (sp.get("plant") || "").trim().toUpperCase();

  let plant: string | null;
  if (seeAll) plant = requested || null;
  else plant = session.plant || "";

  const list = loadEmployees()
    .filter((e) => includeInactive || e.active)
    .filter((e) => {
      if (plant === null) return true;
      if (plant === "-") return !e.plant;
      if (plant === "") return false; // field role with no plant on the session
      return e.plant === plant;
    })
    .filter((e) => !q || [e.name, e.code, e.designation, e.department].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      id: e.id, code: e.code, name: e.name, designation: e.designation,
      department: e.department, plant: e.plant, type: e.type, active: e.active,
    }));

  return NextResponse.json({
    scope: seeAll ? "all" : "plant",
    plant: plant === null ? null : plant || null,
    employees: list,
  });
}
