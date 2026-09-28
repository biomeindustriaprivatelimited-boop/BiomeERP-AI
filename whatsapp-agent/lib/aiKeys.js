/**
 * Keys saved from Settings → AI (config/ai-keys.json), decrypted the same
 * way lib/aiKeys.ts encrypts them. `.env.local` still wins.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");

function dec(stored) {
  if (!stored) return "";
  try {
    const key = crypto.createHash("sha256").update(`ai-keys:${process.env.BIOME_AUTH_SECRET || "biome-local-ai-key"}`).digest();
    const [iv, tag, data] = String(stored).split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch { return ""; }
}

/** Current keys: environment first, then the stored ones (re-read each time, so a new key works without a restart). */
function aiKeys() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(path.join(PATHS.configDir, "ai-keys.json"), "utf8")); } catch { /* none */ }
  return {
    gemini: (process.env.GEMINI_API_KEY || "").trim() || dec(f.geminiEnc),
    anthropic: (process.env.ANTHROPIC_API_KEY || "").trim() || dec(f.anthropicEnc),
  };
}

module.exports = { aiKeys };
