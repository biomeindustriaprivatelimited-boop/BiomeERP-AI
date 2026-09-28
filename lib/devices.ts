/**
 * Devices connected to this server (server only)
 * -------------------------------------------------------------------
 * The server PC is the data centre; every other PC, phone and browser is
 * a device of it. Each signed-in screen sends a small heartbeat every
 * minute carrying a random device id it keeps in its own browser storage.
 * From those the developer sees every device, who is using it, from where
 * and on which version — and can:
 *
 *   block        every request carrying that device's cookie is refused,
 *                and the screen shows a blocked notice
 *   sign out     the device is signed out on its next heartbeat
 *   message      a notice is shown on that device on its next heartbeat
 *   reload       the device reloads (after an update on the server)
 *
 * A device id is not a security credential — clearing browser storage
 * makes a new one. Blocking a device is a control, not a lock; for a hard
 * stop, disable the user in Users & Access.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic } from "@/lib/dataRoot";

export const DEVICE_COOKIE = "biome_device";

export interface Device {
  id: string;
  name: string;
  kind: "desktop-app" | "android-app" | "browser" | "phone-browser";
  userId: string;
  userName: string;
  role: string;
  ip: string;
  userAgent: string;
  version: string;
  shellVersion: string;
  page: string;
  firstSeen: string;
  lastSeen: string;
  blocked: boolean;
  blockedReason: string;
  /** One-shot commands delivered on the next heartbeat. */
  pending: { signOut?: boolean; reload?: boolean; message?: string };
}

function file() { return path.join(paths.root, "runtime", "devices.json"); }

export function loadDevices(): Device[] {
  const f = readJson<{ devices: Device[] }>(file(), { devices: [] });
  return Array.isArray(f.devices) ? f.devices : [];
}

/** Written straight, not via writeJsonAtomic's live-sync bump: a heartbeat
 *  must not make every other screen reload every minute. */
function saveDevices(list: Device[]) {
  const fs = require("fs") as typeof import("fs");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ devices: list.slice(0, 500) }, null, 2), "utf8");
  fs.renameSync(tmp, file());
}

export function isBlocked(deviceId: string | undefined | null): boolean {
  if (!deviceId) return false;
  return loadDevices().some((d) => d.id === deviceId && d.blocked);
}

function kindOf(ua: string, shell: string): Device["kind"] {
  if (shell === "desktop") return "desktop-app";
  if (/BiomeAndroid|; wv\)/i.test(ua)) return "android-app";
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return "phone-browser";
  return "browser";
}

function nameOf(ua: string): string {
  const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows"
    : /Android ([\d.]+)/.test(ua) ? `Android ${ua.match(/Android ([\d.]+)/)![1]}`
    : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? (/Electron\//.test(ua) ? "Biome app" : "Chrome") : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
}

export function heartbeat(input: {
  id: string; userId: string; userName: string; role: string; ip: string; userAgent: string;
  version: string; shellVersion: string; shell: string; page: string; label?: string;
}): Device {
  const list = loadDevices();
  const now = new Date().toISOString();
  const existing = list.find((d) => d.id === input.id);
  const device: Device = {
    id: input.id,
    name: input.label || existing?.name || nameOf(input.userAgent),
    kind: kindOf(input.userAgent, input.shell),
    userId: input.userId, userName: input.userName, role: input.role,
    ip: input.ip, userAgent: input.userAgent.slice(0, 300),
    version: input.version, shellVersion: input.shellVersion, page: input.page.slice(0, 120),
    firstSeen: existing?.firstSeen || now, lastSeen: now,
    blocked: existing?.blocked || false, blockedReason: existing?.blockedReason || "",
    pending: {},
  };
  const out = { ...device, pending: existing?.pending || {} };
  saveDevices([device, ...list.filter((d) => d.id !== input.id)]);
  return out;
}

export function command(deviceId: string, patch: Partial<Pick<Device, "blocked" | "blockedReason" | "name">> & { pending?: Device["pending"] }): Device | null {
  const list = loadDevices();
  const d = list.find((x) => x.id === deviceId);
  if (!d) return null;
  const next: Device = { ...d, ...patch, pending: { ...d.pending, ...(patch.pending || {}) } };
  saveDevices(list.map((x) => (x.id === deviceId ? next : x)));
  return next;
}

export function forget(deviceId: string) {
  saveDevices(loadDevices().filter((d) => d.id !== deviceId));
}
