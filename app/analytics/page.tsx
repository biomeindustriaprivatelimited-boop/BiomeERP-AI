"use client";

import { TrendingUp } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function AnalyticsPage() {
  return (
    <ComingSoonPage
      title="Analytics"
      description="Cross-module charts once there's enough real, connected data behind them — sales, purchases, cash flow, and more."
      icon={TrendingUp}
      plannedFeatures={[
        "Monthly sales & purchase trends",
        "Cash flow and profit views",
        "OCR accuracy trends (this one can use real data already in the app)",
        "The rest need real financial data connected first — nothing shown here will be invented",
      ]}
    />
  );
}
