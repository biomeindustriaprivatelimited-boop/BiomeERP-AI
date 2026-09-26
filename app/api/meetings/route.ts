import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { loadMeetings, saveMeetings, extractFromTranscript, type Meeting } from "@/lib/ops";
import { loadWork, saveWork, today, type WorkTask } from "@/lib/work";

/** Meeting assistant — transcript in, summary/decisions/action items out, tasks on request. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ meetings: loadMeetings().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));

  if (body.action === "extract") {
    return NextResponse.json({ extracted: extractFromTranscript(String(body.transcript || "")) });
  }

  if (body.action === "save") {
    const list = loadMeetings();
    const m: Meeting = {
      id: crypto.randomUUID(), title: String(body.title || "Meeting").trim(), heldOn: /^\d{4}-\d{2}-\d{2}$/.test(body.heldOn || "") ? body.heldOn : today(),
      attendees: Array.isArray(body.attendees) ? body.attendees.map(String) : [], transcript: String(body.transcript || ""),
      summary: String(body.summary || ""), decisions: Array.isArray(body.decisions) ? body.decisions.map(String) : [],
      actionItems: (Array.isArray(body.actionItems) ? body.actionItems : []).map((a: any) => ({ id: crypto.randomUUID(), owner: String(a.owner || ""), task: String(a.task || ""), deadline: a.deadline || null, taskId: null })),
      createdBy: user.name, createdAt: new Date().toISOString(),
    };
    // Action items → Work tasks (the roadmap's "create tasks automatically").
    if (body.createTasks) {
      const w = loadWork(); const now = new Date().toISOString();
      for (const a of m.actionItems) {
        if (!a.task) continue;
        const t: WorkTask = {
          id: crypto.randomUUID(), key: `meeting:${m.id}:${a.id}`, kind: "followup", module: "Meetings",
          title: `${a.owner ? a.owner + ": " : ""}${a.task}`, why: `Action item from "${m.title}" on ${m.heldOn}.`, nextAction: a.task, href: "/meetings",
          priority: "followup", status: "open", source: "auto", ownerRoles: [user.role], assigneeId: null, assigneeName: a.owner || null, plant: auth.session.plant ?? null,
          dueOn: a.deadline || today(), createdAt: now, updatedAt: now, resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0, amount: null,
          evidence: [`Meeting: ${m.title}`],
        };
        w.tasks.unshift(t); a.taskId = t.id;
      }
      saveWork(w);
    }
    list.unshift(m); saveMeetings(list);
    recordAudit({ action: "meeting.save", userId: user.id, userName: user.name, role: user.role, targetType: "meeting", targetId: m.id, targetLabel: m.title, detail: `${m.actionItems.length} action items` });
    return NextResponse.json({ meeting: m });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
