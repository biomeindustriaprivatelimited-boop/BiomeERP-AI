"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, LayoutDashboard, ClipboardList, FileText, PackageCheck, PackageMinus, Cog, Wrench, ListPlus, BarChart3, Loader2 } from "lucide-react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { Msg } from "@/components/spares/ui";
import { Dashboard, IndentsTab, PoTab, GrnTab } from "@/components/spares/PurchaseTabs";
import { StockTab, MovesTab, MachinesTab, ItemsTab } from "@/components/spares/StoresTabs";
import { MaintenanceTab, ReportsTab } from "@/components/spares/MaintenanceTab";

/**
 * Spare parts & machinery — procurement's module.
 *
 *   Dashboard      open requirements, open POs, GRNs to match, low stock, PM due
 *   Requirements   indents from the plants → approve / reject / make a PO
 *   Purchase orders draft → issued (PDF, email) → partially received → closed
 *   Goods receipt  record what came against the PO, see the match, Match & OK
 *   Stock          on hand per plant, on order, in transit, re-order status
 *   Issue & moves  issue slip, ledger, transfers (in transit), adjustments (approval)
 *   Machines       asset register: make, serial, warranty, hour meter, linked parts
 *   Maintenance    preventive schedule + job log (parts auto-issued, downtime, cost)
 *   Items          part master: part no, fits machines, re-order level & bin per plant
 *   Reports        vendor-wise and machine-wise spend (Excel)
 */

type Tab = "dashboard" | "indents" | "pos" | "grn" | "stock" | "moves" | "machines" | "maintenance" | "items" | "reports";

export default function SparesPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [seed, setSeed] = useState<any>(null);
  const [plant, setPlant] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/stock${plant ? `?plant=${plant}` : ""}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load spare parts."); return; }
    setData(json);
  }, [plant]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load());

  async function post(url: string, body: any): Promise<any | null> {
    setErr(null); setOk(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || `Failed (${res.status}).`); return null; }
    await load();
    return json;
  }
  const go = (t: string, payload?: any) => { setTab(t as Tab); setSeed(payload || null); setErr(null); setOk(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (!data) return err ? <Msg err={err} ok={null} /> : <div className="flex items-center gap-2 text-[12px] text-biome-muted"><Loader2 size={14} className="bmx-spin" /> Loading spare parts…</div>;

  const s = data.summary;
  const tabs: { id: Tab; label: string; icon: any; count?: number; hot?: boolean }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "indents", label: "Requirements", icon: ClipboardList, count: s.openIndents, hot: s.urgentIndents > 0 },
    { id: "pos", label: "Purchase orders", icon: FileText, count: s.openPos + s.draftPos },
    { id: "grn", label: "Goods receipt", icon: PackageCheck, count: s.pendingGrns, hot: s.pendingGrns > 0 },
    { id: "stock", label: "Stock", icon: Boxes, count: s.low + s.out, hot: s.low + s.out > 0 },
    { id: "moves", label: "Issue & moves", icon: PackageMinus, count: s.inTransit + s.pendingAdjust },
    { id: "machines", label: "Machines", icon: Cog },
    { id: "maintenance", label: "Maintenance", icon: Wrench, count: s.maintenanceDue + s.maintenanceOverdue, hot: s.maintenanceOverdue > 0 },
    { id: "items", label: "Items", icon: ListPlus },
    { id: "reports", label: "Reports", icon: BarChart3 },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Boxes size={19} className="text-biome-leaf" /> Spare parts &amp; machinery
          </h1>
          <p className="mt-1 max-w-[760px] text-[11.5px] leading-relaxed text-biome-muted">
            Plant requirement → purchase order → goods receipt matched against the PO → <b>Match &amp; OK</b> → stock. Then issue to machines,
            keep every machine’s maintenance on schedule, and see where the money goes. Balances are calculated from the entries every time.
          </p>
        </div>
        {data.plants.length > 1 && (
          <select aria-label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text">
            <option value="">All plants</option>
            {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
          </select>
        )}
      </header>

      <nav className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}
            className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold ${tab === t.id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
            <t.icon size={13} /> {t.label}
            {!!t.count && <span className={`rounded-full px-1.5 text-[9.5px] font-bold ${t.hot ? "bg-rose-500 text-white" : "bg-biome-line text-biome-text"}`}>{t.count}</span>}
          </button>
        ))}
      </nav>

      <Msg err={err} ok={ok} />

      {tab === "dashboard" && <Dashboard data={data} go={go} />}
      {tab === "indents" && <IndentsTab data={data} post={post} setOk={setOk} go={go} />}
      {tab === "pos" && <PoTab data={data} post={post} setOk={setOk} setErr={setErr} go={go} seed={seed} clearSeed={() => setSeed(null)} />}
      {tab === "grn" && <GrnTab data={data} post={post} setOk={setOk} seed={seed} clearSeed={() => setSeed(null)} reload={load} />}
      {tab === "stock" && <StockTab data={data} />}
      {tab === "moves" && <MovesTab data={data} post={post} setOk={setOk} reload={load} />}
      {tab === "machines" && <MachinesTab data={data} post={post} setOk={setOk} />}
      {tab === "maintenance" && <MaintenanceTab data={data} post={post} setOk={setOk} />}
      {tab === "items" && <ItemsTab data={data} post={post} setOk={setOk} />}
      {tab === "reports" && <ReportsTab data={data} />}
    </div>
  );
}
