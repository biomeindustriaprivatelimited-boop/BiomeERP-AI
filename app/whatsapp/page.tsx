"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Portal from "@/components/Portal";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessagesSquare,
  Layers,
  Inbox,
  AlertCircle,
  CheckCircle2,
  Search,
  Loader2,
  RefreshCw,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import ConnectionPanel from "@/components/whatsapp/ConnectionPanel";
import SupplySetCard, { DocumentRow } from "@/components/whatsapp/SupplySetCard";
import HistoricalScan from "@/components/whatsapp/HistoricalScan";
import ManualClassify from "@/components/whatsapp/ManualClassify";
import DataManagementPanel from "@/components/whatsapp/DataManagementPanel";
import GroupPicker from "@/components/whatsapp/GroupPicker";
import LearningHeader from "@/components/whatsapp/LearningHeader";
import TrainAgentPanel from "@/components/whatsapp/TrainAgentPanel";
import ManualIngestPanel from "@/components/whatsapp/ManualIngestPanel";
import { useNotifications } from "@/lib/notifications";
import type { AgentState, SupplySet, WhatsappDocument } from "@/lib/whatsapp";

type Tab = "sets" | "review" | "all";

const POLL_MS = 4000;

export default function WhatsappPage() {
  const { notify } = useNotifications();

  const [state, setState] = useState<AgentState | null>(null);
  const [sets, setSets] = useState<SupplySet[]>([]);
  const [unmatched, setUnmatched] = useState<WhatsappDocument[]>([]);
  const [documents, setDocuments] = useState<WhatsappDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sets");
  const [query, setQuery] = useState("");
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  // Refresh gave no sign it had done anything, so it read as broken even
  // when it worked. These drive a spinner and a "last updated" line.
  const [refreshing, setRefreshing] = useState(false);
  // Flushing the hold queue: vendor paperwork that arrived while the agent
  // was off never got re-offered to our filed documents. This asks the
  // agent to try every one of them again.
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [identifying, setIdentifying] = useState<WhatsappDocument | null>(null);
  const [deleting, setDeleting] = useState<WhatsappDocument | null>(null);

  // So we can tell the user when something new lands without spamming them.
  const lastCountRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, setsRes, docsRes] = await Promise.all([
        fetch("/api/whatsapp/status", { cache: "no-store" }),
        fetch("/api/whatsapp/sets", { cache: "no-store" }),
        fetch("/api/whatsapp/documents?limit=500", { cache: "no-store" }),
      ]);

      if (!statusRes.ok) {
        const body = await statusRes.json().catch(() => ({}));
        setLoadError(body.error || `The WhatsApp agent returned ${statusRes.status}.`);
        return;
      }

      const statusJson: AgentState = await statusRes.json();
      setState(statusJson);
      setLoadError(null);

      if (setsRes.ok) {
        const s = await setsRes.json();
        setSets(s.sets || []);
        setUnmatched(s.unmatched || []);
      }
      if (docsRes.ok) {
        const d = await docsRes.json();
        setDocuments(d.documents || []);
      }

      const total = statusJson.stats?.totalDocuments ?? 0;
      if (lastCountRef.current !== null && total > lastCountRef.current) {
        const added = total - lastCountRef.current;
        notify({
          kind: "success",
          title: `${added} new ${added === 1 ? "document" : "documents"} from WhatsApp`,
          detail: "Downloaded, read and filed.",
        });
      }
      lastCountRef.current = total;
      setLastRefreshed(new Date());
    } catch (err) {
      setLoadError(
        (err as Error).message ||
          "Could not reach the WhatsApp agent. Check that Biome is running normally."
      );
    } finally {
      setFirstLoadDone(true);
    }
  }, [notify]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => refresh());

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function post(route: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/whatsapp/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      await refresh();
      return json;
    } catch (err) {
      notify({ kind: "warning", title: "That didn't work", detail: (err as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(doc: WhatsappDocument, deleteFiles: boolean) {
    try {
      const res = await fetch("/api/whatsapp/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [doc.id], deleteFiles }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      notify({
        kind: "success",
        title: "Removed",
        detail: deleteFiles ? "The file was deleted from disk." : "The file is still in its folder.",
      });
      setDeleting(null);
      refresh();
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't remove", detail: (err as Error).message });
    }
  }

  async function handleRescan(id: string) {
    setRescanningId(id);
    try {
      const res = await fetch("/api/whatsapp/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Re-scan failed (${res.status}).`);
      notify({
        kind: "success",
        title: "Document re-scanned",
        detail: json.document?.reference?.canonical
          ? `Matched to ${json.document.reference.canonical}.`
          : "Read again, but no coordination reference was found on it.",
      });
      await refresh();
    } catch (err) {
      notify({ kind: "warning", title: "Re-scan failed", detail: (err as Error).message });
    } finally {
      setRescanningId(null);
    }
  }

  const filteredSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) =>
      [s.reference, s.clientName, s.vendorName, s.vendorCode, s.vehicleNo, s.biomeDocNo, s.vendorDocNo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sets, query]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    // "Waiting to match" now means exactly that: vendor papers held for
    // our invoice, plus anything filed without a reference yet. Documents
    // that are simply not business paperwork aren't a task for anyone, so
    // they don't belong in a queue.
    const base =
      tab === "review"
        ? documents.filter((d) => d.bucket === "_Staged" || d.bucket === "unmatched")
        : documents;
    if (!q) return base;
    return base.filter((d) =>
      [d.originalName, d.reference?.canonical, d.extracted?.clientName, d.extracted?.vendorName, d.sender?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [documents, tab, query]);

  const stats = state?.stats;
  const unmatchedCount = documents.filter(
    (d) => d.bucket === "_Staged" || d.bucket === "unmatched"
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ---- Header ---- */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-3 pt-1"
      >
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
            <MessagesSquare size={20} className="text-biome-leafBright" />
            WhatsApp Documents
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
            Link the company WhatsApp account once. From then on, every invoice, challan, e-way bill,
            Bill T and weight slip that arrives is downloaded, read, matched to its coordination
            reference and filed into the right client and supply folder.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PremiumButton
            variant="ghost"
            onClick={async () => {
              setRefreshing(true);
              try {
                await refresh();
              } finally {
                setRefreshing(false);
              }
            }}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </PremiumButton>
          {unmatchedCount > 0 && (
            <PremiumButton
              variant="ghost"
              onClick={async () => {
                setSweeping(true); setSweepNote(null);
                try {
                  const res = await fetch("/api/whatsapp/staged/sweep", { method: "POST" });
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(json.error || "The agent could not run the sweep.");
                  setSweepNote(
                    json.promoted > 0
                      ? `${json.promoted} document${json.promoted === 1 ? "" : "s"} filed. ${json.stillWaiting} still waiting on our invoice.`
                      : `Nothing could be matched yet — ${json.stillWaiting} still waiting on our invoice.`
                  );
                  await refresh();
                } catch (e) {
                  setSweepNote((e as Error).message);
                } finally {
                  setSweeping(false);
                }
              }}
              disabled={sweeping}
            >
              <RefreshCw size={13} className={sweeping ? "animate-spin" : ""} />
              {sweeping ? "Matching…" : `Match the ${unmatchedCount} waiting`}
            </PremiumButton>
          )}
          {sweepNote && (
            <span className="w-full text-[10.5px] text-biome-leafBright">{sweepNote}</span>
          )}
          {lastRefreshed && (
            <span className="text-[10px] text-biome-muted">
              Updated {lastRefreshed.toLocaleTimeString("en-IN")}
            </span>
          )}
        </div>
      </motion.div>

      {/* Learning first: it's the thing that improves over time, so it
          belongs where it's seen, not buried under the plumbing. */}
      <DataManagementPanel onChanged={refresh} />

      {/* "Agent ko documents dikha kar samjhao" — labelled exemplars the
          classifier consults before it guesses. */}
      <TrainAgentPanel />
      <ManualIngestPanel />

      <GroupPicker connected={state?.status === "connected"} onChanged={refresh} />

      <LearningHeader />
      <div className="rounded-xl border border-biome-leaf/20 bg-biome-leaf/5 px-4 py-2.5 text-[10.5px] leading-relaxed text-biome-muted"><span className="font-medium text-biome-text">Automatic filing rule:</span> Month → Client → Document Date → Supply Reference. Trading vendor papers are held until they can be linked to our issued document; merged PDFs are read page-by-page.</div>

      {/* ---- Connection ---- */}
      <ConnectionPanel
        state={state}
        loadError={loadError}
        busy={busy}
        onConnect={() => post("connect")}
        onDisconnect={(forget) => post("disconnect", { forget })}
      />

      {/* ---- Older chats ---- */}
      <HistoricalScan
        backfill={(state as any)?.backfill ?? null}
        connected={state?.status === "connected"}
        onDone={refresh}
      />

      {/* ---- Counts ---- */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={Layers} label="Supply sets" value={stats.totalSets} />
          <StatTile icon={CheckCircle2} label="Complete sets" value={stats.completeSets} tone="good" />
          <StatTile icon={Inbox} label="Documents filed" value={stats.filed} />
          <StatTile
            icon={AlertCircle}
            label="Needs review"
            value={stats.needsReview}
            tone={stats.needsReview > 0 ? "warn" : undefined}
          />
        </div>
      )}

      {/* ---- Tabs + search ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-biome-line bg-biome-hover p-1">
          {(
            [
              ["sets", `Supply sets${sets.length ? ` (${sets.length})` : ""}`],
              [
                "review",
                `Waiting to match${unmatchedCount ? ` (${unmatchedCount})` : ""}`,
              ],
              ["all", `Everything${documents.length ? ` (${documents.length})` : ""}`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                tab === key ? "text-biome-leafBright" : "text-biome-muted hover:text-biome-text"
              }`}
            >
              {tab === key && (
                <motion.span
                  layoutId="wa-tab"
                  className="absolute inset-0 rounded-lg bg-biome-leaf/12"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, client, vendor, vehicle…"
            className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
          />
        </div>
      </div>

      {/* ---- Content ---- */}
      {!firstLoadDone ? (
        <GlassCard className="flex items-center justify-center gap-2 py-14 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </GlassCard>
      ) : tab === "sets" ? (
        filteredSets.length ? (
          <div className="space-y-2.5">
            {filteredSets.map((s, i) => (
              <SupplySetCard
                key={s.reference}
                set={s}
                onRescan={handleRescan}
                rescanningId={rescanningId}
                defaultOpen={i === 0 && !query}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={query ? "Nothing matches that search" : "No supply sets yet"}
            body={
              query
                ? "Try the reference number, the client, or the vehicle number."
                : state?.status === "connected"
                  ? "Documents will appear here the moment they arrive on the linked WhatsApp account."
                  : "Link the WhatsApp account above to start collecting documents."
            }
          />
        )
      ) : (
        <div className="space-y-2">
          {tab === "review" && filteredDocs.length > 0 && (
            <p className="px-1 text-[11px] leading-relaxed text-biome-muted">
              These are read and filed, waiting on the reference that ties them to a supply. Vendor
              papers carry no reference of their own — the moment you share your invoice with its
              Other References code, they move into that supply&apos;s folder automatically. Nothing
              here needs doing by hand.
            </p>
          )}
          {filteredDocs.length ? (
            filteredDocs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onRescan={handleRescan}
                rescanningId={rescanningId}
                onIdentify={setIdentifying}
                onDelete={setDeleting}
              />
            ))
          ) : (
            <EmptyState
              title={query ? "Nothing matches that search" : "Nothing here"}
              body={
                tab === "review"
                  ? "Every document received so far has been matched to a supply."
                  : "No documents have arrived yet."
              }
            />
          )}
        </div>
      )}
      {/* Individual delete, with the file/record choice made explicit —
          deleting a record and deleting a document are different acts. */}
      <Portal><AnimatePresence>
        {deleting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setDeleting(null)}
          >
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              onClick={(e: any) => e.stopPropagation()}
              className="glass w-full max-w-sm rounded-2xl border border-biome-line p-5"
            >
              <h3 className="font-display text-sm font-semibold text-biome-text">Remove this document?</h3>
              <p className="mt-1.5 truncate text-[11.5px] text-biome-muted" title={deleting.originalName}>
                {deleting.originalName}
              </p>
              <div className="mt-4 space-y-2">
                <PremiumButton
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => removeDocument(deleting, false)}
                >
                  Remove the record, keep the file on disk
                </PremiumButton>
                <PremiumButton
                  variant="ghost"
                  className="w-full justify-start border-rose-400/40 text-rose-300"
                  onClick={() => removeDocument(deleting, true)}
                >
                  Delete the file as well
                </PremiumButton>
                <PremiumButton variant="ghost" className="w-full" onClick={() => setDeleting(null)}>
                  Cancel
                </PremiumButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence></Portal>

      <AnimatePresence>
        {identifying && (
          <ManualClassify
            doc={identifying}
            onClose={() => setIdentifying(null)}
            onSaved={() => {
              setIdentifying(null);
              refresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  const color =
    tone === "good" ? "text-biome-leafBright" : tone === "warn" ? "text-biome-bolt" : "text-biome-text";
  return (
    <GlassCard className="px-4 py-3">
      <div className="flex items-center gap-2 text-biome-muted">
        <Icon size={13} />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </GlassCard>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <GlassCard className="px-6 py-14 text-center">
      <p className="font-display text-sm font-medium text-biome-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-biome-muted">{body}</p>
    </GlassCard>
  );
}
