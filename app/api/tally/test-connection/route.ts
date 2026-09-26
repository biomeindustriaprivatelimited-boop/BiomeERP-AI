import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { buildPingRequestXml, looksLikeTallyResponse, resolveTallyTarget } from "@/lib/tally";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { url, headers } = resolveTallyTarget(body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: buildPingRequestXml(),
      signal: controller.signal,
    });
    const text = await res.text();

    if (res.status === 401) {
      return NextResponse.json({
        reachable: false,
        message: "The Agent rejected the request — the API key doesn't match what's in its config.json.",
      });
    }

    if (looksLikeTallyResponse(text)) {
      return NextResponse.json({
        reachable: true,
        message: `Connected successfully via ${url}.`,
      });
    }

    return NextResponse.json({
      reachable: false,
      message: `Got a response from ${url}, but it doesn't look like Tally's XML gateway. Raw response: ${
        text.slice(0, 300).trim() || "(empty)"
      }`,
    });
  } catch (err: any) {
    const isAbort = err?.name === "AbortError";
    return NextResponse.json({
      reachable: false,
      message: isAbort
        ? `No response from ${url} within 8 seconds. If using the Agent, confirm the tunnel (cloudflared/ngrok) is running and the URL is current.`
        : `Could not reach ${url}: ${err?.message || "connection failed"}.`,
    });
  } finally {
    clearTimeout(timeout);
  }
}
