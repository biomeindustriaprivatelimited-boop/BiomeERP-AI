"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  ScanLine,
  BarChart3,
  BookOpen,
  Wallet,
  Factory,
  Truck,
  Users,
  UserCheck,
  TrendingUp,
  FolderOpen,
  Settings,
  MessagesSquare,
  Building2,
  ShieldCheck,
  ClipboardList,
  ChevronsLeft,
  ChevronsRight,
  Construction,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Documents & AI",
    items: [
      { href: "/documents", label: "Documents", icon: FileText, soon: true },
      { href: "/ocr", label: "AI OCR", icon: ScanLine },
      { href: "/whatsapp", label: "WhatsApp Documents", icon: MessagesSquare },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/reconciliation", label: "Reconciliation", icon: BarChart3 },
      { href: "/ledgers", label: "Ledgers", icon: BookOpen, soon: true },
      { href: "/payments", label: "Payments", icon: Wallet, soon: true },
      { href: "/gst-compliance", label: "GST Compliance", icon: ShieldCheck },
      { href: "/billing-sop", label: "Billing SOP", icon: ClipboardList },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/plants", label: "Plants", icon: Factory, soon: true },
      { href: "/transport", label: "Transport", icon: Truck, soon: true },
      { href: "/vendors", label: "Vendors", icon: Users, soon: true },
      { href: "/customers", label: "Customers", icon: UserCheck, soon: true },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: TrendingUp, soon: true },
      { href: "/reports", label: "Reports", icon: FolderOpen, soon: true },
    ],
  },
  {
    title: "",
    items: [
      { href: "/company", label: "Company Profile", icon: Building2 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 250 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
      className="glass sticky top-0 z-20 hidden h-screen flex-col justify-between overflow-y-auto border-r border-biome-line px-3 py-5 md:flex"
    >
      <div>
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="relative h-9 w-9 shrink-0">
            <motion.span
              animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-lg bg-biome-leaf/60 blur-md"
            />
            <div className="relative h-9 w-9 overflow-hidden rounded-lg bg-white/95">
              <Image
                src="/assets/logo.png"
                alt="Biome Industria logo"
                fill
                className="object-contain p-1"
                sizes="36px"
              />
            </div>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <motion.p
                initial={{ backgroundPosition: "0% 50%" }}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, #E8F6EF 0%, #3ED598 40%, #E8F6EF 80%)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="whitespace-nowrap font-display text-[13px] font-semibold tracking-wide"
              >
                BIOME INDUSTRIA
              </motion.p>
              <p className="text-[10px] tracking-wider text-biome-muted">
                PRIVATE LIMITED
              </p>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-4">
          {NAV_SECTIONS.map((section, si) => (
            <motion.div
              key={si}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: si * 0.06 }}
            >
              {!collapsed && section.title && (
                <p className="mb-1.5 flex items-center gap-1.5 px-3 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
                  <motion.span
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: si * 0.3 }}
                    className="h-1 w-1 rounded-full bg-biome-leafBright"
                  />
                  {section.title}
                </p>
              )}
              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 hover:translate-x-0.5 ${
                        active
                          ? "bg-biome-leaf/12 text-biome-leafBright"
                          : "text-biome-muted hover:bg-white/5 hover:text-biome-text"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="active-pill"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-biome-leafBright"
                        />
                      )}
                      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
                        {active && (
                          <motion.span
                            animate={{ scale: [1, 1.4, 1], opacity: [0.45, 0, 0.45] }}
                            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0 rounded-full bg-biome-leaf/50 blur-[6px]"
                          />
                        )}
                        <motion.span
                          whileHover={{ scale: 1.18, rotate: -6 }}
                          whileTap={{ scale: 0.92 }}
                          transition={{ type: "spring", stiffness: 300, damping: 15 }}
                          className="relative flex"
                        >
                          <Icon size={18} className="shrink-0" />
                        </motion.span>
                      </span>
                      {!collapsed && (
                        <span className="flex flex-1 items-center justify-between whitespace-nowrap">
                          {item.label}
                          {item.soon && (
                            <span
                              title="Coming soon — no live data connected yet"
                              className="ml-2 flex items-center gap-0.5 rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-1.5 py-0.5 text-[8.5px] font-medium text-biome-bolt"
                            >
                              <Construction size={8} /> soon
                            </span>
                          )}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </nav>
      </div>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-center gap-2 rounded-xl border border-biome-line py-2 text-biome-muted transition-colors hover:text-biome-text"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>
    </motion.aside>
  );
}
