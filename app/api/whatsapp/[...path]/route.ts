import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { agentFetch, AgentUnavailableError } from "@/lib/whatsappAgent";

/**
 * Thin proxy between the browser and the background WhatsApp agent.
 *
 * The agent listens on 127.0.0.1 with a token that only this Node process
 * can read, so the browser can never reach it directly — every call goes
 * through here. That also keeps the token out of the page source.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Routes the UI is allowed to reach, and the method each accepts. */
/** Routes reachable from the UI. Some accept both methods. */
const ALLOWED: Record<string, ("GET" | "POST")[]> = {
  status: ["GET"],
  documents: ["GET"],
  "suggest-reference": ["GET"],
  sets: ["GET"],
  clients: ["GET"],
  backfill: ["GET", "POST"],
  "backfill/stop": ["POST"],
  chats: ["GET", "POST"],
  reanchor: ["POST"],
  classify: ["POST"],
  test: ["POST"],
  patterns: ["GET"],
  staged: ["GET"],
  // Re-offers every filed document of ours to the staging queue, so
  // vendor paperwork held while the agent was off gets filed now.
  "staged/sweep": ["POST"],
  file: ["GET"],
  connect: ["POST"],
  disconnect: ["POST"],
  reprocess: ["POST"],
  // Labelled exemplars — "train the agent with real documents".
  samples: ["GET", "POST"],
  learning: ["GET"],
};

function unavailable(err: AgentUnavailableError) {
  // 503, not 500: the app is fine, the agent just isn't up yet.
  return NextResponse.json({ error: err.message, code: "AGENT_UNAVAILABLE" }, { status: 503 });
}

const ALLOWED_DELETE: Record<string, true> = { documents: true, patterns: true, samples: true };

async function proxy(req: NextRequest, segments: string[], method: "GET" | "POST" | "DELETE") {
  const route = segments.join("/");
  if (method === "DELETE") {
    if (!ALLOWED_DELETE[route]) {
      return NextResponse.json({ error: `Cannot delete: ${route}` }, { status: 404 });
    }
  } else if (!ALLOWED[route]?.includes(method as "GET" | "POST")) {
    return NextResponse.json({ error: `Unknown WhatsApp route: ${route}` }, { status: 404 });
  }

  const search = req.nextUrl.search || "";
  const body = method === "POST" || method === "DELETE" ? await req.text() : undefined;

  try {
    const res = await agentFetch(`/${route}${search}`, {
      method,
      body,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      // Re-scanning a document runs a fresh AI call, which can be slow.
      timeoutMs: route === "reprocess" ? 120000 : 30000,
    });

    // /file streams the actual PDF or image back to the browser.
    if (route === "file") {
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Could not load that file." }));
        return NextResponse.json(errBody, { status: res.status });
      }
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
          "Content-Disposition": res.headers.get("Content-Disposition") || "inline",
          "Cache-Control": "no-store",
        },
      });
    }

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    if (err instanceof AgentUnavailableError) return unavailable(err);
    return NextResponse.json(
      { error: (err as Error).message || "The WhatsApp agent request failed." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  return proxy(req, params.path || [], "GET");
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  return proxy(req, params.path || [], "POST");
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  return proxy(req, params.path || [], "DELETE");
}
