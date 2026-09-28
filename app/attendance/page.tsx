"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { CalendarDays, Loader2, AlertCircle, Check, Lock, Send, Plane, Bell, ShieldAlert, Sun } from "lucide-react";
import { EmptyState } from "@/components/SetupGuide";
import HolidayAnnounce from "@/components/attendance/HolidayAnnounce";
import { usePlants } from "@/lib/usePlants";

/**
 * Attendance register.
 *
 * A month-wide grid rather than a day-at-a-time form: whoever fills it is
 * copying from a paper register and wants the whole month in front of them.
 * Clicking a cell cycles through the marks, so a month can be filled with
 * the mouse alone.
 *
 * Blank is a real state and stays blank — pre-filling everyone as present
 * would let a month be approved that nobody actually read.
 */

type Mark = "" | "P" | "A" | "H" | "L" | "HD";

interface Employee { id: string; code: string; name: string; type: string; designation: string; plant: string; }
interface Totals { paidDays: number; daysWorked: number; present: number; absent: number; leave: number; holidays: number; halfDays: number; unmarked: number; }
interface Row { employeeId: string; days: Mark[]; overtimeHours: number; remark: string; totals: Totals; }

const CYCLE: Mark[] = ["", "P", "A", "H", "L", "HD"];

const STYLE: Record<Mark, string> = {
  "": "bg-biome-bg text-biome-muted/30 border-biome-line",
  P: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  A: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  H: "bg-slate-500/12 text-slate-500 border-slate-400/25",
  L: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  HD: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

export default function AttendancePage() {
  const PLANTS = usePlants();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  /** Which cell has its mark picker open — {employeeId, day} or null. */
  const [picker, setPicker] = useState<{ emp: string; day: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/attendance?month=${month}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      setRows(json.rows);
      setDirty(false);
    } catch (err) { setError((err as Error).message); }
  }, [month]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());

  useEffect(() => { load(); }, [load]);

  const dayInfo = data?.dayInfo || [];
  const regions = data?.regions || {};

  /** Is this a day off for THIS person, and is it still open to them? */
  function dayState(employeeId: string, index: number) {
    const info = dayInfo[index];
    if (!info) return { off: false, holiday: null as string | null, locked: false, lockReason: undefined as string | undefined };
    const region = regions[employeeId] || "DL";
    const forRegion = info.perRegion?.find((r: any) => r.region === region);
    return {
      off: Boolean(forRegion?.off),
      holiday: forRegion?.holiday ?? null,
      locked: Boolean(info.locked),
      lockReason: info.lockReason,
    };
  }

  /** Set one cell straight to a mark — the dropdown picker's setter.
   *  Clicking still cycles (fast for the common case); the picker is for
   *  choosing a mark directly without cycling through the others. */
  function setMark(employeeId: string, day: number, m: Mark) {
    if (data?.locked || dayState(employeeId, day).locked) return;
    setDirty(true);
    setRows((rs) => rs.map((r) => {
      if (r.employeeId !== employeeId) return r;
      const days = [...r.days];
      days[day] = m;
      return { ...r, days };
    }));
    setPicker(null);
  }

  function cycle(employeeId: string, day: number) {
    if (data?.locked) return;
    // The cut-off is enforced on the server too; this only stops the click
    // producing an edit that will be silently thrown away.
    if (dayState(employeeId, day).locked) return;
    setDirty(true);
    setRows((rs) => rs.map((r) => {
      if (r.employeeId !== employeeId) return r;
      const days = [...r.days];
      const at = CYCLE.indexOf((days[day] || "") as Mark);
      days[day] = CYCLE[(at + 1) % CYCLE.length];
      return { ...r, days };
    }));
  }

  /** Fill a whole row at once — most people are present most days. */
  function fillRow(employeeId: string, mark: Mark) {
    if (data?.locked) return;
    setDirty(true);
    setRows((rs) => rs.map((r) =>
      r.employeeId === employeeId ? { ...r, days: r.days.map(() => mark) } : r
    ));
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, rows: rows.map((r) => ({
          employeeId: r.employeeId, days: r.days, overtimeHours: r.overtimeHours, remark: r.remark,
        })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const days = data?.days || 30;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <CalendarDays size={19} className="text-biome-leaf" /> Attendance
          </h1>
          <p className="mt-1 text-[11.5px] text-biome-muted">
            {data?.scope === "plant" && "Your plant's staff and labour. "}
            {data?.scope === "self" && "Your own attendance. "}
            {data?.scope === "everyone" && "Everyone on the rolls. "}
            Click a day to change it: blank → Present → Absent → Holiday → Leave → Half day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HolidayAnnounce plants={data?.plants || [...PLANTS]} />
          <input type="month" max={new Date().toISOString().slice(0, 7)} value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none" />
          {!data?.locked && (
            <button onClick={save} disabled={busy || !dirty}
              className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />}
              {dirty ? "Save" : "Saved"}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {data?.rules?.enabled && !data?.canApprove && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-3">
          <Lock size={14} className="shrink-0 text-amber-600" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">
            Attendance closes at{" "}
            <span className="font-semibold">
              {data.rules.markByHour > 12 ? `${data.rules.markByHour - 12}:00 PM` : `${data.rules.markByHour}:00 AM`}
            </span>{" "}
            each day. After that only accounts can mark it. If you were away, raise a leave request
            instead — that stops the reminders.
          </p>
        </div>
      )}

      {data?.canApprove && <ChasePanel month={month} />}

      {data?.locked && (
        <div className="flex items-center gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
          <Lock size={14} className="text-biome-muted" />
          <p className="text-[11.5px] text-biome-muted">
            This month is locked because payroll has been approved for it.
          </p>
        </div>
      )}

      {data && data.employees.length === 0 ? (
        <EmptyState
          title="Nobody to mark yet"
          detail="Employees are added under Payroll → Employees. Once someone is on the rolls at your location, their row appears here."
        />
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-2">
            {[["P", "Present"], ["A", "Absent"], ["H", "Weekly off / holiday"], ["L", "Paid leave"], ["HD", "Half day"]].map(([m, label]) => (
              <span key={m} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10.5px] font-semibold ${STYLE[m as Mark]}`}>
                <span className="font-mono">{m}</span> {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted">
              <Sun size={11} /> Shaded = day off in that person's state
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10.5px] font-semibold text-sky-600">
              <Plane size={11} /> L = leave requested · double-click / right-click a day for the mark picker
            </span>
          </div>

          <section className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-biome-line text-[9px] uppercase tracking-[.1em] text-biome-muted">
                    <th className="sticky left-0 z-10 bg-biome-bgSoft px-3 py-2.5 text-left font-semibold">Employee</th>
                    {Array.from({ length: days }, (_, i) => {
                      const d = new Date(`${month}-01T00:00:00`);
                      d.setDate(i + 1);
                      const sunday = d.getDay() === 0;
                      return (
                        <th key={i} className={`px-0.5 py-2.5 text-center font-semibold ${sunday ? "text-biome-leaf" : ""}`}>
                          {i + 1}
                        </th>
                      );
                    })}
                    <th className="px-2 py-2.5 text-right font-semibold">Paid</th>
                    <th className="px-2 py-2.5 text-right font-semibold">Worked</th>
                    <th className="px-2 py-2.5 text-right font-semibold">OT hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const emp: Employee | undefined = data.employees.find((e: Employee) => e.id === r.employeeId);
                    if (!emp) return null;
                    // Totals are recomputed here as the person clicks; the
                    // server recomputes them on save, so the two agree.
                    const paid = r.days.reduce((n, m) => n + (m === "P" || m === "H" || m === "L" ? 1 : m === "HD" ? 0.5 : 0), 0);
                    const worked = r.days.reduce((n, m) => n + (m === "P" ? 1 : m === "HD" ? 0.5 : 0), 0);
                    const unmarked = r.days.filter((m) => !m).length;

                    return (
                      <tr key={r.employeeId} className="border-b border-biome-line/50 last:border-0">
                        <td className="sticky left-0 z-10 bg-biome-bgSoft px-3 py-1.5">
                          <p className="whitespace-nowrap font-semibold text-biome-text">{emp.name}</p>
                          <p className="whitespace-nowrap text-[9.5px] text-biome-muted">
                            {emp.code} · {emp.type === "labour" ? "Labour" : "Staff"}
                            {unmarked > 0 && <span className="ml-1 text-amber-600">· {unmarked} unmarked</span>}
                          </p>
                          {!data.locked && (
                            <div className="mt-1 flex gap-1">
                              {(["P", "H", ""] as Mark[]).map((m) => (
                                <button key={m || "clear"} onClick={() => fillRow(r.employeeId, m)}
                                  title={m === "P" ? "Mark all present" : m === "H" ? "Mark all holiday" : "Clear the row"}
                                  className="rounded border border-biome-line px-1 text-[8.5px] text-biome-muted hover:text-biome-text">
                                  {m || "clr"}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>

                        {Array.from({ length: days }, (_, i) => {
                          const mark = (r.days[i] || "") as Mark;
                          const st = dayState(r.employeeId, i);
                          const onLeave = (data.leaveByEmployee?.[r.employeeId] || [])
                            .find((l: any) => l.date === `${month}-${String(i + 1).padStart(2, "0")}`);
                          const shut = data.locked || st.locked;
                          return (
                            <td key={i} className={`relative px-0.5 py-1.5 text-center ${st.off ? "bg-biome-bg/60" : ""}`}>
                              <button
                                onClick={() => cycle(r.employeeId, i)}
                                onContextMenu={(e) => { e.preventDefault(); if (!shut) setPicker(picker?.emp === r.employeeId && picker?.day === i ? null : { emp: r.employeeId, day: i }); }}
                                onDoubleClick={() => { if (!shut) setPicker({ emp: r.employeeId, day: i }); }}
                                disabled={shut}
                                title={
                                  st.holiday ? `${st.holiday} — holiday`
                                  : onLeave ? `Leave ${onLeave.status} (${onLeave.type})`
                                  : st.lockReason
                                }
                                className={`relative h-6 w-6 rounded border text-[9px] font-bold transition-colors ${STYLE[mark]} ${
                                  shut ? "cursor-default opacity-60" : "hover:brightness-110"
                                } ${st.off && !mark ? "border-dashed" : ""}`}
                              >
                                {mark}
                                {/* A pending or approved leave shows on the
                                    grid, so nobody marks absent over it. */}
                                {onLeave && !mark && (
                                  <span className={`absolute inset-0 flex items-center justify-center text-[8px] ${
                                    onLeave.status === "approved" ? "text-sky-600" : "text-amber-600"
                                  }`}>
                                    L
                                  </span>
                                )}
                              </button>
                              {picker && picker.emp === r.employeeId && picker.day === i && (
                                <div className="absolute z-30 mt-1 -translate-x-1/2 rounded-xl border border-biome-line bg-biome-bgSoft p-1 shadow-xl"
                                  onMouseLeave={() => setPicker(null)}>
                                  {([
                                    ["P", "Present"], ["A", "Absent"], ["H", "Holiday / off"],
                                    ["L", "Paid leave"], ["HD", "Half day"], ["", "Clear"],
                                  ] as [Mark, string][]).map(([m, label]) => (
                                    <button key={m || "clr"} onClick={() => setMark(r.employeeId, i, m)}
                                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[10.5px] transition-colors hover:bg-biome-leaf/12 ${
                                        (r.days[i] || "") === m ? "text-biome-leafBright font-bold" : "text-biome-text"
                                      }`}>
                                      <span className={`flex h-4 w-6 items-center justify-center rounded border text-[8.5px] font-bold ${STYLE[m]}`}>{m || "–"}</span>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-2 py-1.5 text-right font-mono font-semibold text-biome-text">{paid}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-biome-muted">{worked}</td>
                        <td className="px-2 py-1.5 text-right">
                          <input type="number" min="0" value={r.overtimeHours} disabled={data.locked}
                            onChange={(e) => { setDirty(true); setRows((rs) => rs.map((x) => x.employeeId === r.employeeId ? { ...x, overtimeHours: Number(e.target.value) || 0 } : x)); }}
                            className="bmx-input w-[54px] rounded border border-biome-line bg-biome-bg px-1.5 py-1 text-right font-mono text-[10.5px] text-biome-text outline-none" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[10.5px] text-biome-muted">
            Payroll reads these totals when you open the month — paid days, days worked and
            overtime come straight across, so the salary sheet is not typed twice.
          </p>
        </>
      ) : (
        <p className="text-[11.5px] text-biome-muted">Loading…</p>
      )}
    </div>
  );
}

/* ================= reminders and warnings ================= */

/**
 * Who has not marked today, and what is due to go to them.
 *
 * A button rather than a background job on purpose. An unattended mailer
 * that gets one rule wrong sends forty people a warning they did not earn,
 * and that is not recoverable — so accounts sees the list first.
 */
function ChasePanel({ month }: { month: string }) {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/chase?date=${date}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setData(json);
    } catch { /* the panel simply stays quiet */ }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/attendance/chase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      const failed = (json.failed || []).map((f: any) => `${f.name}: ${f.error}`).join(" · ");
      setNote(failed ? `${json.sent} sent. Not sent — ${failed}` : `${json.sent} message(s) sent.`);
      await load();
    } catch (err) { setNote((err as Error).message); }
    finally { setBusy(false); }
  }

  if (!data) return null;
  const due = data.due || { reminder: 0, warning: 0, noEmail: 0 };
  const nothingDue = due.reminder === 0 && due.warning === 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
      <button onClick={() => setOpen((v) => !v)} className="bmx-btn flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${
          due.warning > 0 ? "bg-rose-500/12 text-rose-500" : due.reminder > 0 ? "bg-amber-500/12 text-amber-600" : "bg-emerald-500/12 text-emerald-600"
        }`}>
          {due.warning > 0 ? <ShieldAlert size={15} /> : <Bell size={15} />}
        </span>
        <div className="min-w-[200px] flex-1">
          <p className="text-[13px] font-semibold text-biome-text">
            {nothingDue
              ? "Everyone has marked or applied for leave"
              : `${due.reminder} reminder${due.reminder === 1 ? "" : "s"} and ${due.warning} warning${due.warning === 1 ? "" : "s"} due`}
          </p>
          <p className="mt-0.5 text-[10.5px] text-biome-muted">
            For {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" })}
            {due.noEmail > 0 && ` · ${due.noEmail} have no work email on file`}
          </p>
        </div>
        <span className="text-[11px] text-biome-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="bmx-msg-in border-t border-biome-line p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Day</span>
              <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none" />
            </label>
            <button onClick={send} disabled={busy || nothingDue}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Send size={14} />} Send what is due
            </button>
          </div>

          {note && (
            <p className="bmx-msg-in mt-3 rounded-xl border border-biome-line bg-biome-bg px-3.5 py-2.5 text-[11px] text-biome-text">{note}</p>
          )}

          <div className="mt-4 space-y-1.5">
            {(data.people || []).filter((p: any) => p.stage !== "none").map((p: any) => (
              <div key={p.employeeId} className="flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-2.5">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${
                  p.stage === "warning"
                    ? "border-rose-500/35 bg-rose-500/10 text-rose-500"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-600"
                }`}>
                  {p.stage}
                </span>
                <div className="min-w-[150px] flex-1">
                  <p className="text-[12px] font-semibold text-biome-text">{p.name}</p>
                  <p className="text-[10px] text-biome-muted">
                    {p.code}{p.plant && ` · ${p.plant}`} · {p.reason}
                    {p.remindersSent > 0 && ` · ${p.remindersSent} already sent`}
                  </p>
                </div>
                {!p.canEmail && <span className="text-[10px] text-rose-500">no email on file</span>}
              </div>
            ))}
            {nothingDue && (
              <p className="text-[11.5px] text-biome-muted">
                Nothing to send. Anyone who marked their day, applied for leave, or was off for a
                weekly holiday is left alone.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
