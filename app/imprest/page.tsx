"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Wallet, Plus, Paperclip, Check, X, Loader2, AlertCircle, Users, Receipt,
  ArrowDownLeft, RotateCcw, Clock, Filter, Trash2, Pencil, Target, TrendingUp,
  ShieldAlert, Power,
} from "lucide-react";
import { usePlants } from "@/lib/usePlants";
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
  plant: string; attachments: Attachment[]; status: "submitted" | "approved" | "rejected" | "pending_budget_approval";
  createdBy?: string; createdByName: string; createdAt: string; updatedAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  budgetHold?: {
    breaches: { budgetId: string; label: string; periodLabel: string; amount: number; remainingBefore: number; overBy: number }[];
    overBy: number; decision: "pending" | "approved" | "rejected";
    decidedByName: string | null; decidedAt: string | null; note: string | null;
  } | null;
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
    canFileForPlant?: boolean; canBudgetApprove?: boolean; budgetHeldCount?: number; myUserId?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "approvals" | "overbudget" | "budgets" | "people">("mine");
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
    // Over-budget entries are the admin's / developer's call alone.
    if (data?.canBudgetApprove) {
      list.push({ id: "overbudget", label: "Over budget", badge: data.budgetHeldCount || 0 });
    }
    if (canApprove || data?.canBudgetApprove) {
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
      ) : tab === "overbudget" ? (
        <OverBudgetPanel onChanged={() => load()} />
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

          {/* Where this person's budgets stand — before they file. */}
          {tab === "mine" && !canApprove && (data.budgetUsage || []).length > 0 && (
            <MyBudgets usage={data.budgetUsage || []} />
          )}

          {/* File a new entry */}
          {(data.me || canApprove || data.canFileForPlant) && (
            <NewEntry
              people={
                canApprove
                  ? data.people.filter((p) => p.active)
                  : data.canFileForPlant
                  ? [
                      ...(data.me ? [data.me] : []),
                      ...data.people.filter((p) => p.active && p.id !== data.me?.id && p.plant === data.myPlant),
                    ]
                  : data.me ? [data.me] : []
              }
              me={data.me}
              canApprove={canApprove}
              canChooseHolder={canApprove || !!data.canFileForPlant}
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
            canFileForPlant={!!data.canFileForPlant}
            myUserId={data.myUserId || ""}
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
  const PLANTS = usePlants();
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
  people, me, canApprove, canChooseHolder, categories, onFiled,
}: {
  people: Person[]; me: Person | null; canApprove: boolean; canChooseHolder: boolean;
  categories: string[]; onFiled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ impacts: BudgetImpact[]; blocked: boolean } | null>(null);
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

  /**
   * Live budget check while the form is open: the server works out what
   * this amount does to every budget it touches, nothing is saved. The
   * person sees "₹2,400 left, this goes ₹600 over" before pressing File.
   */
  useEffect(() => {
    if (!open || form.kind !== "expense") { setPreview(null); return; }
    const amount = Number(form.amount);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/imprest/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            amount: amount > 0 ? amount : 0.01,
            description: form.description || "preview",
            preview: true,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.preview) {
          setPreview({ impacts: amount > 0 ? json.impacts : json.impacts.map((i: BudgetImpact) => ({ ...i, remainingAfter: i.remainingBefore, overBy: 0 })), blocked: amount > 0 && json.blocked });
        }
      } catch { /* preview is a convenience */ }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, form.kind, form.amount, form.category, form.date, form.personId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setHeld(null);
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
      if (json.budgetBlocked) {
        // Not a normal entry — say so plainly, outside the closed card.
        setHeld(json.message || "Over budget — waiting for admin approval.");
        setOpen(false);
      } else if (!json.overLimit) setOpen(false);
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
      {held && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3">
          <ShieldAlert size={15} className="mt-px shrink-0 text-rose-500" />
          <div className="flex-1">
            <p className="text-[12px] font-semibold text-rose-500">Blocked — over budget, sent to admin for approval</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-biome-text">{held}</p>
          </div>
          <button onClick={() => setHeld(null)} className="text-biome-muted" aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
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
          {canChooseHolder && people.length > 1 && (
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

        {/* Right under the amount, so the effect is seen while typing it. */}
        {preview && preview.impacts.length > 0 && <BudgetPreview impacts={preview.impacts} blocked={preview.blocked} />}

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
  entries, people, canApprove, canFileForPlant, myUserId, myPersonId, categories, budgetImpacts, onChanged,
}: {
  entries: Entry[]; people: Person[]; canApprove: boolean; canFileForPlant: boolean; myUserId: string;
  myPersonId: string | null;
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
        const filedByMe = canFileForPlant && !!myUserId && entry.createdBy === myUserId;
        const undecided = entry.status === "submitted" || entry.status === "pending_budget_approval";
        const canEdit = undecided && (isMine || canApprove || filedByMe);
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
                  {(canApprove || canFileForPlant) && !isMine && ` · ${nameOf(entry.personId)}`}
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

                {entry.status === "pending_budget_approval" && entry.budgetHold && (
                  <div className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/[.06] px-2.5 py-1.5">
                    <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-500">
                      <ShieldAlert size={11} /> Blocked — over budget. Only the admin or developer can pass it.
                    </p>
                    {entry.budgetHold.breaches.map((b) => (
                      <p key={b.budgetId} className="mt-0.5 text-[10px] text-biome-muted">
                        {b.label} · {b.periodLabel}: budget {rupees(b.amount)}, {rupees(Math.max(0, b.remainingBefore))} was left, over by {rupees(b.overBy)}
                      </p>
                    ))}
                  </div>
                )}
                {entry.budgetHold?.decision === "approved" && entry.status !== "pending_budget_approval" && (
                  <p className="mt-2 text-[10px] text-biome-muted">
                    Over-budget amount passed by {entry.budgetHold.decidedByName}{entry.budgetHold.note ? `: ${entry.budgetHold.note}` : ""}
                  </p>
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
      if (json.budgetBlocked && json.message) onError(json.message);
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
    pending_budget_approval: ["Over budget · needs admin", "border-rose-500/35 bg-rose-500/10 text-rose-500"],
  } as const;
  const [label, cls] = map[status] || map.submitted;
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>;
}

/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

interface BudgetImpact {
  budgetId: string; label: string; scope: string; amount: number;
  period?: string; periodLabel?: string; enforce?: boolean;
  remainingBefore: number; remainingAfter: number; overBy: number;
}
interface BudgetDef {
  id: string; scope: string; key: string; label: string; amount: number; note: string; active: boolean;
  period: "monthly" | "quarterly" | "yearly" | "custom"; enforce: boolean;
  fromMonth: string; toMonth: string; startDate: string; endDate: string;
  match: Record<string, string>;
}
interface BudgetUsage {
  budget: BudgetDef;
  month: string; window?: { start: string; end: string; label: string };
  spent: number; committed: number; held?: number; heldCount?: number; remaining: number;
  pct: number; state: "clear" | "watch" | "tight" | "over"; entries: number;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const PERIOD_SHORT: Record<string, string> = { monthly: "month", quarterly: "quarter", yearly: "year", custom: "period" };

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
          Approving this takes {i.label} {rupees(i.overBy)} past its {rupees(i.amount)} budget{i.periodLabel ? ` for ${i.periodLabel}` : ""}.
        </p>
      ))}
      {tight.map((i) => (
        <p key={i.budgetId} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600">
          <Target size={12} className="mt-px shrink-0" />
          {i.label} would have {rupees(i.remainingAfter)} left{i.periodLabel ? ` for ${i.periodLabel}` : ""}.
        </p>
      ))}
    </div>
  );
}

/** Live check inside the entry form: what this amount does to each budget. */
function BudgetPreview({ impacts, blocked }: { impacts: BudgetImpact[]; blocked: boolean }) {
  return (
    <div className={`bmx-msg-in rounded-xl border px-4 py-3 ${blocked ? "border-rose-500/30 bg-rose-500/[.07]" : "border-biome-line bg-biome-bg/50"}`}>
      <p className={`flex items-center gap-1.5 text-[11px] font-bold ${blocked ? "text-rose-500" : "text-biome-text"}`}>
        {blocked ? <ShieldAlert size={13} /> : <Target size={13} className="text-biome-leaf" />}
        {blocked
          ? "Over budget — this will be blocked and sent to the admin for approval"
          : "Budget check"}
      </p>
      <div className="mt-2 space-y-2">
        {impacts.map((i) => {
          const used = i.amount - i.remainingBefore;
          const pctBefore = i.amount ? Math.min(100, Math.max(0, (used / i.amount) * 100)) : 0;
          const pctThis = i.amount ? Math.min(100 - pctBefore, Math.max(0, ((i.remainingBefore - i.remainingAfter) / i.amount) * 100)) : 0;
          const bad = i.overBy > 0;
          return (
            <div key={i.budgetId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10.5px]">
                <span className="font-semibold text-biome-text">
                  {i.label} <span className="font-normal text-biome-muted">· {i.periodLabel}{i.enforce === false ? " · warn only" : ""}</span>
                </span>
                <span className={bad ? "font-semibold text-rose-500" : "text-biome-muted"}>
                  {rupees(i.amount)} budget · {rupees(Math.max(0, i.remainingBefore))} left
                  {bad ? ` · over by ${rupees(i.overBy)}` : ` · ${rupees(i.remainingAfter)} after this`}
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-biome-line">
                <span className={`h-full ${i.remainingBefore <= 0 ? "bg-rose-500" : pctBefore >= 90 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pctBefore}%` }} />
                <span className={`h-full ${bad ? "bg-rose-500" : "bg-sky-500"}`} style={{ width: `${pctThis}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One usage bar — shared by the holder's strip and the budgets screen. */
function UsageBar({ u }: { u: BudgetUsage }) {
  const tone = BUDGET_TONE[u.state];
  const spentPct = u.budget.amount ? Math.min(100, (u.spent / u.budget.amount) * 100) : 0;
  const commitPct = u.budget.amount ? Math.min(100 - spentPct, (u.committed / u.budget.amount) * 100) : 0;
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-biome-line">
      <span className={`h-full ${tone.bar}`} style={{ width: `${spentPct}%`, transition: "width .5s cubic-bezier(.22,1,.36,1)" }} />
      <span className={`h-full ${tone.bar} opacity-40`} style={{ width: `${commitPct}%`, transition: "width .5s cubic-bezier(.22,1,.36,1)" }} />
    </div>
  );
}

/** The budgets that apply to the person filing, shown above the form. */
function MyBudgets({ usage }: { usage: BudgetUsage[] }) {
  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">
        <Target size={12} className="text-biome-leaf" /> Your budgets
      </p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {usage.map((u) => {
          const tone = BUDGET_TONE[u.state];
          return (
            <div key={u.budget.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11.5px] font-semibold text-biome-text">
                  {u.budget.label} <span className="font-normal text-biome-muted">· {u.window?.label || u.month}</span>
                </p>
                <p className={`text-[10.5px] font-semibold ${tone.text}`}>
                  {u.state === "over" ? `over by ${rupees(Math.abs(u.remaining))}` : `${rupees(u.remaining)} left`} · {Math.min(u.pct, 999)}%
                </p>
              </div>
              <UsageBar u={u} />
              <p className="mt-1 text-[9.5px] text-biome-muted">
                {rupees(u.budget.amount)} a {PERIOD_SHORT[u.budget.period] || "month"} · {rupees(u.spent)} approved
                {u.committed > 0 && ` · ${rupees(u.committed)} waiting`}
                {(u.held || 0) > 0 && ` · ${rupees(u.held || 0)} held over budget`}
                {u.budget.enforce === false ? " · warn only" : " · hard limit"}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const SCOPE_FIELD_LABEL: Record<string, string> = {
  personId: "Employee", plant: "Plant", category: "Expense head", designation: "Designation", department: "Department",
};

const emptyDraft = (month: string) => ({
  scope: "person", amount: "", note: "", period: "monthly", enforce: true,
  match: {} as Record<string, string>,
  // Which month it starts from. Defaults to the one being looked at, so a
  // budget set in October does not silently backdate itself over
  // September's approved spend and report a breach that never happened.
  fromMonth: month, toMonth: "", startDate: "", endDate: "",
});

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
  const [draft, setDraft] = useState(emptyDraft(new Date().toISOString().slice(0, 7)));

  const load = useCallback(async () => {
    const res = await fetch(`/api/imprest/budget?month=${month}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load budgets."); return; }
    setData(json);
    setErr(null);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const fields: string[] = data?.scopeFields?.[draft.scope] || [];
  const optionsFor = (field: string): { value: string; label: string }[] => {
    if (!data) return [];
    if (field === "category") return (data.categories || []).map((c: string) => ({ value: c, label: c }));
    if (field === "plant") return (data.plants || []).map((p: any) => ({ value: p.code, label: p.label }));
    if (field === "personId") return (data.people || []).map((p: any) => ({ value: p.id, label: `${p.name} (${p.code})${p.plant ? ` · ${p.plant}` : ""}` }));
    if (field === "designation") return (data.designations || []).map((d: string) => ({ value: d, label: d }));
    if (field === "department") return (data.departments || []).map((d: string) => ({ value: d, label: d }));
    return [];
  };

  async function add() {
    setBusy("new"); setErr(null);
    try {
      const res = await fetch("/api/imprest/budget", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, amount: Number(draft.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save that budget.");
      setOpen(false);
      setDraft(emptyDraft(month));
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
    if (!window.confirm("Remove this budget? Entries already held by it stay in the over-budget list.")) return;
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
  const inForce = new Set(usage.map((u) => u.budget.id));
  const others: BudgetDef[] = (data?.budgets || []).filter((b: BudgetDef) => !inForce.has(b.id));
  const totals = usage.reduce(
    (t, u) => ({ amount: t.amount + u.budget.amount, spent: t.spent + u.spent, committed: t.committed + u.committed }),
    { amount: 0, spent: 0, committed: 0 }
  );
  const lbl = "mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";
  const inp = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text";

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
          <button onClick={() => { setDraft(emptyDraft(month)); setOpen(true); }}
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
          title="No budgets in force for this month"
          detail="A budget is a ceiling on imprest spend — for an employee, a plant, an expense head, a designation, a department, or a combination — monthly, quarterly, yearly or for custom dates. With a hard limit, an entry that would cross it is blocked and waits for admin approval."
          action={data.canManage ? { label: "Set the first budget", onClick: () => setOpen(true) } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {usage.map((u) => {
            const tone = BUDGET_TONE[u.state];
            return (
              <article key={u.budget.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-semibold text-biome-text">{u.budget.label}</p>
                      <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
                        {(data.scopes || []).find((s: any) => s.id === u.budget.scope)?.label || u.budget.scope}
                      </span>
                      <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
                        {u.window?.label || u.budget.period}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${u.budget.enforce ? "border-rose-500/30 text-rose-500" : "border-biome-line text-biome-muted"}`}>
                        {u.budget.enforce ? "hard limit" : "warn only"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${tone.chip}`}>
                        {u.state === "over" ? `over by ${rupees(Math.abs(u.remaining))}` : `${rupees(u.remaining)} left`} · {u.pct}%
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-biome-muted">
                      {rupees(u.budget.amount)} a {PERIOD_SHORT[u.budget.period] || "month"} · {rupees(u.spent)} approved
                      {u.committed > 0 && ` · ${rupees(u.committed)} waiting for accounts`}
                      {(u.held || 0) > 0 && ` · ${rupees(u.held || 0)} held for admin (${u.heldCount})`}
                      {u.entries > 0 && ` · ${u.entries} entries`}
                    </p>
                  </div>
                  {data.canManage && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        defaultValue={u.budget.amount}
                        title="Budget amount"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v > 0 && v !== u.budget.amount) change(u.budget.id, { amount: v });
                        }}
                        className="bmx-input w-[110px] rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
                      />
                      <button onClick={() => change(u.budget.id, { enforce: !u.budget.enforce })} disabled={busy === u.budget.id}
                        title={u.budget.enforce ? "Switch to warn only" : "Make it a hard limit"}
                        className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-biome-muted disabled:opacity-60">
                        <ShieldAlert size={12} className={u.budget.enforce ? "text-rose-500" : ""} />
                      </button>
                      <button onClick={() => change(u.budget.id, { active: false })} disabled={busy === u.budget.id}
                        title="Switch this budget off"
                        className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-biome-muted disabled:opacity-60">
                        <Power size={12} />
                      </button>
                      <button onClick={() => remove(u.budget.id)} disabled={busy === u.budget.id}
                        title="Remove this budget"
                        className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-rose-500 disabled:opacity-60">
                        {busy === u.budget.id ? <Loader2 size={12} className="bmx-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  )}
                </div>

                <UsageBar u={u} />
                <p className="mt-1 flex items-center gap-1 text-[9.5px] text-biome-muted">
                  <TrendingUp size={10} /> solid = approved · faded = filed and waiting
                  {u.budget.note && ` · ${u.budget.note}`}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {data?.canManage && others.length > 0 && (
        <section className="rounded-2xl border border-dashed border-biome-line p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">Switched off or not in force this month</p>
          <div className="mt-2 space-y-1.5">
            {others.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold text-biome-text">{b.label}</span>
                <span className="text-biome-muted">
                  {rupees(b.amount)} · {b.period}
                  {b.period === "custom" ? ` · ${b.startDate} to ${b.endDate}` : b.fromMonth || b.toMonth ? ` · ${b.fromMonth || "start"} to ${b.toMonth || "open"}` : ""}
                  {!b.active && " · off"}
                </span>
                {!b.active && (
                  <button onClick={() => change(b.id, { active: true })} disabled={busy === b.id}
                    className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-[10px] font-semibold text-biome-leaf">Switch on</button>
                )}
                <button onClick={() => remove(b.id)} disabled={busy === b.id}
                  className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-[10px] font-semibold text-rose-500">Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <FormPanel
        open={open}
        onClose={() => setOpen(false)}
        icon={<Target size={20} />}
        eyebrow="Imprest"
        title="Set a budget"
        subtitle="With a hard limit, an entry that would cross the budget is blocked and waits for the admin or developer to approve it. Warn-only budgets just flag it to the approver."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={add} disabled={busy === "new" || !Number(draft.amount) || fields.some((f) => !draft.match[f])}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy === "new" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save budget
            </button>
          </>
        }
      >
        <FormSection title="What it covers" sectionIcon={<Target size={14} />} columns={3}>
          <label className="block">
            <span className={lbl}>Budget on</span>
            <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value, match: {} })} className={inp}>
              {(data?.scopes || []).map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="mt-1 block text-[10px] text-biome-muted">
              {(data?.scopes || []).find((s: any) => s.id === draft.scope)?.help}
            </span>
          </label>
          {fields.map((f) => {
            const opts = optionsFor(f);
            return (
              <label key={f} className="block">
                <span className={lbl}>{SCOPE_FIELD_LABEL[f] || f}</span>
                {opts.length > 0 || (f !== "designation" && f !== "department") ? (
                  <select value={draft.match[f] || ""} onChange={(e) => setDraft({ ...draft, match: { ...draft.match, [f]: e.target.value } })} className={inp}>
                    <option value="">Select…</option>
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input value={draft.match[f] || ""} onChange={(e) => setDraft({ ...draft, match: { ...draft.match, [f]: e.target.value } })}
                    placeholder={`Type the ${SCOPE_FIELD_LABEL[f].toLowerCase()}`} className={inp} />
                )}
              </label>
            );
          })}
        </FormSection>

        <FormSection title="How much, for which period" sectionIcon={<TrendingUp size={14} />} columns={3}>
          <label className="block">
            <span className={lbl}>Period</span>
            <select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })} className={inp}>
              {(data?.periods || []).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span className="mt-1 block text-[10px] text-biome-muted">
              {(data?.periods || []).find((p: any) => p.id === draft.period)?.help}
            </span>
          </label>
          <label className="block">
            <span className={lbl}>Rupees per {PERIOD_SHORT[draft.period]}</span>
            <input type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className={inp} />
          </label>
          <label className="block">
            <span className={lbl}>When crossed</span>
            <select value={draft.enforce ? "block" : "warn"} onChange={(e) => setDraft({ ...draft, enforce: e.target.value === "block" })} className={inp}>
              <option value="block">Block — needs admin approval</option>
              <option value="warn">Warn only — flag to the approver</option>
            </select>
          </label>
          {draft.period === "custom" ? (
            <>
              <label className="block">
                <span className={lbl}>From date</span>
                <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className={inp} />
              </label>
              <label className="block">
                <span className={lbl}>To date</span>
                <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className={inp} />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className={lbl}>Runs from</span>
                <input type="month" value={draft.fromMonth} onChange={(e) => setDraft({ ...draft, fromMonth: e.target.value })} className={inp} />
              </label>
              <label className="block">
                <span className={lbl}>Until (optional)</span>
                <input type="month" value={draft.toMonth} onChange={(e) => setDraft({ ...draft, toMonth: e.target.value })} className={inp} />
              </label>
            </>
          )}
          <div className="md:col-span-2 lg:col-span-3">
            <label className="block">
              <span className={lbl}>Note</span>
              <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Who agreed it, and when it should be looked at again" className={inp} />
            </label>
          </div>
        </FormSection>
      </FormPanel>
    </div>
  );
}

/**
 * Over-budget approvals — admin and developer only.
 *
 * Each held entry shows where its budgets stand NOW (another entry may
 * have been withdrawn since), so the decision is made on today's figures.
 * Approving turns it into an ordinary claim for accounts; rejecting needs
 * a reason, which the holder sees.
 */
function OverBudgetPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ pending: any[]; decided: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/imprest/budget/approval", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load."); return; }
    setData(json);
    setErr(null);
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load());

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id); setRowErr((r) => ({ ...r, [id]: "" }));
    try {
      const res = await fetch("/api/imprest/budget/approval", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, note: note[id] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save the decision.");
      if (json.failed?.length) throw new Error(json.failed[0].reason);
      await load();
      onChanged();
    } catch (e) {
      setRowErr((r) => ({ ...r, [id]: (e as Error).message }));
    } finally { setBusy(""); }
  }

  if (err) return <p className="text-[11.5px] text-rose-500">{err}</p>;
  if (!data) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      {data.pending.length === 0 ? (
        <EmptyState
          title="Nothing over budget"
          detail="When someone files an expense that would cross a hard budget, it is blocked and lands here. You approve it (it then goes to accounts as a normal entry) or reject it with a reason."
        />
      ) : (
        <div className="space-y-2">
          {data.pending.map((e) => (
            <article key={e.id} className="bmx-card overflow-hidden rounded-2xl border border-rose-500/25 bg-biome-bgSoft">
              <div className="flex flex-wrap items-start gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/12 text-rose-500">
                  <ShieldAlert size={16} />
                </span>
                <div className="min-w-[200px] flex-1">
                  <p className="text-[12.5px] font-semibold text-biome-text">{e.description}</p>
                  <p className="mt-1 text-[10.5px] text-biome-muted">
                    {e.date} · {e.holder}{e.holderCode && ` (${e.holderCode})`} · {e.category}{e.plant && ` · ${e.plant}`} · filed by {e.createdByName}
                  </p>
                  {e.attachments?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.attachments.map((a: any) => (
                        <a key={a.id} href={`/api/imprest/attachment?entryId=${e.id}&attachmentId=${a.id}`} target="_blank" rel="noreferrer"
                          className="bmx-chip inline-flex items-center gap-1 rounded-lg border border-biome-line px-2 py-0.5 text-[10px] text-biome-muted">
                          <Paperclip size={10} /> {a.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <p className="font-mono text-[16px] font-semibold text-biome-text">{money(e.amount)}</p>
              </div>
              <BudgetWarning impacts={e.impacts} />
              {(e.impacts || []).every((i: BudgetImpact) => i.overBy === 0) && (
                <p className="border-t border-biome-line px-4 py-2 text-[10.5px] text-emerald-600">
                  The budget now has room for this entry (something else was withdrawn or rejected).
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-biome-line px-4 py-2.5">
                <input value={note[e.id] || ""} onChange={(ev) => setNote({ ...note, [e.id]: ev.target.value })}
                  placeholder="Note (required to reject)"
                  className="bmx-input min-w-[200px] flex-1 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text" />
                <button onClick={() => decide(e.id, "approved")} disabled={busy === e.id || e.own}
                  title={e.own ? "You can't pass your own entry" : "Allow the extra spend — it goes to accounts as a normal entry"}
                  className="bmx-btn flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
                  {busy === e.id ? <Loader2 size={12} className="bmx-spin" /> : <Check size={12} />} Approve over budget
                </button>
                <button onClick={() => decide(e.id, "rejected")} disabled={busy === e.id || e.own}
                  className="bmx-btn flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-bold text-rose-500 disabled:opacity-60">
                  <X size={12} /> Reject
                </button>
                {rowErr[e.id] && <p className="w-full text-[10.5px] text-rose-500">{rowErr[e.id]}</p>}
              </div>
            </article>
          ))}
        </div>
      )}

      {data.decided.length > 0 && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">Recent over-budget decisions</p>
          <div className="mt-2 divide-y divide-biome-line">
            {data.decided.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[11px]">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${e.budgetHold.decision === "approved" ? "border-emerald-500/30 text-emerald-600" : "border-rose-500/30 text-rose-500"}`}>
                  {e.budgetHold.decision}
                </span>
                <span className="text-biome-text">{e.holder} · {e.description}</span>
                <span className="text-biome-muted">{money(e.amount)} · over by {rupees(e.budgetHold.overBy)} · {e.budgetHold.decidedByName}</span>
                {e.budgetHold.note && <span className="text-biome-muted">“{e.budgetHold.note}”</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PeoplePanel({ onChanged }: { onChanged: () => void }) {
  const PLANTS = usePlants();
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
