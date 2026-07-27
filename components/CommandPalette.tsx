"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
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
  CornerDownLeft,
} from "lucide-react";

/** Every navigable module in the app, with a few extra keywords so
 *  Hinglish / abbreviated typing ("recon", "gst", "ocr") still matches. */
interface SearchItem {
  href: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  keywords: string[];
}

const ITEMS: SearchItem[] = [
  { href: "/", label: "Dashboard", description: "Overview & KPIs", icon: LayoutDashboard, keywords: ["home", "overview"] },
  { href: "/ocr", label: "AI OCR Scanner", description: "Scan & extract documents", icon: ScanLine, keywords: ["scan", "ocr", "extract", "upload document"] },
  { href: "/documents", label: "Documents", description: "Document library", icon: FileText, keywords: ["files"] },
  { href: "/whatsapp", label: "WhatsApp Documents", description: "Invoices received on WhatsApp", icon: MessagesSquare, keywords: ["whatsapp"] },
  { href: "/reconciliation", label: "Ledger Reconciliation", description: "Match Ledger A vs Ledger B", icon: BarChart3, keywords: ["recon", "reconciliation", "matching", "ledger match"] },
  { href: "/ledgers", label: "Ledgers", description: "Ledger management", icon: BookOpen, keywords: [] },
  { href: "/payments", label: "Payments", description: "Payment tracking", icon: Wallet, keywords: [] },
  { href: "/gst-compliance", label: "GST Compliance", description: "GST filing & checks", icon: ShieldCheck, keywords: ["gst", "gstr", "tax"] },
  { href: "/billing-sop", label: "Billing SOP", description: "Billing standard procedures", icon: ClipboardList, keywords: ["sop", "billing"] },
  { href: "/plants", label: "Plants", description: "Gangakhed, Rewari & other plants", icon: Factory, keywords: ["gangakhed", "rewari", "plant"] },
  { href: "/transport", label: "Transport", description: "Transport & weighbridge", icon: Truck, keywords: ["truck", "weighbridge"] },
  { href: "/vendors", label: "Vendors", description: "Vendor / AP management", icon: Users, keywords: ["vendor", "ap", "supplier"] },
  { href: "/customers", label: "Customers", description: "Customer management", icon: UserCheck, keywords: ["client", "party"] },
  { href: "/analytics", label: "Analytics", description: "Trends & insights", icon: TrendingUp, keywords: [] },
  { href: "/reports", label: "Reports", description: "Generated reports", icon: FolderOpen, keywords: [] },
  { href: "/company", label: "Company Profile", description: "Biome Industria details", icon: Building2, keywords: ["biome industria", "company"] },
  { href: "/settings", label: "Settings", description: "App preferences & AI engine status", icon: Settings, keywords: ["theme", "preferences", "tally", "ai key"] },
];

function fuzzyScore(query: string, item: SearchItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const haystacks = [item.label, item.description, ...item.keywords].map((s) => s.toLowerCase());
  for (const h of haystacks) {
    if (h.startsWith(q)) return 3;
  }
  for (const h of haystacks) {
    if (h.includes(q)) return 2;
  }
  return 0;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    return ITEMS.map((item) => ({ item, score: fuzzyScore(query, item) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item)
      .slice(0, 8);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDownInput(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active].href);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden max-w-sm flex-1 items-center gap-2 rounded-xl border border-biome-line bg-white/5 px-3 py-2 text-left text-sm text-biome-muted transition-colors hover:border-biome-leaf/30 hover:text-biome-text md:flex"
      >
        <Search size={16} />
        <span className="flex-1">Search invoices, clients, documents…</span>
        <span className="rounded-md border border-biome-line px-1.5 py-0.5 text-[10px] text-biome-muted/70">
          Ctrl K
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="glass w-full max-w-lg overflow-hidden rounded-2xl border border-biome-line shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b border-biome-line px-4 py-3">
                <Search size={16} className="text-biome-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDownInput}
                  placeholder="Search modules — reconciliation, OCR, GST, vendors…"
                  className="flex-1 bg-transparent text-sm text-biome-text outline-none placeholder:text-biome-muted/60"
                />
                <span className="rounded-md border border-biome-line px-1.5 py-0.5 text-[10px] text-biome-muted/70">
                  Esc
                </span>
              </div>

              <div className="max-h-80 overflow-y-auto p-2">
                {results.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-biome-muted">
                    No module matches "{query}".
                  </p>
                )}
                {results.map((item, i) => {
                  const Icon = item.icon;
                  const isActive = i === active;
                  return (
                    <button
                      key={item.href}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(item.href)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                        isActive ? "bg-biome-leaf/12 text-biome-leafBright" : "text-biome-text hover:bg-white/5"
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="flex-1">
                        <span className="block">{item.label}</span>
                        <span className="block text-[11px] text-biome-muted">{item.description}</span>
                      </span>
                      {isActive && <CornerDownLeft size={13} className="text-biome-muted" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
