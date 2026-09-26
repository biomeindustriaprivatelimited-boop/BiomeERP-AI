"use client";

import { Wallet } from "lucide-react";
import TallyVoucherTable from "@/components/tally/TallyVoucherTable";

export default function PaymentsPage() {
  return (
    <TallyVoucherTable
      title="Payments"
      description="Payment and Receipt vouchers fetched live from Tally for the selected date range."
      icon={Wallet}
      voucherTypeKeywords={["payment", "receipt"]}
    />
  );
}
