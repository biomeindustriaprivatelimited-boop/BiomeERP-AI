"use client";

import { useEffect, useRef, useState } from "react";
import { ServerOff, RefreshCcw, Wifi } from "lucide-react";

/**
 * The multi-PC rule, enforced on every client:
 *
 *   All data lives on ONE server. If that server is off, or the server
 *   app there is not running, NOBODY works — not "works offline and syncs
 *   later", because two PCs writing their own truth for an afternoon is
 *   how a business ends up with two ledgers.
 *
 * So every client polls /api/health. Miss enough beats in a row and a
 * full-screen block goes up; the moment the server answers again, it comes
 * down and the person is exactly where they were. The developer manages
 * which machine is the server from the Electron config — see
 * electron/main.js and the Server & Sync card in Settings.
 *
 * Two consecutive misses are required before blocking: a single dropped
 * request on Wi-Fi is weather, not an outage, and flashing a red screen
 * for weather teaches people to ignore the screen.
 */
const POLL_MS = 12_000;
const RETRY_MS = 4_000;
const MISSES_BEFORE_BLOCK = 2;

export default function ServerGuard({ children }: { children: React.ReactNode }) {
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downSince, setDownSince] = useState<string | null>(null);
  const misses = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;

    async function beat() {
      if (stopped) return;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6_000);
        const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
        clearTimeout(t);
        // ANY answer below 500 proves the server is alive — even a 401
        // or 404 required a running server to say so. Only a network
        // failure, a timeout, or a 5xx counts as down; anything else
        // must never block the login screen.
        if (res.status >= 500) throw new Error(String(res.status));
        misses.current = 0;
        setDown((was) => {
          if (was) setDownSince(null);
          return false;
        });
      } catch {
        misses.current += 1;
        if (misses.current >= MISSES_BEFORE_BLOCK) {
          setDown((was) => {
            if (!was) setDownSince(new Date().toLocaleTimeString());
            return true;
          });
        }
      } finally {
        if (!stopped) {
          timer.current = setTimeout(beat, misses.current > 0 ? RETRY_MS : POLL_MS);
        }
      }
    }

    beat();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function retryNow() {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.status < 500) {
        misses.current = 0;
        setDown(false);
        setDownSince(null);
      }
    } catch {
      /* still down — the notice stays */
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      {children}
      {down && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-biome-bg/95 p-6 backdrop-blur-md">
          <div className="bmx-card w-full max-w-md rounded-3xl border border-rose-500/25 bg-biome-bgSoft p-8 text-center shadow-2xl">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/12">
              <ServerOff size={28} className="text-rose-500" />
            </span>
            <h2 className="mt-5 font-display text-[18px] font-bold tracking-tight text-biome-text">
              The server is not answering
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-biome-muted">
              Every PC works from one server, so nothing can be viewed or saved until it is back.
              Check that the server PC is on and the Biome server app is running there
              {downSince ? ` — the connection dropped around ${downSince}` : ""}.
              Nothing you had open is lost; this screen lifts by itself the moment the server answers.
            </p>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-biome-muted">
              <Wifi size={12} className="animate-pulse text-amber-500" /> Retrying automatically…
            </p>
            <button
              onClick={retryNow}
              disabled={checking}
              className="bmx-btn mx-auto mt-5 flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
            >
              <RefreshCcw size={13} className={checking ? "bmx-spin" : ""} /> Check now
            </button>
            <p className="mt-4 text-[9.5px] uppercase tracking-[.14em] text-biome-muted/70">
              Server &amp; Sync is managed by the developer
            </p>
          </div>
        </div>
      )}
    </>
  );
}
