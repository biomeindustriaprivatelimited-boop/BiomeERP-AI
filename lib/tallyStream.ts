/**
 * Biome Platform — progress for long Tally reads
 * -------------------------------------------------------------------
 * A route that reads Tally in several pieces (a multi-year period) can
 * answer in two ways:
 *   - plain JSON (default; what scripts and the AI assistant use);
 *   - with `stream: true` in the request body: newline-delimited JSON,
 *       {"type":"progress","phase":"balances","done":2,"total":5,"label":"…"}
 *       …
 *       {"type":"result","status":200,"body":{…the normal JSON…}}
 *     so the screen can show a progress bar. The HTTP status is 200 and the
 *     real status is in the last line.
 * lib/tallyClient.ts reads either form.
 */
import { NextResponse } from "next/server";
import type { ProgressFn, TallyProgress } from "./tallyFinance";

export type TallyRouteResult = { status: number; body: Record<string, any> };

export async function respondWithProgress(
  stream: boolean,
  run: (progress: ProgressFn) => Promise<TallyRouteResult>
): Promise<Response> {
  if (!stream) {
    const r = await run(() => {});
    return NextResponse.json(r.body, { status: r.status });
  }
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const r = await run((p: TallyProgress) => send({ type: "progress", ...p }));
        send({ type: "result", status: r.status, body: r.body });
      } catch (err: any) {
        send({ type: "result", status: 500, body: { error: err?.message || "Reading Tally failed.", code: "internal" } });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
