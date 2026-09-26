"use client";

import { BookOpen } from "lucide-react";
import TallyLedgerTable from "@/components/tally/TallyLedgerTable";

export default function LedgersPage() {
  return (
    <TallyLedgerTable
      title="Ledgers"
      description="Every ledger master in Tally — all groups — with opening and closing balances fetched live. Use search to jump to a specific party."
      icon={BookOpen}
    />
  );
}
