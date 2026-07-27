"use client";

import type { CSSProperties } from "react";

export function SkeletonLine({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`skeleton-shimmer h-3 rounded-full ${className}`} style={style} />;
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-xl ${className}`} />;
}

/** A skeleton shaped like a row of a data table — headers + N rows. */
export function SkeletonTable({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-biome-line">
      <div className="flex gap-3 border-b border-biome-line bg-white/[0.02] px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} className="w-full" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-b border-biome-line/60 px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} className="w-full opacity-70" style={{ animationDelay: `${(r + c) * 60}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A skeleton shaped like a document card — used while OCR/AI is
 *  reading an uploaded file. */
export function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-2xl border border-biome-line p-4">
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonLine className="w-3/4" />
      <SkeletonLine className="w-1/2" />
    </div>
  );
}
