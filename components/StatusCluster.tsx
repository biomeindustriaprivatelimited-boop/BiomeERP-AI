"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, CloudOff, Loader2 } from "lucide-react";

/**
 * The status cluster in the top bar: what time it is, and whether this
 * machine can still reach the server.
 *
 * The connectivity part matters more than it looks. This app runs on four
 * PCs across two plants and an office, and the server is the admin's
 * machine — which the business has said goes down two or three times a
 * month. A plant manager typing an hour of entries into a dead connection
 * is the worst failure this product can have, so the state has to be on
 * screen at all times rather than discovered on save.
 *
 * `navigator.onLine` alone is not enough: it reports the network card, not
 * whether the BIOME server is answering. A machine on plant wi-fi with the
 * office link down reads "online" and is useless. So the badge pings a
 * real endpoint.
 */

type Reach = "checking" | "online" | "no-server" | "offline";

export default function StatusCluster() {
  const [now, setNow] = useState<Date | null>(null);
  const [reach, setReach] = useState<Reach>("checking");
  const [lastOk, setLastOk] = useState<Date | null>(null);

  // Rendered only after mount — the server has a different clock, and
  // React discards the markup if the two disagree.
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (!cancelled) setReach("offline");
        return;
      }
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 4000);
        // A tiny authenticated endpoint. It answers for any signed-in role
        // and returns almost nothing, so polling it costs nothing.
        const res = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        window.clearTimeout(timer);
        if (cancelled) return;
        if (res.ok) { setReach("online"); setLastOk(new Date()); }
        else setReach("no-server");
      } catch {
        if (!cancelled) setReach("no-server");
      }
    }

    check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 20000);

    const online = () => check();
    const offline = () => setReach("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  const meta = {
    checking: {
      label: "Checking", icon: <Loader2 size={12} className="animate-spin" />,
      cls: "border-biome-line text-biome-muted",
      title: "Checking the connection to the BIOME server…",
    },
    online: {
      label: "Online", icon: <Wifi size={12} />,
      cls: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600",
      title: lastOk ? `Connected. Last checked ${lastOk.toLocaleTimeString("en-IN")}` : "Connected to the BIOME server.",
    },
    "no-server": {
      label: "No server", icon: <CloudOff size={12} />,
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-600",
      title: "This machine has a network but the BIOME server isn't answering. Anything you save may not reach the office — check with the admin before entering more.",
    },
    offline: {
      label: "Offline", icon: <WifiOff size={12} />,
      cls: "border-rose-500/40 bg-rose-500/10 text-rose-500",
      title: "No network on this machine. Nothing you enter will reach the server until it is back.",
    },
  }[reach];

  return (
    <div className="flex items-center gap-2">
      {/* ---- Connectivity ---- */}
      <span
        title={meta.title}
        className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[10.5px] font-semibold transition-colors ${meta.cls}`}
      >
        <span className={reach === "online" ? "bmx-status-dot flex" : "flex"}>{meta.icon}</span>
        <span className="hidden sm:inline">{meta.label}</span>
      </span>

      {/* ---- Clock ---- */}
      <div
        title={now?.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        className="hidden h-9 items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bg px-3 lg:flex"
      >
        <div className="text-right leading-none">
          <p className="text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">
            {now?.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }) ?? "\u00A0"}
          </p>
          <p className="mt-1 font-mono text-[13px] font-semibold tabular-nums leading-none text-biome-text">
            {now
              ? now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
              : "\u00A0"}
            {/* Seconds kept quieter than the hours — a ticking full-size
                clock pulls the eye away from the work. */}
            <span className="ml-0.5 text-[9.5px] font-normal text-biome-muted">
              {now ? now.toLocaleTimeString("en-IN", { second: "2-digit" }).padStart(2, "0") : ""}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
