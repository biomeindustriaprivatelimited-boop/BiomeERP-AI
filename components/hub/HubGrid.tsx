"use client";

import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { TiltCard, Stagger, Item } from "@/components/motion/kit";
import { Icon } from "@/components/hub/icons";
import type { FeatureNode, FeatureCategory } from "@/lib/featureMap";

/**
 * Premium card grids — the "click a feature, see its features" surface.
 * Category cards on the dashboard; feature cards on a category hub; the
 * sub-features of a feature listed on its card. Locked cards (no
 * permission) show but don't open — people learn the map, not the secret.
 */
export function CategoryGrid({ categories, can }: { categories: FeatureCategory[]; can: (p: string) => boolean }) {
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" gap={0.05}>
      {categories.map((c) => {
        const open = c.features.filter((f) => !f.perm || can(f.perm));
        if (!open.length) return null;
        return (
          <Item key={c.id}>
            <Link href={`/hub/${c.id}`} className="block">
              <TiltCard max={8} className={`bmx-card group h-full rounded-3xl bg-gradient-to-br ${c.tone} p-5`}>
                <div className="flex items-start justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-biome-bg/70 text-biome-leafBright shadow-inner"><Icon name={c.icon} size={22} /></span>
                  <span className="rounded-full border border-biome-line bg-biome-bg/60 px-2.5 py-1 text-[10px] font-bold text-biome-muted">{open.length} feature{open.length === 1 ? "" : "s"}</span>
                </div>
                <p className="biome-shout mt-5 text-[22px] leading-none text-biome-text">{c.label}</p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">{c.tagline}</p>
                <div className="mt-4 flex flex-wrap gap-1">{open.slice(0, 4).map((f) => <span key={f.id} className="normal-case rounded-full border border-biome-line/70 bg-biome-bg/50 px-2 py-0.5 text-[9.5px] font-semibold text-biome-text">{f.label}</span>)}{open.length > 4 && <span className="text-[9.5px] text-biome-muted">+{open.length - 4}</span>}</div>
                <p className="mt-4 flex items-center gap-1 text-[11px] font-bold text-biome-leafBright opacity-0 transition-opacity group-hover:opacity-100">Open <ArrowRight size={12} /></p>
              </TiltCard>
            </Link>
          </Item>
        );
      })}
    </Stagger>
  );
}

export function FeatureGrid({ features, can }: { features: FeatureNode[]; can: (p: string) => boolean }) {
  return (
    <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" gap={0.05}>
      {features.map((f) => {
        const locked = Boolean(f.perm && !can(f.perm));
        const kids = (f.children || []).filter((k) => !k.perm || can(k.perm));
        const body = (
          <TiltCard max={locked ? 0 : 7} className={`bmx-card h-full rounded-3xl p-5 ${locked ? "opacity-50" : ""}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-biome-leaf/12 text-biome-leafBright"><Icon name={f.icon} size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-tight text-biome-text">{f.label}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">{f.what}</p>
              </div>
              {locked ? <Lock size={14} className="text-biome-muted" /> : <ArrowRight size={16} className="text-biome-muted transition-transform group-hover:translate-x-0.5" />}
            </div>
            {kids.length > 0 && (
              <div className="mt-4 space-y-1 border-t border-biome-line/70 pt-3">
                {kids.map((k) => (
                  <Link key={k.id} href={k.href} className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-biome-leaf/10" onClick={(e) => e.stopPropagation()}>
                    <Icon name={k.icon} size={13} className="text-biome-leafBright" />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-biome-text">{k.label}</span>
                    <ArrowRight size={11} className="text-biome-muted" />
                  </Link>
                ))}
              </div>
            )}
            {f.sections && f.sections.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1 border-t border-biome-line/70 pt-3">{f.sections.map((s) => <Link key={s.id} href={`${f.href}#${s.id}`} className="normal-case rounded-full border border-biome-line px-2 py-0.5 text-[9.5px] font-semibold text-biome-muted hover:text-biome-text" onClick={(e) => e.stopPropagation()}>{s.label}</Link>)}</div>
            )}
          </TiltCard>
        );
        return <Item key={f.id}>{locked ? <div title="You don't have this permission — ask the admin.">{body}</div> : <Link href={f.href} className="group block h-full">{body}</Link>}</Item>;
      })}
    </Stagger>
  );
}
