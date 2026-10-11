import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, requirePermission } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { ensureDir } from "@/lib/dataRoot";
import { DEFAULT_DIRECTORS, teamPhotoDir, directorPhotoPath, updateDirector, loadDirectors } from "@/lib/companyProfile";

/**
 * Director photos uploaded in the app.
 *
 * Saved under <data root>/company/team (so a backup carries them and a
 * new release does not overwrite them), served here to any signed-in
 * user, and shown with a version in the URL that changes on every upload
 * — the old photo cannot stick in a cache. DELETE goes back to the photo
 * shipped with the app.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const user = session ? findById(session.uid) : undefined;
  if (!user || !user.active) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const found = directorPhotoPath(id);
  if (!found) return NextResponse.json({ error: "No uploaded photo." }, { status: 404 });
  const buf = fs.readFileSync(found.file);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": found.mime,
      // The URL carries ?v=<upload time>, so a long cache is safe.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "company.edit");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const fd = await req.formData().catch(() => null);
  const id = String(fd?.get("id") || "");
  const file = fd?.get("file");
  if (!DEFAULT_DIRECTORS.some((d) => d.id === id)) return NextResponse.json({ error: "Which director?" }, { status: 400 });
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
  const ext = ALLOWED[(file as File).type];
  if (!ext) return NextResponse.json({ error: "Use a JPG, PNG or WebP photo." }, { status: 400 });
  if ((file as File).size > 8 * 1024 * 1024) return NextResponse.json({ error: "The photo is over 8 MB." }, { status: 400 });

  const dir = ensureDir(teamPhotoDir());
  const now = new Date().toISOString();
  const name = `${id}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await (file as File).arrayBuffer()));
  // Remove older uploads of the same director.
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${id}-`) && f !== name) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* keep going */ } }
  updateDirector(id, { photoFile: name, photoUpdatedAt: now });
  recordAudit({
    action: "COMPANY_DIRECTOR_PHOTO", userId: user.id, userName: user.name, role: user.role,
    targetType: "company", targetId: id, targetLabel: id, detail: "Director photo uploaded",
  });
  return NextResponse.json({ ok: true, directors: loadDirectors().map(({ photoFile, ...d }) => d) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "company.edit");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!DEFAULT_DIRECTORS.some((d) => d.id === id)) return NextResponse.json({ error: "Which director?" }, { status: 400 });
  const found = directorPhotoPath(id);
  if (found) { try { fs.unlinkSync(found.file); } catch { /* gone */ } }
  updateDirector(id, { photoFile: "", photoUpdatedAt: "" });
  recordAudit({
    action: "COMPANY_DIRECTOR_PHOTO", userId: user.id, userName: user.name, role: user.role,
    targetType: "company", targetId: id, targetLabel: id, detail: "Director photo reset to the bundled one",
  });
  return NextResponse.json({ ok: true, directors: loadDirectors().map(({ photoFile, ...d }) => d) });
}
