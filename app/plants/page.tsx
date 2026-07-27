"use client";

import { Factory } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function PlantsPage() {
  return (
    <ComingSoonPage
      title="Plants"
      description="A production dashboard for Biome's manufacturing units — Unit-1 (Rewari, Haryana) and Unit-2 (Gangakhed, Maharashtra)."
      icon={Factory}
      plannedFeatures={[
        "Per-plant production volume (briquettes / pellets)",
        "Feedstock intake and utilization by unit",
        "Capacity vs. actual output tracking",
        "Needs real production data from each unit to populate — nothing fabricated here in the meantime",
      ]}
    />
  );
}
