/**
 * Biome Platform — the plant master
 * -------------------------------------------------------------------
 * Sites were a hard-coded pair (REW, GKD) in three different shapes: a
 * constant in permissions.ts, a `if (code === "REW") return "HR"` in
 * leave.ts, and whatever anyone had typed into an imprest holder record.
 * Adding a third plant meant editing code, and — worse — a site nobody
 * edited leave.ts for would silently fall through to the Delhi holiday
 * calendar and its people would be marked absent on their own state's
 * holidays.
 *
 * So a plant is a record now, and it carries the one thing that decides
 * which public holidays its people follow: the STATE it sits in.
 *
 * THE RULE THAT MATTERS HERE: a holiday belongs to a state, and a person
 * follows the state of the plant they work at. Haryana's Guru Nanak
 * Jayanti is not a holiday in Maharashtra, and marking a Gangakhed labourer
 * absent on a Rewari holiday — or paying them for a day they worked — are
 * both wrong in a way that shows up on a wage register.
 */

import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

/** The states the business currently operates in, plus the office. */
export const STATES: { code: string; label: string; help: string }[] = [
  { code: "HR", label: "Haryana", help: "Mayan (Rewari) and anything else in Haryana." },
  { code: "MH", label: "Maharashtra", help: "Gangakhed and anything else in Maharashtra." },
  { code: "DL", label: "Delhi", help: "Head office. Office roles with no plant follow this." },
  { code: "UP", label: "Uttar Pradesh", help: "" },
  { code: "PB", label: "Punjab", help: "" },
  { code: "MP", label: "Madhya Pradesh", help: "" },
  { code: "RJ", label: "Rajasthan", help: "" },
  { code: "GJ", label: "Gujarat", help: "" },
  { code: "KA", label: "Karnataka", help: "" },
  { code: "TN", label: "Tamil Nadu", help: "" },
  { code: "AP", label: "Andhra Pradesh", help: "" },
  { code: "TG", label: "Telangana", help: "" },
  { code: "WB", label: "West Bengal", help: "" },
  { code: "BR", label: "Bihar", help: "" },
  { code: "JH", label: "Jharkhand", help: "" },
  { code: "OR", label: "Odisha", help: "" },
  { code: "CG", label: "Chhattisgarh", help: "" },
  { code: "UK", label: "Uttarakhand", help: "" },
  { code: "HP", label: "Himachal Pradesh", help: "" },
  { code: "KL", label: "Kerala", help: "" },
  { code: "GA", label: "Goa", help: "" },
  { code: "AS", label: "Assam", help: "" },
];

export interface Plant {
  code: string;
  label: string;
  /** Which state's public holidays this site follows. */
  state: string;
  /** Free text — the site address or a note. Not used in any calculation. */
  location: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PlantFile { plants: Plant[]; updatedAt?: string; }

function file(): string {
  return path.join(paths.configDir, "plants.json");
}

/**
 * The two sites that already exist, with the states leave.ts used to
 * hard-code. Seeded on first read so nothing has to be set up before the
 * app works, and so the holiday calendar keeps behaving exactly as it did.
 */
function seed(): Plant[] {
  const now = new Date().toISOString();
  return [
    { code: "REW", label: "Mayan", state: "HR", location: "Mayan Village, Rewari, Haryana", active: true, createdAt: now, updatedAt: now },
    { code: "GKD", label: "Gangakhed", state: "MH", location: "Gangakhed, Maharashtra", active: true, createdAt: now, updatedAt: now },
  ];
}

export function loadPlants(): Plant[] {
  const f = readJson<PlantFile>(file(), { plants: [] });
  if (!Array.isArray(f.plants) || f.plants.length === 0) {
    const seeded = seed();
    savePlants(seeded);
    return seeded;
  }
  return f.plants.map((p) => ({
    code: String(p.code || "").toUpperCase(),
    // The first plant is the MAYAN plant (Mayan village, Rewari district).
    // Records written when it was called "Rewari" read as Mayan.
    label: String(p.code).toUpperCase() === "REW" && String(p.label || "").trim().toLowerCase() === "rewari" ? "Mayan" : String(p.label || p.code || ""),
    state: String(p.state || "DL").toUpperCase(),
    location: String(p.code).toUpperCase() === "REW" && String(p.location || "").trim().toLowerCase() === "rewari, haryana" ? "Mayan Village, Rewari, Haryana" : String(p.location || ""),
    active: p.active !== false,
    createdAt: String(p.createdAt || ""),
    updatedAt: String(p.updatedAt || ""),
  }));
}

export function savePlants(plants: Plant[]): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { plants, updatedAt: new Date().toISOString() });
}

export function plantByCode(code: string | null | undefined): Plant | undefined {
  const key = String(code || "").toUpperCase();
  return loadPlants().find((p) => p.code === key);
}

/**
 * The state whose holidays this plant follows.
 *
 * An unknown plant falls back to Delhi, which is what the old hard-coded
 * version did — but the caller can tell the difference, because
 * `plantByCode` returns nothing for a code that is not in the master.
 */
export function stateForPlant(code: string | null | undefined): string {
  if (!code) return "DL";
  return plantByCode(code)?.state || "DL";
}

/** Plants that follow a given state's calendar. */
export function plantsInState(state: string): Plant[] {
  return loadPlants().filter((p) => p.active && p.state === state.toUpperCase());
}

/** For pickers: active plants, in a stable order. */
export function plantOptions(): { code: string; label: string; state: string }[] {
  return loadPlants()
    .filter((p) => p.active)
    // Master order, not alphabetical: Mayan is plant 1, Gangakhed plant 2,
    // and a plant the developer adds later comes after them.
    .map((p) => ({ code: p.code, label: p.label, state: p.state }));
}
