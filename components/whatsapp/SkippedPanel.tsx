"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, RefreshCw, ChevronDown } from "lucide-react";
import type { WaSkippedItem } from "@/lib/whatsapp";

/**
 * Files the agent saw but did NOT put in a supply set, with the reason —
 * a screenshot or a non-document photo in a sales chat, anything from a
 * chat whose purpose is Ignore. "Why was this not saved?" has an answer.
 */
export default function SkippedPanel() {
  const [items, setItems] = useState<WaSkippedItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/skipped", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Could not load (${res.status}).`);
      setItems(json.items || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const list = items || [];
  const shown = open ? list : list.slice(0, 5);

  return (
    <div className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-5" data-testid="skipped-panel">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-biome-hover text-biome-muted">
          <EyeOff size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[14px] font-semibold text-biome-text">Skipped — not saved as supply papers</h3>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-biome-muted">
            Only chats you selected are read, and only for the purpose you gave them. Screenshots, non-document photos and
            anything from a chat set to Ignore are listed here with the reason.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[11px] text-biome-muted hover:text-biome-text"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {error && <p className="mt-3 text-[11px] text-red-600 dark:text-red-300">{error}</p>}
      {items && !list.length && <p className="mt-3 text-[11.5px] text-biome-muted">Nothing skipped so far.</p>}
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-biome-line/60 rounded-xl border border-biome-line">
          {shown.map((it, i) => (
            <li key={`${it.id || it.fileName}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[11px]" data-testid="skipped-item">
              <span className="min-w-0 max-w-[260px] truncate font-medium text-biome-text" title={it.fileName || ""}>
                {it.fileName || "(no file name)"}
              </span>
              <span className="text-biome-muted">{it.chat || "—"}</span>
              <span className="min-w-0 flex-1 text-amber-700 dark:text-amber-300">{it.reason}</span>
              <span className="font-mono text-[10px] text-biome-muted/80">
                {it.at ? new Date(it.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.length > 5 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 text-[11px] text-biome-muted hover:text-biome-text">
          <ChevronDown size={12} className={open ? "rotate-180" : ""} /> {open ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}
