"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Users,
  ChevronDown,
  Search,
  Check,
  Loader2,
  MessageSquare,
  FileText,
  Sparkles,
  Info,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

/**
 * Which chats the agent watches.
 *
 * The account this links to has fifteen-odd groups on it — training
 * discussions, ITR files, ledger requests, personal chats. Watching all
 * of them means reading things that have nothing to do with supply
 * paperwork. Naming the two or three groups that matter keeps the agent
 * out of everything else, and makes what it learns sharper because the
 * examples all come from the same workflow.
 */

interface Chat {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastSeen: string | null;
  documentCount: number;
  messageCount: number;
  participants?: number;
  selected: boolean;
  suggested: boolean;
}

export default function GroupPicker({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const { notify } = useNotifications();
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receiving, setReceiving] = useState<Set<string>>(new Set());
  const [lab, setLab] = useState<Set<string>>(new Set());
  const [watchAll, setWatchAll] = useState(false);
  // Watching a group and studying it are separate grants: one takes the
  // files, the other reads the conversation around them.
  const [learning, setLearning] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function toggleLearn(jid: string) {
    setLearning((prev) => {
      const next = new Set(prev);
      next.has(jid) ? next.delete(jid) : next.add(jid);
      return next;
    });
    setDirty(true);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/chats", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setChats(json.chats || []);
      setSelected(
        new Set(
          (json.chats || [])
            .filter((c: any) => c.selected ?? c.watched)
            .map((c: Chat) => c.jid)
        )
      );
      setLearning(new Set(json.learnChats || []));
      setReceiving(new Set(json.receivingChats || []));
      setLab(new Set(json.labChats || []));
      setWatchAll(json.watchingAll === true);
      setDirty(false);
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't load chats", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function toggleRole(setter: Dispatch<SetStateAction<Set<string>>>, jid: string) {
    setter((prev) => {
      const next = new Set(prev);
      next.has(jid) ? next.delete(jid) : next.add(jid);
      return next;
    });
    setDirty(true);
  }

  function toggle(jid: string) {
    setWatchAll(false);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(jid) ? next.delete(jid) : next.add(jid);
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedChats: [...selected],
          watchAllChats: watchAll,
          receivingChats: [...receiving],
          labChats: [...lab],
          learnChats: [...learning],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      notify({
        kind: "success",
        title: watchAll ? "Watching every chat" : selected.size ? `Watching ${selected.size} chat(s)` : "Watching no chats",
        detail: watchAll ? "All chats are enabled by explicit choice." : selected.size ? "Documents from other chats will be ignored." : "Nothing will be processed until a chat is selected.",
      });
      setDirty(false);
      onChanged();
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't save", detail: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.name || c.jid).toLowerCase().includes(q));
  }, [chats, query]);

  const watchingAll = watchAll;

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-biome-hover"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={15} className="text-biome-muted" />
        </motion.span>
        <Users size={15} className="text-biome-leafBright" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-biome-text">Which chats to watch</p>
          <p className="text-[11px] text-biome-muted">
            {watchingAll
              ? "Currently reading every chat on this account."
              : selected.size || receiving.size || lab.size
                ? `Sales ${selected.size} · Receiving ${receiving.size} · Lab ${lab.size}`
                : "No workflow chats selected — automatic processing is paused."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-medium ${
            watchingAll
              ? "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt"
              : selected.size > 0
                ? "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright"
                : "border-rose-400/30 bg-rose-400/10 text-rose-400"
          }`}
        >
          {watchingAll
            ? `Monitoring all ${chats.length || ""} chats`.trim()
            : selected.size === 0
              ? "Nothing selected"
              : `Monitoring ${selected.size}`}
        </span>
      </button>

      {/* A live count, so "how many am I monitoring" is answerable at a
          glance rather than by counting ticks. */}
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
              {!connected ? (
                <p className="rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-3 py-2.5 text-[11.5px] text-biome-bolt">
                  Link the WhatsApp account first — the group list comes from the linked phone.
                </p>
              ) : (
                <>
                  <div className="flex items-start gap-2.5 rounded-xl border border-biome-sky/25 bg-biome-sky/5 px-3 py-2.5">
                    <Info size={13} className="mt-0.5 shrink-0 text-biome-skyBright" />
                    <p className="text-[11px] leading-relaxed text-biome-skyBright/90">
                      Assign each workflow group explicitly: Sales for supply paperwork, Receiving for client weight slips, and Lab for client lab reports. The agent only processes the selected workflow scopes. Groups that
                      already have documents in them are marked.
                    </p>
                  </div>

                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a group…"
                      className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
                    />
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-[11.5px] text-biome-muted">
                      <Loader2 size={13} className="animate-spin" /> Loading chats…
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="py-6 text-center text-[11.5px] leading-relaxed text-biome-muted">
                      {query
                        ? "No chat matches that."
                        : "No chats seen yet. They appear as messages arrive, or run a historical scan to populate the list."}
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {filtered.map((c) => {
                        const isOn = selected.has(c.jid);
                        const isLearning = learning.has(c.jid);
                        return (
                          <button
                            key={c.jid}
                            onClick={() => toggle(c.jid)}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              isOn
                                ? "border-biome-leaf/40 bg-biome-leaf/10"
                                : "border-biome-line hover:bg-biome-hover"
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                                isOn ? "border-biome-leaf bg-biome-leaf text-white" : "border-biome-line"
                              }`}
                            >
                              {isOn && <Check size={12} />}
                            </span>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-biome-leaf/10 text-biome-leafBright">
                              {c.isGroup ? <Users size={14} /> : <MessageSquare size={14} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] text-biome-text">
                                {c.name || c.jid.split("@")[0]}
                              </span>
                              <span className="block truncate text-[10px] text-biome-muted">
                                {c.isGroup ? "Group" : "Direct chat"}
                                {c.participants ? ` · ${c.participants} members` : ""}
                                {c.documentCount > 0 ? ` · ${c.documentCount} documents seen` : ""}
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => toggleRole(setSelected, c.jid)} className={`rounded-md border px-1.5 py-1 text-[8.5px] ${selected.has(c.jid) ? "border-biome-leaf/40 bg-biome-leaf/15 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}>Sales</button>
                              <button type="button" onClick={() => toggleRole(setReceiving, c.jid)} className={`rounded-md border px-1.5 py-1 text-[8.5px] ${receiving.has(c.jid) ? "border-biome-sky/40 bg-biome-sky/15 text-biome-skyBright" : "border-biome-line text-biome-muted"}`}>Recv</button>
                              <button type="button" onClick={() => toggleRole(setLab, c.jid)} className={`rounded-md border px-1.5 py-1 text-[8.5px] ${lab.has(c.jid) ? "border-violet-400/40 bg-violet-400/10 text-violet-300" : "border-biome-line text-biome-muted"}`}>Lab</button>
                            </div>
                            {/* Studying a group is a separate, deliberate
                                grant — a span rather than a button, since
                                the row itself is already a button. */}
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e: any) => {
                                e.stopPropagation();
                                toggleLearn(c.jid);
                              }}
                              onKeyDown={(e: any) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  toggleLearn(c.jid);
                                }
                              }}
                              title={
                                isLearning
                                  ? "Reading this group's conversation to learn how documents are described and shared"
                                  : "Also let the agent read this group's conversation, not just its files"
                              }
                              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[9.5px] transition-colors ${
                                isLearning
                                  ? "border-biome-sky/40 bg-biome-sky/10 text-biome-skyBright"
                                  : "border-biome-line text-biome-muted hover:text-biome-text"
                              }`}
                            >
                              <Brain size={10} /> Learn
                            </span>

                            {c.suggested && !isOn && (
                              <span className="flex shrink-0 items-center gap-1 rounded-full border border-biome-bolt/30 bg-biome-bolt/10 px-1.5 py-0.5 text-[9px] text-biome-bolt">
                                <Sparkles size={9} /> likely
                              </span>
                            )}
                            {c.documentCount > 0 && (
                              <span className="flex shrink-0 items-center gap-1 text-[10px] text-biome-muted">
                                <FileText size={10} /> {c.documentCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-[10.5px] leading-relaxed text-biome-muted">
                    {watchingAll
                      ? "Every chat is enabled because you explicitly chose Watch everything."
                      : selected.size
                        ? `Only the ${selected.size} selected chat${selected.size === 1 ? "" : "s"} will be read. Documents elsewhere are ignored entirely.`
                        : "No chat is selected. Nothing will be processed until you choose the Sales group(s)."}
                  </p>

                  <div className="mb-3 grid grid-cols-3 gap-2">
                    {[
                      ["Monitoring", watchingAll ? chats.length : selected.size],
                      ["Groups", chats.filter((c) => c.isGroup && (watchingAll || selected.has(c.jid))).length],
                      ["Learning from", learning.size],
                    ].map(([label, value]) => (
                      <div
                        key={label as string}
                        className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-center"
                      >
                        <p className="font-display text-base font-semibold tabular-nums text-biome-text">
                          {value as number}
                        </p>
                        <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                          {label as string}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <PremiumButton onClick={save} disabled={saving || !dirty}>
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      {dirty ? "Save selection" : "Saved"}
                    </PremiumButton>
                    {!watchingAll && (
                      <PremiumButton
                        variant="ghost"
                        onClick={() => {
                          setSelected(new Set());
                          setWatchAll(true);
                          setDirty(true);
                        }}
                      >
                        Watch everything
                      </PremiumButton>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
