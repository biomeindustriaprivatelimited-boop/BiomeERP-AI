/**
 * "The PC where the developer is signed in is the server."
 *
 * When the developer signs in AT THE SERVER PC (lib/authToken.ts →
 * isServerPcRequest), that sign-in is recorded here. While it stands, the
 * server is "ready" and every client PC and phone may sign in and work.
 * When the developer signs out there, the server stops serving clients:
 * their sign-in and every API call answer "the server PC is not ready".
 *
 * Server only (fs).
 */
import path from "path";
import fs from "fs";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

interface Owner {
  uid: string;
  username: string;
  since: string;
}

function file() {
  return path.join(paths.configDir, "server-owner.json");
}

let cache: { at: number; value: boolean } | null = null;

export function setServerOwner(uid: string, username: string): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { uid, username, since: new Date().toISOString() });
  cache = null;
}

export function clearServerOwner(uid?: string): void {
  const cur = readJson<Owner | null>(file(), null);
  if (!cur) return;
  if (uid && cur.uid !== uid) return;
  try { fs.unlinkSync(file()); } catch { /* already gone */ }
  cache = null;
}

/** True while a still-active developer account is signed in on the server PC. */
export function serverReady(): boolean {
  if (cache && Date.now() - cache.at < 3000) return cache.value;
  const cur = readJson<Owner | null>(file(), null);
  let ok = false;
  if (cur && cur.uid) {
    // Read directly (not via lib/authServer, which imports this file).
    const users = readJson<{ users?: any[] }>(path.join(paths.configDir, "users.json"), { users: [] }).users || [];
    const u = users.find((x) => x && x.id === cur.uid);
    ok = Boolean(u && u.active && !u.deleted && u.role === "developer");
  }
  cache = { at: Date.now(), value: ok };
  return ok;
}

export const SERVER_NOT_READY_MESSAGE =
  "The server PC is not ready — the developer is not signed in there. Ask the developer to sign in on the server PC, then try again.";

/** When the developer last signed in on THIS server (ISO), or null. */
export function ownerSince(): string | null {
  const cur = readJson<Owner | null>(file(), null);
  return cur && cur.since ? cur.since : null;
}

/**
 * A server with real company data — more than the first-run account.
 * A freshly installed, empty server must never take the clients over from
 * the real one, even if someone signs in there as the developer.
 */
export function serverEstablished(): boolean {
  const users = readJson<{ users?: any[] }>(path.join(paths.configDir, "users.json"), { users: [] }).users || [];
  return users.filter((u) => u && !u.deleted).length > 1;
}
