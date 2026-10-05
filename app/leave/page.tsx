"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Plane, Plus, Loader2, AlertCircle, Check, X, CalendarDays, Info, Sun,
  Pencil, Trash2, CheckCircle2, Megaphone, Users, Clock, MapPin, Sparkles, Mail, Inbox,
} from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";
import HolidayAnnounce from "@/components/attendance/HolidayAnnounce";
import LeaveCalendar, {
  CalHoliday, CalLeave, groupHolidays, toneOf, iso, shortDate,
} from "@/components/leave/LeaveCalendar";

/**
 * Leave.
 *
 * Everyone gets one calendar with the month as a list beside it: their own
 * leave (with its status), the holidays of their location and, for anyone
 * who manages people, who in their scope is away. Balances sit above it,
 * so "sick leave is limited to 2 days" is seen before applying, not after.
 *
 * The developer and the admin keep the full management view underneath:
 * every request, and the holiday calendar with announce / edit / remove.
 * A holiday they announce appears here for everyone it applies to, and is
 * emailed to them.
 */

interface Balance {
  type: string; label: string; usedThisMonth: number; usedThisYear: number;
  perMonth: number | null; perYear: number | null;
  monthRemaining: number | null; yearRemaining: number | null;
}
type Request = CalLeave & {
  employeeId: string; reason: string;
  raisedAt: string; decidedByName: string | null; decisionNote: string | null;
};

const STATUS = {
  pending: ["Waiting", "border-amber-500/30 bg-amber-500/10 text-amber-600"],
  approved: ["Approved", "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"],
  rejected: ["Not approved", "border-rose-500/30 bg-rose-500/10 text-rose-500"],
  cancelled: ["Cancelled", "border-biome-line text-biome-muted"],
} as const;

const daysUntil = (d: string) => {
  const a = new Date(`${iso(new Date())}T00:00:00`).getTime();
  const b = new Date(`${d}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
};

export default function LeavePage() {
  const [data, setData] = useState<any>(null);
  const [month, setMonth] = useState(() => iso(new Date()).slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const today = iso(new Date());
  const [form, setForm] = useState({ type: "sick", fromDate: today, toDate: today, reason: "", employeeId: "" });

  const load = useCallback(async (m?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leave?month=${m || month}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, [month]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());
  useEffect(() => { load(month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setForm({ ...form, reason: "", employeeId: "" });
      setOpen(false);
      setDone(`Request sent — ${json.request?.days ?? ""} working day(s). It shows as "Waiting" until it is decided.`);
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
  const holidays: CalHoliday[] = data?.holidays || [];
  const team: CalLeave[] = data?.team || [];
  const spec = (data?.types || []).find((t: any) => t.id === form.type);
  const typeLabel = useCallback(
    (t: string) => (data?.types || []).find((x: any) => x.id === t)?.label || t,
    [data?.types]
  );
  const meId: string | undefined = data?.me?.id;
  const mine = requests.filter((r) => meId && r.employeeId === meId);
  const canManage = !!data?.canManage;
  const canDecide = !!data?.canDecide;

  const upcoming = useMemo(() => groupHolidays(holidays.filter((h) => h.date >= today)).slice(0, 8), [holidays, today]);
  const fresh = useMemo(() => groupHolidays(holidays.filter((h) =>
    h.date >= today && h.announcedAt && Date.now() - new Date(h.announcedAt).getTime() < 21 * 86400000)), [holidays, today]);
  const awayToday = team.filter((r) => r.fromDate <= today && today <= r.toDate);
  const year = today.slice(0, 4);
  const takenThisYear = mine.filter((r) => r.status === "approved" && r.fromDate.startsWith(year)).reduce((n, r) => n + r.days, 0);
  const waitingMine = mine.filter((r) => r.status === "pending").length;
  const next = upcoming[0];
  const queue = requests.filter((r) => r.status === "pending" && r.employeeId !== meId);
  const balFor = (t: string) => balances.find((b) => b.type === t);

  return (
    <div className="space-y-5">
      {/* ---------------- Hero ---------------- */}
      <header className="relative overflow-hidden rounded-3xl border border-biome-line bg-biome-bgSoft p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-aurora opacity-90" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[.2em] text-biome-leaf">Leave &amp; holidays</p>
            <h1 className="mt-1 flex items-center gap-2 text-[22px] font-semibold tracking-[-.03em] text-biome-text">
              <Plane size={20} className="text-biome-leaf" /> {data?.me ? `Hello, ${String(data.me.name).split(" ")[0]}` : "Leave"}
            </h1>
            <p className="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-biome-muted">
              {canManage
                ? "Everyone's leave and the holiday calendar. A holiday you announce shows on every person's leave page and is emailed to them."
                : "Your leave, your location's holidays and weekly offs — on one calendar. Apply here when you cannot come in; it also stops the attendance reminders."}
            </p>
            {data?.myRegionLabel && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-biome-line bg-biome-bg/60 px-2.5 py-1 text-[10px] font-semibold text-biome-muted">
                <MapPin size={11} /> {canManage ? "Holidays of every location" : `Holidays for ${data.myRegionLabel}`}
              </p>
            )}
          </div>
          {(data?.me || data?.canApplyFor) && (
            <button onClick={() => { setOpen(true); setError(null); }} data-testid="apply-leave"
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[12px] font-bold text-white shadow-glow">
              <Plus size={14} /> Apply for leave
            </button>
          )}
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <HeroStat icon={<Sun size={14} />} tone="text-orange-600 bg-orange-500/12"
            label="Next holiday" value={next ? next.name : "None set"}
            sub={next ? `${shortDate(next.from)} · ${daysUntil(next.from) === 0 ? "today" : daysUntil(next.from) === 1 ? "tomorrow" : `in ${daysUntil(next.from)} days`}` : "—"} />
          <HeroStat icon={<Clock size={14} />} tone="text-amber-600 bg-amber-500/12"
            label={canDecide ? "Waiting for decision" : "My requests waiting"} value={String(canDecide ? queue.length : waitingMine)}
            sub={canDecide ? "requests to decide" : waitingMine ? "until approved" : "nothing pending"} />
          <HeroStat icon={<CheckCircle2 size={14} />} tone="text-emerald-600 bg-emerald-500/12"
            label={`Leave taken ${year}`} value={`${takenThisYear} day${takenThisYear === 1 ? "" : "s"}`} sub="approved, working days" />
          {data?.showTeam ? (
            <HeroStat icon={<Users size={14} />} tone="text-sky-600 bg-sky-500/12"
              label="Away today" value={String(awayToday.length)} sub={awayToday.length ? "in your team" : "everyone in"} />
          ) : (
            <HeroStat icon={<CalendarDays size={14} />} tone="text-sky-600 bg-sky-500/12"
              label="Holidays left this year" value={String(holidays.filter((h) => h.date >= today && h.date.startsWith(year)).length)} sub="for your location" />
          )}
        </div>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="flex-1 text-[11.5px] leading-relaxed text-biome-text">{error}</p>
          <button onClick={() => setError(null)} className="text-biome-muted" aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
      {done && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[.07] px-4 py-3">
          <Check size={15} className="mt-px shrink-0 text-emerald-600" />
          <p className="flex-1 text-[11.5px] leading-relaxed text-biome-text">{done}</p>
          <button onClick={() => setDone(null)} className="text-biome-muted" aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      {/* ---------------- Newly announced ---------------- */}
      {fresh.length > 0 && (
        <div className="space-y-2" data-testid="holiday-announcements">
          {fresh.map((g) => (
            <div key={g.from + g.name} className="bmx-msg-in flex items-start gap-3 rounded-2xl border border-orange-500/35 bg-orange-500/[.08] px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600"><Megaphone size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-biome-text">
                  <span className="mr-1.5 rounded-full bg-orange-500 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[.1em] text-white">New</span>
                  {g.h.kind === "shutdown" ? "Shutdown" : "Holiday"} announced: {g.name}
                </p>
                <p className="mt-0.5 text-[11px] text-biome-muted">
                  {g.from === g.to ? new Date(`${g.from}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : `${shortDate(g.from)} to ${shortDate(g.to)} (${g.days} days)`}
                  {g.h.announcedBy ? ` · announced by ${g.h.announcedBy}` : ""}
                </p>
                {g.h.note && <p className="mt-1 text-[11px] text-biome-text">{g.h.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Balances ---------------- */}
      {balances.length > 0 && (
        <section>
          <SectionTitle icon={<Sparkles size={14} />} title="What you have left" hint="Pending requests already hold their days." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {balances.map((b) => {
              const t = toneOf(b.type);
              const cap = b.perMonth ?? b.perYear;
              const used = b.perMonth !== null ? b.usedThisMonth : b.usedThisYear;
              const left = b.monthRemaining ?? b.yearRemaining;
              const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
              return (
                <button key={b.type} onClick={() => { setForm({ ...form, type: b.type }); if (data?.me || data?.canApplyFor) setOpen(true); }}
                  className="bmx-rise group rounded-2xl border border-biome-line bg-biome-bgSoft p-4 text-left transition hover:border-biome-leaf/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.1em] ${t.chip}`}>{t.label}</span>
                    <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                  </div>
                  <p className="mt-3 font-mono text-[26px] font-semibold leading-none text-biome-text">{left === null ? "∞" : left}</p>
                  <p className="mt-1 text-[10px] text-biome-muted">
                    {left === null ? "no fixed limit" : `left ${b.perMonth !== null ? "this month" : "this year"}`}
                  </p>
                  {cap ? (
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-biome-line">
                      <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(pct, used ? 6 : 0)}%` }} />
                    </div>
                  ) : <div className="mt-2.5 h-1.5" />}
                  <p className="mt-1.5 text-[9.5px] text-biome-muted">
                    {b.perMonth !== null ? `${b.usedThisMonth}/${b.perMonth} this month` : ""}
                    {b.perMonth !== null && b.perYear !== null ? " · " : ""}
                    {b.perYear !== null ? `${b.usedThisYear}/${b.perYear} this year` : b.perMonth === null ? `${b.usedThisYear} used this year` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {data && !data.me && !canManage && (
        <div className="flex items-start gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
          <Info size={15} className="mt-px shrink-0 text-biome-muted" />
          <p className="text-[11.5px] leading-relaxed text-biome-muted">
            No employee record is linked to your login, so you can see the holiday calendar but not apply for your own leave yet.
            Ask the admin to add your employee record (same name as your login).
          </p>
        </div>
      )}

      {/* ---------------- Upcoming holidays strip ---------------- */}
      {upcoming.length > 0 && (
        <section>
          <SectionTitle icon={<Sun size={14} />} title="Upcoming holidays" hint={canManage ? "All locations" : data?.myRegionLabel ? `For ${data.myRegionLabel}` : undefined} />
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" data-testid="upcoming-holidays">
            {upcoming.map((g) => {
              const n = daysUntil(g.from);
              return (
                <div key={g.from + g.name} className="min-w-[150px] shrink-0 rounded-2xl border border-orange-500/25 bg-gradient-to-b from-orange-500/[.10] to-transparent p-3.5">
                  <p className="text-[9px] font-bold uppercase tracking-[.14em] text-orange-600">
                    {new Date(`${g.from}T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}
                  </p>
                  <p className="font-mono text-[24px] font-semibold leading-tight text-biome-text">
                    {Number(g.from.slice(8))}{g.to !== g.from && <span className="text-[13px] text-biome-muted">–{Number(g.to.slice(8))}</span>}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] font-semibold text-biome-text">{g.name}</p>
                  <p className="mt-1 text-[10px] text-biome-muted">
                    {new Date(`${g.from}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })} · {n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`}
                  </p>
                  {g.h.confirm && <p className="mt-1 text-[9px] font-bold uppercase tracking-[.1em] text-amber-600">date to be confirmed</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------- Team on leave today ---------------- */}
      {data?.showTeam && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4" data-testid="team-today">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-biome-text"><Users size={14} className="text-sky-600" /> On leave today</p>
            <span className="text-[10px] text-biome-muted">Only the people you look after</span>
          </div>
          {awayToday.length === 0 ? (
            <p className="mt-2 text-[11px] text-biome-muted">Nobody is on leave today.</p>
          ) : (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {awayToday.map((r) => (
                <span key={r.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] ${toneOf(r.type).chip} ${r.status === "pending" ? "border-dashed" : ""}`}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-biome-bg text-[10px] font-bold text-biome-text">
                    {r.employeeName.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                  </span>
                  <span className="font-semibold text-biome-text">{r.employeeName}</span>
                  <span>{toneOf(r.type).label}{r.status === "pending" ? " · waiting" : ""}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------------- One calendar + the month list ---------------- */}
      <LeaveCalendar
        month={month} onMonth={setMonth} loading={loading}
        holidays={holidays} mine={mine} team={team}
        weekOffDays={data?.weekOffDays || [0]} typeLabel={typeLabel}
        locationLabel={data?.myRegionLabel || ""} personLabel={data?.me ? `${data.me.name} (${data.me.code})` : "Biome Industria"}
      />

      {/* ---------------- My requests ---------------- */}
      {data?.me && (
        <section>
          <SectionTitle icon={<Inbox size={14} />} title="My requests" hint="Newest first. A waiting request can be withdrawn." />
          {mine.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-biome-line px-6 py-8 text-center">
              <p className="text-[12.5px] font-semibold text-biome-text">No leave requests yet</p>
              <p className="mx-auto mt-1 max-w-[420px] text-[11px] leading-relaxed text-biome-muted">
                When you cannot come in, apply here rather than leaving the day unmarked — it stops the reminders and keeps your pay right.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {mine.slice(0, 12).map((r) => <RequestCard key={r.id} r={r} typeLabel={typeLabel} busy={busy}
                onWithdraw={r.status === "pending" ? () => decide(r.id, "cancel") : undefined} />)}
            </div>
          )}
        </section>
      )}

      {/* ---------------- Decide ---------------- */}
      {canDecide && (
        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle icon={<CheckCircle2 size={14} />} title={canManage && showAll ? "All leave requests" : "Requests to decide"}
              hint={canManage && showAll ? `${requests.length} in total` : `${queue.length} waiting`} flush />
            {canManage && (
              <button onClick={() => setShowAll((v) => !v)}
                className="bmx-chip rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted hover:text-biome-text">
                {showAll ? "Show only waiting" : "Show all requests"}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(canManage && showAll ? requests : queue).map((r, i) => {
              const [label, cls] = STATUS[r.status];
              return (
                <article key={r.id} className="bmx-rise overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
                  style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold ${toneOf(r.type).chip}`}>
                      {r.employeeName.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                    </span>
                    <div className="min-w-[180px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12.5px] font-semibold text-biome-text">{r.employeeName} <span className="font-normal text-biome-muted">({r.employeeCode})</span></p>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${toneOf(r.type).chip}`}>{typeLabel(r.type)}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>
                      </div>
                      <p className="mt-1 text-[10.5px] text-biome-muted">
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
                  {r.status === "pending" && r.employeeId !== meId && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-biome-line px-4 py-2.5">
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
                      <span className="flex items-center gap-1 text-[10px] text-biome-muted"><Mail size={11} /> The person is emailed the decision</span>
                    </div>
                  )}
                </article>
              );
            })}
            {(canManage && showAll ? requests : queue).length === 0 && (
              <div className="rounded-2xl border border-dashed border-biome-line px-6 py-8 text-center">
                <p className="text-[12.5px] font-semibold text-biome-text">Nothing waiting</p>
                <p className="mt-1 text-[11px] text-biome-muted">Requests appear here as staff raise them.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Management: holiday notices + calendar ---------------- */}
      {canManage && (data?.notices || []).length > 0 && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-biome-text"><Mail size={14} className="text-biome-leaf" /> Holiday emails</p>
          <div className="mt-2 space-y-1.5">
            {(data.notices as any[]).map((n) => (
              <div key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border border-biome-line px-3 py-2 text-[11px]">
                <span className="font-semibold text-biome-text">{n.name}</span>
                <span className="text-biome-muted">{n.fromDate}{n.toDate !== n.fromDate ? ` to ${n.toDate}` : ""} · {n.regions.join(", ")}</span>
                <span className={n.status === "sending" ? "text-amber-600" : n.sent ? "text-emerald-600" : "text-biome-muted"}>
                  {n.status === "sending" ? "Sending…" : `${n.sent} of ${n.total} emailed`}
                  {n.noEmail?.length ? ` · ${n.noEmail.length} without email` : ""}
                </span>
                {n.mailNote && <span className="w-full text-[10.5px] text-amber-600">{n.mailNote}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {canManage && <HolidayPanel onChanged={() => load()} />}

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
            <button onClick={apply} disabled={busy} data-testid="send-leave"
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
            {(data?.types || []).map((t: any) => {
              const b = balFor(t.id);
              const left = b ? b.monthRemaining ?? b.yearRemaining : null;
              return (
                <button key={t.id} onClick={() => setForm({ ...form, type: t.id })}
                  className={`bmx-chip flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[11.5px] font-semibold transition ${
                    form.type === t.id ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}>
                  <span className={`h-2 w-2 rounded-full ${toneOf(t.id).dot}`} /> {t.label}
                  {!form.employeeId && left !== null && b && <span className="rounded-md bg-biome-bg px-1.5 py-px text-[9.5px] font-bold text-biome-muted">{left} left</span>}
                </button>
              );
            })}
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
          {(() => {
            const inRange = groupHolidays(holidays.filter((h) => h.date >= form.fromDate && h.date <= form.toDate));
            return inRange.length > 0 ? (
              <p className="md:col-span-2 text-[10.5px] text-orange-600">
                Includes {inRange.map((g) => g.name).join(", ")} — holidays are not counted as leave.
              </p>
            ) : null;
          })()}
        </FormSection>

        <FormSection title="Why" sectionIcon={<Info size={14} />} columns={1}>
          <textarea rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="A line is enough — it is what the approver has to go on."
            className={`${inputCls} resize-y`} />
        </FormSection>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3.5 py-2.5">
            <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />
            <p className="text-[11px] text-biome-text">{error}</p>
          </div>
        )}
      </FormPanel>
    </div>
  );
}

function HeroStat({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-biome-line bg-biome-bg/60 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
        <p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</p>
      </div>
      <p className="mt-2 truncate text-[15px] font-semibold text-biome-text" title={value}>{value}</p>
      <p className="text-[10px] text-biome-muted">{sub}</p>
    </div>
  );
}

function SectionTitle({ icon, title, hint, flush }: { icon: React.ReactNode; title: string; hint?: string; flush?: boolean }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 ${flush ? "" : "mb-2.5"}`}>
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-biome-text"><span className="text-biome-leaf">{icon}</span> {title}</h2>
      {hint && <span className="text-[10.5px] text-biome-muted">{hint}</span>}
    </div>
  );
}

function RequestCard({ r, typeLabel, busy, onWithdraw }: {
  r: Request; typeLabel: (t: string) => string; busy: boolean; onWithdraw?: () => void;
}) {
  const [label, cls] = STATUS[r.status];
  const t = toneOf(r.type);
  const steps = [
    { label: "Sent", done: true },
    { label: r.status === "rejected" ? "Not approved" : r.status === "cancelled" ? "Withdrawn" : "Approved", done: r.status !== "pending" },
  ];
  return (
    <article className="flex overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
      <span className={`w-1.5 shrink-0 ${t.bar}`} />
      <div className="min-w-0 flex-1 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-semibold text-biome-text">{typeLabel(r.type)}</p>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>
          {onWithdraw && (
            <button onClick={onWithdraw} disabled={busy}
              className="ml-auto flex items-center gap-1 rounded-lg border border-biome-line px-2 py-1 text-[10px] font-semibold text-biome-muted hover:text-biome-text">
              <X size={11} /> Withdraw
            </button>
          )}
        </div>
        <p className="mt-1 text-[10.5px] text-biome-muted">
          {shortDate(r.fromDate)}{r.toDate !== r.fromDate && ` – ${shortDate(r.toDate)}`} · {r.days} working day{r.days === 1 ? "" : "s"}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] text-biome-text">{r.reason}</p>
        <div className="mt-2 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className={`h-px w-5 ${s.done ? "bg-biome-leaf" : "bg-biome-line"}`} />}
              <span className={`flex items-center gap-1 text-[9.5px] font-semibold ${s.done ? (r.status === "rejected" && i === 1 ? "text-rose-500" : "text-biome-leaf") : "text-biome-muted"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${s.done ? (r.status === "rejected" && i === 1 ? "bg-rose-500" : "bg-biome-leaf") : "bg-biome-line"}`} />
                {i === 1 && !s.done ? "Waiting for decision" : s.label}
              </span>
            </span>
          ))}
        </div>
        {r.decisionNote && (
          <p className="mt-2 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[10.5px] text-biome-muted">
            {r.decidedByName}: {r.decisionNote}
          </p>
        )}
      </div>
    </article>
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
function HolidayPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({
    name: "", date: today, toDate: today, regions: ["HR", "MH", "DL"], confirm: false, range: false, email: true, note: "",
  });
  const [sentNote, setSentNote] = useState<string | null>(null);

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
      setForm({ ...form, name: "", note: "" });
      setAdding(false);
      const n = json.notice;
      setSentNote(n ? (n.withEmail ? `Holiday added. Emailing ${n.withEmail} of ${n.total} employee(s) in the background${n.noEmail?.length ? ` — no work email for ${n.noEmail.join(", ")}` : ""}.` : `Holiday added. ${n.mailNote || "No one to email."}`) : "Holiday added.");
      await load();
      onChanged?.();
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
      onChanged?.();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function remove(h: any) {
    if (!window.confirm(`Remove "${h.name}" on ${h.date}?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/holidays?date=${h.date}&name=${encodeURIComponent(h.name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status}).`);
      await load();
      onChanged?.();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (!data) return null;
  const holidays: any[] = data.holidays || [];
  const canEdit = data.canEdit;

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Sun size={15} className="text-biome-leaf" /> Holiday calendar — manage
        </h2>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <HolidayAnnounce onDone={() => { load(); onChanged?.(); }} />
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

      {sentNote && (
        <div className="bmx-msg-in mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3.5 py-2.5">
          <Mail size={14} className="mt-px shrink-0 text-emerald-600" />
          <p className="flex-1 text-[11px] text-biome-text">{sentNote}</p>
          <button onClick={() => setSentNote(null)} className="text-biome-muted" aria-label="Dismiss"><X size={12} /></button>
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

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Message (optional)</span>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. Plant closed; dispatch resumes the next morning" className={inputCls} />
            </label>
            <label className="flex items-end gap-2 pb-2.5 text-[11px] text-biome-text">
              <input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
              <Mail size={13} className="text-biome-muted" /> Email everyone it applies to
            </label>
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
