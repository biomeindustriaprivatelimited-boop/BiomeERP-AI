/**
 * Biome Platform — admin override
 * -------------------------------------------------------------------
 * The app is full of records that stop being editable on purpose: a
 * coordination row a week after the client unloaded, an approved payroll
 * month, a frozen employee, an imprest entry someone already decided. Each
 * of those locks exists because the record is evidence by then.
 *
 * An admin still has to be able to correct a genuine mistake, or people
 * keep a private spreadsheet and the app stops being the record — which is
 * strictly worse. So the power exists, with three conditions:
 *
 *   1. IT IS TURNED ON DELIBERATELY, with a reason typed first. An admin
 *      who is simply always able to edit everything will eventually edit
 *      something by accident and never know.
 *   2. IT EXPIRES. Thirty minutes, then it is off again. An override left
 *      on is the same as no override at all.
 *   3. EVERY WRITE MADE UNDER IT IS AUDITED as an override, naming the
 *      reason given when it was switched on. Six months later the question
 *      is never "who could have" but "who did, and why".
 *
 * This is NOT a way past the rules that protect other people: nobody
 * approves their own imprest entry, their own leave, or their own edit
 * request, override or not. Those are separation-of-duty rules, not locks
 * on stale data, and an override that dissolved them would make every
 * approval in the app meaningless.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { recordAudit } from "@/lib/audit";

/** How long an override stays live once switched on. */
export const OVERRIDE_MINUTES = 30;

export interface OverrideGrant {
  userId: string;
  userName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  /** How many writes have been made under it — shown when it is running. */
  used: number;
}

interface OverrideFile { grants: OverrideGrant[]; updatedAt?: string; }

function file(): string {
  return path.join(paths.root, "runtime", "override.json");
}

function load(): OverrideGrant[] {
  const f = readJson<OverrideFile>(file(), { grants: [] });
  return Array.isArray(f.grants) ? f.grants : [];
}

function save(grants: OverrideGrant[]): void {
  ensureDir(path.join(paths.root, "runtime"));
  writeJsonAtomic(file(), { grants, updatedAt: new Date().toISOString() });
}

/** The live grant for this user, if there is one. */
export function activeGrant(userId: string, now: Date = new Date()): OverrideGrant | null {
  const g = load().find((x) => x.userId === userId);
  if (!g) return null;
  return new Date(g.expiresAt).getTime() > now.getTime() ? g : null;
}

export function isOverrideActive(userId: string, now: Date = new Date()): boolean {
  return activeGrant(userId, now) !== null;
}

export function startOverride(
  user: { id: string; name: string; role: string },
  reason: string
): OverrideGrant {
  const now = new Date();
  const grant: OverrideGrant = {
    userId: user.id,
    userName: user.name,
    reason: reason.trim().slice(0, 400),
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OVERRIDE_MINUTES * 60000).toISOString(),
    used: 0,
  };
  save([...load().filter((g) => g.userId !== user.id), grant]);

  recordAudit({
    action: "OVERRIDE_STARTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "override", targetId: user.id, targetLabel: user.name,
    detail: `${OVERRIDE_MINUTES} minutes. Reason: ${grant.reason}`,
  });
  return grant;
}

export function endOverride(user: { id: string; name: string; role: string }): void {
  const grants = load();
  const mine = grants.find((g) => g.userId === user.id);
  save(grants.filter((g) => g.userId !== user.id));
  if (!mine) return;
  recordAudit({
    action: "OVERRIDE_ENDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "override", targetId: user.id, targetLabel: user.name,
    detail: `${mine.used} change${mine.used === 1 ? "" : "s"} made under it.`,
  });
}

/**
 * Record that a write happened under an override.
 *
 * Called by whichever route allowed the edit — the grant itself knows
 * nothing about what it was used for, and the audit line is the only place
 * the two are tied together.
 */
export function recordOverrideUse(
  user: { id: string; name: string; role: string },
  what: { targetType: string; targetId: string; targetLabel: string; detail: string }
): void {
  const grants = load();
  const index = grants.findIndex((g) => g.userId === user.id);
  if (index !== -1) {
    grants[index] = { ...grants[index], used: grants[index].used + 1 };
    save(grants);
  }
  const reason = index !== -1 ? grants[index].reason : "";
  recordAudit({
    action: "OVERRIDE_USED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: what.targetType, targetId: what.targetId, targetLabel: what.targetLabel,
    detail: `${what.detail}${reason ? ` — override reason: ${reason}` : ""}`,
  });
}

/**
 * The one sentence a route should send back when it refuses.
 *
 * Written as an instruction rather than a complaint: an admin reading
 * "this is frozen" learns nothing they did not already know.
 */
export function lockedMessage(what: string): string {
  return `${what} Turn on Override on the Settings screen — you will be asked why, it lasts ${OVERRIDE_MINUTES} minutes, and every change made under it is recorded against your name.`;
}
