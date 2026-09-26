"use client";

import SheetGrid from "@/components/plant/SheetGrid";

/**
 * Transport.
 *
 * Not every trip is a delivery — vehicles also go out for machine
 * repairs and other errands, so each row records its purpose. Freight is
 * calculated on the LOWER of the dispatch and receiving weights, which
 * is how the plant's own sheet works.
 */
export default function TransportPage() {
  return (
    <div className="mx-auto max-w-[1500px] pb-8 pt-1">
      <SheetGrid
        kind="transport"
        storageKey="biome:transport"
        title="Transport"
        subtitle="Trips, drivers and freight. Amount is worked out on the lower of the dispatch and receiving weights — freight is never paid on material that didn't arrive."
      />
    </div>
  );
}
