"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, CalendarDays, FileSpreadsheet, FileText, Sun, Users, Loader2,
} from "lucide-react";
import { saveBlob } from "@/lib/saveBlob";

/**
 * One calendar + the month as a list.
 *
 * Shows the person's own leave (with its status), the holidays of their
 * location, weekly offs and — for a manager — who in their scope is away.
 * The same rows drive the list, the Excel and the PDF, so all three agree.
 */

export interface CalHoliday { date: string; name: string; regions: string[]; confirm?: boolean; kind?: string; note?: string; announcedAt?: string; announcedBy?: string }
export interface CalLeave {
  id: string; employeeId?: string; employeeName: string; employeeCode: string; plant: string;
  type: string; fromDate: string; toDate: string; days: number;
  status: "pending" | "approved" | "rejected" | "cancelled"; reason?: string;
}

/** Colour per leave type — literal classes so Tailwind keeps them. */
export const TYPE_TONE: Record<string, { dot: string; chip: string; bar: string; label: string }> = {
  sick: { dot: "bg-rose-500", chip: "border-rose-500/30 bg-rose-500/12 text-rose-600", bar: "bg-rose-500", label: "Sick" },
  medical: { dot: "bg-violet-500", chip: "border-violet-500/30 bg-violet-500/12 text-violet-600", bar: "bg-violet-500", label: "Medical" },
  casual: { dot: "bg-sky-500", chip: "border-sky-500/30 bg-sky-500/12 text-sky-600", bar: "bg-sky-500", label: "Casual" },
  earned: { dot: "bg-emerald-500", chip: "border-emerald-500/30 bg-emerald-500/12 text-emerald-600", bar: "bg-emerald-500", label: "Earned" },
  comp_off: { dot: "bg-teal-500", chip: "border-teal-500/30 bg-teal-500/12 text-teal-600", bar: "bg-teal-500", label: "Comp off" },
  unpaid: { dot: "bg-slate-500", chip: "border-slate-500/30 bg-slate-500/12 text-slate-500", bar: "bg-slate-500", label: "Unpaid" },
};
export const toneOf = (type: string) => TYPE_TONE[type] || TYPE_TONE.unpaid;
const HOLIDAY_CHIP = "border-orange-500/35 bg-orange-500/12 text-orange-600";

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
export const shortDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" });

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Consecutive days of the same holiday become one range. */
export function groupHolidays(list: CalHoliday[]) {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const out: { name: string; from: string; to: string; days: number; h: CalHoliday }[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && last.name === h.name) {
      const next = new Date(`${last.to}T00:00:00`); next.setDate(next.getDate() + 1);
      if (iso(next) === h.date) { last.to = h.date; last.days += 1; continue; }
    }
    out.push({ name: h.name, from: h.date, to: h.date, days: 1, h });
  }
  return out;
}

const STATUS_LABEL: Record<string, string> = { pending: "Waiting", approved: "Approved", rejected: "Not approved", cancelled: "Cancelled" };
const STATUS_CHIP: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-500",
  cancelled: "border-biome-line text-biome-muted",
};

interface Row {
  kind: "holiday" | "mine" | "team";
  from: string; to: string;
  title: string; sub: string; status?: string; type?: string;
}

export default function LeaveCalendar({
  month, onMonth, holidays, mine, team, weekOffDays, typeLabel, locationLabel, personLabel, loading,
}: {
  month: string; onMonth: (m: string) => void;
  holidays: CalHoliday[]; mine: CalLeave[]; team: CalLeave[];
  weekOffDays: number[]; typeLabel: (t: string) => string;
  locationLabel: string; personLabel: string; loading?: boolean;
}) {
  const today = iso(new Date());
  const [picked, setPicked] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"" | "xlsx" | "pdf">("");

  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Monday-first grid.
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);

  const covers = (r: { fromDate: string; toDate: string }, d: string) => r.fromDate <= d && d <= r.toDate;
  const liveMine = mine.filter((r) => r.status === "pending" || r.status === "approved");

  const byDay = useMemo(() => {
    const map = new Map<string, { hol: CalHoliday[]; mine: CalLeave[]; team: CalLeave[] }>();
    for (const c of cells) {
      if (!c) continue;
      map.set(c, {
        hol: holidays.filter((h) => h.date === c),
        mine: liveMine.filter((r) => covers(r, c)),
        team: team.filter((r) => covers(r, c)),
      });
    }
    return map;
  }, [month, holidays, mine, team]); // eslint-disable-line react-hooks/exhaustive-deps

  // The month as a list — the same rows go to Excel and PDF.
  const rows: Row[] = useMemo(() => {
    const start = `${month}-01`, end = `${month}-${pad(daysInMonth)}`;
    const inMonth = (f: string, t: string) => !(t < start || f > end);
    const list: Row[] = [];
    for (const g of groupHolidays(holidays.filter((h) => h.date >= start && h.date <= end))) {
      list.push({
        kind: "holiday", from: g.from, to: g.to, title: g.name,
        sub: `${g.h.kind === "shutdown" ? "Shutdown" : "Holiday"}${g.days > 1 ? ` · ${g.days} days` : ""}${g.h.confirm ? " · date to be confirmed" : ""}`,
      });
    }
    for (const r of mine.filter((r) => r.status !== "cancelled" && inMonth(r.fromDate, r.toDate))) {
      list.push({ kind: "mine", from: r.fromDate, to: r.toDate, title: typeLabel(r.type), sub: `${r.days} working day${r.days === 1 ? "" : "s"}${r.reason ? ` · ${r.reason}` : ""}`, status: r.status, type: r.type });
    }
    for (const r of team.filter((r) => inMonth(r.fromDate, r.toDate))) {
      list.push({ kind: "team", from: r.fromDate, to: r.toDate, title: `${r.employeeName} — ${typeLabel(r.type)}`, sub: `${r.employeeCode}${r.plant ? ` · ${r.plant}` : ""} · ${r.days} day${r.days === 1 ? "" : "s"}`, status: r.status, type: r.type });
    }
    return list.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
  }, [month, holidays, mine, team, daysInMonth, typeLabel]);

  const weekOffs = cells.filter((c) => c && weekOffDays.includes(new Date(`${c}T00:00:00`).getDay())).length;
  const holidayDays = holidays.filter((h) => h.date.startsWith(month)).length;
  const myDays = liveMine.reduce((n, r) => n + cells.filter((c) => c && covers(r, c) && !weekOffDays.includes(new Date(`${c}T00:00:00`).getDay()) && !holidays.some((h) => h.date === c)).length, 0);

  const range = (r: Row) => (r.from === r.to ? `${shortDate(r.from)} (${weekday(r.from)})` : `${shortDate(r.from)} – ${shortDate(r.to)}`);
  const kindLabel = (r: Row) => (r.kind === "holiday" ? "Holiday" : r.kind === "mine" ? "My leave" : "Team");

  async function exportExcel() {
    setExporting("xlsx");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`Leave ${month}`);
      ws.addRow([`Leave & holidays — ${monthLabel(month)}`]).font = { bold: true, size: 13 };
      ws.addRow([`${personLabel} · ${locationLabel}`]);
      ws.addRow([`Holidays: ${holidayDays} · Weekly offs: ${weekOffs} · My leave (working days): ${myDays}`]);
      ws.addRow([]);
      const hr = ws.addRow(["From", "To", "What", "Details", "Status", "Category"]);
      hr.font = { bold: true };
      hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E4" } }; });
      for (const r of rows) ws.addRow([r.from, r.to, r.title, r.sub, r.status ? STATUS_LABEL[r.status] : "", kindLabel(r)]);
      [12, 12, 34, 48, 14, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      const buf = await wb.xlsx.writeBuffer();
      saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Leave_${month}.xlsx`);
    } finally { setExporting(""); }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const { drawLetterhead, drawFooter } = await import("@/lib/pdfBranding");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const startY = await drawLetterhead(doc, `Leave & holidays — ${monthLabel(month)}`, `${personLabel} · ${locationLabel} · Holidays ${holidayDays} · Weekly offs ${weekOffs} · My leave ${myDays} day(s)`);
      autoTable(doc, {
        startY,
        head: [["Date(s)", "What", "Details", "Status"]],
        body: rows.map((r) => [range(r), r.title, r.sub, r.status ? STATUS_LABEL[r.status] : kindLabel(r)]),
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: [90, 156, 78] },
        columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 48 }, 3: { cellWidth: 24 } },
      });
      if (!rows.length) doc.text("Nothing on the calendar this month.", 14, startY + 10);
      drawFooter(doc);
      saveBlob(doc.output("blob"), `Leave_${month}.pdf`);
    } finally { setExporting(""); }
  }

  const sel = picked ? byDay.get(picked) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* ---------------- Calendar ---------------- */}
      <section className="overflow-hidden rounded-3xl border border-biome-line bg-biome-bgSoft" data-testid="leave-calendar">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-biome-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"
              className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted hover:text-biome-text"><ChevronLeft size={15} /></button>
            <h2 className="min-w-[150px] text-center text-[15px] font-semibold tracking-[-.02em] text-biome-text">{monthLabel(month)}</h2>
            <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month"
              className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted hover:text-biome-text"><ChevronRight size={15} /></button>
            {loading && <Loader2 size={14} className="bmx-spin text-biome-muted" />}
          </div>
          <button onClick={() => onMonth(today.slice(0, 7))}
            className="bmx-chip rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted hover:text-biome-text">Today</button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-biome-line/60 text-center">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="bg-biome-bgSoft py-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{d}</div>
          ))}
          {cells.map((c, i) => {
            if (!c) return <div key={`x${i}`} className="min-h-[74px] bg-biome-bg/40" />;
            const info = byDay.get(c)!;
            const off = weekOffDays.includes(new Date(`${c}T00:00:00`).getDay());
            const isToday = c === today;
            const hol = info.hol[0];
            const my = info.mine[0];
            return (
              <button key={c} onClick={() => setPicked(picked === c ? null : c)}
                className={`relative min-h-[74px] p-1.5 text-left align-top transition-colors hover:bg-biome-hover ${
                  hol ? "bg-orange-500/[.09]" : off ? "bg-biome-bg/70" : "bg-biome-bgSoft"} ${picked === c ? "ring-2 ring-inset ring-biome-leaf" : ""}`}>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                  isToday ? "bg-biome-leaf text-white" : off ? "text-biome-muted" : "text-biome-text"}`}>{Number(c.slice(8))}</span>
                {off && !hol && <span className="absolute right-1.5 top-2 text-[8.5px] font-bold uppercase tracking-[.1em] text-biome-muted">Off</span>}
                {hol && (
                  <span className={`mt-0.5 block truncate rounded-md border px-1 py-px text-[9px] font-semibold ${HOLIDAY_CHIP}`} title={hol.name}>{hol.name}</span>
                )}
                {my && (
                  <span title={`${typeLabel(my.type)} · ${STATUS_LABEL[my.status]}`}
                    className={`mt-0.5 block truncate rounded-md border px-1 py-px text-[9px] font-semibold ${toneOf(my.type).chip} ${my.status === "pending" ? "border-dashed" : ""}`}>
                    {toneOf(my.type).label}{my.status === "pending" ? " · waiting" : ""}
                  </span>
                )}
                {info.team.length > 0 && (
                  <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-biome-muted">
                    <Users size={9} /> {info.team.length} away
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-biome-line px-5 py-3">
          <Legend swatch="bg-orange-500" label="Holiday" />
          <Legend swatch="bg-biome-muted/50" label="Weekly off" />
          {Object.entries(TYPE_TONE).map(([k, t]) => <Legend key={k} swatch={t.dot} label={t.label} />)}
          <span className="flex items-center gap-1.5 text-[10px] text-biome-muted"><span className="h-2.5 w-4 rounded border border-dashed border-amber-500" /> Waiting for approval</span>
          <span className="flex items-center gap-1.5 text-[10px] text-biome-muted"><span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-biome-leaf text-[7px] text-white">•</span> Today</span>
        </div>

        {sel && picked && (
          <div className="bmx-msg-in border-t border-biome-line bg-biome-bg/40 px-5 py-3">
            <p className="text-[11.5px] font-semibold text-biome-text">
              {new Date(`${picked}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <div className="mt-1 space-y-0.5 text-[11px] text-biome-text">
              {sel.hol.map((h) => <p key={h.name}>☀ {h.name}{h.note ? ` — ${h.note}` : ""}</p>)}
              {sel.mine.map((r) => <p key={r.id}>• Your {typeLabel(r.type).toLowerCase()} — {STATUS_LABEL[r.status]}</p>)}
              {sel.team.map((r) => <p key={r.id} className="text-biome-muted">• {r.employeeName} ({typeLabel(r.type)}, {STATUS_LABEL[r.status].toLowerCase()})</p>)}
              {!sel.hol.length && !sel.mine.length && !sel.team.length && (
                <p className="text-biome-muted">{weekOffDays.includes(new Date(`${picked}T00:00:00`).getDay()) ? "Weekly off." : "A normal working day."}</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ---------------- The month as a list ---------------- */}
      <section className="flex flex-col rounded-3xl border border-biome-line bg-biome-bgSoft" data-testid="leave-month-list">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-biome-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
            <CalendarDays size={15} className="text-biome-leaf" /> {monthLabel(month)} at a glance
          </h2>
          <div className="flex gap-1.5">
            <button onClick={exportExcel} disabled={!!exporting} title="Download this month as Excel"
              className="bmx-chip flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-50">
              {exporting === "xlsx" ? <Loader2 size={12} className="bmx-spin" /> : <FileSpreadsheet size={12} />} Excel
            </button>
            <button onClick={exportPdf} disabled={!!exporting} title="Download this month as PDF"
              className="bmx-chip flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-50">
              {exporting === "pdf" ? <Loader2 size={12} className="bmx-spin" /> : <FileText size={12} />} PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 px-5 pt-4">
          <Mini label="Holidays" value={holidayDays} tone="text-orange-600" />
          <Mini label="Weekly offs" value={weekOffs} tone="text-biome-text" />
          <Mini label="My leave days" value={myDays} tone="text-sky-600" />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4 xl:max-h-[520px]">
          {rows.length === 0 && (
            <div className="rounded-2xl border border-dashed border-biome-line px-4 py-10 text-center">
              <Sun size={20} className="mx-auto text-biome-muted" />
              <p className="mt-2 text-[12px] font-semibold text-biome-text">Nothing planned this month</p>
              <p className="mt-0.5 text-[10.5px] text-biome-muted">No holidays or leave in {monthLabel(month)}.</p>
            </div>
          )}
          {rows.map((r, i) => {
            const accent = r.kind === "holiday" ? "bg-orange-500" : toneOf(r.type || "").bar;
            return (
              <div key={i} className="flex items-stretch gap-3 rounded-2xl border border-biome-line bg-biome-bg/40 p-3">
                <span className={`w-1 shrink-0 rounded-full ${accent} ${r.kind === "team" ? "opacity-50" : ""}`} />
                <div className="w-[54px] shrink-0 text-center">
                  <p className="text-[18px] font-semibold leading-none text-biome-text">{Number(r.from.slice(8))}</p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">{weekday(r.from)}</p>
                  {r.to !== r.from && <p className="mt-0.5 text-[9px] text-biome-muted">to {shortDate(r.to)}</p>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[12px] font-semibold text-biome-text">{r.title}</p>
                    {r.status && (
                      <span className={`rounded-full border px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[.1em] ${STATUS_CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    )}
                    {r.kind === "team" && <span className="rounded-full border border-biome-line px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[.1em] text-biome-muted">Team</span>}
                  </div>
                  <p className="mt-0.5 truncate text-[10.5px] text-biome-muted" title={r.sub}>{r.sub}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return <span className="flex items-center gap-1.5 text-[10px] text-biome-muted"><span className={`h-2.5 w-2.5 rounded-full ${swatch}`} /> {label}</span>;
}

function Mini({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg/50 px-3 py-2">
      <p className="text-[8.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-[16px] font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
