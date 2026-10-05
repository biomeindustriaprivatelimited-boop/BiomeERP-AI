/**
 * The app logo as PNG bytes for Excel letterheads (server only).
 * The small app icon is used — it is crisp at 54 px and keeps the file
 * light; the large brand logo is the fallback.
 */
import fs from "fs";
import path from "path";

let cached: Buffer | null | undefined;

export function logoPng(): Buffer | null {
  if (cached !== undefined) return cached;
  for (const rel of ["public/icons/icon-192.png", "public/icons/icon-256.png", "public/assets/logo.png"]) {
    try {
      const f = path.join(process.cwd(), rel);
      if (fs.existsSync(f)) { cached = fs.readFileSync(f); return cached; }
    } catch { /* try the next */ }
  }
  cached = null;
  return cached;
}
