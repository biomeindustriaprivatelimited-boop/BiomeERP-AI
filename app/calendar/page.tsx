"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * CALENDAR — one month grid for everything with a date: task due dates
 * (from the Work Engine), leave (pending/approved), holidays, and the
 * month-end window. Days carrying 3+ critical/urgent items are flagged
 * as conflicts, with the suggestion to spread them.
 */

interface Item { date: string; kind: "task" | "leave" | "holiday" | "monthend"; label: string; tone: string; href: string; weight: number }

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar?month=${cursor.toISOString().slice(0, 7)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setItems(json.items || []); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [cursor]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1); const lead = (first.getDay() + 6) % 7; // Monday-first
    const count = new Date(y, m + 1, 0).getDate();
    const out: { date: string | null; day: number }[] = [];
    for (let i = 0; i < lead; i++) out.push({ date: null, day: 0 });
    for (let d = 1; d <= count; d++) out.push({ date: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d });
    return out;
  }, [cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items || []) map.set(it.date, [...(map.get(it.date) || []), it]);
    return map;
  }, [items]);

  const conflicts = useMemo(() => [...byDate.entries()].filter(([, its]) => its.filter((i) => i.weight >= 2).length >= 3), [byDate]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Calendar<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">Due dates, leave, holidays and month-end on one grid. Crowded days are flagged.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="bmx-chip flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line text-biome-muted"><ChevronLeft size={15} /></button>
          <p className="min-w-[150px] text-center text-[13px] font-bold text-biome-text">{cursor.toLocaleString("en-IN", { month: "long", year: "numeric" })}</p>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="bmx-chip flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line text-biome-muted"><ChevronRight size={15} /></button>
        </div>
      </header>

      {err && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{err}</p>}

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[.06] px-4 py-3">
          {conflicts.map(([d, its]) => (
            <p key={d} className="flex items-center gap-1.5 text-[11.5px] text-amber-600"><AlertTriangle size={13} /> {its.filter((i) => i.weight >= 2).length} critical/urgent items fall on {d} — spread them across the week, or delegate from Work.</p>
          ))}
        </div>
      )}

      {!items && !err ? <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div> : (
        <GlassCard className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <p key={d} className="px-2 py-1 text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{d}</p>)}
            {days.map((d, i) => {
              const its = d.date ? byDate.get(d.date) || [] : [];
              const heavy = its.filter((x) => x.weight >= 2).length >= 3;
              return (
                <div key={i} className={`min-h-[96px] rounded-xl border p-1.5 ${!d.date ? "border-transparent" : heavy ? "border-amber-500/40 bg-amber-500/[.05]" : d.date === todayStr ? "border-biome-leaf/50 bg-biome-leaf/[.06]" : "border-biome-line bg-biome-bg"}`}>
                  {d.date && <p className={`text-[10.5px] font-bold ${d.date === todayStr ? "text-biome-leafBright" : "text-biome-muted"}`}>{d.day}</p>}
                  <div className="mt-1 space-y-0.5">
                    {its.slice(0, 4).map((it, j) => (
                      <Link key={j} href={it.href} title={it.label} className={`block truncate rounded-md border px-1.5 py-0.5 text-[9.5px] ${it.tone}`}>{it.label}</Link>
                    ))}
                    {its.length > 4 && <p className="px-1 text-[9px] text-biome-muted">+{its.length - 4} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[9.5px] text-biome-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />Critical/urgent task</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-400" />Task</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-400" />Leave</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Holiday</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />Month-end</span>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
