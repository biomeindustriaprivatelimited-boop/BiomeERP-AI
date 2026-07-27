"use client";

import { FolderOpen } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function ReportsPage() {
  return (
    <ComingSoonPage
      title="Reports"
      description="A single archive of every Excel/PDF report generated across the app — OCR exports, reconciliation summaries, GST reports — instead of them only living in your downloads folder."
      icon={FolderOpen}
      plannedFeatures={[
        "Archive of every report generated in OCR Scanner, Reconciliation, and GST Compliance",
        "Re-download past reports without regenerating them",
        "Filter by module, date, or document",
        "Needs a storage layer to keep generated files — currently everything downloads directly to your device",
      ]}
    />
  );
}
