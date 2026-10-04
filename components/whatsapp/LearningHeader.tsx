"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, TrendingUp, FileCheck2, Users, Sparkles } from "lucide-react";

/**
 * The learning header.
 *
 * Placed at the top of the WhatsApp page because it answers the first
 * question anyone has about an agent that files their paperwork: is this
 * thing actually getting better, or am I correcting the same mistake
 * every week?
 *
 * The numbers are real counts, not a progress bar with no meaning behind
 * it. "12 corrections" means twelve times a person taught it something,
 * and each of those is weighted five times a passive observation.
 */

interface Summary {
  updatedAt: string | null;
  stats: { learned: number; corrections: number; applied: number };
  knownSenders: number;
  knownFileShapes: number;
  vendorClientLinks: number;
  topShapes: { shape: string; type: string; count: number }[];
}

export default function LearningHeader() {
  const [data, setData] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/patterns", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // The agent may be down; the header simply doesn't render.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) return null;

  const { learned, corrections, applied } = data.stats;

  // A rough sense of how settled the agent is. Deliberately coarse —
  // presenting a precise percentage would imply an accuracy measurement
  // that hasn't been made.
  const stage =
    learned < 10
      ? { label: "Getting started", tone: "text-amber-700 bg-amber-500/15 dark:text-amber-300", pct: 15 }
      : learned < 50
        ? { label: "Learning your patterns", tone: "text-blue-700 bg-blue-500/15 dark:text-blue-300", pct: 45 }
        : learned < 150
          ? { label: "Confident", tone: "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300", pct: 75 }
          : { label: "Well trained", tone: "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300", pct: 95 };

  const tiles = [
    { icon: FileCheck2, label: "Documents studied", value: learned },
    { icon: Sparkles, label: "Your corrections", value: corrections },
    { icon: TrendingUp, label: "Times it helped", value: applied },
    { icon: Users, label: "Senders known", value: data.knownSenders },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass overflow-hidden rounded-2xl"
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-biome-leaf to-biome-leafBright">
          <motion.span
            animate={{ scale: [1, 1.35, 1], opacity: [0.45, 0, 0.45] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-2xl bg-biome-leaf/50 blur-md"
          />
          <BrainCircuit size={21} className="relative text-biome-text" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[15px] font-semibold text-biome-text">
              Document Intelligence
            </h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stage.tone}`}>
              {stage.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-biome-muted">
            Learns from every document filed and every correction you make. Runs on this machine.
          </p>

          <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-biome-line/60">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stage.pct}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-biome-leaf to-biome-leafBright"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="flex items-center gap-2">
              <t.icon size={14} className="shrink-0 text-biome-muted" />
              <div className="min-w-0">
                <p className="font-display text-[17px] font-bold leading-none tabular-nums text-biome-text">
                  {t.value}
                </p>
                <p className="truncate text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                  {t.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.topShapes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-biome-line px-5 py-2.5">
          <span className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">
            Recognises
          </span>
          {data.topShapes.slice(0, 6).map((s) => (
            <span
              key={s.shape}
              title={`Filenames like ${s.shape}`}
              className="rounded-full border border-biome-line bg-biome-hover px-2 py-0.5 text-[10px] text-biome-muted"
            >
              {s.type.replace(/_/g, " ")} <span className="text-biome-muted/60">×{s.count}</span>
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
