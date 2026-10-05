/**
 * Developer-only: start the whole app fresh (server only)
 * -------------------------------------------------------------------
 * While the app is being tested the developer needs a way back to "just
 * installed": no users, no partners, no sheets, no imprest, no WhatsApp
 * files — for everyone, on every PC and phone.
 *
 * What it does, in this order (the route enforces the checks first):
 *   1. a full verified backup (lib/backupEngine.runBackup) — no backup,
 *      no reset;
 *   2. deletes everything in the data folder EXCEPT
 *        backups/                      always (the safety copy lives there)
 *        company profile files         if "keep company profile" is ticked
 *        settings & connections        if "keep settings" is ticked
 *   3. re-creates the first-run developer account
 *      (developer / biome-admin, must change the password);
 *   4. keeps this PC as the server (the new developer account owns it);
 *   5. ends every session issued before now, so every other PC and phone
 *      goes back to the sign-in page.
 *
 * This is different from lib/dataWipe.ts, which clears chosen business
 * modules and never touches the logins.
 */
import fs from "fs";
import path from "path";
import { paths, bumpDataVersion } from "@/lib/dataRoot";

export const RESET_PHRASE = "RESET BIOME";

/** The company's own set-up: plants, organisation masters, holiday calendar, attendance rules. */
export const COMPANY_PROFILE_FILES = [
  "config/organisation.json",
  "config/plants.json",
  "config/holidays.json",
  "config/attendance-rules.json",
];

/**
 * Settings and connections. Several of these hold secrets that a backup
 * deliberately does not contain (mail password, Drive and cloud keys, the
 * WhatsApp link) — wiping them means entering them again.
 */
export const SETTINGS_FILES = [
  "config/mail.json",
  "config/gdrive.json",
  "config/google-oauth.json",
  "config/drive-mirror.json",
  "config/cloud-credentials.json",
  "config/cloud-service-account.json",
  "config/ai-keys.json",
  "config/backup-schedule.json",
  "config/whatsapp-settings.json",
  "config/features.json",
  "config/number-series.json",
  "whatsapp/auth",
];

/** Never deleted. */
export const ALWAYS_KEPT = ["backups"];

export interface ResetOptions {
  keepCompanyProfile: boolean;
  keepSettings: boolean;
}

export function keptPaths(o: ResetOptions): string[] {
  return [
    ...ALWAYS_KEPT,
    ...(o.keepCompanyProfile ? COMPANY_PROFILE_FILES : []),
    ...(o.keepSettings ? SETTINGS_FILES : []),
  ];
}

function count(p: string): { files: number; bytes: number } {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return { files: 1, bytes: st.size };
    let files = 0, bytes = 0;
    for (const e of fs.readdirSync(p)) {
      const c = count(path.join(p, e));
      files += c.files; bytes += c.bytes;
    }
    return { files, bytes };
  } catch { return { files: 0, bytes: 0 }; }
}

/**
 * Walks the data root and calls `onDelete` for every entry that is neither
 * kept nor the parent of something kept. Folders that only partly survive
 * are walked into; everything else goes whole.
 */
function walk(root: string, kept: string[], onDelete: (rel: string, full: string) => void, rel = ""): void {
  const dir = rel ? path.join(root, rel) : root;
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const r = rel ? `${rel}/${name}` : name;
    if (kept.includes(r)) continue;
    if (kept.some((k) => k.startsWith(r + "/"))) {
      let isDir = false;
      try { isDir = fs.statSync(path.join(root, r)).isDirectory(); } catch { /* gone */ }
      if (isDir) { walk(root, kept, onDelete, r); continue; }
    }
    onDelete(r, path.join(root, r));
  }
}

/** What a reset with these options would delete — nothing is changed. */
export function previewReset(o: ResetOptions) {
  const root = path.resolve(paths.root);
  const groups = new Map<string, { files: number; bytes: number }>();
  walk(root, keptPaths(o), (rel, full) => {
    const top = rel.split("/")[0];
    const c = count(full);
    const g = groups.get(top) || { files: 0, bytes: 0 };
    groups.set(top, { files: g.files + c.files, bytes: g.bytes + c.bytes });
  });
  const items = Array.from(groups.entries())
    .map(([folder, c]) => ({ folder, ...c }))
    .sort((a, b) => b.files - a.files);
  const kept = keptPaths(o).filter((k) => fs.existsSync(path.join(root, k)));
  return {
    dataRoot: root,
    items,
    files: items.reduce((n, i) => n + i.files, 0),
    bytes: items.reduce((n, i) => n + i.bytes, 0),
    kept,
  };
}

/** Deletes the data. The caller must have taken the backup already. */
export function performReset(o: ResetOptions): { removed: string[]; files: number } {
  const root = path.resolve(paths.root);
  const removed: string[] = [];
  let files = 0;
  walk(root, keptPaths(o), (rel, full) => {
    const resolved = path.resolve(full);
    if (!resolved.startsWith(root + path.sep)) return; // never outside the data folder
    files += count(resolved).files;
    fs.rmSync(resolved, { recursive: true, force: true });
    removed.push(rel);
  });
  bumpDataVersion();
  return { removed, files };
}
