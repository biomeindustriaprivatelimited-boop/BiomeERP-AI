/**
 * Biome Platform — cloud storage abstraction (server only)
 * -------------------------------------------------------------------
 * The interface every cloud provider implements. Google Drive is the first
 * and only one today; OneDrive, SharePoint, S3 and Dropbox can be added
 * later without touching a single ERP module, because nothing outside
 * `lib/cloud/` ever imports a provider directly.
 *
 * Two rules this file exists to enforce:
 *
 *   1. **The ERP database stays authoritative.** Drive is a replica and a
 *      backup, never the source of truth for a business record. Deleting a
 *      document must never delete the invoice it belonged to.
 *   2. **Cloud failure must never fail an ERP operation.** Every method
 *      here is called from a queue, off the request path, so a Drive
 *      outage queues work rather than blocking someone's save.
 */

export type ProviderId = "google_drive" | "onedrive" | "sharepoint" | "s3" | "dropbox";

export interface CloudQuota {
  /** Bytes. Null when the provider does not report a limit. */
  total: number | null;
  used: number;
  available: number | null;
  /**
   * True for a personal Google account, where the quota is shared with
   * Gmail and Photos — worth saying on screen, because "15 GB" is not
   * 15 GB of room for documents.
   */
  sharedWithOtherServices: boolean;
}

export interface CloudFileRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  /** Provider-side checksum when one is offered. Drive gives md5 for binaries. */
  checksum: string | null;
  trashed: boolean;
  parentId: string | null;
  webViewLink?: string | null;
}

export interface UploadInput {
  parentId: string;
  name: string;
  mimeType: string;
  /** Absolute path on disk. Streamed, never read wholly into memory. */
  localPath: string;
  size: number;
}

export interface CloudProvider {
  readonly id: ProviderId;
  readonly label: string;

  testConnection(): Promise<{ ok: boolean; account?: string; error?: string }>;
  getStorageQuota(): Promise<CloudQuota>;

  ensureFolder(name: string, parentId?: string | null): Promise<string>;
  createFolder(name: string, parentId?: string | null): Promise<string>;

  uploadFile(input: UploadInput): Promise<CloudFileRef>;
  /** Replaces the CONTENT of an existing file, keeping its id and history. */
  updateFile(fileId: string, localPath: string, mimeType: string, size: number): Promise<CloudFileRef>;

  trashFile(fileId: string): Promise<void>;
  restoreFile(fileId: string): Promise<void>;

  getMetadata(fileId: string): Promise<CloudFileRef | null>;
  listFolder(folderId: string): Promise<CloudFileRef[]>;
  downloadFile(fileId: string, toLocalPath: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Metadata model                                                      */
/* ------------------------------------------------------------------ */

export type SyncStatus =
  | "pending"      // registered, not yet uploaded
  | "syncing"
  | "synced"
  | "failed"
  | "conflict"
  | "remote_deleted"  // gone from the cloud, still here — never auto-deleted
  | "local_deleted";  // deleted here, cloud copy trashed

export interface CloudFileRecord {
  id: string;
  /** Which ERP record this document belongs to, so a delete can be traced. */
  module: string;
  localRecordId: string;
  localPath: string;
  provider: ProviderId;
  cloudFileId: string | null;
  parentCloudFolderId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** SHA-256 of the local bytes — the only reliable change detector. */
  sha256: string;
  /** The hash at the moment of the last successful sync. Drives conflicts. */
  lastSyncedSha256: string | null;
  localModifiedAt: string;
  cloudModifiedAt: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  deletedLocally: boolean;
  deletedRemotely: boolean;
  version: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QueueAction = "upload" | "update" | "trash" | "restore" | "download";

export interface QueueItem {
  id: string;
  fileId: string;
  action: QueueAction;
  priority: number;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  error: string | null;
  status: "queued" | "running" | "done" | "failed";
  createdAt: string;
}

/**
 * Backoff between retries.
 *
 * Google rate-limits, and a tight retry loop against a 403 makes it worse
 * rather than better. After the last step the item stops on its own and
 * waits for an admin, because something retrying silently for a week is
 * indistinguishable from something working.
 */
export const RETRY_STEPS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 30 * 60_000];

export function nextRetryDelay(attempts: number): number | null {
  if (attempts >= RETRY_STEPS_MS.length) return null;
  return RETRY_STEPS_MS[attempts];
}

/* ------------------------------------------------------------------ */
/* Conflict logic — the part worth testing                             */
/* ------------------------------------------------------------------ */

export type ConflictKind =
  | "none"
  | "local_only"        // safe: push
  | "remote_only"       // remote changed, we didn't — needs a decision
  | "both_changed"      // real conflict
  | "remote_missing"    // cloud copy gone
  | "delete_vs_modify"; // deleted here, changed there

/**
 * Decide what happened, from three hashes.
 *
 * `synced` is the hash at the last agreement. Comparing local and remote
 * against it — rather than against each other — is what tells a one-sided
 * change apart from a genuine conflict. Everything else in the sync engine
 * follows from getting this right, so it is a pure function with no I/O.
 */
export function classifyChange(input: {
  localHash: string | null;
  remoteHash: string | null;
  syncedHash: string | null;
  localDeleted: boolean;
  remoteMissing: boolean;
}): ConflictKind {
  const { localHash, remoteHash, syncedHash, localDeleted, remoteMissing } = input;

  if (localDeleted) {
    // Deleted here. If the cloud copy moved on since we last agreed,
    // destroying it would throw away someone else's work.
    if (!remoteMissing && remoteHash && syncedHash && remoteHash !== syncedHash) {
      return "delete_vs_modify";
    }
    return "local_only";
  }

  if (remoteMissing) {
    // Never mirror a cloud deletion back onto a local file — an accidental
    // Drive delete would otherwise wipe the ERP's copy too.
    return "remote_missing";
  }

  const localChanged = Boolean(localHash && localHash !== syncedHash);
  const remoteChanged = Boolean(remoteHash && syncedHash && remoteHash !== syncedHash);

  if (localChanged && remoteChanged) return "both_changed";
  if (localChanged) return "local_only";
  if (remoteChanged) return "remote_only";
  return "none";
}

/** Human-readable, for the conflict screen. */
export const CONFLICT_TEXT: Record<ConflictKind, string> = {
  none: "In step with the cloud copy.",
  local_only: "Changed here since the last sync — will be pushed up.",
  remote_only:
    "The cloud copy changed but this one didn't. Nothing is overwritten automatically; an admin decides whether to take the cloud version.",
  both_changed:
    "Both copies changed since they last agreed. Neither is overwritten — choose which to keep, or keep both.",
  remote_missing:
    "The cloud copy is gone but the local file is intact. The local file is kept; an admin can put it back on the cloud or accept the deletion.",
  delete_vs_modify:
    "Deleted here, but the cloud copy was changed after the last sync. The cloud copy is left alone until an admin decides.",
};

/** Bytes → something a person can read. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** The folders created under the root on first connect. */
export const CLOUD_FOLDERS = [
  "Documents", "Invoices", "Purchase", "Sales", "Transport", "Weight Slips",
  "Receiving", "Lab Reports", "Contracts", "Employees", "HR Documents",
  "Finance", "OCR Documents", "WhatsApp Documents", "Reports", "Backups", "Archive",
] as const;

export const DEFAULT_ROOT_FOLDER = "BIOME ERP";

/**
 * Never uploaded, whatever asks. Secrets, caches and build output have no
 * business leaving the machine, and a rule here is safer than a rule at
 * each call site.
 */
const NEVER_UPLOAD = [
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.next([\\/]|$)/i,
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])cache([\\/]|$)/i,
  /(^|[\\/])tmp([\\/]|$)/i,
  /users\.json$/i,
  /auth-secret$/i,
  /mail\.json$/i,
  /cloud-credentials\.json$/i,
  /\.env(\.|$)/i,
  /\.(exe|dll|msi|node|log)$/i,
];

export function isUploadable(localPath: string): boolean {
  return !NEVER_UPLOAD.some((re) => re.test(localPath));
}
