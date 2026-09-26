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
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;

  const d = diagnoseKeys();
    // A shape check can only say "this doesn't look right", and that
  // judgement was wrong once. Ask Google for the real verdict.
  let geminiLive: { ok: boolean; message: string } | null = null;
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (geminiKey) {
    geminiLive = await verifyGeminiKey(geminiKey);
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
