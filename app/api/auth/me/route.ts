import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, publicUser } from "@/lib/authServer";
import { permissionsFor } from "@/lib/permissions";
import { effectivePermissions, inactiveSwitches } from "@/lib/access";
import { SERVER_PC_HEADER, SESSION_COOKIE, SERVER_PC_DEVELOPER_TTL_SECONDS, isServerPcRequest, signSession } from "@/lib/authToken";
import { serverReady, setServerOwner } from "@/lib/serverOwner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public in the sense that it never errors — it answers "nobody" instead
 * of 401, because the app shell calls it on every load, including on the
 * login screen, and a 401 there is noise rather than information.
 *
 * Permissions are computed from the live user record, not from the token,
 * so a role change takes effect on the next page load rather than on the
 * next sign-in.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ user: null, plant: null, permissions: [] });

  const user = findById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ user: null, plant: null, permissions: [] });
  }

  // The developer already signed in on the server PC (a sign-in from
  // before this rule existed, kept across restarts) makes the server ready.
  if (user.role === "developer" && !serverReady() && (await isServerPcRequest(req.headers.get(SERVER_PC_HEADER)))) {
    setServerOwner(user.id, user.username);
  }

  const res = NextResponse.json({
    user: publicUser(user),
    plant: session.plant,
    // The person's own list, not just their role's — otherwise a grant
    // the developer made would work on the server and stay invisible in
    // the menu, and a revoke would leave a link that 403s when clicked.
    permissions: effectivePermissions(user.role, user.access),
    // Modules the developer has frozen or switched off. The menu, hubs,
    // search and home tiles hide them for everyone but the developer.
    switches: (() => { try { return inactiveSwitches(); } catch { return []; } })(),
    locked: req.cookies.get("biome_lock")?.value === "1",
  });

  // The developer's sign-in on the server PC never runs out: browsers keep
  // a cookie at most 400 days, so it is renewed here once a week.
  if (
    user.role === "developer" &&
    session.exp - session.iat > 400 * 86400 &&
    Date.now() / 1000 - session.iat > 7 * 86400 &&
    (await isServerPcRequest(req.headers.get(SERVER_PC_HEADER)))
  ) {
    const token = await signSession(
      { uid: session.uid, username: session.username, name: session.name, role: session.role, plant: session.plant, perms: session.perms, av: session.av },
      SERVER_PC_DEVELOPER_TTL_SECONDS
    );
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 400 * 24 * 60 * 60 });
  }
  return res;
}
