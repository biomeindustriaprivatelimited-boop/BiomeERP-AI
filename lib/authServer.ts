/**
 * Biome Platform — user store (server only)
 * -------------------------------------------------------------------
 * Users live in <DataRoot>/config/users.json alongside vendors.json and
 * clients.json, so a backup of the data folder backs up the accounts too.
 *
 * Passwords are stored as scrypt hashes with a per-user salt. scrypt is
 * in Node's standard library, which matters here: this app is packaged
 * with electron-builder and every native dependency is one more thing
 * that can fail to compile on a machine we cannot see.
 *
 * NEVER import this from a client component — it pulls in `fs`.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { Role, Permission, hasPermission } from "@/lib/permissions";
import { AccessOverride, effectivePermissions, featureBlocks } from "@/lib/access";
import { SESSION_COOKIE, SessionPayload, verifySession, SERVER_PC_HEADER, isServerPcRequest } from "@/lib/authToken";
import { serverReady, SERVER_NOT_READY_MESSAGE } from "@/lib/serverOwner";
import { isBlocked, DEVICE_COOKIE } from "@/lib/devices";

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  /** Plant codes this user may work as. Empty for office roles. */
  plants: string[];
  active: boolean;
  /** Forces a password change at next sign-in. True for seeded accounts. */
  mustChangePassword: boolean;
  /**
   * Exceptions to what this person's role allows. Set by the developer
   * only. Absent for almost everybody, which is the intention — an
   * exception should stay visibly an exception.
   */
  access?: AccessOverride;
  /** Moves whenever access changes, invalidating tokens issued before it. */
  accessVersion?: number;
  /**
   * A force-deleted account. Its credentials are destroyed and it is hidden
   * from every list, but the row survives so the imprest entries and
   * approvals it left behind still resolve to a name.
   */
  deleted?: boolean;
  /** From Organisation — the lists the company actually maintains. */
  designation?: string;
  department?: string;
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

interface UserFile {
  users: User[];
  updatedAt?: string;
}

function usersFile(): string {
  return path.join(paths.configDir, "users.json");
}

/**
 * The first account on a brand-new server: the DEVELOPER, so the person
 * setting up the server PC can sign in, become the server's permanent
 * developer session, and create everyone else's user IDs. It must change
 * its password at the first sign-in.
 */
export const SEEDED_USERNAME = "developer";
export const SEEDED_ADMIN_PASSWORD = "biome-admin";

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, user: User): boolean {
  const attempt = hashPassword(password, user.salt);
  // Constant-time compare. A plain === leaks how much of the hash matched
  // through timing, which is a real (if slow) way to guess a password.
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(user.hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeCredentials(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

/**
 * Reads the user list, creating a single developer account the first time
 * so the app is never locked out of itself. The seeded account must change
 * its password before it can do anything.
 *
 * Only on an EMPTY user list — an existing server never gets a new account
 * with a publicly known password added behind its back.
 */
export function loadUsers(): User[] {
  const file = readJson<UserFile>(usersFile(), { users: [] });
  const users = Array.isArray(file.users) ? file.users : [];
  if (users.length > 0) return users;

  const { salt, hash } = makeCredentials(SEEDED_ADMIN_PASSWORD);
  const now = new Date().toISOString();
  const seeded: User = {
    id: crypto.randomUUID(),
    username: SEEDED_USERNAME,
    name: "Developer",
    role: "developer",
    plants: [],
    active: true,
    mustChangePassword: true,
    salt,
    hash,
    createdAt: now,
    updatedAt: now,
  };
  saveUsers([seeded]);
  return [seeded];
}

export function saveUsers(users: User[]): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(usersFile(), { users, updatedAt: new Date().toISOString() });
}

export function findByUsername(username: string): User | undefined {
  const wanted = String(username || "").trim().toLowerCase();
  return loadUsers().find((u) => u.username.toLowerCase() === wanted);
}

export function findById(id: string): User | undefined {
  return loadUsers().find((u) => u.id === id);
}

/** Everything safe to send to the browser — never the salt or the hash. */
export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    designation: user.designation,
    department: user.department,
    plants: user.plants,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Reads the session from the cookie, or from a bearer token. */
export async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const fromCookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (fromCookie) {
    const session = await verifySession(fromCookie);
    if (session) return session;
  }
  // The plant and coordinator apps talk to this server over the network
  // and cannot rely on a cookie, so a bearer token is accepted too.
  const header = req.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return verifySession(header.slice(7).trim());
  }
  return null;
}

/**
 * Guard for an API route. Returns either the session, or the response to
 * send back. Use it as the first line of a handler:
 *
 *   const auth = await requirePermission(req, "finance");
 *   if ("response" in auth) return auth.response;
 *   // auth.session is now available
 *
 * The middleware already blocks these routes, but this exists as the
 * second lock: middleware config is easy to mis-edit, and a route that
 * checks for itself keeps working when someone does.
 */
export async function requirePermission(
  req: NextRequest,
  permission: Permission
): Promise<{ session: SessionPayload } | { response: NextResponse }> {
  const session = await getSession(req);
  if (!session) {
    return {
      response: NextResponse.json({ error: "Please sign in." }, { status: 401 }),
    };
  }

  // Clients work only while the developer is signed in on the server PC.
  if (!serverReady() && !(await isServerPcRequest(req.headers.get(SERVER_PC_HEADER)))) {
    return {
      response: NextResponse.json({ error: SERVER_NOT_READY_MESSAGE, code: "SERVER_NOT_READY" }, { status: 503 }),
    };
  }

  // The token says what the role was at sign-in. If the account has since
  // been disabled or its role reduced, the live file is what counts.
  const user = findById(session.uid);
  if (!user || !user.active) {
    return {
      response: NextResponse.json({ error: "This account is no longer active." }, { status: 401 }),
    };
  }

  // Access was changed while this session was open. Serving the token's
  // stale list would leave a revoked permission working until the cookie
  // expired, which is not revoked at all.
  const version = user.accessVersion || 0;
  if ((session.av || 0) !== version) {
    return {
      response: NextResponse.json(
        { error: "Your access was changed. Please sign in again.", code: "ACCESS_CHANGED" },
        { status: 401 }
      ),
    };
  }

  // A device the developer blocked (Developer → Server & devices) is
  // refused everywhere, whoever signs in on it.
  if (user.role !== "developer" && isBlocked(req.cookies.get(DEVICE_COOKIE)?.value)) {
    return {
      response: NextResponse.json({ error: "This device has been blocked by the administrator.", code: "DEVICE_BLOCKED" }, { status: 403 }),
    };
  }

  const allowed = effectivePermissions(user.role, user.access);
  if (!allowed.includes(permission)) {
    return {
      response: NextResponse.json(
        { error: "Your role does not have access to this." },
        { status: 403 }
      ),
    };
  }

  // A module the developer has frozen or switched off. Checked after the
  // permission so a person without access never learns a module exists,
  // and the message is the developer's own words rather than a bare 503.
  const blocked = featureBlocks(req.nextUrl.pathname, req.method);
  if (blocked && user.role !== "developer") {
    return {
      response: NextResponse.json(
        { error: blocked.message, code: "FEATURE_" + blocked.state.toUpperCase() },
        { status: 503 }
      ),
    };
  }

  return { session: { ...session, role: user.role } };
}
