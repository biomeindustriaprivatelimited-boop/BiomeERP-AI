import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSession } from "@/lib/authServer";
import { dataVersion, paths } from "@/lib/dataRoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The live-sync heartbeat. Returns one number; clients reload when it moves.
 *
 * Two sources: every save the app makes (dataVersion), and the WhatsApp
 * agent, which is a separate process writing its own log — so its file's
 * modified time is folded in too. Cheap on purpose: a phone polls this
 * every few seconds, so it must never read a data file's contents.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let v = dataVersion();
  try {
    const log = path.join(paths.root, "whatsapp", "db", "documents.jsonl");
    const st = fs.statSync(log);
    v = Math.max(v, Math.floor(st.mtimeMs));
  } catch { /* the agent has not written anything yet */ }

  return NextResponse.json({ v }, { headers: { "Cache-Control": "no-store" } });
}
