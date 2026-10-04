"use client";

import Link from "next/link";
import { ArrowRight, Snowflake } from "lucide-react";
import { TiltCard, Stagger, Item } from "@/components/motion/kit";
import { Icon } from "@/components/hub/icons";
import { visibleFeatures, type FeatureNode, type FeatureCategory } from "@/lib/featureMap";
import { useSession } from "@/lib/session";

/**
 * Premium card grids — the "click a feature, see its features" surface.
 * Category cards on the dashboard; feature cards on a category hub; the
 * sub-features of a feature listed on its card.
 *
 * Only what the person can open is drawn. A card they lack access to, or a
 * module the developer has frozen or switched off, is simply not there —
 * the business asked for "not shown at all", not "shown locked". The
 * developer still sees every card, with a Frozen / Off badge.
 *
 * `can` is accepted for older callers and ignored: the session's
 * `visible()` is the one rule (permission + switches).
 */
export function CategoryGrid({ categories }: { categories: FeatureCategory[]; can?: (p: string) => boolean }) {
  const { visible } = useSession();
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" gap={0.05}>
      {categories.map((c) => {
        const open = visibleFeatures(c.features, visible);
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

/** Developer-only marker on a module that is frozen or off for everyone else. */
export function SwitchBadge({ href }: { href: string }) {
  const { user, switchFor } = useSession();
  const sw = user?.role === "developer" ? switchFor(href) : null;
  if (!sw) return null;
  return (
    <span title={`${sw.label} is ${sw.state === "off" ? "switched off" : "frozen"} — hidden from everyone except you.`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-500">
      <Snowflake size={9} /> {sw.state === "off" ? "Off" : "Frozen"}
    </span>
  );
}

export function FeatureGrid({ features }: { features: FeatureNode[]; can?: (p: string) => boolean }) {
  const { visible } = useSession();
  const shown = visibleFeatures(features, visible);
  if (!shown.length) {
    return <p className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-6 text-center text-[12px] text-biome-muted">Nothing in this section is open for your account.</p>;
  }
  return (
    <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" gap={0.05}>
      {shown.map((f) => {
        const kids = f.children || [];
        return (
          <Item key={f.id}>
            <Link href={f.href} className="group block h-full">
              <TiltCard max={7} className="bmx-card h-full rounded-3xl p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-biome-leaf/12 text-biome-leafBright"><Icon name={f.icon} size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold leading-tight text-biome-text">{f.label} <SwitchBadge href={f.href} /></p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">{f.what}</p>
                  </div>
                  <ArrowRight size={16} className="text-biome-muted transition-transform group-hover:translate-x-0.5" />
                </div>
                {kids.length > 0 && (
                  <div className="mt-4 space-y-1 border-t border-biome-line/70 pt-3">
                    {kids.map((k) => (
                      <Link key={k.id} href={k.href} className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-biome-leaf/10" onClick={(e) => e.stopPropagation()}>
                        <Icon name={k.icon} size={13} className="text-biome-leafBright" />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-biome-text">{k.label}</span>
                        <SwitchBadge href={k.href} />
                        <ArrowRight size={11} className="text-biome-muted" />
                      </Link>
                    ))}
                  </div>
                )}
                {f.sections && f.sections.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1 border-t border-biome-line/70 pt-3">{f.sections.map((s) => <Link key={s.id} href={`${f.href}#${s.id}`} className="normal-case rounded-full border border-biome-line px-2 py-0.5 text-[9.5px] font-semibold text-biome-muted hover:text-biome-text" onClick={(e) => e.stopPropagation()}>{s.label}</Link>)}</div>
                )}
              </TiltCard>
            </Link>
          </Item>
        );
      })}
    </Stagger>
  );
}
