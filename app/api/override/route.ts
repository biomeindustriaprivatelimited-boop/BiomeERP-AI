import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { activeGrant, startOverride, endOverride, OVERRIDE_MINUTES } from "@/lib/override";

/**
 * Switching admin override on and off.
 *
 * Guarded by "users", which only admin holds. Note what this endpoint does
 * NOT do: it never says whether anyone else has an override running. That
 * is on the audit screen, where it belongs, and not somewhere a page can
 * poll it into a badge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const grant = activeGrant(user.id);
  return NextResponse.json({
    active: Boolean(grant),
    grant,
    minutes: OVERRIDE_MINUTES,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();

  // The reason is the whole safeguard. A one-word reason six months from
  // now explains nothing, and the person asking will be you.
  if (reason.length < 15) {
    return NextResponse.json(
      { error: "Say what you need to change and why, in a sentence. This is what appears in the audit log against every change you make." },
      { status: 400 }
    );
  }

  const grant = startOverride({ id: user.id, name: user.name, role: user.role }, reason);
  return NextResponse.json({ active: true, grant, minutes: OVERRIDE_MINUTES }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  endOverride({ id: user.id, name: user.name, role: user.role });
  return NextResponse.json({ active: false });
}
