/**
 * AI keys set from the Settings screen (server only).
 *
 * Until now a key could only be put in `.env.local` by hand, which nobody
 * outside a developer can do. The Settings → AI card stores it here,
 * encrypted, and both the app and the WhatsApp agent read it. A key in
 * `.env.local` still wins. The Gemini key from aistudio.google.com is free.
 *
 * Mirrored in whatsapp-agent/lib/aiKeys.js — same file, same cipher.
 */
import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic } from "@/lib/dataRoot";

function file() { return path.join(paths.configDir, "ai-keys.json"); }
function key(): Buffer {
  return crypto.createHash("sha256").update(`ai-keys:${process.env.BIOME_AUTH_SECRET || "biome-local-ai-key"}`).digest();
}
function enc(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const d = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${d.toString("base64")}`;
}
function dec(stored: string): string {
  if (!stored) return "";
  try {
    const [iv, tag, data] = stored.split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch { return ""; }
}

export function saveAiKeys(k: { gemini?: string; anthropic?: string }): void {
  const cur = readJson<{ geminiEnc?: string; anthropicEnc?: string }>(file(), {});
  writeJsonAtomic(file(), {
    geminiEnc: k.gemini !== undefined ? enc(k.gemini.trim()) : cur.geminiEnc || "",
    anthropicEnc: k.anthropic !== undefined ? enc(k.anthropic.trim()) : cur.anthropicEnc || "",
    updatedAt: new Date().toISOString(),
  });
  // Take effect now, without a restart.
  if (k.gemini !== undefined) process.env.GEMINI_API_KEY = k.gemini.trim();
  if (k.anthropic !== undefined) process.env.ANTHROPIC_API_KEY = k.anthropic.trim();
}

/** Fill process.env from the stored keys when .env.local has none. */
export function applyStoredAiKeys(): void {
  const f = readJson<{ geminiEnc?: string; anthropicEnc?: string }>(file(), {});
  if (!(process.env.GEMINI_API_KEY || "").trim() && f.geminiEnc) process.env.GEMINI_API_KEY = dec(f.geminiEnc);
  if (!(process.env.ANTHROPIC_API_KEY || "").trim() && f.anthropicEnc) process.env.ANTHROPIC_API_KEY = dec(f.anthropicEnc);
}
