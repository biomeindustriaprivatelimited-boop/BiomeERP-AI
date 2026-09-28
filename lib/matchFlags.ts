/**
 * Plant ↔ coordination mismatches that nobody fixed — the red flags
 * -------------------------------------------------------------------
 * plantMatch.ts says, row by row, whether the plant's dispatch sheet and the
 * coordination manufacturing register agree. This file adds TIME to that:
 *
 *   - a mismatch gets FLAG_AFTER_DAYS (3) days, counted from the dispatch /
 *     trip date, for the plant manager or the coordinator to fix it (edit
 *     the vehicle, date or weight) or to explain it (a short note);
 *   - after that it is FLAGGED: a red flag on both teams' rows, and a line
 *     on the Mismatches screen for accounts / admin / developer, who can
 *     send the responsible people a notice in the app, by email or by
 *     WhatsApp.
 *
 * Only the first-seen date, notes and the notice history are stored here —
 * never either side's figures. Those are always recomputed from the two
 * books, so a fixed row drops off by itself.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic } from "@/lib/dataRoot";
import type { MatchPair } from "@/lib/plantMatch";

export const FLAG_AFTER_DAYS = 3;

export interface FlagNote { text: string; by: string; byName: string; side: "plant" | "coordination" | "office"; at: string }
export interface FlagNotice { at: string; by: string; byName: string; channel: "app" | "email" | "whatsapp" | "whatsapp_link"; to: string; toName: string; ok: boolean; error?: string }

interface FlagRecord {
  firstSeen: string;
  notes: FlagNote[];
  notices: FlagNotice[];
  /** A note that closes the question ("vehicle went to a trading client"). */
  explained: boolean;
}

interface FlagFile {
  records: Record<string, FlagRecord>;
  /** Contacts the office typed once, remembered per user id. */
  contacts: Record<string, { email: string; phone: string }>;
  updatedAt?: string;
}

function file() { return path.join(paths.configDir, "plant-match-flags.json"); }

export function loadFlagFile(): FlagFile {
  const f = readJson<Partial<FlagFile>>(file(), {});
  return {
    records: f.records && typeof f.records === "object" ? f.records : {},
    contacts: f.contacts && typeof f.contacts === "object" ? f.contacts : {},
  };
}

export function saveFlagFile(f: FlagFile) {
  writeJsonAtomic(file(), { ...f, updatedAt: new Date().toISOString() });
}

/** One key per row on either side. */
export function pairKey(p: Pick<MatchPair, "plantKey" | "tripId" | "plant">): string {
  return p.plantKey ? `P:${p.plant}:${p.plantKey}` : `T:${p.tripId}`;
}

export interface FlaggedPair extends MatchPair {
  key: string;
  /** Dispatch or trip date the clock runs from. */
  since: string;
  ageDays: number;
  flagged: boolean;
  explained: boolean;
  notes: FlagNote[];
  notices: FlagNotice[];
}

const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (d: string) => Math.max(0, Math.floor((Date.parse(today() + "T00:00:00Z") - Date.parse(d + "T00:00:00Z")) / 86400000));

/**
 * Decorate each pair with its age and flag, remembering when a mismatch was
 * first seen and forgetting every row that now matches.
 */
export function withFlags(pairs: MatchPair[], opts: { persist?: boolean } = {}): FlaggedPair[] {
  const f = loadFlagFile();
  let changed = false;
  const live = new Set<string>();
  const out: FlaggedPair[] = pairs.map((p) => {
    const key = pairKey(p);
    const since = (p.dispatch?.date || p.trip?.date || today()).slice(0, 10);
    if (p.status === "matched") {
      return { ...p, key, since, ageDays: 0, flagged: false, explained: false, notes: [], notices: [] };
    }
    live.add(key);
    let rec = f.records[key];
    if (!rec) { rec = { firstSeen: new Date().toISOString(), notes: [], notices: [], explained: false }; f.records[key] = rec; changed = true; }
    const ageDays = daysSince(since);
    return {
      ...p, key, since, ageDays,
      flagged: ageDays >= FLAG_AFTER_DAYS && !rec.explained,
      explained: rec.explained, notes: rec.notes, notices: rec.notices,
    };
  });
  // A row that matches now (or no longer exists) is fixed — drop its record.
  for (const k of Object.keys(f.records)) {
    if (!live.has(k)) { delete f.records[k]; changed = true; }
  }
  if (changed && opts.persist !== false) saveFlagFile(f);
  return out;
}

export function addNote(key: string, note: FlagNote, explained: boolean): boolean {
  const f = loadFlagFile();
  const rec = f.records[key];
  if (!rec) return false;
  rec.notes.push(note);
  if (explained) rec.explained = true;
  saveFlagFile(f);
  return true;
}

export function reopen(key: string): boolean {
  const f = loadFlagFile();
  const rec = f.records[key];
  if (!rec) return false;
  rec.explained = false;
  saveFlagFile(f);
  return true;
}

export function logNotice(key: string, n: FlagNotice) {
  const f = loadFlagFile();
  const rec = f.records[key];
  if (!rec) return;
  rec.notices.push(n);
  saveFlagFile(f);
}

export function rememberContact(userId: string, c: { email?: string; phone?: string }) {
  const f = loadFlagFile();
  const cur = f.contacts[userId] || { email: "", phone: "" };
  f.contacts[userId] = { email: c.email ?? cur.email, phone: c.phone ?? cur.phone };
  saveFlagFile(f);
}
