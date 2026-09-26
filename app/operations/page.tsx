"use client";

import { useCallback, useEffect, useState } from "react";
import { Map, Loader2, Truck, AlertTriangle, RefreshCcw } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * LIVE OPERATIONS BOARD — a schematic, animated view of what is moving.
 * Left column: vendors and plants (where loads leave). Right column:
 * clients (where they arrive). A truck travels along each edge in
 * proportion to days-out vs the client's typical transit; past the
 * expected time it turns amber, past 3 days red. Honest scope: there is
 * no GPS in the business — this is what the paperwork proves.
 */

export default function OpsMapPage() {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => { const r = await fetch("/api/ops-map", { cache: "no-store" }); setD(await r.json()); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (!d) return <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>;

  const origins: string[] = [...new Set<string>([...d.plants.map((p: any) => p.label), ...d.vendors])];
  const dests: string[] = d.clients;
  const W = 900, H = Math.max(360, 70 * Math.max(origins.length, dests.length) + 60);
  const yFor = (list: string[], name: string) => 50 + (list.indexOf(name) + 0.5) * ((H - 60) / Math.max(1, list.length));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Operations<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 text-[12px] text-biome-muted">Every load in motion, its expected arrival, and what is late — refreshed every minute from coordination.</p>
        </div>
        <button onClick={load} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted"><RefreshCcw size={13} /> Refresh</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[["In transit", d.stats.inTransit, "text-sky-500"], ["Delayed", d.stats.delayed, "text-rose-500"], ["Received · 7 days", d.stats.receivedLast7d, "text-emerald-500"]].map(([l, v, c]) => (
          <div key={l as string} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l as string}</p><p className={`mt-1 font-mono text-[30px] font-semibold ${c as string}`}>{v as number}</p></div>
        ))}
      </div>

      <GlassCard className="overflow-hidden p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 320 }}>
          <defs><style>{`@keyframes drift { from { transform: translateX(0) } to { transform: translateX(6px) } }`}</style></defs>
          {/* origins */}
          {origins.map((o) => { const y = yFor(origins, o); const isPlant = d.plants.some((p: any) => p.label === o); return (
            <g key={o}><rect x={20} y={y - 16} width={200} height={32} rx={16} fill={isPlant ? "#163300" : "rgb(var(--c-surface))"} stroke="rgb(var(--c-line))" />
              <text x={120} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={isPlant ? "#9fe870" : "rgb(var(--c-text))"}>{o.slice(0, 26)}</text></g>); })}
          {/* destinations */}
          {dests.map((c) => { const y = yFor(dests, c); return (
            <g key={c}><rect x={W - 220} y={y - 16} width={200} height={32} rx={16} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-line))" />
              <text x={W - 120} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgb(var(--c-text))">{c.slice(0, 26)}</text></g>); })}
          {/* moving loads */}
          {d.moving.map((m: any, i: number) => {
            const y1 = yFor(origins, origins.includes(m.from) ? m.from : origins[0]); const y2 = yFor(dests, dests.includes(m.to) ? m.to : dests[0]);
            const x1 = 220, x2 = W - 220; const prog = Math.min(0.92, Math.max(0.06, m.daysOut / Math.max(1, m.etaDays + 1)));
            const px = x1 + (x2 - x1) * prog, py = y1 + (y2 - y1) * prog;
            const color = m.delayed ? "#f43f5e" : m.daysOut > m.etaDays ? "#f59e0b" : "#9fe870";
            return (
              <g key={m.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--c-line))" strokeDasharray="4 6" />
                <g style={{ animation: `drift 1.2s ease-in-out ${i * 0.15}s infinite alternate` }}>
                  <circle cx={px} cy={py} r={13} fill={color} opacity={0.18} />
                  <circle cx={px} cy={py} r={7} fill={color} />
                  <text x={px} y={py - 14} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="rgb(var(--c-text))">{m.vehicle}</text>
                  <text x={px} y={py + 24} textAnchor="middle" fontSize={9} fill="rgb(var(--c-muted))">{m.delayed ? `LATE · ${m.daysOut}d` : `${m.daysOut}d / ETA ${m.etaDays}d`}</text>
                </g>
              </g>
            );
          })}
          {d.moving.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={13} fill="rgb(var(--c-muted))">Nothing in transit — dispatched trips without a receiving appear here.</text>}
        </svg>
      </GlassCard>

      {d.moving.some((m: any) => m.delayed) && (
        <div className="space-y-1.5">
          <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Delay alerts</p>
          {d.moving.filter((m: any) => m.delayed).map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/[.06] px-4 py-2.5 text-[11.5px] text-biome-text">
              <AlertTriangle size={14} className="text-rose-500" /> <Truck size={13} className="text-biome-muted" /> {m.vehicle} · {m.from} → {m.to} · dispatched {m.dispatched} · {m.daysOut} days out (typical {m.etaDays}) · {m.weightKg ? `${m.weightKg.toLocaleString("en-IN")} kg` : ""}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-biome-muted">Schematic, not GPS: positions are days-out versus the client's typical transit. Delayed loads also appear as Coordination tasks in Work.</p>
    </div>
  );
}
