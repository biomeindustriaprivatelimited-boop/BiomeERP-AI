/**
 * Biome Platform — session tokens
 * -------------------------------------------------------------------
 * Signed with HMAC-SHA256 via Web Crypto rather than node:crypto, because
 * the middleware that checks every request runs in the Edge sandbox where
 * node:crypto is not available. Web Crypto exists in both runtimes, so
 * one implementation serves the middleware and the API routes.
 *
 * The token carries the user id, role and plant. That is enough for the
 * middleware to authorise a route without reading the users file, which
 * it cannot do from the Edge sandbox anyway. Anything that needs more
 * than that (the user's name, whether they are still active) re-reads the
 * file in a Node route — see lib/authServer.ts.
 */

import type { Role } from "@/lib/permissions";

export const SESSION_COOKIE = "biome_session";

/** Eight hours: a working day, so nobody is logged out mid-shift. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  uid: string;
  username: string;
  name: string;
  role: Role;
  /** Plant this session is working as. Null for office roles. */
  plant: string | null;
  /**
   * The permissions this session was issued with, and the access version
   * they were read at.
   *
   * They travel in the token because the page guard runs on the Edge
   * runtime and cannot read the users file. `av` is what keeps that
   * honest: when the developer changes someone's access the number moves,
   * the token no longer matches, and the next request is refused with
   * "sign in again" instead of being served from a stale list. Access that
   * keeps working for eight hours after being revoked is not revoked.
   */
  perms?: string[];
  av?: number;
  /** Issued-at and expiry, seconds since epoch. */
  iat: number;
  exp: number;
}

/**
 * The signing secret. Electron generates one on first run and passes it
 * in; without it every restart would invalidate all sessions, and worse,
 * a hard-coded fallback shipped to every customer would let anyone forge
 * a token. The fallback below exists only so `next dev` starts, and it
 * announces itself.
 */
function secret(): string {
  const fromEnv = (process.env.BIOME_AUTH_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    // Refusing is safer than silently signing everything with a known
    // string: a broken login is obvious, a forgeable one is not.
    throw new Error(
      "BIOME_AUTH_SECRET is not set. The app cannot sign sessions safely without it."
    );
  }
  return "biome-development-only-secret-do-not-ship";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Base64url → bytes.
 *
 * The return type is deliberately left to inference. TypeScript 5.7 made
 * `Uint8Array` generic over its buffer, so writing `: Uint8Array` here
 * widens it to `Uint8Array<ArrayBufferLike>` — which `crypto.subtle.verify`
 * refuses, because a SharedArrayBuffer cannot be a BufferSource. The
 * project asks for `typescript: ^5.5.4`, so a fresh `npm install` today
 * picks up 5.9 and the build fails on this one line. Allocating an
 * explicit ArrayBuffer and letting the type follow keeps it correct on
 * both old and new compilers.
 */
function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * The developer's session ON THE SERVER PC: one year. The business rule is
 * "the PC where the developer is signed in is the server, and the developer
 * stays signed in there until they sign out by hand". Every other session
 * (every other account, and the developer on any client PC) keeps the
 * eight-hour working-day limit.
 */
export const SERVER_PC_DEVELOPER_TTL_SECONDS = 365 * 24 * 60 * 60;

export async function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(full)));
  const signature = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Proof that a request comes from the Biome desktop window running ON the
 * server PC itself. That window (electron/main.js) adds this value as the
 * `x-biome-server-pc` header to every request it sends to its own local
 * server. It is derived from the installation's signing secret, which never
 * leaves the server PC, so a client PC or phone cannot produce it — a
 * spoofed Host header is not enough.
 */
export const SERVER_PC_HEADER = "x-biome-server-pc";

export async function serverPcToken(): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode("biome-server-pc-v1"));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function isServerPcRequest(headerValue: string | null | undefined): Promise<boolean> {
  if (!headerValue) return false;
  try {
    return headerValue === (await serverPcToken());
  } catch {
    return false;
  }
}

/** Returns the payload, or null for anything malformed, forged or expired. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      base64UrlDecode(signature),
      new TextEncoder().encode(body)
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (!payload || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
