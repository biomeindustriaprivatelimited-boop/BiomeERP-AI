"use client";

import { motion } from "framer-motion";
import { LucideIcon, ArrowUpRight } from "lucide-react";
import GlassCard from "@/components/GlassCard";

export default function ModuleComingSoon({
  icon: Icon,
  title,
  description,
  stepsTitle,
  steps,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  stepsTitle: string;
  steps: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl pt-6">
      <GlassCard activeBorder className="p-8 text-center md:p-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto mb-5 w-fit rounded-2xl bg-biome-leaf/12 p-4"
        >
          <Icon size={28} className="text-biome-leafBright" />
        </motion.div>
        <h1 className="font-display text-2xl font-semibold text-biome-text">
          {title}
        </h1>
        <span className="mt-2 inline-block rounded-full border border-biome-bolt/30 bg-biome-bolt/10 px-3 py-1 text-[11px] font-medium text-biome-bolt">
          In Development on This Platform
        </span>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-biome-muted">
          {description}
        </p>
      </GlassCard>

      <GlassCard delay={0.1} className="mt-4 p-6">
        <h2 className="mb-3 font-display text-sm font-medium text-biome-text">
          {stepsTitle}
        </h2>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-sm text-biome-muted"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 font-mono text-[11px] text-biome-leafBright">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <a
          href="#"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-biome-skyBright hover:underline"
        >
          Open the working tool (Streamlit app) <ArrowUpRight size={14} />
        </a>
      </GlassCard>
    </div>
  );
}
