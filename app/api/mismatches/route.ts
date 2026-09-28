import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, loadUsers } from "@/lib/authServer";
import { plantOptions } from "@/lib/plants";
import { matchAll } from "@/lib/plantMatch";
import { withFlags, pairKey, logNotice, rememberContact, loadFlagFile, reopen, addNote, FLAG_AFTER_DAYS } from "@/lib/matchFlags";
import { loadAnnouncements, saveAnnouncements, makeAnnouncement } from "@/lib/announcements";
import { sendMail } from "@/lib/mailer";
import { agentFetch } from "@/lib/whatsappAgent";
import { waLink } from "@/lib/followups";
import { recordAudit } from "@/lib/audit";

/**
 * Mismatches — accounts / admin / developer (`reco`).
 *
 * Every plant-dispatch ↔ coordination-register difference with both sides'
 * figures, how many days it has been open, and who is responsible: the
 * plant manager(s) of that plant for the plant side, the coordinators for
 * the register side. After FLAG_AFTER_DAYS without a fix or a note it is a
 * red flag. From here the office sends the responsible people a notice —
 * in the app, by email, or by WhatsApp — and the history stays on the row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responsible(p: { plant: string; dispatch: unknown; trip: unknown }) {
  const users = loadUsers().filter((u) => u.active && !u.deleted);
  const out: { id: string; name: string; role: string; side: "plant" | "coordination" }[] = [];
  // Plant side is on the hook when the register has it and the plant does not, or the weights differ.
  if (p.trip) {
    for (const u of users.filter((u) => u.role === "plant_manager" && u.plants.includes(p.plant))) out.push({ id: u.id, name: u.name, role: u.role, side: "plant" });
  }
  // Coordination is on the hook when the plant has it and the register does not, or the weights differ.
  if (p.dispatch) {
    for (const u of users.filter((u) => u.role === "coordinator")) out.push({ id: u.id, name: u.name, role: u.role, side: "coordination" });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "reco");
  if ("response" in auth) return auth.response;
  const pairs = withFlags(matchAll(plantOptions().map((p) => p.code))).filter((p) => p.status !== "matched");
  const contacts = loadFlagFile().contacts;
  const plants = Object.fromEntries(plantOptions().map((p) => [p.code, p.label]));
  return NextResponse.json({
    flagAfterDays: FLAG_AFTER_DAYS,
    plants,
    rows: pairs
      .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.ageDays - a.ageDays)
      .map((p) => ({ ...p, plantName: plants[p.plant] || p.plant, responsible: responsible(p).map((r) => ({ ...r, ...(contacts[r.id] || { email: "", phone: "" }) })) })),
    summary: {
      open: pairs.length,
      flagged: pairs.filter((p) => p.flagged).length,
      explained: pairs.filter((p) => p.explained).length,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "reco");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || "");
  const pair = withFlags(matchAll(plantOptions().map((p) => p.code))).find((p) => pairKey(p) === key && p.status !== "matched");
  if (!pair) return NextResponse.json({ error: "This row matches now — nothing to send." }, { status: 409 });

  if (b.action === "reopen") { reopen(key); return NextResponse.json({ ok: true }); }
  if (b.action === "note") {
    const text = String(b.note || "").trim().slice(0, 500);
    if (!text) return NextResponse.json({ error: "Write the note." }, { status: 400 });
    addNote(key, { text, by: user.id, byName: user.name, side: "office", at: new Date().toISOString() }, Boolean(b.explained));
    return NextResponse.json({ ok: true });
  }

  const channel = ["app", "email", "whatsapp"].includes(b.channel) ? b.channel as "app" | "email" | "whatsapp" : "app";
  const toUser = findById(String(b.userId || ""));
  if (!toUser || !toUser.active) return NextResponse.json({ error: "Choose who to notify." }, { status: 400 });
  const message = String(b.message || "").trim().slice(0, 3000);
  if (!message) return NextResponse.json({ error: "The message is empty." }, { status: 400 });
  const subject = String(b.subject || "Vehicle mismatch — please fix").slice(0, 160);
  const at = new Date().toISOString();

  if (channel === "app") {
    const list = loadAnnouncements();
    list.push(makeAnnouncement({
      kind: "warning", title: subject, body: message, pinned: true,
      audience: { roles: "all", plants: [], userIds: [toUser.id] },
      expiresOn: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      by: { id: user.id, name: user.name },
    }));
    saveAnnouncements(list);
    logNotice(key, { at, by: user.id, byName: user.name, channel: "app", to: toUser.username, toName: toUser.name, ok: true });
    recordAudit({ action: "MISMATCH_NOTICE", userId: user.id, userName: user.name, role: user.role, targetType: "mismatch", targetId: key, targetLabel: toUser.name, detail: "in-app notice" });
    return NextResponse.json({ ok: true });
  }

  const to = String(b.to || "").trim();
  if (!to) return NextResponse.json({ error: channel === "email" ? "Enter the email address." : "Enter the WhatsApp number." }, { status: 400 });
  rememberContact(toUser.id, channel === "email" ? { email: to } : { phone: to });

  if (channel === "email") {
    const r = await sendMail({ to, subject, text: message });
    logNotice(key, { at, by: user.id, byName: user.name, channel: "email", to, toName: toUser.name, ok: r.ok, error: r.ok ? undefined : (r as any).error });
    recordAudit({ action: "MISMATCH_NOTICE", userId: user.id, userName: user.name, role: user.role, targetType: "mismatch", targetId: key, targetLabel: toUser.name, detail: `email → ${to}`, outcome: r.ok ? "ok" : "failed" });
    if (!r.ok) return NextResponse.json({ error: (r as any).error || "The email was not sent." }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  try {
    const res = await agentFetch("/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, text: `*${subject}*\n\n${message}` }), timeoutMs: 20000 });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "WhatsApp send failed.");
    logNotice(key, { at, by: user.id, byName: user.name, channel: "whatsapp", to, toName: toUser.name, ok: true });
    recordAudit({ action: "MISMATCH_NOTICE", userId: user.id, userName: user.name, role: user.role, targetType: "mismatch", targetId: key, targetLabel: toUser.name, detail: `WhatsApp → ${to}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logNotice(key, { at, by: user.id, byName: user.name, channel: "whatsapp_link", to, toName: toUser.name, ok: true, error: (e as Error).message });
    return NextResponse.json({ ok: true, link: waLink(to, `*${subject}*\n\n${message}`), note: `${(e as Error).message} — opening WhatsApp with the message ready instead.` });
  }
}
