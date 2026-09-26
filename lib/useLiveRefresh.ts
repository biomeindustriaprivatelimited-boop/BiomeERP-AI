"use client";

import { useEffect, useRef } from "react";

/**
 * Reload this screen whenever business data changes anywhere.
 *
 * Polls /api/live — one small number — every few seconds while the tab is
 * visible, and immediately when the window regains focus or the phone
 * comes back online. When the number moves, `onChange` runs (normally the
 * page's own `load`). The first reading only sets the baseline, so opening
 * a page never triggers a second load.
 *
 * Every open tab, every phone and every PC on the network polls the same
 * server, so an entry saved on one device shows up on the rest within a
 * few seconds without anyone pressing Refresh.
 */
export function useLiveRefresh(onChange: () => unknown, intervalMs = 6000) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let last: number | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const check = async () => {
      if (stopped || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const { v } = await res.json();
        if (typeof v !== "number") return;
        if (last !== null && v !== last) {
          try { await cb.current(); } catch { /* the page shows its own errors */ }
        }
        last = v;
      } catch {
        /* offline — try again on the next tick */
      } finally {
        inFlight = false;
      }
    };

    const loop = () => {
      if (stopped) return;
      timer = setTimeout(async () => { await check(); loop(); }, intervalMs);
    };

    check();
    loop();

    const wake = () => { check(); };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [intervalMs]);
}
