"use client";

import { useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { Smartphone, X, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { motion, AnimatePresence } from "framer-motion";

/**
 * "Open on your phone."
 *
 * A QR that lands the phone on /m/imprest — the same server, the same
 * sign-in, the same float. Built from the server's LAN address rather
 * than the browser's own URL, because on the server PC that URL says
 * localhost and a QR of localhost sends the phone to itself.
 */
export default function PhoneLink() {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[] | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!open || urls) return;
    (async () => {
      try {
        const res = await fetch("/api/server-info", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const list: string[] = Array.isArray(json.urls) ? json.urls : [];
        // If the browser itself is already on a non-localhost address (a
        // client PC), that address is the one every device on the network
        // uses — prefer it.
        const here = window.location.origin;
        const ordered = /localhost|127\.0\.0\.1/.test(here) ? list : [here, ...list.filter((u) => u !== here)];
        setUrls(ordered);
        setPicked(ordered[0] || null);
      } catch {
        setUrls([]);
      }
    })();
  }, [open, urls]);

  useEffect(() => {
    if (!picked) { setQr(null); return; }
    QRCode.toDataURL(`${picked}/m/imprest`, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [picked]);

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted transition-colors hover:text-biome-text">
        <Smartphone size={13} /> Open on phone
      </button>

      <Portal><AnimatePresence>{open && (
        <motion.div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" onClick={() => setOpen(false)}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.div onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="bmx-card w-full max-w-xs rounded-3xl border border-biome-line bg-biome-bgSoft p-6 text-center shadow-[0_40px_100px_-30px_rgb(0_0_0/.7)]">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-biome-text">
                <Smartphone size={14} className="text-biome-leaf" /> Imprest on your phone
              </h3>
              <button onClick={() => setOpen(false)}
                className="bmx-chip flex h-7 w-7 items-center justify-center rounded-lg border border-biome-line text-biome-muted">
                <X size={13} />
              </button>
            </div>

            {urls === null ? (
              <div className="flex justify-center py-10"><Loader2 size={20} className="bmx-spin text-biome-muted" /></div>
            ) : !picked ? (
              <p className="py-6 text-[11px] leading-relaxed text-biome-muted">
                No network address found. The phone and this PC must be on the same Wi-Fi / LAN as the server.
              </p>
            ) : (
              <>
                {qr && (
                  <div className="mx-auto mt-4 w-fit rounded-2xl border border-biome-line bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="QR to open imprest on a phone" width={200} height={200} />
                  </div>
                )}
                <p className="mt-3 font-mono text-[10px] text-biome-muted">{picked}/m/imprest</p>
                {urls.length > 1 && (
                  <select value={picked} onChange={(e) => setPicked(e.target.value)}
                    className="bmx-input mt-2 w-full rounded-xl border border-biome-line bg-biome-bg px-2.5 py-2 text-[10.5px] text-biome-text outline-none">
                    {urls.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                )}
                <p className="mt-3 text-[10px] leading-relaxed text-biome-muted">
                  Scan with the phone&rsquo;s camera, sign in with the same account, and file entries from the field.
                  Everything lands on this server the moment it&rsquo;s filed.
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}</AnimatePresence></Portal>
    </>
  );
}
