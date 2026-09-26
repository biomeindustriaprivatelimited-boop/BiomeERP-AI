import { NextRequest, NextResponse } from "next/server";
import { toolSchemas, runTool, type ToolContext } from "@/lib/aiTools";
import { AGENTS, agentFor } from "@/lib/enterprise2";
import { recordAudit } from "@/lib/audit";
import { findById, getSession } from "@/lib/authServer";

/**
 * The LOCAL assistant's hands.
 *
 * The free, on-device model runs in the browser (WebLLM) — it cannot and
 * must not touch files or Tally directly. Instead, its reasoning loop
 * calls THIS endpoint one tool at a time. The split keeps the important
 * property of the cloud orchestrator: all data access happens on the
 * server, behind the person's own session, with writes disabled — a
 * hallucinated tool call can read the wrong report, never change one.
 *
 * GET returns the tool catalogue (schemas) so the client can put the
 * SAME tool list in front of the local model that the cloud loop uses.
 * One catalogue, two engines — the assistant behaves the same whichever
 * brain is running.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Session enforcement happens in middleware, exactly as it does for the
// cloud orchestrator at /api/assistant — nothing here is public.
export async function GET(req: NextRequest) {
  // Agent scoping: a specialised agent only sees its allowed tools.
  const agentId = req.nextUrl.searchParams.get("agent");
  const role = await roleOf(req);
  const agent = agentFor(agentId, role);
  const tools = toolSchemas().filter((t: any) => !agent || agent.tools.includes(t.name));
  return NextResponse.json({ tools, agent: agent ? { id: agent.id, name: agent.name, scope: agent.scope, actions: agent.actions } : null, agents: AGENTS.filter((a) => a.roles.includes(role) || role === "developer").map((a) => ({ id: a.id, name: a.name, scope: a.scope })) });
}

async function roleOf(req: NextRequest): Promise<string> {
  try { const s = await getSession(req); const u = s ? findById(s.uid) : null; return u?.role || "employee"; } catch { return "employee"; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "");
  if (!name) return NextResponse.json({ error: "Which tool?" }, { status: 400 });

  const role = await roleOf(req);
  const agent = agentFor(body?.agent, role);
  if (agent && !agent.tools.includes(name)) return NextResponse.json({ ok: false, error: `${agent.name} is not allowed to use ${name}.` }, { status: 403 });
  const ctx: ToolContext = { tally: body?.tally, allowWrites: false };
  const result = await runTool(name, body?.args ?? {}, ctx);
  if (agent) { try { recordAudit({ action: "agent.tool", userId: "agent", userName: agent.name, role, targetType: "tool", targetId: name, detail: result.ok ? "ok" : `failed: ${result.error}` }); } catch { /* audit optional */ } }

  // Errors are data, not exceptions: the model reads them and tells the
  // person what broke instead of the loop stalling.
  return NextResponse.json({
    ok: result.ok,
    source: result.source ?? null,
    data: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
  });
}
