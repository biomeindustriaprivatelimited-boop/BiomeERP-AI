/**
 * Biome Platform — organisation masters (server only)
 * -------------------------------------------------------------------
 * Departments, designations and work locations, held as lists rather than
 * typed freehand on every employee form.
 *
 * The reason is not tidiness. "Plant Supervisor", "plant supervisor" and
 * "Plant Suprvisor" are three departments as far as any report is
 * concerned, and a payroll grouped by a typo is a payroll nobody trusts.
 * A work location also carries its state, which is what decides the
 * professional tax slab and the minimum wage floor — so it has to be a
 * record, not a string.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export interface Department { id: string; name: string; active: boolean; }
export interface Designation { id: string; name: string; department: string; active: boolean; }

export interface WorkLocation {
  id: string;
  name: string;
  /** Plant code when this location is one of the plants; blank for offices. */
  plantCode: string;
  state: string;
  /** Two-letter key into lib/wages.ts — HR, MH. */
  stateKey: string;
  address: string;
  active: boolean;
}

export interface OrgMasters {
  departments: Department[];
  designations: Designation[];
  workLocations: WorkLocation[];
  updatedAt?: string;
}

function file() { return path.join(paths.configDir, "organisation.json"); }

/**
 * Seeded with what the business already has, so the employee form is
 * usable on the first run instead of presenting three empty dropdowns.
 */
function seed(): OrgMasters {
  const dept = (name: string): Department => ({ id: crypto.randomUUID(), name, active: true });
  const departments = [
    "Plant Operations", "Supply & Procurement", "Transport & Logistics",
    "Accounts & Finance", "Coordination", "Administration", "Quality & Lab",
  ].map(dept);

  const byName = (n: string) => departments.find((d) => d.name === n)?.name || "";
  const desig = (name: string, department: string): Designation => ({
    id: crypto.randomUUID(), name, department, active: true,
  });

  return {
    departments,
    designations: [
      desig("Plant Manager", byName("Plant Operations")),
      desig("Plant Supervisor", byName("Plant Operations")),
      desig("Machine Operator", byName("Plant Operations")),
      desig("Helper / Labour", byName("Plant Operations")),
      desig("Purchase Officer", byName("Supply & Procurement")),
      desig("Weighbridge Operator", byName("Supply & Procurement")),
      desig("Transport Incharge", byName("Transport & Logistics")),
      desig("Driver", byName("Transport & Logistics")),
      desig("Accounts Executive", byName("Accounts & Finance")),
      desig("Accounts Manager", byName("Accounts & Finance")),
      desig("Coordinator", byName("Coordination")),
      desig("Office Assistant", byName("Administration")),
      desig("Lab Technician", byName("Quality & Lab")),
    ],
    workLocations: [
      {
        id: crypto.randomUUID(), name: "Rewari Plant", plantCode: "REW",
        state: "Haryana", stateKey: "HR", address: "Rewari, Haryana", active: true,
      },
      {
        id: crypto.randomUUID(), name: "Gangakhed Plant", plantCode: "GKD",
        state: "Maharashtra", stateKey: "MH", address: "Gangakhed, Parbhani, Maharashtra", active: true,
      },
      {
        id: crypto.randomUUID(), name: "Head Office", plantCode: "",
        state: "Haryana", stateKey: "HR", address: "Rewari, Haryana", active: true,
      },
    ],
  };
}

export function loadOrg(): OrgMasters {
  const stored = readJson<Partial<OrgMasters>>(file(), {});
  if (!stored.departments && !stored.designations && !stored.workLocations) {
    const seeded = seed();
    saveOrg(seeded);
    return seeded;
  }
  return {
    departments: stored.departments || [],
    designations: stored.designations || [],
    workLocations: stored.workLocations || [],
    updatedAt: stored.updatedAt,
  };
}

export function saveOrg(org: OrgMasters): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { ...org, updatedAt: new Date().toISOString() });
}

/** The state key for a work location, used for wages and professional tax. */
export function stateKeyForLocation(locationName: string): string {
  const loc = loadOrg().workLocations.find((l) => l.name === locationName);
  return loc?.stateKey || "";
}
