/**
 * Biome Platform — backup engine (server only)
 * -------------------------------------------------------------------
 * The one place a backup is MADE, VERIFIED, COPIED, PRUNED and RESTORED.
 * The Settings screen, the Drive button and the automatic schedule all
 * call into here, so "a backup" means exactly one thing everywhere.
 *
 *   make      zip every backable file under the data root, plus a small
 *             manifest (_biome-backup.json) that says what it is
 *   encrypt   optional — AES-256-GCM with a key derived (scrypt) from a
 *             passphrase the admin sets. A copy on Google Drive or a pen
 *             drive is then useless to whoever finds it.
 *   verify    read the file back, decrypt it, open the zip and count the
 *             entries. A backup nobody has opened is a guess.
 *   copy      the backups folder on the server PC, an optional second
 *             folder (USB / NAS / second disk), and Google Drive
 *   prune     keep the newest N of each kind (daily / weekly / monthly);
 *             manual and uploaded backups are never pruned automatically
 *   restore   unpack into a staging folder first, then swap. The folder
 *             being replaced is kept aside, never deleted.
 *
 * SCHEDULE: runs inside the server process (see instrumentation.ts). Every
 * few minutes it asks "what was the most recent moment a daily / weekly /
 * monthly backup was due, and have we made one since?" — so a server PC
 * that was switched off at 2 a.m. simply takes the backup when it comes
 * back on, instead of silently skipping a day.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { paths, readJson, writeJsonAtomic, ensureDir, bumpDataVersion } from "@/lib/dataRoot";
import {
  loadBackups, saveBackups, backupsDir, collectFiles, humanSize,
  BackupEntry, BackupKind, KEEP_ON_RESTORE,
} from "@/lib/backup";
import { encrypt as sealSecret, decrypt as openSecret } from "@/lib/mailer";
import {
  loadDrive, saveDrive, accessToken, ensureFolder, uploadToDrive,
  listDriveBackups, deleteDriveFile, downloadDriveFile, driveConnected,
} from "@/lib/gdrive";
import { recordAudit } from "@/lib/audit";

export const MANIFEST_NAME = "_biome-backup.json";
const MAGIC = Buffer.from("BIOMEBAK1");

/* ------------------------------------------------------------------ */
/* Schedule settings                                                   */
/* ------------------------------------------------------------------ */

export interface TierSetting {
  enabled: boolean;
  /** How many of this kind to keep. Older ones are deleted. */
  keep: number;
}

export interface BackupSchedule {
  /** Master switch for automatic backups. */
  enabled: boolean;
  /** 24h "HH:MM" in the server's local time. */
  time: string;
  daily: TierSetting;
  weekly: TierSetting & { weekday: number /* 0 = Sunday */ };
  monthly: TierSetting & { day: number /* 1..28 */ };
  /** Upload every automatic backup to Google Drive as well. */
  drive: boolean;
  /** Also copy to this folder (USB, NAS, second disk). Empty = off. */
  extraFolder: string;
  /** Passphrase for encryption, sealed with the server's own key. Empty = not encrypted. */
  passphraseEnc: string;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
  time: "02:00",
  daily: { enabled: true, keep: 7 },
  weekly: { enabled: true, keep: 5, weekday: 0 },
  monthly: { enabled: true, keep: 12, day: 1 },
  drive: false,
  extraFolder: "",
  passphraseEnc: "",
  updatedAt: "",
  updatedBy: "",
};

function scheduleFile() { return path.join(paths.configDir, "backup-schedule.json"); }
function stateFile() { return path.join(paths.root, "backups", "schedule-state.json"); }

export function loadSchedule(): BackupSchedule {
  const raw = readJson<Partial<BackupSchedule>>(scheduleFile(), {});
  const d = DEFAULT_SCHEDULE;
  const clampKeep = (n: any, def: number) => Math.min(365, Math.max(1, Number(n) || def));
  return {
    enabled: raw.enabled === undefined ? d.enabled : Boolean(raw.enabled),
    time: /^\d{2}:\d{2}$/.test(String(raw.time || "")) ? String(raw.time) : d.time,
    daily: { enabled: raw.daily?.enabled ?? d.daily.enabled, keep: clampKeep(raw.daily?.keep, d.daily.keep) },
    weekly: {
      enabled: raw.weekly?.enabled ?? d.weekly.enabled,
      keep: clampKeep(raw.weekly?.keep, d.weekly.keep),
      weekday: Math.min(6, Math.max(0, Number(raw.weekly?.weekday ?? d.weekly.weekday) || 0)),
    },
    monthly: {
      enabled: raw.monthly?.enabled ?? d.monthly.enabled,
      keep: clampKeep(raw.monthly?.keep, d.monthly.keep),
      day: Math.min(28, Math.max(1, Number(raw.monthly?.day ?? d.monthly.day) || 1)),
    },
    drive: Boolean(raw.drive),
    extraFolder: String(raw.extraFolder || ""),
    passphraseEnc: String(raw.passphraseEnc || ""),
    updatedAt: String(raw.updatedAt || ""),
    updatedBy: String(raw.updatedBy || ""),
  };
}

export function saveSchedule(s: BackupSchedule): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(scheduleFile(), s);
}

/** What the screen may see — never the passphrase itself. */
export function publicSchedule(s: BackupSchedule) {
  const { passphraseEnc, ...rest } = s;
  return { ...rest, encrypted: Boolean(passphraseEnc && openSecret(passphraseEnc)) };
}

export function setPassphrase(s: BackupSchedule, passphrase: string): BackupSchedule {
  return { ...s, passphraseEnc: passphrase ? sealSecret(passphrase) : "" };
}

function currentPassphrase(): string {
  const s = loadSchedule();
  return s.passphraseEnc ? openSecret(s.passphraseEnc) : "";
}

export interface RunRecord {
  at: string;
  kind: BackupKind;
  ok: boolean;
  file: string;
  message: string;
}

export interface ScheduleState {
  lastRun: Partial<Record<"daily" | "weekly" | "monthly", string>>;
  history: RunRecord[];
  running: boolean;
}

export function loadState(): ScheduleState {
  const s = readJson<Partial<ScheduleState>>(stateFile(), {});
  return { lastRun: s.lastRun || {}, history: Array.isArray(s.history) ? s.history : [], running: false };
}

function saveState(s: ScheduleState): void {
  ensureDir(backupsDir());
  writeJsonAtomic(stateFile(), { ...s, running: undefined });
}

/* ------------------------------------------------------------------ */
/* Encryption                                                          */
/* ------------------------------------------------------------------ */

export function isEncryptedBuffer(buf: Buffer): boolean {
  return buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(buf: Buffer, passphrase: string): Buffer {
  if (!isEncryptedBuffer(buf)) return buf;
  if (!passphrase) throw new Error("This backup is encrypted. Enter its backup password.");
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  const data = buf.subarray(o);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]);
  } catch {
    throw new Error("Wrong backup password — or the file is damaged. Nothing has been changed.");
  }
}

/* ------------------------------------------------------------------ */
/* Make                                                                */
/* ------------------------------------------------------------------ */

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export function kindFileName(kind: BackupKind, encrypted: boolean, now = new Date()): string {
  return `biome-backup-${kind}-${stamp(now)}.${encrypted ? "biomebak" : "zip"}`;
}

interface Manifest {
  app: "biome-platform";
  format: 1;
  kind: BackupKind;
  createdAt: string;
  createdBy: string;
  fileCount: number;
  dataRootName: string;
  note: string;
}

/** Open a backup (plain or encrypted) and check it really is one of ours. */
export async function openBackup(buf: Buffer, passphrase?: string): Promise<{ zip: JSZip; manifest: Manifest | null; fileCount: number }> {
  const plain = decryptBuffer(buf, passphrase ?? currentPassphrase());
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(plain);
  } catch {
    throw new Error("That file is not a Biome backup (it could not be opened as a zip).");
  }
  const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
  let manifest: Manifest | null = null;
  if (zip.files[MANIFEST_NAME]) {
    try { manifest = JSON.parse(await zip.files[MANIFEST_NAME].async("string")); } catch { manifest = null; }
  }
  // Backups made before the manifest existed are still accepted if they
  // look like a data folder: the user list is the one file every install has.
  if (!manifest && !names.some((n) => n === "config/users.json")) {
    throw new Error("That zip does not look like a Biome backup — it has no config/users.json. Nothing has been changed.");
  }
  return { zip, manifest, fileCount: names.filter((n) => n !== MANIFEST_NAME).length };
}

export interface MakeResult {
  entry: BackupEntry;
  unreadable: string[];
}

export async function makeBackup(opts: { kind: BackupKind; by: string; note?: string }): Promise<MakeResult> {
  const files = collectFiles();
  if (files.length === 0) throw new Error("There is nothing in the data folder to back up.");

  const zip = new JSZip();
  let added = 0;
  const unreadable: string[] = [];
  for (const rel of files) {
    try {
      zip.file(rel.split(path.sep).join("/"), fs.readFileSync(path.join(paths.root, rel)));
      added += 1;
    } catch {
      unreadable.push(rel);
    }
  }
  const now = new Date();
  const manifest: Manifest = {
    app: "biome-platform", format: 1, kind: opts.kind,
    createdAt: now.toISOString(), createdBy: opts.by, fileCount: added,
    dataRootName: path.basename(paths.root), note: opts.note || "",
  };
  zip.file(MANIFEST_NAME, JSON.stringify(manifest, null, 2));

  const plain = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const passphrase = currentPassphrase();
  const encrypted = Boolean(passphrase);
  const out = encrypted ? encryptBuffer(plain, passphrase) : plain;

  ensureDir(backupsDir());
  const name = kindFileName(opts.kind, encrypted, now);
  const target = path.join(backupsDir(), name);
  fs.writeFileSync(target, out);

  // Read back, decrypt, count.
  let verifiedAt = "";
  try {
    const check = await openBackup(fs.readFileSync(target), passphrase);
    if (check.fileCount === added) verifiedAt = new Date().toISOString();
  } catch { verifiedAt = ""; }
  if (!verifiedAt) {
    try { fs.unlinkSync(target); } catch { /* nothing else to do */ }
    throw new Error("The backup was written but could not be read back. It has been deleted rather than left looking like a good backup.");
  }

  const entry: BackupEntry = {
    file: name, kind: opts.kind, encrypted,
    createdAt: now.toISOString(), createdBy: opts.by,
    sizeBytes: out.length, fileCount: added, note: opts.note || "",
    excluded: ["whatsapp/auth", "config/mail.json", "cloud credentials", "runtime"],
    verifiedAt, drive: null,
  };
  saveBackups([entry, ...loadBackups()]);
  return { entry, unreadable };
}

/* ------------------------------------------------------------------ */
/* Copy + prune                                                        */
/* ------------------------------------------------------------------ */

export async function copyToDrive(entry: BackupEntry): Promise<BackupEntry> {
  const token = await accessToken();
  const folderId = await ensureFolder(token);
  const buf = fs.readFileSync(path.join(backupsDir(), entry.file));
  const id = await uploadToDrive(token, folderId, entry.file, buf);
  const cfg = loadDrive();
  saveDrive({ ...cfg, lastBackupAt: new Date().toISOString(), lastBackupName: entry.file });
  const updated: BackupEntry = { ...entry, drive: { fileId: id, uploadedAt: new Date().toISOString() }, driveError: "" };
  saveBackups(loadBackups().map((b) => (b.file === entry.file ? updated : b)));
  return updated;
}

function copyToExtraFolder(entry: BackupEntry, folder: string): string {
  const dir = path.resolve(folder);
  ensureDir(dir);
  const dest = path.join(dir, entry.file);
  fs.copyFileSync(path.join(backupsDir(), entry.file), dest);
  return dest;
}

const AUTO_KINDS = ["daily", "weekly", "monthly"] as const;
type AutoKind = (typeof AUTO_KINDS)[number];

/** Keep the newest N of each automatic kind — locally, in the extra folder, and on Drive. */
export async function prune(schedule: BackupSchedule = loadSchedule()): Promise<string[]> {
  const notes: string[] = [];
  const all = loadBackups();
  const drop: BackupEntry[] = [];
  for (const k of AUTO_KINDS) {
    const keep = schedule[k].keep;
    const mine = all.filter((b) => b.kind === k).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    drop.push(...mine.slice(keep));
  }
  for (const b of drop) {
    try { fs.unlinkSync(path.join(backupsDir(), b.file)); } catch { /* already gone */ }
    if (schedule.extraFolder) {
      try { fs.unlinkSync(path.join(path.resolve(schedule.extraFolder), b.file)); } catch { /* not there */ }
    }
  }
  if (drop.length) {
    const gone = new Set(drop.map((b) => b.file));
    saveBackups(loadBackups().filter((b) => !gone.has(b.file)));
    notes.push(`${drop.length} old backup(s) removed by the keep rule.`);
  }

  if (schedule.drive && driveConnected()) {
    try {
      const token = await accessToken();
      const folderId = await ensureFolder(token);
      const files = await listDriveBackups(token, folderId);
      let removed = 0;
      for (const k of AUTO_KINDS) {
        const mine = files.filter((f) => f.name.startsWith(`biome-backup-${k}-`)).sort((a, b) => b.name.localeCompare(a.name));
        for (const f of mine.slice(schedule[k].keep)) {
          await deleteDriveFile(token, f.id);
          removed += 1;
        }
      }
      if (removed) notes.push(`${removed} old Drive backup(s) removed.`);
    } catch (e) {
      notes.push(`Drive clean-up skipped: ${(e as Error).message}`);
    }
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* One full run: make → copy → prune                                   */
/* ------------------------------------------------------------------ */

export async function runBackup(opts: { kind: BackupKind; by: string; note?: string; drive?: boolean }): Promise<{ entry: BackupEntry; notes: string[]; unreadable: string[] }> {
  const schedule = loadSchedule();
  const { entry: made, unreadable } = await makeBackup(opts);
  let entry = made;
  const notes: string[] = [];

  if (schedule.extraFolder) {
    try {
      const dest = copyToExtraFolder(entry, schedule.extraFolder);
      entry = { ...entry, extraCopy: dest };
      saveBackups(loadBackups().map((b) => (b.file === entry.file ? entry : b)));
      notes.push(`Copied to ${dest}.`);
    } catch (e) {
      notes.push(`Could not copy to ${schedule.extraFolder}: ${(e as Error).message}`);
    }
  }

  const wantDrive = opts.drive ?? schedule.drive;
  if (wantDrive) {
    if (!driveConnected()) {
      notes.push("Google Drive is not connected — the Drive copy was skipped.");
      entry = { ...entry, driveError: "Drive not connected" };
      saveBackups(loadBackups().map((b) => (b.file === entry.file ? entry : b)));
    } else {
      try {
        entry = await copyToDrive(entry);
        notes.push("Uploaded to Google Drive.");
      } catch (e) {
        const msg = (e as Error).message;
        notes.push(`Drive upload failed: ${msg}`);
        entry = { ...entry, driveError: msg };
        saveBackups(loadBackups().map((b) => (b.file === entry.file ? entry : b)));
      }
    }
  }

  notes.push(...(await prune(schedule)));

  recordAudit({
    action: "BACKUP_CREATED",
    userId: "system", userName: opts.by, role: "developer" as any,
    targetType: "backup", targetId: entry.file, targetLabel: entry.file,
    detail: `${opts.kind} · ${entry.fileCount} files, ${humanSize(entry.sizeBytes)}${entry.encrypted ? " · encrypted" : ""}${notes.length ? " · " + notes.join(" ") : ""}`,
    outcome: unreadable.length ? "failed" : "ok",
  });
  return { entry, notes, unreadable };
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

/** The most recent moment each tier was due, at or before `now`. */
export function lastDueSlot(kind: AutoKind, s: BackupSchedule, now = new Date()): Date {
  const [hh, mm] = s.time.split(":").map((n) => Number(n) || 0);
  const at = (d: Date) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x; };
  if (kind === "daily") {
    const today = at(now);
    if (today <= now) return today;
    today.setDate(today.getDate() - 1);
    return today;
  }
  if (kind === "weekly") {
    const d = at(now);
    const back = (d.getDay() - s.weekly.weekday + 7) % 7;
    d.setDate(d.getDate() - back);
    if (d > now) d.setDate(d.getDate() - 7);
    return d;
  }
  const d = at(now);
  d.setDate(s.monthly.day);
  if (d > now) d.setMonth(d.getMonth() - 1);
  return d;
}

export function nextDueSlot(kind: AutoKind, s: BackupSchedule, now = new Date()): Date {
  const last = lastDueSlot(kind, s, now);
  const n = new Date(last);
  if (kind === "daily") n.setDate(n.getDate() + 1);
  else if (kind === "weekly") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
}

/** Which tiers are owed a backup right now. */
export function dueTiers(s: BackupSchedule = loadSchedule(), st: ScheduleState = loadState(), now = new Date()): AutoKind[] {
  if (!s.enabled) return [];
  return AUTO_KINDS.filter((k) => {
    if (!s[k].enabled) return false;
    const last = st.lastRun[k];
    return !last || new Date(last) < lastDueSlot(k, s, now);
  });
}

const RUNNING_KEY = "__biomeBackupRunning";

/**
 * Called by the timer. When several tiers are due together (the 1st of
 * the month is also a day, and maybe a Sunday) ONE backup is taken and
 * labelled with the longest-lived tier, and every due tier is marked done.
 */
export async function runScheduledIfDue(now = new Date()): Promise<RunRecord | null> {
  const g = globalThis as any;
  if (g[RUNNING_KEY]) return null;
  const s = loadSchedule();
  const st = loadState();
  const due = dueTiers(s, st, now);
  if (!due.length) return null;
  g[RUNNING_KEY] = true;
  const kind: AutoKind = due.includes("monthly") ? "monthly" : due.includes("weekly") ? "weekly" : "daily";
  let rec: RunRecord;
  try {
    const r = await runBackup({ kind, by: "Automatic backup", note: `Scheduled ${kind}` });
    rec = { at: new Date().toISOString(), kind, ok: true, file: r.entry.file, message: r.notes.join(" ") || "OK" };
  } catch (e) {
    rec = { at: new Date().toISOString(), kind, ok: false, file: "", message: (e as Error).message };
  } finally {
    g[RUNNING_KEY] = false;
  }
  const fresh = loadState();
  // A failure is NOT marked done — the next tick tries again.
  if (rec.ok) for (const k of due) fresh.lastRun[k] = rec.at;
  fresh.history = [rec, ...fresh.history].slice(0, 60);
  saveState(fresh);
  return rec;
}

/** Start the timer once per server process. */
export function startBackupScheduler(): void {
  const g = globalThis as any;
  if (g.__biomeBackupTimer) return;
  const tick = () => { runScheduledIfDue().catch(() => { /* recorded in history */ }); };
  // First check shortly after start (catch-up after the PC was off), then every 5 minutes.
  g.__biomeBackupTimer = setInterval(tick, 5 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* Bring a backup in from outside                                      */
/* ------------------------------------------------------------------ */

/** Save a backup file that came from an upload or from Drive into the local list. */
export async function importBackupFile(buf: Buffer, originalName: string, kind: BackupKind, by: string, passphrase?: string): Promise<BackupEntry> {
  const opened = await openBackup(buf, passphrase);
  const encrypted = isEncryptedBuffer(buf);
  ensureDir(backupsDir());
  const base = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.(zip|biomebak)$/i, "").slice(0, 80) || "backup";
  let name = `${base}.${encrypted ? "biomebak" : "zip"}`;
  if (fs.existsSync(path.join(backupsDir(), name))) name = `${base}-${kind}-${Date.now()}.${encrypted ? "biomebak" : "zip"}`;
  fs.writeFileSync(path.join(backupsDir(), name), buf);
  const entry: BackupEntry = {
    file: name, kind, encrypted,
    createdAt: opened.manifest?.createdAt || new Date().toISOString(),
    createdBy: opened.manifest?.createdBy || by,
    sizeBytes: buf.length, fileCount: opened.fileCount,
    note: `${kind === "drive" ? "Downloaded from Google Drive" : "Uploaded"} by ${by}${opened.manifest?.note ? ` · ${opened.manifest.note}` : ""}`,
    excluded: ["whatsapp/auth", "config/mail.json", "cloud credentials", "runtime"],
    verifiedAt: new Date().toISOString(), drive: null,
  };
  saveBackups([entry, ...loadBackups().filter((b) => b.file !== name)]);
  return entry;
}

export async function fetchFromDrive(fileId: string, by: string, passphrase?: string): Promise<BackupEntry> {
  const token = await accessToken();
  const folderId = await ensureFolder(token);
  const list = await listDriveBackups(token, folderId);
  const hit = list.find((f) => f.id === fileId);
  if (!hit) throw new Error("That file is not in the app's Drive backup folder.");
  const local = loadBackups().find((b) => b.file === hit.name);
  if (local) return local;
  const buf = await downloadDriveFile(token, fileId);
  return importBackupFile(buf, hit.name, "drive", by, passphrase);
}

export async function driveBackupList() {
  if (!driveConnected()) return { connected: false, files: [] as any[] };
  const token = await accessToken();
  const folderId = await ensureFolder(token);
  const files = await listDriveBackups(token, folderId);
  const local = new Set(loadBackups().map((b) => b.file));
  return { connected: true, account: loadDrive().accountEmail, files: files.map((f) => ({ ...f, onThisServer: local.has(f.name) })) };
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

/**
 * Restore a backup that is already in the local list.
 *
 * Unpacks to a staging folder, carries across the things a backup never
 * holds (WhatsApp login, passwords, Drive link, schedule, the backups
 * folder itself), then swaps. If the live folder cannot be renamed —
 * Windows refuses while another process has a file open — it falls back
 * to copy-aside + replace-contents, which is slower but works.
 */
export async function restoreBackup(entry: BackupEntry, passphrase?: string): Promise<{ movedTo: string; files: number }> {
  const buf = fs.readFileSync(path.join(backupsDir(), entry.file));
  const { zip } = await openBackup(buf, passphrase);

  const parent = path.dirname(paths.root);
  const staging = path.join(parent, `biome-data-restoring-${Date.now()}`);
  const movedTo = path.join(parent, `biome-data-replaced-${Date.now()}`);
  let count = 0;
  try {
    ensureDir(staging);
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || name === MANIFEST_NAME) continue;
      const safe = path.resolve(staging, name);
      if (!safe.startsWith(path.resolve(staging) + path.sep)) continue; // ../ in a zip entry
      ensureDir(path.dirname(safe));
      fs.writeFileSync(safe, Buffer.from(await zip.files[name].async("nodebuffer")));
      count += 1;
    }
    for (const keep of KEEP_ON_RESTORE) {
      const from = path.join(paths.root, keep);
      if (!fs.existsSync(from)) continue;
      const to = path.join(staging, keep);
      ensureDir(path.dirname(to));
      fs.cpSync(from, to, { recursive: true });
    }
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    throw new Error(`The restore stopped before anything was swapped: ${(err as Error).message}. Your data folder is untouched.`);
  }

  try {
    fs.renameSync(paths.root, movedTo);
    fs.renameSync(staging, paths.root);
  } catch {
    // Fallback: keep a full copy aside, then replace the contents in place.
    fs.cpSync(paths.root, movedTo, { recursive: true });
    for (const e of fs.readdirSync(paths.root)) {
      fs.rmSync(path.join(paths.root, e), { recursive: true, force: true });
    }
    fs.cpSync(staging, paths.root, { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
  bumpDataVersion();
  return { movedTo, files: count };
}
