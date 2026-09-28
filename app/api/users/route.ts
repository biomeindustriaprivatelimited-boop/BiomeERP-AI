import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";
import crypto from "crypto";
import {
  loadUsers,
  saveUsers,
  publicUser,
  makeCredentials,
  requirePermission,
  findById,
  User,
} from "@/lib/authServer";
import { ROLES, Role } from "@/lib/permissions";
import { loadEntries, loadPeople } from "@/lib/imprest";
import { recordAudit } from "@/lib/audit";

function livePlants() { return plantOptions().map((p) => ({ code: p.code, label: p.label })); }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = ROLES.map((r) => r.id);
const VALID_PLANTS = { includes: (c: string) => livePlants().some((p) => p.code === c) };

function cleanPlants(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const codes = input.map((p) => String(p).trim().toUpperCase());
  return Array.from(new Set(codes.filter((c) => VALID_PLANTS.includes(c))));
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid);
  const isDeveloper = me?.role === "developer";

  return NextResponse.json({
    // The developer account does not appear in anybody else's user list.
    // Filtered here rather than hidden in the page, so an admin reading
    // the raw API response sees the same thing the screen shows.
    users: loadUsers()
      .filter((u) => !u.deleted)
      .filter((u) => isDeveloper || u.role !== "developer")
      .map(publicUser),
    // Nor is "developer" offered as a role to assign.
    roles: ROLES.filter((r) => isDeveloper || r.id !== "developer"),
    plants: livePlants(),
    // Admin still adds people and resets passwords; deciding what a person
    // may DO now sits with the developer, so the screen can stop offering
    // a control that the server will refuse.
    canChangeRole: isDeveloper,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const role = String(body.role || "") as Role;
  const password = String(body.password || "");
  const plants = cleanPlants(body.plants);

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-32 characters: letters, numbers, dot, dash or underscore." },
      { status: 400 }
    );
  }
  if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }
  // Creating a developer account is how an admin would grant themselves
  // everything this round just took away.
  if (role === "developer" && findById(auth.session.uid)?.role !== "developer") {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "The password must be at least 8 characters." }, { status: 400 });
  }
  // A plant manager without a plant would see nothing and could file
  // nothing, so the account is refused rather than created half-broken.
  if (role === "plant_manager" && plants.length === 0) {
    return NextResponse.json(
      { error: "A plant manager must be assigned at least one plant." },
      { status: 400 }
    );
  }

  const users = loadUsers();
  if (users.some((u) => u.username.toLowerCase() === username)) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  const { salt, hash } = makeCredentials(password);
  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    username,
    name,
    role,
    plants,
    // Job title and team, chosen from the Organisation lists so a report
    // grouped by department actually groups.
    designation: String(body.designation || "").trim() || undefined,
    department: String(body.department || "").trim() || undefined,
    active: true,
    // Whoever creates the account knows the password. Forcing a change
    // means the person's password is theirs alone from day one.
    mustChangePassword: true,
    salt,
    hash,
    createdAt: now,
    updatedAt: now,
  };

  saveUsers([...users, user]);
  recordAudit({
    action: "USER_CREATED", userId: auth.session.uid, userName: auth.session.name, role: auth.session.role,
    targetType: "user", targetId: user.id, targetLabel: `${user.name} (@${user.username})`,
    detail: `Role ${user.role}${user.designation ? ` · ${user.designation}` : ""}${user.plants.length ? ` · ${user.plants.join(", ")}` : ""}`,
  });
  return NextResponse.json({ user: publicUser(user) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || !body.id) {
    return NextResponse.json({ error: "Which account should be updated?" }, { status: 400 });
  }

  const users = loadUsers();
  const existing = users.find((u) => u.id === body.id);
  if (!existing) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const me = findById(auth.session.uid);
  const isDeveloper = me?.role === "developer";

  // A developer account is invisible AND untouchable from here. Without
  // this, an admin who guessed the id could deactivate the one account
  // that holds access control.
  if (existing.role === "developer" && !isDeveloper) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const requestedRole = body.role !== undefined ? (String(body.role) as Role) : existing.role;
  if (!VALID_ROLES.includes(requestedRole)) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }
  // Changing what someone may do is developer work now. An admin editing
  // a person's name or plant is fine; an admin quietly promoting an
  // account is the mistake this was asked to make impossible.
  if (requestedRole !== existing.role && !isDeveloper) {
    return NextResponse.json(
      { error: "Roles are set by the developer. Ask them to change this one." },
      { status: 403 }
    );
  }
  const role = requestedRole;

  const plants = body.plants !== undefined ? cleanPlants(body.plants) : existing.plants;
  if (role === "plant_manager" && plants.length === 0) {
    return NextResponse.json(
      { error: "A plant manager must be assigned at least one plant." },
      { status: 400 }
    );
  }

  const active = body.active !== undefined ? Boolean(body.active) : existing.active;

  // Locking yourself out of the only admin account leaves nobody able to
  // create another one, and the fix would be hand-editing users.json.
  const remainingAdmins = users.filter(
    (u) => u.active && u.role === "admin" && u.id !== existing.id
  ).length;
  const losesAdmin = existing.role === "admin" && (role !== "admin" || !active);
  if (losesAdmin && remainingAdmins === 0) {
    return NextResponse.json(
      { error: "This is the last admin account. Make someone else an admin first." },
      { status: 409 }
    );
  }

  // A username can be changed, but it has to stay unique — two accounts
  // answering to one name would make the sign-in ambiguous.
  let username = existing.username;
  if (body.username !== undefined) {
    const wanted = String(body.username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(wanted)) {
      return NextResponse.json(
        { error: "Username must be 3-32 characters: letters, numbers, dot, dash or underscore." },
        { status: 400 }
      );
    }
    if (users.some((u) => u.id !== existing.id && u.username.toLowerCase() === wanted)) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }
    username = wanted;
  }

  const updated: User = {
    ...existing,
    username,
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    role,
    plants,
    active,
    updatedAt: new Date().toISOString(),
  };

  // An admin resetting someone's password sets a temporary one; the
  // person must replace it at their next sign-in.
  if (body.newPassword) {
    const pw = String(body.newPassword);
    if (pw.length < 8) {
      return NextResponse.json(
        { error: "The password must be at least 8 characters." },
        { status: 400 }
      );
    }
    const { salt, hash } = makeCredentials(pw);
    updated.salt = salt;
    updated.hash = hash;
    updated.mustChangePassword = true;
  }

  saveUsers(users.map((u) => (u.id === updated.id ? updated : u)));
  recordAudit({
    action: body.newPassword ? "USER_PASSWORD_RESET" : "USER_UPDATED",
    userId: auth.session.uid, userName: auth.session.name, role: auth.session.role,
    targetType: "user", targetId: updated.id, targetLabel: `${updated.name} (@${updated.username})`,
    detail: existing.active !== updated.active
      ? (updated.active ? "Re-enabled" : "Disabled")
      : existing.role !== updated.role ? `Role ${existing.role} → ${updated.role}` : undefined,
  });
  return NextResponse.json({ user: publicUser(updated) });
}

/**
 * Disable, or permanently delete.
 *
 * Disabling is the default and the right answer almost always: the account
 * id is stamped on every imprest entry, attendance mark and approval that
 * person ever made, and removing the row leaves that history pointing at
 * nothing. Deletion exists because the business asked for it — it requires
 * `?purge=1` AND the username typed back, so it cannot happen on a
 * mis-click, and it refuses outright once the account has left a trail.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const id = req.nextUrl.searchParams.get("id");
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  const confirmName = (req.nextUrl.searchParams.get("confirm") || "").trim().toLowerCase();
  if (!id) return NextResponse.json({ error: "Which account?" }, { status: 400 });

  const users = loadUsers();
  const existing = users.find((u) => u.id === id);
  if (!existing) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  if (existing.id === auth.session.uid) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 409 });
  }

  const remainingAdmins = users.filter(
    (u) => u.active && u.role === "admin" && u.id !== id
  ).length;
  if (existing.role === "admin" && remainingAdmins === 0) {
    return NextResponse.json(
      { error: "This is the last admin account. Make someone else an admin first." },
      { status: 409 }
    );
  }

  if (!purge) {
    saveUsers(
      users.map((u) => (u.id === id ? { ...u, active: false, updatedAt: new Date().toISOString() } : u))
    );
    return NextResponse.json({ ok: true, disabled: true });
  }

  if (confirmName !== existing.username.toLowerCase()) {
    return NextResponse.json(
      { error: `Type the username "${existing.username}" to confirm permanent deletion.` },
      { status: 400 }
    );
  }

  // The developer has super access: rather than refusing, a forced delete
  // leaves a tombstone. Credentials are destroyed so the account can never
  // sign in again and it disappears from the list, while the id and name
  // survive so the imprest entries and approvals it left behind still
  // resolve to a person instead of to nothing.
  const force = req.nextUrl.searchParams.get("force") === "1";
  const trail = countTrail(existing.id);
  if (force && auth.session.role === "developer" && trail.total > 0) {
    saveUsers(
      users.map((u) =>
        u.id === id
          ? {
              ...u,
              active: false,
              deleted: true,
              username: `deleted-${u.id.slice(0, 8)}`,
              salt: "",
              hash: "",
              mustChangePassword: false,
              updatedAt: new Date().toISOString(),
            }
          : u
      )
    );
    recordAudit({
      action: "USER_DELETED", userId: auth.session.uid, userName: auth.session.name, role: auth.session.role,
      targetType: "user", targetId: existing.id, targetLabel: `${existing.name} (@${existing.username})`,
      detail: `Force-deleted by developer; ${trail.total} historical record(s) kept against a tombstone`,
    });
    return NextResponse.json({ ok: true, deleted: true, tombstoned: true, trail });
  }

  if (trail.total > 0) {
    return NextResponse.json(
      {
        error:
          `This account has ${trail.total} record(s) against it — ` +
          [
            trail.imprestFiled && `${trail.imprestFiled} imprest entr${trail.imprestFiled === 1 ? "y" : "ies"} filed`,
            trail.imprestDecided && `${trail.imprestDecided} approval(s)`,
            trail.imprestHolder && "an imprest float",
          ].filter(Boolean).join(", ") +
          ". Deleting it would leave that history pointing at nobody. Disable it instead — or, as the developer, delete it anyway and the history will point at a tombstone.",
        trail,
      },
      { status: 409 }
    );
  }

  saveUsers(users.filter((u) => u.id !== id));
  // The account row is gone; this line is the only thing that remembers it
  // ever existed, which is exactly why the log is append-only.
  recordAudit({
    action: "USER_DELETED", userId: auth.session.uid, userName: auth.session.name, role: auth.session.role,
    targetType: "user", targetId: existing.id, targetLabel: `${existing.name} (@${existing.username})`,
    detail: "Permanently deleted",
  });
  return NextResponse.json({ ok: true, deleted: true });
}

/**
 * What this account has left behind. Checked before a permanent delete so
 * the refusal can say what the trail actually is rather than "no".
 */
function countTrail(userId: string) {
  let imprestFiled = 0, imprestDecided = 0, imprestHolder = 0;
  try {
    const entries = loadEntries();
    imprestFiled = entries.filter((e) => e.createdBy === userId).length;
    imprestDecided = entries.filter((e) => e.decidedBy === userId).length;
    imprestHolder = loadPeople().filter((p) => p.userId === userId).length;
  } catch {
    // If the imprest store cannot be read we assume a trail exists rather
    // than assuming none — the safe direction is to refuse the delete.
    return { imprestFiled: 0, imprestDecided: 0, imprestHolder: 0, total: 1 };
  }
  return {
    imprestFiled, imprestDecided, imprestHolder,
    total: imprestFiled + imprestDecided + imprestHolder,
  };
}
