import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/authToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signs THIS browser out. It deliberately does NOT take the server offline:
 * the server PC stays the server (and every client keeps working) after the
 * developer signs out there. It only stops being the server when the
 * developer signs in on another server PC that holds the company data
 * (electron/main.js → stepAsideIfNotTheServer).
 *
 * The "known on this PC" cookie (biome_known) stays, so the person can come
 * back with their MPIN on this PC.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set("biome_lock", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
