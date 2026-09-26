"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, Home } from "lucide-react";
import { locate, FEATURE_MAP } from "@/lib/featureMap";
import { Icon } from "@/components/hub/icons";
import { useSession } from "@/lib/session";

/**
 * The shell every feature page wears — without touching the page.
 *
 *   Home › Category › Feature › Sub-feature
 *   [ sibling / sub-feature pills ]  ← the "feature by feature" chain
 *
 * Read from the feature map by pathname, so a new page joins the system
 * by being listed there. Tabs are pills with a spring-morphing active
 * indicator (motion.dev "tab select"). Sections (Settings) become
 * anchor pills.
 */
export default function FeatureShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useSession();
  const hit = locate(pathname);
  if (!hit || pathname === "/" || pathname.startsWith("/hub/")) return <>{children}</>;

  const { node, category, parent } = hit;
  const feature = parent || node;
  const pills = [feature, ...(feature.children || [])].filter((n) => !n.perm || can(n.perm as any));
  const activeHref = node.href;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft px-3 py-2 backdrop-blur">
        <nav className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-[10.5px] font-semibold text-biome-muted" aria-label="Breadcrumb">
          <Link href="/" className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:text-biome-text"><Home size={11} /> Home</Link>
          <ChevronRight size={11} />
          <Link href={`/hub/${category.id}`} className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:text-biome-text"><Icon name={category.icon} size={11} /> {category.label}</Link>
          <ChevronRight size={11} />
          <span className="rounded-lg px-1.5 py-1 text-biome-text">{feature.label}</span>
          {parent && <><ChevronRight size={11} /><span className="rounded-lg px-1.5 py-1 text-biome-leafBright">{node.label}</span></>}
        </nav>
        <div className="ml-auto flex max-w-full items-center gap-1 overflow-x-auto max-md:w-full max-md:ml-0">
          {pills.length > 1 && pills.map((p) => {
            const active = p.href === activeHref;
            return (
              <Link key={p.href} href={p.href} className={`relative rounded-full px-3 py-1.5 text-[10.5px] font-bold transition-colors ${active ? "text-[#163300]" : "text-biome-muted hover:text-biome-text"}`}>
                {active && <motion.span layoutId="shell-pill" className="absolute inset-0 rounded-full bg-[#9fe870]" transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
                <span className="relative flex items-center gap-1"><Icon name={p.icon} size={11} /> {p.label}</span>
              </Link>
            );
          })}
          {feature.sections && feature.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted hover:border-biome-leaf/40 hover:text-biome-text">{s.label}</a>
          ))}
        </div>
      </motion.div>
      {children}
    </div>
  );
}
