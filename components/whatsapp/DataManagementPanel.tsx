"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trash2,
  Brain,
  Loader2,
  AlertTriangle,
  ChevronDown,
  CalendarRange,
  Layers,
  ShieldCheck,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

/**
 * Two related tools kept together: clearing scanned data, and seeing
 * what the agent has picked up from it.
 *
 * They belong side by side because they're the same lever. Wiping a
 * batch of badly-read documents and then clearing what was learned from
 * them is a single intention, and splitting it across two screens would
 * leave people half-done.
 */

interface PatternSummary {
  updatedAt: string | null;
  stats: { learned: number; corrections: number; applied: number };
  knownSenders: number;
  knownFileShapes: number;
  vendorClientLinks: number;
  recentCorrections: { at: string; fileName: string | null; correctedTo: string }[];
  topShapes: { shape: string; type: string; count: number }[];
}

type Scope = "period" | "bucket" | "all";

export default function DataManagementPanel({ onChanged }: { onChanged: () => void }) {
  const { notify } = useNotifications();
  const [open, setOpen] = useState(false);
  const [patterns, setPatterns] = useState<PatternSummary | null>(null);
  const [scope, setScope] = useState<Scope>("period");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [bucket, setBucket] = useState("unmatched");
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPatterns = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/patterns", { cache: "no-store" });
      if (res.ok) setPatterns(await res.json());
    } catch {
      /* the agent may simply be down; the delete tools still render */
    }
  }, []);

  useEffect(() => {
    if (open) loadPatterns();
  }, [open, loadPatterns]);

  async function runDelete() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { deleteFiles };
      if (scope === "period") {
        if (!from && !to) throw new Error("Pick at least one date.");
        body.from = from || undefined;
        body.to = to || undefined;
      } else if (scope === "bucket") {
        body.bucket = bucket;
      } else {
        // "Everything" is expressed as an open-ended range rather than a
        // special case, so there's one code path and no way to
        // accidentally widen a narrower request.
        body.from = "1970-01-01";
        body.to = new Date().toISOString().slice(0, 10);
      }

      const res = await fetch("/api/whatsapp/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);

      notify({
        kind: "success",
        title: `${json.recordsDeleted} record(s) removed`,
        detail: deleteFiles
          ? `${json.filesRemoved} file(s) deleted from disk.`
          : "Files were kept on disk — only the records were cleared.",
      });
      setConfirming(false);
      onChanged();
    } catch (err) {
      notify({ kind: "warning", title: "Delete failed", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-biome-line bg-white/[0.03] px-3 py-2 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/40";

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-biome-hover"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={15} className="text-biome-muted" />
        </motion.span>
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-biome-leaf to-biome-leafBright">
          <Brain size={17} className="text-biome-text" />
          {patterns && patterns.stats.learned > 0 && (
            <motion.span
              animate={{ scale: [1, 1.35, 1], opacity: [0.45, 0, 0.45] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-xl bg-biome-leafBright blur-md"
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-biome-text">Agent Learning</p>
          <p className="text-[11px] text-biome-muted">
            {patterns?.stats.learned
              ? `Adapting from ${patterns.stats.learned} document${patterns.stats.learned === 1 ? "" : "s"}` +
                (patterns.stats.corrections ? ` and ${patterns.stats.corrections} correction${patterns.stats.corrections === 1 ? "" : "s"}` : "")
              : "Learns your document patterns as they arrive."}
          </p>
        </div>
        {patterns && patterns.stats.learned > 0 && (
          <span className="shrink-0 rounded-full border border-biome-leaf/30 bg-biome-leaf/10 px-2.5 py-1 text-[10px] font-medium text-biome-leafBright">
            {patterns.knownFileShapes} patterns
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-biome-line px-4 py-4">
              {/* ---- What it has learned ---- */}
              {patterns && (
                <div>
                  <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
                    What it has learned
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Documents seen" value={patterns.stats.learned} />
                    <Stat label="Your corrections" value={patterns.stats.corrections} tone="good" />
                    <Stat label="Filename shapes" value={patterns.knownFileShapes} />
                    <Stat label="Vendor↔client links" value={patterns.vendorClientLinks} />
                  </div>

                  {patterns.topShapes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-biome-muted/60">
                        Recognised filename patterns
                      </p>
                      {patterns.topShapes.slice(0, 5).map((s) => (
                        <div key={s.shape} className="flex items-center justify-between gap-3 text-[10.5px]">
                          <span className="min-w-0 truncate font-mono text-biome-muted">{s.shape}</span>
                          <span className="shrink-0 text-biome-text">
                            {s.type.replace(/_/g, " ")}{" "}
                            <span className="text-biome-muted">×{s.count}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-2 text-[10.5px] leading-relaxed text-biome-muted">
                    Every document filed teaches it a little; every correction you make teaches it
                    five times as much. It never overrides a document it can read clearly — this only
                    helps when the page itself is unclear. This memory is kept permanently, because
                    it is how the agent adapts its own rules to your paperwork.
                  </p>

                  <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-biome-muted">
                    <ShieldCheck size={11} className="mt-0.5 shrink-0 text-biome-leafBright" />
                    Learned patterns are kept permanently — they are how the agent adapts its own
                    rules to your paperwork, and that knowledge compounds. A wrong pattern gets
                    outvoted by your next correction rather than needing a reset.
                  </p>
                </div>
              )}

              {/* ---- Delete scanned data ---- */}
              <div className="border-t border-biome-line pt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
                  <Trash2 size={11} /> Delete scanned data
                </p>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["period", "By date range", CalendarRange],
                      ["bucket", "By category", Layers],
                      ["all", "Everything", AlertTriangle],
                    ] as [Scope, string, typeof Layers][]
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setScope(id);
                        setConfirming(false);
                      }}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                        scope === id
                          ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leafBright"
                          : "border-biome-line text-biome-muted hover:text-biome-text"
                      }`}
                    >
                      <Icon size={11} /> {label}
                    </button>
                  ))}
                </div>

                {scope === "period" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] text-biome-muted">From</span>
                      <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] text-biome-muted">To</span>
                      <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input} />
                    </label>
                  </div>
                )}

                {scope === "bucket" && (
                  <select value={bucket} onChange={(e) => setBucket(e.target.value)} className={input}>
                    <option value="unmatched">Unmatched (no reference yet)</option>
                    <option value="_Staged">Held vendor documents</option>
                    <option value="_Not A Document">Not a document</option>
                    <option value="filed">Filed documents</option>
                  </select>
                )}

                <label className="mt-3 flex items-start gap-2.5 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={deleteFiles}
                    onChange={(e) => setDeleteFiles(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#9CCC65]"
                  />
                  <span className="text-[11px] leading-relaxed text-biome-muted">
                    <span className="font-medium text-biome-text">Also delete the files from disk.</span>{" "}
                    Leave this off and only the records are cleared — the documents stay in their
                    folders, so nothing is actually lost.
                  </span>
                </label>

                {confirming && (
                  <p className="mt-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
                    {scope === "all"
                      ? "This clears EVERY scanned record."
                      : scope === "period"
                        ? `This clears records received between ${from || "the beginning"} and ${to}.`
                        : `This clears every record in "${bucket}".`}{" "}
                    {deleteFiles ? "The files will be deleted from disk and cannot be recovered." : "Files on disk are kept."}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  {confirming ? (
                    <>
                      <PremiumButton variant="ghost" onClick={() => setConfirming(false)}>
                        Cancel
                      </PremiumButton>
                      <PremiumButton onClick={runDelete} disabled={busy} className="border-rose-400/40 text-rose-300">
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        Yes, delete
                      </PremiumButton>
                    </>
                  ) : (
                    <PremiumButton variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
                      <Trash2 size={13} /> Delete…
                    </PremiumButton>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2">
      <p className={`font-display text-base font-semibold tabular-nums ${tone === "good" ? "text-biome-leafBright" : "text-biome-text"}`}>
        {value}
      </p>
      <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">{label}</p>
    </div>
  );
}
