import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { SOURCES, runReport, parseNaturalReport, loadReports, saveReport, deleteReport, type ReportSpec } from "@/lib/vault";
import { visibleDatasets, runDataset, type ReportContext, type RunSpec } from "@/lib/reportCatalog";
import { plantOptions } from "@/lib/plants";

/**
 * Report builder.
 *
 * Module reports (imprest, coordination, transport, biomass, stock,
 * registrations, PO, leave) are open to anyone with `reports`, and each
 * one only ever reads what that login may already see on the module's
 * own screen — see lib/reportCatalog.ts.
 *
 * The older free-form cross-module builder reads every table unscoped, so
 * it stays with admin and the developer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function context(req: NextRequest, auth: { session: any }): ReportContext {
  const user = findById(auth.session.uid)!;
  return {
    userId: user.id, userName: user.name, role: user.role,
    perms: effectivePermissions(user.role, (user as any).access),
    plant: auth.session.plant || null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "reports"); if ("response" in auth) return auth.response;
  const ctx = context(req, auth);
  const advanced = ctx.perms.includes("users");
  return NextResponse.json({
    catalogue: visibleDatasets(ctx).map((d) => ({
      id: d.id, module: d.module, label: d.label, description: d.description, dateField: d.dateField,
      dimensions: [...d.dimensions, ...(d.dateField ? [{ key: "__month", label: "Month" }] : [])],
      columns: d.columns,
    })),
    plants: ctx.role === "plant_manager" && ctx.plant ? plantOptions().filter((p) => p.code === ctx.plant) : plantOptions(),
    saved: loadReports().filter((r: any) => r.module ? (r.createdByUserId === ctx.userId || !r.roles?.length || r.roles.includes(ctx.role)) : advanced),
    advanced,
    sources: advanced ? SOURCES : {},
    me: { name: ctx.userName, role: ctx.role },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "reports"); if ("response" in auth) return auth.response;
  const ctx = context(req, auth);
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));

  if (body.action === "module") {
    try {
      const result = runDataset(ctx, body.spec as RunSpec);
      recordAudit({ action: "report.run", userId: user.id, userName: user.name, role: user.role, targetType: "report", targetId: result.dataset.id, targetLabel: result.dataset.label, detail: `${result.count} rows` });
      return NextResponse.json({ result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 403 });
    }
  }
  if (body.action === "saveModule") {
    const spec = body.spec || {};
    if (!visibleDatasets(ctx).some((d) => d.id === spec.dataset)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const s = saveReport({ ...spec, module: true, createdByUserId: user.id, roles: Array.isArray(spec.roles) ? spec.roles : [] } as any, user.name);
    return NextResponse.json({ report: s });
  }
  if (body.action === "delete") {
    const r: any = loadReports().find((x: any) => x.id === body.id);
    if (r && r.createdByUserId && r.createdByUserId !== user.id && !ctx.perms.includes("users")) {
      return NextResponse.json({ error: "Only the person who saved it, or an admin, can delete it." }, { status: 403 });
    }
    deleteReport(String(body.id)); return NextResponse.json({ ok: true });
  }

  // ---- Advanced free-form builder: unscoped, admin/developer only ----
  if (!ctx.perms.includes("users")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (body.action === "run") return NextResponse.json({ result: runReport(body.spec as ReportSpec) });
  if (body.action === "parse") { const { spec, notes } = parseNaturalReport(String(body.text || "")); return NextResponse.json({ spec, notes, result: runReport(spec) }); }
  if (body.action === "save") { const s = saveReport(body.spec as ReportSpec, user.name); recordAudit({ action: "report.save", userId: user.id, userName: user.name, role: user.role, targetType: "report", targetId: s.id, targetLabel: s.name }); return NextResponse.json({ report: s }); }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
