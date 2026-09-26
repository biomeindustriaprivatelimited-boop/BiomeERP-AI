/**
 * Biome Platform — who may do what, and what is switched on at all
 * -------------------------------------------------------------------
 * Two things live here, because they answer the same question from
 * opposite ends:
 *
 *   ACCESS      — this person, on top of their role. Granted or revoked
 *                 one permission at a time, by the developer only.
 *   FEATURES    — this module, for everybody. Live, read-only, or off,
 *                 with a sentence explaining why.
 *
 * WHY OVERRIDES ARE A LIST OF EXCEPTIONS, NOT A LIST OF PERMISSIONS:
 * If a user carried their own full permission list, then every future
 * change to what a Coordinator can do would have to be applied by hand to
 * every coordinator — and the ones nobody remembered would quietly keep
 * the old access. Storing only the difference from the role means the role
 * stays the source of truth and an exception stays visibly an exception.
 *
 * WHY A CHANGE FORCES A FRESH SIGN-IN:
 * The session token carries the permissions it was issued with, because
 * the page guard runs on the Edge runtime and cannot read this file. So
 * every user record carries an `accessVersion`; when it moves, the token
 * is out of date and the next request is refused with "sign in again"
 * rather than being served from a stale list. Revoked access that keeps
 * working for eight hours is not revoked.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { Permission, Role, permissionsFor, ALL_PERMISSIONS } from "@/lib/permissions";

/* ------------------------------------------------------------------ */
/* Per-user access                                                     */
/* ------------------------------------------------------------------ */

export interface AccessOverride {
  /** Permissions this person has that their role does not give. */
  granted: Permission[];
  /** Permissions their role gives that this person must not have. */
  revoked: Permission[];
  /** Why — shown on the access screen, so a change can be understood later. */
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export function blankOverride(): AccessOverride {
  return { granted: [], revoked: [], note: "", updatedAt: "", updatedBy: "" };
}

/**
 * What this user may actually do.
 *
 * Revoked wins over granted. If both lists somehow name the same
 * permission, the safer reading is the one that takes access away.
 */
export function effectivePermissions(role: Role, override?: AccessOverride | null): Permission[] {
  const base = new Set<Permission>(permissionsFor(role));
  for (const p of override?.granted || []) if (ALL_PERMISSIONS.includes(p)) base.add(p);
  for (const p of override?.revoked || []) base.delete(p);
  return [...base];
}

export function userCan(role: Role, override: AccessOverride | null | undefined, permission: Permission): boolean {
  return effectivePermissions(role, override).includes(permission);
}

/** Keeps a stored override honest: known keys only, no duplicates. */
export function cleanOverride(input: any, by: string): AccessOverride {
  const list = (v: any): Permission[] =>
    Array.isArray(v)
      ? [...new Set(v.map(String))].filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p))
      : [];
  const granted = list(input?.granted);
  const revoked = list(input?.revoked);
  return {
    granted: granted.filter((p) => !revoked.includes(p)),
    revoked,
    note: String(input?.note ?? "").slice(0, 400),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
}

/* ------------------------------------------------------------------ */
/* Feature switches                                                    */
/* ------------------------------------------------------------------ */

export type FeatureState = "live" | "readonly" | "off";

export const FEATURE_STATES: { id: FeatureState; label: string; help: string }[] = [
  { id: "live", label: "Live", help: "Normal. Everyone with access can use it." },
  {
    id: "readonly",
    label: "Frozen",
    help: "Can be read, nothing can be saved. Use while a month is being closed or figures are being checked.",
  },
  {
    id: "off",
    label: "Off",
    help: "Hidden from the menu and refused by the server. Use when a module is mid-repair.",
  },
];

/**
 * The modules that can be switched.
 *
 * Deliberately NOT everything. Login, the audit log, Help & Support and
 * the developer screens are missing from this list on purpose: switching
 * off the way people report a problem, or the record of what happened,
 * turns a small outage into one nobody can see or complain about.
 */
export const SWITCHABLE: { id: string; label: string; prefixes: string[] }[] = [
  { id: "coordination", label: "Coordination", prefixes: ["/coordination", "/api/coordination"] },
  { id: "imprest", label: "Imprest", prefixes: ["/imprest", "/api/imprest"] },
  { id: "payroll", label: "Payroll & Salary", prefixes: ["/payroll", "/api/payroll"] },
  { id: "attendance", label: "Attendance", prefixes: ["/attendance", "/api/attendance"] },
  { id: "leave", label: "Leave", prefixes: ["/leave", "/api/leave", "/api/holidays"] },
  { id: "employees", label: "Employees", prefixes: ["/employees"] },
  { id: "documents", label: "Documents", prefixes: ["/documents", "/api/documents"] },
  { id: "ocr", label: "AI OCR Scanner", prefixes: ["/ocr", "/api/ocr"] },
  { id: "whatsapp", label: "WhatsApp Documents", prefixes: ["/whatsapp", "/api/whatsapp"] },
  { id: "finance", label: "Finance (ledgers, payments, GST)", prefixes: ["/ledgers", "/payments", "/gst-compliance", "/reconciliation"] },
  { id: "plants", label: "Plants & Transport", prefixes: ["/plants", "/transport", "/api/plant-sheet", "/api/plant-upload"] },
  { id: "vendors", label: "Vendors & Clients", prefixes: ["/vendors", "/clients", "/api/vendors", "/api/clients"] },
  { id: "reports", label: "Reports & Analytics", prefixes: ["/reports", "/analytics", "/api/reports"] },
  { id: "cloud", label: "Cloud & Backup", prefixes: ["/cloud", "/api/cloud", "/api/backup"] },
];

export interface FeatureSwitch {
  id: string;
  state: FeatureState;
  /** Shown to whoever hits the wall. Written for them, not for the log. */
  message: string;
  changedBy: string;
  changedAt: string;
}

interface FeatureFile { features: FeatureSwitch[]; updatedAt?: string; }

function featureFile(): string {
  return path.join(paths.root, "config", "features.json");
}

export function loadFeatures(): FeatureSwitch[] {
  const f = readJson<FeatureFile>(featureFile(), { features: [] });
  return Array.isArray(f.features) ? f.features : [];
}

export function saveFeatures(features: FeatureSwitch[]): void {
  ensureDir(path.join(paths.root, "config"));
  writeJsonAtomic(featureFile(), { features, updatedAt: new Date().toISOString() });
}

export function featureFor(id: string): FeatureSwitch | undefined {
  return loadFeatures().find((f) => f.id === id);
}

/**
 * Which switch, if any, covers this path. Longest prefix wins, the same
 * rule the permission table already uses — so `/api/coordination/import`
 * is governed by the coordination switch without needing its own line.
 */
export function switchForPath(pathname: string): { feature: (typeof SWITCHABLE)[number]; sw: FeatureSwitch } | null {
  const features = loadFeatures();
  let best: { feature: (typeof SWITCHABLE)[number]; sw: FeatureSwitch; length: number } | null = null;

  for (const feature of SWITCHABLE) {
    const sw = features.find((f) => f.id === feature.id);
    if (!sw || sw.state === "live") continue;
    for (const prefix of feature.prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        if (!best || prefix.length > best.length) best = { feature, sw, length: prefix.length };
      }
    }
  }
  return best ? { feature: best.feature, sw: best.sw } : null;
}

/**
 * Should this request be refused because a module is frozen or off?
 *
 * A frozen module still answers GET — that is what "read-only" means, and
 * a freeze that also blinded people would just be an outage with a nicer
 * name. Anything that writes is refused.
 */
export function featureBlocks(pathname: string, method: string): { message: string; state: FeatureState } | null {
  const hit = switchForPath(pathname);
  if (!hit) return null;
  const reading = method === "GET" || method === "HEAD";
  if (hit.sw.state === "readonly" && reading) return null;

  const fallback =
    hit.sw.state === "off"
      ? `${hit.feature.label} is switched off at the moment.`
      : `${hit.feature.label} is frozen — you can look, but nothing can be saved right now.`;
  return { message: hit.sw.message?.trim() || fallback, state: hit.sw.state };
}
