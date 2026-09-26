/**
 * Biome AI OS — Google Drive document mirror
 * -------------------------------------------------------------------
 * "Documents offline folders me AND online drive me save ho."
 *
 * Mirrors the WhatsApp inbox tree (Month / Client / Date / Reference /
 * files) into the connected Google Drive under "Biome Platform
 * Documents", with the SAME folder structure. Incremental: a file is
 * uploaded once and again only when its size or modified time changes.
 * State lives in config/drive-mirror.json so a restart never re-uploads
 * everything. Offline stays the source of truth; Drive is the copy.
 */

import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { accessToken, loadDrive, saveDrive, uploadToDrive } from "@/lib/gdrive";

interface MirrorState { rootId: string; folders: Record<string, string>; files: Record<string, { id: string; size: number; mtime: number }>; lastRunAt: string | null; lastResult: string | null }
const stateFile = () => path.join(paths.configDir, "drive-mirror.json");
export function loadMirror(): MirrorState { return readJson<MirrorState>(stateFile(), { rootId: "", folders: {}, files: {}, lastRunAt: null, lastResult: null }); }
function saveMirror(s: MirrorState) { ensureDir(path.dirname(stateFile())); writeJsonAtomic(stateFile(), s); }

const SKIP = new Set(["_Duplicate", "_Not A Document", "_Review Queue"]);
const inboxDir = () => path.join(paths.root, "whatsapp", "inbox");

async function findOrCreateFolder(token: string, name: string, parentId: string | null): Promise<string> {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentId ? ` and '${parentId}' in parents` : ""}`);
  const found: any = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => ({}));
  if (found?.files?.[0]?.id) return found.files[0].id;
  const made: any = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }) }).then((r) => r.json());
  if (!made?.id) throw new Error(`Could not create Drive folder "${name}".`);
  return made.id;
}

function walk(dir: string, rel = ""): { rel: string; abs: string; size: number; mtime: number }[] {
  const out: { rel: string; abs: string; size: number; mtime: number }[] = [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(abs, r));
    else if (e.isFile()) { const st = fs.statSync(abs); out.push({ rel: r, abs, size: st.size, mtime: Math.floor(st.mtimeMs) }); }
  }
  return out;
}

export async function mirrorDocuments(opts: { maxFiles?: number } = {}): Promise<{ uploaded: number; skipped: number; failed: number; notes: string[] }> {
  const state = loadMirror();
  const notes: string[] = [];
  const token = await accessToken(); // throws if Drive is not connected
  if (!state.rootId) state.rootId = await findOrCreateFolder(token, "Biome Platform Documents", null);
  const files = walk(inboxDir());
  let uploaded = 0, skipped = 0, failed = 0;
  const limit = opts.maxFiles ?? 150; // per run — keeps a big backlog from hanging one request
  for (const f of files) {
    const prev = state.files[f.rel];
    if (prev && prev.size === f.size && prev.mtime === f.mtime) { skipped += 1; continue; }
    if (uploaded + failed >= limit) { notes.push(`Stopped after ${limit} files this run; the rest continue next run.`); break; }
    try {
      const segs = f.rel.split("/"); const name = segs.pop()!;
      let parent = state.rootId; let acc = "";
      for (const seg of segs) { acc = acc ? `${acc}/${seg}` : seg; if (!state.folders[acc]) state.folders[acc] = await findOrCreateFolder(token, seg, parent); parent = state.folders[acc]; }
      const id = await uploadToDrive(token, parent, name, fs.readFileSync(f.abs));
      state.files[f.rel] = { id, size: f.size, mtime: f.mtime }; uploaded += 1;
      if (uploaded % 10 === 0) saveMirror(state);
    } catch (e) { failed += 1; if (failed <= 3) notes.push(`${f.rel}: ${(e as Error).message}`); }
  }
  state.lastRunAt = new Date().toISOString(); state.lastResult = `${uploaded} uploaded · ${skipped} unchanged · ${failed} failed`;
  saveMirror(state);
  const cfg = loadDrive(); saveDrive({ ...cfg, lastBackupAt: cfg.lastBackupAt }); // touch nothing else
  return { uploaded, skipped, failed, notes };
}
