"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  CalendarDays, Loader2, AlertCircle, Check, Lock, Unlock, Send, Bell, ShieldAlert, Sun,
  ChevronLeft, ChevronRight, LayoutGrid, Table2, Search, FileSpreadsheet, FileText, CheckCheck,
  Settings2, Users, Clock, Plane,
} from "lucide-react";
import { EmptyState } from "@/components/SetupGuide";
import Portal from "@/components/Portal";
import HolidayAnnounce from "@/components/attendance/HolidayAnnounce";
import { saveBlob } from "@/lib/saveBlob";

/**
 * Attendance.
 *
 * Two ways to look at the same register:
 *   Cards    — one card per person with their month as a small calendar,
 *              coloured chips and the month's totals; easiest on a laptop
 *              at the plant.
 *   Register — the classic month grid for whoever copies from paper.
 * A click on any day opens the mark picker. "Mark all present" fills
 * today's blank cells in one press.
 *
 * Holidays, the weekly off and approved leave are filled in by the RULES
 * (shown with a dashed edge) — the developer sets those rules in the card
 * at the bottom, which only the developer sees. Everything else is blank
 * until somebody marks it: pre-filling "present" would let a month be
 * approved that nobody actually read.
 */

type Mark = "" | "P" | "A" | "H" | "L" | "HD" | "WO" | "LT";

interface Employee {
  id: string; code: string; name: string; type: string; designation: string;
  department: string; plant: string; region: string;
}
interface Row { employeeId: string; days: Mark[]; auto: number[]; overtimeHours: number; remark: string; }
interface DayInfo {
  date: string; weekday: number; weekOff: boolean; holidays: Record<string, string>;
  editable: boolean; lockReason?: string;
}

const MARKS: { id: Mark; label: string; short: string; paid: number; worked: number }[] = [
  { id: "P", label: "Present", short: "P", paid: 1, worked: 1 },
  { id: "A", label: "Absent", short: "A", paid: 0, worked: 0 },
  { id: "HD", label: "Half day", short: "½", paid: 0.5, worked: 0.5 },
  { id: "L", label: "Leave", short: "L", paid: 1, worked: 0 },
  { id: "LT", label: "Late", short: "LT", paid: 1, worked: 1 },
  { id: "H", label: "Holiday", short: "H", paid: 1, worked: 0 },
  { id: "WO", label: "Week off", short: "WO", paid: 1, worked: 0 },
];

const CHIP: Record<Mark, string> = {
  "": "bg-biome-bg text-biome-muted/40 border-biome-line",
  P: "bg-emerald-500/18 text-emerald-600 border-emerald-500/35",
  A: "bg-rose-500/18 text-rose-500 border-rose-500/35",
  HD: "bg-amber-500/18 text-amber-600 border-amber-500/35",
  L: "bg-sky-500/18 text-sky-600 border-sky-500/35",
  LT: "bg-orange-500/18 text-orange-600 border-orange-500/35",
  H: "bg-violet-500/18 text-violet-500 border-violet-500/35",
  WO: "bg-slate-500/15 text-slate-500 border-slate-400/30",
};
const FILL: Record<Mark, string> = {
  "": "FFFFFFFF", P: "FFD1FAE5", A: "FFFFE4E6", HD: "FFFEF3C7", L: "FFE0F2FE", LT: "FFFFEDD5", H: "FFEDE9FE", WO: "FFF1F5F9",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
function localMonth(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return localMonth(new Date(y, m - 1 + by, 1));
}
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}
const AVATAR = ["bg-emerald-500/15 text-emerald-600", "bg-sky-500/15 text-sky-600", "bg-violet-500/15 text-violet-500", "bg-amber-500/15 text-amber-600", "bg-rose-500/15 text-rose-500"];

/** Mirror of lib/attendance totalsFor so the numbers move as you click. */
function totals(days: Mark[], ot: number, latesPerHalfDay: number) {
  const t = { paid: 0, worked: 0, P: 0, A: 0, L: 0, HD: 0, H: 0, WO: 0, LT: 0, unmarked: 0, lateCut: 0, ot };
  for (const d of days) {
    const m = MARKS.find((x) => x.id === d);
    if (!m) { t.unmarked += 1; continue; }
    t.paid += m.paid; t.worked += m.worked;
    (t as any)[d] += 1;
  }
  if (latesPerHalfDay > 0 && t.LT >= latesPerHalfDay) {
    t.lateCut = Math.floor(t.LT / latesPerHalfDay) * 0.5;
    t.paid = Math.max(0, t.paid - t.lateCut);
  }
  return t;
}

export default function AttendancePage() {
  const [month, setMonth] = useState(localMonth());
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "grid">("cards");
  const [q, setQ] = useState("");
  const [plantFilter, setPlantFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [picker, setPicker] = useState<{ emp: string; day: number; x: number; y: number } | null>(null);

  useEffect(() => {
    try { const v = localStorage.getItem("biome.attendance.view"); if (v === "grid" || v === "cards") setView(v); } catch { /* ignore */ }
  }, []);
  function chooseView(v: "cards" | "grid") {
    setView(v);
    try { localStorage.setItem("biome.attendance.view", v); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/attendance?month=${month}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      setRows(json.rows);
      setDirtyIds(new Set());
    } catch (err) { setError((err as Error).message); }
  }, [month]);
  useLiveRefresh(() => { if (dirtyIds.size === 0) load(); });
  useEffect(() => { load(); }, [load]);

  const employees: Employee[] = data?.employees || [];
  const dayInfo: DayInfo[] = data?.dayInfo || [];
  const n: number = data?.days || 30;
  const rules = data?.rules || {};
  const locked: boolean = Boolean(data?.locked);
  const todayIdx = data && data.today?.startsWith(month) ? Number(data.today.slice(8, 10)) - 1 : -1;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter((e) =>
      (!plantFilter || (plantFilter === "-" ? !e.plant : e.plant === plantFilter)) &&
      (!deptFilter || e.department === deptFilter) &&
      (!needle || [e.name, e.code, e.designation, e.department].join(" ").toLowerCase().includes(needle))
    );
  }, [employees, q, plantFilter, deptFilter]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);

  function canEdit(day: number) {
    return !locked && Boolean(dayInfo[day]?.editable);
  }

  function setMark(employeeId: string, day: number, m: Mark) {
    if (!canEdit(day)) return;
    setRows((rs) => rs.map((r) => {
      if (r.employeeId !== employeeId) return r;
      const days = [...r.days];
      days[day] = m;
      return { ...r, days, auto: r.auto.filter((i) => i !== day) };
    }));
    setDirtyIds((s) => new Set(s).add(employeeId));
    setPicker(null);
  }

  function setOt(employeeId: string, v: number) {
    setRows((rs) => rs.map((r) => (r.employeeId === employeeId ? { ...r, overtimeHours: v } : r)));
    setDirtyIds((s) => new Set(s).add(employeeId));
  }

  async function saveRows(list: Row[], ids: Set<string>, message?: string) {
    if (ids.size === 0) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          rows: list.filter((r) => ids.has(r.employeeId)).map((r) => ({
            employeeId: r.employeeId, days: r.days, overtimeHours: r.overtimeHours, remark: r.remark,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setNotice(message || `Saved ${ids.size} employee${ids.size === 1 ? "" : "s"}.`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  /** Today's blank cells → Present, for everyone in view, then save. */
  async function markAllPresentToday() {
    if (todayIdx < 0 || !canEdit(todayIdx)) return;
    const ids = new Set<string>();
    const leaveToday = (id: string) =>
      (data.leaveByEmployee?.[id] || []).some((l: any) => l.date === data.today && l.status === "approved");
    const next = rows.map((r) => {
      if (!visible.some((e) => e.id === r.employeeId)) return r;
      if (r.days[todayIdx] || leaveToday(r.employeeId)) return r;
      const days = [...r.days];
      days[todayIdx] = "P";
      ids.add(r.employeeId);
      return { ...r, days };
    });
    if (!ids.size) { setNotice("Everyone in view already has today marked."); return; }
    setRows(next);
    await saveRows(next, ids, `${ids.size} marked present for today.`);
  }

  async function lockMonth(action: "lock" | "unlock") {
    if (action === "lock" && !window.confirm(`Lock ${monthLabel(month)}? Nobody can change it until the developer unlocks it.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, month }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  /* ---------- summaries ---------- */
  const summary = useMemo(() => {
    const s = { people: visible.length, paid: 0, P: 0, A: 0, L: 0, LT: 0, unmarked: 0, todayP: 0, todayA: 0, todayL: 0, todayBlank: 0, workdays: 0 };
    for (const e of visible) {
      const r = rowOf.get(e.id);
      if (!r) continue;
      const t = totals(r.days, r.overtimeHours, rules.latesPerHalfDay || 0);
      s.paid += t.paid; s.P += t.P + t.LT; s.A += t.A; s.L += t.L; s.LT += t.LT;
      s.workdays += t.P + t.LT + t.A + t.L + t.HD;
      if (todayIdx >= 0) {
        const m = r.days[todayIdx];
        if (m === "P" || m === "LT" || m === "HD") s.todayP += 1;
        else if (m === "A") s.todayA += 1;
        else if (m === "L") s.todayL += 1;
        else if (!m) s.todayBlank += 1;
      }
    }
    return s;
  }, [visible, rowOf, rules.latesPerHalfDay, todayIdx]);
  const rate = summary.workdays ? Math.round((summary.P / summary.workdays) * 100) : 0;

  /* ---------- exports ---------- */
  function exportRows() {
    return visible.map((e) => {
      const r = rowOf.get(e.id)!;
      return { e, r, t: totals(r.days, r.overtimeHours, rules.latesPerHalfDay || 0) };
    });
  }

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Attendance ${month}`);
    const head = ["Code", "Name", "Plant", "Department", ...Array.from({ length: n }, (_, i) => String(i + 1)),
      "Present", "Late", "Absent", "Half day", "Leave", "Holiday", "Week off", "Late cut", "Payable days", "OT hrs"];
    ws.addRow([`Attendance register — ${monthLabel(month)}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const hr = ws.addRow(head);
    hr.font = { bold: true };
    hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E4" } }; c.alignment = { horizontal: "center" }; });
    for (const { e, r, t } of exportRows()) {
      const row = ws.addRow([e.code, e.name, e.plant || "Office", e.department, ...r.days.map((d) => d || ""),
        t.P, t.LT, t.A, t.HD, t.L, t.H, t.WO, t.lateCut, t.paid, t.ot]);
      r.days.forEach((d, i) => {
        const c = row.getCell(5 + i);
        c.alignment = { horizontal: "center" };
        if (d) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[d] } };
      });
    }
    ws.getColumn(1).width = 10; ws.getColumn(2).width = 24; ws.getColumn(3).width = 8; ws.getColumn(4).width = 14;
    for (let i = 0; i < n; i++) ws.getColumn(5 + i).width = 4.2;
    ws.addRow([]);
    ws.addRow(["Legend: P Present · LT Late · HD Half day · L Leave · H Holiday · WO Week off · A Absent"]);
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Attendance_${month}.xlsx`);
  }

  async function exportPdf() {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const { drawLetterhead, drawFooter } = await import("@/lib/pdfBranding");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const scopeLabel = data?.scope === "plant" ? `Plant ${data.plant}` : plantFilter ? `Plant ${plantFilter}` : "All locations";
    const startY = await drawLetterhead(doc, `Attendance — ${monthLabel(month)}`, `${scopeLabel} · ${visible.length} employee(s)${locked ? " · LOCKED" : ""}`);
    const list = exportRows();
    autoTable(doc, {
      startY,
      head: [["Code", "Name", ...Array.from({ length: n }, (_, i) => String(i + 1)), "P", "A", "L", "HD", "Pay"]],
      body: list.map(({ e, r, t }) => [e.code, e.name, ...r.days.map((d) => d || ""), t.P + t.LT, t.A, t.L, t.HD, t.paid]),
      styles: { fontSize: 5.6, cellPadding: 0.7, halign: "center" },
      headStyles: { fillColor: [90, 156, 78], fontSize: 5.8 },
      columnStyles: { 0: { halign: "left", cellWidth: 12 }, 1: { halign: "left", cellWidth: 28 } },
      didParseCell: (h: any) => {
        if (h.section !== "body") return;
        const v = String(h.cell.raw || "");
        const col: Record<string, [number, number, number]> = {
          P: [209, 250, 229], A: [255, 228, 230], HD: [254, 243, 199], L: [224, 242, 254],
          LT: [255, 237, 213], H: [237, 233, 254], WO: [241, 245, 249],
        };
        if (h.column.index >= 2 && h.column.index < 2 + n && col[v]) h.cell.styles.fillColor = col[v];
      },
    });
    drawFooter(doc);
    saveBlob(doc.output("blob"), `Attendance_${month}.pdf`);
  }

  /* ---------- render ---------- */
  const pickerRow = picker ? rowOf.get(picker.emp) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <CalendarDays size={19} className="text-biome-leaf" /> Attendance
          </h1>
          <p className="mt-1 text-[11.5px] text-biome-muted">
            {data?.scope === "plant" && `Your plant's staff and labour (${data.plant}). `}
            {data?.scope === "self" && "Your own attendance. "}
            {data?.scope === "everyone" && "Everyone on the rolls. "}
            Click any day to mark it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.canAnnounce && <HolidayAnnounce onDone={load} />}
          <div className="flex items-center rounded-xl border border-biome-line bg-biome-bg">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2 py-2 text-biome-muted hover:text-biome-text" aria-label="Previous month"><ChevronLeft size={15} /></button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month"
              className="bg-transparent px-1 py-1.5 text-[12px] font-semibold text-biome-text outline-none" />
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2 py-2 text-biome-muted hover:text-biome-text" aria-label="Next month"><ChevronRight size={15} /></button>
          </div>
          <button onClick={exportExcel} disabled={!data || !visible.length} title="Export to Excel"
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-40">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button onClick={exportPdf} disabled={!data || !visible.length} title="Export to PDF"
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-40">
            <FileText size={13} /> PDF
          </button>
          {!locked && (
            <button onClick={() => saveRows(rows, dirtyIds)} disabled={busy || dirtyIds.size === 0} data-testid="attendance-save"
              className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />}
              {dirtyIds.size ? `Save (${dirtyIds.size})` : "Saved"}
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
      {notice && !error && (
        <div className="bmx-msg-in flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/[.07] px-4 py-2.5" data-testid="attendance-notice">
          <Check size={14} className="shrink-0 text-emerald-600" />
          <p className="text-[11.5px] text-biome-text">{notice}</p>
        </div>
      )}

      {/* Lock state */}
      {data && (locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
          <Lock size={15} className="text-biome-muted" />
          <p className="flex-1 text-[11.5px] text-biome-muted">
            {monthLabel(month)} is locked{data.lock?.byName ? ` by ${data.lock.byName}` : ""}. Nothing can be changed until the developer unlocks it.
          </p>
          {data.canUnlock && (
            <button onClick={() => lockMonth("unlock")} disabled={busy}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-text">
              <Unlock size={13} /> Unlock month
            </button>
          )}
        </div>
      ) : data.scope === "plant" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/25 bg-sky-500/[.06] px-4 py-2.5">
          <Clock size={14} className="shrink-0 text-sky-600" />
          <p className="text-[11.5px] text-biome-text">
            You can mark today and the last <b>{rules.managerBackDays}</b> day{rules.managerBackDays === 1 ? "" : "s"}. Older days are corrected by accounts.
          </p>
        </div>
      ) : data.scope === "self" && rules.enabled ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-2.5">
          <Lock size={14} className="shrink-0 text-amber-600" />
          <p className="text-[11.5px] text-biome-text">
            Attendance closes at <b>{rules.markByHour > 12 ? `${rules.markByHour - 12}:00 PM` : `${rules.markByHour}:00 AM`}</b> each day. If you were away, raise a leave request instead.
          </p>
        </div>
      ) : null)}

      {data?.canApprove && !locked && <ChasePanel />}

      {data && employees.length === 0 ? (
        <EmptyState
          title="Nobody to mark yet"
          detail={data.scope === "plant"
            ? "Add your plant's people under People → Employees. They appear here as soon as they are on the rolls."
            : "Employees are added under People → Employees. Once someone is on the rolls at your location, they appear here."}
        />
      ) : data ? (
        <>
          {/* Today + KPIs */}
          <section className="grid gap-3 lg:grid-cols-[1.25fr_2fr]">
            <div className="relative overflow-hidden rounded-2xl border border-biome-line bg-gradient-to-br from-biome-leaf/12 via-biome-bgSoft to-biome-bgSoft p-4">
              <p className="text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">
                {todayIdx >= 0 ? `Today · ${new Date(data.today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" })}` : monthLabel(month)}
              </p>
              {todayIdx >= 0 ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <Stat n={summary.todayP} label="present" cls="text-emerald-600" />
                    <Stat n={summary.todayA} label="absent" cls="text-rose-500" />
                    <Stat n={summary.todayL} label="on leave" cls="text-sky-600" />
                    <Stat n={summary.todayBlank} label="not marked" cls="text-amber-600" />
                  </div>
                  <button onClick={markAllPresentToday} disabled={busy || !canEdit(todayIdx) || summary.todayBlank === 0}
                    data-testid="mark-all-present"
                    className="bmx-btn mt-3 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-45">
                    <CheckCheck size={14} /> Mark all present for today
                  </button>
                  {!canEdit(todayIdx) && (
                    <p className="mt-1.5 text-[10px] text-biome-muted">{dayInfo[todayIdx]?.lockReason || "Today is closed."}</p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-[11.5px] text-biome-muted">Pick the current month to mark today.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi icon={<Users size={14} />} label="Employees" value={summary.people} />
              <Kpi icon={<Check size={14} />} label="Attendance rate" value={`${rate}%`} hint="present ÷ working days marked" />
              <Kpi icon={<CalendarDays size={14} />} label="Payable days" value={summary.paid} hint="all in view, this month" />
              <Kpi icon={<AlertCircle size={14} />} label="Absent · Late" value={`${summary.A} · ${summary.LT}`} />
            </div>
          </section>

          {/* Filters */}
          <section className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
              <Search size={13} className="text-biome-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, designation…"
                className="w-full bg-transparent text-[12px] text-biome-text outline-none" />
            </div>
            {(data.plants || []).length > 0 && (
              <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)} aria-label="Plant"
                className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none">
                <option value="">All plants</option>
                {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
                <option value="-">Head office</option>
              </select>
            )}
            {(data.departments || []).length > 0 && (
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Department"
                className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none">
                <option value="">All departments</option>
                {data.departments.map((d: string) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <div className="flex rounded-xl border border-biome-line p-0.5">
              {([["cards", <LayoutGrid key="c" size={13} />, "Cards"], ["grid", <Table2 key="g" size={13} />, "Register"]] as const).map(([v, icon, label]) => (
                <button key={v} onClick={() => chooseView(v)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold ${view === v ? "bg-biome-leaf/15 text-biome-leaf" : "text-biome-muted"}`}>
                  {icon} {label}
                </button>
              ))}
            </div>
          </section>

          {/* Legend + holidays */}
          <section className="flex flex-wrap items-center gap-1.5">
            {MARKS.map((m) => (
              <span key={m.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-semibold ${CHIP[m.id]}`}>
                <span className="font-mono">{m.short}</span> {m.label}{m.id === "LT" && rules.lateAfter ? ` (after ${rules.lateAfter})` : ""}
              </span>
            ))}
            <span className="rounded-lg border border-dashed border-biome-line px-2 py-1 text-[10.5px] text-biome-muted">dashed = filled by rules</span>
            {(data.holidaysThisMonth || []).map((h: any) => (
              <span key={h.date + h.name} className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/[.07] px-2 py-1 text-[10.5px] text-violet-500">
                <Sun size={11} /> {Number(h.date.slice(8))} · {h.name} <span className="opacity-60">({h.regions.join(", ")})</span>
              </span>
            ))}
          </section>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-biome-line px-6 py-10 text-center text-[12px] text-biome-muted">No one matches these filters.</p>
          ) : view === "cards" ? (
            <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((e, idx) => {
                const r = rowOf.get(e.id);
                if (!r) return null;
                const t = totals(r.days, r.overtimeHours, rules.latesPerHalfDay || 0);
                const firstWeekday = dayInfo[0]?.weekday ?? 0;
                const todayMark = todayIdx >= 0 ? r.days[todayIdx] : "";
                return (
                  <article key={e.id} data-testid="attendance-card"
                    className="bmx-rise overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
                    style={{ animationDelay: `${Math.min(idx, 10) * 0.03}s` }}>
                    <div className="flex items-start gap-3 p-4 pb-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold ${AVATAR[idx % AVATAR.length]}`}>
                        {initials(e.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-biome-text">{e.name}</p>
                        <p className="truncate text-[10.5px] text-biome-muted">
                          {e.code} · {e.designation || (e.type === "labour" ? "Labour" : "Staff")}{e.department && ` · ${e.department}`}{e.plant ? ` · ${e.plant}` : " · Office"}
                        </p>
                      </div>
                      {todayIdx >= 0 && (
                        <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.08em] ${CHIP[(todayMark || "") as Mark]}`}>
                          {todayMark ? MARKS.find((m) => m.id === todayMark)?.label : "Today: —"}
                        </span>
                      )}
                    </div>

                    <div className="px-4">
                      <div className="grid grid-cols-7 gap-1 text-center text-[8.5px] font-semibold uppercase tracking-[.08em] text-biome-muted">
                        {WEEKDAYS.map((d) => <span key={d}>{d.slice(0, 2)}</span>)}
                      </div>
                      <div className="mt-1 grid grid-cols-7 gap-1">
                        {Array.from({ length: firstWeekday }, (_, i) => <span key={"b" + i} />)}
                        {Array.from({ length: n }, (_, i) => (
                          <DayChip key={i} mark={r.days[i] as Mark} day={i} auto={r.auto.includes(i)}
                            today={i === todayIdx} info={dayInfo[i]} region={e.region}
                            leave={(data.leaveByEmployee?.[e.id] || []).find((l: any) => l.date === dayInfo[i]?.date)}
                            editable={canEdit(i)}
                            onPick={(x, y) => setPicker({ emp: e.id, day: i, x, y })} />
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-px border-t border-biome-line bg-biome-line text-center">
                      <MiniStat label="Present" value={t.P + t.LT} cls="text-emerald-600" />
                      <MiniStat label="Absent" value={t.A} cls="text-rose-500" />
                      <MiniStat label="Leave" value={t.L} sub={t.HD ? `${t.HD} half` : undefined} cls="text-sky-600" />
                      <MiniStat label="Payable" value={t.paid} cls="text-biome-text" strong />
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-biome-line px-4 py-2 text-[10px] text-biome-muted">
                      <span>
                        {t.H + t.WO} off/holiday{t.LT ? ` · ${t.LT} late` : ""}{t.lateCut ? ` (−${t.lateCut} day)` : ""}
                        {t.unmarked > 0 && <span className="text-amber-600"> · {t.unmarked} unmarked</span>}
                      </span>
                      <label className="flex items-center gap-1.5">
                        OT hrs
                        <input type="number" min="0" value={r.overtimeHours} disabled={locked}
                          onChange={(ev) => setOt(e.id, Number(ev.target.value) || 0)}
                          className="bmx-input w-[52px] rounded border border-biome-line bg-biome-bg px-1.5 py-0.5 text-right font-mono text-[10.5px] text-biome-text outline-none" />
                      </label>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-biome-line text-[9px] uppercase tracking-[.1em] text-biome-muted">
                      <th className="sticky left-0 z-10 bg-biome-bgSoft px-3 py-2.5 text-left font-semibold">Employee</th>
                      {dayInfo.map((d, i) => (
                        <th key={i} className={`px-0.5 py-2 text-center font-semibold ${d.weekOff ? "text-biome-leaf" : ""} ${i === todayIdx ? "text-amber-600" : ""}`}>
                          <div>{i + 1}</div><div className="text-[7.5px] opacity-70">{WEEKDAYS[d.weekday].slice(0, 2)}</div>
                        </th>
                      ))}
                      <th className="px-2 py-2.5 text-right font-semibold">P</th>
                      <th className="px-2 py-2.5 text-right font-semibold">A</th>
                      <th className="px-2 py-2.5 text-right font-semibold">L</th>
                      <th className="px-2 py-2.5 text-right font-semibold">Pay</th>
                      <th className="px-2 py-2.5 text-right font-semibold">OT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => {
                      const r = rowOf.get(e.id);
                      if (!r) return null;
                      const t = totals(r.days, r.overtimeHours, rules.latesPerHalfDay || 0);
                      return (
                        <tr key={e.id} className="border-b border-biome-line/50 last:border-0">
                          <td className="sticky left-0 z-10 bg-biome-bgSoft px-3 py-1.5">
                            <p className="whitespace-nowrap font-semibold text-biome-text">{e.name}</p>
                            <p className="whitespace-nowrap text-[9.5px] text-biome-muted">{e.code}{e.plant && ` · ${e.plant}`}</p>
                          </td>
                          {Array.from({ length: n }, (_, i) => (
                            <td key={i} className="px-[1px] py-1 text-center">
                              <DayChip mark={r.days[i] as Mark} day={i} auto={r.auto.includes(i)} compact
                                today={i === todayIdx} info={dayInfo[i]} region={e.region}
                                leave={(data.leaveByEmployee?.[e.id] || []).find((l: any) => l.date === dayInfo[i]?.date)}
                                editable={canEdit(i)}
                                onPick={(x, y) => setPicker({ emp: e.id, day: i, x, y })} />
                            </td>
                          ))}
                          <td className="px-2 text-right font-mono text-emerald-600">{t.P + t.LT}</td>
                          <td className="px-2 text-right font-mono text-rose-500">{t.A}</td>
                          <td className="px-2 text-right font-mono text-sky-600">{t.L}</td>
                          <td className="px-2 text-right font-mono font-semibold text-biome-text">{t.paid}</td>
                          <td className="px-2 text-right">
                            <input type="number" min="0" value={r.overtimeHours} disabled={locked}
                              onChange={(ev) => setOt(e.id, Number(ev.target.value) || 0)}
                              className="bmx-input w-[48px] rounded border border-biome-line bg-biome-bg px-1 py-0.5 text-right font-mono text-[10.5px] text-biome-text outline-none" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.canLock && !locked && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
              <Lock size={14} className="text-biome-muted" />
              <p className="flex-1 text-[11px] text-biome-muted">
                When the month is checked and approved, lock it — payroll then reads a register nobody can change.
              </p>
              <button onClick={() => lockMonth("lock")} disabled={busy || dirtyIds.size > 0}
                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-text disabled:opacity-50">
                <Lock size={12} /> Approve &amp; lock {monthLabel(month)}
              </button>
            </div>
          )}

          <p className="text-[10.5px] text-biome-muted">
            Payroll reads these totals when the month is opened — payable days, days worked and overtime come straight across.
          </p>
        </>
      ) : (
        <p className="text-[11.5px] text-biome-muted">Loading…</p>
      )}

      {data?.canConfigure && <RulesCard month={month} locked={locked} onChanged={load} />}

      {/* Mark picker */}
      {picker && pickerRow && (
        <Portal>
          <div className="fixed inset-0 z-[220]" onClick={() => setPicker(null)} onContextMenu={(e) => { e.preventDefault(); setPicker(null); }} />
          <div role="menu" data-testid="mark-picker"
            className="fixed z-[221] w-[168px] rounded-xl border border-biome-line bg-biome-bgSoft p-1 shadow-2xl"
            style={{ left: Math.min(picker.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 180), top: Math.min(picker.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 300) }}>
            <p className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">
              {dayInfo[picker.day] && new Date(dayInfo[picker.day].date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
            </p>
            {[...MARKS, { id: "" as Mark, label: "Clear", short: "–", paid: 0, worked: 0 }].map((m) => (
              <button key={m.id || "clr"} role="menuitem" onClick={() => setMark(picker.emp, picker.day, m.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-biome-leaf/12 ${
                  (pickerRow.days[picker.day] || "") === m.id ? "font-bold text-biome-leaf" : "text-biome-text"
                }`}>
                <span className={`flex h-5 w-7 items-center justify-center rounded border text-[9px] font-bold ${CHIP[m.id]}`}>{m.short}</span>
                {m.label}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
}

/* ================= pieces ================= */

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className="rounded-xl border border-biome-line bg-biome-bg/60 px-2.5 py-1.5">
      <b className={`font-mono text-[15px] ${cls}`}>{n}</b> <span className="text-biome-muted">{label}</span>
    </span>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-biome-line bg-biome-bgSoft p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{icon} {label}</p>
      <p className="mt-1.5 font-mono text-[20px] font-semibold text-biome-text">{value}</p>
      {hint && <p className="text-[9.5px] text-biome-muted">{hint}</p>}
    </div>
  );
}

function MiniStat({ label, value, sub, cls, strong }: { label: string; value: number; sub?: string; cls: string; strong?: boolean }) {
  return (
    <div className="bg-biome-bgSoft px-2 py-2">
      <p className={`font-mono ${strong ? "text-[16px] font-bold" : "text-[14px] font-semibold"} ${cls}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-[.1em] text-biome-muted">{label}{sub ? ` · ${sub}` : ""}</p>
    </div>
  );
}

function DayChip({
  mark, day, auto, today, info, region, leave, editable, onPick, compact,
}: {
  mark: Mark; day: number; auto: boolean; today: boolean; info?: DayInfo; region: string;
  leave?: { type: string; status: string }; editable: boolean; onPick: (x: number, y: number) => void; compact?: boolean;
}) {
  const holiday = info?.holidays?.[region];
  const title = [
    info?.date,
    holiday ? `${holiday} (holiday)` : info?.weekOff ? "Weekly off" : "",
    leave ? `Leave ${leave.status} (${leave.type})` : "",
    auto ? "filled by rules" : "",
    !editable ? info?.lockReason || "closed" : "",
  ].filter(Boolean).join(" · ");
  const short = MARKS.find((m) => m.id === mark)?.short || "";
  return (
    <button
      type="button"
      title={title}
      data-day={day + 1}
      disabled={!editable}
      onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onPick(r.left, r.bottom + 4); }}
      className={`relative flex items-center justify-center rounded-md border font-bold transition ${
        compact ? "h-6 w-6 text-[8.5px]" : "h-8 w-full text-[10.5px]"
      } ${CHIP[mark || ""]} ${auto ? "border-dashed" : ""} ${today ? "ring-2 ring-amber-500/60 ring-offset-1 ring-offset-biome-bgSoft" : ""} ${
        editable ? "cursor-pointer hover:scale-[1.06] hover:brightness-110" : "cursor-default opacity-60"
      } ${!mark && (info?.weekOff || holiday) ? "bg-biome-bg/40" : ""}`}
    >
      {mark ? short : <span className="text-[8.5px] font-medium text-biome-muted/50">{day + 1}</span>}
      {leave && !mark && (
        <Plane size={8} className={`absolute right-0.5 top-0.5 ${leave.status === "approved" ? "text-sky-600" : "text-amber-600"}`} />
      )}
    </button>
  );
}

/* ================= developer rules ================= */

function RulesCard({ month, locked, onChanged }: { month: string; locked: boolean; onChanged: () => void }) {
  const [rules, setRules] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/attendance/rules", { cache: "no-store" }).then((r) => r.json()).then((j) => setRules(j.rules)).catch(() => {});
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/attendance/rules", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rules),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setRules(json.rules);
      setMsg("Rules saved.");
      onChanged();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleLock() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: locked ? "unlock" : "lock", month }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onChanged();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  if (!rules) return null;
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
  const lbl = "mb-1 block text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted";
  const toggle = (key: string, label: string, help: string) => (
    <label className="flex items-start gap-2.5 rounded-xl border border-biome-line px-3 py-2.5">
      <input type="checkbox" checked={Boolean(rules[key])} onChange={(e) => setRules({ ...rules, [key]: e.target.checked })} className="mt-0.5" />
      <span>
        <span className="block text-[11.5px] font-semibold text-biome-text">{label}</span>
        <span className="block text-[10px] text-biome-muted">{help}</span>
      </span>
    </label>
  );

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-500/[.04] p-5" data-testid="attendance-rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-biome-text">
          <Settings2 size={15} className="text-violet-500" /> Attendance rules
          <span className="rounded-full border border-violet-500/35 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-violet-500">Developer only</span>
        </h2>
        {rules.updatedByName && (
          <p className="text-[10px] text-biome-muted">Last changed by {rules.updatedByName}{rules.updatedAt ? ` · ${new Date(rules.updatedAt).toLocaleString("en-IN")}` : ""}</p>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div>
          <span className={lbl}>Weekly off</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => {
              const on = (rules.weekOffDays || []).includes(i);
              return (
                <button key={d} onClick={() => setRules({ ...rules, weekOffDays: on ? rules.weekOffDays.filter((x: number) => x !== i) : [...rules.weekOffDays, i] })}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${on ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className={lbl}>Late after (time)</span>
          <input type="time" value={rules.lateAfter} onChange={(e) => setRules({ ...rules, lateAfter: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className={lbl}>Late marks per half-day cut (0 = off)</span>
          <input type="number" min={0} max={31} value={rules.latesPerHalfDay} onChange={(e) => setRules({ ...rules, latesPerHalfDay: Number(e.target.value) })} className={input} />
        </label>
        <label className="block">
          <span className={lbl}>Plant managers may edit — days back</span>
          <input type="number" min={0} max={62} value={rules.managerBackDays} onChange={(e) => setRules({ ...rules, managerBackDays: Number(e.target.value) })} className={input} />
        </label>
        <label className="block">
          <span className={lbl}>Self-marking closes at (hour, 0–23)</span>
          <input type="number" min={0} max={23} value={rules.markByHour} onChange={(e) => setRules({ ...rules, markByHour: Number(e.target.value) })} className={input} />
        </label>
        <div>
          <span className={lbl}>Month lock — {monthLabel(month)}</span>
          <button onClick={toggleLock} disabled={busy}
            className="bmx-chip flex w-full items-center justify-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11.5px] font-semibold text-biome-text">
            {locked ? <><Unlock size={13} /> Unlock month</> : <><Lock size={13} /> Lock month</>}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {toggle("autoMarkHolidays", "Holidays fill themselves", "An announced holiday is marked H for everyone it applies to.")}
        {toggle("autoMarkWeekOff", "Week offs fill themselves", "Blank weekly-off days read and save as WO.")}
        {toggle("allowFutureMarks", "Allow marking future days", "For planned leave or shutdowns entered in advance.")}
        {toggle("plantManagerLeave", "Plant managers raise leave", "They may apply for leave on behalf of their plant's staff.")}
        {toggle("enabled", "Daily cut-off & reminders", "Self-marking closes at the hour above; reminders and warnings can be sent.")}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={busy}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save rules
        </button>
        {msg && <p className="text-[11px] text-biome-muted">{msg}</p>}
      </div>
    </section>
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
function ChasePanel() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const d0 = new Date();
  const [date, setDate] = useState(`${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`);

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
      <button onClick={() => setOpen((v) => !v)} className="bmx-btn flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${
          due.warning > 0 ? "bg-rose-500/12 text-rose-500" : due.reminder > 0 ? "bg-amber-500/12 text-amber-600" : "bg-emerald-500/12 text-emerald-600"
        }`}>
          {due.warning > 0 ? <ShieldAlert size={15} /> : <Bell size={15} />}
        </span>
        <div className="min-w-[200px] flex-1">
          <p className="text-[12.5px] font-semibold text-biome-text">
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
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
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
                Nothing to send. Anyone who marked their day, applied for leave, or was off is left alone.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
