"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Eye, PackageCheck, Download } from "lucide-react";
import { Msg, card, th, chip, inline, inr, inr2, Badge, Empty, SectionTitle, Tile, PO_TONE, FLAG_TONE, FLAG_LABEL } from "@/components/spares/ui";
import { ReportsTab } from "@/components/spares/MaintenanceTab";

/**
 * Spare-part purchases — read-only (accounts).
 * Issued POs with their value and what has been received against them,
 * final GRNs with invoice numbers and match results, stock value per plant
 * and the spend reports. Nothing on this page can change anything.
 */
export default function SparesViewPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plant, setPlant] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/stock/view${plant ? `?plant=${plant}` : ""}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load."); return; }
    setData(json);
  }, [plant]);
  useEffect(() => { load(); }, [load]);

  if (!data) return err ? <Msg err={err} ok={null} /> : <div className="flex items-center gap-2 text-[12px] text-biome-muted"><Loader2 size={14} className="bmx-spin" /> Loading…</div>;
  const open = (data.pos as any[]).filter((p) => p.status === "issued" || p.status === "partial");
  const pos = (data.pos as any[]).filter((p) => !q || `${p.no} ${p.vendorName}`.toLowerCase().includes(q.toLowerCase()));
  const grns = (data.grns as any[]).filter((g) => !q || `${g.no} ${g.poNo} ${g.vendorName} ${g.invoiceNo}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text"><Eye size={19} className="text-biome-leaf" /> Spare-part purchases <Badge tone="grey">Read-only</Badge></h1>
          <p className="mt-1 max-w-[720px] text-[11.5px] leading-relaxed text-biome-muted">POs issued by procurement, what has been received (final GRNs, matched against the PO) and its value — for booking purchase invoices and planning payments.</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO, GRN, vendor, invoice" className={`${inline} w-[220px]`} />
          {data.plants.length > 1 && <select aria-label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)} className={inline}><option value="">All plants</option>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select>}
        </div>
      </header>
      <Msg err={err} ok={null} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Open POs" value={open.length} sub={`${inr(open.reduce((t, p) => t + p.totals.total, 0))} ordered`} />
        <Tile label="Received on open POs" value={inr(open.reduce((t, p) => t + p.receivedValue, 0))} sub="final GRNs, incl. GST" />
        <Tile label="Final GRNs" value={data.grns.length} sub={inr(data.grns.reduce((t: number, g: any) => t + g.value, 0))} />
        <Tile label="Stock value" value={inr(data.byPlant.reduce((t: number, p: any) => t + p.value, 0))} sub={data.byPlant.map((p: any) => `${p.plant} ${inr(p.value)}`).join(" · ")} />
      </div>
      <section className={card}>
        <SectionTitle icon={FileText} title="Purchase orders" />
        {pos.length === 0 ? <Empty>No PO issued yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="py-2">PO / date</th><th>Vendor</th><th>Plant</th><th>Status</th><th className="text-right">PO value</th><th className="text-right">Received value</th><th>Payment terms</th><th>GRNs</th><th></th></tr></thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-b border-biome-line/60">
                    <td className="py-2"><p className="font-mono font-semibold text-biome-text">{p.no}</p><p className="text-[10px] text-biome-muted">{p.date}{p.expectedDate && ` · exp ${p.expectedDate}`}</p></td>
                    <td>{p.vendorName}<p className="text-[10px] text-biome-muted">{p.vendorGstin}</p></td>
                    <td>{p.plant}</td>
                    <td><Badge tone={PO_TONE[p.status]}>{data.statusLabels[p.status]}</Badge></td>
                    <td className="text-right font-mono">{inr2(p.totals.total)}</td>
                    <td className="text-right font-mono">{inr2(p.receivedValue)}</td>
                    <td className="text-[10.5px] text-biome-muted">{p.paymentTerms || "—"}</td>
                    <td className="font-mono text-[10px] text-biome-muted">{p.grnNos.join(", ") || "—"}</td>
                    <td><a href={`/api/stock/view?pdf=${p.id}`} target="_blank" rel="noreferrer" className={chip}><Download size={11} /> PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className={card}>
        <SectionTitle icon={PackageCheck} title="Final goods receipts" sub="Each one was matched against its PO and confirmed with Match & OK by procurement." />
        {grns.length === 0 ? <Empty>No final GRN yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="py-2">GRN / date</th><th>PO</th><th>Vendor</th><th>Invoice</th><th className="text-right">Value (incl. GST)</th><th>Match</th><th>Confirmed by</th></tr></thead>
              <tbody>
                {grns.map((g) => (
                  <tr key={g.id} className="border-b border-biome-line/60">
                    <td className="py-2"><p className="font-mono font-semibold text-biome-text">{g.no}</p><p className="text-[10px] text-biome-muted">{g.date} · {g.plant}</p></td>
                    <td className="font-mono text-[10.5px]">{g.poNo}</td>
                    <td>{g.vendorName}</td>
                    <td className="text-[10.5px]">{g.invoiceNo || "—"}{g.invoiceDate && ` · ${g.invoiceDate}`}{g.challanNo && <span className="text-biome-muted"> · ch {g.challanNo}</span>}</td>
                    <td className="text-right font-mono">{inr2(g.value)}</td>
                    <td><span className="flex flex-wrap gap-1">{g.flags.length ? g.flags.map((f: string) => <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Badge>) : <Badge tone="green">Matches</Badge>}</span>{g.matchNote && <p className="text-[10px] text-biome-muted">{g.matchNote}</p>}</td>
                    <td className="text-[10.5px] text-biome-muted">{g.finalByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ReportsTab data={data} base="/api/stock/view" viewOnly preview={{ vendor: data.vendorSpend, machine: data.machineSpend }} />
    </div>
  );
}
