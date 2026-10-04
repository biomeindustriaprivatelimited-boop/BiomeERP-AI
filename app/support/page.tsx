"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LifeBuoy, Send, Loader2, AlertCircle, AlertTriangle, MessageSquare, Check, ChevronDown,
  CheckCircle2, XCircle, ArrowUp, Search, Clock, Inbox, TrendingUp, Filter, Timer,
  Wallet, CalendarDays, IndianRupee, FileText, Wrench, HelpCircle, Paperclip, Image as ImageIcon,
} from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";

/**
 * Help and support.
 *
 * The one channel where a person can say "my salary is wrong" and have it
 * land somewhere it cannot be lost. Urgent tickets sort to the top of the
 * accounts view and stay there until they are closed — a flag that only
 * changes a colour would be a flag nobody acts on.
 */

interface Reply { id: string; byName: string; byRole: string; message: string; at: string; }
type Status = "submitted" | "accepted" | "pending_admin" | "reopened" | "resolved" | "rejected" | "closed";
interface StatusEvent { status: Status; at: string; byName: string; note: string; }
interface FlowStep { id: Status; label: string; detail: string; step: number; }
interface Ticket {
  id: string; ref: string; subject: string; topic: string; message: string;
  urgency: "normal" | "urgent"; status: Status;
  raisedByName: string; raisedByRole: string; plant: string | null;
  createdAt: string; replies: Reply[]; history: StatusEvent[]; outcome: string;
  attachments?: TicketAttachment[];
  onBehalfOfName?: string;
  reopenCount?: number;
}

interface TicketAttachment {
  id: string; name: string; size: number; type: string;
  uploadedAt: string; uploadedByName: string;
}

interface BoardColumn {
  status: Status; label: string; detail: string;
  count: number; urgent: number; stale: number; oldestDays: number;
}
interface Board {
  columns: BoardColumn[]; open: number; urgentOpen: number;
  unanswered: number; staleTotal: number; medianFirstReplyHours: number | null;
}

export default function SupportPage() {
  const [data, setData] = useState<{
    tickets: Ticket[]; canManage: boolean; canResolve: boolean; canRaise?: boolean; canReopen?: boolean;
    topics: string[]; flow: FlowStep[]; urgentOpen: number;
    board?: Board | null; maxAttachments?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Saving never waits on email, but nobody should believe "they were told"
  // when the notice didn't go — so failed notices are said out loud.
  const [mailNote, setMailNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", topic: "", message: "", urgency: "normal" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "urgent" | "mine" | "settled">("active");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      if (!form.topic && json.topics?.length) setForm((f) => ({ ...f, topic: json.topics[0] }));
    } catch (err) { setError((err as Error).message); }
  }, [form.topic]);

  useEffect(() => { load(); }, [load]);

  // Accounts should not have to reload to notice something urgent arrived.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => window.clearInterval(t);
  }, [load]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setMailNote(mailSummary(json.mail));
      setForm({ ...form, subject: "", message: "", urgency: "normal" });
      setOpen(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function act(id: string, message: string, status?: Status, outcome?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/support", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, message, status, outcome }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setMailNote(mailSummary(json.mail));
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
          <LifeBuoy size={19} className="text-biome-leaf" /> Help &amp; support
        </h1>
        <p className="mt-1 text-[11.5px] text-biome-muted">
          {data?.canManage
            ? "Messages from staff. Anything marked urgent stays at the top until it's closed."
            : "Something wrong with your salary, imprest or the app? Write here — accounts and the admin see it."}
        </p>
      </header>

      {data?.canManage && data.board && <StatusBoard board={data.board} />}

      {data?.canManage && data.urgentOpen > 0 && (
        <div className="bmx-msg-in flex items-center gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/[.08] px-4 py-3">
          <AlertTriangle size={16} className="bmx-status-dot shrink-0 text-rose-500" />
          <p className="text-[12px] font-semibold text-biome-text">
            {data.urgentOpen} urgent message{data.urgentOpen > 1 ? "s" : ""} waiting
          </p>
        </div>
      )}

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {mailNote && (
        <div data-testid="support-mail-note" className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-amber-600" />
          <p className="flex-1 text-[11.5px] text-biome-text">{mailNote}</p>
          <button onClick={() => setMailNote(null)} className="text-[10.5px] font-semibold text-biome-muted">Dismiss</button>
        </div>
      )}

      {data?.canRaise !== false ? (
      <button
        onClick={() => setOpen(true)}
        className="bmx-btn flex w-full items-center justify-between rounded-2xl border border-biome-line bg-biome-bgSoft px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <MessageSquare size={15} className="text-biome-leaf" /> Write a message
        </span>
        <span className="text-[11px] text-biome-muted">With or without documents · opens as a card</span>
      </button>
      ) : (
        <p className="rounded-2xl border border-biome-line bg-biome-bgSoft px-5 py-3 text-[11.5px] text-biome-muted">
          Tickets are raised by the team. As {data?.canReopen ? "developer" : "admin"} you resolve or decline them below{data?.canReopen ? ", and only you can reopen or change a finished case" : ""}.
        </p>
      )}

      <FormPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Write a message"
        subtitle="Accounts and the admin see this. Give the dates and figures if you have them."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Send size={14} />} Send
            </button>
          </>
        }
      >
        <FormSection title="About" columns={2}>
          <Field label="What is it about?">
            <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className={inputCls}>
              {(data?.topics || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Subject">
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="July salary is short by ₹2,400" className={inputCls} />
          </Field>
        </FormSection>

        <FormSection title="Explain what happened" hint="The more detail, the fewer messages back and forth." columns={1}>
          <Field label="Message">
            <textarea rows={14} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder={"Write freely — there is room here.\n\nFor a salary question, the useful things are: which month, what you expected, what you were paid, and how many days you worked."}
              className={`${inputCls} resize-y leading-relaxed`} />
          </Field>
        </FormSection>

        <FormSection title="How urgent is it?" columns={1}>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setForm({ ...form, urgency: form.urgency === "urgent" ? "normal" : "urgent" })}
              className={`bmx-chip flex items-center gap-2 rounded-xl border px-4 py-3 text-[12px] font-semibold transition ${
                form.urgency === "urgent"
                  ? "border-rose-500/45 bg-rose-500/10 text-rose-500"
                  : "border-biome-line text-biome-muted"
              }`}
            >
              <AlertTriangle size={14} /> Mark as urgent
            </button>
            <p className="max-w-[420px] text-[11px] leading-relaxed text-biome-muted">
              Use urgent when money is missing or work is stopped. It goes to the top of the
              accounts list and stays there until someone closes it.
            </p>
          </div>
        </FormSection>

        {error && (
          <div className="bmx-msg-in flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
            <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
            <p className="text-[11.5px] text-biome-text">{error}</p>
          </div>
        )}
      </FormPanel>

      {/* ---- What the queue looks like right now ---- */}
      {data && data.tickets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={<Inbox size={15} />}
            label="Waiting"
            value={String(data.tickets.filter((t) => !SETTLED.includes(t.status)).length)}
            tone="text-amber-600 bg-amber-500/12"
          />
          <Stat
            icon={<AlertTriangle size={15} />}
            label="Urgent"
            value={String(data.tickets.filter((t) => t.urgency === "urgent" && !SETTLED.includes(t.status)).length)}
            tone="text-rose-500 bg-rose-500/12"
            pulse={data.tickets.some((t) => t.urgency === "urgent" && !SETTLED.includes(t.status))}
          />
          <Stat
            icon={<Timer size={15} />}
            label="Longest waiting"
            value={longestWait(data.tickets)}
            tone="text-sky-600 bg-sky-500/12"
          />
          <Stat
            icon={<TrendingUp size={15} />}
            label="Settled this month"
            value={String(data.tickets.filter((t) => SETTLED.includes(t.status) && t.createdAt.slice(0, 7) === new Date().toISOString().slice(0, 7)).length)}
            tone="text-emerald-600 bg-emerald-500/12"
          />
        </div>
      )}

      {/* ---- Filters ---- */}
      {data && data.tickets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={13} className="text-biome-muted" />
          {([
            ["active", "Open"],
            ["urgent", "Urgent"],
            ...(data.canManage ? [["mine", "Answered by me"] as const] : []),
            ["settled", "Settled"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id as typeof view)}
              className={`bmx-chip rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold transition ${
                view === id
                  ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf"
                  : "border-biome-line text-biome-muted hover:text-biome-text"
              }`}
            >
              {label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, person or reference"
              className="bmx-input w-[240px] rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visibleTickets(data?.tickets || [], view, query).map((t, i) => (
          <TicketCard
            key={t.id}
            ticket={t}
            canManage={data!.canManage}
            canResolve={data!.canResolve}
            canReopen={!!data!.canReopen}
            flow={data!.flow}
            expanded={expanded === t.id}
            onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
            onAct={act}
            onChanged={load}
            busy={busy}
            index={i}
          />
        ))}

        {data && visibleTickets(data.tickets, view, query).length === 0 && (
          <div className="rounded-2xl border border-dashed border-biome-line px-6 py-14 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-biome-leaf/10 text-biome-leaf">
              <Inbox size={19} />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-biome-text">
              {data.tickets.length === 0
                ? "No messages yet"
                : query
                ? "Nothing matches that search"
                : view === "urgent"
                ? "Nothing urgent right now"
                : view === "settled"
                ? "Nothing settled yet"
                : "Everything here is settled"}
            </p>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[11.5px] leading-relaxed text-biome-muted">
              {data.canManage
                ? "Messages from staff land here the moment they are sent, and anything marked urgent stays at the top until it is closed."
                : "If your salary, imprest or attendance looks wrong, write here rather than asking around — it reaches accounts and the admin, and you can see exactly how far it has got."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* The status board — for whoever runs the desk                        */
/* ------------------------------------------------------------------ */

/**
 * Built around one question: what is waiting on US.
 *
 * "Unanswered" leads, because it is the number that kills a helpdesk. A
 * reply from the person who RAISED the ticket does not count as an answer —
 * someone chasing their own message three times has still not been
 * answered, and a board that counted those would show a busy, healthy desk
 * while everybody waited.
 */
function StatusBoard({ board }: { board: Board }) {
  const tone = (c: BoardColumn) =>
    c.stale > 0 ? "border-rose-500/30 bg-rose-500/[.06]"
    : c.urgent > 0 ? "border-amber-500/30 bg-amber-500/[.06]"
    : "border-biome-line bg-biome-bgSoft";

  return (
    <section className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <BoardStat
          label="Never answered"
          value={board.unanswered}
          hint="Raised, and nobody from the desk has written back"
          tone={board.unanswered > 0 ? "text-rose-500" : "text-emerald-600"}
        />
        <BoardStat
          label="Quiet over 2 days"
          value={board.staleTotal}
          hint="Open, with no reply since"
          tone={board.staleTotal > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <BoardStat label="Open" value={board.open} hint={`${board.urgentOpen} marked urgent`} tone="text-sky-600" />
        <BoardStat
          label="Usual first reply"
          value={board.medianFirstReplyHours === null ? "—" : `${board.medianFirstReplyHours}h`}
          hint="Median, across everything answered so far"
          tone="text-biome-text"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {board.columns.map((c) => (
          <div key={c.status} className={`bmx-card rounded-2xl border p-3 ${tone(c)}`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{c.label}</p>
              <p className="font-mono text-[17px] font-semibold text-biome-text">{c.count}</p>
            </div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-biome-muted">
              {c.urgent > 0 && <span className="font-bold text-amber-600">{c.urgent} urgent · </span>}
              {c.stale > 0 && <span className="font-bold text-rose-500">{c.stale} gone quiet · </span>}
              {c.oldestDays > 0 ? `oldest ${c.oldestDays}d` : c.count === 0 ? "nothing here" : "all fresh"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BoardStat({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone: string }) {
  return (
    <div className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
      <p className={`mt-1 font-mono text-[20px] font-semibold tracking-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[9.5px] leading-relaxed text-biome-muted">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

function Attachments({
  ticket, canAdd, onChanged,
}: { ticket: Ticket; canAdd: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = ticket.attachments || [];

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("ticketId", ticket.id);
      fd.append("file", file);
      const res = await fetch("/api/support/attachment", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not attach that.");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!list.length && !canAdd) return null;

  return (
    <div className="mt-4 rounded-xl border border-biome-line bg-biome-bg p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">
        <Paperclip size={11} /> Attachments
      </p>

      {list.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {list.map((a) => (
            <a
              key={a.id}
              href={`/api/support/attachment?ticketId=${ticket.id}&id=${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] text-biome-text"
            >
              {a.type.startsWith("image/") ? <ImageIcon size={11} className="text-biome-leaf" /> : <FileText size={11} className="text-biome-leaf" />}
              <span className="max-w-[180px] truncate">{a.name}</span>
              <span className="text-biome-muted">{Math.round(a.size / 1024)} KB</span>
            </a>
          ))}
        </div>
      )}

      {canAdd && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10.5px] text-biome-muted">
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
          />
          <span className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 font-semibold text-biome-text">
            {busy ? <Loader2 size={11} className="bmx-spin" /> : "Add a photo or PDF"}
          </span>
          <span>A screenshot of the screen usually answers this faster than a description.</span>
        </label>
      )}

      {err && <p className="mt-1.5 text-[10.5px] text-rose-500">{err}</p>}
    </div>
  );
}

function TicketCard({
  ticket, canManage, canResolve, canReopen, flow, expanded, onToggle, onAct, onChanged, busy, index,
}: {
  ticket: Ticket; canManage: boolean; canResolve: boolean; canReopen: boolean; flow: FlowStep[];
  expanded: boolean; onToggle: () => void;
  onAct: (id: string, message: string, status?: Status, outcome?: string) => void;
  onChanged: () => void;
  busy: boolean; index: number;
}) {
  const [text, setText] = useState("");
  const settled = ["resolved", "rejected", "closed"].includes(ticket.status);
  const urgent = ticket.urgency === "urgent" && !settled;
  const current = flow.find((f) => f.id === ticket.status);

  return (
    <article
      className={`bmx-rise overflow-hidden rounded-2xl border bg-biome-bgSoft transition-shadow ${
        urgent ? "border-rose-500/40 shadow-[0_0_0_1px_rgba(244,63,94,.12)]" : "border-biome-line"
      }`}
      style={{ animationDelay: `${Math.min(index, 8) * 0.03}s` }}
    >
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          urgent ? "bg-rose-500/12 text-rose-500" : "bg-biome-leaf/10 text-biome-leaf"
        }`}>
          {urgent ? <AlertTriangle size={15} className="bmx-status-dot" /> : (TOPIC_ICON[ticket.topic] ?? <HelpCircle size={13} />)}
        </span>
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-biome-bg px-1.5 py-0.5 font-mono text-[9.5px] text-biome-muted">{ticket.ref}</span>
            <p className="text-[13px] font-semibold text-biome-text">{ticket.subject}</p>
            <StatusPill status={ticket.status} flow={flow} />
          </div>
          <p className="mt-1 text-[10.5px] text-biome-muted">
            {ticket.topic}
            {canManage && ` · ${ticket.raisedByName}`}
            {ticket.onBehalfOfName && ` · for ${ticket.onBehalfOfName}`}
            {(ticket.reopenCount || 0) > 0 &&
              ` · reopened ${ticket.reopenCount} time${ticket.reopenCount === 1 ? "" : "s"}`}
            {ticket.plant && ` · ${ticket.plant}`}
            {" · "}
            {new Date(ticket.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
            {ticket.replies.length > 0 && ` · ${ticket.replies.length} repl${ticket.replies.length === 1 ? "y" : "ies"}`}
          </p>
          {!settled && (
            <p className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold ${
              // Anything past a week without a decision is the thing that
              // makes people stop using a helpdesk, so it is called out.
              (Date.now() - new Date(ticket.createdAt).getTime()) / 86400000 > 7
                ? "bg-rose-500/12 text-rose-500"
                : "bg-biome-bg text-biome-muted"
            }`}>
              <Clock size={9} /> waiting {relativeAge(ticket.createdAt)}
            </p>
          )}
        </div>
        <ChevronDown size={15} className={`text-biome-muted transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* The tracker. This is what the business asked for: the person who
          raised it can see at a glance how far it has got, without having
          to ask anyone. */}
      <div className="border-t border-biome-line px-4 py-3.5">
        <Tracker ticket={ticket} flow={flow} />
        {current && <p className="mt-2 text-[10.5px] text-biome-muted">{current.detail}</p>}
      </div>

      {expanded && (
        <div className="bmx-msg-in border-t border-biome-line p-4">
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-biome-text">{ticket.message}</p>

          {ticket.outcome && (
            <div className={`mt-3 rounded-xl border px-3.5 py-2.5 ${
              ticket.status === "rejected"
                ? "border-rose-500/30 bg-rose-500/[.07]"
                : "border-emerald-500/30 bg-emerald-500/[.07]"
            }`}>
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">
                {ticket.status === "rejected" ? "Not accepted — reason" : "Outcome"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-biome-text">{ticket.outcome}</p>
            </div>
          )}

          {ticket.replies.map((r) => (
            <div key={r.id} className="mt-3 rounded-xl border border-biome-line bg-biome-bg/50 px-3.5 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-biome-muted">
                {r.byName} · {new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-biome-text">{r.message}</p>
            </div>
          ))}

          {settled && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[.06] px-4 py-3">
              <p className="text-[11.5px] font-semibold text-amber-600">This case is finished.</p>
              <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
                {canReopen
                  ? "Only you (developer) can reopen it or change its status — use the buttons below."
                  : "Only the developer can reopen it or change its status. You can still add a reply below — the developer will see it."}
              </p>
            </div>
          )}

          <Attachments ticket={ticket} canAdd={!settled} onChanged={onChanged} />

          <div className="mt-4">
            <textarea
              rows={3} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={canManage ? "Reply, or write the reason before you resolve or decline…" : "Add anything else…"}
              className={`${inputCls} resize-y`}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => { onAct(ticket.id, text); setText(""); }}
              disabled={busy || text.trim().length < 2}
              className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"
            >
              <Send size={12} />Reply
            </button>

            {canReopen && settled && (
              <button onClick={() => { onAct(ticket.id, text || "Reopened by the developer.", "reopened"); setText(""); }} disabled={busy}
                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-amber-500/40 px-3.5 py-2.5 text-[11px] font-bold text-amber-600">
                <ArrowUp size={12} /> Reopen (developer)
              </button>
            )}
            {canReopen && settled && (
              <select value="" disabled={busy}
                onChange={(e) => { const st = e.target.value as Status; if (!st) return; if ((st === "resolved" || st === "rejected") && text.trim().length < 2) { window.alert("Write the reason in the box first."); return; } onAct(ticket.id, text, st, st === "resolved" || st === "rejected" ? text : undefined); setText(""); }}
                className="rounded-xl border border-biome-line bg-biome-bg px-2.5 py-2 text-[11px] text-biome-text">
                <option value="">Change status…</option>
                {flow.filter((f) => f.id !== ticket.status).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            )}

            {canManage && ticket.status === "submitted" && (
              <button onClick={() => { onAct(ticket.id, text, "accepted"); setText(""); }} disabled={busy}
                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-sky-500/40 px-3.5 py-2.5 text-[11px] font-bold text-sky-600">
                <Check size={12} /> Accept the case
              </button>
            )}

            {canManage && !canResolve && ["submitted", "accepted"].includes(ticket.status) && (
              <button onClick={() => { onAct(ticket.id, text, "pending_admin"); setText(""); }} disabled={busy}
                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-amber-500/40 px-3.5 py-2.5 text-[11px] font-bold text-amber-600">
                <ArrowUp size={12} /> Refer to the admin
              </button>
            )}

            {canResolve && !settled && (
              <>
                <button onClick={() => { onAct(ticket.id, text, "resolved", text); setText(""); }} disabled={busy || text.trim().length < 2}
                  className="bmx-btn flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"
                  title="Write what was done in the box above first">
                  <CheckCircle2 size={12} /> Resolve
                </button>
                <button onClick={() => { onAct(ticket.id, text, "rejected", text); setText(""); }} disabled={busy || text.trim().length < 2}
                  className="bmx-chip flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-3.5 py-2.5 text-[11px] font-bold text-rose-500 disabled:opacity-50">
                  <XCircle size={12} /> Decline
                </button>
              </>
            )}

            {ticket.status !== "closed" && !settled && (
              <button onClick={() => { onAct(ticket.id, text, "closed"); setText(""); }} disabled={busy}
                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11px] font-semibold text-biome-muted">
                <Check size={12} /> Close
              </button>
            )}
          </div>

          {canResolve && !settled && (
            <p className="mt-2 text-[10px] text-biome-muted">
              Resolving or declining needs a reason in the box above — the person only ever sees what you write there.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * The step tracker.
 *
 * Drawn from the ticket's own history rather than guessed from its current
 * status, so a case that was referred upward still shows that it was
 * accepted first. The dates are what turn "someone will look at it" into
 * something a person can check.
 */
function Tracker({ ticket, flow }: { ticket: Ticket; flow: FlowStep[] }) {
  const history = Array.isArray(ticket.history) ? ticket.history : [];
  const reached = new Map(history.map((h) => [h.status, h]));

  const declined = ticket.status === "rejected";
  const lane = flow.filter((f) =>
    ["submitted", "accepted", "pending_admin"].includes(f.id) ||
    (declined ? f.id === "rejected" : f.id === "resolved") ||
    f.id === "closed"
  );

  const currentStep = flow.find((f) => f.id === ticket.status)?.step ?? 1;

  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-3">
      {lane.map((step, i) => {
        const at = reached.get(step.id);
        const done = Boolean(at);
        const active = ticket.status === step.id;
        const ahead = step.step > currentStep;
        const bad = step.id === "rejected";

        return (
          <li key={step.id} className="flex min-w-[104px] flex-1 items-start gap-2">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-colors ${
                  done && bad
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-500"
                    : done
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-600"
                    : active
                    ? "border-biome-leaf/60 bg-biome-leaf/10 text-biome-leaf"
                    : "border-biome-line text-biome-muted/40"
                }`}
              >
                {done ? <Check size={10} strokeWidth={3.5} /> : i + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-[10.5px] font-semibold ${ahead ? "text-biome-muted/45" : "text-biome-text"}`}>
                {step.label}
              </p>
              <p className="truncate text-[9px] text-biome-muted">
                {at
                  ? `${new Date(at.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}${at.byName ? " · " + at.byName : ""}`
                  : "—"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StatusPill({ status, flow }: { status: Status; flow: FlowStep[] }) {
  const tone: Record<Status, string> = {
    submitted: "border-amber-500/30 bg-amber-500/10 text-amber-600",
    accepted: "border-sky-500/30 bg-sky-500/10 text-sky-600",
    pending_admin: "border-violet-500/30 bg-violet-500/10 text-violet-600",
    reopened: "border-amber-500/40 bg-amber-500/10 text-amber-700",
    resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    rejected: "border-rose-500/30 bg-rose-500/10 text-rose-500",
    closed: "border-biome-line text-biome-muted",
  };
  const label = flow.find((f) => f.id === status)?.label || status;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${tone[status]}`}>
      {label}
    </span>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bmx-field block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</span>
      <div className="relative">{children}</div>
    </label>
  );
}

/* ================= helpers ================= */

const SETTLED = ["resolved", "rejected", "closed"];

/** Icon per topic, so a queue can be skimmed rather than read. */
const TOPIC_ICON: Record<string, React.ReactNode> = {
  "Salary or payslip": <IndianRupee size={13} />,
  "Imprest or reimbursement": <Wallet size={13} />,
  Attendance: <CalendarDays size={13} />,
  "PF / ESIC": <FileText size={13} />,
  "Documents or KYC": <FileText size={13} />,
  "App not working": <Wrench size={13} />,
  "Something else": <HelpCircle size={13} />,
};

/** How long the oldest unsettled ticket has been waiting. */
function longestWait(tickets: Ticket[]): string {
  const open = tickets.filter((t) => !SETTLED.includes(t.status));
  if (open.length === 0) return "—";
  const oldest = open.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
  return relativeAge(oldest.createdAt);
}

// Not exported: a Next page file may only export the component and a few
// config keys, and this one extra export failed the build. Nothing outside
// this file used it.
function relativeAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    return hours <= 0 ? "just now" : `${hours}h`;
  }
  if (days === 1) return "1 day";
  return `${days} days`;
}

function visibleTickets(tickets: Ticket[], view: string, query: string): Ticket[] {
  const q = query.trim().toLowerCase();
  return tickets.filter((t) => {
    const settled = SETTLED.includes(t.status);
    if (view === "active" && settled) return false;
    if (view === "urgent" && (settled || t.urgency !== "urgent")) return false;
    if (view === "settled" && !settled) return false;
    if (view === "mine" && !t.replies.length) return false;
    if (!q) return true;
    return [t.subject, t.topic, t.ref, t.raisedByName, t.message].join(" ").toLowerCase().includes(q);
  });
}

function Stat({
  icon, label, value, tone, pulse,
}: { icon: React.ReactNode; label: string; value: string; tone: string; pulse?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <span
        className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
        style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)" }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
          <p className="mt-1 font-mono text-[22px] font-semibold tracking-tight text-biome-text">{value}</p>
        </div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone} ${pulse ? "bmx-status-dot" : ""}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}

/** "Saved, but the email notice didn't reach …" — null when every notice went. */
function mailSummary(mail: unknown): string | null {
  const list = Array.isArray(mail) ? (mail as { name: string; ok: boolean; error: string }[]) : [];
  const failed = list.filter((m) => !m.ok);
  if (!failed.length) return null;
  const sent = list.length - failed.length;
  return `Saved. ${sent ? `Email notice sent to ${sent}; ` : ""}not emailed: ${failed.map((f) => `${f.name} (${f.error || "send failed"})`).join("; ")}`;
}
