"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";
import { useSession } from "@/lib/session";

/**
 * "View Tally ledger" — opens /ledgers/statement for this name. Shown only
 * to people who may read Tally ledgers (finance + tally), so vendor / client
 * pages can drop it in without their own permission checks.
 */
export default function TallyLedgerLink({ name, className = "" }: { name: string; className?: string }) {
  const { can } = useSession();
  if (!name || !can("finance") || !can("tally")) return null;
  return (
    <Link
      href={`/ledgers/statement?ledger=${encodeURIComponent(name)}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-[10.5px] font-medium text-biome-leafBright hover:underline ${className}`}
      title="Open this party's ledger from Tally"
    >
      <ScrollText size={11} /> View Tally ledger
    </Link>
  );
}
