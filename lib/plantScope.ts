/**
 * Biome Platform — plant scope (server only)
 * -------------------------------------------------------------------
 * Which plant's books a request is allowed to touch.
 *
 * This exists because `/api/plant-data` took the plant straight from the
 * query string. A Rewari manager could ask for `?plant=gangakhed` and get
 * the other plant's biomass sheet — the sidebar hid nothing, because there
 * was nothing to hide behind. Isolation has to be decided on the server
 * from the session, never from a parameter the caller controls.
 *
 * Two spellings are in play and both are load-bearing:
 *   session / permissions use  REW  | GKD   (uppercase codes)
 *   the sheet files use        rewari | gangakhed  (lowercase ids)
 * Everything crossing that boundary goes through here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, signedOutResponse } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { slugForCode, codeForSlug, allSlugs } from "@/lib/plantRegistry";

/** Sheet folder: "rewari" (Mayan), "gangakhed", or a newer plant's code. */
export type PlantSlug = string;

export function slugToCode(slug: string): string | null {
  return codeForSlug(slug);
}

export function codeToSlug(code: string): PlantSlug | null {
  return slugForCode(code);
}

export interface PlantScope {
  /** The plant this request may read and write. */
  slug: PlantSlug;
  /** True for office roles, who legitimately see both. */
  unrestricted: boolean;
  userId: string;
  userName: string;
  role: string;
}

/**
 * Resolves the plant for a request, or returns the response to send back.
 *
 * A field role is pinned to the plant their session was opened for and the
 * requested plant is ignored entirely — not corrected, not warned about,
 * just overridden, because a mismatch here is either a bug or an attempt.
 *
 * Office roles (finance permission) may work across both plants, so their
 * requested plant is honoured.
 */
export async function resolvePlantScope(
  req: NextRequest,
  requested?: string | null
): Promise<{ scope: PlantScope } | { response: NextResponse }> {
  const session = await getSession(req);
  if (!session) {
    return { response: await signedOutResponse(req) };
  }
  const user = findById(session.uid);
  if (!user || !user.active) {
    return { response: NextResponse.json({ error: "This account is no longer active." }, { status: 401 }) };
  }

  // Anyone who can see the company's finances is already trusted with both
  // plants; the separation the business asked for is between the two field
  // managers, and between them and the coordinators.
  const unrestricted = hasPermission(user.role, "finance");

  if (unrestricted) {
    const slug = (requested && codeToSlug(slugToCode(requested) || requested)) || allSlugs()[0] || "rewari";
    return { scope: { slug, unrestricted: true, userId: user.id, userName: user.name, role: user.role } };
  }

  // Field roles: the session's plant wins, always.
  const sessionSlug = session.plant ? codeToSlug(session.plant) : null;
  if (!sessionSlug) {
    return {
      response: NextResponse.json(
        { error: "This account isn't assigned to a plant. Ask an admin to set one." },
        { status: 403 }
      ),
    };
  }

  return {
    scope: { slug: sessionSlug, unrestricted: false, userId: user.id, userName: user.name, role: user.role },
  };
}
