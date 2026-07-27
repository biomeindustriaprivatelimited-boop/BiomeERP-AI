"use client";

import { BookOpen } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function LedgersPage() {
  return (
    <ComingSoonPage
      title="Ledgers"
      description="A persistent view of every ledger you've ever reconciled, instead of a one-off upload-and-forget flow — with history, running balances, and trend lines."
      icon={BookOpen}
      plannedFeatures={[
        "Saved ledger history across reconciliation runs",
        "Running balance and entry-count trends over time",
        "Drill-down into any past reconciliation session",
        "Needs a persistence layer — currently reconciliation results aren't saved anywhere",
      ]}
    />
  );
}
