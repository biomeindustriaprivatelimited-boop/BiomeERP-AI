"use client";

import { Wallet } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function PaymentsPage() {
  return (
    <ComingSoonPage
      title="Payments"
      description="Track payments made and received against invoices — due dates, overdue alerts, and payment status at a glance."
      icon={Wallet}
      plannedFeatures={[
        "Payment status per invoice (paid / partial / overdue)",
        "Due-date reminders and overdue alerts",
        "Payment history tied to each vendor/customer",
        "Needs a real payments data source to connect to first",
      ]}
    />
  );
}
