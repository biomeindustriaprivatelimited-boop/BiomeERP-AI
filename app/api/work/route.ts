import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { agentFetch } from "@/lib/whatsappAgent";
import {
  loadWork, saveWork, runAutopilot, visibleTasks, planner, decisions, delegates, today,
  type WorkTask,
} from "@/lib/work";

/**
 * Work Engine API — planner, decisions, autopilot runs, task actions.
 *
 * GET  ?view=planner|decisions|runs   (default: everything the person may see)
 * POST { action: "run" }                      — run the autopilot now
 * POST { action: "done"|"snooze"|"dismiss"|"reopen"|"assign"|"create", ... }
 *
 * Runs are also triggered lazily: a GET when the last run is older than
 * 30 minutes runs the autopilot first, so opening the Work page is enough
 * to keep the picture fresh without a scheduler.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 30 * 60 * 1000;

function me(req: NextRequest, auth: any) {
  const user = findById(auth.session.uid)!;
  return { id: user.id, name: user.name, role: user.role, plant: auth.session.plant ?? null };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = me(req, auth);

  let w = loadWork();
  const last = w.runs[0]?.at ? new Date(w.runs[0].at).getTime() : 0;
  if (Date.now() - last > STALE_MS) {
    await runAutopilot({ agentFetch, actor: user });
    w = loadWork();
  }

  const mine = visibleTasks(w.tasks, user);
  const scope = req.nextUrl.searchParams.get("scope") === "mine"
    ? mine.filter((t) => t.assigneeId === user.id || t.ownerRoles.includes(user.role))
    : mine;

  return NextResponse.json({
    me: user,
    planner: planner(scope),
    decisions: decisions(scope),
    runs: w.runs.slice(0, 7),
    lastRun: w.runs[0] || null,
    today: today(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = me(req, auth);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  if (action === "run") {
    const run = await runAutopilot({ agentFetch, actor: user });
    return NextResponse.json({ run });
  }

  if (action === "create") {
    const title = String(body.title || "").trim();
    if (!title) return NextResponse.json({ error: "A title is needed." }, { status: 400 });
    const w = loadWork();
    const now = new Date().toISOString();
    const task: WorkTask = {
      id: crypto.randomUUID(), key: `manual:${crypto.randomUUID()}`, kind: "followup",
      module: String(body.module || "General"), title,
      why: String(body.why || "Raised by hand."), nextAction: String(body.nextAction || title),
      href: String(body.href || "/work"), priority: ["critical", "urgent", "followup", "normal"].includes(body.priority) ? body.priority : "normal",
      status: "open", source: "manual", ownerRoles: [user.role],
      assigneeId: body.assigneeId || null, assigneeName: body.assigneeName || null,
      plant: user.plant, dueOn: /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn || "") ? body.dueOn : today(),
      createdAt: now, updatedAt: now, resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0,
      amount: Number.isFinite(Number(body.amount)) && body.amount !== "" ? Number(body.amount) : null,
      evidence: [`Created by ${user.name}`],
    };
    w.tasks.unshift(task); saveWork(w);
    recordAudit({ action: "work.task.create", userId: user.id, userName: user.name, role: user.role, targetType: "task", targetId: task.id, targetLabel: task.title });
    return NextResponse.json({ task });
  }

  const w = loadWork();
  const task = w.tasks.find((t) => t.id === body?.id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!visibleTasks([task], user).length) return NextResponse.json({ error: "Not yours to change." }, { status: 403 });
  const now = new Date().toISOString();

  if (action === "done") { task.status = "done"; task.resolvedAt = now; }
  else if (action === "reopen") { task.status = "open"; task.resolvedAt = null; task.snoozedUntil = null; }
  else if (action === "dismiss") { task.status = "dismissed"; task.resolvedAt = now; }
  else if (action === "snooze") {
    const until = /^\d{4}-\d{2}-\d{2}$/.test(body.until || "") ? body.until : null;
    if (!until) return NextResponse.json({ error: "Snooze until when? (YYYY-MM-DD)" }, { status: 400 });
    task.status = "snoozed"; task.snoozedUntil = until;
  } else if (action === "assign") {
    const who = delegates(task).find((d) => d.id === body.assigneeId);
    if (!who) return NextResponse.json({ error: "That person cannot own this task." }, { status: 400 });
    task.assigneeId = who.id; task.assigneeName = who.name;
  } else if (action === "delegates") {
    return NextResponse.json({ delegates: delegates(task) });
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  task.updatedAt = now;
  saveWork(w);
  recordAudit({ action: `work.task.${action}`, userId: user.id, userName: user.name, role: user.role, targetType: "task", targetId: task.id, targetLabel: task.title });
  return NextResponse.json({ task });
}
