/**
 * MPIN — an 8-digit PIN for signing back in on a PC (or phone) the person
 * has already signed in on with their password.
 *
 *  - Set from Security (needs the account password). Stored only as an
 *    scrypt hash on the user record.
 *  - Works ONLY on a device that remembers the person: a signed, httpOnly
 *    "biome_known" cookie written at a password sign-in. A new PC always
 *    needs the user ID and password.
 *  - Five wrong MPINs in a row block MPIN for that account until the next
 *    password sign-in.
 *  - Changing or removing the MPIN, or changing the password, bumps
 *    `mpinVersion`, which retires every remembered device at once.
 *
 * Server only (fs, crypto).
 */
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadUsers, saveUsers, findById, User, accountDisabledResponse } from "@/lib/authServer";
import { signToken, verifyToken } from "@/lib/authToken";

export const KNOWN_COOKIE = "biome_known";
export const LOCK_COOKIE = "biome_lock";
const KNOWN_MAX = 5;
const KNOWN_TTL_SECONDS = 180 * 24 * 60 * 60;
export const MPIN_MAX_FAILS = 5;

export interface MpinFields {
  mpinSalt?: string;
  mpinHash?: string;
  mpinVersion?: number;
  mpinFails?: number;
  mpinBlocked?: boolean;
  /** Minutes of no activity before the app locks itself (0 = never). */
  autoLockMinutes?: number;
}

type U = User & MpinFields;

const WEAK = new Set(["12345678", "87654321", "11223344", "12341234", "01234567", "98765432"]);

export function mpinProblem(mpin: string): string | null {
  if (!/^\d{8}$/.test(mpin)) return "The MPIN must be exactly 8 digits.";
  if (/^(\d)\1{7}$/.test(mpin) || WEAK.has(mpin)) return "That MPIN is too easy to guess — choose another.";
  return null;
}

function hash(mpin: string, salt: string): string {
  return crypto.scryptSync(mpin, salt, 32).toString("hex");
}

function update(uid: string, patch: (u: U) => U): U | null {
  const users = loadUsers() as U[];
  const i = users.findIndex((u) => u.id === uid);
  if (i === -1) return null;
  users[i] = { ...patch(users[i]), updatedAt: new Date().toISOString() };
  saveUsers(users as User[]);
  return users[i];
}

export function hasMpin(u: U | undefined | null): boolean {
  return Boolean(u && u.mpinHash && u.mpinSalt);
}

export function setMpin(uid: string, mpin: string): U | null {
  const salt = crypto.randomBytes(16).toString("hex");
  return update(uid, (u) => ({
    ...u, mpinSalt: salt, mpinHash: hash(mpin, salt),
    mpinVersion: (u.mpinVersion || 0) + 1, mpinFails: 0, mpinBlocked: false,
  }));
}

export function clearMpin(uid: string): U | null {
  return update(uid, (u) => {
    const { mpinSalt, mpinHash, ...rest } = u;
    void mpinSalt; void mpinHash;
    return { ...rest, mpinVersion: (u.mpinVersion || 0) + 1, mpinFails: 0, mpinBlocked: false } as U;
  });
}

export function setAutoLock(uid: string, minutes: number): U | null {
  const m = Math.max(0, Math.min(240, Math.round(minutes)));
  return update(uid, (u) => ({ ...u, autoLockMinutes: m }));
}

/** Developer: 5 minutes unless they chose otherwise; everyone else: off unless chosen. */
export function autoLockFor(u: U | undefined | null): number {
  if (!u) return 0;
  if (typeof u.autoLockMinutes === "number") return u.autoLockMinutes;
  return u.role === "developer" ? 5 : 0;
}

/** A password sign-in clears an MPIN block. */
export function resetMpinFails(uid: string): void {
  const u = findById(uid) as U | undefined;
  if (u && (u.mpinFails || u.mpinBlocked)) update(uid, (x) => ({ ...x, mpinFails: 0, mpinBlocked: false }));
}

export type MpinCheck = { ok: true } | { ok: false; blocked: boolean; left: number };

export function checkMpin(uid: string, mpin: string): MpinCheck {
  const u = findById(uid) as U | undefined;
  if (!u || !hasMpin(u)) return { ok: false, blocked: true, left: 0 };
  if (u.mpinBlocked) return { ok: false, blocked: true, left: 0 };
  const a = Buffer.from(hash(String(mpin || ""), u.mpinSalt!), "hex");
  const b = Buffer.from(u.mpinHash!, "hex");
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    if (u.mpinFails) update(uid, (x) => ({ ...x, mpinFails: 0 }));
    return { ok: true };
  }
  const fails = (u.mpinFails || 0) + 1;
  const blocked = fails >= MPIN_MAX_FAILS;
  update(uid, (x) => ({ ...x, mpinFails: fails, mpinBlocked: blocked }));
  return { ok: false, blocked, left: Math.max(0, MPIN_MAX_FAILS - fails) };
}

/* ------------------------------------------------------------------ */
/* Devices that remember a person                                      */
/* ------------------------------------------------------------------ */

interface KnownTok { uid: string; mv: number; iat: number }

async function readKnown(req: NextRequest): Promise<KnownTok[]> {
  const raw = req.cookies.get(KNOWN_COOKIE)?.value || "";
  const out: KnownTok[] = [];
  for (const t of raw.split("~").filter(Boolean).slice(0, KNOWN_MAX)) {
    const p = await verifyToken<KnownTok>(t);
    if (p && p.uid && Date.now() / 1000 - (p.iat || 0) < KNOWN_TTL_SECONDS) out.push(p);
  }
  return out;
}

/** People this device remembers who can sign in with their MPIN here. */
export async function knownMpinUsers(req: NextRequest): Promise<{ uid: string; name: string; username: string; plants: string[] }[]> {
  const out: { uid: string; name: string; username: string; plants: string[] }[] = [];
  for (const k of await readKnown(req)) {
    const u = findById(k.uid) as U | undefined;
    if (!u || !u.active || u.deleted || !hasMpin(u) || u.mpinBlocked) continue;
    if ((u.mpinVersion || 0) !== k.mv) continue;
    out.push({ uid: u.id, name: u.name, username: u.username, plants: u.plants || [] });
  }
  return out;
}

/** Is `uid` remembered on this device with the current MPIN version? */
export async function deviceKnows(req: NextRequest, uid: string): Promise<boolean> {
  const u = findById(uid) as U | undefined;
  if (!u) return false;
  return (await readKnown(req)).some((k) => k.uid === uid && k.mv === (u.mpinVersion || 0));
}

/** Remember `uid` on this device (newest first, at most five people). */
export async function rememberOnDevice(req: NextRequest, res: NextResponse, uid: string): Promise<void> {
  const u = findById(uid) as U | undefined;
  if (!u) return;
  const keep = (await readKnown(req)).filter((k) => k.uid !== uid);
  const fresh: KnownTok = { uid, mv: u.mpinVersion || 0, iat: Math.floor(Date.now() / 1000) };
  const tokens = await Promise.all([fresh, ...keep].slice(0, KNOWN_MAX).map((k) => signToken(k as unknown as Record<string, unknown>)));
  res.cookies.set(KNOWN_COOKIE, tokens.join("~"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: KNOWN_TTL_SECONDS });
}

/**
 * Forget `uid` on this device: drops their entry from the remembered-
 * people cookie (others on the same PC keep theirs). Used when the
 * account is disabled, so the MPIN sign-in for them disappears here.
 */
export async function forgetOnDevice(req: NextRequest, res: NextResponse, uid: string): Promise<void> {
  const keep = (await readKnown(req)).filter((k) => k.uid !== uid);
  if (!keep.length) {
    res.cookies.set(KNOWN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return;
  }
  const tokens = await Promise.all(keep.slice(0, KNOWN_MAX).map((k) => signToken(k as unknown as Record<string, unknown>)));
  res.cookies.set(KNOWN_COOKIE, tokens.join("~"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: KNOWN_TTL_SECONDS });
}

/** ACCOUNT_DISABLED answer that also forgets `uid` on this device. */
export async function disabledResponseFor(req: NextRequest, uid: string | null | undefined): Promise<NextResponse> {
  const res = accountDisabledResponse();
  if (uid) await forgetOnDevice(req, res, uid);
  return res;
}
