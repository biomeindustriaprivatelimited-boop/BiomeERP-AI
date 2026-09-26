import { NextRequest, NextResponse } from "next/server";
import { findByUsername, verifyPassword, publicUser, loadUsers } from "@/lib/authServer";
import { SESSION_COOKIE, signSession } from "@/lib/authToken";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the login screen which accounts exist in shape only — whether a
 * first-run admin is still on its seeded password. It deliberately does
 * NOT list usernames: this server is reachable from the plant machines,
 * and a list of valid usernames is half of a password guess.
 */
export async function GET() {
  const users = loadUsers();
  const firstRun = users.length === 1 && users[0].username === "admin" && users[0].mustChangePassword;
  return NextResponse.json({ firstRun });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const plant = body.plant ? String(body.plant).trim().toUpperCase() : null;

  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const user = findByUsername(username);

  // Same message and same work either way. Saying "no such user" tells an
  // attacker which half of the guess to keep.
  const badCredentials = NextResponse.json(
    { error: "Username or password is not correct." },
    { status: 401 }
  );
  if (!user) {
    // A failed sign-in is worth recording — a run of them against one name
    // is the only warning you get before a real problem.
    recordAudit({
      action: "LOGIN_FAILED", userId: "unknown", userName: username, role: "-",
      outcome: "failed", errorMessage: "No such account",
    });
    return badCredentials;
  }
  if (!verifyPassword(password, user)) {
    recordAudit({
      action: "LOGIN_FAILED", userId: user.id, userName: user.name, role: user.role,
      outcome: "failed", errorMessage: "Wrong password",
    });
    return badCredentials;
  }

  if (!user.active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  // The plant is not a free choice. A user may only sign in as a plant
  // they are assigned to, so a Rewari manager cannot file a day's entries
  // against Gangakhed by picking the wrong item in a dropdown.
  let sessionPlant: string | null = null;
  if (user.plants.length > 0) {
    if (!plant) {
      return NextResponse.json(
        { error: "Choose which plant you are signing in for.", needsPlant: user.plants },
        { status: 400 }
      );
    }
    if (!user.plants.includes(plant)) {
      return NextResponse.json(
        { error: "You are not assigned to that plant.", needsPlant: user.plants },
        { status: 403 }
      );
    }
    sessionPlant = plant;
  }

  const token = await signSession({
    uid: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    plant: sessionPlant,
    // The page guard runs on the Edge runtime and cannot read the users
    // file, so the effective permissions travel in the token. `av` is the
    // access version they were read at — the API gate refuses any token
    // whose version has moved on, which is what stops a revoked
    // permission from working until the cookie expires.
    perms: effectivePermissions(user.role, user.access),
    av: user.accessVersion || 0,
  });

  recordAudit({
    action: "LOGIN", userId: user.id, userName: user.name, role: user.role,
    plant: sessionPlant, detail: sessionPlant ? `Signed in for ${sessionPlant}` : undefined,
  });

  const res = NextResponse.json({
    user: publicUser(user),
    plant: sessionPlant,
    // Returned for the plant and coordinator apps, which talk to this
    // server across the network and send it back as a bearer token.
    token,
  });

  // No maxAge on purpose: this makes it a SESSION cookie, gone when the
  // app or browser closes. The business asked for auto-login to be off —
  // reopening the app must show the login screen, not resume whoever
  // signed in last (a developer session quietly surviving a restart is a
  // developer session someone else can sit down at). The token itself
  // still expires after eight hours server-side, so a session left open
  // all day dies on its own as well.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return res;
}
