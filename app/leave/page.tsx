"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Plane, Plus, Loader2, AlertCircle, Check, X, CalendarDays, Info, Sun,
  Pencil, Trash2, CheckCircle2,
} from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";
import { EmptyState } from "@/components/SetupGuide";
import HolidayAnnounce from "@/components/attendance/HolidayAnnounce";

/**
 * Leave.
 *
 * An employee applies here; accounts and the admin decide. The balances
 * are shown before the form rather than after a refusal — being told
 * "sick leave is limited to 2 days" only once you have typed a request is
 * how people stop bothering.
 */

interface Balance {
  type: string; label: string; usedThisMonth: number; usedThisYear: number;
  perMonth: number | null; perYear: number | null;
  monthRemaining: number | null; yearRemaining: number | null;
}
interface Request {
  id: string; employeeName: string; employeeCode: string; plant: string;
  type: string; fromDate: string; toDate: string; days: number; reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  raisedAt: string; decidedByName: string | null; decisionNote: string | null;
}

const STATUS = {
  pending: ["Waiting", "border-amber-500/30 bg-amber-500/10 text-amber-600"],
  approved: ["Approved", "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"],
  rejected: ["Not approved", "border-rose-500/30 bg-rose-500/10 text-rose-500"],
  cancelled: ["Cancelled", "border-biome-line text-biome-muted"],
} as const;

export default function LeavePage() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ type: "sick", fromDate: today, toDate: today, reason: "", employeeId: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leave", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
    } catch (err) { setError((err as Error).message); }
  }, []);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());
  useEffect(() => { load(); }, [load]);

  async function apply() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setForm({ ...form, reason: "", employeeId: "" });
      setOpen(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function decide(id: string, action: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note: note[id] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const requests: Request[] = data?.requests || [];
  const balances: Balance[] = data?.balances || [];
  const spec = (data?.types || []).find((t: any) => t.id === form.type);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Plane size={19} className="text-biome-leaf" /> Leave
          </h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
            {data?.canDecide
              ? "Requests from staff. Approving one stops the attendance reminders for those days."
              : "Apply here when you cannot come in. A request covering the day also stops the attendance reminders."}
          </p>
        </div>
        {(data?.me || data?.canApplyFor) && (
          <button onClick={() => setOpen(true)}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
            <Plus size={14} /> Apply for leave
          </button>
        )}
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {/* ---- What is left ---- */}
      {balances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {balances.filter((b) => b.perMonth !== null || b.perYear !== null).map((b) => (
            <div key={b.type} className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
              <p className="text-[12px] font-semibold text-biome-text">{b.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[22px] font-semibold text-biome-text">
                  {b.monthRemaining ?? b.yearRemaining}
                </span>
                <span className="text-[10.5px] text-biome-muted">
                  left {b.perMonth !== null ? "this month" : "this year"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-biome-muted">
                {b.perMonth !== null && `${b.usedThisMonth} of ${b.perMonth} used this month`}
                {b.perMonth !== null && b.perYear !== null && " · "}
                {b.perYear !== null && `${b.usedThisYear} of ${b.perYear} this year`}
              </p>
            </div>
          ))}
        </div>
      )}

      {!data?.me && data && !data.canDecide && !data.canApplyFor && (
        <EmptyState
          title="No employee record is linked to your login"
          detail="Leave is applied against an employee record. Ask the admin to link yours, then this page will work."
        />
      )}

      {/* ---- Requests ---- */}
      <div className="space-y-2">
        {requests.map((r, i) => {
          const [label, cls] = STATUS[r.status];
          return (
            <article key={r.id} className="bmx-rise overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
              style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
              <div className="flex flex-wrap items-start gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-biome-leaf/10 text-biome-leaf">
                  <CalendarDays size={16} />
                </span>
                <div className="min-w-[180px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-semibold text-biome-text">
                      {(data.types || []).find((t: any) => t.id === r.type)?.label || r.type}
                    </p>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>
                      {label}
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] text-biome-muted">
                    {data.canDecide && `${r.employeeName} (${r.employeeCode}) · `}
                    {r.fromDate}{r.toDate !== r.fromDate && ` to ${r.toDate}`} · {r.days} working day{r.days === 1 ? "" : "s"}
                    {r.plant && ` · ${r.plant}`}
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-biome-text">{r.reason}</p>
                  {r.decisionNote && (
                    <p className="mt-2 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[10.5px] text-biome-muted">
                      {r.decidedByName}: {r.decisionNote}
                    </p>
                  )}
                </div>
              </div>

              {r.status === "pending" && (
                <div className="flex flex-wrap items-center gap-2 border-t border-biome-line px-4 py-2.5">
                  {data.canDecide ? (
                    <>
                      <input value={note[r.id] || ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                        placeholder="Reason (required to refuse)"
                        className="bmx-input min-w-[180px] flex-1 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text outline-none" />
                      <button onClick={() => decide(r.id, "approve")} disabled={busy}
                        className="bmx-btn flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
                        <Check size={12} /> Approve
                      </button>
                      <button onClick={() => decide(r.id, "reject")} disabled={busy}
                        className="bmx-btn flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-bold text-rose-500 disabled:opacity-60">
                        <X size={12} /> Refuse
                      </button>
                    </>
                  ) : (
                    <button onClick={() => decide(r.id, "cancel")} disabled={busy}
                      className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted">
                      <X size={12} /> Withdraw
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {data && requests.length === 0 && (
          <div className="rounded-2xl border border-dashed border-biome-line px-6 py-12 text-center">
            <p className="text-[13px] font-semibold text-biome-text">No leave requests</p>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[11.5px] leading-relaxed text-biome-muted">
              {data.canDecide
                ? "Requests appear here as staff raise them."
                : "When you cannot come in, apply here rather than leaving the day unmarked — it stops the reminders and keeps your pay right."}
            </p>
          </div>
        )}
      </div>

      <HolidayPanel />

      {/* ---- Apply ---- */}
      <FormPanel
        open={open}
        onClose={() => setOpen(false)}
        icon={<Plane size={20} />}
        eyebrow="Leave request"
        title="Apply for leave"
        subtitle="Weekly offs and holidays inside the range are not counted against your entitlement."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={apply} disabled={busy}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Send request
            </button>
          </>
        }
      >
        {data?.canApplyFor && (data?.staff || []).length > 0 && (
          <FormSection title="For whom" sectionIcon={<Info size={14} />} columns={1}>
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className={inputCls} aria-label="Employee">
              <option value="">{data?.me ? `Myself (${data.me.name})` : "Choose an employee…"}</option>
              {(data.staff as any[]).filter((e) => e.id !== data?.me?.id).map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.code}){e.plant ? ` · ${e.plant}` : ""}</option>
              ))}
            </select>
          </FormSection>
        )}

        <FormSection title="What kind of leave" sectionIcon={<Plane size={14} />} columns={1}>
          <div className="flex flex-wrap gap-2">
            {(data?.types || []).map((t: any) => (
              <button key={t.id} onClick={() => setForm({ ...form, type: t.id })}
                className={`bmx-chip rounded-xl border px-3.5 py-2.5 text-[11.5px] font-semibold transition ${
                  form.type === t.id ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          {spec && (
            <p className="rounded-xl border border-biome-line bg-biome-bg/50 px-3.5 py-2.5 text-[10.5px] leading-relaxed text-biome-muted">
              {spec.help}
              {!spec.paid && <span className="ml-1 font-semibold text-amber-600">These days are not paid.</span>}
            </p>
          )}
        </FormSection>

        <FormSection title="When" sectionIcon={<CalendarDays size={14} />} columns={2}>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">From</span>
            <input type="date" value={form.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })}
              className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">To</span>
            <input type="date" value={form.toDate} min={form.fromDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })} className={inputCls} />
          </label>
        </FormSection>

        <FormSection title="Why" sectionIcon={<Info size={14} />} columns={1}>
          <textarea rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="A line is enough — it is what the approver has to go on."
            className={`${inputCls} resize-y`} />
        </FormSection>
      </FormPanel>
    </div>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

/* ================= public holidays ================= */

const ALL_REGIONS = [
  { id: "HR", label: "Rewari (Haryana)" },
  { id: "MH", label: "Gangakhed (Maharashtra)" },
  { id: "DL", label: "Office (Delhi)" },
];

/**
 * The holiday calendar.
 *
 * Editable by the admin, because the dates that move — Holi, Diwali, Id,
 * Ganesh Chaturthi — are notified by each state every year and there is no
 * safe way to guess them. A range is entered once and stored as one entry
 * per day, which is what lets a plant shutdown be added in a single go.
 */
function HolidayPanel() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({
    name: "", date: today, toDate: today, regions: ["HR", "MH", "DL"], confirm: false, range: false,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/holidays", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setData(json);
    } catch { /* the panel stays quiet */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/holidays", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, toDate: form.range ? form.toDate : form.date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setForm({ ...form, name: "" });
      setAdding(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function patch(h: any, changes: any) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/holidays", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalDate: h.date, originalName: h.name, ...changes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setEditing(null);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function remove(h: any) {
    if (!window.confirm(`Remove "${h.name}" on ${h.date}?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/holidays?date=${h.date}&name=${encodeURIComponent(h.name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status}).`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (!data) return null;
  const holidays: any[] = data.holidays || [];
  const canEdit = data.canEdit;

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Sun size={15} className="text-biome-leaf" /> Public holidays
        </h2>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <HolidayAnnounce onDone={load} />
            <button onClick={() => setAdding((v) => !v)}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11.5px] font-semibold text-biome-muted">
              <Plus size={13} /> {adding ? "Close" : "Add to calendar (by state)"}
            </button>
          </div>
        )}
      </div>

      {data.unconfirmed > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[.07] px-3.5 py-2.5">
          <Info size={14} className="mt-px shrink-0 text-amber-600" />
          <p className="text-[10.5px] leading-relaxed text-biome-muted">
            <span className="font-semibold text-amber-600">{data.unconfirmed} date(s) still to confirm.</span>{" "}
            These move with the lunar calendar and are notified separately by each state. Check them
            against the state gazette, then press <span className="font-semibold">Confirm</span> — a
            wrong holiday costs somebody a day&apos;s pay.
          </p>
        </div>
      )}

      {error && (
        <div className="bmx-msg-in mt-3 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3.5 py-2.5">
          <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11px] text-biome-text">{error}</p>
        </div>
      )}

      {adding && canEdit && (
        <div className="bmx-msg-in mt-4 rounded-xl border border-biome-line bg-biome-bg/40 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Diwali, plant shutdown, local holiday…" className={inputCls} />
            </label>
            <div className="flex items-end">
              <button onClick={() => setForm({ ...form, range: !form.range })}
                className={`bmx-chip flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-semibold ${
                  form.range ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                }`}>
                {form.range ? "A period" : "One day"}
              </button>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
                {form.range ? "From" : "Date"}
              </span>
              <input type="date" value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })}
                className={inputCls} />
            </label>
            {form.range && (
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">To</span>
                <input type="date" value={form.toDate} min={form.date}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })} className={inputCls} />
              </label>
            )}
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Applies to</p>
            <div className="flex flex-wrap gap-2">
              {ALL_REGIONS.map((r) => {
                const on = form.regions.includes(r.id);
                return (
                  <button key={r.id}
                    onClick={() => setForm({
                      ...form,
                      regions: on ? form.regions.filter((x: string) => x !== r.id) : [...form.regions, r.id],
                    })}
                    className={`bmx-chip rounded-xl border px-3 py-2 text-[11px] font-semibold ${
                      on ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                    }`}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={add} disabled={busy}
            className="bmx-btn mt-4 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />}
            {form.range ? "Add the period" : "Add the holiday"}
          </button>
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {holidays.map((h) => {
          const isEditing = editing?.date === h.date && editing?.name === h.name;
          return (
            <div key={h.date + h.name}
              className={`rounded-xl border px-3.5 py-2.5 ${h.confirm ? "border-amber-500/30 bg-amber-500/[.05]" : "border-biome-line"}`}>
              {isEditing ? (
                <div className="grid gap-2 md:grid-cols-3">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
                  <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className={inputCls} />
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_REGIONS.map((r) => {
                      const on = editing.regions.includes(r.id);
                      return (
                        <button key={r.id}
                          onClick={() => setEditing({
                            ...editing,
                            regions: on ? editing.regions.filter((x: string) => x !== r.id) : [...editing.regions, r.id],
                          })}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                            on ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                          }`}>
                          {r.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="md:col-span-3 flex gap-2">
                    <button onClick={() => patch(h, { date: editing.date, name: editing.name, regions: editing.regions })}
                      disabled={busy}
                      className="bmx-btn flex items-center gap-1.5 rounded-lg bg-biome-leaf px-3 py-1.5 text-[11px] font-bold text-white">
                      <Check size={12} /> Save
                    </button>
                    <button onClick={() => setEditing(null)}
                      className="bmx-chip rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-[68px] shrink-0 font-mono text-[10.5px] text-biome-muted">
                    {new Date(h.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                  <span className="min-w-[120px] flex-1 text-[11.5px] text-biome-text">{h.name}</span>
                  <span className="text-[9.5px] text-biome-muted">{h.regions.join(" · ")}</span>
                  {h.confirm && (
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-amber-600">
                      confirm
                    </span>
                  )}
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      {h.confirm && (
                        <button onClick={() => patch(h, { confirm: false })} disabled={busy}
                          title="I have checked this against the gazette"
                          className="bmx-chip flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-600">
                          <CheckCircle2 size={11} /> Confirm
                        </button>
                      )}
                      <button onClick={() => setEditing({ ...h })} title="Edit"
                        className="rounded-lg p-1.5 text-biome-muted hover:text-biome-text">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => remove(h)} title="Remove"
                        className="rounded-lg p-1.5 text-biome-muted hover:text-rose-500">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {holidays.length === 0 && (
          <p className="text-[11.5px] text-biome-muted">No holidays set. Add them before running a month.</p>
        )}
      </div>
    </section>
  );
}
