"use client";

import { UserCheck } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function CustomersPage() {
  return (
    <ComingSoonPage
      title="Customers"
      description="A directory of briquette/pellet buyers, with sales history and outstanding receivables."
      icon={UserCheck}
      plannedFeatures={[
        "Customer directory with contact and GSTIN details",
        "Outstanding receivables per customer",
        "Sales/order history and document trail",
        "Needs a customer master data source to connect to first",
      ]}
    />
  );
}
