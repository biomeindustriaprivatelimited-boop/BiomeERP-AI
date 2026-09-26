/**
 * Biome Platform — backup and restore
 * -------------------------------------------------------------------
 * Everything this business runs on is JSON files and documents under one
 * data folder. That is a perfectly good design for a single server, and it
 * has exactly one weakness: the folder is one bad disk, one deleted
 * directory or one hurried "reinstall" away from being gone.
 *
 * A backup is a single zip of that folder. Nothing clever.
 *
 * THREE DECISIONS WORTH KNOWING ABOUT:
 *
 * 1. **The WhatsApp login is never backed up.** `whatsapp/auth` is the
 *    linked account itself — anyone holding those files can read the
 *    company's WhatsApp. A copy of it sitting in a zip on a pen drive, or
 *    in someone's Drive, is a far bigger risk than re-scanning a QR code.
 *    Same for the cloud refresh token and the mail password.
 *
 * 2. **Restore NEVER overwrites in place.** The current folder is moved
 *    aside first, and its new location is reported. A restore that half
 *    finished over a live folder would leave a mixture of two months, and
 *    nobody would be able to tell which rows came from which.
 *
 * 3. **A backup is verified after it is written**, by reading the zip back
 *    and counting its entries. A backup nobody has opened is a guess, and
 *    the day you find out is the day you needed it.
 */

import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

/** Folders and files a backup must never contain. */
const NEVER_BACKUP: string[] = [
  "whatsapp/auth",        // the WhatsApp login itself
  "runtime",              // agent port + one-time token, meaningless elsewhere
  "backups",              // never put backups inside backups
  "node_modules",
  ".git",
];

/** Files that hold a secret at rest and are excluded from the zip. */
const SENSITIVE_FILES: string[] = [
  "config/cloud-credentials.json",
  "config/cloud-service-account.json",
  "config/mail.json",
];

export interface BackupEntry {
  /** File name inside the backups folder. */
  file: string;
  createdAt: string;
  createdBy: string;
  sizeBytes: number;
  fileCount: number;
  note: string;
  /** What was deliberately left out, so a restore is not a surprise. */
  excluded: string[];
  /** Set when the zip was read back successfully after writing. */
  verifiedAt: string;
}

interface BackupIndex { backups: BackupEntry[]; updatedAt?: string; }

export function backupsDir(): string {
  return path.join(paths.root, "backups");
}

function indexFile(): string {
  return path.join(backupsDir(), "index.json");
}

export function loadBackups(): BackupEntry[] {
  const f = readJson<BackupIndex>(indexFile(), { backups: [] });
  const list = Array.isArray(f.backups) ? f.backups : [];
  // Only report what is actually on disk. An index row for a zip somebody
  // deleted by hand is worse than no row — it says a backup exists.
  return list.filter((b) => fs.existsSync(path.join(backupsDir(), b.file)));
}

export function saveBackups(backups: BackupEntry[]): void {
  ensureDir(backupsDir());
  writeJsonAtomic(indexFile(), { backups, updatedAt: new Date().toISOString() });
}

/** Should this path go into the backup? */
export function isBackable(relative: string): boolean {
  const rel = relative.split(path.sep).join("/");
  if (NEVER_BACKUP.some((p) => rel === p || rel.startsWith(p + "/"))) return false;
  if (SENSITIVE_FILES.includes(rel)) return false;
  return true;
}

/** Everything that would go in, as paths relative to the data root. */
export function collectFiles(root: string = paths.root): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable folder must not abort the whole backup
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (!isBackable(rel)) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `biome-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

/**
 * What a restore is about to do, in words, before it does it.
 *
 * Returned to the screen and shown as a confirmation. "Restore" is the one
 * button in this app that can lose a month of work, and the person
 * pressing it should have read a sentence naming the folder that is about
 * to be moved aside.
 */
export function describeRestore(entry: BackupEntry, movedTo: string): string[] {
  return [
    `The backup was taken on ${new Date(entry.createdAt).toLocaleString("en-IN")} by ${entry.createdBy}.`,
    `It holds ${entry.fileCount} files.`,
    `Everything in the current data folder will be MOVED to ${movedTo} — not deleted.`,
    "Anything entered since the backup was taken will not be in the restored copy.",
    entry.excluded.length
      ? `The WhatsApp login and stored passwords were never in this backup, so they stay as they are — you will not have to scan the QR code again.`
      : "",
  ].filter(Boolean);
}
