"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Trash2, FileCheck2, Sparkles, AlertTriangle } from "lucide-react";
import { useNotifications } from "@/lib/notifications";

const KIND_ICON = { success: FileCheck2, info: Sparkles, warning: AlertTriangle } as const;
const KIND_COLOR = {
  success: "text-biome-leafBright",
  info: "text-biome-skyBright",
  warning: "text-amber-400",
} as const;

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const prevCount = useRef(unreadCount);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (unreadCount > prevCount.current) {
      setRing(true);
      const t = setTimeout(() => setRing(false), 700);
      return () => clearTimeout(t);
    }
    prevCount.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        className="relative rounded-lg p-2 text-biome-muted transition-colors hover:bg-white/5 hover:text-biome-text"
        aria-label="Notifications"
      >
        <motion.span
          animate={ring ? { rotate: [0, -14, 12, -8, 6, 0] } : {}}
          transition={{ duration: 0.6 }}
          className="block"
        >
          <Bell size={18} />
        </motion.span>
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-biome-bolt px-1 text-[9px] font-bold text-biome-bg"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="glass absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-biome-line shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-biome-line px-3.5 py-2.5">
              <p className="font-display text-xs font-semibold text-biome-text">Notifications</p>
              {notifications.length > 0 && (
                <button
                  onClick={clear}
                  className="flex items-center gap-1 text-[10px] text-biome-muted transition-colors hover:text-biome-text"
                >
                  <Trash2 size={11} /> Clear all
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CheckCheck size={20} className="text-biome-muted" />
                  <p className="text-[11px] text-biome-muted">
                    You&apos;re all caught up — real events (exports, AI ready, reconciliation runs) show up
                    here.
                  </p>
                </div>
              ) : (
                notifications.map((n, i) => {
                  const Icon = KIND_ICON[n.kind];
                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-start gap-2.5 border-b border-biome-line/60 px-3.5 py-2.5 last:border-0 hover:bg-white/[0.03]"
                    >
                      <Icon size={14} className={`mt-0.5 shrink-0 ${KIND_COLOR[n.kind]}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-medium text-biome-text">{n.title}</p>
                        {n.detail && <p className="mt-0.5 text-[10.5px] text-biome-muted">{n.detail}</p>}
                        <p className="mt-0.5 text-[9.5px] text-biome-muted/70">{timeAgo(n.time)}</p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
