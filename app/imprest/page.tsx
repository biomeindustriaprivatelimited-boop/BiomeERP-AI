"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Wallet, Plus, Paperclip, Check, X, Loader2, AlertCircle, Users, Receipt,
  ArrowDownLeft, RotateCcw, Clock, Filter, Trash2, Pencil, Target, TrendingUp,
} from "lucide-react";
import { PLANTS } from "@/lib/permissions";
import SetupGuide, { EmptyState } from "@/components/SetupGuide";
import PhoneLink from "@/components/imprest/PhoneLink";
import FormPanel, { FormSection } from "@/components/FormPanel";

/**
 * Imprest.
 *
 * Two audiences on one screen. A holder sees their own float and files
 * against it; accounts and admin see every float and decide what stands.
 * The API already enforces that split — this only decides what to draw.
 */

interface Balance {
  advanced: number; spent: number; returned: number;
  inHand: number; pendingClaims: number; pendingCount: number; lastActivity: string | null;
}
interface Person {
  id: string; code: string; name: string; designation: string; plant: string;
  userId: string | null; monthlyLimit: number; active: boolean; balance?: Balance;
}
interface Attachment { id: string; name: string; size: number; type: string; }
interface Entry {
  id: string; personId: string; kind: "advance" | "expense" | "return";
  date: string; category: string; amount: number; description: string; reference: string;
  plant: string; attachments: Attachment[]; status: "submitted" | "approved" | "rejected";
  createdByName: string; createdAt: string; updatedAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
}

const money = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Plain language. "Return" was read as a rejection rather than as handing
// cash back, which is why the option made no sense to anyone using it.
const KIND_META = {
  advance: { label: "Money received", icon: ArrowDownLeft, tone: "text-emerald-500 bg-emerald-500/12" },
  expense: { label: "Money spent", icon: Receipt, tone: "text-amber-500 bg-amber-500/12" },
  return: { label: "Money given back", icon: RotateCcw, tone: "text-sky-500 bg-sky-500/12" },
} as const;

export default function ImprestPage() {
  const [data, setData] = useState<{
    entries: Entry[]; people: Person[]; me: Person | null;
    canApprove: boolean; viewAll: boolean; canManage: boolean; categories: string[];
    budgetMonth?: string;
    budgetUsage?: BudgetUsage[];
    budgetImpacts?: Record<string, BudgetImpact[]>;
    revision: string; pendingCount: number; needsSetup: boolean; myPlant: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "approvals" | "budgets" | "people">("mine");
  const [statusFilter, setStatusFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("");
  const revision = useRef("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (personFilter) params.set("personId", personFilter);
      const res = await fetch(`/api/imprest/entries?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      revision.current = json.revision;
      setError(null);
    } catch (err) {
      if (!quiet) setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, personFilter]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load(true));

  useEffect(() => { load(); }, [load]);

  /**
   * Near-live refresh. A filed entry shows up for accounts within a few
   * seconds without anyone reloading. Polling rather than a socket because
   * the admin PC goes down a few times a month and a poll simply resumes,
   * where a dropped socket needs reconnection logic to get right.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const canApprove = data?.canApprove ?? false;

  useEffect(() => {
    if (canApprove && tab === "mine" && !data?.me) setTab("approvals");
  }, [canApprove, tab, data?.me]);

  const tabs = useMemo(() => {
    const list: { id: typeof tab; label: string; badge?: number }[] = [];
    if (data?.me) list.push({ id: "mine", label: "My imprest" });
    if (canApprove) {
      list.push({
        id: "approvals",
        label: "All entries",
        badge: data?.entries.filter((e) => e.status === "submitted").length,
      });
    }
    // Over-budget heads carry a count, because a budget nobody looks at is
    // a budget nobody keeps.
    if (canApprove) {
      list.push({
        id: "budgets",
        label: "Budgets",
        badge: (data?.budgetUsage || []).filter((u: any) => u.state === "over").length,
      });
    }
    if (data?.canManage) list.push({ id: "people", label: "Holders" });
    return list;
  }, [data, canApprove]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Wallet size={19} className="text-biome-leaf" /> Imprest
          </h1>
          <p className="mt-1 text-[11.5px] text-biome-muted">
            {canApprove
              ? "Every float in one place. Entries arrive here as staff file them."
              : "File what you spend and attach the bill. Accounts sees it straight away."}
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            <PhoneLink />
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`bmx-chip relative rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold transition ${
                  tab === t.id
                    ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf"
                    : "border-biome-line text-biome-muted hover:text-biome-text"
                }`}
              >
                {t.label}
                {t.badge ? (
                  <span className="bmx-status-dot ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[9px] font-bold text-amber-600">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {/* Fresh install: say what to do instead of showing an empty page. */}
      {data?.canManage && data.needsSetup && tab !== "people" && (
        <SetupGuide
          title="Set imprest up — two minutes"
          intro="Nobody holds a float yet, so there is nothing to file against."
          steps={[
            {
              title: "Add the people who hold cash",
              detail: "One record per person. Link their login and they file their own entries; leave it blank and you file on their behalf.",
              done: false,
              action: { label: "Add holders", onClick: () => setTab("people") },
            },
            {
              title: "Record the opening advance",
              detail: "Whatever cash each person already has. File it as an advance — it lands approved, because you are the one handing it over.",
              done: false,
              blockedBy: "After the first holder",
            },
            {
              title: "Staff start filing",
              detail: "They photograph the bill and file the expense. It reaches this screen within a few seconds.",
              done: false,
              blockedBy: "Nothing to do — it just works",
            },
          ]}
          footnote="Add yourself as a holder too if you spend from petty cash. Note that nobody approves their own entry, so a second approver is needed for yours."
        />
      )}

      {/* Someone with no float and no way to create one. */}
      {data && !data.me && !data.canManage && (
        <EmptyState
          title="You don't have an imprest account yet"
          detail="Ask accounts or the admin to open one for you. Once they do, you can file expenses here and attach the bill photo — it reaches them straight away."
        />
      )}

      {loading && !data ? (
        <p className="text-[11.5px] text-biome-muted">Loading…</p>
      ) : !data ? null : tab === "budgets" ? (
        <BudgetPanel onChanged={() => load()} />
      ) : tab === "people" ? (
        <PeoplePanel onChanged={() => load()} />
      ) : (
        <>
          {/* Float summary */}
          {!data.me && !data.canApprove ? null : tab === "mine" && data.me ? (
            <FloatCard person={data.me} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.people.filter((p) => p.active).map((p) => (
                <FloatCard key={p.id} person={p} compact />
              ))}
            </div>
          )}

          {/* File a new entry */}
          {(data.me || canApprove) && (
            <NewEntry
              people={canApprove ? data.people.filter((p) => p.active) : data.me ? [data.me] : []}
              me={data.me}
              canApprove={canApprove}
              categories={data.categories}
              onFiled={() => load()}
            />
          )}

          {/* Filters */}
          {canApprove && tab === "approvals" && (
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={13} className="text-biome-muted" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
              >
                <option value="all">All statuses</option>
                <option value="submitted">Waiting for a decision</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
              >
                <option value="">Everyone</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
          )}

          {(data.me || data.canApprove) && (
          <EntryList
            entries={data.entries}
            people={data.people}
            canApprove={canApprove}
            myPersonId={data.me?.id ?? null}
            categories={data.categories}
            budgetImpacts={data.budgetImpacts || {}}
            onChanged={() => load()}
          />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FloatCard({ person, compact }: { person: Person; compact?: boolean }) {
  const b = person.balance;
  if (!b) return null;
  const short = b.inHand < 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <span
        className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
        style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)" }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[12.5px] font-semibold text-biome-text">{person.name}</p>
          <p className="text-[10px] text-biome-muted">
            {person.code}{person.designation && ` · ${person.designation}`}
            {person.plant && ` · ${PLANTS.find((p) => p.code === person.plant)?.label ?? person.plant}`}
          </p>
        </div>
        {b.pendingCount > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9.5px] font-semibold text-amber-600">
            <Clock size={10} /> {b.pendingCount} waiting
          </span>
        )}
      </div>

      <div className="relative mt-3">
        <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">
          {short ? "Overspent by" : "Cash in hand"}
        </p>
        <p className={`mt-0.5 font-mono text-[26px] font-semibold tracking-tight ${short ? "text-rose-500" : "text-biome-text"}`}>
          {money(b.inHand)}
        </p>
      </div>

      {!compact && (
        <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-biome-line pt-3">
          <Stat label="Advanced" value={money(b.advanced)} />
          <Stat label="Spent" value={money(b.spent)} />
          <Stat label="Returned" value={money(b.returned)} />
        </div>
      )}

      {b.pendingClaims > 0 && (
        <p className="relative mt-2 text-[10px] text-biome-muted">
          {money(b.pendingClaims)} filed but not yet decided — not counted above.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[.12em] text-biome-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[13px] font-semibold text-biome-text">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NewEntry({
  people, me, canApprove, categories, onFiled,
}: {
  people: Person[]; me: Person | null; canApprove: boolean;
  categories: string[]; onFiled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    personId: me?.id || people[0]?.id || "",
    kind: "expense" as Entry["kind"],
    date: new Date().toISOString().slice(0, 10),
    category: categories[0] || "",
    amount: "",
    description: "",
    reference: "",
    mode: "cash",
    transactionRef: "",
  });

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/imprest/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);

      // Bills go up one at a time against the saved entry, so a failed
      // upload never loses the entry the person just typed.
      for (const file of files) {
        const fd = new FormData();
        fd.set("entryId", json.entry.id);
        fd.set("file", file);
        const up = await fetch("/api/imprest/attachment", { method: "POST", body: fd });
        if (!up.ok) {
          const upErr = await up.json().catch(() => ({}));
          setError(`Entry saved, but "${file.name}" didn't attach: ${upErr.error || up.status}`);
        }
      }

      setForm({ ...form, amount: "", description: "", reference: "" });
      setFiles([]);
      if (!json.overLimit) setOpen(false);
      else setError(`Filed. Note: this month's spend (${money(json.monthSpend)}) is over the ${money(json.limit)} limit, so accounts will see it flagged.`);
      onFiled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Two different situations, two different messages. Telling an admin to
  // "ask accounts" when they ARE accounts is what made this look broken.
  if (people.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bmx-btn flex w-full items-center justify-between rounded-2xl border border-biome-line bg-biome-bgSoft px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Plus size={15} className="text-biome-leaf" /> File an entry
        </span>
        <span className="text-[11px] text-biome-muted">Opens as a card</span>
      </button>

      <FormPanel
        open={open}
        onClose={() => setOpen(false)}
        title="File an imprest entry"
        subtitle="Everything on one screen. Attach the bill before you save."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />}
              {busy ? "Filing…" : "File entry"}
            </button>
          </>
        }
      >
        <FormSection title="What happened" columns={3}>
          {canApprove && people.length > 1 && (
            <Field label="Holder">
              <select value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} className={inputCls}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </select>
            </Field>
          )}

          <Field label="Type">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Entry["kind"] })} className={inputCls}>
              <option value="expense">Money spent — I paid for something (attach the bill)</option>
              <option value="return">Money given back — I returned unspent cash to the office</option>
              {canApprove && <option value="advance">Money received — cash or transfer given to the holder</option>}
            </select>
          </Field>

          <Field label="Date">
            <input type="date" max={new Date().toISOString().slice(0, 10)} value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
          </Field>

          <Field label="Amount (₹)">
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className={inputCls} />
          </Field>

          {form.kind === "expense" && (
            <Field label="Spent on">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}
        </FormSection>

        <FormSection title="How the money moved" hint="Some people are paid in cash and some by transfer — recording which is what lets accounts tie this back to the bank statement." columns={3}>
          <Field label="Payment mode">
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
            </select>
          </Field>

          {form.mode !== "cash" && (
            <Field label="UTR / cheque / txn no.">
              <input value={form.transactionRef} onChange={(e) => setForm({ ...form, transactionRef: e.target.value })}
                placeholder="So it can be matched on the statement" className={inputCls} />
            </Field>
          )}

          <Field label="Bill / voucher no.">
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="Optional" className={inputCls} />
          </Field>
        </FormSection>

        <FormSection title="Details" columns={1}>
          <Field label="What was this for?">
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Diesel for RJ32GD6535, Rewari to Jhajjar — 42 litres at the HP pump on NH352"
              className={`${inputCls} resize-y`} />
          </Field>
        </FormSection>

        <FormSection title="Bill photo or PDF" hint="Up to eight files. Photograph the bill — a phone photo is enough." columns={1}>
          <div>
            <label className="bmx-chip inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-biome-line px-4 py-6 text-[11.5px] text-biome-muted hover:text-biome-text">
              <Paperclip size={15} />
              {files.length === 0 ? "Choose files" : `${files.length} file(s) selected`}
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 8))} />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f) => (
                  <li key={f.name} className="text-[11px] text-biome-muted">
                    {f.name} · {(f.size / 1024).toFixed(0)} KB
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormSection>

        {error && (
          <div className="bmx-msg-in flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[.08] px-4 py-3">
            <AlertCircle size={15} className="mt-px shrink-0 text-amber-600" />
            <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
          </div>
        )}
      </FormPanel>
    </>
  );
}

/* ------------------------------------------------------------------ */

function EntryList({
  entries, people, canApprove, myPersonId, categories, budgetImpacts, onChanged,
}: {
  entries: Entry[]; people: Person[]; canApprove: boolean; myPersonId: string | null;
  categories: string[]; budgetImpacts: Record<string, BudgetImpact[]>; onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || "—";

  async function decide(entry: Entry, decision: "approved" | "rejected") {
    setBusyId(entry.id);
    setRowError((r) => ({ ...r, [entry.id]: "" }));
    try {
      const res = await fetch("/api/imprest/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, decision, note: note[entry.id] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      if (json.failed?.length) throw new Error(json.failed[0].reason);
      onChanged();
    } catch (err) {
      setRowError((r) => ({ ...r, [entry.id]: (err as Error).message }));
    } finally {
      setBusyId(null);
    }
  }

  async function withdraw(entry: Entry) {
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/imprest/entries?id=${entry.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onChanged();
    } catch (err) {
      setRowError((r) => ({ ...r, [entry.id]: (err as Error).message }));
    } finally {
      setBusyId(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-biome-line px-5 py-10 text-center">
        <p className="text-[12px] text-biome-muted">Nothing filed yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const meta = KIND_META[entry.kind];
        const Icon = meta.icon;
        const isMine = myPersonId === entry.personId;
        const canEdit = entry.status === "submitted" && (isMine || canApprove);
        // Nobody signs off their own claim — the API refuses it, so the
        // buttons don't appear either.
        const canDecide = canApprove && entry.status === "submitted" && !isMine;

        return (
          <article
            key={entry.id}
            className="bmx-rise overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
            style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}
          >
            <div className="flex flex-wrap items-start gap-3 p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}>
                <Icon size={16} />
              </span>

              <div className="min-w-[180px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12.5px] font-semibold text-biome-text">{entry.description}</p>
                  <StatusPill status={entry.status} />
                </div>
                <p className="mt-1 text-[10.5px] text-biome-muted">
                  {new Date(entry.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  {canApprove && ` · ${nameOf(entry.personId)}`}
                  {entry.category && ` · ${entry.category}`}
                  {entry.reference && ` · ${entry.reference}`}
                  {entry.plant && ` · ${entry.plant}`}
                </p>

                {entry.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={`/api/imprest/attachment?entryId=${entry.id}&attachmentId=${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bmx-chip inline-flex items-center gap-1.5 rounded-lg border border-biome-line px-2 py-1 text-[10px] text-biome-muted hover:text-biome-text"
                      >
                        <Paperclip size={10} /> {a.name.length > 24 ? a.name.slice(0, 22) + "…" : a.name}
                      </a>
                    ))}
                  </div>
                )}

                {entry.decisionNote && (
                  <p className="mt-2 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[10.5px] text-biome-muted">
                    {entry.status === "rejected" ? "Rejected" : "Approved"} by {entry.decidedByName}: {entry.decisionNote}
                  </p>
                )}

                {rowError[entry.id] && (
                  <p className="bmx-msg-in mt-2 text-[10.5px] text-rose-500">{rowError[entry.id]}</p>
                )}
              </div>

              <div className="text-right">
                <p className={`font-mono text-[16px] font-semibold ${entry.kind === "advance" ? "text-emerald-600" : "text-biome-text"}`}>
                  {entry.kind === "advance" ? "+" : "−"}{money(entry.amount)}
                </p>
                <p className="text-[9.5px] text-biome-muted">{meta.label}</p>
              </div>
            </div>

            {/* What passing this would do to the month's budgets. It sits
                directly above the button, because a warning anywhere else
                is a warning read after the decision. */}
            {canDecide && (budgetImpacts[entry.id] || []).length > 0 && (
              <BudgetWarning impacts={budgetImpacts[entry.id]} />
            )}

            {(canDecide || canEdit) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-biome-line px-4 py-2.5">
                {canDecide && (
                  <>
                    <input
                      value={note[entry.id] || ""}
                      onChange={(e) => setNote({ ...note, [entry.id]: e.target.value })}
                      placeholder="Reason (required to reject)"
                      className="bmx-input min-w-[180px] flex-1 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
                    />
                    <button
                      onClick={() => decide(entry, "approved")}
                      disabled={busyId === entry.id}
                      className="bmx-btn flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                    >
                      {busyId === entry.id ? <Loader2 size={12} className="bmx-spin" /> : <Check size={12} />} Approve
                    </button>
                    <button
                      onClick={() => decide(entry, "rejected")}
                      disabled={busyId === entry.id}
                      className="bmx-btn flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-bold text-rose-500 disabled:opacity-60"
                    >
                      <X size={12} /> Reject
                    </button>
                  </>
                )}
                {canEdit && !canDecide && (
                  <>
                    <button
                      onClick={() => setEditing(editing === entry.id ? null : entry.id)}
                      className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => withdraw(entry)}
                      disabled={busyId === entry.id}
                      className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted"
                    >
                      <Trash2 size={12} /> Withdraw
                    </button>
                  </>
                )}
              </div>
            )}

            {editing === entry.id && (
              <EditRow
                entry={entry}
                categories={categories}
                onDone={() => { setEditing(null); onChanged(); }}
                onError={(m) => setRowError((r) => ({ ...r, [entry.id]: m }))}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

function EditRow({
  entry, categories, onDone, onError,
}: { entry: Entry; categories: string[]; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    date: entry.date,
    amount: String(entry.amount),
    category: entry.category || categories[0] || "",
    description: entry.description,
    reference: entry.reference,
  });

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/imprest/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, kind: entry.kind, ...form, amount: Number(form.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bmx-msg-in grid gap-2.5 border-t border-biome-line bg-biome-bg/40 p-4 md:grid-cols-3">
      <Field label="Date">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Amount (₹)">
        <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
      </Field>
      {entry.kind === "expense" && (
        <Field label="Spent on">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      )}
      <div className="md:col-span-2">
        <Field label="Description">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <Field label="Bill no.">
        <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={inputCls} />
      </Field>
      <div className="md:col-span-3">
        <button onClick={save} disabled={busy} className="bmx-btn flex items-center gap-1.5 rounded-lg bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={12} className="bmx-spin" /> : <Check size={12} />} Save changes
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Entry["status"] }) {
  const map = {
    submitted: ["Waiting", "border-amber-500/30 bg-amber-500/10 text-amber-600"],
    approved: ["Approved", "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"],
    rejected: ["Rejected", "border-rose-500/30 bg-rose-500/10 text-rose-500"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>;
}

/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

interface BudgetImpact {
  budgetId: string; label: string; scope: string; amount: number;
  remainingBefore: number; remainingAfter: number; overBy: number;
}
interface BudgetUsage {
  budget: { id: string; scope: string; key: string; label: string; amount: number; note: string; active: boolean };
  month: string; spent: number; committed: number; remaining: number;
  pct: number; state: "clear" | "watch" | "tight" | "over"; entries: number;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const BUDGET_TONE: Record<string, { bar: string; text: string; chip: string }> = {
  clear: { bar: "bg-emerald-500", text: "text-emerald-600", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  watch: { bar: "bg-sky-500", text: "text-sky-600", chip: "border-sky-500/30 bg-sky-500/10 text-sky-600" },
  tight: { bar: "bg-amber-500", text: "text-amber-600", chip: "border-amber-500/35 bg-amber-500/10 text-amber-600" },
  over: { bar: "bg-rose-500", text: "text-rose-500", chip: "border-rose-500/35 bg-rose-500/10 text-rose-500" },
};

function BudgetWarning({ impacts }: { impacts: BudgetImpact[] }) {
  const breached = impacts.filter((i) => i.overBy > 0);
  const tight = impacts.filter((i) => i.overBy === 0 && i.amount > 0 && i.remainingAfter <= i.amount * 0.1);
  if (!breached.length && !tight.length) return null;
  const over = breached.length > 0;

  return (
    <div className={`border-t px-4 py-2.5 ${over ? "border-rose-500/25 bg-rose-500/[.06]" : "border-amber-500/25 bg-amber-500/[.06]"}`}>
      {breached.map((i) => (
        <p key={i.budgetId} className="flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed text-rose-500">
          <AlertCircle size={12} className="mt-px shrink-0" />
          Approving this takes {i.label} {rupees(i.overBy)} past its {rupees(i.amount)} monthly budget.
        </p>
      ))}
      {tight.map((i) => (
        <p key={i.budgetId} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600">
          <Target size={12} className="mt-px shrink-0" />
          {i.label} would have {rupees(i.remainingAfter)} left for the month.
        </p>
      ))}
    </div>
  );
}

/**
 * The budget screen.
 *
 * Spent and committed are drawn as two parts of one bar rather than added
 * together. An approver looking at a head that is 60% spent and 35%
 * committed is looking at a decision they still get to make; one number
 * showing 95% hides that.
 */
function BudgetPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    scope: "head", key: "", amount: "", note: "",
    // Which month it starts from. Defaults to the one being looked at, so
    // setting a budget in August does not silently backdate itself over
    // July's approved spend and report a breach that never happened.
    fromMonth: new Date().toISOString().slice(0, 7),
    toMonth: "",
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/imprest/budget?month=${month}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load budgets."); return; }
    setData(json);
    setErr(null);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const keyOptions: { value: string; label: string }[] = useMemo(() => {
    if (!data) return [];
    if (draft.scope === "head") return (data.categories || []).map((c: string) => ({ value: c, label: c }));
    if (draft.scope === "plant") return (data.plants || []).map((p: any) => ({ value: p.code, label: p.label }));
    return (data.people || []).map((p: any) => ({ value: p.id, label: p.name }));
  }, [data, draft.scope]);

  async function add() {
    setBusy("new"); setErr(null);
    try {
      const label = keyOptions.find((o) => o.value === draft.key)?.label || draft.key;
      const res = await fetch("/api/imprest/budget", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, label, amount: Number(draft.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save that budget.");
      setOpen(false);
      setDraft({ scope: "head", key: "", amount: "", note: "", fromMonth: month, toMonth: "" });
      await load();
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function change(id: string, patch: any) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch("/api/imprest/budget", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save that change.");
      await load();
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function remove(id: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/imprest/budget?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not remove that budget.");
      await load();
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const usage: BudgetUsage[] = data?.usage || [];
  const totals = usage.reduce(
    (t, u) => ({ amount: t.amount + u.budget.amount, spent: t.spent + u.spent, committed: t.committed + u.committed }),
    { amount: 0, spent: 0, committed: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text" />
        {totals.amount > 0 && (
          <p className="text-[11px] text-biome-muted">
            {rupees(totals.amount)} allocated · {rupees(totals.spent)} approved · {rupees(totals.committed)} waiting
          </p>
        )}
        {data?.canManage && (
          <button onClick={() => setOpen(true)}
            className="bmx-btn ml-auto flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">
            <Plus size={13} /> Set a budget
          </button>
        )}
      </div>

      {err && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{err}</p>
        </div>
      )}

      {data && usage.length === 0 ? (
        <EmptyState
          title="No budgets set for this month"
          detail="A budget is a monthly ceiling on an expense head, a plant, or one holder. Nothing is blocked when it is crossed — the approver is told before they pass the entry, and it shows here in red."
          action={data.canManage ? { label: "Set the first budget", onClick: () => setOpen(true) } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {usage.map((u) => {
            const tone = BUDGET_TONE[u.state];
            const spentPct = u.budget.amount ? Math.min(100, (u.spent / u.budget.amount) * 100) : 0;
            const commitPct = u.budget.amount ? Math.min(100 - spentPct, (u.committed / u.budget.amount) * 100) : 0;
            return (
              <article key={u.budget.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-semibold text-biome-text">{u.budget.label}</p>
                      <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
                        {u.budget.scope}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${tone.chip}`}>
                        {u.state === "over" ? `over by ${rupees(Math.abs(u.remaining))}` : `${rupees(u.remaining)} left`}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-biome-muted">
                      {rupees(u.budget.amount)} a month · {rupees(u.spent)} approved
                      {u.committed > 0 && ` · ${rupees(u.committed)} waiting for a decision`}
                      {u.entries > 0 && ` · ${u.entries} entries`}
                    </p>
                  </div>
                  {data.canManage && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        defaultValue={u.budget.amount}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v > 0 && v !== u.budget.amount) change(u.budget.id, { amount: v });
                        }}
                        className="bmx-input w-[110px] rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
                      />
                      <button onClick={() => remove(u.budget.id)} disabled={busy === u.budget.id}
                        title="Remove this budget"
                        className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-rose-500 disabled:opacity-60">
                        {busy === u.budget.id ? <Loader2 size={12} className="bmx-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-biome-line">
                  <span className={`h-full ${tone.bar}`} style={{ width: `${spentPct}%`, transition: "width .5s cubic-bezier(.22,1,.36,1)" }} />
                  <span className={`h-full ${tone.bar} opacity-40`} style={{ width: `${commitPct}%`, transition: "width .5s cubic-bezier(.22,1,.36,1)" }} />
                </div>
                <p className="mt-1 flex items-center gap-1 text-[9.5px] text-biome-muted">
                  <TrendingUp size={10} /> solid = approved · faded = filed and waiting
                  {u.budget.note && ` · ${u.budget.note}`}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <FormPanel
        open={open}
        onClose={() => setOpen(false)}
        icon={<Target size={20} />}
        eyebrow="Imprest"
        title="Set a monthly budget"
        subtitle="Nothing is blocked when a budget is crossed — the approver is warned before they pass the entry. A hard block would only push the spend under a different head."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={add} disabled={busy === "new" || !draft.key || !Number(draft.amount)}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy === "new" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save budget
            </button>
          </>
        }
      >
        <FormSection title="What it covers" sectionIcon={<Target size={14} />} columns={3}>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Scope</span>
            <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value, key: "" })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text">
              {(data?.scopes || []).map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Which one</span>
            <select value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text">
              <option value="">Select…</option>
              {keyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Rupees per month</span>
            <input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Runs from</span>
            <input type="month" value={draft.fromMonth} onChange={(e) => setDraft({ ...draft, fromMonth: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Until (optional)</span>
            <input type="month" value={draft.toMonth} onChange={(e) => setDraft({ ...draft, toMonth: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
          </label>
          <div className="self-end text-[10px] leading-relaxed text-biome-muted">
            Leave &ldquo;until&rdquo; blank and it keeps running every month.
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Note</span>
              <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Who agreed it, and when it should be looked at again"
                className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
            </label>
          </div>
        </FormSection>
      </FormPanel>
    </div>
  );
}

function PeoplePanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ people: Person[]; users: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", designation: "", plant: "", userId: "", monthlyLimit: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/imprest/people", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setData(json); else setError(json.error || `Failed (${res.status}).`);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/imprest/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, userId: form.userId || null, monthlyLimit: Number(form.monthlyLimit) || 0 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setForm({ code: "", name: "", designation: "", plant: "", userId: "", monthlyLimit: "" });
      await load(); onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/imprest/people", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error || `Failed (${res.status}).`);
    await load(); onChanged();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Users size={15} className="text-biome-leaf" /> Add an imprest holder
        </h2>
        <p className="mt-1 text-[11px] text-biome-muted">
          Link a login and that person files their own entries. Leave it blank for someone who
          doesn&apos;t use the app — accounts files on their behalf.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="Holder code"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="RK01" className={inputCls} /></Field>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ramesh Kumar" className={inputCls} /></Field>
          <Field label="Designation"><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Plant Supervisor" className={inputCls} /></Field>
          <Field label="Plant">
            <select value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} className={inputCls}>
              <option value="">Head office / none</option>
              {PLANTS.map((p) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
            </select>
          </Field>
          <Field label="Linked login">
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className={inputCls}>
              <option value="">No login</option>
              {(data?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
            </select>
          </Field>
          <Field label="Monthly limit (₹)">
            <input type="number" min="0" value={form.monthlyLimit} onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })} placeholder="0 = no limit" className={inputCls} />
          </Field>
        </div>

        <button onClick={create} disabled={busy} className="bmx-btn mt-4 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={14} className="bmx-spin" /> : <Plus size={14} />} Add holder
        </button>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="text-[13px] font-semibold text-biome-text">Holders</h2>
        <div className="mt-3 space-y-2">
          {(data?.people || []).map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-3 ${p.active ? "" : "opacity-55"}`}>
              <div className="min-w-[150px] flex-1">
                <p className="text-[12.5px] font-semibold text-biome-text">{p.name}</p>
                <p className="text-[10.5px] text-biome-muted">
                  {p.code}{p.designation && ` · ${p.designation}`}{p.plant && ` · ${p.plant}`}
                  {p.monthlyLimit > 0 && ` · limit ${money(p.monthlyLimit)}`}
                  {!p.userId && " · no login"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[13px] font-semibold text-biome-text">{money(p.balance?.inHand ?? 0)}</p>
                <p className="text-[9px] uppercase tracking-[.12em] text-biome-muted">in hand</p>
              </div>
              <button
                onClick={() => patch(p.id, { active: !p.active })}
                className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted"
              >
                {p.active ? "Close account" : "Reopen"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

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
