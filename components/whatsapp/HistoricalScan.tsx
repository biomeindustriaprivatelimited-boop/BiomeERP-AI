"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Loader2, Play, Square, Info, FolderSync, ChevronDown } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

interface BackfillState {
  active: boolean;
  fromDate: string | null;
  toDate: string | null;
  seen: number;
  queued: number;
  skippedOutOfRange: number;
  startedAt: string | null;
  finishedAt: string | null;
  note: string | null;
}

/** ISO date n months before today, for the default range. */
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export default function HistoricalScan({
  backfill,
  connected,
  onDone,
}: {
  backfill: BackfillState | null;
  connected: boolean;
  onDone: () => void;
}) {
  const { notify } = useNotifications();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(monthsAgo(12));
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState(false);

  async function start() {
    if (new Date(from) > new Date(to)) {
      notify({ kind: "warning", title: "Check the dates", detail: "The start date is after the end date." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: from, toDate: to }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      notify({
        kind: "info",
        title: "Historical scan started",
        detail: "WhatsApp is resyncing. Documents will appear as they come through — this can take several minutes.",
      });
      onDone();
    } catch (err) {
      notify({ kind: "warning", title: "Could not start the scan", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/backfill/stop", { method: "POST" });
      if (!res.ok) throw new Error(`Failed (${res.status}).`);
      notify({ kind: "info", title: "Scan stopped" });
      onDone();
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't stop the scan", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function reanchor() {
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/reanchor", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      notify({
        kind: "success",
        title: json.moved ? `${json.moved} document(s) moved` : "Everything is already in place",
        detail: `Checked ${json.references} supply reference(s).`,
      });
      onDone();
    } catch (err) {
      notify({ kind: "warning", title: "Could not tidy folders", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const running = backfill?.active;

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-biome-hover"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={15} className="text-biome-muted" />
        </motion.span>
        <History size={15} className="text-biome-leafBright" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-biome-text">Scan older chats</p>
          <p className="text-[11px] text-biome-muted">
            Read documents already sitting in the group from before this was set up.
          </p>
        </div>
        {running && (
          <span className="flex items-center gap-1.5 rounded-full border border-biome-bolt/30 bg-biome-bolt/10 px-2.5 py-1 text-[10px] text-biome-bolt">
            <Loader2 size={10} className="animate-spin" /> Scanning
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
            <div className="space-y-3 border-t border-biome-line px-4 py-3.5">
              {/* The honest caveat, stated before the button rather than after. */}
              <div className="flex items-start gap-2.5 rounded-xl border border-biome-sky/25 bg-biome-sky/5 px-3 py-2.5">
                <Info size={13} className="mt-0.5 shrink-0 text-biome-skyBright" />
                <p className="text-[11px] leading-relaxed text-biome-skyBright/90">
                  How far back this can reach depends on the linked phone, not on this app. WhatsApp
                  only shares the history that phone still holds, so a full year is possible but not
                  guaranteed — older media in particular is often already gone from the device.
                  Everything it does send inside your date range is read and filed exactly like a
                  live message.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10.5px] text-biome-muted">From</span>
                  <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/40"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10.5px] text-biome-muted">To</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    max={today()}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/40"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  ["Last 3 months", 3],
                  ["Last 6 months", 6],
                  ["Last 1 year", 12],
                ].map(([label, n]) => (
                  <button
                    key={label as string}
                    onClick={() => {
                      setFrom(monthsAgo(n as number));
                      setTo(today());
                    }}
                    className="rounded-full border border-biome-line bg-biome-hover px-3 py-1 text-[10.5px] text-biome-muted transition-colors hover:text-biome-text"
                  >
                    {label as string}
                  </button>
                ))}
              </div>

              {backfill?.note && !backfill.active && backfill.finishedAt && (
                <p className="rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-3 py-2.5 text-[11px] leading-relaxed text-biome-bolt/90">
                  {backfill.note}
                </p>
              )}

              {backfill && (backfill.startedAt || backfill.seen > 0) && (
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5 text-center">
                  <div>
                    <p className="font-display text-base font-semibold tabular-nums text-biome-text">
                      {backfill.seen}
                    </p>
                    <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">Messages seen</p>
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold tabular-nums text-biome-leafBright">
                      {backfill.queued}
                    </p>
                    <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">Documents found</p>
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold tabular-nums text-biome-muted">
                      {backfill.skippedOutOfRange}
                    </p>
                    <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">Outside range</p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {running ? (
                  <PremiumButton onClick={stop} disabled={busy} className="border-rose-400/40 text-rose-300">
                    <Square size={13} /> Stop scanning
                  </PremiumButton>
                ) : (
                  <PremiumButton onClick={start} disabled={busy || !connected}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    Start historical scan
                  </PremiumButton>
                )}
                <PremiumButton variant="ghost" onClick={reanchor} disabled={busy}>
                  <FolderSync size={13} /> Tidy folders
                </PremiumButton>
              </div>

              <p className="text-[10.5px] leading-relaxed text-biome-muted/70">
                “Tidy folders” re-checks every supply and moves any document that was filed before
                our own invoice arrived into that supply&apos;s correct date folder. Safe to run any
                time.
              </p>

              {!connected && (
                <p className="text-[11px] text-biome-bolt">
                  Link the WhatsApp account above before starting a scan.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
