import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, loadUsers } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { runAutopilot } from "@/lib/work";
import { agentFetch } from "@/lib/whatsappAgent";
import { syncPurchaseOrders } from "@/lib/po";
import { commandCenter, chiefOfStaff, briefing, briefingText, riskRadar, earlyWarnings, dataQuality, auditIntelligence, insightsFeed, slaAnalytics, loadSla, saveSla, bottleneckAnalytics, decide, systemHealth } from "@/lib/enterprise";
import { loadWork } from "@/lib/work";

/**
 * Command Center / Decision Room / Briefing / Risk Radar / Warnings /
 * Data Quality / Audit Intelligence / SLA — one API for the premium
 * management experience. Autopilot + PO sync run lazily when stale.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function me(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return { auth, user: null as any };
  const u = findById(auth.session.uid)!;
  return { auth, user: { id: u.id, name: u.name, role: u.role, plant: auth.session.plant ?? null } };
}

export async function GET(req: NextRequest) {
  const { auth, user } = await me(req);
  if (!user) return (auth as any).response;
  const view = req.nextUrl.searchParams.get("view") || "command";
  // Keep the picture fresh: autopilot + PO sync when quiet for 30 min.
  const last = loadWork().runs[0]?.at ? new Date(loadWork().runs[0].at).getTime() : 0;
  if (Date.now() - last > 30 * 60 * 1000) { await runAutopilot({ agentFetch, actor: user }); await syncPurchaseOrders(user); }

  switch (view) {
    case "command": return NextResponse.json({ ...commandCenter(user), me: user, chief: chiefOfStaff(user) });
    case "chief": return NextResponse.json(chiefOfStaff(user));
    case "briefing": { const b = briefing(user); return NextResponse.json({ briefing: b, text: briefingText(b) }); }
    case "risk": return NextResponse.json({ radar: riskRadar(), warnings: earlyWarnings() });
    case "quality": return NextResponse.json({ data: dataQuality(), audit: auditIntelligence() });
    case "feed": return NextResponse.json({ feed: insightsFeed() });
    case "sla": return NextResponse.json({ rules: loadSla(), analytics: slaAnalytics(loadWork().tasks), bottlenecks: bottleneckAnalytics() });
    case "system": return NextResponse.json(systemHealth());
    default: return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, user } = await me(req);
  if (!user) return (auth as any).response;
  const body = await req.json().catch(() => ({}));

  if (body.action === "decide") {
    const t = decide(String(body.id || ""), body.decision, String(body.note || ""), user);
    if (!t) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    recordAudit({ action: `decision.${body.decision}`, userId: user.id, userName: user.name, role: user.role, targetType: "task", targetId: t.id, targetLabel: t.title, detail: body.note ? String(body.note) : undefined });
    return NextResponse.json({ task: t });
  }

  if (body.action === "email-briefing") {
    const b = briefing(user); const text = briefingText(b);
    const to: string[] = Array.isArray(body.to) && body.to.length ? body.to : loadUsers().filter((u) => u.active && (u.role === "admin" || u.role === "developer") && (u as any).email).map((u) => (u as any).email);
    if (!to.length) return NextResponse.json({ error: "No recipients — pass addresses or add emails to admin users." }, { status: 400 });
    let sent = 0; const failed: string[] = [];
    for (const addr of to) { const r = await sendMail({ to: addr, subject: `Executive briefing — ${b.status} · ${new Date().toLocaleDateString("en-IN")}`, text, html: `<pre style="font-family:Segoe UI,Arial;font-size:13px;white-space:pre-wrap;color:#202420">${text.replace(/</g, "&lt;")}</pre>` }); if (r.ok) sent += 1; else failed.push(`${addr}: ${r.error}`); }
    recordAudit({ action: "briefing.email", userId: user.id, userName: user.name, role: user.role, detail: `${sent} sent${failed.length ? `, failed: ${failed.join("; ")}` : ""}` });
    return NextResponse.json({ sent, failed });
  }

  if (body.action === "sla") {
    const perm = await requirePermission(req, "settings"); if ("response" in perm) return perm.response;
    const rules = (Array.isArray(body.rules) ? body.rules : []).map((r: any) => ({ kind: String(r.kind), label: String(r.label || r.kind), hours: Math.max(1, Number(r.hours) || 24), warnAtPct: Math.min(99, Math.max(10, Number(r.warnAtPct) || 75)), escalateAfterHours: Math.max(1, Number(r.escalateAfterHours) || 30) }));
    if (!rules.length) return NextResponse.json({ error: "No rules." }, { status: 400 });
    saveSla(rules); recordAudit({ action: "sla.update", userId: user.id, userName: user.name, role: user.role, detail: `${rules.length} rules` });
    return NextResponse.json({ rules });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
