"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Network } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/** BUSINESS DIGITAL TWIN — live relationship graph: vendors → supplies → clients, vehicles that carried them, POs that govern them. Click any node for its 360° profile. Layered layout (no physics), nodes with open problems glow red. */
const COLOR: Record<string, string> = { vendor: "#f59e0b", supply: "#9fe870", client: "#38bdf8", vehicle: "#a78bfa", plant: "#163300", po: "#f472b6" };
export default function TwinPage() {
  const [d, setD] = useState<any>(null); const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { fetch("/api/twin").then((r) => r.json()).then(setD); }, []);
  const layout = useMemo(() => { if (!d) return null; const cols: Record<string, number> = { vendor: 80, po: 80, vehicle: 260, supply: 440, client: 620, plant: 80 }; const groups: Record<string, any[]> = {}; for (const n of d.nodes) groups[n.type] = [...(groups[n.type] || []), n]; const pos = new Map<string, { x: number; y: number }>(); const H = 60 + 26 * Math.max(...Object.values(groups).map((g) => g.length), 8); const colGroups: Record<number, any[]> = {}; for (const [t, list] of Object.entries(groups)) { colGroups[cols[t] ?? 440] = [...(colGroups[cols[t] ?? 440] || []), ...list]; } for (const [x, list] of Object.entries(colGroups)) list.forEach((n, i) => pos.set(n.id, { x: Number(x), y: 30 + ((i + 0.5) * (H - 40)) / list.length })); return { pos, H }; }, [d]);
  if (!d || !layout) return <div className="flex justify-center py-24"><Loader2 size={24} className="bmx-spin text-biome-muted" /></div>;
  const connected = new Set<string>(); if (focus) for (const e of d.edges) { if (e.from === focus) connected.add(e.to); if (e.to === focus) connected.add(e.from); }
  const hrefFor = (n: any) => n.type === "po" ? "/po" : `/entity?type=${n.type === "supply" ? "supply" : n.type}&key=${encodeURIComponent(n.label)}`;
  return (
    <div className="space-y-5">
      <header><p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p><h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">Digital Twin<span className="text-biome-leafBright">.</span></h1><p className="mt-2 text-[12px] text-biome-muted">Vendors → supplies → clients, the vehicles that carried them and the POs that govern them. Click a node to isolate its ecosystem; double-click to open its 360°.</p></header>
      <div className="flex flex-wrap gap-2 text-[10px] text-biome-muted">{Object.entries(COLOR).map(([k, c]) => <span key={k}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{k} · {d.nodes.filter((n: any) => n.type === k).length}</span>)}</div>
      <GlassCard className="overflow-auto p-2"><svg viewBox={`0 0 720 ${layout.H}`} className="w-full" style={{ minHeight: 420 }}>
        {d.edges.map((e: any, i: number) => { const a = layout.pos.get(e.from), b = layout.pos.get(e.to); if (!a || !b) return null; const dim = focus && e.from !== focus && e.to !== focus; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.status === "shortage" ? "#f43f5e" : "rgb(var(--c-line))"} strokeWidth={Math.max(0.6, Math.min(3, e.weight / 15000))} opacity={dim ? 0.08 : 0.7} />; })}
        {d.nodes.map((n: any) => { const p = layout.pos.get(n.id); if (!p) return null; const dim = focus && focus !== n.id && !connected.has(n.id); return <g key={n.id} onClick={() => setFocus(focus === n.id ? null : n.id)} onDoubleClick={() => (window.location.href = hrefFor(n))} style={{ cursor: "pointer" }} opacity={dim ? 0.15 : 1}><circle cx={p.x} cy={p.y} r={n.alert ? 8 : 6} fill={COLOR[n.type] || "#888"} stroke={n.alert ? "#f43f5e" : "rgb(var(--c-bg))"} strokeWidth={n.alert ? 2.5 : 1.5} />{n.alert && <circle cx={p.x} cy={p.y} r={12} fill="#f43f5e" opacity={0.18} />}<text x={p.x + 10} y={p.y + 3} fontSize={8} fill="rgb(var(--c-text))">{String(n.label).slice(0, 22)}</text></g>; })}
      </svg></GlassCard>
      {focus && <GlassCard className="p-4"><p className="text-[12px] font-semibold text-biome-text">{d.nodes.find((n: any) => n.id === focus)?.label} · {connected.size} connections</p><div className="mt-2 flex flex-wrap gap-1.5">{[...connected].map((id) => { const n = d.nodes.find((x: any) => x.id === id); return n ? <Link key={id} href={hrefFor(n)} className="rounded-full border border-biome-line px-2.5 py-1 text-[10.5px] text-biome-text"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLOR[n.type] }} />{n.label}</Link> : null; })}</div></GlassCard>}
      <p className="flex items-center gap-1.5 text-[10px] text-biome-muted"><Network size={11} /> Built from the last 300 coordination trips and all POs; red halo = open task or shortage.</p>
    </div>);
}
