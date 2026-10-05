import { NextRequest, NextResponse } from "next/server";
import { findById } from "@/lib/authServer";
import { knownMpinUsers, deviceKnows, checkMpin, disabledResponseFor } from "@/lib/mpin";
import { issueSession } from "@/lib/issueSession";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MPIN sign-in — only for people THIS device already knows (a password
 * sign-in here wrote the signed "biome_known" cookie). A new PC or phone
 * gets an empty list and must use the user ID and password.
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({ users: await knownMpinUsers(req) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const uid = String(body.uid || "");
  const mpin = String(body.mpin || "").trim();
  const plant = body.plant ? String(body.plant).trim().toUpperCase() : null;
  if (!uid || !/^\d{8}$/.test(mpin)) return NextResponse.json({ error: "Enter your 8-digit MPIN." }, { status: 400 });
  if (!(await deviceKnows(req, uid))) {
    return NextResponse.json({ error: "This device does not know you yet — sign in with your user ID and password.", code: "UNKNOWN_DEVICE" }, { status: 401 });
  }
  const user = findById(uid);
  if (!user) return NextResponse.json({ error: "Sign in with your user ID and password." }, { status: 401 });
  // Disabled (resigned / terminated): refused before the MPIN is even
  // checked, and this device forgets them.
  if (!user.active || user.deleted) return disabledResponseFor(req, user.id);
  const r = checkMpin(uid, mpin);
  if (!r.ok) {
    recordAudit({ action: "LOGIN_FAILED", userId: user.id, userName: user.name, role: user.role, outcome: "failed", errorMessage: "Wrong MPIN" });
    return NextResponse.json(
      {
        error: r.blocked
          ? "MPIN blocked after too many wrong tries — sign in with your user ID and password."
          : `Wrong MPIN. ${r.left} tr${r.left === 1 ? "y" : "ies"} left before MPIN is blocked.`,
        code: r.blocked ? "MPIN_BLOCKED" : "MPIN_WRONG",
      },
      { status: 401 }
    );
  }
  return issueSession(req, user, plant, "mpin");
}
