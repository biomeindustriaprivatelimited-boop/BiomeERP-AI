/**
 * "Everybody sign in again" — one timestamp (server only).
 * -------------------------------------------------------------------
 * Sessions are signed tokens, so there is no session list to clear. The
 * fresh-start reset (Developer → Data → Start fresh) instead records the
 * moment it ran, and lib/authServer.getSession refuses every token issued
 * before that moment. Every PC and phone falls back to the sign-in page
 * on its next request (the device heartbeat sends it there within a
 * minute, even if nobody touches the screen).
 *
 * Kept in config/session-epoch.json; read at most every few seconds.
 */
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

function file() {
  return path.join(paths.configDir, "session-epoch.json");
}

let cache: { at: number; root: string; value: number } | null = null;

/** Seconds since epoch; tokens issued (iat) before this are refused. 0 = none. */
export function sessionsValidAfter(): number {
  const root = paths.root;
  if (cache && cache.root === root && Date.now() - cache.at < 3000) return cache.value;
  const f = readJson<{ validAfter?: number }>(file(), {});
  const value = typeof f.validAfter === "number" && Number.isFinite(f.validAfter) ? f.validAfter : 0;
  cache = { at: Date.now(), root, value };
  return value;
}

/** Ends every session issued up to now. Returns the new cut-off (seconds). */
export function endAllSessions(reason: string): number {
  // A token issued in this same second (the developer's new one, signed
  // right after) must survive, so the cut-off is "before this second".
  const validAfter = Math.floor(Date.now() / 1000);
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { validAfter, reason, at: new Date().toISOString() });
  cache = null;
  return validAfter;
}
