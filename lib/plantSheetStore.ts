/**
 * Plant sheets — storage, who may do what, and edit requests (server only).
 * -------------------------------------------------------------------
 * Shared by /api/plant-data (entry and submit), its import and its
 * edit-request routes, and the Excel export, so all four read the same
 * file and apply the same rule.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { allSlugs } from "@/lib/plantRegistry";
import { loadUsers, type User } from "@/lib/authServer";
import { userCan } from "@/lib/access";
import { loadAnnouncements, saveAnnouncements, makeAnnouncement } from "@/lib/announcements";
import { slugToCode } from "@/lib/plantScope";

export type SheetKind = "biomass" | "transport";

export interface SheetRow extends Record<string, any> {
  id: string;
  updatedAt: string;
}

export function plantFile(kind: "vendors" | SheetKind, plant: string) {
  const slugs = allSlugs();
  const safe = slugs.includes(plant) ? plant : slugs[0] || "rewari";
  return path.join(paths.configDir, "plants", `${safe}-${kind}.json`);
}

export function readList<T>(file: string, key: string): T[] {
  const data = readJson<Record<string, T[]>>(file, {} as any);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

export function writeList<T>(file: string, key: string, list: T[]) {
  ensureDir(path.dirname(file));
  writeJsonAtomic(file, { [key]: list, updatedAt: new Date().toISOString() });
}

let seq = 0;
export function newRowId(kind: SheetKind): string {
  seq = (seq + 1) % 100000;
  return `${kind}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The plant's rows. A row saved before ids were stable is given one here
 * and the file rewritten once, so a submit or an edit request always
 * points at the same consignment.
 */
export function readRows(kind: SheetKind, plant: string): SheetRow[] {
  const file = plantFile(kind, plant);
  const rows = readList<SheetRow>(file, "rows");
  let fixed = false;
  for (const r of rows) {
    if (!r.id) { r.id = newRowId(kind); fixed = true; }
  }
  if (fixed) writeList(file, "rows", rows);
  return rows;
}

export function writeRows(kind: SheetKind, plant: string, rows: SheetRow[]) {
  writeList(plantFile(kind, plant), "rows", rows);
}

/* ------------------------------------------------------------------ */
/* Who                                                                 */
/* ------------------------------------------------------------------ */

/** Enters and changes rows: the plant manager, and the developer. */
export function isEntryRole(role: string): boolean {
  return role === "plant_manager" || role === "developer";
}

/** Decides edit requests on frozen rows — and is never held by the freeze. */
export function canUnlock(user: Pick<User, "role" | "access"> | null | undefined): boolean {
  return !!user && userCan(user.role, user.access, "plant.unlock");
}

/**
 * Everyone who could approve a request for this plant: holds plant.unlock
 * and can actually read that plant (an office role, or a person assigned
 * to it). Decided per person, so a new role or a one-off grant counts the
 * day it is given.
 */
export function approversFor(plantSlug: string): User[] {
  const code = slugToCode(plantSlug);
  return loadUsers().filter(
    (u) =>
      u.active && !u.deleted && canUnlock(u) &&
      (userCan(u.role, u.access, "finance") || (code ? (u.plants || []).includes(code) : false))
  );
}

/** An in-app notice to named people (shown in their notices strip). */
export function noticeTo(
  userIds: string[],
  input: { title: string; body: string; kind?: "info" | "warning" | "update"; by: { id: string; name: string } }
) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    const list = loadAnnouncements();
    const a = makeAnnouncement({
      kind: input.kind || "info",
      title: input.title,
      body: input.body,
      audience: { roles: "all", plants: [], userIds: ids },
      // A request is only news for a few days; after that it lives in the list.
      expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      by: input.by,
    });
    saveAnnouncements([a, ...list]);
  } catch {
    /* a notice is a courtesy — the request list is the record */
  }
}

/* ------------------------------------------------------------------ */
/* Edit requests                                                       */
/* ------------------------------------------------------------------ */

export interface SheetEditRequest {
  id: string;
  plant: string;
  kind: SheetKind;
  rowId: string;
  /** "12-09-2026 · HR55AB1234 · Slip 4411 · RAMESH" — what a person reads. */
  rowLabel: string;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Approved: the edit window closes at this moment (or on resubmission). */
  expiresAt?: string;
}

function requestFile() {
  return path.join(paths.root, "plant-sheets", "edit-requests.json");
}

export function loadSheetRequests(): SheetEditRequest[] {
  return readList<SheetEditRequest>(requestFile(), "requests");
}

export function saveSheetRequests(list: SheetEditRequest[]) {
  writeList(requestFile(), "requests", list.slice(0, 5000));
}

export function rowLabel(kind: SheetKind, row: Record<string, any>): string {
  const date = String(row.date || "").slice(0, 10).split("-").reverse().join("-");
  const parts =
    kind === "transport"
      ? [date, row.vehicleNo, row.kantaParchi && `Parchi ${row.kantaParchi}`, row.transporter || row.partyName]
      : [date, row.vehicleNo, row.weightSlipNo && `Slip ${row.weightSlipNo}`, row.name || row.vendorName];
  return parts.filter((p) => p && String(p).trim()).join(" · ") || `Row ${row.srNo || ""}`.trim();
}
