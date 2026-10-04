"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Users,
  User,
  Search,
  Check,
  Loader2,
  FileText,
  Sparkles,
  RefreshCw,
  Radio,
  X,
  Truck,
  FlaskConical,
  Eye,
  EyeOff,
  AlertTriangle,
  Smartphone,
  Undo2,
} from "lucide-react";
import Portal from "@/components/Portal";
import type { WaChat, WaChatRole, WaChatsResponse } from "@/lib/whatsapp";

/**
 * Which chats the agent watches.
 *
 * One click on a chat's Watch switch saves it — there is no separate Save
 * button to forget. The list shows every chat WhatsApp has (groups first,
 * then people), works whether or not the phone is linked right now, and
 * says plainly why it is empty when it is.
 *
 * Roles: "Watch" is the supply paperwork scope (sales/supply group).
 * Receiving (client weight slips) and Lab (client lab reports) are
 * separate workflow scopes; Learn lets the agent read the conversation
 * around the files, not just the files.
 */

type Filter = "all" | "groups" | "people" | "watching";

const SUGGEST_LABEL = "Sales / Supply / Docs";
const PAGE = 120;

interface Toast {
  id: number;
  text: string;
  tone: "good" | "info" | "bad";
  undo?: () => void;
}

const ROLE_FIELD: Record<WaChatRole, keyof WaChat> = {
  sales: "selected",
  receiving: "receivingSelected",
  lab: "labSelected",
  learn: "learnFrom",
};

function displayName(c: WaChat): string {
  if (c.name) return c.name;
  if (c.isGroup) return "Unnamed group";
  return formatNumber(c.jid) || "Unknown contact";
}

function formatNumber(jid: string): string | null {
  const [user, server] = jid.split("@");
  if (server === "lid") return null; // WhatsApp hides this person's number
  const d = (user || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const AVATAR_TONES = [
  "bg-biome-leaf/15 text-biome-leafBright",
  "bg-biome-sky/15 text-biome-skyBright",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

function avatarTone(jid: string): string {
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = (h * 31 + jid.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "#";
  return (words[0][0] + (words[1]?.[0] || "")).toUpperCase();
}

export default function GroupPicker({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [data, setData] = useState<WaChatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const inflight = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.undo ? 6000 : 3500);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/chats", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The WhatsApp agent answered ${res.status}.`);
      // Never overwrite a click that is still being saved.
      if (inflight.current === 0) setData(json as WaChatsResponse);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // New chats keep arriving for a while after linking; keep the list fresh.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  // Linking just finished: fetch at once rather than on the next tick.
  useEffect(() => {
    if (connected) load(true);
  }, [connected, load]);

  async function refreshFromWhatsapp() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/whatsapp/chats/refresh", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Refresh failed (${res.status}).`);
      setData(json as WaChatsResponse);
      setError(null);
      if (json.note) toast({ text: json.note, tone: "info" });
      else toast({ text: `WhatsApp listed ${json.refreshed ?? 0} chat${json.refreshed === 1 ? "" : "s"}`, tone: "good" });
    } catch (err) {
      toast({ text: (err as Error).message, tone: "bad" });
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Save one change. Optimistic: the switch moves at once; if the save
   * fails it moves back and a toast says why. Functional updates, so two
   * quick clicks never undo each other.
   */
  async function patch(
    body: Record<string, unknown>,
    optimistic: (d: WaChatsResponse) => WaChatsResponse,
    revert: (d: WaChatsResponse) => WaChatsResponse,
    keys: string[]
  ) {
    setData((d) => (d ? optimistic(d) : d));
    setPending((p) => new Set([...p, ...keys]));
    inflight.current += 1;
    try {
      const res = await fetch("/api/whatsapp/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Could not save (${res.status}).`);
      inflight.current -= 1;
      // The server's answer is the truth — but only once every click has landed.
      if (inflight.current === 0) setData(json as WaChatsResponse);
      onChangedRef.current();
      return json as WaChatsResponse;
    } catch (err) {
      inflight.current -= 1;
      setData((d) => (d ? revert(d) : d));
      toast({ text: `Not saved — ${(err as Error).message}`, tone: "bad" });
      return null;
    } finally {
      setPending((p) => {
        const n = new Set(p);
        keys.forEach((k) => n.delete(k));
        return n;
      });
    }
  }

  /** Switch one role on or off for some chats, saved at once. */
  function setRole(jids: string[], role: WaChatRole, on: boolean) {
    return patch(
      jids.length === 1 ? { jid: jids[0], role, on } : { jids, role, on },
      (d) => applyRole(d, jids, role, on),
      (d) => applyRole(d, jids, role, !on, true),
      jids.map((j) => `${j}:${role}`)
    );
  }

  function applyRole(d: WaChatsResponse, jids: string[], role: WaChatRole, on: boolean, keepWatchAll = false): WaChatsResponse {
    const field = ROLE_FIELD[role];
    const watchingAll = role === "learn" || keepWatchAll ? d.watchingAll : false;
    const chats = d.chats.map((c) => {
      if (!jids.includes(c.jid)) return { ...c, watched: watchingAll || c.selected || c.receivingSelected || c.labSelected };
      const next = { ...c, [field]: on } as WaChat;
      next.watched = watchingAll || next.selected || next.receivingSelected || next.labSelected;
      return next;
    });
    const listKey = role === "sales" ? "allowedChats" : role === "receiving" ? "receivingChats" : role === "lab" ? "labChats" : "learnChats";
    const set = new Set(d[listKey]);
    jids.forEach((j) => (on ? set.add(j) : set.delete(j)));
    return { ...d, chats, watchingAll, [listKey]: Array.from(set) } as WaChatsResponse;
  }

  async function toggle(c: WaChat, role: WaChatRole) {
    const field = ROLE_FIELD[role];
    const on = !c[field];
    const wasAll = data?.watchingAll && role !== "learn";
    const ok = await setRole([c.jid], role, on);
    if (!ok) return;
    const name = displayName(c);
    const roleText = role === "sales" ? "" : role === "receiving" ? " for weight slips" : role === "lab" ? " for lab reports" : "";
    toast({
      tone: on ? "good" : "info",
      text:
        role === "learn"
          ? on
            ? `Learning from “${name}”`
            : `Stopped learning from “${name}”`
          : on
            ? `Watching “${name}”${roleText}${wasAll ? " — only selected chats now" : ""}`
            : `Stopped watching “${name}”${roleText}`,
      undo: () => setRole([c.jid], role, !on),
    });
  }

  async function watchSuggested(list: WaChat[]) {
    const jids = list.map((c) => c.jid);
    if (!jids.length) return;
    const ok = await setRole(jids, "sales", true);
    if (ok) {
      toast({
        tone: "good",
        text: `Watching ${jids.length} group${jids.length === 1 ? "" : "s"}: ${list.map(displayName).join(", ")}`,
        undo: () => setRole(jids, "sales", false),
      });
    }
  }

  async function setWatchAll(on: boolean) {
    const flip = (v: boolean) => (d: WaChatsResponse) => ({
      ...d,
      watchingAll: v,
      chats: d.chats.map((c) => ({ ...c, watched: v || c.selected || c.receivingSelected || c.labSelected })),
    });
    const ok = await patch({ watchAllChats: on }, flip(on), flip(!on), ["__all"]);
    if (ok) toast({ tone: on ? "info" : "good", text: on ? "Reading EVERY chat on this account" : "Back to only the selected chats" });
  }

  const chats = data?.chats || [];
  const watchingAll = data?.watchingAll === true;
  const listState = data?.listState;
  const linked = listState ? listState.linked : connected;

  const counts = useMemo(() => {
    const groups = chats.filter((c) => c.isGroup).length;
    const explicit = chats.filter((c) => c.selected || c.receivingSelected || c.labSelected);
    return {
      all: chats.length,
      groups,
      people: chats.length - groups,
      watching: watchingAll ? chats.length : explicit.length,
      watchingGroups: explicit.filter((c) => c.isGroup).length,
      watchingPeople: explicit.filter((c) => !c.isGroup).length,
      learning: chats.filter((c) => c.learnFrom).length,
      receiving: chats.filter((c) => c.receivingSelected).length,
      lab: chats.filter((c) => c.labSelected).length,
    };
  }, [chats, watchingAll]);

  const watchedList = useMemo(() => chats.filter((c) => c.selected || c.receivingSelected || c.labSelected), [chats]);
  const suggestions = useMemo(() => chats.filter((c) => c.suggested && !c.selected), [chats]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === "groups" && !c.isGroup) return false;
      if (filter === "people" && c.isGroup) return false;
      if (filter === "watching" && !(watchingAll || c.selected || c.receivingSelected || c.labSelected)) return false;
      if (!q) return true;
      return [c.name, c.jid, formatNumber(c.jid)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [chats, query, filter, watchingAll]);

  useEffect(() => setLimit(PAGE), [query, filter]);

  const firstPerson = filtered.findIndex((c) => !c.isGroup);
  const visible = filtered.slice(0, limit);

  const scopeTone = watchingAll
    ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : counts.watching
      ? "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright"
      : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300";
  const scopeText = watchingAll
    ? "Reading every chat on this account. Pick chats below to narrow it down."
    : counts.watching
      ? `Saving documents from ${counts.watching} chat${counts.watching === 1 ? "" : "s"}. Documents in other chats are ignored.`
      : "No chat is selected — no document is being saved. Switch on Watch for your supply group.";

  return (
    <section className="bmx-card overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft" data-testid="chat-picker">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start gap-3 px-5 pb-4 pt-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#9fe870] text-[#163300] shadow-sm">
          <Radio size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-biome-text">Which chats to watch</h2>
          <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-biome-muted">
            Switch on <span className="font-semibold text-biome-text">Watch</span> for the group(s) where supply papers are
            posted. It saves instantly — documents from every other chat are ignored.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshFromWhatsapp}
          disabled={refreshing}
          className="bmx-btn flex items-center gap-1.5 rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] font-medium text-biome-text transition-colors hover:border-biome-leaf/40 disabled:opacity-60"
          title="Ask WhatsApp for the latest list of groups and chats"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Reading WhatsApp…" : "Refresh chats"}
        </button>
      </div>

      {/* ---- Summary ---- */}
      <div className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-4">
        {(
          [
            ["Watching", watchingAll ? "All" : counts.watching, Eye],
            ["Groups watched", watchingAll ? counts.groups : counts.watchingGroups, Users],
            ["People watched", watchingAll ? counts.people : counts.watchingPeople, User],
            ["Learning from", counts.learning, Brain],
          ] as [string, number | string, typeof Eye][]
        ).map(([label, value, Icon]) => (
          <div key={label} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted">
              <Icon size={11} /> {label}
            </p>
            <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-biome-text" data-testid={`stat-${label}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className={`mx-5 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] leading-relaxed ${scopeTone}`} data-testid="scope-summary">
        {counts.watching || watchingAll ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
        <span className="flex-1">{scopeText}</span>
        {watchingAll && (
          <button type="button" onClick={() => setWatchAll(false)} className="shrink-0 font-semibold underline-offset-2 hover:underline">
            Only selected chats
          </button>
        )}
      </div>

      {!linked && chats.length > 0 && (
        <p className="mx-5 mt-2 flex items-start gap-2 rounded-xl border border-biome-sky/25 bg-biome-sky/[.06] px-3 py-2 text-[11px] leading-relaxed text-biome-skyBright">
          <Smartphone size={13} className="mt-0.5 shrink-0" />
          WhatsApp is not connected right now. You can still choose chats — the choice is saved and used the moment it
          reconnects.
        </p>
      )}

      {/* Watched chats as removable chips — "what am I watching" at a glance. */}
      {watchedList.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pt-3">
          {watchedList.map((c) => (
            <span
              key={c.jid}
              className="normal-case flex items-center gap-1.5 rounded-full border border-biome-leaf/30 bg-biome-leaf/10 py-1 pl-2.5 pr-1 text-[10.5px] font-medium text-biome-leafBright"
            >
              {c.isGroup ? <Users size={10} /> : <User size={10} />}
              <span className="max-w-[180px] truncate">{displayName(c)}</span>
              {c.receivingSelected && <span className="rounded-full bg-biome-sky/15 px-1.5 text-[9px] text-biome-skyBright">Recv</span>}
              {c.labSelected && <span className="rounded-full bg-violet-500/15 px-1.5 text-[9px] text-violet-700 dark:text-violet-300">Lab</span>}
              <button
                type="button"
                title="Stop watching"
                aria-label={`Stop watching ${displayName(c)}`}
                onClick={async () => {
                  const roles: WaChatRole[] = (["sales", "receiving", "lab"] as WaChatRole[]).filter((r) => c[ROLE_FIELD[r]]);
                  for (const r of roles) await setRole([c.jid], r, false);
                  toast({ tone: "info", text: `Stopped watching “${displayName(c)}”` });
                }}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-biome-leaf/20"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ---- Quick actions ---- */}
      {(suggestions.length > 0 || (!watchingAll && chats.length > 0)) && (
        <div className="flex flex-wrap gap-2 px-5 pt-3">
          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => watchSuggested(suggestions)}
              className="bmx-btn flex items-center gap-1.5 rounded-xl bg-[#9fe870] px-3 py-2 text-[11.5px] font-semibold text-[#163300] transition-transform active:scale-[.98]"
              data-testid="watch-suggested"
            >
              <Sparkles size={13} />
              Watch all groups named {SUGGEST_LABEL} ({suggestions.length})
            </button>
          )}
          {!watchingAll && chats.length > 0 && (
            <button
              type="button"
              onClick={() => setWatchAll(true)}
              className="bmx-btn flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11.5px] font-medium text-biome-muted transition-colors hover:text-biome-text"
              title="Reads documents from every chat, including personal ones — rarely what you want"
            >
              <Eye size={13} /> Watch every chat
            </button>
          )}
        </div>
      )}

      {/* ---- Search + filters ---- */}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
        <div className="relative min-w-[200px] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a group, a person or a number…"
            className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg py-2.5 pl-8 pr-8 text-[12px] text-biome-text outline-none placeholder:text-biome-muted/70"
            data-testid="chat-search"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-biome-muted hover:text-biome-text" aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All", counts.all],
              ["groups", "Groups", counts.groups],
              ["people", "People", counts.people],
              ["watching", "Watching", counts.watching],
            ] as [Filter, string, number][]
          ).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              data-testid={`filter-${key}`}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                filter === key
                  ? "border-transparent bg-[#163300] text-[#9fe870] dark:bg-[#9fe870] dark:text-[#163300]"
                  : "border-biome-line text-biome-muted hover:text-biome-text"
              }`}
            >
              {label} <span className="ml-0.5 tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- The list ---- */}
      <div className="border-t border-biome-line">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-biome-muted">
            <Loader2 size={14} className="animate-spin" /> Loading chats…
          </div>
        ) : error && !data ? (
          <EmptyList
            icon={AlertTriangle}
            title="Couldn't load the chat list"
            body={error}
            action={<SmallButton onClick={() => load()}>Try again</SmallButton>}
          />
        ) : chats.length === 0 ? (
          !linked ? (
            <EmptyList
              icon={Smartphone}
              title="WhatsApp is not linked on this PC"
              body="Link the company WhatsApp in the card above (scan the QR). Your groups and chats appear here a few seconds later — then switch on Watch for the supply group."
              action={<SmallButton onClick={refreshFromWhatsapp} busy={refreshing}>Refresh</SmallButton>}
            />
          ) : listState?.loading || refreshing ? (
            <EmptyList
              icon={Loader2}
              spin
              title="Reading your chats from WhatsApp…"
              body="Right after linking WhatsApp sends the chat list in parts. This usually takes under a minute."
            />
          ) : (
            <EmptyList
              icon={Users}
              title="WhatsApp hasn't listed any chats yet"
              body={listState?.lastError || "It can take a minute after linking. Press Refresh to ask WhatsApp again."}
              action={<SmallButton onClick={refreshFromWhatsapp} busy={refreshing}>Refresh chats</SmallButton>}
            />
          )
        ) : filtered.length === 0 ? (
          <EmptyList
            icon={Search}
            title="No chat matches"
            body={query ? `Nothing called “${query}” in ${filter === "all" ? "your chats" : filter}.` : filter === "watching" ? "No chat is being watched yet." : "Nothing in this list yet."}
          />
        ) : (
          <div className="max-h-[560px] overflow-y-auto px-3 py-2" data-testid="chat-list">
            {visible.map((c, i) => (
              <div key={c.jid}>
                {filter === "all" && !query && (i === 0 || i === firstPerson) && (
                  <p className="px-2 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">
                    {c.isGroup ? `Groups · ${counts.groups}` : `People · ${counts.people}`}
                  </p>
                )}
                <ChatRow chat={c} watchingAll={watchingAll} pending={pending} onToggle={toggle} />
              </div>
            ))}
            {filtered.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE * 4)}
                className="mx-auto my-2 block rounded-xl border border-biome-line px-4 py-2 text-[11px] font-medium text-biome-muted hover:text-biome-text"
              >
                Show {Math.min(filtered.length - limit, PAGE * 4)} more of {filtered.length - limit}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-biome-line px-5 py-2.5 text-[10px] text-biome-muted">
        <span className="flex items-center gap-1"><Eye size={10} /> Watch = save supply papers</span>
        <span className="flex items-center gap-1"><Truck size={10} /> Receiving = client weight slips</span>
        <span className="flex items-center gap-1"><FlaskConical size={10} /> Lab = client lab reports</span>
        <span className="flex items-center gap-1"><Brain size={10} /> Learn = read the conversation too</span>
        {listState?.refreshedAt && <span className="ml-auto">Chat list from WhatsApp {relTime(listState.refreshedAt)}</span>}
      </div>

      {/* ---- Toasts ---- */}
      <Portal>
        {/* Bottom-LEFT: the Watch switches sit on the right edge of every row,
            and a toast there covered the very switch being clicked next. */}
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-[min(380px,calc(100vw-2.5rem))] -translate-x-1/2 flex-col gap-2 sm:left-5 sm:translate-x-0">
          <AnimatePresence initial={false}>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                role="status"
                data-testid="chat-toast"
                className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-biome-line bg-biome-bgSoft px-3.5 py-2.5 text-[12px] text-biome-text shadow-xl"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    t.tone === "good" ? "bg-[#9fe870] text-[#163300]" : t.tone === "bad" ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-biome-sky/15 text-biome-skyBright"
                  }`}
                >
                  {t.tone === "good" ? <Check size={13} /> : t.tone === "bad" ? <AlertTriangle size={12} /> : <EyeOff size={12} />}
                </span>
                <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
                {t.undo && (
                  <button
                    type="button"
                    onClick={() => {
                      t.undo?.();
                      setToasts((prev) => prev.filter((x) => x.id !== t.id));
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-biome-leafBright hover:bg-biome-hover"
                  >
                    <Undo2 size={11} /> Undo
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </Portal>
    </section>
  );
}

function ChatRow({
  chat: c,
  watchingAll,
  pending,
  onToggle,
}: {
  chat: WaChat;
  watchingAll: boolean;
  pending: Set<string>;
  onToggle: (c: WaChat, role: WaChatRole) => void;
}) {
  const name = displayName(c);
  const on = c.selected;
  const anyRole = c.selected || c.receivingSelected || c.labSelected;
  const busy = pending.has(`${c.jid}:sales`);
  const number = c.isGroup ? null : formatNumber(c.jid);
  const last = relTime(c.lastSeen);
  const meta = [
    c.isGroup ? (c.participants ? `${c.participants} members` : "Group") : c.name ? number || "Private number" : "Not in contacts",
    last ? `active ${last}` : null,
  ].filter(Boolean);

  return (
    <div
      data-testid="chat-row"
      data-jid={c.jid}
      data-watching={on ? "1" : "0"}
      className={`group my-1 flex items-center gap-3 rounded-xl border px-2.5 py-2 transition-colors ${
        anyRole ? "border-biome-leaf/35 bg-biome-leaf/[.07]" : "border-transparent hover:border-biome-line hover:bg-biome-hover"
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(c, "sales")}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        title={on ? "Click to stop watching" : "Click to watch this chat"}
      >
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold ${avatarTone(c.jid)}`}>
          {initials(name)}
          <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-biome-bgSoft bg-biome-bg text-biome-muted">
            {c.isGroup ? <Users size={9} /> : <User size={9} />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-biome-text">{name}</span>
            {c.suggested && !on && (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                <Sparkles size={8} /> likely supply
              </span>
            )}
          </span>
          <span className="block truncate text-[10.5px] text-biome-muted">{meta.join(" · ")}</span>
        </span>
      </button>

      {c.documentCount > 0 && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-biome-line px-2 py-0.5 text-[10px] tabular-nums text-biome-muted sm:flex" title="Documents and photos seen in this chat">
          <FileText size={10} /> {c.documentCount}
        </span>
      )}

      <div className="hidden shrink-0 items-center gap-1 md:flex">
        <RoleChip active={c.receivingSelected} busy={pending.has(`${c.jid}:receiving`)} onClick={() => onToggle(c, "receiving")} icon={Truck} label="Receiving" tone="sky" />
        <RoleChip active={c.labSelected} busy={pending.has(`${c.jid}:lab`)} onClick={() => onToggle(c, "lab")} icon={FlaskConical} label="Lab" tone="violet" />
        <RoleChip active={c.learnFrom} busy={pending.has(`${c.jid}:learn`)} onClick={() => onToggle(c, "learn")} icon={Brain} label="Learn" tone="amber" />
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Watch ${name}`}
        data-testid="watch-switch"
        onClick={() => onToggle(c, "sales")}
        className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[11px] font-semibold transition-colors ${
          on
            ? "border-transparent bg-[#9fe870] text-[#163300]"
            : watchingAll
              ? "border-amber-500/30 text-amber-700 dark:text-amber-300"
              : "border-biome-line text-biome-muted hover:border-biome-leaf/40 hover:text-biome-text"
        }`}
      >
        <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-[#163300]" : "bg-biome-line"}`}>
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className={`absolute top-0.5 flex h-4 w-4 items-center justify-center rounded-full shadow ${on ? "left-[18px] bg-[#9fe870]" : "left-0.5 bg-white"}`}
          >
            {busy && <Loader2 size={9} className="animate-spin text-[#163300]" />}
          </motion.span>
        </span>
        {on ? "Watching" : watchingAll ? "All on" : "Watch"}
      </button>
    </div>
  );
}

function RoleChip({
  active,
  busy,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  busy: boolean;
  onClick: () => void;
  icon: typeof Truck;
  label: string;
  tone: "sky" | "violet" | "amber";
}) {
  const on =
    tone === "sky"
      ? "border-biome-sky/40 bg-biome-sky/12 text-biome-skyBright"
      : tone === "violet"
        ? "border-violet-500/40 bg-violet-500/12 text-violet-700 dark:text-violet-300"
        : "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`role-${label.toLowerCase()}`}
      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
        active ? on : "border-biome-line text-biome-muted opacity-70 hover:opacity-100 group-hover:opacity-100"
      }`}
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
      {label}
    </button>
  );
}

function SmallButton({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="bmx-btn mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#9fe870] px-3.5 py-2 text-[11.5px] font-semibold text-[#163300] disabled:opacity-60"
    >
      <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> {children}
    </button>
  );
}

function EmptyList({
  icon: Icon,
  title,
  body,
  action,
  spin,
}: {
  icon: typeof Users;
  title: string;
  body: string;
  action?: React.ReactNode;
  spin?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center" data-testid="chat-empty">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-biome-hover text-biome-muted">
        <Icon size={20} className={spin ? "animate-spin" : ""} />
      </span>
      <p className="mt-3 font-display text-[13.5px] font-semibold text-biome-text">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-biome-muted">{body}</p>
      {action}
    </div>
  );
}
