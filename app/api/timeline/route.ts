import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { readAudit } from "@/lib/audit";
import { readMailLog } from "@/lib/mailer";
import { loadWork, visibleTasks } from "@/lib/work";
import { loadIssues, loadMeetings } from "@/lib/ops";
import { loadPartners } from "@/lib/partners";
import { loadEmployees } from "@/lib/payroll";

/**
 * Communication Center — one timeline per party.
 *
 * Merges every channel the app has a record of: outbound emails (mail
 * log), audit events that name the party, Work tasks about them, issues,
 * meetings that mention them, and registration documents. Search is by
 * name/email; "pending" is any open follow-up task about the party.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  // Directory of parties for the search box.
  const parties = [
    ...loadPartners().map((p) => ({ type: p.kind === "transporter" ? "transporter" : "vendor", name: p.name, email: p.email || "", href: "/partners" })),
    ...(() => { try { return loadEmployees().filter((e) => e.active).map((e) => ({ type: "employee", name: e.name, email: e.email || "", href: "/employees" })); } catch { return []; } })(),
  ];
  if (!q) return NextResponse.json({ parties: parties.slice(0, 200), items: [], pending: [] });

  const hit = (s: string | null | undefined) => String(s || "").toLowerCase().includes(q);
  const items: { at: string; channel: string; title: string; detail: string; ok: boolean; href: string }[] = [];

  for (const m of readMailLog()) if (hit(m.to) || hit(m.subject)) items.push({ at: m.at, channel: "email", title: m.subject, detail: `To ${m.to}${m.ok ? "" : ` — failed: ${m.error}`}`, ok: m.ok, href: "/settings" });
  try {
    for (const e of readAudit({}).events) if (hit(e.targetLabel) || hit(e.detail)) items.push({ at: e.at, channel: "system", title: e.action.replace(/\./g, " · "), detail: `${e.userName}${e.detail ? ` — ${e.detail}` : ""}`, ok: e.outcome !== "failed", href: "/audit" });
  } catch { /* audit absent */ }
  const tasks = visibleTasks(loadWork().tasks, { id: user.id, role: user.role, plant: auth.session.plant });
  for (const t of tasks) if (hit(t.title) || hit(t.why)) items.push({ at: t.updatedAt, channel: t.status === "open" ? "task-open" : "task", title: t.title, detail: `${t.priority} · ${t.status} · ${t.nextAction}`, ok: t.status !== "open", href: "/work" });
  for (const i of loadIssues()) if (hit(i.title) || hit(i.party) || hit(i.description)) items.push({ at: i.updatedAt, channel: "issue", title: i.title, detail: `${i.kind} · ${i.status}`, ok: i.status !== "open", href: "/issues" });
  for (const m of loadMeetings()) if (hit(m.title) || hit(m.transcript) || m.attendees.some(hit)) items.push({ at: m.createdAt, channel: "meeting", title: m.title, detail: m.summary.slice(0, 120), ok: true, href: "/meetings" });
  for (const p of loadPartners()) if (hit(p.name)) for (const d of p.documents) items.push({ at: d.uploadedAt, channel: "document", title: `${d.label || d.type} received`, detail: `${d.fileName}`, ok: true, href: "/partners" });

  items.sort((a, b) => b.at.localeCompare(a.at));
  const pending = tasks.filter((t) => t.status === "open" && (hit(t.title) || hit(t.why))).map((t) => ({
    title: t.title, nextAction: t.nextAction, dueOn: t.dueOn, followupStep: t.followupStep,
    // AI reply suggestion — templated from the task, ready to paste.
    suggestion: t.kind === "missing_document"
      ? `Dear team, as per our records the following is still awaited: ${t.title.split(":").slice(1).join(":").trim()}. Kindly share it at the earliest so we can complete the registration/supply set. Regards, Biome Industria.`
      : t.kind === "expiry" ? `Dear team, ${t.title}. Please share the renewed document so supplies continue without interruption. Regards, Biome Industria.`
      : `Following up on: ${t.title}. ${t.nextAction}`,
  }));
  return NextResponse.json({ parties: parties.filter((p) => hit(p.name) || hit(p.email)).slice(0, 20), items: items.slice(0, 200), pending });
}
