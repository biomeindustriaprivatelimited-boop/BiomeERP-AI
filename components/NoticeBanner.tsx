"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, AlertTriangle, X } from "lucide-react";

/**
 * Notices aimed at me — from the developer, or a mismatch warning sent by
 * accounts. Shown at the top until I dismiss them; checked every 2 minutes.
 */
export default function NoticeBanner() {
  const [list, setList] = useState<any[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notices", { cache: "no-store" });
      if (r.ok) setList((await r.json()).notices || []);
    } catch { /* offline — try again later */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [load]);

  async function dismiss(id: string) {
    setList((l) => l.filter((n) => n.id !== id));
    await fetch("/api/notices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }

  if (!list.length) return null;
  return (
    <div className="mb-3 space-y-2">
      {list.map((n) => {
        const warn = n.kind === "warning" || n.kind === "maintenance";
        return (
          <div key={n.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${warn ? "border-rose-500/40 bg-rose-500/[.07]" : "border-sky-500/30 bg-sky-500/[.06]"}`}>
            {warn ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" /> : <Megaphone size={16} className="mt-0.5 shrink-0 text-sky-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-biome-text">{n.title}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-biome-muted">{n.body}</p>
              <p className="mt-1 text-[10px] text-biome-muted">{n.createdByName} · {new Date(n.createdAt).toLocaleString("en-IN")}</p>
            </div>
            <button onClick={() => dismiss(n.id)} title="Dismiss" className="rounded-lg p-1 text-biome-muted hover:bg-biome-hover"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
