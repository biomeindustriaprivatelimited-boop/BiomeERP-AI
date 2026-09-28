/**
 * Installers served by the server PC (server only).
 *
 *   windows  the Biome desktop installer (.exe) — what "Install update" gives
 *   android  the Biome Android app (.apk) — the "Android app" button
 *
 * The developer uploads them in Developer → Server & devices. The Android
 * build that ships inside the Windows installer (public/downloads) is the
 * fallback when none has been uploaded.
 */
import fs from "fs";
import path from "path";
import { paths } from "@/lib/dataRoot";

export type ReleaseKind = "windows" | "android";
export const KIND_EXT: Record<ReleaseKind, RegExp> = { windows: /\.(exe|msi|zip)$/i, android: /\.apk$/i };

export function releaseDir(kind: ReleaseKind) { return path.join(paths.root, "releases", kind); }

export function currentFile(kind: ReleaseKind): { name: string; path: string; size: number; uploadedAt: string } | null {
  try {
    const dir = releaseDir(kind);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => KIND_EXT[kind].test(f)) : [];
    const latest = files.map((f) => ({ f, st: fs.statSync(path.join(dir, f)) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
    if (latest) return { name: latest.f, path: path.join(dir, latest.f), size: latest.st.size, uploadedAt: latest.st.mtime.toISOString() };
  } catch { /* fall through */ }
  if (kind === "android") {
    const bundled = path.join(process.cwd(), "public", "downloads", "biome-erp.apk");
    if (fs.existsSync(bundled)) { const st = fs.statSync(bundled); return { name: "biome-erp.apk", path: bundled, size: st.size, uploadedAt: st.mtime.toISOString() }; }
  }
  return null;
}
