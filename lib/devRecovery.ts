/**
 * Developer password recovery — offline, on the server PC only.
 *
 * The developer answers three security questions on the server PC's own
 * sign-in screen (no internet, no email). Right answers reset the
 * developer's password to the default and force a new one at the next
 * sign-in. If no developer account exists at all (an older install that
 * only ever had "admin"), the same answers create one.
 *
 * Until the developer sets their own questions (Settings → Developer
 * recovery), three built-in questions about the company are used. Answers
 * are compared ignoring case, spaces and punctuation; the developer's own
 * answers are stored only as scrypt hashes.
 *
 * Server only (fs, crypto).
 */
import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadUsers, saveUsers, makeCredentials, SEEDED_ADMIN_PASSWORD, SEEDED_USERNAME, User } from "@/lib/authServer";

interface Stored {
  q1: string;
  q2: string;
  q3: string;
  salt: string;
  h1: string;
  h2: string;
  h3: string;
  updatedAt: string;
}

const BUILT_IN = {
  q1: "What is the company's GSTIN number?",
  a1: "06AAJCB1927H1ZS",
  q2: "What is the name of the company's first plant?",
  a2: ["Mayan"],
  q3: "Full name of either company director?",
  a3: ["Tanesh Singh Dod", "Shubham Goel"],
};

function file() {
  return path.join(paths.configDir, "dev-recovery.json");
}

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hash(answer: string, salt: string): string {
  return crypto.scryptSync(norm(answer), salt, 32).toString("hex");
}

function stored(): Stored | null {
  const s = readJson<Stored | null>(file(), null);
  return s && s.q1 && s.q2 && s.q3 && s.h1 && s.h2 && s.h3 && s.salt ? s : null;
}

export function recoveryQuestions(): { q1: string; q2: string; q3: string; custom: boolean } {
  const s = stored();
  return s
    ? { q1: s.q1, q2: s.q2, q3: s.q3, custom: true }
    : { q1: BUILT_IN.q1, q2: BUILT_IN.q2, q3: BUILT_IN.q3, custom: false };
}

export function setRecoveryQuestions(q1: string, a1: string, q2: string, a2: string, q3: string, a3: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), {
    q1: q1.trim(), q2: q2.trim(), q3: q3.trim(), salt,
    h1: hash(a1, salt), h2: hash(a2, salt), h3: hash(a3, salt), updatedAt: new Date().toISOString(),
  });
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function answersCorrect(a1: string, a2: string, a3: string): boolean {
  const s = stored();
  if (s) return same(hash(a1, s.salt), s.h1) && same(hash(a2, s.salt), s.h2) && same(hash(a3, s.salt), s.h3);
  return (
    norm(a1) === norm(BUILT_IN.a1) &&
    BUILT_IN.a2.some((x) => norm(x) === norm(a2)) &&
    BUILT_IN.a3.some((x) => norm(x) === norm(a3))
  );
}

/**
 * Resets `username` (a developer) to the default password, or creates the
 * developer account when none exists. Returns the username that now works.
 */
export function resetDeveloper(username: string): { ok: true; username: string; created: boolean } | { ok: false; error: string } {
  const wanted = (username || SEEDED_USERNAME).trim().toLowerCase();
  const users = loadUsers();
  const now = new Date().toISOString();
  const { salt, hash: h } = makeCredentials(SEEDED_ADMIN_PASSWORD);
  const idx = users.findIndex((u) => u.username.toLowerCase() === wanted && !u.deleted);

  if (idx !== -1) {
    const u = users[idx];
    if (u.role !== "developer") return { ok: false, error: `"${u.username}" is not a developer account — only the developer password can be reset here.` };
    users[idx] = { ...u, salt, hash: h, active: true, mustChangePassword: true, accessVersion: (u.accessVersion || 0) + 1, updatedAt: now };
    saveUsers(users);
    return { ok: true, username: u.username, created: false };
  }

  const anyDeveloper = users.find((u) => u.role === "developer" && !u.deleted);
  if (anyDeveloper) {
    return { ok: false, error: `No developer account named "${username}". The developer account here is "${anyDeveloper.username}".` };
  }

  const created: User = {
    id: crypto.randomUUID(), username: SEEDED_USERNAME, name: "Developer", role: "developer", plants: [], active: true,
    mustChangePassword: true, salt, hash: h, createdAt: now, updatedAt: now,
  };
  saveUsers([...users, created]);
  return { ok: true, username: SEEDED_USERNAME, created: true };
}

export const DEFAULT_PASSWORD = SEEDED_ADMIN_PASSWORD;
