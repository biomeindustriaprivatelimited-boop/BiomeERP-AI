"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FEATURE_MAP } from "@/lib/featureMap";
import { FeatureGrid } from "@/components/hub/HubGrid";
import { Icon } from "@/components/hub/icons";
import { SplitText } from "@/components/motion/kit";
import { useSession } from "@/lib/session";

/** A category hub: this category's features as premium cards, each listing its own sub-features. */
export default function HubPage() {
  const { category } = useParams<{ category: string }>();
  const { can } = useSession();
  const c = FEATURE_MAP.find((x) => x.id === category);
  if (!c) return <p className="text-[12px] text-biome-muted">No such category.</p>;
  return (
    <div className="space-y-6">
      <header className={`rounded-3xl bg-gradient-to-br ${c.tone} p-6`}>
        <Link href="/" className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text"><ArrowLeft size={11} /> Home</Link>
        <div className="mt-3 flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-biome-bg/70 text-biome-leafBright"><Icon name={c.icon} size={26} /></span>
          <div>
            <h1 className="biome-shout text-[34px] leading-none text-biome-text"><SplitText text={c.label} /></h1>
            <p className="mt-2 text-[12.5px] text-biome-muted">{c.tagline}</p>
          </div>
        </div>
      </header>
      <FeatureGrid features={c.features} can={(p) => can(p as any)} />
    </div>
  );
}
