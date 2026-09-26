/**
 * Biome Platform — announcements
 * -------------------------------------------------------------------
 * One notice, written once, reaching people two ways: on screen when they
 * next open the app, and by email for the ones who will not open it today.
 *
 * THE RULE THAT SHAPES THIS FILE: the notice is STORED BEFORE it is
 * emailed, and a failed email never loses it. The same rule the letters
 * module follows, for the same reason — a warning that vanished because
 * the SMTP password had expired is a warning nobody can prove was sent.
 * Email results are recorded per recipient, so "did she get it?" has an
 * answer rather than a shrug.
 *
 * Sending is a BUTTON, never a schedule. An unattended sender that gets
 * one rule wrong mails forty people something they should not have
 * received, and that cannot be taken back.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import type { Role } from "@/lib/permissions";

export type AnnouncementKind = "info" | "feature" | "update" | "warning" | "maintenance";

export const ANNOUNCEMENT_KINDS: { id: AnnouncementKind; label: string; help: string }[] = [
  { id: "info", label: "Notice", help: "General information for the people it reaches." },
  { id: "feature", label: "New feature", help: "Something new in the app and where to find it." },
  { id: "update", label: "Software update", help: "A version has changed, and what changed." },
  { id: "warning", label: "Warning", help: "Something people must act on. Shown in red and pinned." },
  { id: "maintenance", label: "Maintenance", help: "A module is going down, and for how long." },
];

export interface AnnouncementAudience {
  /** "all", or the roles it is meant for. */
  roles: Role[] | "all";
  /** Plant codes it is limited to. Empty means every plant. */
  plants: string[];
  /** Specific user ids, when it is for named people rather than a group. */
  userIds: string[];
}

export interface DeliveryRecord {
  userId: string;
  userName: string;
  email: string;
  emailed: boolean;
  error: string;
  at: string;
}

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** Pinned notices stay at the top until they are withdrawn. */
  pinned: boolean;
  /** Stops showing after this date. Empty means it stays until withdrawn. */
  expiresOn: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  withdrawnAt: string;
  /** Per-recipient email outcome. Empty until someone presses send. */
  deliveries: DeliveryRecord[];
  /** User ids who have dismissed it on screen. */
  readBy: string[];
}

interface AnnouncementFile { announcements: Announcement[]; updatedAt?: string; }

function file(): string {
  return path.join(paths.root, "announcements", "announcements.json");
}

export function loadAnnouncements(): Announcement[] {
  const f = readJson<AnnouncementFile>(file(), { announcements: [] });
  return Array.isArray(f.announcements) ? f.announcements : [];
}

export function saveAnnouncements(list: Announcement[]): void {
  ensureDir(path.join(paths.root, "announcements"));
  writeJsonAtomic(file(), { announcements: list, updatedAt: new Date().toISOString() });
}

export function makeAnnouncement(input: {
  kind: AnnouncementKind; title: string; body: string;
  audience: AnnouncementAudience; pinned?: boolean; expiresOn?: string;
  by: { id: string; name: string };
}): Announcement {
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title.trim().slice(0, 140),
    body: input.body.trim().slice(0, 4000),
    audience: input.audience,
    pinned: Boolean(input.pinned),
    expiresOn: (input.expiresOn || "").slice(0, 10),
    createdBy: input.by.id,
    createdByName: input.by.name,
    createdAt: new Date().toISOString(),
    withdrawnAt: "",
    deliveries: [],
    readBy: [],
  };
}

/**
 * Is this notice meant for this person?
 *
 * The three parts of an audience are an AND, not an OR. "Plant managers"
 * plus "Rewari" means the Rewari plant manager, not every plant manager
 * and separately everyone at Rewari — which is the reading that would
 * quietly mail a warning to the whole company.
 *
 * Naming specific users overrides the rest: if someone took the trouble to
 * pick three people, those three are the audience.
 */
export function isFor(
  a: Announcement,
  user: { id: string; role: Role; plants: string[] },
  today: string = new Date().toISOString().slice(0, 10)
): boolean {
  if (a.withdrawnAt) return false;
  if (a.expiresOn && a.expiresOn < today) return false;

  if (a.audience.userIds.length) return a.audience.userIds.includes(user.id);

  if (a.audience.roles !== "all" && !a.audience.roles.includes(user.role)) return false;

  if (a.audience.plants.length) {
    // An office role carries no plant. A notice aimed at a plant is not
    // aimed at them, and sending it anyway is how people learn to ignore
    // these.
    if (!user.plants.length) return false;
    if (!user.plants.some((p) => a.audience.plants.includes(p))) return false;
  }
  return true;
}

export function unreadFor(
  list: Announcement[],
  user: { id: string; role: Role; plants: string[] },
  today?: string
): Announcement[] {
  return list
    .filter((a) => isFor(a, user, today) && !a.readBy.includes(user.id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

/** Plain-text body for the email, so it reads properly with images off. */
export function emailText(a: Announcement, forName: string): string {
  const kind = ANNOUNCEMENT_KINDS.find((k) => k.id === a.kind)?.label || "Notice";
  return [
    `${forName},`,
    "",
    `${kind}: ${a.title}`,
    "",
    a.body,
    "",
    "— Biome Industria Private Limited",
    "Sent from the Biome Platform. You can also see this when you next open the app.",
  ].join("\n");
}
