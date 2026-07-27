import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Lets the Settings UI show the real, current AI-OCR key status instead
 *  of the user having to guess why the OCR Scanner isn't reading anything.
 *  Never returns the key itself — only whether one is present. */
export async function GET() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  return NextResponse.json({
    hasGemini,
    hasAnthropic,
    configured: hasGemini || hasAnthropic,
    activeProvider: hasGemini ? "Gemini" : hasAnthropic ? "Anthropic" : null,
  });
}
