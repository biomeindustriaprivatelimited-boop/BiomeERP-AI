import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { SOURCES, runReport, parseNaturalReport, loadReports, saveReport, deleteReport, type ReportSpec } from "@/lib/vault";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "reports"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  return NextResponse.json({ sources: SOURCES, saved: loadReports().filter((r) => !r.roles?.length || r.roles.includes(user.role) || user.role === "admin" || user.role === "developer") });
}
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "reports"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!; const body = await req.json().catch(() => ({}));
  if (body.action === "run") return NextResponse.json({ result: runReport(body.spec as ReportSpec) });
  if (body.action === "parse") { const { spec, notes } = parseNaturalReport(String(body.text || "")); return NextResponse.json({ spec, notes, result: runReport(spec) }); }
  if (body.action === "save") { const s = saveReport(body.spec as ReportSpec, user.name); recordAudit({ action: "report.save", userId: user.id, userName: user.name, role: user.role, targetType: "report", targetId: s.id, targetLabel: s.name }); return NextResponse.json({ report: s }); }
  if (body.action === "delete") { deleteReport(String(body.id)); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
