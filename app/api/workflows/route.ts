import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { loadRules, saveRules, newRule } from "@/lib/workflows";

/** No-code workflow rules: list, create, toggle, delete. Settings-level power. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ rules: loadRules() });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));
  const rules = loadRules();

  if (body.action === "create") {
    const r = newRule({ name: String(body.name || ""), when: body.when, if: Array.isArray(body.if) ? body.if : [], then: Array.isArray(body.then) ? body.then : [] });
    if (!r.then.length) return NextResponse.json({ error: "A rule needs at least one THEN action." }, { status: 400 });
    rules.push(r); saveRules(rules);
    recordAudit({ action: "workflow.create", userId: user.id, userName: user.name, role: user.role, targetType: "workflow", targetId: r.id, targetLabel: r.name });
    return NextResponse.json({ rule: r });
  }
  const r = rules.find((x) => x.id === body.id);
  if (!r) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  if (body.action === "toggle") { r.enabled = !r.enabled; saveRules(rules); }
  else if (body.action === "delete") { saveRules(rules.filter((x) => x.id !== r.id)); }
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  recordAudit({ action: `workflow.${body.action}`, userId: user.id, userName: user.name, role: user.role, targetType: "workflow", targetId: r.id, targetLabel: r.name });
  return NextResponse.json({ ok: true });
}
