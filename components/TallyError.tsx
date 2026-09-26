"use client";

import Link from "next/link";
import { Plug, ArrowUpRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/** Shown wherever a page depends on Tally and can't reach it. */
export default function TallyError({ error }: { error: string }) {
  return (
    <GlassCard className="border-biome-bolt/25 p-4">
      <div className="flex items-start gap-3">
        <Plug size={16} className="mt-0.5 shrink-0 text-biome-bolt" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-biome-text">Tally isn&apos;t reachable</p>
          <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">{error}</p>
          <Link
            href="/settings"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-biome-leafBright hover:underline"
          >
            Open Tally settings <ArrowUpRight size={11} />
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}
