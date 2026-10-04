"use client";

import type { TallyProgressInfo } from "@/lib/tallyPeriod";

/**
 * POST to a Tally route with `stream: true` and read the answer
 * (lib/tallyStream.ts): progress lines while Tally is read piece by piece,
 * then the normal JSON. Also accepts a plain JSON answer (errors raised
 * before reading starts, e.g. sign-in or a bad date).
 */
export async function postTallyStream<T = any>(
  url: string,
  body: Record<string, unknown>,
  opts: { onProgress?: (p: TallyProgressInfo) => void; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; status: number; json: T & Record<string, any> }> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal: opts.signal,
  });
  const type = res.headers.get("content-type") || "";
  if (!type.includes("ndjson") || !res.body) {
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: { status: number; body: any } | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type === "progress") {
      const { type: _t, ...p } = o;
      opts.onProgress?.(p as TallyProgressInfo);
    } else if (o.type === "result") {
      result = { status: o.status, body: o.body };
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  handle(buf);
  if (!result) {
    return { ok: false, status: 502, json: { error: "The connection closed before Tally finished answering. Press Refresh." } as any };
  }
  const r = result as { status: number; body: any };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body };
}
