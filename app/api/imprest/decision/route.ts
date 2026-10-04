import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadEntries, saveEntries, loadPeople, personForUser, event } from "@/lib/imprest";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept or reject a filed entry.
 *
 * Guarded by imprest.approve, which only accounts and admin hold — this is
 * the control the whole module exists for. A holder can write and rewrite
 * their claim all day; nothing becomes real until it passes through here.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.approve");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : body.id ? [String(body.id)] : [];
  const decision = String(body.decision || "");
  const note = String(body.note || "").trim();

  if (ids.length === 0) return NextResponse.json({ error: "Which entries?" }, { status: 400 });
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Decision must be approve or reject." }, { status: 400 });
  }
  // A rejection without a reason is the thing people complain about most —
  // the holder has to know what to fix.
  if (decision === "rejected" && !note) {
    return NextResponse.json({ error: "Give a reason so the person knows what to correct." }, { status: 400 });
  }

  const all = loadEntries();
  const people = loadPeople();
  const mine = personForUser(user.id);
  const now = new Date().toISOString();

  const results: { id: string; ok: boolean; reason?: string }[] = [];
  const next = [...all];

  for (const id of ids) {
    const idx = next.findIndex((e) => e.id === id);
    if (idx === -1) { results.push({ id, ok: false, reason: "Not found." }); continue; }
    const entry = next[idx];

    if (entry.status === "pending_budget_approval") {
      results.push({ id, ok: false, reason: "This entry is over budget. The admin has to pass the overrun before accounts can decide it." });
      continue;
    }
    if (entry.status !== "submitted") {
      results.push({ id, ok: false, reason: `Already ${entry.status}.` });
      continue;
    }
    // Nobody signs off their own claim, whatever their role. This is the
    // one rule that makes an approval mean something.
    if (mine && entry.personId === mine.id) {
      results.push({ id, ok: false, reason: "You can't decide your own imprest entry. Ask another approver." });
      continue;
    }

    next[idx] = {
      ...entry,
      status: decision,
      decidedBy: user.id,
      decidedByName: user.name,
      decidedAt: now,
      decisionNote: note || null,
      updatedAt: now,
      history: [...entry.history, event(user.id, user.name, decision, note || undefined)],
    };
    recordAudit({
      action: decision === "approved" ? "IMPREST_APPROVED" : "IMPREST_REJECTED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "imprest_entry", targetId: entry.id,
      targetLabel: `${entry.description} · ₹${entry.amount.toLocaleString("en-IN")}`,
      detail: note || undefined, plant: entry.plant || null,
    });
    results.push({ id, ok: true });
  }

  saveEntries(next);

  const done = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    updated: done,
    failed,
    people: people.map((p) => p.id),
  });
}
