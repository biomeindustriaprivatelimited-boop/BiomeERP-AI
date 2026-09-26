/**
 * Biome Platform — Google Drive sync
 * -------------------------------------------------------------------
 * Backups of ALL platform data, uploaded to the OWNER'S OWN Google
 * Drive. Built the honest way this can work offline-first:
 *
 *   - The business creates its own OAuth "Desktop app" credential in
 *     Google Cloud Console (5 minutes, free) and pastes the Client ID
 *     and Secret into Settings. Nothing of Google's is shipped in the
 *     build — shipping a shared secret would put every installation
 *     inside one Google project owned by nobody in this company.
 *   - Connect opens Google's consent screen in the browser; the code
 *     comes back to this server's /api/gdrive/callback on localhost.
 *   - Tokens live in the data folder, encrypted the same way SMTP
 *     passwords already are. Scope is drive.file — this app can only
 *     see files IT created, not the rest of the Drive.
 *   - "Back up to Drive" zips the same file set the local backup uses
 *     and uploads it to a "Biome Platform Backups" folder.
 *
 * Plain REST via fetch — no googleapis dependency (it drags in half of
 * npm for what is three HTTP calls).
 */

import fs from "fs";
import path from "path";
import { paths } from "@/lib/dataRoot";
import { encrypt, decrypt } from "@/lib/mailer";

export interface DriveConfig {
  clientId: string;
  /** Encrypted at rest, exactly like the SMTP password. */
  clientSecretEnc: string;
  refreshTokenEnc: string;
  accountEmail: string;
  folderId: string;
  connectedAt: string;
  lastBackupAt: string | null;
  lastBackupName: string | null;
}

const SCOPE = "https://www.googleapis.com/auth/drive.file email";

function file(): string {
  return path.join(paths.configDir, "gdrive.json");
}

export function loadDrive(): DriveConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return {
      clientId: raw.clientId || "",
      clientSecretEnc: raw.clientSecretEnc || "",
      refreshTokenEnc: raw.refreshTokenEnc || "",
      accountEmail: raw.accountEmail || "",
      folderId: raw.folderId || "",
      connectedAt: raw.connectedAt || "",
      lastBackupAt: raw.lastBackupAt || null,
      lastBackupName: raw.lastBackupName || null,
    };
  } catch {
    return {
      clientId: "", clientSecretEnc: "", refreshTokenEnc: "",
      accountEmail: "", folderId: "", connectedAt: "",
      lastBackupAt: null, lastBackupName: null,
    };
  }
}

export function saveDrive(cfg: DriveConfig): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), "utf8");
}

export function driveRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/gdrive/callback`;
}

export function driveAuthUrl(clientId: string, redirectUri: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Force the refresh token every time — reconnecting without it
    // silently yields a connection that dies in an hour.
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string }> {
  const cfg = loadDrive();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: decrypt(cfg.clientSecretEnc),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google refused the code.");
  }
  return { refreshToken: json.refresh_token || "", accessToken: json.access_token };
}

export async function accessToken(): Promise<string> {
  const cfg = loadDrive();
  if (!cfg.refreshTokenEnc) throw new Error("Google Drive is not connected.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: decrypt(cfg.clientSecretEnc),
      refresh_token: decrypt(cfg.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || "Google session expired — reconnect Drive in Settings.");
  }
  return json.access_token;
}

export async function whoAmI(token: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  return json.email || "";
}

/** The one folder this app writes into. Created once, reused after. */
export async function ensureFolder(token: string): Promise<string> {
  const cfg = loadDrive();
  if (cfg.folderId) return cfg.folderId;

  const q = encodeURIComponent(
    "name = 'Biome Platform Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  );
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json() as any).catch(() => ({}));
  let id = found?.files?.[0]?.id;

  if (!id) {
    const made = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Biome Platform Backups", mimeType: "application/vnd.google-apps.folder" }),
    }).then((r) => r.json() as any);
    id = made?.id;
    if (!id) throw new Error("Could not create the Drive folder.");
  }

  saveDrive({ ...cfg, folderId: id });
  return id;
}

/** Multipart upload — fine for backup zips well under Drive's 5 MB
 *  multipart limit? No: multipart caps at 5 MB, so RESUMABLE is used —
 *  one extra request, no size ceiling that a growing business hits. */
export async function uploadToDrive(token: string, folderId: string, name: string, data: Buffer): Promise<string> {
  const start = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "application/zip",
        "X-Upload-Content-Length": String(data.length),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    }
  );
  const session = start.headers.get("location");
  if (!start.ok || !session) throw new Error("Drive refused the upload session.");

  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": "application/zip", "Content-Length": String(data.length) },
    body: new Uint8Array(data),
  });
  const json: any = await put.json().catch(() => ({}));
  if (!put.ok || !json.id) throw new Error("The upload did not complete.");
  return json.id;
}
