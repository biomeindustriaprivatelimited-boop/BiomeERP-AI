/**
 * Biome Platform — Google Drive provider (server only)
 * -------------------------------------------------------------------
 * Written against the Drive REST API directly rather than googleapis,
 * because that package pulls in a very large dependency tree for the eight
 * calls this needs, and the ERP already ships enough.
 *
 * Security, stated plainly because it is the point of the design:
 *   - The refresh token, access token and client secret exist ONLY on the
 *     server. No route ever returns them, and none is written to a log.
 *   - Employee machines never talk to Google. They talk to this server,
 *     which holds the one admin account's credentials.
 *   - Credentials at rest are AES-256-GCM, keyed off BIOME_AUTH_SECRET.
 *     That is protection against someone reading the data folder, NOT
 *     against someone who already controls the machine. Said here so
 *     nobody assumes more than it gives.
 */

import { storedGoogleKeys } from "@/lib/aiKeys";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import {
  CloudProvider, CloudQuota, CloudFileRef, UploadInput,
  DEFAULT_ROOT_FOLDER,
} from "@/lib/cloud/provider";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Least privilege: `drive.file` grants access ONLY to files this app
 * created. It cannot read the admin's personal documents, photos or mail,
 * and the consent screen says so. `drive` (full) would be easier and is
 * deliberately not used.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface CloudConnection {
  provider: "google_drive";
  accountEmail: string;
  accountName: string;
  refreshTokenEnc: string;
  rootFolderId: string | null;
  rootFolderName: string;
  connectedAt: string;
  connectedByName: string;
  /** Set when Google revokes us, so the UI can say why it stopped. */
  lastError: string | null;
}

function credFile() { return path.join(paths.configDir, "cloud-credentials.json"); }

/* ------------------------------------------------------------------ */
/* Credential storage                                                  */
/* ------------------------------------------------------------------ */

function key(): Buffer {
  const secret = process.env.BIOME_AUTH_SECRET || "biome-local-cloud-key";
  return crypto.createHash("sha256").update(`cloud:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  try {
    const [iv, tag, data] = stored.split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    // A changed auth secret makes the token unreadable. Returning blank
    // surfaces as "reconnect Google Drive", which is the honest outcome.
    return "";
  }
}

export function loadConnection(): CloudConnection | null {
  return readJson<CloudConnection | null>(credFile(), null);
}

export function saveConnection(c: CloudConnection): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(credFile(), c);
}

export function clearConnection(): void {
  try { fs.existsSync(credFile()) && fs.unlinkSync(credFile()); } catch { /* already gone */ }
}

/** Everything safe to send to a browser. Note what is absent. */
export function publicConnection(c: CloudConnection | null) {
  if (!c) return null;
  return {
    provider: c.provider,
    accountEmail: c.accountEmail,
    accountName: c.accountName,
    rootFolderId: c.rootFolderId,
    rootFolderName: c.rootFolderName,
    connectedAt: c.connectedAt,
    connectedByName: c.connectedByName,
    lastError: c.lastError,
  };
}

/**
 * The OAuth client. `.env.local` wins when it has a value; otherwise the
 * one saved from Settings → Cloud (encrypted in config/google-oauth.json).
 */
export function googleConfig() {
  const stored = storedGoogleKeys();
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim() || stored.clientId,
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim() || stored.clientSecret,
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || "").trim() || stored.redirectUri,
  };
}

export function isConfigured(): boolean {
  const c = googleConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

/** Authorization-code URL with a signed state, for CSRF protection. */
export function buildAuthUrl(state: string): string {
  const c = googleConfig();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // Required to be given a refresh token at all, and `consent` forces one
    // even on a re-authorisation — without it a reconnect silently yields
    // no refresh token and the connection dies at the first expiry.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export function signState(payload: string): string {
  const secret = process.env.BIOME_AUTH_SECRET || "biome-local-cloud-key";
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyState(state: string): string | null {
  try {
    const [body, sig] = state.split(".");
    const payload = Buffer.from(body, "base64url").toString("utf8");
    const secret = process.env.BIOME_AUTH_SECRET || "biome-local-cloud-key";
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const [, issued] = payload.split("|");
    // A state older than ten minutes is a replay, not a slow user.
    if (Date.now() - Number(issued) > 10 * 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const c = googleConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: c.clientId, client_secret: c.clientSecret,
      redirect_uri: c.redirectUri, grant_type: "authorization_code",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token exchange failed (${res.status}).`);
  if (!json.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove BIOME ERP from myaccount.google.com/permissions and connect again."
    );
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

export class GoogleDriveProvider implements CloudProvider {
  readonly id = "google_drive" as const;
  readonly label = "Google Drive";

  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private connection: CloudConnection) {}

  /** Refreshes only when the current token is within a minute of expiry. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const c = googleConfig();
    const refresh = decryptSecret(this.connection.refreshTokenEnc);
    if (!refresh) throw new Error("The stored Google credentials can't be read. Reconnect Google Drive.");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId, client_secret: c.clientSecret,
        refresh_token: refresh, grant_type: "refresh_token",
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // `invalid_grant` means the admin revoked access or changed their
      // password. Saying so beats a raw OAuth error nobody can act on.
      const reason = json.error === "invalid_grant"
        ? "Google has revoked this connection — it usually means access was removed or the password changed. Connect Google Drive again."
        : json.error_description || json.error || `Couldn't refresh the Google token (${res.status}).`;
      throw new Error(reason);
    }
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.accessToken!;
  }

  private async api(url: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${await this.token()}` },
    });
    if (res.status === 204) return null;
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = json?.error?.message || `Drive returned ${res.status}.`;
      const err = new Error(message) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async testConnection() {
    try {
      const me = await this.api("https://www.googleapis.com/oauth2/v2/userinfo");
      return { ok: true, account: me?.email };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStorageQuota(): Promise<CloudQuota> {
    const about = await this.api(`${DRIVE}/about?fields=storageQuota,user`);
    const q = about?.storageQuota || {};
    const total = q.limit ? Number(q.limit) : null;
    const used = Number(q.usage ?? 0);
    return {
      total,
      used,
      available: total === null ? null : Math.max(0, total - used),
      // A personal account's quota covers Drive, Gmail and Photos together.
      // Never assume 15 GB; this is whatever Google actually reports.
      sharedWithOtherServices: true,
    };
  }

  async createFolder(name: string, parentId?: string | null): Promise<string> {
    const body: any = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parentId) body.parents = [parentId];
    const created = await this.api(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return created.id;
  }

  async ensureFolder(name: string, parentId?: string | null): Promise<string> {
    const safe = name.replace(/'/g, "\\'");
    const clauses = [
      `name='${safe}'`,
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
      parentId ? `'${parentId}' in parents` : "'root' in parents",
    ];
    const found = await this.api(
      `${DRIVE}/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id)&pageSize=1`
    );
    if (found?.files?.length) return found.files[0].id;
    return this.createFolder(name, parentId);
  }

  /**
   * Resumable upload.
   *
   * Streamed from disk rather than buffered: a 40 MB scan held in memory on
   * a plant PC alongside Tally and the OCR worker is how a machine falls
   * over.
   */
  async uploadFile(input: UploadInput): Promise<CloudFileRef> {
    const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.size),
      },
      body: JSON.stringify({ name: input.name, parents: [input.parentId] }),
    });
    if (!start.ok) throw new Error(`Couldn't start the upload (${start.status}).`);
    const session = start.headers.get("location");
    if (!session) throw new Error("Google didn't return an upload session.");

    const res = await fetch(session, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType, "Content-Length": String(input.size) },
      body: fs.readFileSync(input.localPath),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Upload failed (${res.status}).`);

    return this.getMetadata(json.id) as Promise<CloudFileRef>;
  }

  /** Replaces content in place — same file id, so Drive keeps its history. */
  async updateFile(fileId: string, localPath: string, mimeType: string, size: number): Promise<CloudFileRef> {
    const res = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": mimeType,
        "Content-Length": String(size),
      },
      body: fs.readFileSync(localPath),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Update failed (${res.status}).`);
    return this.getMetadata(fileId) as Promise<CloudFileRef>;
  }

  /** Trash, never a hard delete — Drive's bin is the recovery net. */
  async trashFile(fileId: string): Promise<void> {
    await this.api(`${DRIVE}/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async restoreFile(fileId: string): Promise<void> {
    await this.api(`${DRIVE}/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: false }),
    });
  }

  async getMetadata(fileId: string): Promise<CloudFileRef | null> {
    try {
      const f = await this.api(
        `${DRIVE}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,md5Checksum,trashed,parents,webViewLink`
      );
      return {
        id: f.id, name: f.name, mimeType: f.mimeType,
        size: Number(f.size ?? 0), modifiedAt: f.modifiedTime,
        checksum: f.md5Checksum ?? null, trashed: Boolean(f.trashed),
        parentId: f.parents?.[0] ?? null, webViewLink: f.webViewLink ?? null,
      };
    } catch (err) {
      // 404 means somebody removed it from Drive — a fact the reconciler
      // needs, not an error that should stop the run.
      if ((err as any).status === 404) return null;
      throw err;
    }
  }

  async listFolder(folderId: string): Promise<CloudFileRef[]> {
    const out: CloudFileRef[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const page = await this.api(
        `${DRIVE}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,trashed,parents)&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`
      );
      for (const f of page?.files ?? []) {
        out.push({
          id: f.id, name: f.name, mimeType: f.mimeType,
          size: Number(f.size ?? 0), modifiedAt: f.modifiedTime,
          checksum: f.md5Checksum ?? null, trashed: Boolean(f.trashed),
          parentId: f.parents?.[0] ?? null,
        });
      }
      pageToken = page?.nextPageToken;
    } while (pageToken);
    return out;
  }

  async downloadFile(fileId: string, toLocalPath: string): Promise<void> {
    const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    ensureDir(path.dirname(toLocalPath));
    fs.writeFileSync(toLocalPath, Buffer.from(await res.arrayBuffer()));
  }
}

/** The active provider, or null when nothing is connected. */
export function getProvider(): GoogleDriveProvider | null {
  const c = loadConnection();
  if (!c || !isConfigured()) return null;
  return new GoogleDriveProvider(c);
}

export { DEFAULT_ROOT_FOLDER };
