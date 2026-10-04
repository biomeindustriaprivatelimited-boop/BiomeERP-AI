"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Factory, Truck, Wallet, Package, PackagePlus, Handshake, CalendarCheck, Users,
  CalendarDays, BarChart3, Flag, LifeBuoy, FileText, Inbox, ArrowUpRight,
  AlertTriangle, Sprout, Snowflake, type LucideIcon,
} from "lucide-react";
import { Stagger, Item, TiltCard, CountUp } from "@/components/motion/kit";
import { useSession } from "@/lib/session";
import { usePlants } from "@/lib/usePlants";

/**
 * Plant home — where a plant manager lands after signing in.
 *
 * Before this, "/" for a plant manager went straight into the biomass
 * sheet, so everything else they are allowed to do (transport, imprest,
 * stock, registration, attendance…) had to be found through the menu.
 *
 * Two rows:
 *   1. A few of today's plant figures, read from endpoints the plant
 *      sheets already use — no new backend. A figure whose endpoint the
 *      person may not call is simply not shown.
 *   2. Shortcut tiles. Each tile is drawn only if session.visible() says
 *      the person can open it (permission held, module not frozen / off),
 *      so nothing here ever leads to a refusal page.
 */

interface Tile {
  href: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  /** Extra permission beyond the route's own (e.g. imprest.entry). */
  perm?: string;
  tone: string;
}

const TILES: Tile[] = [
  { href: "/plants", label: "Biomass entry", sub: "Today's purchase sheet — weights, deductions, slip check", icon: Factory, tone: "from-emerald-500/25 to-lime-400/10" },
  { href: "/transport", label: "Transport entry", sub: "Vehicles out — dispatch weight, freight, driver", icon: Truck, tone: "from-orange-500/25 to-amber-400/10" },
  { href: "/imprest", label: "Plant imprest", sub: "File a new expense, see the plant's floats", icon: Wallet, perm: "imprest.entry", tone: "from-teal-500/25 to-cyan-400/10" },
  { href: "/stock", label: "Stock · receive & issue", sub: "Spare-part GRN, issue to a machine, balances", icon: PackagePlus, tone: "from-lime-500/25 to-emerald-400/10" },
  { href: "/partners", label: "Registration", sub: "Register vendors & transporters with KYC", icon: Handshake, tone: "from-green-600/25 to-lime-400/10" },
  { href: "/followups", label: "Follow-ups", sub: "Pending papers from vendors — ask in one click", icon: Inbox, tone: "from-sky-500/25 to-blue-400/10" },
  { href: "/attendance", label: "Attendance", sub: "Mark today for your site", icon: CalendarCheck, perm: "attendance.entry", tone: "from-sky-500/25 to-indigo-400/10" },
  { href: "/employees", label: "Employees", sub: "Staff at the plant, KYC papers", icon: Users, tone: "from-blue-500/25 to-sky-400/10" },
  { href: "/leave", label: "Leave", sub: "Apply and decide leave", icon: CalendarDays, tone: "from-indigo-500/25 to-violet-400/10" },
  { href: "/report-builder", label: "Reports", sub: "Biomass, transport, stock, imprest — PDF & Excel", icon: BarChart3, tone: "from-violet-500/25 to-fuchsia-400/10" },
  { href: "/mismatches", label: "Mismatches", sub: "Plant ↔ coordination differences", icon: Flag, tone: "from-rose-500/25 to-orange-400/10" },
  { href: "/documents", label: "Documents", sub: "Search what has been filed", icon: FileText, tone: "from-emerald-500/20 to-teal-400/10" },
  { href: "/support", label: "Help & Support", sub: "Guides and tickets", icon: LifeBuoy, tone: "from-slate-500/25 to-zinc-400/10" },
];

interface Kpi { label: string; value: number; sub: string; href: string; icon: LucideIcon; warn?: boolean }

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Rows touched today. Plant rows carry an ISO `updatedAt`; compared in local time. */
function touchedToday(rows: any[]): number {
  const t = today();
  return rows.filter((r) => {
    if (!r?.updatedAt) return false;
    const d = new Date(r.updatedAt);
    if (isNaN(d.getTime())) return false;
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return local === t;
  }).length;
}

export default function PlantHomePage() {
  const { user, plant, visible, switchFor } = useSession();
  const PLANTS = usePlants();
  const [kpis, setKpis] = useState<Kpi[] | null>(null);
  const plantLabel = plant ? PLANTS.find((p) => p.code === plant)?.label ?? plant : null;

  const tiles = TILES.filter((t) => visible(t.href, t.perm));

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      const q = plant ? `&plant=${encodeURIComponent(plant)}` : "";
      const jobs: Promise<Kpi | null>[] = [];
      if (visible("/plants")) {
        jobs.push(getJson(`/api/plant-data?kind=biomass${q}`).then((j) => j && Array.isArray(j.rows)
          ? { label: "Biomass entries today", value: touchedToday(j.rows), sub: `${j.rows.length} in the sheet`, href: "/plants", icon: Sprout } : null));
        jobs.push(getJson(`/api/plant-data?kind=transport${q}`).then((j) => j && Array.isArray(j.rows)
          ? { label: "Transport entries today", value: touchedToday(j.rows), sub: `${j.rows.length} in the sheet`, href: "/transport", icon: Truck } : null));
        jobs.push(getJson(`/api/plant-match?side=plant${q}`).then((j) => {
          if (!j?.summary) return null;
          const open = (j.summary.unmatched || 0) + (j.summary.weightDiffers || 0);
          return { label: "Open vehicle mismatches", value: open, sub: j.flagged ? `${j.flagged} red-flagged (over ${j.flagAfterDays ?? 3} days)` : `${j.summary.matched || 0} matched`, href: "/transport", icon: AlertTriangle, warn: open > 0 };
        }));
      }
      if (visible("/stock")) {
        jobs.push(getJson(`/api/stock${plant ? `?plant=${encodeURIComponent(plant)}` : ""}`).then((j) => {
          if (!j?.summary) return null;
          const low = (j.summary.low || 0) + (j.summary.out || 0);
          return { label: "Low / out-of-stock parts", value: low, sub: `${j.summary.items || 0} items tracked`, href: "/stock", icon: Package, warn: low > 0 };
        }));
      }
      const got = (await Promise.all(jobs)).filter((k): k is Kpi => Boolean(k));
      if (live) setKpis(got);
    })();
    return () => { live = false; };
    // visible() is rebuilt with the session; the user id + plant are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, plant]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-10 pt-1">
      {/* ---- Hero ---- */}
      <motion.header
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl bg-[#163300] p-6 text-white sm:p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#9fe870]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-[#9fe870]">
              {plantLabel ? `${plantLabel} plant` : "Plant"} · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
            </p>
            <h1 className="biome-shout mt-2 text-[30px] leading-none sm:text-[38px]">
              {greet}, {user?.name?.split(" ")[0] || "there"}<span className="text-[#9fe870]">.</span>
            </h1>
            <p className="mt-2 max-w-[560px] text-[12.5px] text-[#e2f6d5]/75">
              Everything for your plant in one place — open a sheet, file an expense or check stock.
            </p>
          </div>
          {visible("/plants") && (
            <Link href="/plants" className="bmx-btn flex items-center gap-2 rounded-2xl bg-[#9fe870] px-5 py-3 text-[12.5px] font-bold text-[#163300]">
              <Factory size={16} /> New biomass entry <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      </motion.header>

      {/* ---- Today's figures ---- */}
      {(kpis === null || kpis.length > 0) && (
        <section aria-label="Today at the plant">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(kpis ?? [null, null, null, null]).map((k, i) => (
              <motion.div key={k?.label ?? i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05 }}>
                {k ? (
                  <Link href={k.href} data-kpi={k.label}
                    className={`bmx-card group flex h-full items-start gap-3 rounded-2xl border p-4 transition-colors ${
                      k.warn ? "border-amber-500/35 bg-amber-500/[.06]" : "border-biome-line bg-biome-bgSoft"
                    }`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${k.warn ? "bg-amber-500/15 text-amber-600" : "bg-[#9fe870]/15 text-biome-leafBright"}`}>
                      <k.icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-[.08em] text-biome-muted">{k.label}</span>
                      <CountUp to={k.value} className="mt-0.5 block font-display text-[26px] font-bold leading-tight text-biome-text" />
                      <span className="block truncate text-[10.5px] text-biome-muted">{k.sub}</span>
                    </span>
                    <ArrowUpRight size={14} className="text-biome-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <div className="h-[92px] animate-pulse rounded-2xl border border-biome-line bg-biome-bgSoft" />
                )}
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Shortcuts ---- */}
      <section aria-label="Shortcuts">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="biome-shout text-[22px] leading-none text-biome-text">Shortcuts<span className="text-biome-leafBright">.</span></h2>
          <p className="text-[11px] text-biome-muted">{tiles.length} open for you</p>
        </div>
        {tiles.length === 0 ? (
          <p className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-6 text-center text-[12px] text-biome-muted">
            Nothing is assigned to this account yet. Ask the admin to activate what you need.
          </p>
        ) : (
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" gap={0.04}>
            {tiles.map((t) => {
              const sw = user?.role === "developer" ? switchFor(t.href) : null;
              return (
                <Item key={t.href}>
                  <Link href={t.href} data-tile={t.href} className="group block h-full">
                    <TiltCard max={7} className={`bmx-card h-full rounded-3xl bg-gradient-to-br ${t.tone} p-5`}>
                      <div className="flex items-start justify-between">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-biome-bg/70 text-biome-leafBright shadow-inner">
                          <t.icon size={22} />
                        </span>
                        {sw ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[9px] font-bold uppercase text-sky-500">
                            <Snowflake size={9} /> {sw.state === "off" ? "Off" : "Frozen"}
                          </span>
                        ) : (
                          <ArrowUpRight size={16} className="text-biome-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        )}
                      </div>
                      <p className="mt-4 text-[15px] font-bold leading-tight text-biome-text">{t.label}</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">{t.sub}</p>
                    </TiltCard>
                  </Link>
                </Item>
              );
            })}
          </Stagger>
        )}
      </section>
    </div>
  );
}
