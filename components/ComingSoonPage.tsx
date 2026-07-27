"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { Construction } from "lucide-react";

export default function ComingSoonPage({
  title,
  description,
  icon: Icon,
  plannedFeatures,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  plannedFeatures: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl pt-6">
      <GlassCard activeBorder className="overflow-hidden p-8 text-center md:p-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-biome-leaf/10"
        >
          <Icon size={30} className="text-biome-leafBright" />
        </motion.div>
        <h1 className="font-display text-2xl font-semibold text-biome-text md:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-biome-muted">{description}</p>

        <div className="mx-auto mt-6 inline-flex items-center gap-1.5 rounded-full border border-biome-bolt/30 bg-biome-bolt/10 px-3 py-1.5 text-[11px] font-medium text-biome-bolt">
          <Construction size={12} /> Coming soon — no live data connected yet
        </div>

        <div className="mx-auto mt-8 max-w-sm text-left">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-biome-muted">
            Planned for this module
          </p>
          <ul className="space-y-2">
            {plannedFeatures.map((f, i) => (
              <motion.li
                key={f}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.06 }}
                className="flex items-start gap-2 text-xs text-biome-muted"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-biome-leafBright" />
                {f}
              </motion.li>
            ))}
          </ul>
        </div>
      </GlassCard>
    </div>
  );
}
