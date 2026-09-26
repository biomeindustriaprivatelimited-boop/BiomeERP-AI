import path from "path";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requirePermission } from "@/lib/authServer";
import { paths } from "@/lib/dataRoot";
import { collectFiles, backupFileName } from "@/lib/backup";
import { loadDrive, saveDrive, accessToken, ensureFolder, uploadToDrive } from "@/lib/gdrive";

/**
 * "Back up to Drive" — the SAME file set the local backup takes, zipped
 * the same way, uploaded to the connected account's Biome folder. One
 * definition of "a backup", two destinations.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  try {
    const token = await accessToken();
    const folderId = await ensureFolder(token);

    const zip = new JSZip();
    const files = collectFiles();
    for (const rel of files) {
      const abs = path.join(paths.root, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        zip.file(rel.split(path.sep).join("/"), fs.readFileSync(abs));
      }
    }
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const name = `drive-${backupFileName()}`;
    await uploadToDrive(token, folderId, name, buffer);

    const cfg = loadDrive();
    saveDrive({ ...cfg, lastBackupAt: new Date().toISOString(), lastBackupName: name });

    return NextResponse.json({ ok: true, name, files: files.length, size: buffer.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
