"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Portal from "@/components/Portal";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Wallet, Plus, Loader2, AlertCircle, Check, X, IndianRupee,
  Clock, CheckCircle2, XCircle, RefreshCcw, LogOut, Leaf,
} from "lucide-react";
import { useSession } from "@/lib/session";

/**
 * Imprest, for a phone.
 *
 * The same server, the same rules, the same float — drawn for a 390px
 * screen held in one hand at a weighbridge. An employee files an expense
 * here and it appears in the desktop app the moment accounts refreshes,
 * because there is nothing to "sync": both screens read one server.
 *
 * The page polls every ten seconds so a decision made at the desk shows
 * up on the phone without anyone pulling to refresh. The `revision` field
 * from the API makes that cheap — same revision, no redraw.
 *
 * Advances are absent on purpose: only accounts records an advance, and
 * accounts sits at a desk. A phone files expenses and returns.
 */

const POLL_MS = 10_000;

interface Entry {
  id: string; kind: string; date: string; category: string; amount: number;
  description: string; status: string; createdAt: string;
  decisionNote: string | null; decidedByName: string | null; mode: string;
}
interface Me {
  id: string; name: string; code: string; plant: string;
  monthlyLimit: number;
  balance: { inHand: number; advanced: number; spent: number; returned: number };
}

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  submitted: { label: "Waiting", cls: "text-amber-600 bg-amber-500/10 border-amber-500/30", icon: <Clock size={11} /> },
  approved: { label: "Approved", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", icon: <CheckCircle2 size={11} /> },
  rejected: { label: "Rejected", cls: "text-rose-500 bg-rose-500/10 border-rose-500/30", icon: <XCircle size={11} /> },
};

function inr(n: number) {
  return `₹${(n || 0).toLocaleString("en-IN")}`;
}

export default function MobileImprestPage() {
  const { user, signOut } = useSession();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const revision = useRef("");

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    kind: "expense", date: today, amount: "", category: "",
    description: "", mode: "cash", reference: "",
  });

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch("/api/imprest/entries", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load.");
      if (force || json.revision !== revision.current) {
        revision.current = json.revision;
        setData(json);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load(true));

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const me: Me | null = data?.me ?? null;
  const entries: Entry[] = useMemo(
    () => (data?.entries || []).filter((e: Entry) => !me || true).slice(0, 60),
    [data, me]
  );

  async function file() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/imprest/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not file that.");
      setForm({ kind: "expense", date: today, amount: "", category: "", description: "", mode: "cash", reference: "" });
      setFiling(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-biome-bg pb-28">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-20 border-b border-biome-line bg-biome-bgSoft/90 px-4 pb-3 pt-4 backdrop-blur-lg">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-biome-leaf to-biome-leafBright shadow-glow">
            <Leaf size={17} className="text-biome-text" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13px] font-bold tracking-tight text-biome-text">Imprest</p>
            <p className="truncate text-[10px] text-biome-muted">
              {user?.name}{me?.plant ? ` · ${me.plant}` : ""} · live with the office
            </p>
          </div>
          <button onClick={() => load(true)} aria-label="Refresh"
            className="bmx-chip flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line text-biome-muted">
            <RefreshCcw size={14} />
          </button>
          <button onClick={() => signOut()} aria-label="Sign out"
            className="bmx-chip flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line text-biome-muted">
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <main className="space-y-4 px-4 pt-4">
        {error && (
          <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-3.5 py-3">
            <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />
            <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
          </div>
        )}
        {saved && (
          <div className="bmx-msg-in flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[.08] px-3.5 py-3">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <p className="text-[11.5px] font-semibold text-emerald-600">Filed — it&rsquo;s already in the office app.</p>
          </div>
        )}

        {/* ---- The float ---- */}
        {me ? (
          <section className="bmx-card overflow-hidden rounded-3xl border border-biome-line bg-biome-bgSoft">
            <div className="bg-gradient-to-br from-biome-leaf/15 via-transparent to-transparent p-5">
              <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Cash in hand</p>
              <p className="mt-1 font-mono text-[32px] font-semibold leading-none tracking-tight text-biome-text">
                {inr(me.balance.inHand)}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { l: "Advanced", v: me.balance.advanced },
                  { l: "Spent", v: me.balance.spent },
                  { l: "Returned", v: me.balance.returned },
                ].map((x) => (
                  <div key={x.l} className="rounded-xl border border-biome-line bg-biome-bg px-2 py-2">
                    <p className="text-[8.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{x.l}</p>
                    <p className="mt-0.5 font-mono text-[12.5px] font-semibold text-biome-text">{inr(x.v)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : data ? (
          <section className="rounded-3xl border border-amber-500/30 bg-amber-500/[.06] p-5">
            <p className="text-[12px] font-semibold text-amber-600">No imprest account yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
              You&rsquo;re signed in, but no float is open in your name. Ask accounts to open one —
              floats are only booked for people on the employee rolls.
            </p>
          </section>
        ) : (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="bmx-spin text-biome-muted" />
          </div>
        )}

        {/* ---- Entries ---- */}
        {me && (
          <section className="space-y-2">
            <p className="px-1 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">
              My entries
            </p>
            {entries.length === 0 && (
              <p className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-6 text-center text-[11.5px] text-biome-muted">
                Nothing filed yet. The + button below files your first expense.
              </p>
            )}
            {entries.map((e) => {
              const meta = STATUS_META[e.status] || STATUS_META.submitted;
              return (
                <article key={e.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-biome-text">
                      {e.category || (e.kind === "return" ? "Cash returned" : e.kind === "advance" ? "Advance" : "Expense")}
                    </p>
                    <p className={`font-mono text-[13px] font-semibold ${e.kind === "advance" ? "text-emerald-600" : "text-biome-text"}`}>
                      {e.kind === "advance" ? "+" : "−"}{inr(e.amount)}
                    </p>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-biome-muted">{e.description}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.cls}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="text-[9.5px] text-biome-muted">{e.date}</span>
                    {e.status === "rejected" && e.decisionNote && (
                      <span className="truncate text-[9.5px] text-rose-500">“{e.decisionNote}”</span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {/* ---- File button ---- */}
      {me && !filing && (
        <button onClick={() => setFiling(true)}
          className="bmx-btn fixed bottom-6 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-biome-leaf text-white shadow-glow"
          aria-label="File an entry">
          <Plus size={24} />
        </button>
      )}

      {/* ---- Filing sheet ---- */}
      {filing && (
        <Portal><div className="fixed inset-0 z-40 flex items-end bg-black/40 backdrop-blur-sm" onClick={() => !busy && setFiling(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="bmx-sheet-up max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border-t border-biome-line bg-biome-bgSoft px-4 pb-8 pt-3">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-biome-line" />
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-biome-text">
                <Wallet size={16} className="text-biome-leaf" /> File an entry
              </h2>
              <button onClick={() => setFiling(false)} disabled={busy}
                className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted">
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "expense", label: "Expense" },
                  { id: "return", label: "Cash return" },
                ].map((k) => (
                  <button key={k.id} onClick={() => setForm({ ...form, kind: k.id })}
                    className={`rounded-xl border px-3 py-3 text-[12px] font-bold transition-colors ${
                      form.kind === k.id
                        ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf"
                        : "border-biome-line text-biome-muted"
                    }`}>
                    {k.label}
                  </button>
                ))}
              </div>

              <MField label="Amount">
                <div className="relative">
                  <IndianRupee size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-biome-muted" />
                  <input type="number" inputMode="decimal" min={0} value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0" className={`${mInput} pl-9 font-mono text-[16px]`} />
                </div>
              </MField>

              {form.kind === "expense" && (
                <MField label="Spent on">
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={mInput}>
                    <option value="">Choose…</option>
                    {(data?.categories || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </MField>
              )}

              <MField label="What was it for">
                <textarea rows={2} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Short note for accounts — what, where, for whom"
                  className={`${mInput} resize-none`} />
              </MField>

              <div className="grid grid-cols-2 gap-2.5">
                <MField label="Date">
                  <input type="date" value={form.date} max={today}
                    onChange={(e) => setForm({ ...form, date: e.target.value })} className={mInput} />
                </MField>
                <MField label="Paid by">
                  <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={mInput}>
                    {(data?.paymentModes || []).map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </MField>
              </div>

              <MField label="Bill / reference (optional)">
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="Bill number, slip number…" className={mInput} />
              </MField>

              <button onClick={file} disabled={busy || !form.amount || !form.description || (form.kind === "expense" && !form.category)}
                className="bmx-btn flex w-full items-center justify-center gap-2 rounded-2xl bg-biome-leaf px-5 py-4 text-[13px] font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={16} className="bmx-spin" /> : <Check size={16} />} File it
              </button>
              <p className="text-center text-[9.5px] leading-relaxed text-biome-muted">
                Goes straight to the office for approval — bills can be attached from the desktop app.
              </p>
            </div>
          </div>
        </div></Portal>
      )}
    </div>
  );
}

const mInput =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3.5 py-3 text-[13px] text-biome-text outline-none";

function MField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</span>
      {children}
    </label>
  );
}
