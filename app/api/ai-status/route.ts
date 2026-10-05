import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { diagnoseKeys, verifyGeminiKey } from "@/lib/aiProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells the UI the real, current AI status — including WHY it isn't
 * working when a key is present but malformed (the exact case that used
 * to fail silently). Never returns a key itself.
 */
let liveCache: { key: string; at: number; result: { ok: boolean; message: string } } | null = null;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;

  const d = diagnoseKeys();
    // A shape check can only say "this doesn't look right", and that
  // judgement was wrong once. Ask Google for the real verdict.
  let geminiLive: { ok: boolean; message: string } | null = null;
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (geminiKey) {
    // A live call costs quota; the verdict is reused for five minutes
    // unless ?force=1 (the Settings "Test" button).
    const fresh = liveCache && liveCache.key === geminiKey && Date.now() - liveCache.at < 5 * 60 * 1000;
    if (!fresh || req.nextUrl.searchParams.get("force") === "1") {
      liveCache = { key: geminiKey, at: Date.now(), result: await verifyGeminiKey(geminiKey) };
    }
    geminiLive = liveCache!.result;
  }

return NextResponse.json({
    geminiLive,
    configured: d.configured,
    activeProvider: d.activeProvider,
    hasGemini: d.hasGeminiValue,
    hasAnthropic: d.hasAnthropicValue,
    geminiUsable: d.geminiUsable,
    anthropicUsable: d.anthropicUsable,
    problem: d.problem,
  });
}

/** Save the free Gemini key (or an Anthropic key) from Settings → AI. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { saveAiKeys } = await import("@/lib/aiKeys");
  const gemini = typeof body.gemini === "string" ? body.gemini.trim() : undefined;
  let warning: string | null = null;
  if (gemini) {
    const live = await verifyGeminiKey(gemini);
    // A key Google REJECTS is refused; a key that simply could not be
    // checked (no internet / firewall right now) is saved with a warning.
    if (!live.ok && live.code !== "NETWORK") return NextResponse.json({ error: `Google did not accept that key: ${live.message}`, code: live.code }, { status: 400 });
    if (!live.ok) warning = live.message;
  }
  saveAiKeys({ gemini, anthropic: typeof body.anthropic === "string" ? body.anthropic : undefined });
  liveCache = null;
  return NextResponse.json({ ok: true, warning });
}
