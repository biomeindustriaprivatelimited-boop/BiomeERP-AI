"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, PackagePlus, PackageMinus, Wrench, History, ListPlus, Loader2, AlertCircle, CheckCircle2,
  Search, Download, Plus, Trash2, Cog, ShieldAlert, XCircle,
} from "lucide-react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

/**
 * Plant stock — spare parts, consumables and the machines they go into.
 *
 *   Stock      what is on hand per plant, value, re-order warnings
 *   Receive    GRN from a registered vendor (invoice / challan), many lines
 *   Issue      parts out of the store INTO a machine, to a named person
 *   Ledger     every movement, filterable, cancellable by stores in-charge
 *   Machines   the machine master + what each machine has consumed
 *   Items      the part master (part no, unit, re-order level, fits which machines)
 */

type Tab = "stock" | "receive" | "issue" | "ledger" | "machines" | "items";

const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
// Inline filter controls: same look as `input`, but sized to content.
const inline = "bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";
const today = () => new Date().toISOString().slice(0, 10);

export default function StockPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("stock");
  const [plant, setPlant] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/stock${plant ? `?plant=${plant}` : ""}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load stock."); return; }
    setData(json);
  }, [plant]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load());

  async function post(body: any): Promise<any | null> {
    setErr(null); setOk(null);
    const res = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || `Failed (${res.status}).`); return null; }
    await load();
    return json;
  }

  if (!data) return <div className="flex items-center gap-2 text-[12px] text-biome-muted"><Loader2 size={14} className="bmx-spin" /> Loading stock…</div>;

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "stock", label: "Stock", icon: Boxes },
    { id: "receive", label: "Receive (GRN)", icon: PackagePlus },
    { id: "issue", label: "Issue to machine", icon: PackageMinus },
    { id: "ledger", label: "Ledger", icon: History },
    { id: "machines", label: "Machines", icon: Cog },
    { id: "items", label: "Items", icon: ListPlus },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Boxes size={19} className="text-biome-leaf" /> Plant stock · spare parts
          </h1>
          <p className="mt-1 max-w-[720px] text-[11.5px] leading-relaxed text-biome-muted">
            Which parts came in, from which registered vendor, what is on hand, and which part went into which machine.
            Balances are calculated from the entries every time — they cannot drift.
          </p>
        </div>
        {data.plants.length > 1 && (
          <select value={plant} onChange={(e) => setPlant(e.target.value)} className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text">
            <option value="">All my plants</option>
            {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
          </select>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Stock value" value={inr(data.summary.value)} />
        <Tile label="Active items" value={data.summary.items} />
        <Tile label="Machines" value={data.summary.machines} />
        <Tile label="Below re-order level" value={data.summary.low + data.summary.out} warn={data.summary.low + data.summary.out > 0} />
        <Tile label="Issued this month" value={inr(data.summary.issuedThisMonth)} />
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setErr(null); setOk(null); }}
            className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold ${tab === t.id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </nav>

      {err && <p className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11.5px] text-biome-text"><AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />{err}</p>}
      {ok && <p className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3 py-2 text-[11.5px] font-semibold text-emerald-600"><CheckCircle2 size={14} className="mt-px shrink-0" />{ok}</p>}

      {tab === "stock" && <StockTab data={data} />}
      {tab === "receive" && <MoveForm kind="receipt" data={data} post={post} onDone={(no) => setOk(`${no} saved — stock updated.`)} />}
      {tab === "issue" && <MoveForm kind="issue" data={data} post={post} onDone={(no) => setOk(`${no} saved — parts issued.`)} />}
      {tab === "ledger" && <LedgerTab data={data} post={post} setOk={setOk} />}
      {tab === "machines" && <MachinesTab data={data} post={post} setOk={setOk} />}
      {tab === "items" && <ItemsTab data={data} post={post} setOk={setOk} />}
    </div>
  );
}

function Tile({ label: l, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={`bmx-card rounded-2xl border p-4 ${warn ? "border-rose-500/30 bg-rose-500/[.06]" : "border-biome-line bg-biome-bgSoft"}`}>
      <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l}</p>
      <p className={`mt-1 font-mono text-[19px] font-semibold ${warn ? "text-rose-500" : "text-biome-text"}`}>{value}</p>
    </div>
  );
}

async function toExcel(name: string, rows: Record<string, any>[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, `${name}-${today()}.xlsx`);
}

/* ------------------------------------------------------------------ */

function StockTab({ data }: { data: any }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [only, setOnly] = useState<"all" | "low">("all");
  const rows = (data.rows as any[]).filter((r) =>
    (!q || `${r.code} ${r.name} ${r.partNo} ${r.rack}`.toLowerCase().includes(q.toLowerCase())) &&
    (!cat || r.category === cat) && (only === "all" || r.status !== "ok"));
  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part, part no, rack" className={`${inline} w-[220px] pl-8`} /></div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inline}>
          <option value="">Every category</option>{data.categories.map((c: string) => <option key={c}>{c}</option>)}
        </select>
        <select value={only} onChange={(e) => setOnly(e.target.value as any)} className={inline}>
          <option value="all">All stock</option><option value="low">Only low / out</option>
        </select>
        <button onClick={() => toExcel("Stock", rows.map((r) => ({ Plant: r.plant, Code: r.code, Part: r.name, "Part no": r.partNo, Category: r.category, Unit: r.unit, "On hand": r.qty, "Avg rate": r.avgRate, Value: r.value, "Re-order level": r.minLevel, Status: r.status, Received: r.received, Issued: r.issued, "Last receipt": r.lastReceipt, "Last issue": r.lastIssue, Rack: r.rack })))}
          className="bmx-chip ml-auto flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><Download size={12} /> Excel</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11.5px] text-biome-muted">Nothing here yet. Add parts in <b>Items</b>, then receive them with a GRN.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[11.5px]">
            <thead><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-[.12em] text-biome-muted">
              <th className="py-2">Plant</th><th>Part</th><th>Category</th><th className="pr-3 text-right">On hand</th><th className="pr-3 text-right">Re-order</th><th className="pr-3 text-right">Avg rate</th><th className="pr-4 text-right">Value</th><th>Last in / out</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.itemId}-${r.plant}`} className="border-b border-biome-line/60">
                  <td className="py-2 font-mono text-[10.5px]">{r.plant}</td>
                  <td><p className="font-semibold text-biome-text">{r.name}</p><p className="text-[10px] text-biome-muted">{r.code}{r.partNo && ` · ${r.partNo}`}{r.rack && ` · rack ${r.rack}`}</p></td>
                  <td className="text-biome-muted">{r.category}</td>
                  <td className="pr-3 text-right font-mono font-semibold">{r.qty} {r.unit}</td>
                  <td className="pr-3 text-right font-mono text-biome-muted">{r.minLevel || "—"}</td>
                  <td className="pr-3 text-right font-mono">{inr(r.avgRate)}</td>
                  <td className="pr-4 text-right font-mono">{inr(r.value)}</td>
                  <td className="text-[10px] text-biome-muted">{r.lastReceipt || "—"} / {r.lastIssue || "—"}</td>
                  <td>{r.status === "ok" ? <span className="text-[10px] font-bold text-emerald-600">OK</span>
                    : r.status === "low" ? <span className="text-[10px] font-bold text-amber-600">LOW — reorder</span>
                    : <span className="text-[10px] font-bold text-rose-500">OUT</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function MoveForm({ kind, data, post, onDone }: { kind: "receipt" | "issue"; data: any; post: (b: any) => Promise<any>; onDone: (no: string) => void }) {
  const [head, setHead] = useState<any>({ plant: data.myPlant || data.plants[0]?.code || "", date: today(), vendorId: "", invoiceNo: "", challanNo: "", machineId: "", issuedTo: "", purpose: "", remarks: "" });
  const [lines, setLines] = useState<any[]>([{ itemId: "", qty: "", rate: "" }]);
  const [busy, setBusy] = useState(false);
  const [bills, setBills] = useState<File[]>([]);
  const items = (data.items as any[]).filter((i) => i.active);
  const machines = (data.machines as any[]).filter((m) => m.active && m.plant === head.plant);
  const onHand = (itemId: string) => (data.rows as any[]).find((r) => r.itemId === itemId && r.plant === head.plant)?.qty ?? 0;
  const suggested = useMemo(() => new Set(items.filter((i) => head.machineId && i.machineIds.includes(head.machineId)).map((i) => i.id)), [items, head.machineId]);
  const total = lines.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);

  async function save() {
    setBusy(true);
    const json = await post({ action: "move", type: kind, ...head, lines: lines.filter((l) => l.itemId) });
    if (json && bills.length) {
      // The purchase invoice / kanta parchi goes on the document just saved.
      const fd = new FormData(); fd.append("no", json.no); bills.forEach((b) => fd.append("file", b));
      await fetch("/api/stock/attachment", { method: "POST", body: fd }).catch(() => null);
    }
    setBusy(false);
    if (json) { setLines([{ itemId: "", qty: "", rate: "" }]); setBills([]); setHead({ ...head, invoiceNo: "", challanNo: "", issuedTo: "", purpose: "", remarks: "" }); onDone(json.no); }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <label><span className={label}>Plant</span>
          <select value={head.plant} onChange={(e) => setHead({ ...head, plant: e.target.value, machineId: "" })} className={input}>
            {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select></label>
        <label><span className={label}>Date</span><input type="date" max={today()} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} className={input} /></label>
        {kind === "receipt" ? (
          <>
            <label className="md:col-span-2"><span className={label}>Vendor (registered)</span>
              <select value={head.vendorId} onChange={(e) => setHead({ ...head, vendorId: e.target.value })} className={input}>
                <option value="">Choose…</option>
                {data.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ""}{v.status !== "active" ? ` — ${v.status}` : ""}</option>)}
              </select>
              {data.vendors.length === 0 && <span className="mt-1 block text-[10px] text-amber-600">No spare-part vendor registered yet — register one in Vendor &amp; Client Registration and tick “Machine spare parts”.</span>}
            </label>
            <label><span className={label}>Vendor invoice no</span><input value={head.invoiceNo} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} className={input} /></label>
            <label><span className={label}>Challan no</span><input value={head.challanNo} onChange={(e) => setHead({ ...head, challanNo: e.target.value })} className={input} /></label>
          </>
        ) : (
          <>
            <label><span className={label}>Machine</span>
              <select value={head.machineId} onChange={(e) => setHead({ ...head, machineId: e.target.value })} className={input}>
                <option value="">General use (no machine)</option>
                {machines.map((m: any) => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.section ? ` (${m.section})` : ""}</option>)}
              </select></label>
            <label><span className={label}>Issued to (fitter / operator)</span><input value={head.issuedTo} onChange={(e) => setHead({ ...head, issuedTo: e.target.value })} className={input} /></label>
            <label><span className={label}>Purpose / breakdown</span><input value={head.purpose} onChange={(e) => setHead({ ...head, purpose: e.target.value })} placeholder="Bearing noise — replaced" className={input} /></label>
          </>
        )}
        <label className={kind === "receipt" ? "md:col-span-2" : ""}><span className={label}>Remarks</span><input value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} className={input} /></label>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-biome-line bg-biome-bg p-2.5 md:grid-cols-[1fr_120px_140px_40px]">
            <label><span className={label}>Part</span>
              <select value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={input}>
                <option value="">Choose…</option>
                {kind === "issue" && suggested.size > 0 && <optgroup label="Fits this machine">{items.filter((it) => suggested.has(it.id)).map((it) => <option key={it.id} value={it.id}>{it.name}{it.partNo ? ` · ${it.partNo}` : ""} — on hand {onHand(it.id)} {it.unit}</option>)}</optgroup>}
                <optgroup label="All parts">{items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}{it.partNo ? ` · ${it.partNo}` : ""}{kind === "issue" ? ` — on hand ${onHand(it.id)} ${it.unit}` : ""}</option>)}</optgroup>
              </select></label>
            <label><span className={label}>Qty {l.itemId ? `(${items.find((x) => x.id === l.itemId)?.unit || ""})` : ""}</span>
              <input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={input} /></label>
            {kind === "receipt" ? (
              <label><span className={label}>Rate ₹ / unit</span>
                <input type="number" min={0} step="any" value={l.rate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} className={input} /></label>
            ) : <p className="pb-2 text-[10.5px] text-biome-muted">{l.itemId ? `On hand: ${onHand(l.itemId)}` : ""}</p>}
            <button onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} className="mb-1 rounded-lg border border-biome-line p-2 text-rose-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={() => setLines([...lines, { itemId: "", qty: "", rate: "" }])} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted"><Plus size={12} /> Add line</button>
      </div>

      <div className="rounded-xl border border-dashed border-biome-line bg-biome-bg p-3">
        <span className={label}>{kind === "receipt" ? "Purchase invoice / kanta parchi / challan (PDF or photo)" : "Photo / job card (optional)"}</span>
        <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setBills(Array.from(e.target.files || []))}
          className="block w-full text-[11px] text-biome-muted file:mr-3 file:rounded-lg file:border-0 file:bg-biome-leaf file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white" />
        {bills.length > 0 && <p className="mt-1 text-[10.5px] text-biome-muted">{bills.map((b) => b.name).join(", ")} — attached when you save; anyone with stock access can open it from the ledger.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {kind === "receipt" && <span className="font-mono text-[12px] text-biome-text">Total {inr(total)}</span>}
        <button onClick={save} disabled={busy}
          className="bmx-btn ml-auto flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={14} className="bmx-spin" /> : kind === "receipt" ? <PackagePlus size={14} /> : <PackageMinus size={14} />}
          {kind === "receipt" ? "Save GRN" : "Issue parts"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function LedgerTab({ data, post, setOk }: { data: any; post: (b: any) => Promise<any>; setOk: (s: string) => void }) {
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const items = new Map((data.items as any[]).map((i) => [i.id, i]));
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  const rows = (data.movements as any[]).filter((m) =>
    (!type || m.type === type) && (!from || m.date >= from) && (!to || m.date <= to) &&
    (!q || `${m.no} ${items.get(m.itemId)?.name} ${m.vendorName} ${machines.get(m.machineId)?.name || ""} ${m.issuedTo} ${m.invoiceNo}`.toLowerCase().includes(q.toLowerCase())));

  async function cancel(no: string) {
    const reason = window.prompt(`Cancel ${no}? Give the reason:`);
    if (!reason) return;
    const j = await post({ action: "cancel", no, reason });
    if (j) setOk(`${no} cancelled.`);
  }

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={inline}>
          <option value="">Every movement</option>{Object.entries(data.movementLabels).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inline} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inline} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="No, part, vendor, machine, person" className={`${inline} w-[240px]`} />
        <button onClick={() => toExcel("Stock ledger", rows.map((m) => ({ No: m.no, Date: m.date, Plant: m.plant, Type: data.movementLabels[m.type], Part: items.get(m.itemId)?.name, "Part no": items.get(m.itemId)?.partNo, Qty: m.qty * (["issue", "adjust_out", "transfer_out"].includes(m.type) ? -1 : 1), Unit: items.get(m.itemId)?.unit, Rate: m.rate, Amount: m.amount, Vendor: m.vendorName, Invoice: m.invoiceNo, Machine: machines.get(m.machineId)?.name || "", "Issued to": m.issuedTo, Purpose: m.purpose, By: m.createdByName, Cancelled: m.cancelled ? `Yes — ${m.cancelReason}` : "" })))}
          className="bmx-chip ml-auto flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><Download size={12} /> Excel</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[11px]">
          <thead><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-[.12em] text-biome-muted">
            <th className="py-2">No / date</th><th>Type</th><th>Part</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Vendor / machine</th><th>By</th><th>Bill</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const it = items.get(m.itemId);
              const out = ["issue", "adjust_out", "transfer_out"].includes(m.type);
              return (
                <tr key={m.id} className={`border-b border-biome-line/60 ${m.cancelled ? "opacity-50 line-through" : ""}`}>
                  <td className="py-1.5"><p className="font-mono font-semibold">{m.no}</p><p className="text-[10px] text-biome-muted">{m.date} · {m.plant}</p></td>
                  <td>{data.movementLabels[m.type]}</td>
                  <td>{it?.name}<span className="text-[10px] text-biome-muted">{it?.partNo ? ` · ${it.partNo}` : ""}</span></td>
                  <td className={`text-right font-mono ${out ? "text-rose-500" : "text-emerald-600"}`}>{out ? "−" : "+"}{m.qty} {it?.unit}</td>
                  <td className="text-right font-mono">{inr(m.amount || m.qty * m.rate)}</td>
                  <td className="text-[10.5px]">{m.vendorName || machines.get(m.machineId)?.name || m.purpose}{m.invoiceNo && ` · inv ${m.invoiceNo}`}{m.issuedTo && ` · to ${m.issuedTo}`}</td>
                  <td className="text-[10px] text-biome-muted">{m.createdByName}{m.cancelled && ` · cancelled: ${m.cancelReason}`}</td>
                  <td className="whitespace-nowrap">
                    {(data.attachments?.[m.no] || []).map((a: any) => (
                      <a key={a.id} href={`/api/stock/attachment?no=${encodeURIComponent(m.no)}&id=${a.id}`} target="_blank" rel="noreferrer" title={a.name} className="mr-1 text-[12px]">📎</a>
                    ))}
                    <AttachButton no={m.no} onDone={() => setOk(`Attached to ${m.no}.`)} />
                  </td>
                  <td>{data.canManage && !m.cancelled && m.type !== "transfer_in" && (
                    <button onClick={() => cancel(m.no)} title="Cancel this document" className="rounded-lg border border-biome-line p-1 text-rose-500"><XCircle size={12} /></button>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-3 text-[11.5px] text-biome-muted">No movements.</p>}
      </div>
      {data.canManage && <AdjustBox data={data} post={post} setOk={setOk} />}
    </section>
  );
}

function AdjustBox({ data, post, setOk }: { data: any; post: (b: any) => Promise<any>; setOk: (s: string) => void }) {
  const [f, setF] = useState<any>({ type: "adjust_in", plant: data.plants[0]?.code || "", toPlant: "", itemId: "", qty: "", rate: "", purpose: "", date: today() });
  async function go() {
    const j = await post({ action: "move", type: f.type, plant: f.plant, toPlant: f.toPlant, date: f.date, purpose: f.purpose, lines: [{ itemId: f.itemId, qty: f.qty, rate: f.rate }] });
    if (j) { setOk(`${j.no} saved.`); setF({ ...f, itemId: "", qty: "", rate: "", purpose: "" }); }
  }
  return (
    <details className="mt-4 rounded-xl border border-biome-line bg-biome-bg p-3">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-biome-text">Opening stock, adjustment, return or transfer (stores in-charge)</summary>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <label><span className={label}>Type</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={input}>
            <option value="adjust_in">Opening stock / adjustment +</option><option value="adjust_out">Adjustment − (damage, count)</option>
            <option value="return">Return to store</option><option value="transfer_out">Transfer to another plant</option>
          </select></label>
        <label><span className={label}>Plant</span><select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })} className={input}>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
        {f.type === "transfer_out" && <label><span className={label}>To plant</span><select value={f.toPlant} onChange={(e) => setF({ ...f, toPlant: e.target.value })} className={input}><option value="">Choose…</option>{data.plants.filter((p: any) => p.code !== f.plant).map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>}
        <label><span className={label}>Date</span><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></label>
        <label className="md:col-span-2"><span className={label}>Part</span><select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} className={input}><option value="">Choose…</option>{data.items.filter((i: any) => i.active).map((i: any) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label><span className={label}>Qty</span><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={input} /></label>
        {f.type === "adjust_in" && <label><span className={label}>Rate ₹ (opening)</span><input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={input} /></label>}
        <label className="md:col-span-3"><span className={label}>Reason</span><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Opening stock as on 01-10-2026 / physical count" className={input} /></label>
        <button onClick={go} className="bmx-btn self-end rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">Save</button>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */

function MachinesTab({ data, post, setOk }: { data: any; post: (b: any) => Promise<any>; setOk: (s: string) => void }) {
  const blank = { id: "", name: "", plant: data.myPlant || data.plants[0]?.code || "", section: "", make: "", model: "", serialNo: "", active: true };
  const [f, setF] = useState<any>(blank);
  const [open, setOpen] = useState<string | null>(null);
  const items = new Map((data.items as any[]).map((i) => [i.id, i]));
  const usage = new Map((data.usage as any[]).map((u) => [u.machineId, u]));
  async function save() {
    const j = await post({ action: "machine.save", ...f });
    if (j) { setOk(`${j.machine.code} saved.`); setF(blank); }
  }
  return (
    <section className="space-y-3">
      <div className="grid gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft p-4 md:grid-cols-4">
        <label className="md:col-span-2"><span className={label}>{f.id ? "Edit machine" : "New machine"}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Pellet mill 1" className={input} /></label>
        <label><span className={label}>Plant</span><select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })} className={input}>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
        <label><span className={label}>Section</span><input value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="Pelletising" className={input} /></label>
        <label><span className={label}>Make</span><input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} className={input} /></label>
        <label><span className={label}>Model</span><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} className={input} /></label>
        <label><span className={label}>Serial no</span><input value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} className={input} /></label>
        <div className="flex items-end gap-2">
          {f.id && <label className="flex items-center gap-1.5 pb-2 text-[11px]"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
          <button onClick={save} className="bmx-btn rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">{f.id ? "Save" : "Add machine"}</button>
          {f.id && <button onClick={() => setF(blank)} className="text-[11px] text-biome-muted underline">New</button>}
        </div>
      </div>
      {(data.machines as any[]).map((m) => {
        const u = usage.get(m.id);
        const lines = (data.movements as any[]).filter((x) => x.machineId === m.id && !x.cancelled);
        return (
          <div key={m.id} className={`rounded-2xl border border-biome-line bg-biome-bgSoft p-3 ${m.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Wrench size={14} className="text-biome-leaf" />
              <p className="text-[12.5px] font-semibold text-biome-text">{m.code} · {m.name}</p>
              <span className="text-[10.5px] text-biome-muted">{m.plant}{m.section && ` · ${m.section}`}{m.make && ` · ${m.make} ${m.model}`}</span>
              <span className="ml-auto font-mono text-[11px] text-biome-text">{u ? `${u.lines} issue(s) · ${inr(u.value)}` : "no parts yet"}</span>
              <button onClick={() => setOpen(open === m.id ? null : m.id)} className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] text-biome-muted">Parts used</button>
              {data.canManage && <button onClick={() => setF({ ...blank, ...m })} className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] text-biome-muted">Edit</button>}
            </div>
            {open === m.id && (
              <table className="mt-2 w-full text-left text-[11px]">
                <tbody>
                  {lines.length === 0 && <tr><td className="text-biome-muted">Nothing issued to this machine yet.</td></tr>}
                  {lines.map((x) => (
                    <tr key={x.id} className="border-t border-biome-line/60">
                      <td className="py-1 font-mono">{x.date}</td><td>{x.no}</td><td>{items.get(x.itemId)?.name}</td>
                      <td className="font-mono">{x.type === "return" ? "+" : "−"}{x.qty} {items.get(x.itemId)?.unit}</td>
                      <td>{x.issuedTo}</td><td className="text-biome-muted">{x.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ItemsTab({ data, post, setOk }: { data: any; post: (b: any) => Promise<any>; setOk: (s: string) => void }) {
  const blank = { id: "", name: "", partNo: "", category: "Spare part", unit: "Nos", make: "", specification: "", rack: "", minAll: "", machineIds: [] as string[], active: true };
  const [f, setF] = useState<any>(blank);
  const [q, setQ] = useState("");
  async function save() {
    const j = await post({ action: "item.save", ...f, minLevel: f.minAll ? { all: Number(f.minAll) } : {} });
    if (j) { setOk(`${j.item.code} · ${j.item.name} saved.`); setF(blank); }
  }
  const list = (data.items as any[]).filter((i) => !q || `${i.code} ${i.name} ${i.partNo} ${i.make}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="space-y-3">
      <div className="grid gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft p-4 md:grid-cols-4">
        <label className="md:col-span-2"><span className={label}>{f.id ? "Edit part" : "New part"}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bearing 22220 EK" className={input} /></label>
        <label><span className={label}>Part no</span><input value={f.partNo} onChange={(e) => setF({ ...f, partNo: e.target.value })} className={input} /></label>
        <label><span className={label}>Make</span><input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} placeholder="SKF" className={input} /></label>
        <label><span className={label}>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={input}>{data.categories.map((c: string) => <option key={c}>{c}</option>)}</select></label>
        <label><span className={label}>Unit</span><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={input}>{data.units.map((c: string) => <option key={c}>{c}</option>)}</select></label>
        <label><span className={label}>Re-order level</span><input type="number" value={f.minAll} onChange={(e) => setF({ ...f, minAll: e.target.value })} className={input} /></label>
        <label><span className={label}>Rack / bin</span><input value={f.rack} onChange={(e) => setF({ ...f, rack: e.target.value })} className={input} /></label>
        <label className="md:col-span-2"><span className={label}>Specification</span><input value={f.specification} onChange={(e) => setF({ ...f, specification: e.target.value })} className={input} /></label>
        <label className="md:col-span-2"><span className={label}>Fits machines (hold Ctrl for many)</span>
          <select multiple value={f.machineIds} onChange={(e) => setF({ ...f, machineIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${input} h-[70px]`}>
            {data.machines.map((m: any) => <option key={m.id} value={m.id}>{m.plant} · {m.name}</option>)}
          </select></label>
        <div className="flex items-end gap-2 md:col-span-4">
          {f.id && <label className="flex items-center gap-1.5 pb-2 text-[11px]"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
          <button onClick={save} className="bmx-btn rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">{f.id ? "Save part" : "Add part"}</button>
          {f.id && <button onClick={() => setF(blank)} className="text-[11px] text-biome-muted underline">New</button>}
          {!data.canManage && <span className="flex items-center gap-1 text-[10px] text-biome-muted"><ShieldAlert size={11} /> You can add parts; editing needs stores / procurement.</span>}
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts" className={`${inline} w-[280px]`} />
      <div className="overflow-x-auto rounded-2xl border border-biome-line bg-biome-bgSoft p-3">
        <table className="w-full min-w-[720px] text-left text-[11.5px]">
          <thead><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-[.12em] text-biome-muted"><th className="py-2">Code</th><th>Part</th><th>Category</th><th>Unit</th><th>Re-order</th><th>Fits</th><th></th></tr></thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className={`border-b border-biome-line/60 ${i.active ? "" : "opacity-50"}`}>
                <td className="py-1.5 font-mono">{i.code}</td>
                <td><b>{i.name}</b><span className="text-[10px] text-biome-muted">{i.partNo && ` · ${i.partNo}`}{i.make && ` · ${i.make}`}</span></td>
                <td>{i.category}</td><td>{i.unit}</td><td>{i.minLevel?.[""] || "—"}</td>
                <td className="text-[10px] text-biome-muted">{i.machineIds.map((id: string) => data.machines.find((m: any) => m.id === id)?.name).filter(Boolean).join(", ") || "—"}</td>
                <td>{data.canManage && <button onClick={() => setF({ ...blank, ...i, minAll: i.minLevel?.[""] || "" })} className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-[10.5px] text-biome-muted">Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


/** Add a bill / parchi to an existing stock document. */
function AttachButton({ no, onDone }: { no: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label title="Attach bill / parchi" className="cursor-pointer text-[10px] font-semibold text-biome-leaf">
      {busy ? "…" : "+"}
      <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={async (e) => {
        const files = Array.from(e.target.files || []); if (!files.length) return;
        setBusy(true);
        const fd = new FormData(); fd.append("no", no); files.forEach((f) => fd.append("file", f));
        const r = await fetch("/api/stock/attachment", { method: "POST", body: fd }).catch(() => null);
        setBusy(false); e.target.value = "";
        if (r?.ok) { onDone(); location.reload(); } else alert((await r?.json().catch(() => ({})))?.error || "Could not attach.");
      }} />
    </label>
  );
}
