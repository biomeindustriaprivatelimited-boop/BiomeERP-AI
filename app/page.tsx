"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  FileCheck2,
  ScanText,
  MessagesSquare,
  Leaf,
  ArrowUpRight,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import AnimatedCounter from "@/components/AnimatedCounter";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const KPIS = [
  { label: "Matched Entries", value: 128, icon: FileCheck2, color: "text-biome-leafBright" },
  { label: "Documents Scanned", value: 42, icon: ScanText, color: "text-biome-skyBright" },
  { label: "WhatsApp Documents", value: 17, icon: MessagesSquare, color: "text-biome-bolt" },
  { label: "OCR Confidence", value: 91, suffix: "%", icon: Leaf, color: "text-biome-leafBright" },
];

const QUICK_ACTIONS = [
  {
    href: "/reconciliation",
    title: "Ledger Reconciliation",
    desc: "Match Ledger A against Ledger B across every category.",
  },
  {
    href: "/ocr",
    title: "OCR Scanner",
    desc: "Extract text from invoices, receipts and scanned documents.",
  },
  {
    href: "/whatsapp",
    title: "WhatsApp Documents",
    desc: "Browse documents auto-organized by month and client.",
  },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 pt-6">
      {/* Hero */}
      <GlassCard activeBorder className="overflow-hidden p-8 md:p-10">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-2 text-sm font-medium tracking-wide text-biome-leafBright"
        >
          {getGreeting()}, Govind
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="max-w-2xl font-display text-3xl font-semibold leading-tight text-biome-text md:text-4xl"
        >
          From biomass to balance sheets —
          <span className="bg-gradient-to-r from-biome-leafBright via-biome-bolt to-biome-skyBright bg-clip-text text-transparent">
            {" "}
            reconciled automatically.
          </span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-3 max-w-xl text-sm text-biome-muted md:text-base"
        >
          Your reconciliation, OCR and document intelligence workspace for
          Biome Industria Private Limited.
        </motion.p>
      </GlassCard>

      {/* KPI Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-medium text-biome-text">
            Overview
          </h2>
          <span className="rounded-full border border-biome-line px-2.5 py-1 text-[11px] text-biome-muted">
            Sample data — connect a live source to replace these
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {KPIS.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <GlassCard key={kpi.label} delay={i * 0.06} className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="rounded-xl bg-white/5 p-2.5">
                    <Icon size={18} className={kpi.color} />
                  </div>
                </div>
                <p className="font-mono text-2xl font-semibold text-biome-text">
                  <AnimatedCounter value={kpi.value} suffix={kpi.suffix ?? ""} />
                </p>
                <p className="mt-1 text-xs text-biome-muted">{kpi.label}</p>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">
          Quick Actions
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {QUICK_ACTIONS.map((a, i) => (
            <Link key={a.href} href={a.href}>
              <GlassCard delay={i * 0.08} className="group h-full p-5">
                <div className="flex items-start justify-between">
                  <h3 className="font-display text-base font-medium text-biome-text">
                    {a.title}
                  </h3>
                  <ArrowUpRight
                    size={16}
                    className="text-biome-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-biome-leafBright"
                  />
                </div>
                <p className="mt-2 text-sm text-biome-muted">{a.desc}</p>
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
