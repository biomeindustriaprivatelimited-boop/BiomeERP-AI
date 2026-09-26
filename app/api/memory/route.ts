import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { loadMemory, saveMemory, remember, RETENTION_DAYS } from "@/lib/enterprise2";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings"); if ("response" in auth) return auth.response;
  return NextResponse.json({ items: loadMemory(), retentionDays: RETENTION_DAYS });
}
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!; const body = await req.json().catch(() => ({}));
  if (body.action === "add") { const m = remember({ kind: body.kind || "note", text: String(body.text || ""), source: "manual", createdBy: user.name, roles: Array.isArray(body.roles) ? body.roles : undefined, pinned: Boolean(body.pinned) }); recordAudit({ action: "memory.add", userId: user.id, userName: user.name, role: user.role, targetType: "memory", targetId: m.id, targetLabel: m.text.slice(0, 60) }); return NextResponse.json({ item: m }); }
  const items = loadMemory(); const m = items.find((x) => x.id === body.id); if (!m) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (body.action === "delete") { saveMemory(items.filter((x) => x.id !== m.id)); recordAudit({ action: "memory.delete", userId: user.id, userName: user.name, role: user.role, targetType: "memory", targetId: m.id, targetLabel: m.text.slice(0, 60) }); return NextResponse.json({ ok: true }); }
  if (body.action === "edit") { m.text = String(body.text || m.text).slice(0, 600); if (Array.isArray(body.roles)) m.roles = body.roles; m.pinned = Boolean(body.pinned ?? m.pinned); saveMemory(items); recordAudit({ action: "memory.edit", userId: user.id, userName: user.name, role: user.role, targetType: "memory", targetId: m.id, targetLabel: m.text.slice(0, 60) }); return NextResponse.json({ item: m }); }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
