import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, ensureDir } from "@/lib/dataRoot";
import { resolvePlantScope } from "@/lib/plantScope";
import { allSlugs } from "@/lib/plantRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attachments on a plant sheet row — weight slips, mostly.
 *
 * The grid used to record `e.target.files[0].name` into the cell and nothing
 * else. The filename went in, the file went nowhere, and clicking it later
 * did nothing because there was nothing to open. This route is the missing
 * half: the bytes are stored, and the cell holds a reference that can be
 * opened again.
 *
 * Cell format: `<id>::<original name>` — the id addresses the file, the name
 * is what the person sees. Anything without `::` is treated as a legacy
 * name-only value and shown as plain text, so old sheets still read.
 */

const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
]);
const MAX_BYTES = 15 * 1024 * 1024;

function uploadDir(plant: string) {
  return path.join(paths.root, "plants", plant, "uploads");
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  // Scoped: an upload lands in the caller's own plant folder, whatever the
  // form says, so one plant's slips can never be filed under the other.
  const scoped = await resolvePlantScope(req, String(form.get("plant") || ""));
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Weight slips can be photos (JPG, PNG, WEBP) or PDF." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is over 15 MB. Photograph the slip rather than scanning it at full size." },
      { status: 400 }
    );
  }

  // The stored name is generated. A browser-supplied name can contain path
  // separators and walk out of the folder.
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const id = crypto.randomUUID();
  const dir = uploadDir(plant);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${id}.${ext || "bin"}`), Buffer.from(await file.arrayBuffer()));

  // The index maps an id to its real filename and type, so the GET below
  // never has to trust anything from the caller.
  const indexFile = path.join(dir, "index.json");
  let index: Record<string, { file: string; name: string; type: string; at: string; by: string }> = {};
  try {
    if (fs.existsSync(indexFile)) index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch {
    // A corrupt index must not block an upload — it is rebuilt from this write on.
  }
  index[id] = {
    file: `${id}.${ext || "bin"}`,
    name: file.name.slice(0, 180),
    type: file.type,
    at: new Date().toISOString(),
    by: scoped.scope.userName,
  };
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf8");

  return NextResponse.json({ id, name: file.name, ref: `${id}::${file.name}` }, { status: 201 });
}

/** Open a stored slip. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
  if ("response" in scoped) return scoped.response;

  // A field role can only open slips from their own plant. An office role
  // may be looking at either, so both folders are searched for them.
  const folders = scoped.scope.unrestricted
    ? allSlugs()
    : [scoped.scope.slug];

  for (const plant of folders) {
    const dir = uploadDir(plant);
    const indexFile = path.join(dir, "index.json");
    if (!fs.existsSync(indexFile)) continue;
    let index: Record<string, { file: string; name: string; type: string }>;
    try {
      index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    } catch {
      continue;
    }
    const entry = index[id];
    if (!entry) continue;

    const full = path.resolve(dir, entry.file);
    if (!full.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(full)) continue;

    const data = fs.readFileSync(full);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": entry.type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${entry.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=600",
      },
    });
  }

  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
