import { NextRequest, NextResponse } from "next/server";
import { serverReady, ownerSince, serverEstablished } from "@/lib/serverOwner";
import { SERVER_PC_HEADER, isServerPcRequest } from "@/lib/authToken";

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

export async function GET(req: NextRequest) {
  // `id` lets a PC recognise its own server (and not "find" itself through
  // the office static IP); `owned` says whether the developer is signed in
  // on the server PC — without that, clients may not sign in. The server
  // PC itself is never blocked by `owned` (it is where the developer signs in).
  const owned = serverReady();
  const self = await isServerPcRequest(req.headers.get(SERVER_PC_HEADER));
  return NextResponse.json(
    { ok: true, time: new Date().toISOString(), startedAt, id: process.env.BIOME_SERVER_ID || null, owned, ready: owned || self, ownerSince: owned ? ownerSince() : null, established: serverEstablished() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
