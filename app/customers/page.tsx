"use client";

import { UserCheck } from "lucide-react";
import TallyLedgerTable from "@/components/tally/TallyLedgerTable";

export default function CustomersPage() {
  return (
    <TallyLedgerTable
      title="Customers"
      description="Every ledger under Tally's Sundry Debtors group — briquette/pellet buyers and other customers — with opening and closing balances fetched live from Tally."
      icon={UserCheck}
      groupKeywords={["sundry debtor", "debtor"]}
    />
  );
}
