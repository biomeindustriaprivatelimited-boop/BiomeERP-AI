import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { diagnoseKeys, AiError } from "@/lib/aiProvider";
import { toolSchemas, runTool, type ToolContext } from "@/lib/aiTools";

/**
 * Biome AI OS — Orchestrator
 * -------------------------------------------------------------------
 * The reasoning loop that sits between a question and the app's data.
 *
 *   question -> plan -> call a tool -> read the result -> call another
 *   if needed -> answer, citing what it actually saw
 *
 * WHY A LOOP RATHER THAN ONE CALL
 * Real questions need more than one lookup. "Which supplies are stuck
 * and who do we owe money to?" needs the supply sets AND the payables.
 * A single-shot call would answer half of it confidently. The loop keeps
 * going until the model has what it needs or hits the step limit.
 *
 * GROUNDING IS THE WHOLE POINT
 * The model is told, firmly, that it may only state figures that came
 * back from a tool. If a tool fails it must say so rather than filling
 * the gap from general knowledge — a fabricated cash balance presented
 * confidently is worse than no answer at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STEPS = 6;

const SYSTEM_PROMPT = `You are the AI assistant inside Biome AI OS, the internal platform of BIOME INDUSTRIA PRIVATE LIMITED — an Indian company that supplies biomass to power plants (Jhajjar Power, NTPC, Aravali Power/APCPL, Nabha Power, HTPS Aligarh).

## How the business works
- Two supply models: TRADING (buy from a vendor, supply straight to the client) and MANUFACTURING (our own produced material).
- Every consignment is tied together by a coordination reference shaped like BDC/786/MHI/44:
  BDC = our company code, 786 = our tax invoice or challan number, MHI = the vendor's code, 44 = the vendor's invoice number.
- A complete supply needs a specific set of papers, and each client demands a different set — some also require a Digital Signature Certificate on particular documents.
- Documents arrive on a WhatsApp group and are read, matched and filed automatically.

## Your tools
You have tools that read live data from Tally and from the document system. USE THEM. Never answer a factual question about this business from memory or assumption.

## Rules you must not break
1. Every number you state must have come back from a tool in this conversation. If you did not fetch it, do not say it.
2. If a tool fails, say plainly what failed and what the user should check. Do not substitute an estimate, and do not quietly answer around the gap.
3. If a tool returns an empty result, that is an answer — "there are no incomplete supplies" — not a reason to guess.
4. Amounts are Indian rupees. Write them the Indian way: ₹1,18,000 or ₹48.75 lakh. Say "lakh" and "crore", not "million".
5. Be brief and concrete. A finance person wants the number and what it means, not a preamble.
6. When something looks wrong — a negative cash balance, a supply missing documents for weeks — point it out.
7. You cannot change data. If asked to create, edit or delete something, explain which screen does it and what you would do there.

## Style
Reply in the language the user wrote in. Many users here write Hinglish (Hindi in Latin script) — if they do, reply the same way, keeping financial and technical terms in English.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface OrchestratorRequest {
  message: string;
  history?: ChatMessage[];
  tally?: { host: string; port: number; company?: string };
}

/** One entry in the visible trace, so the user can see the reasoning. */
interface TraceStep {
  tool: string;
  args: any;
  ok: boolean;
  summary: string;
  source?: string;
}

function summarise(result: any): string {
  if (!result?.ok) return result?.error || "Failed.";
  const d = result.data ?? {};
  if (typeof d.count === "number") return `${d.count} result(s).`;
  if (Array.isArray(d.matches)) return `${d.matches.length} match(es).`;
  if (typeof d.totalCount === "number") return `${d.totalCount} transaction(s).`;
  if (typeof d.ledgerCount === "number") return `Read ${d.ledgerCount} ledgers.`;
  return "Done.";
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;

  const diag = diagnoseKeys();
  if (!diag.configured) {
    return NextResponse.json(
      {
        error:
          diag.problem ||
          "The assistant needs an AI key. Add ANTHROPIC_API_KEY (starts with sk-ant-) to .env.local and restart.",
        code: "NO_API_KEY",
      },
      { status: 400 }
    );
  }
  // Tool calling needs a model that supports it properly; Anthropic is
  // the one wired up here.
  if (!diag.anthropicUsable) {
    return NextResponse.json(
      {
        error:
          "The assistant runs on Anthropic's tool calling. Add a valid ANTHROPIC_API_KEY (starts with sk-ant-) to .env.local and restart. Your other modules will keep working on whichever key they already use.",
        code: "NEEDS_ANTHROPIC",
      },
      { status: 400 }
    );
  }

  let body: OrchestratorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const ctx: ToolContext = { tally: body.tally, allowWrites: false };
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();

  // Anthropic's message format, built up as the loop runs.
  const messages: any[] = [
    ...(body.history ?? []).slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message },
  ];

  const trace: TraceStep[] = [];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: toolSchemas(),
          messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new AiError(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`, res.status, "anthropic");
      }

      const data = await res.json();
      const content: any[] = data.content ?? [];
      const toolUses = content.filter((b) => b.type === "tool_use");

      // No tools requested — this is the final answer.
      if (!toolUses.length) {
        const text = content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return NextResponse.json({
          reply: text || "I couldn't produce an answer for that.",
          trace,
          steps: step,
        });
      }

      // Run every requested tool, then feed the results back in.
      messages.push({ role: "assistant", content });
      const toolResults: any[] = [];

      for (const use of toolUses) {
        const result = await runTool(use.name, use.input, ctx);
        trace.push({
          tool: use.name,
          args: use.input,
          ok: result.ok,
          summary: summarise(result),
          source: result.source,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          // Errors go back as content, not as an exception, so the model
          // can tell the user what broke instead of stalling.
          content: JSON.stringify(
            result.ok
              ? { ok: true, source: result.source, data: result.data }
              : { ok: false, error: result.error }
          ),
          is_error: !result.ok,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Ran out of steps — say so rather than inventing a conclusion.
    return NextResponse.json({
      reply:
        "That question needed more lookups than I'm allowed in one go. Try narrowing it — ask about one client, one vendor, or one period at a time.",
      trace,
      steps: MAX_STEPS,
      truncated: true,
    });
  } catch (err: any) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, trace }, { status: err.status });
    }
    return NextResponse.json(
      { error: err?.message || "The assistant failed.", trace },
      { status: 500 }
    );
  }
}
