import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { fetchInbox, classify } from "@/lib/inbox";
import { loadWork, saveWork, today, type WorkTask } from "@/lib/work";

/** Inbox intelligence — read & classify the company mailbox; create tasks from emails. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit")) || 40);
  const res = await fetchInbox(limit);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ messages: res.messages, fetchedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));

  // Classify pasted text (works without IMAP — forward an email's text in).
  if (body.action === "classify") {
    return NextResponse.json({ result: classify({ from: String(body.from || ""), subject: String(body.subject || ""), text: String(body.text || "") }) });
  }

  if (body.action === "task") {
    const w = loadWork(); const now = new Date().toISOString();
    const priority = body.priority === "urgent" ? "urgent" : body.priority === "important" ? "followup" : "normal";
    const t: WorkTask = {
      id: crypto.randomUUID(), key: `email:${body.uid || crypto.randomUUID()}`, kind: "followup", module: "Inbox",
      title: `Email: ${String(body.subject || "(no subject)").slice(0, 90)}`, why: `From ${body.from || "unknown"}${body.party ? ` · ${body.party}` : ""}${body.deadline ? ` · mentions ${body.deadline}` : ""}.`,
      nextAction: String(body.actionText || "Read and reply"), href: "/inbox", priority, status: "open", source: "auto", ownerRoles: [user.role, "admin"],
      assigneeId: null, assigneeName: null, plant: auth.session.plant ?? null, dueOn: today(), createdAt: now, updatedAt: now, resolvedAt: null, snoozedUntil: null,
      escalation: 0, followupStep: 0, amount: null, evidence: [`Email from ${body.from || "?"}`, String(body.snippet || "").slice(0, 160)].filter(Boolean),
    };
    w.tasks.unshift(t); saveWork(w);
    recordAudit({ action: "inbox.task", userId: user.id, userName: user.name, role: user.role, targetType: "task", targetId: t.id, targetLabel: t.title });
    return NextResponse.json({ task: t });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
