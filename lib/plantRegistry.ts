/**
 * Plants as the sheets and folders see them (server only).
 *
 * The plant master (lib/plants.ts) is the list; this maps each plant to
 * its sheet folder ("slug") and its biomass-sheet layout. The two first
 * plants keep their historic folder names so years of entries still load:
 *
 *   REW (Mayan, Haryana)   → folder "rewari",    dust + moisture layout
 *   GKD (Gangakhed)        → folder "gangakhed", standard layout
 *   any plant added later  → folder = its code in lower case, standard layout
 */
import { loadPlants, type Plant } from "@/lib/plants";
import { REWARI_COLUMNS, GANGAKHED_COLUMNS, type SheetColumn } from "@/lib/plantSheets";

const LEGACY: Record<string, string> = { REW: "rewari", GKD: "gangakhed" };

export function slugForCode(code: string | null | undefined): string | null {
  const c = String(code || "").toUpperCase();
  if (!c) return null;
  if (LEGACY[c]) return LEGACY[c];
  return loadPlants().some((p) => p.code === c) ? c.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
}

export function codeForSlug(slug: string | null | undefined): string | null {
  const s = String(slug || "").toLowerCase();
  for (const [code, legacy] of Object.entries(LEGACY)) if (legacy === s) return code;
  const hit = loadPlants().find((p) => p.code.toLowerCase().replace(/[^a-z0-9]/g, "") === s);
  return hit ? hit.code : null;
}

export interface SheetPlant {
  id: string;
  code: string;
  name: string;
  state: string;
  layout: "rewari" | "standard";
  biomass: SheetColumn[];
}

function toSheet(p: Plant): SheetPlant {
  const layout = p.code === "REW" ? "rewari" : "standard";
  return {
    id: slugForCode(p.code)!, code: p.code, name: `${p.label} Plant`.replace(/ Plant Plant$/, " Plant"),
    state: p.location || p.state, layout, biomass: layout === "rewari" ? REWARI_COLUMNS : GANGAKHED_COLUMNS,
  };
}

export function sheetPlants(): SheetPlant[] {
  return loadPlants().filter((p) => p.active).map(toSheet);
}

export function sheetPlant(slug: string): SheetPlant | null {
  const code = codeForSlug(slug);
  const p = code ? loadPlants().find((x) => x.code === code) : null;
  return p ? toSheet(p) : null;
}

export function allSlugs(): string[] {
  return sheetPlants().map((p) => p.id);
}
