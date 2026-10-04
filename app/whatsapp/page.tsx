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
  Smartphone,
  Hourglass,
  Files,
  FileUp,
  GraduationCap,
  Stethoscope,
  Radio,
  ChevronRight,
  FolderTree,
  X,
} from "lucide-react";
import PremiumButton from "@/components/ui/PremiumButton";
import ConnectionPanel, { Diagnostics } from "@/components/whatsapp/ConnectionPanel";
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

type Tab = "connect" | "sets" | "review" | "all" | "manual" | "train" | "diag";

const TAB_KEYS: Tab[] = ["connect", "sets", "review", "all", "manual", "train", "diag"];

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
  const [tab, setTabState] = useState<Tab>("connect");
  // The tab lives in the address (#sets, #review …) so a refresh or a
  // shared link opens the same place.
  useEffect(() => {
    const h = window.location.hash.replace("#", "") as Tab;
    if (TAB_KEYS.includes(h)) setTabState(h);
  }, []);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      window.history.replaceState(null, "", `#${t}`);
    } catch {
      /* the tab still switches */
    }
  }, []);
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

  const status = loadError ? "unavailable" : state?.status || "disconnected";
  const linked = status === "connected";
  const selectedChats = state?.diag?.selectedChats || [];
  const watchingAll = selectedChats.includes("(all chats)");
  const engineLabel =
    state?.engine === "web"
      ? `WhatsApp Web (${(state.browser || "").split(/[\\/]/).pop() || "browser"})`
      : state?.engine === "baileys"
        ? "Baileys"
        : undefined;

  const TABS: { key: Tab; label: string; icon: typeof Layers; count?: number; tone?: "warn" | "bad" }[] = [
    { key: "connect", label: "Connection & chats", icon: Smartphone, tone: !linked || (!selectedChats.length && !loadError) ? "bad" : undefined },
    { key: "sets", label: "Supply sets", icon: Layers, count: sets.length || undefined },
    { key: "review", label: "Waiting to match", icon: Hourglass, count: unmatchedCount || undefined, tone: unmatchedCount ? "warn" : undefined },
    { key: "all", label: "All documents", icon: Files, count: documents.length || undefined },
    { key: "manual", label: "Add by hand", icon: FileUp },
    { key: "train", label: "Train the agent", icon: GraduationCap },
    { key: "diag", label: "Diagnostics & data", icon: Stethoscope },
  ];

  const sweepButton = unmatchedCount > 0 && (
    <PremiumButton
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
  );

  const searchBox = (placeholder: string) => (
    <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bgSoft py-2.5 pl-8 pr-8 text-[12px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/70"
      />
      {query && (
        <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-biome-muted hover:text-biome-text">
          <X size={13} />
        </button>
      )}
    </div>
  );

  const docList = (list: WhatsappDocument[], emptyTitle: string, emptyBody: string) =>
    !firstLoadDone ? (
      <LoadingCard />
    ) : list.length ? (
      <div className="space-y-2">
        {list.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            onRescan={handleRescan}
            rescanningId={rescanningId}
            onIdentify={setIdentifying}
            onDelete={setDeleting}
          />
        ))}
      </div>
    ) : (
      <EmptyState title={query ? "Nothing matches that search" : emptyTitle} body={query ? "Try the file name, reference, client, vendor or sender." : emptyBody} />
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ---- Header ---- */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4 pt-1"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS · Automation</p>
          <h1 className="biome-shout mt-1 flex items-center gap-3 text-[30px] leading-[1.05] text-biome-text">
            WhatsApp Documents<span className="-ml-2.5 text-biome-leafBright">.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-biome-muted">
            Link the company WhatsApp once and choose the supply group. Every invoice, challan, e-way bill, Bill T and
            weight slip posted there is downloaded, read, matched to its coordination reference and filed into the right
            client and supply folder.
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
          {lastRefreshed && (
            <span className="text-[10px] text-biome-muted">Updated {lastRefreshed.toLocaleTimeString("en-IN")}</span>
          )}
        </div>
      </motion.header>

      {/* ---- At a glance: each card opens the tab that explains it ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Smartphone}
          label="WhatsApp"
          value={STATUS_LABEL[status] || "Not connected"}
          sub={state?.me?.name ? state.me.name : engineLabel || "Not linked yet"}
          tone={linked ? "good" : status === "qr" || status === "connecting" ? "warn" : "bad"}
          onClick={() => setTab("connect")}
          pulse={linked}
        />
        <KpiCard
          icon={Radio}
          label="Chats watched"
          value={watchingAll ? "All" : String(selectedChats.length)}
          sub={
            watchingAll
              ? "Every chat on the account"
              : selectedChats.length
                ? selectedChats.slice(0, 2).join(", ") + (selectedChats.length > 2 ? ` +${selectedChats.length - 2}` : "")
                : "None — nothing is being saved"
          }
          tone={selectedChats.length ? "good" : "bad"}
          onClick={() => setTab("connect")}
        />
        <KpiCard
          icon={Layers}
          label="Supply sets"
          value={String(stats?.totalSets ?? sets.length)}
          sub={`${stats?.completeSets ?? 0} complete · ${stats?.filed ?? 0} documents filed`}
          onClick={() => setTab("sets")}
        />
        <KpiCard
          icon={Hourglass}
          label="Waiting to match"
          value={String(unmatchedCount)}
          sub={unmatchedCount ? "Held until our invoice arrives" : "Everything is matched"}
          tone={unmatchedCount ? "warn" : "good"}
          onClick={() => setTab("review")}
        />
      </div>

      {/* ---- Categories ---- */}
      <nav className="sticky top-0 z-20 -mx-1 overflow-x-auto px-1 py-1" aria-label="WhatsApp sections">
        <div className="flex w-max min-w-full gap-1 rounded-2xl border border-biome-line bg-biome-bgSoft/90 p-1 shadow-sm backdrop-blur">
          {TABS.map(({ key, label, icon: Icon, count, tone }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                data-testid={`tab-${key}`}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-colors ${
                  active ? "text-[#163300]" : "text-biome-muted hover:text-biome-text"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="wa-tab"
                    className="absolute inset-0 rounded-xl bg-[#9fe870]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <Icon size={14} className="relative" />
                <span className="relative whitespace-nowrap">{label}</span>
                {count !== undefined && (
                  <span
                    className={`relative rounded-full px-1.5 text-[10px] tabular-nums ${
                      active ? "bg-[#163300]/15" : tone === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-biome-hover"
                    }`}
                  >
                    {count}
                  </span>
                )}
                {count === undefined && tone === "bad" && !active && (
                  <span className="relative h-1.5 w-1.5 rounded-full bg-rose-500" title="Needs attention" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-4"
        >
          {tab === "connect" && (
            <>
              <SectionIntro
                title="Connection & chats"
                body="Link the company WhatsApp, then switch on Watch for the group where supply papers are posted. Changes save instantly."
              />
              <ConnectionPanel
                state={state}
                loadError={loadError}
                busy={busy}
                onConnect={() => post("connect")}
                onDisconnect={(forget) => post("disconnect", { forget })}
                hideDiagnostics
              />
              <GroupPicker connected={linked} onChanged={refresh} />
              <HistoricalScan backfill={(state as any)?.backfill ?? null} connected={linked} onDone={refresh} />
            </>
          )}

          {tab === "sets" && (
            <>
              {stats && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile icon={Layers} label="Supply sets" value={stats.totalSets} />
                  <StatTile icon={CheckCircle2} label="Complete sets" value={stats.completeSets} tone="good" />
                  <StatTile icon={Inbox} label="Documents filed" value={stats.filed} />
                  <StatTile icon={AlertCircle} label="Needs review" value={stats.needsReview} tone={stats.needsReview > 0 ? "warn" : undefined} />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionIntro title="Supply sets" body="One card per coordination reference — our invoice with every vendor and client paper filed beside it." compact />
                {searchBox("Reference, client, vendor, vehicle…")}
              </div>
              {!firstLoadDone ? (
                <LoadingCard />
              ) : filteredSets.length ? (
                <div className="space-y-2.5">
                  {filteredSets.map((s, i) => (
                    <SupplySetCard key={s.reference} set={s} onRescan={handleRescan} rescanningId={rescanningId} defaultOpen={i === 0 && !query} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={query ? "Nothing matches that search" : "No supply sets yet"}
                  body={
                    query
                      ? "Try the reference number, the client, or the vehicle number."
                      : linked
                        ? "Sets appear here the moment documents arrive in a watched chat."
                        : "Link WhatsApp and choose the supply group in Connection & chats to start collecting documents."
                  }
                  action={!linked || !selectedChats.length ? { label: "Open Connection & chats", onClick: () => setTab("connect") } : undefined}
                />
              )}
            </>
          )}

          {tab === "review" && (
            <>
              <div className="bmx-card flex flex-wrap items-start gap-4 rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  <Hourglass size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-[15px] font-semibold text-biome-text">Waiting to match</h2>
                  <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-biome-muted">
                    Read and saved, waiting on the reference that ties them to a supply. Vendor papers carry no reference of
                    their own — the moment your invoice with its Other References code arrives, they move into that
                    supply&apos;s folder automatically. Nothing here needs doing by hand.
                  </p>
                  {sweepNote && <p className="mt-2 text-[11px] font-medium text-biome-leafBright">{sweepNote}</p>}
                </div>
                {sweepButton}
              </div>
              <div className="flex justify-end">{searchBox("File, reference, client, sender…")}</div>
              {docList(
                filteredDocs,
                "Nothing is waiting",
                "Every document received so far has been matched to a supply."
              )}
            </>
          )}

          {tab === "all" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionIntro title="All documents" body="Every file the agent has received, newest first — open, re-scan, identify by hand or remove." compact />
                {searchBox("File, reference, client, sender…")}
              </div>
              {docList(filteredDocs, "No documents yet", "No documents have arrived yet.")}
            </>
          )}

          {tab === "manual" && (
            <>
              <SectionIntro
                title="Add by hand"
                body="Papers that came by email, were scanned at the office, or arrived while WhatsApp was not linked go through exactly the WhatsApp path."
              />
              <ManualIngestPanel />
              <div className="bmx-card flex items-start gap-3 rounded-2xl border border-biome-leaf/25 bg-biome-leaf/[.06] px-5 py-4">
                <FolderTree size={16} className="mt-0.5 shrink-0 text-biome-leafBright" />
                <p className="text-[11.5px] leading-relaxed text-biome-muted">
                  <span className="font-semibold text-biome-text">Automatic filing rule:</span> Month → Client → Document
                  Date → Supply Reference. Trading vendor papers are held until they can be linked to our issued document;
                  merged PDFs are read page by page.
                </p>
              </div>
            </>
          )}

          {tab === "train" && (
            <>
              <SectionIntro
                title="Train the agent"
                body="Show the agent real documents with the right answer. It consults these examples before it guesses, and learns from every correction."
              />
              <LearningHeader />
              <TrainAgentPanel />
            </>
          )}

          {tab === "diag" && (
            <>
              <SectionIntro
                title="Diagnostics & data"
                body="Where each message stopped, the agent's live log, and tools to clear scanned data or what was learned from it."
              />
              <div className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
                  <Stethoscope size={15} className="text-biome-leafBright" />
                  <span className="font-display text-[14px] font-semibold text-biome-text">Message pipeline</span>
                  {engineLabel && <span className="rounded-full border border-biome-line px-2 py-0.5">Engine: {engineLabel}</span>}
                  {state?.build && <span className="normal-case rounded-full border border-biome-line px-2 py-0.5 font-mono">Build {state.build}</span>}
                  {state?.inbox && (
                    <span className="normal-case truncate rounded-full border border-biome-line px-2 py-0.5 font-mono" title={state.inbox}>
                      Saving to {state.inbox}
                    </span>
                  )}
                </div>
                {state?.diag ? (
                  <Diagnostics d={state.diag} build={state.build} engine={engineLabel} notADocument={state.stats?.notADocument ?? 0} defaultOpen />
                ) : (
                  <p className="mt-3 text-[11.5px] text-biome-muted">{loadError || "The agent has not reported yet."}</p>
                )}
              </div>
              <DataManagementPanel onChanged={refresh} />
            </>
          )}
        </motion.div>
      </AnimatePresence>

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

const STATUS_LABEL: Record<string, string> = {
  connected: "Watching",
  qr: "Scan the QR",
  connecting: "Connecting…",
  disconnected: "Not linked",
  logged_out: "Unlinked",
  error: "Problem",
  unavailable: "Agent not running",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
  pulse,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "warn" | "bad";
  onClick: () => void;
  pulse?: boolean;
}) {
  const dot = tone === "good" ? "bg-[#9fe870]" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-rose-500" : "bg-biome-line";
  return (
    <button
      type="button"
      onClick={onClick}
      className="bmx-card group flex min-w-0 flex-col rounded-2xl border border-biome-line bg-biome-bgSoft p-4 text-left"
    >
      <span className="flex w-full items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-biome-hover text-biome-text">
          <Icon size={14} />
        </span>
        {label}
        <span className="relative ml-auto flex h-2 w-2">
          {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
        </span>
      </span>
      <span className="mt-2.5 truncate font-display text-[22px] font-semibold leading-tight text-biome-text">{value}</span>
      <span className="mt-0.5 flex w-full items-center gap-1 text-[10.5px] text-biome-muted">
        <span className="min-w-0 flex-1 truncate">{sub}</span>
        <ChevronRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </button>
  );
}

function SectionIntro({ title, body, compact }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={compact ? "min-w-0" : "px-1"}>
      <h2 className="font-display text-[16px] font-semibold text-biome-text">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-biome-muted">{body}</p>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft py-14 text-xs text-biome-muted">
      <Loader2 size={14} className="animate-spin" /> Loading…
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
    tone === "good" ? "text-biome-leafBright" : tone === "warn" ? "text-amber-600 dark:text-amber-300" : "text-biome-text";
  return (
    <div className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
      <div className="flex items-center gap-2 text-biome-muted">
        <Icon size={13} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-biome-line bg-biome-bgSoft/60 px-6 py-14 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-biome-hover text-biome-muted">
        <MessagesSquare size={20} />
      </span>
      <p className="mt-3 font-display text-sm font-semibold text-biome-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-biome-muted">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="bmx-btn mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#9fe870] px-3.5 py-2 text-[11.5px] font-semibold text-[#163300]"
        >
          {action.label} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}
