import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { trackFor, progressFor, saveProgress, onboardingSummary, TRACKS } from "@/lib/enterprise2";
import { SOP_ENTRIES } from "@/lib/sopKnowledge";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const role = req.nextUrl.searchParams.get("role") || user.role;
  const track = trackFor(role); const progress = progressFor(user.id, user.role);
  const sops = Object.fromEntries(SOP_ENTRIES.map((e) => [e.id, { title: e.title, steps: e.steps, where: e.where, who: e.who }]));
  return NextResponse.json({ track: { ...track, steps: track.steps.map((s) => ({ ...s, answer: undefined })) }, progress, sops, roles: TRACKS.map((t) => t.role), summary: user.role === "admin" || user.role === "developer" ? onboardingSummary() : [] });
}
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!; const body = await req.json().catch(() => ({}));
  const track = trackFor(user.role); const p = progressFor(user.id, user.role);
  const step = track.steps.find((s) => s.id === body.stepId); if (!step) return NextResponse.json({ error: "Step not found." }, { status: 404 });
  let correct: boolean | null = null;
  if (step.kind === "practice") { correct = Number(body.answer) === step.answer; p.answers[step.id] = Number(body.answer); if (!correct) { saveProgress(p); return NextResponse.json({ correct: false, progress: p }); } }
  if (!p.done.includes(step.id)) p.done.push(step.id);
  saveProgress(p);
  if (p.done.length === track.steps.length) recordAudit({ action: "onboarding.complete", userId: user.id, userName: user.name, role: user.role, detail: track.title });
  return NextResponse.json({ correct, progress: p });
}
