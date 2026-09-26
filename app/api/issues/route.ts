import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { paths, ensureDir, sanitizeSegment } from "@/lib/dataRoot";
import { loadIssues, saveIssues, blankIssue, similarIssues, ISSUE_KINDS, type Issue, type IssueKind } from "@/lib/ops";
import { loadWork, saveWork, today, type WorkTask } from "@/lib/work";

/** Issue & incident management — with camera evidence and a Work task per issue. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const list = loadIssues().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json({ issues: list, kinds: ISSUE_KINDS });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));
  const list = loadIssues();

  if (body.action === "similar") {
    return NextResponse.json({ similar: similarIssues({ title: String(body.title || ""), description: String(body.description || ""), party: String(body.party || ""), kind: body.kind }, list) });
  }

  if (body.action === "create") {
    const kind: IssueKind = ISSUE_KINDS.some((k) => k.id === body.kind) ? body.kind : "operational";
    const issue = blankIssue({ id: user.id, name: user.name }, kind);
    issue.title = String(body.title || "").trim();
    if (!issue.title) return NextResponse.json({ error: "Give the issue a title." }, { status: 400 });
    issue.description = String(body.description || "");
    issue.priority = ["critical", "high", "medium", "low"].includes(body.priority) ? body.priority : "medium";
    issue.party = String(body.party || "");
    issue.plant = auth.session.plant ?? null;

    // Evidence photo (base64) saved into the data root.
    if (body.evidenceBase64 && body.evidenceName) {
      const dir = path.join(paths.root, "issues", issue.id);
      ensureDir(dir);
      const name = sanitizeSegment(String(body.evidenceName)) || "evidence.jpg";
      fs.writeFileSync(path.join(dir, name), Buffer.from(String(body.evidenceBase64), "base64"));
      issue.evidence.push({ id: crypto.randomUUID(), name, file: path.join("issues", issue.id, name), mimeType: String(body.evidenceMime || "image/jpeg"), ocrText: body.ocrText ? String(body.ocrText).slice(0, 4000) : undefined });
    }

    // A Work task per issue — the roadmap's "automatic task from events".
    const w = loadWork();
    const now = new Date().toISOString();
    const task: WorkTask = {
      id: crypto.randomUUID(), key: `issue:${issue.id}`, kind: issue.kind === "financial" ? "finance" : "operations", module: "Issues",
      title: `Issue: ${issue.title}`, why: issue.description || "Raised from the field.", nextAction: ISSUE_KINDS.find((k) => k.id === kind)?.actions[0] || "Investigate",
      href: "/issues", priority: issue.priority === "critical" ? "critical" : issue.priority === "high" ? "urgent" : issue.priority === "medium" ? "followup" : "normal",
      status: "open", source: "auto", ownerRoles: kind === "financial" ? ["accounts", "admin"] : ["coordinator", "plant_manager", "admin"],
      assigneeId: null, assigneeName: null, plant: issue.plant, dueOn: today(), createdAt: now, updatedAt: now,
      resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0, amount: null, evidence: [`Raised by ${user.name}`, issue.party ? `Concerns ${issue.party}` : ""].filter(Boolean),
    };
    w.tasks.unshift(task); saveWork(w);
    issue.taskId = task.id;

    list.unshift(issue); saveIssues(list);
    recordAudit({ action: "issue.create", userId: user.id, userName: user.name, role: user.role, targetType: "issue", targetId: issue.id, targetLabel: issue.title, plant: issue.plant });
    return NextResponse.json({ issue, similar: similarIssues(issue, list) });
  }

  const issue = list.find((i) => i.id === body.id);
  if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  const now = new Date().toISOString();
  if (body.action === "note") issue.timeline.push({ at: now, by: user.name, note: String(body.note || "") });
  else if (body.action === "status") {
    issue.status = ["open", "investigating", "resolved", "closed"].includes(body.status) ? body.status : issue.status;
    if (body.resolution) issue.resolution = String(body.resolution);
    if (issue.status === "resolved" || issue.status === "closed") {
      issue.resolvedAt = now;
      const w = loadWork(); const t = w.tasks.find((x) => x.id === issue.taskId);
      if (t && t.status === "open") { t.status = "done"; t.resolvedAt = now; t.updatedAt = now; saveWork(w); }
    }
    issue.timeline.push({ at: now, by: user.name, note: `Status → ${issue.status}${body.resolution ? `: ${body.resolution}` : ""}` });
  } else if (body.action === "assign") { issue.ownerId = String(body.ownerId || ""); issue.ownerName = String(body.ownerName || ""); issue.timeline.push({ at: now, by: user.name, note: `Assigned to ${issue.ownerName}` }); }
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  issue.updatedAt = now; saveIssues(list);
  recordAudit({ action: `issue.${body.action}`, userId: user.id, userName: user.name, role: user.role, targetType: "issue", targetId: issue.id, targetLabel: issue.title });
  return NextResponse.json({ issue });
}
