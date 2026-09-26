"use client";

import { useState } from "react";
import Link from "next/link";
import BiomeLogo from "@/components/brand/BiomeLogo";
import { FEATURE_MAP } from "@/lib/featureMap";
import { ICONS } from "@/components/hub/icons";

/** next/link wrapped for framer-motion so nav items can stagger in. */
const MotionLink = motion(Link);
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import type { Permission } from "@/lib/permissions";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building,
  Building2,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Cloud,
  Factory,
  FileSearch,
  FileSignature,
  FileStack,
  FileText,
  FlaskConical,
  FolderLock,
  FolderOpen,
  FolderSearch,
  Gavel,
  GraduationCap,
  Handshake,
  Inbox,
  IndianRupee,
  LayoutDashboard,
  Leaf,
  LifeBuoy,
  ListChecks,
  Map,
  MessageSquare,
  MessageSquareText,
  MessagesSquare,
  Mic,
  Network,
  Package,
  Plane,
  Radar,
  ScanLine,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Table2,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

/**
 * Presentation navigation contains only production-facing modules. Developer
 * diagnostics remain reachable by direct route but are intentionally not
 * exposed in the main sidebar. Each item now
 * carries a tinted icon tile so the eye can find a destination by colour
 * as well as by reading, which matters on a sidebar this long.
 */
interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * The permission this destination needs. Items the signed-in role
   * cannot use are removed rather than disabled — a greyed-out Ledgers
   * link tells a plant manager exactly what to go looking for.
   * Omitted means "any signed-in user".
   */
  perm?: Permission;
  /** Tailwind classes for the icon tile — one hue per destination. */
  tint: string;
  soon?: boolean;
  badge?: "new";
  /** Sub-features shown under this one — the "chain" the business asked for. */
  children?: NavItem[];
  categoryId?: string;
}

interface NavSection {
  title: string | null;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  { title: "", items: [{ href: "/", label: "Home", icon: LayoutDashboard, tint: "text-emerald-500 bg-emerald-500/12" }] },
  ...FEATURE_MAP.map((c) => ({
    title: "",
    items: [{
      href: `/hub/${c.id}`, label: c.label, icon: (ICONS[c.icon] || LayoutDashboard) as typeof LayoutDashboard, tint: "text-lime-400 bg-lime-400/12",
      // The category is visible when ANY of its features is; the hub then
      // shows only what the person may open.
      perm: undefined,
      children: [],
      categoryId: c.id,
    }],
  })),
];

export default function Sidebar({ drawer = false }: { drawer?: boolean } = {}) {
  const pathname = usePathname();
  const { can, user } = useSession();
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);
  /**
   * Which categories are folded shut.
   *
   * Absent means open — so a new section added later appears rather than
   * hiding itself, and nobody has to discover that a menu they have never
   * seen is collapsed by default.
   */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [planOpen, setPlanOpen] = useState(false);

  /**
   * Build the navigation for this role. A section whose every item was
   * filtered out disappears with its heading, so a plant manager doesn't
   * see an empty "Finance" label sitting over nothing.
   */
  const allowed = (item: NavItem): NavItem | null => {
    if (item.categoryId) {
      const cat = FEATURE_MAP.find((c) => c.id === item.categoryId);
      const any = cat?.features.some((f) => !f.perm || can(f.perm as any));
      return any ? { ...item, children: [] } : null;
    }
    if (item.perm && !can(item.perm)) {
      // A parent the person may not open can still hold sub-features they may.
      const kids = (item.children || []).map(allowed).filter(Boolean) as NavItem[];
      return kids.length ? { ...kids[0], children: kids.slice(1) } : null;
    }
    return { ...item, children: (item.children || []).map(allowed).filter(Boolean) as NavItem[] };
  };
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .map(allowed)
      .filter((item): item is NavItem => Boolean(item))
      // The same route serves two registers. A coordinator's link says
      // what they actually manage there — trading vendors — while a plant
      // manager sees the registration module the business gave them.
      .map((item) =>
        item.href === "/partners"
          ? { ...item, label: user?.role === "coordinator" ? "Vendors (trading)" : user?.role === "plant_manager" ? "Vendors (my plant)" : "Vendors & Transporters" }
          : item
      ),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      className={`forest-rail sticky top-0 h-screen shrink-0 flex-col transition-[width] duration-300 ${
        drawer ? "flex w-[268px]" : `hidden md:flex ${collapsed ? "w-[76px]" : "w-[248px]"}`
      }`}
    >
      {/* ---- Brand ---- */}
      <div className="relative flex items-center gap-2.5 px-4 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center drop-shadow-[0_6px_16px_rgba(159,232,112,.35)]">
          <BiomeLogo size={40} />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="biome-shout truncate text-[13px] leading-tight text-white">
              BIOME <span className="text-[#9fe870]">INDUSTRIA</span>
            </p>
            <p className="truncate text-[9px] uppercase tracking-[0.18em] text-[#e2f6d5]/50">
              Private Limited
            </p>
          </div>
        )}
      </div>

      {/* ---- Navigation ---- */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-20">
        {sections.map((section) => {
          const key = section.title ?? "root";
          // A section with no heading (Dashboard and friends) is never a
          // dropdown — there is nothing to label the toggle with.
          const collapsible = Boolean(section.title) && !collapsed;
          const isOpen = collapsible ? openSections[key] !== false : true;
          const activeInside = section.items.some((i) => i.href === pathname);

          return (
            <div key={key}>
              {!collapsed && section.title && (
                <button
                  onClick={() => setOpenSections((o) => ({ ...o, [key]: o[key] === false }))}
                  className="rail-label mb-1.5 flex w-full items-center gap-1.5 rounded-lg px-3 py-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] transition-colors hover:text-[#e2f6d5]"
                >
                  <span className={`h-1 w-1 rounded-full transition-colors ${activeInside ? "bg-[#9fe870]" : "bg-[#9fe870]/40"}`} />
                  <span className="flex-1 text-left">{section.title}</span>
                  {/* A collapsed group that holds the page you are on says
                      so, otherwise the only way to find it is to open
                      every group in turn. */}
                  {!isOpen && activeInside && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#9fe870]" />
                  )}
                  {!isOpen && !activeInside && (
                    <span className="text-[9px] tabular-nums text-[#e2f6d5]/40">{section.items.length}</span>
                  )}
                  <motion.span animate={{ rotate: isOpen ? 0 : -90 }} transition={{ duration: 0.18 }} className="flex">
                    <ChevronDown size={11} />
                  </motion.span>
                </button>
              )}

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    // Height IS animated here, and it is safe: this measures
                    // its own content rather than being pinned to a fixed
                    // max-height. The bug that cost a day was a CSS class
                    // animating max-height to a guessed value, which clipped
                    // every panel taller than the guess.
                    initial={collapsible ? { height: 0, opacity: 0 } : false}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-visible"
                  >
                    {/* The "premium dropdown": open sections sit in their own
                        faintly-lit card, and items stagger in one after the
                        other — motion that says WHERE things came from. */}
                    <div className={section.title
                      ? "space-y-0.5 rounded-2xl border border-[#9fe870]/10 bg-white/[.03] p-1"
                      : "space-y-0.5"}>
                      {section.items.flatMap((item) => {
                        const cat = item.categoryId ? FEATURE_MAP.find((c) => c.id === item.categoryId) : null;
                        const inside = cat ? cat.features.some((f) => pathname === f.href || pathname.startsWith(f.href + "/") || (f.children || []).some((k) => pathname === k.href || pathname.startsWith(k.href + "/"))) : false;
                        const active = pathname === item.href || inside;
                        const Icon = item.icon;
                        const kids = item.children || [];
                        const branchOpen = kids.some((k) => pathname === k.href) || active || openBranches[item.href];
                        return [(
                          <MotionLink
                            whileHover={{ x: 4, scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            key={item.href}
                            href={item.href}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: Math.min(section.items.indexOf(item) * 0.03, 0.24), duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            title={collapsed ? item.label : undefined}
                            className={`rail-item group relative flex items-center gap-2.5 px-2.5 py-2 transition-colors ${
                              active ? "is-active" : ""
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="nav-active"
                                className="absolute inset-0 -z-10 rounded-full"
                                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                              />
                            )}
                            <span
                              className={`rail-tint flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105 ${item.tint}`}
                            >
                              <Icon size={15} />
                            </span>
                            {!collapsed && (
                              <>
                                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                                  {item.label}
                                </span>
                                {item.soon && (
                                  <span
                                    title="Coming soon — no live data connected yet"
                                    className="shrink-0 rounded-full border border-[#9fe870]/30 bg-[#9fe870]/10 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-wide text-[#c9f2a8]"
                                  >
                                    soon
                                  </span>
                                )}
                              </>
                            )}
                          </MotionLink>
                        ), ...(kids.length && !collapsed ? [(
                          <div key={item.href + "-kids"} className="ml-3 border-l border-[#9fe870]/15 pl-2">
                            <button onClick={() => setOpenBranches((o) => ({ ...o, [item.href]: !branchOpen }))}
                              className="flex w-full items-center gap-1 px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[.12em] text-[#e2f6d5]/45">
                              {branchOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />} {kids.length} sub-feature{kids.length === 1 ? "" : "s"}
                            </button>
                            {branchOpen && kids.map((k) => { const KIcon = k.icon; const kActive = pathname === k.href; return (
                              <Link key={k.href} href={k.href} className={`rail-item my-0.5 flex items-center gap-2 px-2 py-1.5 text-[11.5px] ${kActive ? "is-active" : ""}`}>
                                <span className={`rail-tint flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${k.tint}`}><KIcon size={12} /></span>
                                <span className="truncate">{k.label}</span>
                              </Link>); })}
                          </div>
                        )] : [])];
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* ---- Plan card ---- */}
      <div className="border-t border-[#9fe870]/12 p-3">
        <button
          onClick={() => setPlanOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-2xl border border-[#9fe870]/15 bg-white/[0.04] px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.08]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#9fe870] text-[11px] font-bold text-[#163300]">
            BI
          </span>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] font-medium text-white">Biome Industria</p>
                <p className="truncate text-[9.5px] text-[#e2f6d5]/55">Enterprise Plan</p>
              </div>
              <motion.span animate={{ rotate: planOpen ? 0 : 180 }} transition={{ duration: 0.2 }}>
                <ChevronUp size={13} className="text-[#e2f6d5]/55" />
              </motion.span>
            </>
          )}
        </button>

        <AnimatePresence>
          {planOpen && !collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-visible"
            >
              <div className="mt-2 space-y-1 rounded-xl border border-[#9fe870]/12 bg-white/[0.03] p-2">
                <Link
                  href="/company"
                  className="block rounded-lg px-2.5 py-1.5 text-[11px] text-[#e2f6d5]/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  Company profile
                </Link>
                <Link
                  href="/settings"
                  className="block rounded-lg px-2.5 py-1.5 text-[11px] text-[#e2f6d5]/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  Settings &amp; appearance
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10.5px] text-[#e2f6d5]/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
