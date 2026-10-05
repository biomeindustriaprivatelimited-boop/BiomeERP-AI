/**
 * Biome Platform — calling Google Gemini, and saying plainly when it fails
 * -------------------------------------------------------------------
 * Two things went wrong with the old single call:
 *
 *  1. One hard-coded model name. Google retires model names (the whole
 *     gemini-1.0 / 1.5 / gemini-pro family now answers 404), and an alias
 *     can be unavailable for a particular key or region. One 404 meant
 *     every document silently fell back to the offline reader.
 *  2. Every failure was swallowed. An invalid key, a used-up free quota
 *     and a retired model all looked identical — "the AI didn't help" —
 *     so nobody could tell the key in Settings was not working.
 *
 * Now: a short list of current models is tried in order (a 404 or a quota
 * hit on one moves to the next), every error is turned into a plain
 * reason with a code, and the last outcome is kept in `health` so the
 * WhatsApp page can show "Gemini: key rejected" instead of nothing.
 */

/** Current models, best first. Older names (1.0 / 1.5 / gemini-pro) are retired and 404. */
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];

const health = {
  lastOkAt: null,
  lastModel: null,
  lastError: null,
  lastErrorCode: null,
  lastErrorAt: null,
  calls: 0,
  failures: 0,
};

/** Shape check only — Google's answer is what counts. */
function cleanKey(raw) {
  // Pasted with quotes, a trailing newline, or "GEMINI_API_KEY=" in front.
  return String(raw || "").trim().replace(/^GEMINI_API_KEY\s*=\s*/i, "").replace(/^["']|["']$/g, "").trim();
}
function plausibleKey(raw) {
  const k = cleanKey(raw);
  return /^[A-Za-z0-9_\-.]{30,}$/.test(k);
}

/**
 * Turn Google's error into { code, message } a non-programmer can act on.
 * Codes: INVALID_KEY, PERMISSION, QUOTA, MODEL_NOT_FOUND, BAD_REQUEST,
 *        SERVER, NETWORK, EMPTY.
 */
function describeError(status, bodyText) {
  let reason = "";
  let gStatus = "";
  try {
    const j = JSON.parse(bodyText);
    reason = j?.error?.message || "";
    gStatus = j?.error?.status || "";
    const det = (j?.error?.details || []).map((d) => d.reason).filter(Boolean).join(",");
    if (det) gStatus += ` ${det}`;
  } catch {
    reason = String(bodyText || "").slice(0, 200);
  }
  const r = `${reason} ${gStatus}`;
  // A firewall / proxy answering instead of Google (no Google error JSON).
  if (!gStatus.trim() && /allowlist|egress|proxy|firewall|blocked|<html/i.test(`${reason} ${bodyText}`)) {
    return { code: "NETWORK", message: `This PC cannot reach Google Gemini — a firewall or proxy blocked it (${reason.slice(0, 120) || status}). Allow generativelanguage.googleapis.com, or rely on the offline reader.` };
  }
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(r) || (status === 400 && /key/i.test(r))) {
    return { code: "INVALID_KEY", message: `Google rejected the Gemini key (${reason || "invalid key"}). Copy a fresh key from aistudio.google.com/apikey into Settings → AI.` };
  }
  if (status === 401 || status === 403 || /PERMISSION_DENIED|SERVICE_DISABLED|has not been used|is disabled/i.test(r)) {
    return { code: "PERMISSION", message: `This Gemini key is not allowed to use the API (${reason || status}). Create the key in Google AI Studio (aistudio.google.com/apikey), not in a Cloud project with the API switched off.` };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(r)) {
    return { code: "QUOTA", message: `Gemini's free daily/minute limit is used up (${reason || "quota exceeded"}). Documents are still read offline; Gemini resumes when the limit resets.` };
  }
  if (status === 404 || /not found|is not supported/i.test(r)) {
    return { code: "MODEL_NOT_FOUND", message: `Gemini model not available for this key (${reason || "404"}).` };
  }
  if (status >= 500) return { code: "SERVER", message: `Google's Gemini service had an error (${status}). It is retried on the next document.` };
  return { code: "BAD_REQUEST", message: `Gemini refused the request (${status}): ${reason || "no reason given"}` };
}

function record(ok, model, err) {
  health.calls += 1;
  if (ok) {
    health.lastOkAt = new Date().toISOString();
    health.lastModel = model;
  } else {
    health.failures += 1;
    health.lastError = err.message;
    health.lastErrorCode = err.code || null;
    health.lastErrorAt = new Date().toISOString();
  }
}

class GeminiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

/**
 * generateContent with model fallback.
 * @param {string} key
 * @param {object} req { system, parts: [{mime, base64}|{text}], json: true, maxTokens }
 * @returns {Promise<{ text, model }>}
 */
async function generate(key, req, options = {}) {
  key = cleanKey(key);
  if (!key) throw new GeminiError("NO_KEY", "No Gemini key is set.");
  const models = options.models || MODELS;
  let last = null;
  for (const model of models) {
    const body = {
      contents: [{
        role: "user",
        parts: (req.parts || []).map((p) => (p.text != null ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.base64 } })),
      }],
      generationConfig: {
        maxOutputTokens: req.maxTokens || 8192,
        temperature: 0,
        ...(req.json !== false ? { responseMimeType: "application/json" } : {}),
        // 2.5 models "think" by default and spend the output budget on it;
        // reading a document needs none.
        ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    let res;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), options.timeoutMs || 90000);
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
    } catch (err) {
      last = new GeminiError("NETWORK", `Could not reach Google Gemini (${err.name === "AbortError" ? "timed out" : err.message}). Check this PC's internet connection or firewall.`);
      record(false, model, last);
      throw last; // no point trying other models without a network
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const d = describeError(res.status, text);
      last = new GeminiError(d.code, d.message, res.status);
      // Bad key / no permission: every model will say the same.
      if (d.code === "INVALID_KEY" || d.code === "PERMISSION") { record(false, model, last); throw last; }
      continue; // 404 / 429 / 5xx / a model-specific refusal: the next model may work
    }
    const data = await res.json().catch(() => null);
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!text) {
      const why = data?.promptFeedback?.blockReason || cand?.finishReason || "no text";
      last = new GeminiError("EMPTY", `Gemini returned no answer (${why}).`);
      continue;
    }
    record(true, model);
    return { text, model };
  }
  if (last) record(false, models[models.length - 1], last);
  throw last || new GeminiError("UNKNOWN", "Every Gemini model failed.");
}

/** A tiny live call: proves the key, the network and the quota in one go. */
async function liveTest(key) {
  const started = Date.now();
  try {
    const r = await generate(key, { parts: [{ text: "Reply with the single word OK." }], json: false, maxTokens: 20 }, { timeoutMs: 20000 });
    return { ok: true, model: r.model, ms: Date.now() - started, message: `Gemini works (${r.model}, ${Date.now() - started} ms).` };
  } catch (err) {
    return { ok: false, code: err.code || "UNKNOWN", message: err.message, ms: Date.now() - started };
  }
}

module.exports = { generate, liveTest, describeError, plausibleKey, cleanKey, health, MODELS, GeminiError };
