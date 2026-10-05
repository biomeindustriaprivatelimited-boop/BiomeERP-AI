/**
 * Biome Platform — AI provider (server only)
 * -------------------------------------------------------------------
 * One place that decides WHICH AI reads a document, and actually calls
 * it. Both the AI OCR scanner and the WhatsApp agent go through here, so
 * there is a single, correct answer to "is an AI configured and working".
 *
 * WHY THIS EXISTS
 * The old code did `geminiKey ? callGemini(...) : callAnthropic(...)`.
 * If GEMINI_API_KEY held anything at all — even a wrong value pasted by
 * mistake — it always took the Gemini path and always failed, and the
 * Anthropic key sitting right there was never tried. This module fixes
 * that: it validates the SHAPE of each key, ignores ones that can't be
 * real, and falls back to the other provider when a call fails.
 */

import fs from "fs";
import path from "path";

/**
 * Gemini keys come in two shapes, and BOTH are real.
 *
 * The long-standing format starts with "AIza". Google AI Studio now also
 * issues keys beginning "AQ." — its own "API key details" dialog shows
 * them under the heading "API Key", with a copy button.
 *
 * This code previously rejected the "AQ." form as an OAuth token. That
 * was a wrong call, and an expensive one: a user pasted a perfectly
 * valid key and the app told them it was invalid. Shape-guessing is
 * brittle, so the rule is now permissive and the real verdict comes from
 * asking Google — see verifyGeminiKey below.
 *
 * Legacy note: keys issued by Google AI Studio start with "AIza" and are
 * ~39 chars. An OAuth access token ("AQ.xxx", "ya29.xxx") is NOT an API
 * key and will always 401 against generativelanguage — so we reject it
 * up front and tell the user plainly, instead of silently failing.
 */
import { applyStoredAiKeys } from "@/lib/aiKeys";

export function isPlausibleGeminiKey(key: string | undefined | null): boolean {
  const k = (key || "").trim();
  // Accept both issued formats. Anything shorter than 20 characters, or
  // containing whitespace, is a paste accident rather than a key.
  if (!k || /\s/.test(k) || k.length < 20) return false;
  // Any key-shaped value is tried; Google's answer (verifyGeminiKey and
  // the error text of a failed call) is what decides, and is shown.
  return /^AIza[0-9A-Za-z_\-]{20,}$/.test(k) || /^AQ\.[0-9A-Za-z_\-.]{20,}$/.test(k) || /^[A-Za-z0-9_\-.]{30,}$/.test(k);
}

/** Anthropic keys start with "sk-ant-". */
export function isPlausibleAnthropicKey(key: string | undefined | null): boolean {
  const k = (key || "").trim();
  return /^sk-ant-[0-9A-Za-z_\-]{20,}$/.test(k);
}

export interface KeyDiagnosis {
  hasGeminiValue: boolean;
  hasAnthropicValue: boolean;
  geminiUsable: boolean;
  anthropicUsable: boolean;
  configured: boolean;
  activeProvider: "gemini" | "anthropic" | null;
  /** A specific, human-readable problem the user can act on, or null. */
  problem: string | null;
}

export function diagnoseKeys(): KeyDiagnosis {
  applyStoredAiKeys();
  const geminiRaw = (process.env.GEMINI_API_KEY || "").trim();
  const anthropicRaw = (process.env.ANTHROPIC_API_KEY || "").trim();

  const geminiUsable = isPlausibleGeminiKey(geminiRaw);
  const anthropicUsable = isPlausibleAnthropicKey(anthropicRaw);

  // Prefer whichever is actually usable. Anthropic first when it's the
  // valid one, so a stray Gemini value never wins.
  const activeProvider = anthropicUsable ? "anthropic" : geminiUsable ? "gemini" : null;

  let problem: string | null = null;
  if (!geminiRaw && !anthropicRaw) {
    problem =
      "No AI key is set. Add ANTHROPIC_API_KEY (starts with sk-ant-) or GEMINI_API_KEY (starts with AIza or AQ.) to .env.local and restart.";
  } else if (!activeProvider) {
    // Something is set but neither looks real — the exact case that was
    // silently breaking the scanner.
    const bits: string[] = [];
    if (geminiRaw && !geminiUsable) {
      bits.push(
        geminiRaw.startsWith("AQ.") || geminiRaw.startsWith("ya29.")
          ? "GEMINI_API_KEY has spaces or line breaks in it — paste it again with nothing around it."
          : "GEMINI_API_KEY doesn't look like a key from Google AI Studio. It should start with 'AIza' or 'AQ.' — copy it from the API key details dialog at aistudio.google.com/apikey."
      );
    }
    if (anthropicRaw && !anthropicUsable) {
      bits.push("ANTHROPIC_API_KEY doesn't look like a valid Anthropic key (it should start with 'sk-ant-')");
    }
    problem = bits.join(". ") + ". Fix it in .env.local and restart the app.";
  }

  return {
    hasGeminiValue: Boolean(geminiRaw),
    hasAnthropicValue: Boolean(anthropicRaw),
    geminiUsable,
    anthropicUsable,
    configured: Boolean(activeProvider),
    activeProvider,
    problem,
  };
}

// ---------------------------------------------------------------------
// Calling the models
// ---------------------------------------------------------------------

export interface VisionPart {
  /** "application/pdf", "image/jpeg", "image/png", "image/webp" */
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface AiCallOptions {
  system: string;
  userText: string;
  parts: VisionPart[];
  maxTokens?: number;
  /** Force a provider (used by tests / the "test key" button). */
  provider?: "gemini" | "anthropic";
}

export class AiError extends Error {
  status: number;
  provider: string;
  constructor(message: string, status = 502, provider = "ai") {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.provider = provider;
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];

/**
 * Current Gemini models, best first. The 1.0 / 1.5 / "gemini-pro" names
 * are retired and answer 404; one fixed name meant one retirement (or one
 * key without access to that model) silently broke every read. Each model
 * is tried in turn; a bad key stops at once with a plain reason.
 * Mirrored in whatsapp-agent/lib/gemini.js.
 */
export const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];

/** Google's error → a reason a non-programmer can act on. */
export function describeGeminiError(status: number, bodyText: string): { code: string; message: string } {
  let reason = "";
  let gStatus = "";
  try {
    const j = JSON.parse(bodyText);
    reason = j?.error?.message || "";
    gStatus = `${j?.error?.status || ""} ${(j?.error?.details || []).map((d: any) => d.reason).filter(Boolean).join(",")}`;
  } catch {
    reason = String(bodyText || "").slice(0, 200);
  }
  const r = `${reason} ${gStatus}`;
  if (!gStatus.trim() && /allowlist|egress|proxy|firewall|blocked|<html/i.test(`${reason} ${bodyText}`))
    return { code: "NETWORK", message: `This PC cannot reach Google Gemini — a firewall or proxy blocked it (${reason.slice(0, 120) || status}). Allow generativelanguage.googleapis.com, or rely on the offline reader.` };
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(r) || (status === 400 && /key/i.test(r)))
    return { code: "INVALID_KEY", message: `Google rejected the Gemini key (${reason || "invalid key"}). Copy a fresh key from aistudio.google.com/apikey into Settings → AI.` };
  if (status === 401 || status === 403 || /PERMISSION_DENIED|SERVICE_DISABLED|is disabled/i.test(r))
    return { code: "PERMISSION", message: `This Gemini key is not allowed to use the API (${reason || status}). Create the key in Google AI Studio (aistudio.google.com/apikey).` };
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(r))
    return { code: "QUOTA", message: `Gemini's free limit is used up for now (${reason || "quota exceeded"}). It resets automatically; the offline reader keeps working meanwhile.` };
  if (status === 404 || /not found|is not supported/i.test(r))
    return { code: "MODEL_NOT_FOUND", message: `Gemini model not available for this key (${reason || "404"}).` };
  if (status >= 500) return { code: "SERVER", message: `Google's Gemini service had an error (${status}). Try again shortly.` };
  return { code: "BAD_REQUEST", message: `Gemini refused the request (${status}): ${reason || "no reason given"}` };
}

async function callGemini(key: string, opts: AiCallOptions): Promise<string> {
  const parts: any[] = opts.parts.map((p) => ({
    inline_data: { mime_type: p.mediaType, data: p.data },
  }));
  parts.push({ text: opts.userText });

  let last: AiError | null = null;
  for (const model of GEMINI_MODELS) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens || 8192,
            temperature: 0,
            responseMimeType: "application/json",
            ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      });
    } catch (err) {
      throw new AiError(`Could not reach Google Gemini: ${(err as Error).message}. Check the internet connection on the server PC.`, 503, "gemini");
    }
    if (!res.ok) {
      const body = await res.text();
      const d = describeGeminiError(res.status, body);
      last = new AiError(d.message, res.status === 429 ? 429 : res.status >= 500 ? 502 : 400, "gemini");
      (last as any).code = d.code;
      if (d.code === "INVALID_KEY" || d.code === "PERMISSION") throw last;
      continue;
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
    if (!text) {
      last = new AiError(`Gemini (${model}) returned an empty response.`, 502, "gemini");
      continue;
    }
    return text;
  }
  throw last || new AiError("Every Gemini model failed.", 502, "gemini");
}

async function callAnthropic(key: string, opts: AiCallOptions): Promise<string> {
  const content: any[] = opts.parts.map((p) => {
    if (p.mediaType === "application/pdf") {
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } };
    }
    return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } };
  });
  content.push({ type: "text", text: opts.userText });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: opts.maxTokens || 8192,
      system: opts.system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AiError(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`, res.status, "anthropic");
  }
  const data = await res.json();
  const textBlock = (data.content ?? []).find((b: any) => b.type === "text");
  const text = textBlock?.text ?? "";
  if (!text) throw new AiError("Anthropic returned an empty response.", 502, "anthropic");
  return text;
}

/**
 * Run a vision request against whichever provider is usable, falling back
 * to the other one if the first fails for a transient reason. Returns the
 * raw text the model produced (usually JSON — parse it yourself).
 */
export async function runVision(opts: AiCallOptions): Promise<{ text: string; provider: string }> {
  applyStoredAiKeys();
  const diag = diagnoseKeys();
  if (!diag.configured) {
    throw new AiError(diag.problem || "No usable AI key is configured.", 400, "config");
  }

  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();

  // Build the ordered list of providers to try: forced one, else the
  // active one first, then the other if it's also usable.
  const order: ("gemini" | "anthropic")[] = [];
  if (opts.provider) order.push(opts.provider);
  else if (diag.activeProvider) order.push(diag.activeProvider);
  for (const p of ["anthropic", "gemini"] as const) {
    if (!order.includes(p)) {
      if (p === "anthropic" && diag.anthropicUsable) order.push(p);
      if (p === "gemini" && diag.geminiUsable) order.push(p);
    }
  }

  let lastErr: AiError | null = null;
  for (const provider of order) {
    try {
      const text =
        provider === "gemini"
          ? await callGemini(geminiKey, opts)
          : await callAnthropic(anthropicKey, opts);
      return { text, provider };
    } catch (err) {
      lastErr = err instanceof AiError ? err : new AiError(String((err as Error).message), 502, provider);
      // A 4xx that isn't rate-limiting means this key is genuinely bad —
      // no point retrying the same provider, but do try the other.
      continue;
    }
  }
  throw lastErr || new AiError("Every configured AI provider failed.", 502, "ai");
}

/** Strip ```json fences and pull the first {...} or [...] out of text. */
export function extractJson(raw: string): any {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const firstObj = s.indexOf("{");
    const firstArr = s.indexOf("[");
    let start = -1;
    if (firstObj === -1) start = firstArr;
    else if (firstArr === -1) start = firstObj;
    else start = Math.min(firstObj, firstArr);
    if (start === -1) throw new Error("No JSON found in the AI response.");
    const openChar = s[start];
    const closeChar = openChar === "{" ? "}" : "]";
    const end = s.lastIndexOf(closeChar);
    if (end <= start) throw new Error("Malformed JSON in the AI response.");
    return JSON.parse(s.slice(start, end + 1));
  }
}

export { IMAGE_TYPES };

/**
 * Ask Google whether the key actually works.
 *
 * Shape checks can only ever say "this doesn't look right", and that
 * judgement was wrong once already. A single cheap call to the models
 * endpoint gives the real answer, in Google's own words, and turns
 * "looks invalid" into either "working" or the exact reason it isn't.
 */
export async function verifyGeminiKey(
  key: string
): Promise<{ ok: boolean; message: string; code?: string; model?: string }> {
  const k = (key || "").trim();
  if (!k) return { ok: false, message: "No Gemini key is set.", code: "NO_KEY" };

  // A real (tiny) generation, not just "list models": listing works on a
  // key whose free quota is used up or whose project has generation
  // switched off — exactly the cases that looked fine and read nothing.
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": k },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }],
          generationConfig: { maxOutputTokens: 20, temperature: 0, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      if (res.ok) return { ok: true, model, message: `Key works — Gemini answered (${model}).` };
      const d = describeGeminiError(res.status, await res.text());
      if (d.code === "INVALID_KEY" || d.code === "PERMISSION") return { ok: false, code: d.code, message: d.message };
      if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) return { ok: d.code === "QUOTA", code: d.code, message: d.message };
    } catch (err) {
      return {
        ok: false,
        code: "NETWORK",
        message: `Couldn't reach Google to check the key: ${(err as Error).message}. If this machine is offline, the offline reader still works without any key.`,
      };
    }
  }
  return { ok: false, code: "UNKNOWN", message: "Gemini did not answer." };
}
