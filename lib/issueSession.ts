/**
 * Turning a verified person into a signed-in session — shared by the
 * password sign-in and the MPIN sign-in, so both follow exactly the same
 * rules (plant choice, server-ready gate, the server PC's developer
 * session, audit, cookies).
 *
 * Server only.
 */
import { NextRequest, NextResponse } from "next/server";
import { publicUser, User } from "@/lib/authServer";
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, SERVER_PC_DEVELOPER_TTL_SECONDS, SERVER_PC_HEADER,
  isServerPcRequest, signSession,
} from "@/lib/authToken";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { serverReady, setServerOwner, SERVER_NOT_READY_MESSAGE } from "@/lib/serverOwner";
import { rememberOnDevice, LOCK_COOKIE } from "@/lib/mpin";

export async function issueSession(
  req: NextRequest,
  user: User,
  plantWanted: string | null,
  how: "password" | "mpin"
): Promise<NextResponse> {
  if (!user.active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  // The plant is not a free choice. A user may only sign in as a plant
  // they are assigned to, so a Rewari manager cannot file a day's entries
  // against Gangakhed by picking the wrong item in a dropdown.
  let sessionPlant: string | null = null;
  if (user.plants.length > 0) {
    if (!plantWanted) {
      return NextResponse.json({ error: "Choose which plant you are signing in for.", needsPlant: user.plants }, { status: 400 });
    }
    if (!user.plants.includes(plantWanted)) {
      return NextResponse.json({ error: "You are not assigned to that plant.", needsPlant: user.plants }, { status: 403 });
    }
    sessionPlant = plantWanted;
  }

  // The developer at the server PC stays signed in there until they sign
  // out by hand (the sign-in is renewed by /api/auth/me so it never runs
  // out). Everyone else gets the working-day session.
  const onServerPc = await isServerPcRequest(req.headers.get(SERVER_PC_HEADER));
  const persistent = user.role === "developer" && onServerPc;

  // Clients may sign in only while the server is ready (the developer has
  // signed in on the server PC). The server PC itself can always sign in.
  if (!onServerPc && !serverReady()) {
    return NextResponse.json({ error: SERVER_NOT_READY_MESSAGE, code: "SERVER_NOT_READY" }, { status: 503 });
  }
  if (persistent) setServerOwner(user.id, user.username);
  const ttl = persistent ? SERVER_PC_DEVELOPER_TTL_SECONDS : SESSION_TTL_SECONDS;

  const token = await signSession(
    {
      uid: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      plant: sessionPlant,
      // The page guard runs on the Edge runtime and cannot read the users
      // file, so the effective permissions travel in the token; `av` lets
      // the API refuse a token issued before an access change.
      perms: effectivePermissions(user.role, user.access),
      av: user.accessVersion || 0,
    },
    ttl
  );

  recordAudit({
    action: how === "mpin" ? "LOGIN_MPIN" : "LOGIN",
    userId: user.id, userName: user.name, role: user.role, plant: sessionPlant,
    detail: [
      how === "mpin" ? "Signed in with MPIN" : null,
      persistent ? "on the server PC (stays signed in until signed out)" : null,
      sessionPlant ? `for ${sessionPlant}` : null,
    ].filter(Boolean).join(" ") || undefined,
  });

  const res = NextResponse.json({ user: publicUser(user), plant: sessionPlant, token });

  // A session cookie (gone when the app closes) for everyone, except the
  // developer on the server PC, whose sign-in is kept on disk.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    ...(persistent ? { maxAge: 400 * 24 * 60 * 60 } : {}),
  });
  // A fresh sign-in unlocks this device and remembers the person here, so
  // they can come back with their MPIN.
  res.cookies.set(LOCK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  await rememberOnDevice(req, res, user.id);
  return res;
}
