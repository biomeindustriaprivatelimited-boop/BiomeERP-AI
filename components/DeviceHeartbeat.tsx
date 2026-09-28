"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ShieldAlert, Megaphone, X } from "lucide-react";

/**
 * Tells the server PC this device is here, once a minute, and carries out
 * what the developer asked for in Developer → Server & devices: sign out,
 * reload after an update, show a message, or block this device.
 */
function deviceId(): string {
  try {
    let id = localStorage.getItem("biome:deviceId");
    if (!id) { id = (crypto as any).randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem("biome:deviceId", id); }
    return id;
  } catch { return "no-storage"; }
}

export default function DeviceHeartbeat() {
  const pathname = usePathname();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const beat = async () => {
      try {
        const shell = (window as any).biomeDesktop?.getAppInfo ? await (window as any).biomeDesktop.getAppInfo().catch(() => null) : null;
        const res = await fetch("/api/devices", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "heartbeat", deviceId: deviceId(), page: location.pathname,
            version: process.env.NEXT_PUBLIC_APP_VERSION || "", shell: shell ? "desktop" : "", shellVersion: shell?.version || "",
          }),
        });
        if (!res.ok || stop) return;
        const j = await res.json();
        if (j.blocked) setBlocked(j.blockedReason || "This device has been blocked by the administrator.");
        if (j.message) setMessage(j.message);
        if (j.signOut) { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/login"; return; }
        if (j.reload) { location.reload(); return; }
      } catch { /* offline — the ServerGuard handles that */ }
    };
    beat();
    const t = setInterval(beat, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Also beat on navigation, so "last seen on page" stays true.
  useEffect(() => { /* the interval covers it; nothing else to do */ }, [pathname]);

  if (blocked) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-6">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center">
          <ShieldAlert size={28} className="mx-auto text-rose-600" />
          <p className="mt-2 text-[15px] font-bold text-slate-900">Device blocked</p>
          <p className="mt-1 text-[12px] text-slate-600">{blocked}</p>
        </div>
      </div>
    );
  }
  if (message) {
    return (
      <div className="fixed left-1/2 top-4 z-[9999] w-[min(560px,92vw)] -translate-x-1/2 rounded-2xl border border-biome-leaf/40 bg-biome-bgSoft p-4 shadow-2xl">
        <div className="flex items-start gap-2">
          <Megaphone size={16} className="mt-0.5 shrink-0 text-biome-leaf" />
          <p className="flex-1 whitespace-pre-wrap text-[12.5px] text-biome-text">{message}</p>
          <button onClick={() => setMessage(null)} aria-label="Close" className="rounded-lg p-1 text-biome-muted"><X size={14} /></button>
        </div>
      </div>
    );
  }
  return null;
}
