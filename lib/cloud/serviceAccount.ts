/**
 * Biome Platform — Google Drive via a service account (server only)
 * -------------------------------------------------------------------
 * WHY THIS FILE EXISTS, stated plainly:
 *
 * The business asked to connect Drive with an email address and password.
 * Google does not permit that and has not since 2024 — "Less secure app
 * access" was withdrawn, and any application handing a Google password to
 * accounts.google.com is refused. There is no setting, no workaround, and
 * no library that changes it. It is not a limitation of this app.
 *
 * What DOES exist is this: a service account. You download one JSON file
 * from Google once, drop it in, and share a Drive folder with the address
 * inside it. After that the app authenticates by itself, for ever, with no
 * browser, no consent screen and no password. That is as close to "just
 * log in" as Google allows, and for a server that runs unattended it is
 * actually the better answer — an OAuth refresh token dies when the admin
 * changes their password, and this does not.
 *
 * Two things to know before choosing it:
 *   1. A service account has NO storage of its own. It must be given a
 *      folder in somebody's Drive (or a Shared Drive). The files then
 *      count against that account's quota.
 *   2. The JSON file is a credential. It is stored encrypted here and is
 *      never sent to a browser.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
  type?: string;
}

export interface ServiceAccountConnection {
  provider: "google_drive_service";
  clientEmail: string;
  projectId: string;
  keyEnc: string;
  /** The folder that was shared with the service account. */
  rootFolderId: string;
  rootFolderName: string;
  connectedAt: string;
  connectedByName: string;
  lastError: string | null;
}

function file() { return path.join(paths.configDir, "cloud-service-account.json"); }

function encKey(): Buffer {
  const secret = process.env.BIOME_AUTH_SECRET || "biome-local-cloud-key";
  return crypto.createHash("sha256").update(`svc:${secret}`).digest();
}

export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptKey(stored: string): string {
  try {
    const [iv, tag, data] = stored.split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function loadServiceConnection(): ServiceAccountConnection | null {
  return readJson<ServiceAccountConnection | null>(file(), null);
}

export function saveServiceConnection(c: ServiceAccountConnection): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), c);
}

export function clearServiceConnection(): void {
  try {
    const fs = require("fs");
    if (fs.existsSync(file())) fs.unlinkSync(file());
  } catch { /* already gone */ }
}

/** Never returns the key. */
export function publicServiceConnection(c: ServiceAccountConnection | null) {
  if (!c) return null;
  const { keyEnc, ...rest } = c;
  return rest;
}

/**
 * Validate an uploaded JSON key before storing it.
 *
 * A wrong file here fails much later and very confusingly, so everything
 * that can be checked without a network call is checked now.
 */
export function parseServiceAccountJson(raw: string): { ok: true; key: ServiceAccountKey } | { ok: false; error: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That isn't a valid JSON file. Download the key again from Google Cloud Console." };
  }
  if (parsed.type && parsed.type !== "service_account") {
    return {
      ok: false,
      error: `This is a "${parsed.type}" file, not a service account key. In Google Cloud Console go to IAM & Admin → Service Accounts → Keys → Add key → JSON.`,
    };
  }
  if (!parsed.client_email || !parsed.private_key) {
    return { ok: false, error: "This file has no client_email or private_key. It is not a service account key." };
  }
  if (!String(parsed.private_key).includes("BEGIN PRIVATE KEY")) {
    return { ok: false, error: "The private key in this file looks damaged. Download it again rather than copying it by hand." };
  }
  return { ok: true, key: parsed as ServiceAccountKey };
}

/* ------------------------------------------------------------------ */
/* JWT — signed here rather than pulling in a library                  */
/* ------------------------------------------------------------------ */

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Exchange the key for an access token.
 *
 * Google's service-account flow is a self-signed JWT posted to the token
 * endpoint. Doing it directly avoids adding googleapis for one call, and
 * makes it obvious what is being signed and sent.
 */
export async function serviceAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));

  const signature = crypto.createSign("RSA-SHA256")
    .update(`${header}.${claim}`)
    .sign(key.private_key);

  const assertion = `${header}.${claim}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // These two are the mistakes people actually make, so they get a plain
    // explanation rather than Google's wording.
    if (json.error === "invalid_grant") {
      throw new Error(
        "Google rejected the key. Usually the Drive API is not enabled on that project, or the machine's clock is wrong by more than a few minutes."
      );
    }
    if (json.error === "invalid_client") {
      throw new Error("That service account no longer exists, or its key has been deleted in Google Cloud Console.");
    }
    throw new Error(json.error_description || json.error || `Google returned ${res.status}.`);
  }
  return json.access_token;
}

/** Confirm the shared folder is actually reachable. */
export async function checkFolderAccess(
  key: ServiceAccountKey,
  folderId: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const token = await serviceAccessToken(key);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) {
      return {
        ok: false,
        error: `The folder wasn't found. Open it in Drive, press Share, and give ${key.client_email} Editor access — then try again.`,
      };
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error?.message || `Google returned ${res.status}.` };
    if (json.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, error: "That id is a file, not a folder. Use the id from a folder's address bar." };
    }
    return { ok: true, name: json.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Pull the folder id out of whatever the person pasted. */
export function folderIdFrom(input: string): string {
  const raw = input.trim();
  const m = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}
