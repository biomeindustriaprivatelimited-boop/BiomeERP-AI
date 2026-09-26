"use client";

/**
 * Biome Platform — LOCAL assistant reasoning loop (runs in the browser)
 * -------------------------------------------------------------------
 * The free brain. A small open model (WebLLM, on this machine's GPU)
 * drives the SAME tool catalogue the cloud orchestrator uses — reads
 * supply sets, Tally, imprest, attendance — through /api/assistant/tool,
 * so the data never leaves the server and writes stay impossible.
 *
 * Small models don't do native function-calling reliably, so the
 * protocol is the strictest thing they DO do reliably: reply with one
 * JSON object, every turn, no prose around it.
 *
 *     {"tool": "<name>", "args": {…}}     — I need to look something up
 *     {"answer": "<the reply>"}           — I'm done, tell the person
 *
 * A malformed reply gets one repair nudge; a second failure becomes the
 * answer text itself, so the person always gets SOMETHING back rather
 *than a spinner. Figures may only come from tool results — the system
 * prompt is blunt about it, and the trace shows every lookup so the
 * person can check what the model actually saw.
 */

import { loadAssistantEngine, getLoadedAssistantModelId, type EngineProgress } from "@/lib/aiAssistant";

export interface LocalTraceStep {
  tool: string;
  args: any;
  ok: boolean;
  summary: string;
}

export type LocalEvent =
  | { type: "status"; text: string }
  | { type: "tool"; step: LocalTraceStep }
  | { type: "token"; text: string }
  | { type: "done"; reply: string; trace: LocalTraceStep[] }
  | { type: "error"; error: string };

const MAX_STEPS = 5;

function systemPrompt(tools: any[]): string {
  const toolLines = tools
    .map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.input_schema?.properties || {})}`)
    .join("\n");
  return `You are the AI assistant inside Biome AI OS, the internal platform of BIOME INDUSTRIA PRIVATE LIMITED — an Indian biomass supply company. Users may write in English, Hindi, or Hinglish; answer in the language they used.

THE BUSINESS: biomass supplied to power plants under TRADING (vendor → client) or MANUFACTURING (our plants GKD/REW → client). Every consignment has a reference like BDC/786/MHI/44 (our code / our doc no / vendor code / vendor doc no). Documents arrive on WhatsApp and are filed automatically.

YOUR TOOLS (read-only — you can never change data):
${toolLines}

THE PROTOCOL — follow it exactly:
- Reply with ONE JSON object and NOTHING else. No markdown, no prose outside the JSON.
- To look something up: {"tool": "tool_name", "args": {...}}
- To answer the person: {"answer": "your full answer here"}
- NEVER state a figure, count, or status you did not just read from a tool result. If a tool fails, say what failed in your answer.
- One tool per turn. After you have what you need, answer.
- Keep answers short, concrete, and in the person's language.`;
}

/** Pull the first JSON object out of a small model's reply, tolerating
 *  the code fences and stray prose they love to add. */
function extractJson(text: string): any | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace hunting */
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching close brace so trailing prose doesn't break parse.
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function summarise(data: any): string {
  const s = JSON.stringify(data);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

export async function* runLocalAssistant(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  modelId: string;
  agentId?: string | null;
  tally?: { host?: string; port?: number; company?: string };
  onProgress?: (p: EngineProgress) => void;
}): AsyncGenerator<LocalEvent, void, unknown> {
  // 1. The engine. First load downloads the weights (free, cached by the
  // browser after that) — progress goes straight to the UI.
  if (getLoadedAssistantModelId() !== opts.modelId) {
    yield { type: "status", text: "Loading the local model…" };
  }
  const engine = await loadAssistantEngine(opts.modelId, (p) => opts.onProgress?.(p));

  // 2. The same tool catalogue the cloud loop uses.
  const toolsRes = await fetch(`/api/assistant/tool${opts.agentId ? `?agent=${encodeURIComponent(opts.agentId)}` : ""}`, { cache: "no-store" });
  const toolsJson = await toolsRes.json().catch(() => ({}));
  const tools: any[] = Array.isArray(toolsJson.tools) ? toolsJson.tools : [];

  const agentNote = toolsJson.agent ? `\nYOU ARE THE ${String(toolsJson.agent.name).toUpperCase()}: ${toolsJson.agent.scope} Stay within this scope; for anything else, say which agent to ask.` : "";
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt(tools) + agentNote },
    ...opts.history.slice(-8),
    { role: "user", content: opts.message },
  ];

  const trace: LocalTraceStep[] = [];
  let repaired = false;

  for (let step = 0; step <= MAX_STEPS; step++) {
    const res = await engine.chat.completions.create({
      messages,
      temperature: 0.2, // decisiveness over creativity — this turn is a decision
      max_tokens: 700,
    });
    const raw = res.choices?.[0]?.message?.content?.trim() || "";
    const parsed = extractJson(raw);

    // --- Malformed: one repair nudge, then surrender the raw text.
    if (!parsed || (typeof parsed.answer !== "string" && typeof parsed.tool !== "string")) {
      if (!repaired) {
        repaired = true;
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: 'Your reply was not the required JSON. Reply again with exactly one JSON object: {"tool": "...", "args": {...}} or {"answer": "..."}.',
        });
        continue;
      }
      yield { type: "done", reply: raw || "I couldn't work that one out — try asking more narrowly.", trace };
      return;
    }

    // --- Final answer: stream it out word-ish by word-ish so the panel
    // feels like the model is talking, because it is.
    if (typeof parsed.answer === "string") {
      const answer = parsed.answer.trim();
      for (const piece of answer.split(/(\s+)/)) {
        if (piece) yield { type: "token", text: piece };
      }
      yield { type: "done", reply: answer, trace };
      return;
    }

    // --- Tool call.
    const name = String(parsed.tool);
    if (!tools.some((t) => t.name === name)) {
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `There is no tool called "${name}". Choose one of: ${tools.map((t) => t.name).join(", ")} — or answer with {"answer": "..."}.`,
      });
      continue;
    }

    yield { type: "status", text: `Looking up ${name.replace(/_/g, " ")}…` };
    const toolRes = await fetch("/api/assistant/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: parsed.args ?? {}, tally: opts.tally, agent: opts.agentId || undefined }),
    });
    const result = await toolRes.json().catch(() => ({ ok: false, error: "The tool call failed." }));

    const traceStep: LocalTraceStep = {
      tool: name,
      args: parsed.args ?? {},
      ok: Boolean(result.ok),
      summary: result.ok ? summarise(result.data) : String(result.error || "failed"),
    };
    trace.push(traceStep);
    yield { type: "tool", step: traceStep };

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `TOOL RESULT for ${name}: ${JSON.stringify(
        result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error }
      ).slice(0, 6000)}\nContinue the protocol: another {"tool":...} if you still need something, otherwise {"answer":"..."}.`,
    });
  }

  yield {
    type: "done",
    reply: "That needed more lookups than I can do in one go — ask about one client, vendor, or period at a time.",
    trace,
  };
}
