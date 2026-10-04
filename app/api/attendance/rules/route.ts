import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { loadRules, saveRules, cleanRules } from "@/lib/leave";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attendance rules — stored in <data root>/config/attendance-rules.json.
 *
 * Anyone who marks attendance may READ them (the screen needs the cut-off,
 * week-off and late rule to draw honestly). Only the DEVELOPER changes
 * them: the business asked that how attendance behaves is decided in one
 * place, by one person.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const canConfigure =
    user.role === "developer" || effectivePermissions(user.role, user.access).includes("developer");
  return NextResponse.json({ rules: loadRules(), canConfigure });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const isDev = user.role === "developer" || effectivePermissions(user.role, user.access).includes("developer");
  if (!isDev) {
    return NextResponse.json({ error: "Only the developer can change attendance rules." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const before = loadRules();
  const next = cleanRules({
    ...before,
    ...body,
    updatedAt: new Date().toISOString(),
    updatedByName: user.name,
  });
  saveRules(next);

  const changed = (Object.keys(next) as (keyof typeof next)[])
    .filter((k) => k !== "updatedAt" && k !== "updatedByName")
    .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  recordAudit({
    action: "ATTENDANCE_RULES_CHANGED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "settings", targetLabel: "Attendance rules",
    detail: changed.length ? changed.join(", ") : "no change",
  });

  return NextResponse.json({ rules: loadRules() });
}
