"use client";

import { useCallback, useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import Link from "next/link";
import { Package, Plus, Loader2, AlertTriangle, RefreshCcw, Settings2, X, TrendingDown, Mail, FileUp, CheckCircle2 } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import DevEditedChip from "@/components/DevEditedChip";
import { useSession } from "@/lib/session";

/**
 * PO CONTROL CENTER — vendor purchase orders and client POs / work
 * orders with balances computed live from linked supplies. Nobody
 * reconciles a quantity by hand here; the sum is recomputed every time.
 */

const mt = (kg: number) => `${(kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} MT`;
const STATUS: Record<string, string> = { active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", low_balance: "border-orange-500/40 bg-orange-500/10 text-orange-500", exhausted: "border-rose-500/40 bg-rose-500/10 text-rose-500", expired: "border-rose-500/40 bg-rose-500/10 text-rose-500", draft: "border-biome-line text-biome-muted", closed: "border-biome-line text-biome-muted", cancelled: "border-biome-line text-biome-muted" };
const LEVEL: Record<string, string> = { critical: "🔴", high: "🟠", warning: "🟡", info: "🟢" };

export default function PoPage() {
  const { can } = useSession();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"dashboard" | "alerts" | "vendor" | "client" | "analytics" | "settings">("dashboard");
  const [creating, setCreating] = useState<"vendor" | "client" | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [alertFilter, setAlertFilter] = useState("all");

  const load = useCallback(async () => {
    try { const r = await fetch("/api/po", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "analytics") fetch("/api/po?view=analytics").then((r) => r.json()).then(setAnalytics); }, [tab]);

  async function post(body: Record<string, any>) {
    const r = await fetch("/api/po", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error || "Failed."); return null; }
    setErr(null); await load(); return j;
  }

  const pos: any[] = d?.pos || [];
  const sum = (list: any[], k: string) => list.reduce((s, p) => s + (p[k] || 0), 0);
  const totalKg = (p: any) => (p.unit === "MT" ? p.totalQuantity * 1000 : p.totalQuantity);
  const activeV = pos.filter((p) => p.type === "vendor" && ["active", "low_balance"].includes(p.effectiveStatus));
  const activeC = pos.filter((p) => p.type === "client" && ["active", "low_balance"].includes(p.effectiveStatus));
  const alerts = pos.flatMap((p) => p.alerts.map((a: any) => ({ ...a, po: p }))).filter((a) => alertFilter === "all" || a.kind === alertFilter || a.po.type === alertFilter || a.level === alertFilter);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">PO Control<span className="text-biome-leafBright">.</span></h1>
          <p className="mt-2 max-w-2xl text-[12px] text-biome-muted">Vendor purchase orders and client POs with balances computed live from linked supplies — cancellations and corrections recalculate by themselves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => post({ action: "sync" })} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted"><RefreshCcw size={13} /> Sync alerts</button>
          <button onClick={() => setCreating("vendor")} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted"><Plus size={13} /> Vendor PO</button>
          <button onClick={() => setCreating("client")} className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white"><Plus size={14} /> Client PO</button>
        </div>
      </header>
      {err && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{err}</p>}
      {!d && !err && <div className="flex justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>}

      {d && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {([["dashboard", "Dashboard"], ["alerts", `Alerts · ${pos.flatMap((p) => p.alerts).length}`], ["vendor", "Vendor POs"], ["client", "Client POs"], ["analytics", "Analytics"], ["settings", "Settings"]] as const).map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} className={`bmx-chip rounded-full border px-3.5 py-2 text-[11px] font-semibold ${tab === id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}>{l}</button>
            ))}
          </div>

          {tab === "dashboard" && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                {[["Active vendor POs", activeV], ["Active client POs", activeC]].map(([label, list]) => (
                  <GlassCard key={label as string} className="p-5">
                    <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">{label as string} · {(list as any[]).length}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      {[["Total", (list as any[]).reduce((s, p) => s + totalKg(p), 0)], ["Consumed", sum(list as any[], "consumedKg")], ["Remaining", sum(list as any[], "remainingKg")]].map(([l, v]) => (
                        <div key={l as string} className="rounded-xl border border-biome-line bg-biome-bg p-3"><p className="text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">{l as string}</p><p className="mt-1 font-mono text-[14px] font-semibold text-biome-text">{mt(v as number)}</p></div>
                      ))}
                    </div>
                  </GlassCard>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[["Low balance", pos.filter((p) => p.effectiveStatus === "low_balance").length, "text-orange-500"], ["Exhausted", pos.filter((p) => p.effectiveStatus === "exhausted").length, "text-rose-500"], ["Expiring · 30d", pos.filter((p) => p.daysToExpiry !== null && p.daysToExpiry >= 0 && p.daysToExpiry <= 30 && p.effectiveStatus !== "exhausted").length, "text-amber-500"], ["High-risk (predicted ≤7d)", pos.filter((p) => p.predictedExhaustionDays !== null && p.predictedExhaustionDays <= 7).length, "text-rose-500"]].map(([l, v, c]) => (
                  <div key={l as string} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l as string}</p><p className={`mt-1 font-mono text-[28px] font-semibold ${c as string}`}>{v as number}</p></div>
                ))}
              </div>
              <div className="space-y-1.5">{pos.slice(0, 12).map((p) => <PoRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}</div>
            </div>
          )}

          {tab === "alerts" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">{["all", "vendor", "client", "low_balance", "utilisation", "critical", "exhausted", "expiry", "predicted"].map((f) => <button key={f} onClick={() => setAlertFilter(f)} className={`bmx-chip rounded-full border px-3 py-1.5 text-[10.5px] font-semibold ${alertFilter === f ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted"}`}>{f.replace("_", " ")}</button>)}</div>
              {alerts.length === 0 && <GlassCard className="p-6"><p className="text-[11.5px] text-biome-muted">No PO alerts.</p></GlassCard>}
              {alerts.map((a, i) => (
                <div key={i} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
                  <p className="text-[12.5px] font-semibold text-biome-text">{LEVEL[a.level]} {a.title}</p>
                  <p className="mt-0.5 text-[11px] text-biome-muted">{a.detail} · {a.po.utilisationPct}% used · consumed {mt(a.po.consumedKg)} · remaining {mt(a.po.remainingKg)}{a.po.expiryDate ? ` · expiry ${a.po.expiryDate}` : ""}</p>
                  <p className="mt-1 text-[11px] text-biome-leafBright">→ {a.action}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => setOpen(a.po)} className="bmx-chip rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted">Open PO</button>
                    <Link href={`/entity?type=${a.po.type}&key=${encodeURIComponent(a.po.partyName)}`} className="bmx-chip rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted">Open {a.po.type}</Link>
                    <Link href="/coordination" className="bmx-chip rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted">View supplies</Link>
                    <button onClick={() => post({ action: "renewal", id: a.po.id })} className="bmx-chip rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted">Start renewal</button>
                    <button onClick={() => post({ action: "reviewed", id: a.po.id, key: a.key })} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted"><CheckCircle2 size={11} /> Mark reviewed</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(tab === "vendor" || tab === "client") && <div className="space-y-1.5">{pos.filter((p) => p.type === tab).map((p) => <PoRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}{pos.filter((p) => p.type === tab).length === 0 && <GlassCard className="p-6"><p className="text-[11.5px] text-biome-muted">No {tab} POs yet.</p></GlassCard>}</div>}

          {tab === "analytics" && (
            <div className="grid gap-3 md:grid-cols-2">
              {!analytics ? <Loader2 size={18} className="bmx-spin text-biome-muted" /> : (<>
                {[["By vendor", analytics.vendors], ["By client", analytics.clients]].map(([l, list]) => (
                  <GlassCard key={l as string} className="p-4"><p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">{l as string}</p>
                    <table className="mt-2 w-full text-left text-[11px]"><thead><tr className="text-[9px] uppercase tracking-[.1em] text-biome-muted"><th className="py-1">Party</th><th>POs</th><th>Total</th><th>Consumed</th><th>Used</th></tr></thead>
                      <tbody>{(list as any[]).map((x) => <tr key={x.party} className="border-t border-biome-line/60 text-biome-text"><td className="py-1.5">{x.party}</td><td className="font-mono">{x.count}</td><td className="font-mono">{mt(x.total)}</td><td className="font-mono">{mt(x.consumed)}</td><td className="font-mono">{x.utilisationPct}%</td></tr>)}</tbody></table></GlassCard>
                ))}
                <GlassCard className="p-4 md:col-span-2"><p className="text-[11.5px] text-biome-text">Average days to exhaust: <b>{analytics.avgDaysToExhaust ?? "—"}</b> · Unused quantity at expiry: <b>{mt(analytics.unusedAtExpiryKg)}</b> · Over-consumption attempts: <b>{analytics.overConsumptionAttempts}</b></p></GlassCard>
              </>)}
            </div>
          )}

          {tab === "settings" && <PoSettings config={d.config} canEdit={can("settings")} onSave={(c) => post({ action: "config", config: c })} />}
        </>
      )}

      {creating && <CreatePo type={creating} vendors={d?.vendors || []} clients={d?.clients || []} config={d?.config} onClose={() => setCreating(null)} onCreate={async (b) => { const r = await post({ action: "create", type: creating, ...b }); if (r) setCreating(null); }} />}
      {open && <PoSheet p={pos.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} onPost={post} />}
    </div>
  );
}

function PoRow({ p, onOpen }: { p: any; onOpen: () => void }) {
  const pct = Math.min(100, p.utilisationPct);
  const bar = p.effectiveStatus === "exhausted" ? "bg-rose-500" : pct >= 90 ? "bg-orange-500" : pct >= 75 ? "bg-amber-400" : "bg-biome-leaf";
  return (
    <button onClick={onOpen} className="bmx-card w-full rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <Package size={14} className="text-biome-leafBright" />
        <span className="text-[12.5px] font-semibold text-biome-text">{p.partyName} · {p.poNumber}</span>
        <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase text-biome-muted">{p.type}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS[p.effectiveStatus]}`}>{p.effectiveStatus.replace("_", " ")}</span>
        <DevEditedChip mark={p.devEdited} compact />
        <span className="ml-auto font-mono text-[11px] text-biome-muted">{p.utilisationPct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-biome-line"><div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-[10.5px] text-biome-muted">{mt(p.consumedKg)} consumed · {mt(p.remainingKg)} remaining of {mt(p.unit === "MT" ? p.totalQuantity * 1000 : p.totalQuantity)} · {p.linkedTrips} supplies{p.predictedExhaustionDays !== null ? ` · est. exhaustion ${p.predictedExhaustionDays}d` : ""}{p.daysToExpiry !== null ? ` · expiry in ${p.daysToExpiry}d` : ""}</p>
    </button>
  );
}

function CreatePo({ type, vendors, clients, config, onClose, onCreate }: { type: "vendor" | "client"; vendors: any[]; clients: string[]; config: any; onClose: () => void; onCreate: (b: any) => Promise<void> }) {
  const [f, setF] = useState({ partyKey: "", partyName: "", poNumber: "", workOrderNumber: "", poDate: new Date().toISOString().slice(0, 10), material: "Biomass", totalQuantity: "", unit: "MT", rate: "", value: "", startDate: new Date().toISOString().slice(0, 10), expiryDate: "", minRemainingMt: String((config?.defaultMinRemainingKg || 500000) / 1000), notes: "", status: "active" });
  const [busy, setBusy] = useState(false);
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-xl overflow-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-biome-text">New {type} PO</h3><button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {type === "vendor" ? (
            <select value={f.partyKey} onChange={(e) => { const v = vendors.find((x) => x.key === e.target.value); setF({ ...f, partyKey: e.target.value, partyName: v?.name || "" }); }} className={`${input} sm:col-span-2`}><option value="">Choose vendor (from Registration)…</option>{vendors.map((v) => <option key={v.key} value={v.key}>{v.name} ({v.key})</option>)}</select>
          ) : (
            <input list="po-clients" value={f.partyName} onChange={(e) => setF({ ...f, partyName: e.target.value, partyKey: e.target.value })} placeholder="Client name" className={`${input} sm:col-span-2`} />
          )}
          <datalist id="po-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          <input value={f.poNumber} onChange={(e) => setF({ ...f, poNumber: e.target.value })} placeholder="PO number" className={input} />
          {type === "client" && <input value={f.workOrderNumber} onChange={(e) => setF({ ...f, workOrderNumber: e.target.value })} placeholder="Work order no (optional)" className={input} />}
          <input type="date" value={f.poDate} onChange={(e) => setF({ ...f, poDate: e.target.value })} className={input} />
          <input value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} placeholder="Material" className={input} />
          <div className="flex gap-1.5"><input type="number" value={f.totalQuantity} onChange={(e) => setF({ ...f, totalQuantity: e.target.value })} placeholder="Total quantity" className={input} /><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={`${input} w-24`}><option value="MT">MT</option><option value="KG">KG</option></select></div>
          <input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="Rate ₹/MT (optional)" className={input} />
          <input type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="PO value ₹ (optional)" className={input} />
          <label className="block"><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">Start</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={input} /></label>
          <label className="block"><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">Expiry</span><input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} className={input} /></label>
          <input type="number" value={f.minRemainingMt} onChange={(e) => setF({ ...f, minRemainingMt: e.target.value })} placeholder="Alert below (MT)" className={input} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={input}><option value="active">Active</option><option value="draft">Draft</option></select>
          <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes" className={`${input} resize-none sm:col-span-2`} />
        </div>
        <p className="mt-2 text-[10px] text-biome-muted">Thresholds {config?.defaultThresholds?.join("% / ")}% apply by default; consumption is computed from supplies linked in Coordination.</p>
        <button disabled={busy || !f.partyName || !f.poNumber || !f.totalQuantity} onClick={async () => { setBusy(true); await onCreate(f); setBusy(false); }} className="bmx-btn mt-3 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Create PO"}</button>
      </div>
    </div></Portal>
  );
}

function PoSheet({ p, onClose, onPost }: { p: any; onClose: () => void; onPost: (b: any) => Promise<any> }) {
  const [adj, setAdj] = useState({ totalQuantity: String(p.totalQuantity), expiryDate: p.expiryDate || "", reason: "" });
  const [busy, setBusy] = useState(false);
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card max-h-[92vh] w-full max-w-2xl overflow-auto rounded-3xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-start justify-between gap-2"><div><h3 className="text-[15px] font-bold text-biome-text">{p.partyName} · {p.poNumber}</h3><p className="text-[10.5px] text-biome-muted">{p.type} PO · {p.material} · {p.poDate} → {p.expiryDate || "no expiry"} · <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS[p.effectiveStatus]}`}>{p.effectiveStatus.replace("_", " ")}</span></p></div><button onClick={onClose} className="bmx-chip flex h-8 w-8 items-center justify-center rounded-lg border border-biome-line text-biome-muted"><X size={14} /></button></div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[["PO quantity", mt(p.unit === "MT" ? p.totalQuantity * 1000 : p.totalQuantity)], ["Consumed", mt(p.consumedKg)], ["Remaining", mt(p.remainingKg)], ["Utilisation", `${p.utilisationPct}%`]].map(([l, v]) => <div key={l} className="rounded-xl border border-biome-line bg-biome-bg p-3"><p className="text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">{l}</p><p className="mt-1 font-mono text-[14px] font-semibold text-biome-text">{v}</p></div>)}
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-biome-line"><div className={`h-full rounded-full ${p.effectiveStatus === "exhausted" ? "bg-rose-500" : p.utilisationPct >= 90 ? "bg-orange-500" : "bg-biome-leaf"}`} style={{ width: `${Math.min(100, p.utilisationPct)}%` }} /></div>
        {p.predictedExhaustionDays !== null && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600"><TrendingDown size={12} /> ESTIMATED PO EXHAUSTION: <b>{p.predictedExhaustionDays} days</b> · confidence {p.predictionConfidence} · ~{mt(p.avgDailyKg)}/day (prediction, not the expiry date)</p>}
        {p.alerts.length > 0 && <ul className="mt-2 space-y-1">{p.alerts.map((a: any) => <li key={a.key} className="text-[11px] text-biome-text">{LEVEL[a.level]} {a.title} — <span className="text-biome-muted">{a.action}</span></li>)}</ul>}

        <p className="mt-4 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Adjust (reason required · audited)</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          <input type="number" value={adj.totalQuantity} onChange={(e) => setAdj({ ...adj, totalQuantity: e.target.value })} placeholder={`Total (${p.unit})`} className={input} />
          <input type="date" value={adj.expiryDate} onChange={(e) => setAdj({ ...adj, expiryDate: e.target.value })} className={input} />
          <input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Reason" className={input} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button disabled={busy || !adj.reason} onClick={async () => { setBusy(true); await onPost({ action: "adjust", id: p.id, totalQuantity: Number(adj.totalQuantity), expiryDate: adj.expiryDate, reason: adj.reason }); setBusy(false); }} className="bmx-btn rounded-xl bg-biome-leaf px-4 py-2 text-[11px] font-bold text-white disabled:opacity-50">Save adjustment</button>
          <label className="bmx-chip flex cursor-pointer items-center gap-1 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><FileUp size={12} /> {p.attachment ? p.attachment.name : "Attach PO document"}<input type="file" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); }); await onPost({ action: "attach", id: p.id, fileBase64: b64, fileName: file.name }); }} /></label>
          <button onClick={() => onPost({ action: "renewal", id: p.id })} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Start renewal / extension</button>
          {p.manualStatus !== "closed" && <button onClick={() => { const r = window.prompt("Reason for closing:"); if (r !== null) onPost({ action: "status", id: p.id, status: "closed", reason: r }); }} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Close</button>}
          {p.manualStatus && <button onClick={() => onPost({ action: "status", id: p.id, status: "active" })} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Re-activate</button>}
        </div>
        {p.adjustments.length > 0 && (<><p className="mt-4 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Adjustment history</p><ul className="mt-1 space-y-0.5">{p.adjustments.slice().reverse().map((a: any, i: number) => <li key={i} className="text-[10.5px] text-biome-text"><span className="text-biome-muted">{new Date(a.at).toLocaleString("en-IN")} · {a.byName}:</span> {a.field} {a.oldValue} → {a.newValue} — {a.reason}</li>)}</ul></>)}
        <p className="mt-3 text-[10px] text-biome-muted">Consumption = sum of linked, non-cancelled supplies ({p.type === "vendor" ? "vendor challan weight" : "invoiced → received → dispatched weight"}). Link supplies from Coordination.</p>
      </div>
    </div></Portal>
  );
}

function PoSettings({ config, canEdit, onSave }: { config: any; canEdit: boolean; onSave: (c: any) => Promise<any> }) {
  const [c, setC] = useState({ ...config, defaultMinRemainingMt: (config.defaultMinRemainingKg || 0) / 1000, recipients: { vendorExhausted: (config.recipients?.vendorExhausted || []).join(", "), clientExhausted: (config.recipients?.clientExhausted || []).join(", "), lowBalance: (config.recipients?.lowBalance || []).join(", "), expiry: (config.recipients?.expiry || []).join(", ") } });
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
  return (
    <GlassCard className="p-5">
      <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted"><Settings2 size={12} /> PO alert &amp; policy settings {!canEdit && "(read-only)"}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">When a supply exceeds the PO balance</span>
          <select value={c.overConsumption} onChange={(e) => setC({ ...c, overConsumption: e.target.value })} disabled={!canEdit} className={input}><option value="block">Hard block creation</option><option value="approve">Allow with manager (finance) approval / override</option><option value="exception">Allow, record a high-risk exception</option></select></label>
        <label className="block"><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">Default alert below (MT remaining)</span><input type="number" value={c.defaultMinRemainingMt} onChange={(e) => setC({ ...c, defaultMinRemainingMt: Number(e.target.value) })} disabled={!canEdit} className={input} /></label>
        {(["vendorExhausted", "clientExhausted", "lowBalance", "expiry"] as const).map((k) => (
          <label key={k} className="block"><span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted"><Mail size={10} className="mr-1 inline" />{k.replace(/([A-Z])/g, " $1")} recipients (comma-separated)</span><input value={(c.recipients as any)[k]} onChange={(e) => setC({ ...c, recipients: { ...c.recipients, [k]: e.target.value } })} disabled={!canEdit} placeholder="accounts@…, manager@… (blank = all accounts/admin logins with email)" className={input} /></label>
        ))}
        <label className="flex items-center gap-2 text-[11.5px] text-biome-text"><input type="checkbox" checked={Boolean(c.emailOnLowBalance)} onChange={(e) => setC({ ...c, emailOnLowBalance: e.target.checked })} disabled={!canEdit} /> Email on low-balance / predicted exhaustion</label>
        <label className="flex items-center gap-2 text-[11.5px] text-biome-text"><input type="checkbox" checked={Boolean(c.emailOnExpiry)} onChange={(e) => setC({ ...c, emailOnExpiry: e.target.checked })} disabled={!canEdit} /> Email on expiry warnings</label>
      </div>
      <p className="mt-3 text-[10px] text-biome-muted">Exhaustion emails are always sent (once per PO) to the configured accounts recipients. Thresholds {config.defaultThresholds?.join("% / ")}% · expiry alerts at {config.expiryAlertDays?.join(" / ")} days.</p>
      {canEdit && <button onClick={() => onSave(c)} className="bmx-btn mt-3 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">Save settings</button>}
    </GlassCard>
  );
}
