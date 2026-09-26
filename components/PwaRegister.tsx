"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * Registers the service worker and offers the install prompt.
 *
 * Android fires `beforeinstallprompt` when the app qualifies; we keep the
 * event and show our own button, because the browser's own banner is easy
 * to miss and gives no context about what is being installed. iOS never
 * fires it, so there we explain the Share → Add to Home Screen route
 * instead of showing a button that would do nothing.
 */
export default function PwaRegister() {
  const [deferred, setDeferred] = useState<any>(null);
  const [dismissed, setDismissed] = useState(true);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registered after load so it never competes with the first paint.
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  useEffect(() => {
    const already =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (already) return;
    if (window.localStorage.getItem("biome:installDismissed") === "1") return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setDismissed(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari: no prompt event exists, so tell them the manual route.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios) { setIosHint(true); setDismissed(false); }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function close() {
    setDismissed(true);
    try { window.localStorage.setItem("biome:installDismissed", "1"); } catch { /* private mode */ }
  }

  if (dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[300] mx-auto max-w-md rounded-2xl border border-[#9fe870]/30 bg-[#0e2405]/95 p-4 text-white shadow-[0_20px_60px_-20px_rgb(0_0_0/.8)] backdrop-blur-xl">
      <button onClick={close} aria-label="Dismiss" className="absolute right-2 top-2 rounded-lg p-1.5 text-white/45 hover:text-white">
        <X size={14} />
      </button>
      <p className="text-[13px] font-bold">Install Biome on this phone</p>
      <p className="mt-1 pr-6 text-[11.5px] leading-relaxed text-white/70">
        {iosHint
          ? "Tap the Share button, then “Add to Home Screen”. It opens full-screen and signs in with the same account."
          : "It opens full-screen like any app, signs in with the same account, and works at the gate with one bar."}
      </p>
      {!iosHint && (
        <button
          onClick={async () => {
            if (!deferred) return;
            deferred.prompt();
            try { await deferred.userChoice; } catch { /* the user simply closed it */ }
            setDeferred(null);
            close();
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#9fe870] px-4 py-2.5 text-[12px] font-bold text-[#163300]"
        >
          <Download size={14} /> Install
        </button>
      )}
    </div>
  );
}
