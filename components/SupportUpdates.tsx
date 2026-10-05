"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LifeBuoy, X } from "lucide-react";
import { useSession } from "@/lib/session";
import { useNotifications } from "@/lib/notifications";

/**
 * In-app updates for Help & Support cases.
 *
 * Polls the light summary (GET /api/support?summary=1) — only cases with
 * something new for THIS person: a reply, a status change, a new case for
 * the desk. Each new update goes to the bell and shows once as a small
 * card linking to the case. Email carries the same news (lib/supportMail).
 * Works for every role that holds "support", present or future.
 */
interface Unread { id: string; ref: string; subject: string; status: string; at: string; byName: string; text: string }

export default function SupportUpdates() {
  const { can, user } = useSession();
  const { notify } = useNotifications();
  const pathname = usePathname();
  const seen = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<Unread | null>(null);
  const allowed = Boolean(user) && can("support");

  useEffect(() => {
    if (!allowed) return;
    let stop = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/support?summary=1", { cache: "no-store" });
        if (!res.ok || stop) return;
        const j = await res.json();
        const fresh: Unread[] = (Array.isArray(j.unread) ? j.unread : []).filter((u: Unread) => !seen.current.has(u.id + u.at));
        for (const u of fresh) {
          seen.current.add(u.id + u.at);
          notify({ title: `${u.ref} · ${u.subject}`, detail: `${u.byName}: ${u.text}`, kind: "info" });
        }
        // On the support page itself the list already shows it.
        if (fresh.length && !location.pathname.startsWith("/support")) setToast(fresh[0]);
      } catch { /* offline — try again next time */ }
    };
    poll();
    const t = window.setInterval(poll, 45_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [allowed, notify]);

  useEffect(() => { if (pathname.startsWith("/support")) setToast(null); }, [pathname]);

  if (!toast) return null;
  return (
    <div data-testid="support-update-toast" className="fixed bottom-4 right-4 z-[9998] w-[min(380px,92vw)] rounded-2xl border border-biome-leaf/40 bg-biome-bgSoft p-4 shadow-2xl">
      <div className="flex items-start gap-2.5">
        <LifeBuoy size={16} className="mt-0.5 shrink-0 text-biome-leaf" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-biome-text">Update on {toast.ref}</p>
          <p className="mt-0.5 truncate text-[11px] text-biome-muted">{toast.subject}</p>
          <p className="mt-1 line-clamp-2 text-[11.5px] text-biome-text">{toast.byName}: {toast.text}</p>
          <Link href={`/support?case=${toast.id}`} onClick={() => setToast(null)} className="mt-2 inline-block text-[11px] font-bold text-biome-leaf">
            Open the case
          </Link>
        </div>
        <button onClick={() => setToast(null)} aria-label="Close" className="rounded-lg p-1 text-biome-muted"><X size={14} /></button>
      </div>
    </div>
  );
}
