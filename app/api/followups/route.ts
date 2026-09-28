import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { pendingFollowups, readFollowupLog, logFollowup, waLink, FOLLOWUP_KINDS, type FollowupKind } from "@/lib/followups";
import { sendMail } from "@/lib/mailer";
import { agentFetch } from "@/lib/whatsappAgent";
import { recordAudit } from "@/lib/audit";

/**
 * Follow-ups: what vendors / clients still owe, and sending the ask.
 * `partners` permission. A coordinator sees trading only; a plant manager
 * and procurement manufacturing only (same split as registration).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scopeFor(role: string): "trading" | "manufacturing" | null {
  if (role === "coordinator") return "trading";
  if (role === "plant_manager" || role === "procurement") return "manufacturing";
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const items = pendingFollowups({
    by: user.name, business: scopeFor(user.role), plant: user.role === "plant_manager" ? auth.session.plant : null,
    includePo: perms.includes("operations") && user.role !== "plant_manager", includeKyc: true,
  });
  return NextResponse.json({ items, kinds: FOLLOWUP_KINDS, log: readFollowupLog(200).filter((l) => user.role === "admin" || user.role === "developer" || user.role === "accounts" || l.by === user.id) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const b = await req.json().catch(() => ({}));
  const channel = b.channel === "whatsapp" ? "whatsapp" : "email";
  const to = String(b.to || "").trim();
  const subject = String(b.subject || "").trim().slice(0, 200);
  const body = String(b.body || "").trim().slice(0, 6000);
  const kind = (FOLLOWUP_KINDS.some((k) => k.id === b.kind) ? b.kind : "custom") as FollowupKind;
  const key = String(b.key || `custom:${Date.now()}`);
  const party = String(b.party || "").slice(0, 120);
  if (!to) return NextResponse.json({ error: channel === "email" ? "Enter the email address." : "Enter the WhatsApp number." }, { status: 400 });
  if (!body) return NextResponse.json({ error: "The message is empty." }, { status: 400 });

  if (channel === "email") {
    const r = await sendMail({ to, subject: subject || "Follow-up from Biome Industria", text: body });
    const rec = logFollowup({ key, kind, party, channel: "email", to, subject, body, ok: r.ok, error: r.ok ? null : (r as any).error || "failed", by: user.id, byName: user.name });
    recordAudit({ action: "FOLLOWUP_SENT", userId: user.id, userName: user.name, role: user.role, targetType: "followup", targetId: key, targetLabel: party, detail: `email → ${to}${r.ok ? "" : " (failed)"}`, outcome: r.ok ? "ok" : "failed" });
    if (!r.ok) return NextResponse.json({ error: (r as any).error || "The email was not sent.", log: rec }, { status: 502 });
    return NextResponse.json({ ok: true, log: rec });
  }

  // WhatsApp: through the linked account when the agent is up; otherwise a
  // click-to-chat link that opens WhatsApp with the message ready.
  try {
    const res = await agentFetch("/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, text: body }), timeoutMs: 20000 });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "WhatsApp send failed.");
    const rec = logFollowup({ key, kind, party, channel: "whatsapp", to, subject, body, ok: true, error: null, by: user.id, byName: user.name });
    recordAudit({ action: "FOLLOWUP_SENT", userId: user.id, userName: user.name, role: user.role, targetType: "followup", targetId: key, targetLabel: party, detail: `WhatsApp → ${to}` });
    return NextResponse.json({ ok: true, log: rec });
  } catch (e) {
    const rec = logFollowup({ key, kind, party, channel: "whatsapp_link", to, subject, body, ok: true, error: `sent via link: ${(e as Error).message}`, by: user.id, byName: user.name });
    return NextResponse.json({ ok: true, link: waLink(to, body), note: `${(e as Error).message} — opening WhatsApp with the message ready instead.`, log: rec });
  }
}
