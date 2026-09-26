/**
 * Biome Platform — data root (server side)
 * -------------------------------------------------------------------
 * The Next.js mirror of whatsapp-agent/lib/paths.js. Both processes MUST
 * resolve the same folders, so if you change the rules in one file,
 * change them in the other.
 *
 * Server-only: this imports `fs` and `os` and must never be pulled into
 * a client component.
 */

import fs from "fs";
import os from "os";
import path from "path";

/**
 * Where everything is stored, in priority order:
 *   1. BIOME_DATA_ROOT environment variable
 *   2. the folder chosen in Settings, recorded in ~/.biome-data-root
 *   3. <home>/Documents/Biome Platform
 *
 * The marker file exists because the WhatsApp agent runs as a separate
 * process and can't read this one's settings — a plain text file on disk
 * is the simplest thing both can agree on.
 */
export function dataRoot(): string {
  const override = (process.env.BIOME_DATA_ROOT || "").trim();
  if (override) return path.resolve(override);
  try {
    const marker = path.join(os.homedir(), ".biome-data-root");
    if (fs.existsSync(marker)) {
      const chosen = fs.readFileSync(marker, "utf8").trim();
      if (chosen) return path.resolve(chosen);
    }
  } catch {
    // Fall through to the default rather than failing to start.
  }
  return path.join(os.homedir(), "Documents", "Biome Platform");
}

export const paths = {
  get root() {
    return dataRoot();
  },
  get configDir() {
    return path.join(dataRoot(), "config");
  },
  get vendorsFile() {
    return path.join(dataRoot(), "config", "vendors.json");
  },
  get clientsFile() {
    return path.join(dataRoot(), "config", "clients.json");
  },
  get settingsFile() {
    return path.join(dataRoot(), "config", "whatsapp-settings.json");
  },
  get kycDir() {
    return path.join(dataRoot(), "kyc");
  },
  get inbox() {
    return path.join(dataRoot(), "whatsapp", "inbox");
  },
  get runtimeFile() {
    return path.join(dataRoot(), "runtime", "whatsapp-agent.json");
  },
};

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Write JSON without risking a half-written file if the process dies
 * mid-write: build the new file alongside, then rename over the old one
 * (rename is atomic on both Windows and POSIX).
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
  bumpDataVersion();
}

/**
 * LIVE SYNC — one number that moves whenever any business data is saved.
 *
 * Every save in the app goes through writeJsonAtomic, so this is the one
 * place that knows "something changed". Phones, other PCs and other tabs
 * poll /api/live for this number and reload the screen they are on when it
 * moves — which is how an expense filed on a plant manager's phone appears
 * on the accounts desk a few seconds later without anyone pressing refresh.
 *
 * Held on globalThis so every route handler in the server process shares
 * one counter (Next can load this module more than once).
 */
const LIVE_KEY = "__biomeDataVersion";
export function bumpDataVersion(): void {
  (globalThis as any)[LIVE_KEY] = Date.now();
}
export function dataVersion(): number {
  const g = globalThis as any;
  if (!g[LIVE_KEY]) g[LIVE_KEY] = Date.now();
  return g[LIVE_KEY];
}

/**
 * Guard against path traversal: resolve `child` inside `parent` and
 * refuse anything that escapes. Used everywhere a user-supplied name
 * (a vendor code, a KYC filename) becomes part of a path.
 */
export function safeJoin(parent: string, ...segments: string[]): string {
  const resolvedParent = path.resolve(parent);
  const target = path.resolve(resolvedParent, ...segments);
  if (target !== resolvedParent && !target.startsWith(resolvedParent + path.sep)) {
    throw new Error("Refusing to access a path outside the allowed folder.");
  }
  return target;
}

/** Strip characters Windows and macOS reject in a file or folder name. */
export function sanitizeSegment(raw: string, fallback = "unnamed"): string {
  const cleaned = String(raw || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `${cleaned}_`;
  return cleaned || fallback;
}
