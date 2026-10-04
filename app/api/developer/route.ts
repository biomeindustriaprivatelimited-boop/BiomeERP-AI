import { makeAnnouncement, loadAnnouncements, saveAnnouncements } from "@/lib/announcements";
import { PERMISSION_INFO } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requirePermission, findById, loadUsers, saveUsers, publicUser } from "@/lib/authServer";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import {
  ROLES, ALL_PERMISSIONS, DEVELOPER_ONLY, permissionsFor, Role, Permission,
} from "@/lib/permissions";
import {
  cleanOverride, effectivePermissions, loadFeatures, saveFeatures,
  SWITCHABLE, FEATURE_STATES, FeatureState, FeatureSwitch,
} from "@/lib/access";
import { recordAudit } from "@/lib/audit";

/**
 * The developer's own screen.
 *
 * Everything here is gated on the `developer` permission, which only the
 * developer role holds — including reading it. An admin hitting this URL
 * gets the same 404 the middleware gives any hidden module: nothing here
 * confirms that a developer account exists.
 *
 * ON THE HIDDEN LOG — worth reading before changing it.
 * The business asked for the developer's activity to be invisible to
 * everyone else. It is: `/audit` filters developer entries out for every
 * other role. What it does NOT do is stop recording. A record that is
 * never written cannot be produced later, and if this account is ever held
 * by someone outside the business, "nobody can see what they did" stops
 * being a convenience and becomes the problem. So the actions are written
 * to a developer-only log, and only the developer can read it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DevLogEntry {
  at: string;
  by: string;
  byName: string;
  action: string;
  target: string;
  detail: string;
}

function devLogFile(): string {
  return path.join(paths.root, "developer", "activity.jsonl");
}

function recordDeveloper(entry: Omit<DevLogEntry, "at">): void {
  try {
    ensureDir(path.join(paths.root, "developer"));
    const fs = require("fs") as typeof import("fs");
    fs.appendFileSync(devLogFile(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    // Never throw from logging — the same rule recordAudit follows. A
    // failed write must not take down the action it was describing.
  }
}

function readDeveloperLog(limit = 300): DevLogEntry[] {
  try {
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(devLogFile())) return [];
    return fs
      .readFileSync(devLogFile(), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line) as DevLogEntry; } catch { return null; } })
      .filter((x): x is DevLogEntry => Boolean(x))
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid)!;

  const users = loadUsers();

  return NextResponse.json({
    users: users.map((u) => ({
      ...publicUser(u),
      access: u.access || null,
      accessVersion: u.accessVersion || 0,
      rolePermissions: permissionsFor(u.role),
      effective: effectivePermissions(u.role, u.access),
    })),
    roles: ROLES,
    permissions: ALL_PERMISSIONS,
    developerOnly: DEVELOPER_ONLY,
    features: SWITCHABLE.map((f) => {
      const sw = loadFeatures().find((x) => x.id === f.id);
      return { ...f, state: sw?.state || "live", message: sw?.message || "", changedBy: sw?.changedBy || "", changedAt: sw?.changedAt || "" };
    }),
    featureStates: FEATURE_STATES,
    activity: readDeveloperLog(),
    me: publicUser(me),
  });
}

/** Change one user's access — role, or individual features activated / deactivated. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "access.grant");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "Which user?" }, { status: 400 });

  const users = loadUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });

  const before = users[index];

  // Locking yourself out of the one account that can unlock anything is
  // not recoverable from inside the app.
  if (before.id === me.id && body.role && body.role !== "developer") {
    return NextResponse.json(
      { error: "You cannot move yourself off the developer role — there would be no way back in." },
      { status: 409 }
    );
  }

  let role: Role = before.role;
  if (body.role && ROLES.some((r) => r.id === body.role)) role = body.role;

  const access = body.access ? cleanOverride(body.access, me.name) : before.access;

  // A developer-only key handed to an ordinary role would put feature
  // switches and access control back one mis-click away, which is the
  // whole thing this round was asked to prevent.
  const smuggled = (access?.granted || []).filter(
    (p: Permission) => DEVELOPER_ONLY.includes(p) && role !== "developer"
  );
  if (smuggled.length) {
    return NextResponse.json(
      { error: `${smuggled.join(", ")} can only belong to the developer role.` },
      { status: 400 }
    );
  }

  const changed =
    role !== before.role ||
    JSON.stringify(access?.granted || []) !== JSON.stringify(before.access?.granted || []) ||
    JSON.stringify(access?.revoked || []) !== JSON.stringify(before.access?.revoked || []);

  users[index] = {
    ...before,
    role,
    access,
    // Moving this forces their next request to be refused with "sign in
    // again" rather than being served from the list in their old token.
    accessVersion: changed ? (before.accessVersion || 0) + 1 : before.accessVersion || 0,
    updatedAt: new Date().toISOString(),
  };
  saveUsers(users);

  const summary = [
    role !== before.role ? `role ${before.role} → ${role}` : "",
    (access?.granted || []).length ? `activated ${access!.granted.join(", ")}` : "",
    (access?.revoked || []).length ? `deactivated ${access!.revoked.join(", ")}` : "",
  ].filter(Boolean).join("; ") || "no change";

  recordDeveloper({
    by: me.id, byName: me.name, action: "ACCESS_CHANGED",
    target: `${before.name} (${before.username})`, detail: summary,
  });

  // Also written to the ordinary audit log, because the PERSON affected
  // and their manager have a right to know their access changed. What the
  // developer did elsewhere stays hidden; a change to someone else's
  // account is not the developer's private business.
  if (changed) {
    recordAudit({
      action: "USER_ACCESS_CHANGED",
      userId: before.id, userName: before.name, role: before.role,
      targetType: "user", targetId: before.id, targetLabel: before.name,
      detail: summary,
    });
  }

  // Tell the person what changed. A feature that quietly vanishes reads
  // as a bug; a one-line notice reads as a decision.
  try {
    const after = users[index];
    const beforeSet = new Set(effectivePermissions(before.role, before.access));
    const afterSet = new Set(effectivePermissions(after.role, after.access));
    const lost = [...beforeSet].filter((p) => !afterSet.has(p));
    const gained = [...afterSet].filter((p) => !beforeSet.has(p));
    if (lost.length || gained.length) {
      const name = (p: string) => PERMISSION_INFO[p]?.label || p;
      const list = loadAnnouncements();
      list.unshift(makeAnnouncement({
        kind: lost.length ? "warning" : "info",
        title: "Your access was changed",
        body: `${lost.length ? `Deactivated: ${lost.map(name).join(", ")}. Those features no longer appear in your menu.` : ""}${gained.length ? ` Activated: ${gained.map(name).join(", ")}.` : ""} Changed by ${me.name}. Sign in again to apply.`,
        audience: { roles: "all", plants: [], userIds: [before.id] },
        by: { id: me.id, name: me.name },
      }));
      saveAnnouncements(list);
    }
  } catch { /* notice is best-effort */ }

  return NextResponse.json({ user: { ...publicUser(users[index]), access: users[index].access || null } });
}

/** Freeze or switch off a module. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "feature.switch");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const state = String(body?.state ?? "") as FeatureState;
  const message = String(body?.message ?? "").trim().slice(0, 300);

  const feature = SWITCHABLE.find((f) => f.id === id);
  if (!feature) return NextResponse.json({ error: "That module cannot be switched." }, { status: 400 });
  if (!FEATURE_STATES.some((s) => s.id === state)) {
    return NextResponse.json({ error: "Choose Live, Frozen or Off." }, { status: 400 });
  }

  // Whoever walks into the wall deserves a sentence they can act on.
  // "Coordination is frozen" with no reason produces a phone call, which
  // is exactly what a message would have saved.
  if (state !== "live" && message.length < 10) {
    return NextResponse.json(
      { error: "Write what people should see when they hit this — a bare refusal just generates phone calls." },
      { status: 400 }
    );
  }

  const features = loadFeatures().filter((f) => f.id !== id);
  const sw: FeatureSwitch = {
    id, state, message,
    changedBy: me.name,
    changedAt: new Date().toISOString(),
  };
  saveFeatures([...features, sw]);

  recordDeveloper({
    by: me.id, byName: me.name, action: "FEATURE_SWITCHED",
    target: feature.label, detail: `${state}${message ? ` — ${message}` : ""}`,
  });

  return NextResponse.json({ feature: sw });
}
