import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { runBackup } from "@/lib/backupEngine";

/**
 * "Back up to Drive" — the SAME backup the local button and the schedule
 * make (same file set, same manifest, encrypted when a backup password is
 * set), kept on the server AND uploaded to the connected Drive folder.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  try {
    const r = await runBackup({ kind: "manual", by: user.name, note: "Back up to Drive", drive: true });
    if (!r.entry.drive) {
      return NextResponse.json({ error: r.notes.join(" ") || "The Drive upload did not complete." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, name: r.entry.file, files: r.entry.fileCount, size: r.entry.sizeBytes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
