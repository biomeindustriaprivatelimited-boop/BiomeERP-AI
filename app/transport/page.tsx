"use client";

import { Truck } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function TransportPage() {
  return (
    <ComingSoonPage
      title="Transport"
      description="Truck-level tracking for biomass feedstock deliveries — the same trucks that show up on lab/test reports like the NTPC coal-and-combustion reports, in one dashboard."
      icon={Truck}
      plannedFeatures={[
        "Truck ID / registration number tracking across deliveries",
        "Delivery status and unloading dates",
        "Cross-reference against OCR-scanned lab/test reports",
        "Needs a transport records data source to connect to first",
      ]}
    />
  );
}
