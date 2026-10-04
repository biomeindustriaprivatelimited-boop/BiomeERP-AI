import { NextRequest, NextResponse } from "next/server";
import { findByUsername, verifyPassword, loadUsers, SEEDED_USERNAME, SEEDED_ADMIN_PASSWORD } from "@/lib/authServer";
import { SERVER_PC_HEADER, isServerPcRequest } from "@/lib/authToken";
import { recordAudit } from "@/lib/audit";
import { issueSession } from "@/lib/issueSession";
import { resetMpinFails } from "@/lib/mpin";
import { lockedFor, noteFail, clearLock } from "@/lib/loginLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the login screen which accounts exist in shape only — whether a
 * first-run admin is still on its seeded password. It deliberately does
 * NOT list usernames: this server is reachable from the plant machines,
 * and a list of valid usernames is half of a password guess.
 */
export async function GET(req: NextRequest) {
  const users = loadUsers();
  const firstRun =
    users.length === 1 &&
    (users[0].username === SEEDED_USERNAME || users[0].username === "admin") &&
    users[0].mustChangePassword;
  // The first-time sign-in is shown only on the server PC itself — never to
  // a phone or PC reaching this server over the network or the internet.
  const onServerPc = await isServerPcRequest(req.headers.get(SERVER_PC_HEADER));
  return NextResponse.json(
    firstRun && onServerPc
      ? { firstRun: true, username: users[0].username, password: SEEDED_ADMIN_PASSWORD }
      : { firstRun: false }
  );
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

  const lockKey = username.toLowerCase();
  const wait = lockedFor(lockKey);
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many wrong passwords. This user ID is locked for ${Math.ceil(wait / 60000)} more minute(s).` },
      { status: 429 }
    );
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
    noteFail(lockKey);
    return badCredentials;
  }
  if (!verifyPassword(password, user)) {
    recordAudit({
      action: "LOGIN_FAILED", userId: user.id, userName: user.name, role: user.role,
      outcome: "failed", errorMessage: "Wrong password",
    });
    noteFail(lockKey);
    return badCredentials;
  }

  clearLock(lockKey);
  // A password sign-in lifts an MPIN block (five wrong MPINs).
  resetMpinFails(user.id);

  return issueSession(req, user, plant, "password");
}
