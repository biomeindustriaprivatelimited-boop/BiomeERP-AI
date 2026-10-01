/**
 * Wrong-password lock, shared by sign-in and developer password recovery.
 *
 * With a static IP the sign-in page is reachable from the whole internet,
 * so a password can be guessed by trying thousands. After MAX_FAILS wrong
 * tries in 15 minutes the key is locked for 15 minutes. In memory: a
 * restart clears it, which is fine for this purpose.
 */
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; first: number; lockedUntil: number }>();

export function lockedFor(key: string): number {
  const f = fails.get(key);
  if (!f) return 0;
  const now = Date.now();
  if (f.lockedUntil > now) return f.lockedUntil - now;
  if (now - f.first > WINDOW_MS) fails.delete(key);
  return 0;
}

export function noteFail(key: string, max = 8): void {
  const now = Date.now();
  let f = fails.get(key);
  if (!f || now - f.first > WINDOW_MS) f = { count: 0, first: now, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= max) f.lockedUntil = now + WINDOW_MS;
  fails.set(key, f);
  if (fails.size > 5000) fails.delete(fails.keys().next().value as string);
}

export function clearLock(key: string): void {
  fails.delete(key);
}
