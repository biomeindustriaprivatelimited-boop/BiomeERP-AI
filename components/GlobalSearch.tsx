"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Portal from "@/components/Portal";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { flatFeatures } from "@/lib/featureMap";
import { ICONS } from "@/components/hub/icons";
import { homePathFor } from "@/lib/permissions";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  LayoutDashboard,
  ScanLine,
  MessagesSquare,
  BarChart3,
  BookOpen,
  Wallet,
  ShieldCheck,
  ClipboardList,
  Users,
  UserCheck,
  Building2,
  FolderLock,
  Stethoscope,
  Settings,
  TrendingUp,
  FolderOpen,
  FileText,
  Factory,
  Truck,
} from "lucide-react";

/**
 * Global search. It was a decorative box before — it looked like a search
 * field and did nothing when clicked, which is worse than not having one.
 *
 * It now searches what the app can actually answer instantly: every page
 * and the specific things you can do on them. Each entry carries keywords
 * so "invoice", "bill" or "2B" all find GST Compliance without the user
 * having to guess our wording.
 */
interface Target {
  label: string;
  href: string;
  hint: string;
  icon: typeof Search;
  keywords: string[];
}

const TARGETS: Target[] = [
  { label: "Dashboard", href: "/", hint: "Live figures from Tally", icon: LayoutDashboard, keywords: ["home", "overview", "cash", "summary"] },
  { label: "AI OCR Scanner", href: "/ocr", hint: "Read any invoice or document", icon: ScanLine, keywords: ["scan", "extract", "read", "invoice", "pdf", "image", "ocr"] },
  { label: "WhatsApp Documents", href: "/whatsapp", hint: "Supply documents, filed automatically", icon: MessagesSquare, keywords: ["whatsapp", "supply", "challan", "eway", "weight slip", "bilty", "vendor invoice", "qr"] },
  { label: "Test a Document", href: "/test-document", hint: "See exactly what the agent reads and where it files", icon: Stethoscope, keywords: ["test", "debug", "check", "diagnose", "why", "not working", "troubleshoot"] },
  { label: "Reconciliation", href: "/reconciliation", hint: "Match two ledgers and explain differences", icon: BarChart3, keywords: ["reconcile", "match", "ledger", "difference", "tds", "mismatch"] },
  { label: "Ledgers", href: "/ledgers", hint: "Live balances from Tally", icon: BookOpen, keywords: ["balance", "tally", "account", "opening", "closing"] },
  { label: "Payments", href: "/payments", hint: "Record and track payments", icon: Wallet, keywords: ["payment", "paid", "receipt", "bank"] },
  { label: "GST Compliance", href: "/gst-compliance", hint: "GSTR-1, GSTR-2B and ITC at risk", icon: ShieldCheck, keywords: ["gst", "gstr", "2b", "gstr-1", "itc", "return", "tax", "input credit"] },
  { label: "Billing SOP", href: "/billing-sop", hint: "The billing procedure", icon: ClipboardList, keywords: ["sop", "procedure", "billing", "process"] },
  { label: "Vendors", href: "/vendors", hint: "Codes, full details and KYC", icon: Users, keywords: ["vendor", "supplier", "kyc", "code", "creditor", "pan", "gstin"] },
  { label: "Customers", href: "/customers", hint: "Client balances and requirements", icon: UserCheck, keywords: ["customer", "client", "debtor", "jhajjar", "ntpc", "buyer"] },
  { label: "Analytics", href: "/analytics", hint: "Trends from Tally data", icon: TrendingUp, keywords: ["analytics", "trend", "chart", "graph", "monthly"] },
  { label: "Reports", href: "/reports", hint: "Export ledgers and transactions", icon: FolderOpen, keywords: ["report", "export", "excel", "download", "statement"] },
  { label: "Documents", href: "/documents", hint: "All stored documents", icon: FileText, keywords: ["document", "file", "storage"] },
  { label: "Plants", href: "/plants", hint: "Plant operations", icon: Factory, keywords: ["plant", "manufacturing", "production"] },
  { label: "Transport", href: "/transport", hint: "Vehicles and transporters", icon: Truck, keywords: ["transport", "vehicle", "truck", "lorry", "driver"] },
  { label: "Company Documents", href: "/company-documents", hint: "Our GST certificate, PAN, licences", icon: FolderLock, keywords: ["kyc", "certificate", "licence", "license", "incorporation", "cancelled cheque", "pan", "our documents", "company kyc"] },
  { label: "Company Profile", href: "/company", hint: "Your registered details", icon: Building2, keywords: ["company", "profile", "gstin", "address", "cin"] },
  { label: "Settings", href: "/settings", hint: "Tally, AI keys, theme", icon: Settings, keywords: ["setting", "tally", "api key", "theme", "dark", "light", "connect", "port"] },
];

/**
 * Everything searchable for THIS person: the hand-written entries above
 * (for their keywords) plus every page in the feature map, kept only when
 * the session's visible() allows it — permission held, and not frozen or
 * switched off by the developer. Before this, Ctrl K listed Ledgers, GST
 * and Settings to a plant manager.
 */
function useTargets(): Target[] {
  const { user, permissions, visible } = useSession();
  return useMemo(() => {
    const byHref = new Map<string, Target>();
    const home = homePathFor(user?.role, permissions);
    for (const t of TARGETS) {
      const href = t.href === "/" ? home : t.href;
      if (!visible(href)) continue;
      byHref.set(href, href === "/plant-home" ? { ...t, href, label: "Plant home", hint: "Shortcuts and today's plant figures" } : { ...t, href });
    }
    for (const { node, category } of flatFeatures()) {
      if (!visible(node.href, node.perm)) continue;
      const prev = byHref.get(node.href);
      const keywords = [category.label.toLowerCase(), node.id.replace(/-/g, " ")];
      if (prev) byHref.set(node.href, { ...prev, keywords: [...prev.keywords, ...keywords] });
      else byHref.set(node.href, { label: node.label, href: node.href, hint: node.what, icon: (ICONS[node.icon] || FileText) as typeof Search, keywords });
    }
    if (home === "/plant-home" && !byHref.has(home)) {
      byHref.set(home, { label: "Plant home", href: home, hint: "Shortcuts and today's plant figures", icon: Factory, keywords: ["home", "dashboard", "plant"] });
    }
    return [...byHref.values()];
  }, [user?.role, permissions, visible]);
}

export default function GlobalSearch() {
  const router = useRouter();
  const TARGETS = useTargets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K from anywhere, Escape to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
    else {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TARGETS;
    // Score so an exact label match always beats a keyword brush.
    return TARGETS.map((t) => {
      const label = t.label.toLowerCase();
      let score = 0;
      if (label === q) score = 100;
      else if (label.startsWith(q)) score = 60;
      else if (label.includes(q)) score = 40;
      if (t.keywords.some((k) => k === q)) score = Math.max(score, 50);
      else if (t.keywords.some((k) => k.includes(q))) score = Math.max(score, 25);
      if (t.hint.toLowerCase().includes(q)) score = Math.max(score, 15);
      return { t, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.t);
  }, [query, TARGETS]);

  useEffect(() => setActive(0), [query]);

  function go(target: Target) {
    setOpen(false);
    router.push(target.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bg px-3.5 py-2.5 text-left transition-colors hover:border-biome-leaf/30 md:max-w-xl"
      >
        <Search size={15} className="shrink-0 text-biome-muted" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-biome-muted">
          Search pages, features, settings…
        </span>
        <kbd className="hidden shrink-0 rounded-md border border-biome-line bg-biome-bgSoft px-1.5 py-0.5 font-mono text-[9.5px] text-biome-muted sm:block">
          Ctrl K
        </kbd>
      </button>

      <Portal><AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.97, y: -8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.97, y: -8, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="glass w-full max-w-xl overflow-hidden rounded-2xl border border-biome-line"
            >
              <div className="flex items-center gap-3 border-b border-biome-line px-4 py-3">
                <Search size={16} className="shrink-0 text-biome-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Where do you want to go?"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-biome-text outline-none placeholder:text-biome-muted/60"
                />
                <kbd className="shrink-0 rounded-md border border-biome-line px-1.5 py-0.5 font-mono text-[9.5px] text-biome-muted">
                  Esc
                </kbd>
              </div>

              <div className="max-h-[52vh] overflow-y-auto p-2">
                {results.length === 0 ? (
                  <p className="px-3 py-8 text-center text-[12px] text-biome-muted">
                    Nothing matches &ldquo;{query}&rdquo;. Try “gst”, “vendor”, “reconcile” or
                    “settings”.
                  </p>
                ) : (
                  results.map((t, i) => (
                    <button
                      key={t.href}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(t)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        i === active ? "bg-biome-leaf/12" : "hover:bg-biome-bgSoft"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-biome-leaf/12 text-biome-leafBright">
                        <t.icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-biome-text">{t.label}</span>
                        <span className="block truncate text-[10.5px] text-biome-muted">{t.hint}</span>
                      </span>
                      {i === active && (
                        <CornerDownLeft size={13} className="shrink-0 text-biome-muted" />
                      )}
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center gap-4 border-t border-biome-line px-4 py-2 text-[10px] text-biome-muted">
                <span className="flex items-center gap-1">
                  <ArrowUp size={10} />
                  <ArrowDown size={10} /> navigate
                </span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft size={10} /> open
                </span>
                <span className="ml-auto">{results.length} results</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence></Portal>
    </>
  );
}
