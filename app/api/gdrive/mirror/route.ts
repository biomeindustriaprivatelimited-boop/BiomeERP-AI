import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { mirrorDocuments, loadMirror } from "@/lib/gdriveMirror";
import { loadDrive, saveDrive } from "@/lib/gdrive";

/** Mirror the WhatsApp document tree to Google Drive (same folders). */
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings"); if ("response" in auth) return auth.response;
  const s = loadMirror(); const cfg: any = loadDrive();
  return NextResponse.json({ lastRunAt: s.lastRunAt, lastResult: s.lastResult, files: Object.keys(s.files).length, auto: Boolean(cfg.mirrorAuto) });
}
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!; const body = await req.json().catch(() => ({}));
  if (body.action === "auto") { const cfg: any = loadDrive(); saveDrive({ ...cfg, mirrorAuto: Boolean(body.enabled) } as any); return NextResponse.json({ auto: Boolean(body.enabled) }); }
  try {
    const r = await mirrorDocuments();
    recordAudit({ action: "gdrive.mirror", userId: user.id, userName: user.name, role: user.role, detail: `${r.uploaded} uploaded, ${r.failed} failed` });
    return NextResponse.json(r);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
