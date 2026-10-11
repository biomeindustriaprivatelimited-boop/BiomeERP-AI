"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LedgerStatement from "@/components/tally/LedgerStatement";

/** /ledgers/statement?ledger=<Tally ledger name> — finance only (the
 *  /ledgers page rule in lib/permissions.ts covers this path). */
function StatementFromQuery() {
  const params = useSearchParams();
  return <LedgerStatement initialLedger={params.get("ledger") || ""} />;
}

export default function LedgerStatementPage() {
  return (
    <Suspense fallback={null}>
      <StatementFromQuery />
    </Suspense>
  );
}
