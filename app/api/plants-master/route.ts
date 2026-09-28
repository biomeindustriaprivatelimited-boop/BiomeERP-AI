import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, loadUsers } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { loadPlants, savePlants, STATES, Plant } from "@/lib/plants";
import { loadHolidays } from "@/lib/leave";
import { loadEmployees } from "@/lib/payroll";
import { recordAudit } from "@/lib/audit";

/**
 * The plant master.
 *
 * Everyone who can see operations can READ it — a picker is useless
 * otherwise. Adding or changing a site is admin work, because the state on
 * a plant record decides which public holidays its people follow, and
 * getting that wrong marks a whole site absent on their own holiday.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const plants = loadPlants();
  const employees = loadEmployees();
  const holidays = loadHolidays();

  return NextResponse.json({
    plants: plants.map((p) => ({
      ...p,
      // Shown on the screen so the consequence of the state field is
      // visible before somebody changes it.
      employees: employees.filter((e) => e.plant === p.code && e.active).length,
      holidays: holidays.filter((h) => h.regions.includes(p.state)).length,
    })),
    states: STATES,
    // Adding or changing a plant is the developer's alone.
    canEdit: hasPermission(user.role, "developer"),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!hasPermission(user.role, "developer")) {
    return NextResponse.json({ error: "Only the developer can add a plant." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const label = String(body?.label ?? "").trim().slice(0, 60);
  const state = String(body?.state ?? "").trim().toUpperCase();

  if (!code) return NextResponse.json({ error: "Give the plant a short code — REW, GKD, and so on." }, { status: 400 });
  if (!label) return NextResponse.json({ error: "Give the plant a name." }, { status: 400 });
  if (!STATES.some((s) => s.code === state)) {
    return NextResponse.json(
      { error: "Choose the state this plant sits in — it decides which public holidays its people follow." },
      { status: 400 }
    );
  }

  const plants = loadPlants();
  // A repeated code would attach one site's attendance, imprest and
  // coordination rows to another's.
  if (plants.some((p) => p.code === code)) {
    return NextResponse.json({ error: `${code} is already in use by ${plants.find((p) => p.code === code)!.label}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const plant: Plant = {
    code, label, state,
    location: String(body?.location ?? "").trim().slice(0, 160),
    active: true, createdAt: now, updatedAt: now,
  };
  savePlants([...plants, plant]);

  recordAudit({
    action: "PLANT_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "plant", targetId: code, targetLabel: label,
    detail: `${label} (${code}) in ${STATES.find((s) => s.code === state)?.label}`,
  });

  return NextResponse.json({ plant }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!hasPermission(user.role, "developer")) {
    return NextResponse.json({ error: "Only the developer can change a plant." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim().toUpperCase();
  const plants = loadPlants();
  const index = plants.findIndex((p) => p.code === code);
  if (index === -1) return NextResponse.json({ error: "That plant isn't in the list." }, { status: 404 });

  const before = plants[index];
  const state = body?.state !== undefined ? String(body.state).trim().toUpperCase() : before.state;
  if (!STATES.some((s) => s.code === state)) {
    return NextResponse.json({ error: "Choose a valid state." }, { status: 400 });
  }

  const active = body?.active !== undefined ? Boolean(body.active) : before.active;

  // Switching a site off while people are still attached to it would take
  // their plant out of every picker while their attendance kept arriving.
  if (!active && before.active) {
    const attached = loadEmployees().filter((e) => e.plant === code && e.active).length;
    if (attached > 0) {
      return NextResponse.json(
        { error: `${attached} active employees are still at ${before.label}. Move them first.` },
        { status: 409 }
      );
    }
    const users = loadUsers().filter((u) => u.active && u.plants.includes(code)).length;
    if (users > 0) {
      return NextResponse.json(
        { error: `${users} sign-ins are still assigned to ${before.label}. Reassign them first.` },
        { status: 409 }
      );
    }
  }

  plants[index] = {
    ...before,
    label: body?.label !== undefined ? String(body.label).trim() || before.label : before.label,
    state,
    location: body?.location !== undefined ? String(body.location).trim().slice(0, 160) : before.location,
    active,
    updatedAt: new Date().toISOString(),
  };
  savePlants(plants);

  // The state is the one field with a consequence people will not see for
  // months, so it gets its own line in the log.
  if (state !== before.state) {
    recordAudit({
      action: "PLANT_STATE_CHANGED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "plant", targetId: code, targetLabel: before.label,
      detail: `Holiday calendar moved from ${before.state} to ${state}. Everyone at this plant now follows the new state's public holidays.`,
    });
  } else {
    recordAudit({
      action: "PLANT_UPDATED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "plant", targetId: code, targetLabel: before.label,
    });
  }

  return NextResponse.json({ plant: plants[index] });
}
