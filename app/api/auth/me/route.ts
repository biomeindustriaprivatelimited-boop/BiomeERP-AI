import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, publicUser } from "@/lib/authServer";
import { permissionsFor } from "@/lib/permissions";
import { effectivePermissions } from "@/lib/access";

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

  return NextResponse.json({
    user: publicUser(user),
    plant: session.plant,
    // The person's own list, not just their role's — otherwise a grant
    // the developer made would work on the server and stay invisible in
    // the menu, and a revoke would leave a link that 403s when clicked.
    permissions: effectivePermissions(user.role, user.access),
  });
}
