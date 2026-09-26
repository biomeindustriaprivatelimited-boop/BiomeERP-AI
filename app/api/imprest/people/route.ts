import { NextRequest, NextResponse } from "next/server";
import { requirePermission, loadUsers, publicUser } from "@/lib/authServer";
import { loadPeople, savePeople, makePerson, loadEntries, balanceFor } from "@/lib/imprest";
import { loadEmployees } from "@/lib/payroll";
import { PLANTS } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANT_CODES = PLANTS.map((p) => p.code);

/**
 * The register of people who hold a float. Managed by accounts and admin;
 * everyone else reads their own record through /api/imprest/entries.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.manage");
  if ("response" in auth) return auth.response;

  const people = loadPeople();
  const entries = loadEntries();

  return NextResponse.json({
    people: people.map((p) => ({ ...p, balance: balanceFor(p.id, entries) })),
    // Offered so a holder can be tied to a login. Only active accounts —
    // linking a disabled one would create a float nobody can file against.
    users: loadUsers().filter((u) => u.active).map(publicUser),
    // A float is only opened for someone on the rolls, so the picker
    // offers the employee master rather than a free-text name.
    employees: loadEmployees()
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, code: e.code, name: e.name, designation: e.designation, plant: e.plant }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    plants: PLANTS,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.manage");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const designation = String(body.designation || "").trim();
  const plant = String(body.plant || "").trim().toUpperCase();
  const userId = body.userId ? String(body.userId) : null;
  const monthlyLimit = Number(body.monthlyLimit) || 0;

  if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
    return NextResponse.json({ error: "Give the holder a short code — 2 to 12 letters or numbers." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });
  if (plant && !PLANT_CODES.includes(plant)) {
    return NextResponse.json({ error: "That plant code isn't recognised." }, { status: 400 });
  }
  if (monthlyLimit < 0) {
    return NextResponse.json({ error: "A monthly limit can't be negative." }, { status: 400 });
  }

  const people = loadPeople();
  if (people.some((p) => p.code === code)) {
    return NextResponse.json({ error: "That holder code is already in use." }, { status: 409 });
  }

  // The business rule: an imprest float is booked only for someone who is
  // actually employed. The check is by name against the ACTIVE employee
  // master — a person who left, or was never put on the rolls, cannot be
  // handed company cash through this register. Skipped only while the
  // employee master is still empty, so a fresh install isn't deadlocked.
  const employees = loadEmployees();
  if (employees.length > 0) {
    const wanted = name.trim().toLowerCase();
    const match = employees.find(
      (e) => e.active && (e.name.trim().toLowerCase() === wanted || e.code.toUpperCase() === code)
    );
    if (!match) {
      return NextResponse.json(
        { error: `${name} is not on the active employee rolls. Add them under Employees first — an imprest float is only opened for someone employed by the company.` },
        { status: 409 }
      );
    }
  }
  // One login must not drive two floats, or every entry becomes ambiguous
  // about which account it belongs to.
  if (userId && people.some((p) => p.userId === userId && p.active)) {
    return NextResponse.json({ error: "That login already holds an imprest account." }, { status: 409 });
  }

  const person = makePerson({ code, name, designation, plant, userId, monthlyLimit });
  savePeople([...people, person]);
  return NextResponse.json({ person }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.manage");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which holder should be updated?" }, { status: 400 });

  const people = loadPeople();
  const existing = people.find((p) => p.id === body.id);
  if (!existing) return NextResponse.json({ error: "Holder not found." }, { status: 404 });

  const userId = body.userId !== undefined ? (body.userId ? String(body.userId) : null) : existing.userId;
  if (userId && people.some((p) => p.userId === userId && p.active && p.id !== existing.id)) {
    return NextResponse.json({ error: "That login already holds an imprest account." }, { status: 409 });
  }

  const plant = body.plant !== undefined ? String(body.plant).trim().toUpperCase() : existing.plant;
  if (plant && !PLANT_CODES.includes(plant)) {
    return NextResponse.json({ error: "That plant code isn't recognised." }, { status: 400 });
  }

  const updated = {
    ...existing,
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    designation: body.designation !== undefined ? String(body.designation).trim() : existing.designation,
    plant,
    userId,
    monthlyLimit: body.monthlyLimit !== undefined ? Math.max(0, Number(body.monthlyLimit) || 0) : existing.monthlyLimit,
    active: body.active !== undefined ? Boolean(body.active) : existing.active,
    updatedAt: new Date().toISOString(),
  };

  // Closing a float that still holds cash hides a real shortfall, so it is
  // refused until the money is returned or written off as an expense.
  if (existing.active && !updated.active) {
    const bal = balanceFor(existing.id, loadEntries());
    if (Math.abs(bal.inHand) > 0.5) {
      return NextResponse.json(
        { error: `This holder still shows ₹${bal.inHand.toLocaleString("en-IN")} in hand. Settle it before closing the account.` },
        { status: 409 }
      );
    }
  }

  savePeople(people.map((p) => (p.id === updated.id ? updated : p)));
  return NextResponse.json({ person: updated });
}
