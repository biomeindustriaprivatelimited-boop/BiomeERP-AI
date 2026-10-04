"use client";

import { useEffect, useRef } from "react";

/** Locks this device now and shows the lock screen. */
export async function lockNow() {
  try {
    await fetch("/api/auth/lock", { method: "POST" });
  } catch {
    /* the lock screen still asks for the MPIN */
  }
  const here = window.location.pathname;
  window.location.href = `/lock${here && here !== "/" && here !== "/lock" ? `?next=${encodeURIComponent(here)}` : ""}`;
}

/**
 * Auto-lock: after `minutes` without a key press, click, touch or scroll,
 * this device locks itself (the server and other devices carry on).
 * The developer account always has it (5 minutes unless chosen otherwise);
 * others choose it on Security & MPIN.
 */
export default function IdleLock({ minutes }: { minutes: number }) {
  const last = useRef(Date.now());

  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const bump = () => { last.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true, capture: true });
    const t = setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000) {
        clearInterval(t);
        lockNow();
      }
    }, 15_000);
    return () => {
      clearInterval(t);
      for (const e of events) window.removeEventListener(e, bump, { capture: true } as any);
    };
  }, [minutes]);

  return null;
}
