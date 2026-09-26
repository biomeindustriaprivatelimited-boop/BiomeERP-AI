"use client";

import { useEffect, useState } from "react";
import { Download, X, ArrowUpCircle } from "lucide-react";

/**
 * Update notice.
 *
 * Sits in the app shell so every role sees it wherever they are. Dismissal
 * is remembered per version, so a person who has read it isn't nagged all
 * day — but a mandatory release ignores that, because a build published as
 * mandatory is usually one that fixes something the rest of the office is
 * already suffering from.
 */

interface Release {
  version: string;
  notes: string;
  url: string;
  mandatory: boolean;
  publishedByName: string;
}

/** Compares 1.2.10 against 1.2.9 properly, which a string compare does not. */
function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export default function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/release", { cache: "no-store" });
        if (!res.ok) return; // 404 for a role without release.read — say nothing
        const json = await res.json();
        if (cancelled || !json.release) return;
        if (!isNewer(json.release.version, json.current)) return;

        setRelease(json.release);
        let seen = false;
        try { seen = localStorage.getItem("biome:seenRelease") === json.release.version; } catch {}
        setDismissed(json.release.mandatory ? false : seen);
      } catch {
        // A failed check is not worth telling anyone about.
      }
    };

    check();
    // Re-check hourly so a machine left open overnight still learns about it.
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (!release || dismissed) return null;

  return (
    <div className="bmx-msg-in mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-biome-leaf/35 bg-biome-leaf/[.08] px-4 py-3 md:mx-7">
      <ArrowUpCircle size={17} className="bmx-status-dot shrink-0 text-biome-leaf" />
      <div className="min-w-[180px] flex-1">
        <p className="text-[12.5px] font-semibold text-biome-text">
          Version {release.version} is available
          {release.mandatory && <span className="ml-2 text-[10px] font-bold uppercase tracking-[.1em] text-rose-500">Required</span>}
        </p>
        {release.notes && (
          <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-biome-muted">{release.notes}</p>
        )}
      </div>

      {release.url && (
        <a
          href={release.url}
          target="_blank"
          rel="noreferrer"
          className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white"
        >
          <Download size={13} /> Download
        </a>
      )}

      {!release.mandatory && (
        <button
          onClick={() => {
            try { localStorage.setItem("biome:seenRelease", release.version); } catch {}
            setDismissed(true);
          }}
          className="bmx-toggle rounded-lg p-1.5 text-biome-muted hover:text-biome-text"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
