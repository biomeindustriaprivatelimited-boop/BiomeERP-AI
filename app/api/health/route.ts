import { NextResponse } from "next/server";

/**
 * The server's heartbeat.
 *
 * Every PC and phone using the app polls this. If the answer stops coming
 * — the server PC is off, the app there isn't running, the network is down
 * — every client blocks itself behind a full-screen "server offline"
 * notice rather than letting people type into a void.
 *
 * Deliberately unauthenticated: a client that has lost its session still
 * needs to know whether the server exists at all, because "sign in again"
 * and "the server is off" are different problems with different fixes.
 * Nothing sensitive is returned — a timestamp proves liveness by itself.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    { ok: true, time: new Date().toISOString(), startedAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
