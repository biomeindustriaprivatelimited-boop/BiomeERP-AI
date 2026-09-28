"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone, Download, X } from "lucide-react";
import Portal from "@/components/Portal";

/**
 * "Android app" in the top bar: downloads the Biome APK straight from this
 * server. If none has been uploaded yet, explains the phone-browser route.
 */
export default function AndroidAppButton() {
  const [info, setInfo] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [lan, setLan] = useState<string[]>([]);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fetch("/api/release/files?info=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    fetch("/api/server-info", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setLan(j?.urls || [])).catch(() => {});
  }, [open]);

  const apk = info?.android;
  return (
    <>
      <button ref={ref} onClick={() => setOpen(true)} title="Biome Android app"
        className="flex h-9 items-center gap-1.5 rounded-xl border border-biome-line bg-biome-bg px-2.5 text-[11px] font-semibold text-biome-muted hover:text-biome-text">
        <Smartphone size={15} /> <span className="max-md:hidden">Android app</span>
      </button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
            <div className="w-[min(440px,94vw)] rounded-2xl border border-biome-line bg-biome-bgSoft p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-biome-leaf" />
                <p className="flex-1 text-[14px] font-semibold text-biome-text">Biome Android app</p>
                <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-biome-muted"><X size={15} /></button>
              </div>
              {apk ? (
                <>
                  <p className="mt-2 text-[11.5px] text-biome-muted">Same login, same data — connects to this server. {apk.name} · {(apk.size / 1e6).toFixed(1)} MB.</p>
                  <a href="/api/release/files?kind=android" className="bmx-btn mt-3 flex w-fit items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[12px] font-bold text-white">
                    <Download size={14} /> Download APK
                  </a>
                  <ol className="mt-3 list-decimal space-y-0.5 pl-4 text-[11px] text-biome-muted">
                    <li>Open this page on the phone (or send the APK on WhatsApp) and download.</li>
                    <li>Allow &ldquo;Install unknown apps&rdquo; once, then tap the file.</li>
                    <li>On first launch enter the server address{lan[0] ? <>: <b className="font-mono">{lan[0]}</b></> : ""}.</li>
                  </ol>
                </>
              ) : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">
                  The APK has not been uploaded to this server yet (Developer → Server &amp; devices → Android app).
                  Meanwhile any phone on the office Wi-Fi can open {lan[0] ? <b className="font-mono">{lan[0]}/m</b> : "the server address + /m"} in Chrome and use the same screens.
                </p>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
