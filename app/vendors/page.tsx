"use client";

import { Users } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function VendorsPage() {
  return (
    <ComingSoonPage
      title="Vendors"
      description="A directory of feedstock suppliers and other vendors, with outstanding balances pulled from reconciliation and GST data."
      icon={Users}
      plannedFeatures={[
        "Vendor directory with contact and GSTIN details",
        "Outstanding balance per vendor (from reconciliation runs)",
        "Purchase history and document trail per vendor",
        "Needs a vendor master data source to connect to first",
      ]}
    />
  );
}
