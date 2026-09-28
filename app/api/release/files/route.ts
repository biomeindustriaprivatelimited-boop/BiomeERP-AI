import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { currentFile, releaseDir, KIND_EXT, type ReleaseKind } from "@/lib/releaseFiles";

/**
 * GET ?kind=windows|android            download the current file (any signed-in user)
 * GET ?info=1                          what is available
 * POST multipart {kind, file}          upload (release.publish — admin/developer)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const kindOf = (v: unknown): ReleaseKind | null => (v === "windows" || v === "android" ? v : null);

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;
  if (req.nextUrl.searchParams.get("info")) {
    return NextResponse.json({ windows: strip(currentFile("windows")), android: strip(currentFile("android")) });
  }
  const kind = kindOf(req.nextUrl.searchParams.get("kind"));
  const f = kind ? currentFile(kind) : null;
  if (!f) return NextResponse.json({ error: kind === "android" ? "The Android app has not been uploaded yet — ask the developer." : "No installer has been uploaded yet." }, { status: 404 });
  const bytes = fs.readFileSync(f.path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": kind === "android" ? "application/vnd.android.package-archive" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${f.name}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}

function strip(f: ReturnType<typeof currentFile>) { return f ? { name: f.name, size: f.size, uploadedAt: f.uploadedAt } : null; }

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "release.publish");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const form = await req.formData().catch(() => null);
  const kind = kindOf(form?.get("kind"));
  const file = form?.get("file");
  if (!kind || !(file instanceof File)) return NextResponse.json({ error: "Choose the file and whether it is the Windows installer or the Android app." }, { status: 400 });
  if (!KIND_EXT[kind].test(file.name)) return NextResponse.json({ error: kind === "android" ? "The Android app must be an .apk file." : "The Windows installer must be an .exe file." }, { status: 400 });
  const dir = releaseDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  // Keep only the newest: old installers only confuse people.
  for (const old of fs.readdirSync(dir)) fs.rmSync(path.join(dir, old), { force: true });
  const safe = file.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
  fs.writeFileSync(path.join(dir, safe), Buffer.from(await file.arrayBuffer()));
  recordAudit({ action: "RELEASE_FILE_UPLOADED", userId: user.id, userName: user.name, role: user.role, targetType: "release", targetId: kind, targetLabel: safe, detail: `${Math.round(file.size / 1e5) / 10} MB` });
  return NextResponse.json({ ok: true, name: safe, size: file.size });
}
