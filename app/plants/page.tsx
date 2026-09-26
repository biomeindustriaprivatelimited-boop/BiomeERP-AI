"use client";

import SheetGrid from "@/components/plant/SheetGrid";

/**
 * Biomass purchase, per plant.
 *
 * Raw material bought from local farmers. Rewari and Gangakhed keep
 * genuinely different books, so the grid switches schema with the plant
 * rather than showing one plant columns it does not use.
 */
export default function PlantsPage() {
  return (
    <div className="mx-auto max-w-[1500px] pb-8 pt-1">
      <SheetGrid
        kind="biomass"
        storageKey="biome:plant"
        title="Biomass Purchase"
        subtitle="Material bought from local farmers, entered the way each plant already records it. Fill the white cells; the shaded ones work themselves out."
      />
    </div>
  );
}
