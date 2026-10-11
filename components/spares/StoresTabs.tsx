"use client";

import { useMemo, useState } from "react";
import { Boxes, PackageMinus, History, Cog, ListPlus, Search, Download, Plus, Trash2, XCircle, Loader2, Truck, CheckCircle2, ShieldCheck, Gauge, Wrench } from "lucide-react";
import {
  inr, input, inline, label, card, th, btn, chip, today, Badge, Empty, SectionTitle, toExcel, Attachments, AttachButton, type Post,
} from "@/components/spares/ui";

/* ================================================================== */
/* Stock on hand                                                       */
/* ================================================================== */

export function StockTab({ data }: { data: any }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [only, setOnly] = useState<"all" | "low">("all");
  const rows = (data.rows as any[]).filter((r) =>
    (!q || `${r.code} ${r.name} ${r.partNo} ${r.rack}`.toLowerCase().includes(q.toLowerCase())) &&
    (!cat || r.category === cat) && (only === "all" || r.status !== "ok"));
  return (
    <section className={card}>
      <SectionTitle icon={Boxes} title="Stock on hand" sub="Calculated from every receipt, issue, transfer and adjustment — never typed, so it cannot drift." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part, part no, bin" className={`${inline} w-[220px] pl-8`} /></div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inline}>
          <option value="">Every category</option>{data.categories.map((c: string) => <option key={c}>{c}</option>)}
        </select>
        <select value={only} onChange={(e) => setOnly(e.target.value as any)} className={inline}>
          <option value="all">All stock</option><option value="low">Only low / out</option>
        </select>
        <button onClick={() => toExcel("Stock", rows.map((r) => ({ Plant: r.plant, Code: r.code, Part: r.name, "Part no": r.partNo, Category: r.category, Unit: r.unit, "On hand": r.qty, "On order": r.onOrder, "In transit": r.inTransit, "Avg rate": r.avgRate, Value: r.value, "Re-order level": r.minLevel, Status: r.status, Received: r.received, Issued: r.issued, "Last receipt": r.lastReceipt, "Last issue": r.lastIssue, Bin: r.rack })))}
          className={`${chip} ml-auto py-2`}><Download size={12} /> Excel</button>
      </div>
      {rows.length === 0 ? <Empty>Nothing here yet. Add parts in <b>Items</b>; stock arrives through a GRN against a PO (or opening stock in Issue &amp; moves).</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[11.5px]">
            <thead><tr className={th}>
              <th className="py-2">Plant</th><th>Part</th><th>Category</th><th className="pr-3 text-right">On hand</th><th className="pr-3 text-right">On order</th><th className="pr-3 text-right">Re-order</th><th className="pr-3 text-right">Avg rate</th><th className="pr-4 text-right">Value</th><th>Last in / out</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.itemId}-${r.plant}`} className="border-b border-biome-line/60">
                  <td className="py-2 font-mono text-[10.5px]">{r.plant}</td>
                  <td><p className="font-semibold text-biome-text">{r.name}</p><p className="text-[10px] text-biome-muted">{r.code}{r.partNo && ` · ${r.partNo}`}{r.rack && ` · bin ${r.rack}`}</p></td>
                  <td className="text-biome-muted">{r.category}</td>
                  <td className="pr-3 text-right font-mono font-semibold">{r.qty} {r.unit}{r.inTransit ? <span className="block text-[9.5px] font-normal text-amber-600">+{r.inTransit} in transit</span> : null}</td>
                  <td className="pr-3 text-right font-mono text-biome-muted">{r.onOrder || "—"}</td>
                  <td className="pr-3 text-right font-mono text-biome-muted">{r.minLevel || "—"}</td>
                  <td className="pr-3 text-right font-mono">{inr(r.avgRate)}</td>
                  <td className="pr-4 text-right font-mono">{inr(r.value)}</td>
                  <td className="text-[10px] text-biome-muted">{r.lastReceipt || "—"} / {r.lastIssue || "—"}</td>
                  <td>{r.status === "ok" ? <Badge tone="green">OK</Badge> : r.status === "low" ? <Badge tone="amber">Low — reorder</Badge> : <Badge tone="red">Out</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ================================================================== */
/* Issue slip, ledger, transfers, adjustments                          */
/* ================================================================== */

export function MovesTab({ data, post, setOk, reload }: { data: any; post: Post; setOk: (s: string) => void; reload: () => void }) {
  const pending = (data.movements as any[]).filter((m) => m.approval === "pending" && !m.cancelled);
  const transit = (data.movements as any[]).filter((m) => m.inTransit && !m.cancelled);
  const group = (list: any[]) => Array.from(new Map(list.map((m) => [m.no, list.filter((x) => x.no === m.no)])).entries());
  const items = new Map((data.items as any[]).map((i) => [i.id, i]));
  return (
    <div className="space-y-3">
      <IssueForm data={data} post={post} onDone={(no) => setOk(`${no} saved — parts issued from stock.`)} />
      {(pending.length > 0 || transit.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {pending.length > 0 && (
            <section className={card}>
              <SectionTitle icon={ShieldCheck} title="Adjustments waiting for approval" sub="They do not touch stock until an admin approves." />
              {group(pending).map(([no, lines]) => (
                <div key={no} className="flex flex-wrap items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
                  <span className="font-mono font-semibold text-biome-text">{no}</span>
                  <span className="text-biome-text">{lines.map((m: any) => `${m.type === "adjust_out" ? "−" : "+"}${m.qty} ${items.get(m.itemId)?.name}`).join(", ")}</span>
                  <span className="text-[10.5px] text-biome-muted">{lines[0].plant} · {lines[0].purpose} · {lines[0].createdByName}</span>
                  {data.canApprove ? (
                    <span className="ml-auto flex gap-1">
                      <button onClick={async () => { const j = await post("/api/stock", { action: "adjust.decide", no, decision: "approve" }); if (j) setOk(`${no} approved.`); }} className={chip}><CheckCircle2 size={11} /> Approve</button>
                      <button onClick={async () => { const note = window.prompt("Reason for rejecting:"); if (!note) return; const j = await post("/api/stock", { action: "adjust.decide", no, decision: "reject", note }); if (j) setOk(`${no} rejected.`); }} className={`${chip} text-rose-500`}><XCircle size={11} /> Reject</button>
                    </span>
                  ) : <Badge tone="amber">Waiting for admin</Badge>}
                </div>
              ))}
            </section>
          )}
          {transit.length > 0 && (
            <section className={card}>
              <SectionTitle icon={Truck} title="In transit between plants" sub="Counted at the receiving plant only after it is received." />
              {group(transit).map(([no, lines]) => (
                <div key={no} className="flex flex-wrap items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
                  <span className="font-mono font-semibold text-biome-text">{no}</span>
                  <span className="text-biome-text">{lines.map((m: any) => `${m.qty} ${items.get(m.itemId)?.name}`).join(", ")}</span>
                  <span className="text-[10.5px] text-biome-muted">{lines[0].purpose} → {lines[0].plant}</span>
                  <button onClick={async () => { const j = await post("/api/stock", { action: "transfer.receive", no }); if (j) setOk(`${no} received at ${lines[0].plant}.`); }} className={`${chip} ml-auto`}><CheckCircle2 size={11} /> Mark received</button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
      <LedgerTab data={data} post={post} setOk={setOk} reload={reload} />
    </div>
  );
}

function IssueForm({ data, post, onDone }: { data: any; post: Post; onDone: (no: string) => void }) {
  const [head, setHead] = useState<any>({ plant: data.myPlant || data.plants[0]?.code || "", date: today(), machineId: "", issuedTo: "", purpose: "", remarks: "" });
  const [lines, setLines] = useState<any[]>([{ itemId: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const items = (data.items as any[]).filter((i) => i.active);
  const machines = (data.machines as any[]).filter((m) => m.active && m.plant === head.plant);
  const onHand = (itemId: string) => (data.rows as any[]).find((r) => r.itemId === itemId && r.plant === head.plant)?.qty ?? 0;
  const suggested = useMemo(() => new Set(items.filter((i) => head.machineId && i.machineIds.includes(head.machineId)).map((i) => i.id)), [items, head.machineId]);

  async function save() {
    setBusy(true);
    const json = await post("/api/stock", { action: "move", type: "issue", ...head, lines: lines.filter((l) => l.itemId) });
    setBusy(false);
    if (json) { setLines([{ itemId: "", qty: "" }]); setHead({ ...head, issuedTo: "", purpose: "", remarks: "" }); onDone(json.no); }
  }

  return (
    <section className={card}>
      <SectionTitle icon={PackageMinus} title="Issue slip — parts out of the store into a machine" sub="For parts used in a maintenance job, log the job in Maintenance instead: it issues the parts for you." />
      <div className="grid gap-3 md:grid-cols-5">
        <label><span className={label}>Plant</span>
          <select value={head.plant} onChange={(e) => setHead({ ...head, plant: e.target.value, machineId: "" })} className={input}>
            {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select></label>
        <label><span className={label}>Date</span><input type="date" max={today()} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} className={input} /></label>
        <label><span className={label}>Machine</span>
          <select value={head.machineId} onChange={(e) => setHead({ ...head, machineId: e.target.value })} className={input}>
            <option value="">General use (no machine)</option>
            {machines.map((m: any) => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.section ? ` (${m.section})` : ""}</option>)}
          </select></label>
        <label><span className={label}>Issued to (fitter / operator)</span><input value={head.issuedTo} onChange={(e) => setHead({ ...head, issuedTo: e.target.value })} className={input} /></label>
        <label><span className={label}>Purpose</span><input value={head.purpose} onChange={(e) => setHead({ ...head, purpose: e.target.value })} placeholder="Bearing noise — replaced" className={input} /></label>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-biome-line bg-biome-bg p-2.5 md:grid-cols-[1fr_120px_140px_40px]">
            <label><span className={label}>Part</span>
              <select value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={input}>
                <option value="">Choose…</option>
                {suggested.size > 0 && <optgroup label="Fits this machine">{items.filter((it) => suggested.has(it.id)).map((it) => <option key={it.id} value={it.id}>{it.name}{it.partNo ? ` · ${it.partNo}` : ""} — on hand {onHand(it.id)} {it.unit}</option>)}</optgroup>}
                <optgroup label="All parts">{items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}{it.partNo ? ` · ${it.partNo}` : ""} — on hand {onHand(it.id)} {it.unit}</option>)}</optgroup>
              </select></label>
            <label><span className={label}>Qty</span>
              <input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={input} /></label>
            <p className="pb-2 text-[10.5px] text-biome-muted">{l.itemId ? `On hand: ${onHand(l.itemId)}` : ""}</p>
            <button aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} className="mb-1 rounded-lg border border-biome-line p-2 text-rose-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button onClick={() => setLines([...lines, { itemId: "", qty: "" }])} className={`${chip} py-1.5`}><Plus size={12} /> Add line</button>
          <button onClick={save} disabled={busy} className={`${btn} ml-auto`}>{busy ? <Loader2 size={14} className="bmx-spin" /> : <PackageMinus size={14} />} Issue parts</button>
        </div>
      </div>
    </section>
  );
}

function LedgerTab({ data, post, setOk, reload }: { data: any; post: Post; setOk: (s: string) => void; reload: () => void }) {
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
    const j = await post("/api/stock", { action: "cancel", no, reason });
    if (j) setOk(`${no} cancelled.`);
  }

  return (
    <section className={card}>
      <SectionTitle icon={History} title="Stock ledger" sub="Every movement per plant. Receipts from a final GRN are cancelled only by reopening the GRN." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={inline}>
          <option value="">Every movement</option>{Object.entries(data.movementLabels).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={inline} />
        <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={inline} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="No, part, vendor, machine, person" className={`${inline} w-[240px]`} />
        <button onClick={() => toExcel("Stock ledger", rows.map((m) => ({ No: m.no, Date: m.date, Plant: m.plant, Type: data.movementLabels[m.type], Part: items.get(m.itemId)?.name, "Part no": items.get(m.itemId)?.partNo, Qty: m.qty * (["issue", "adjust_out", "transfer_out"].includes(m.type) ? -1 : 1), Unit: items.get(m.itemId)?.unit, Rate: m.rate, Amount: m.amount, Vendor: m.vendorName, Invoice: m.invoiceNo, Machine: machines.get(m.machineId)?.name || "", "Issued to": m.issuedTo, Purpose: m.purpose, By: m.createdByName, Status: m.cancelled ? `Cancelled — ${m.cancelReason}` : m.approval === "pending" ? "Awaiting approval" : m.approval === "rejected" ? "Rejected" : m.inTransit ? "In transit" : "" })))}
          className={`${chip} ml-auto py-2`}><Download size={12} /> Excel</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[11px]">
          <thead><tr className={th}><th className="py-2">No / date</th><th>Type</th><th>Part</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Vendor / machine</th><th>By</th><th>Bill</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const it = items.get(m.itemId);
              const out = ["issue", "adjust_out", "transfer_out"].includes(m.type);
              const dim = m.cancelled || m.approval === "rejected";
              return (
                <tr key={m.id} className={`border-b border-biome-line/60 ${dim ? "opacity-50 line-through" : ""}`}>
                  <td className="py-1.5"><p className="font-mono font-semibold">{m.no}</p><p className="text-[10px] text-biome-muted">{m.date} · {m.plant}</p></td>
                  <td>{data.movementLabels[m.type]}{m.approval === "pending" && <span className="ml-1"><Badge tone="amber">Awaiting approval</Badge></span>}{m.inTransit && <span className="ml-1"><Badge tone="amber">In transit</Badge></span>}</td>
                  <td>{it?.name}<span className="text-[10px] text-biome-muted">{it?.partNo ? ` · ${it.partNo}` : ""}</span></td>
                  <td className={`text-right font-mono ${out ? "text-rose-500" : "text-emerald-600"}`}>{out ? "−" : "+"}{m.qty} {it?.unit}</td>
                  <td className="text-right font-mono">{inr(m.amount || m.qty * m.rate)}</td>
                  <td className="text-[10.5px]">{m.vendorName || machines.get(m.machineId)?.name || m.purpose}{m.invoiceNo && ` · inv ${m.invoiceNo}`}{m.issuedTo && ` · to ${m.issuedTo}`}</td>
                  <td className="text-[10px] text-biome-muted">{m.createdByName}{m.cancelled && ` · cancelled: ${m.cancelReason}`}</td>
                  <td className="whitespace-nowrap"><Attachments list={data.attachments?.[m.no]} no={m.no} /> <AttachButton no={m.no} onDone={() => { setOk(`Attached to ${m.no}.`); reload(); }} /></td>
                  <td>{data.canManage && !m.cancelled && m.type !== "transfer_in" && !m.grnId && !m.maintenanceId && m.approval !== "rejected" && (
                    <button onClick={() => cancel(m.no)} title="Cancel this document" aria-label={`Cancel ${m.no}`} className="rounded-lg border border-biome-line p-1 text-rose-500"><XCircle size={12} /></button>
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

function AdjustBox({ data, post, setOk }: { data: any; post: Post; setOk: (s: string) => void }) {
  const [f, setF] = useState<any>({ type: "adjust_in", plant: data.plants[0]?.code || "", toPlant: "", itemId: "", qty: "", rate: "", purpose: "", date: today(), machineId: "" });
  const all = data.allPlants || data.plants;
  async function go() {
    const j = await post("/api/stock", { action: "move", type: f.type, plant: f.plant, toPlant: f.toPlant, date: f.date, purpose: f.purpose, machineId: f.machineId, lines: [{ itemId: f.itemId, qty: f.qty, rate: f.rate }] });
    if (j) { setOk(j.pendingApproval ? `${j.no} saved — waiting for admin approval before stock changes.` : `${j.no} saved.`); setF({ ...f, itemId: "", qty: "", rate: "", purpose: "" }); }
  }
  return (
    <details className="mt-4 rounded-xl border border-biome-line bg-biome-bg p-3">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-biome-text">Opening stock, adjustment, return to store or transfer to another plant</summary>
      <p className="mt-2 text-[10.5px] text-biome-muted">Adjustments need a reason and {data.canApprove ? "are approved straight away (you hold approve)." : "wait for an admin's approval."} A transfer leaves this plant now and reaches the other plant when it is marked received.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <label><span className={label}>Type</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={input}>
            <option value="adjust_in">Opening stock / adjustment +</option><option value="adjust_out">Adjustment − (damage, count)</option>
            <option value="return">Return to store (unused from machine)</option><option value="transfer_out">Transfer to another plant</option>
          </select></label>
        <label><span className={label}>Plant</span><select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })} className={input}>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
        {f.type === "transfer_out" && <label><span className={label}>To plant</span><select value={f.toPlant} onChange={(e) => setF({ ...f, toPlant: e.target.value })} className={input}><option value="">Choose…</option>{all.filter((p: any) => p.code !== f.plant).map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>}
        {f.type === "return" && <label><span className={label}>From machine</span><select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })} className={input}><option value="">—</option>{data.machines.filter((m: any) => m.plant === f.plant).map((m: any) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label>}
        <label><span className={label}>Date</span><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></label>
        <label className="md:col-span-2"><span className={label}>Part</span><select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} className={input}><option value="">Choose…</option>{data.items.filter((i: any) => i.active).map((i: any) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label><span className={label}>Qty</span><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={input} /></label>
        {f.type === "adjust_in" && <label><span className={label}>Rate ₹ (opening)</span><input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={input} /></label>}
        <label className="md:col-span-3"><span className={label}>Reason</span><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Opening stock as on 01-10-2026 / physical count" className={input} /></label>
        <button onClick={go} className={`${btn} self-end justify-center`}>Save</button>
      </div>
    </details>
  );
}

/* ================================================================== */
/* Machine / asset register                                            */
/* ================================================================== */

export function MachinesTab({ data, post, setOk }: { data: any; post: Post; setOk: (s: string) => void }) {
  const blank = { id: "", name: "", plant: data.myPlant || data.plants[0]?.code || "", section: "", make: "", model: "", serialNo: "", installDate: "", warrantyUpto: "", capacity: "", runningHours: "", notes: "", active: true };
  const [f, setF] = useState<any>(blank);
  const [open, setOpen] = useState<string | null>(null);
  const items = new Map((data.items as any[]).map((i) => [i.id, i]));
  const usage = new Map((data.usage as any[]).map((u) => [u.machineId, u]));
  const t = today();
  async function save() {
    const j = await post("/api/stock", { action: "machine.save", ...f });
    if (j) { setOk(`${j.machine.code} saved.`); setF(blank); }
  }
  async function hours(m: any) {
    const v = window.prompt(`Running-hours meter reading for ${m.name} (last ${m.runningHours} h):`);
    if (v === null || v === "") return;
    const j = await post("/api/stock", { action: "machine.hours", id: m.id, hours: Number(v) });
    if (j) setOk(`${m.code} meter now ${j.machine.runningHours} h.`);
  }
  return (
    <section className="space-y-3">
      <div className={card}>
        <SectionTitle icon={Cog} title={f.id ? `Edit machine ${f.code || ""}` : "Machine / asset register"} sub="Every machine per plant with make, serial, warranty and hour meter. Spare parts are linked from the Items tab." />
        <div className="grid gap-2 md:grid-cols-4">
          <label className="md:col-span-2"><span className={label}>Machine name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Pellet mill 1" className={input} /></label>
          <label><span className={label}>Plant</span><select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })} className={input} disabled={!!f.id}>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
          <label><span className={label}>Section</span><input value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="Pelletising" className={input} /></label>
          <label><span className={label}>Make</span><input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} className={input} /></label>
          <label><span className={label}>Model</span><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} className={input} /></label>
          <label><span className={label}>Serial no</span><input value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} className={input} /></label>
          <label><span className={label}>Capacity</span><input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="2 TPH / 75 kW" className={input} /></label>
          <label><span className={label}>Installed on</span><input type="date" value={f.installDate} onChange={(e) => setF({ ...f, installDate: e.target.value })} className={input} /></label>
          <label><span className={label}>Warranty up to</span><input type="date" value={f.warrantyUpto} onChange={(e) => setF({ ...f, warrantyUpto: e.target.value })} className={input} /></label>
          {!f.id && <label><span className={label}>Hour meter now</span><input type="number" min={0} value={f.runningHours} onChange={(e) => setF({ ...f, runningHours: e.target.value })} className={input} /></label>}
          <label className={f.id ? "md:col-span-2" : ""}><span className={label}>Notes</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={input} /></label>
          <div className="flex items-end gap-2 md:col-span-4">
            {f.id && <label className="flex items-center gap-1.5 pb-2 text-[11px] text-biome-text"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
            <button onClick={save} className={btn}>{f.id ? "Save machine" : "Add machine"}</button>
            {f.id && <button onClick={() => setF(blank)} className="text-[11px] text-biome-muted underline">New</button>}
          </div>
        </div>
      </div>
      {(data.machines as any[]).length === 0 && <Empty>No machine yet.</Empty>}
      {(data.machines as any[]).map((m) => {
        const u = usage.get(m.id);
        const lines = (data.movements as any[]).filter((x) => x.machineId === m.id && !x.cancelled);
        const parts = (data.items as any[]).filter((i) => i.machineIds.includes(m.id));
        const pm = (data.schedules as any[]).filter((x) => x.machineId === m.id && x.active);
        const worst = pm.some((x) => x.due.status === "overdue") ? "overdue" : pm.some((x) => x.due.status === "due") ? "due" : "";
        const warranty = m.warrantyUpto ? (m.warrantyUpto >= t ? <Badge tone="green">Warranty till {m.warrantyUpto}</Badge> : <Badge tone="grey">Warranty over</Badge>) : null;
        return (
          <div key={m.id} className={`rounded-2xl border border-biome-line bg-biome-bgSoft p-3 ${m.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Wrench size={14} className="text-biome-leaf" />
              <p className="text-[12.5px] font-semibold text-biome-text">{m.code} · {m.name}</p>
              <span className="text-[10.5px] text-biome-muted">{m.plant}{m.section && ` · ${m.section}`}{m.make && ` · ${m.make} ${m.model}`}{m.serialNo && ` · S/N ${m.serialNo}`}</span>
              {warranty}
              {worst && <Badge tone={worst === "overdue" ? "red" : "amber"}>PM {worst}</Badge>}
              <span className="ml-auto font-mono text-[11px] text-biome-text">{u ? `${u.lines} issue(s) · ${inr(u.value)}` : "no parts yet"}</span>
              <button onClick={() => hours(m)} className={chip}><Gauge size={11} /> {m.runningHours} h</button>
              <button onClick={() => setOpen(open === m.id ? null : m.id)} className={chip}>Details</button>
              {data.canManage && <button onClick={() => setF({ ...blank, ...m })} className={chip}>Edit</button>}
            </div>
            {open === m.id && (
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className={label}>Linked spare parts ({parts.length})</p>
                  {parts.length === 0 ? <p className="text-[11px] text-biome-muted">None — link parts from the Items tab (“Fits machines”).</p> :
                    parts.map((p) => {
                      const r = (data.rows as any[]).find((x) => x.itemId === p.id && x.plant === m.plant);
                      return <p key={p.id} className="text-[11px] text-biome-text">{p.name}{p.partNo && <span className="text-biome-muted"> · {p.partNo}</span>} <span className="font-mono text-biome-muted">— on hand {r?.qty ?? 0} {p.unit}</span></p>;
                    })}
                  {m.installDate && <p className="mt-2 text-[10.5px] text-biome-muted">Installed {m.installDate}{m.capacity && ` · ${m.capacity}`}{m.hoursAt && ` · meter read ${m.hoursAt}`}</p>}
                  {m.notes && <p className="text-[10.5px] text-biome-muted">{m.notes}</p>}
                </div>
                <div>
                  <p className={label}>Parts used</p>
                  {lines.length === 0 ? <p className="text-[11px] text-biome-muted">Nothing issued to this machine yet.</p> : (
                    <table className="w-full text-left text-[11px]"><tbody>
                      {lines.slice(0, 30).map((x) => (
                        <tr key={x.id} className="border-t border-biome-line/60">
                          <td className="py-1 font-mono">{x.date}</td><td>{x.no}</td><td>{items.get(x.itemId)?.name}</td>
                          <td className="font-mono">{x.type === "return" ? "+" : "−"}{x.qty} {items.get(x.itemId)?.unit}</td><td className="text-biome-muted">{x.issuedTo}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ================================================================== */
/* Item master                                                         */
/* ================================================================== */

export function ItemsTab({ data, post, setOk }: { data: any; post: Post; setOk: (s: string) => void }) {
  const blank = { id: "", name: "", partNo: "", category: "Spare part", unit: "Nos", make: "", specification: "", rack: "", minAll: "", minByPlant: {} as Record<string, string>, bins: {} as Record<string, string>, machineIds: [] as string[], active: true };
  const [f, setF] = useState<any>(blank);
  const [q, setQ] = useState("");
  const all = data.allPlants || data.plants;
  async function save() {
    const minLevel: Record<string, number> = {};
    if (f.minAll) minLevel.all = Number(f.minAll);
    for (const [k, v] of Object.entries(f.minByPlant)) if (Number(v) > 0) minLevel[k] = Number(v);
    const j = await post("/api/stock", { action: "item.save", ...f, minLevel });
    if (j) { setOk(`${j.item.code} · ${j.item.name} saved.`); setF(blank); }
  }
  function edit(i: any) {
    const byPlant: Record<string, string> = {};
    for (const [k, v] of Object.entries(i.minLevel || {})) if (k) byPlant[k] = String(v);
    setF({ ...blank, ...i, minAll: i.minLevel?.[""] || "", minByPlant: byPlant, bins: { ...(i.bins || {}) } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const list = (data.items as any[]).filter((i) => !q || `${i.code} ${i.name} ${i.partNo} ${i.make}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="space-y-3">
      <div className={card}>
        <SectionTitle icon={ListPlus} title={f.id ? `Edit part ${f.code}` : "Item master — spare parts & consumables"} sub="Part no, which machines it fits, re-order level and bin per plant." />
        <div className="grid gap-2 md:grid-cols-4">
          <label className="md:col-span-2"><span className={label}>Part name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bearing 22220 EK" className={input} /></label>
          <label><span className={label}>Part no</span><input value={f.partNo} onChange={(e) => setF({ ...f, partNo: e.target.value })} className={input} /></label>
          <label><span className={label}>Make</span><input value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} placeholder="SKF" className={input} /></label>
          <label><span className={label}>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={input}>{data.categories.map((c: string) => <option key={c}>{c}</option>)}</select></label>
          <label><span className={label}>Unit</span><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={input}>{data.units.map((c: string) => <option key={c}>{c}</option>)}</select></label>
          <label><span className={label}>Re-order level (all plants)</span><input type="number" value={f.minAll} onChange={(e) => setF({ ...f, minAll: e.target.value })} className={input} /></label>
          <label><span className={label}>Default rack / bin</span><input value={f.rack} onChange={(e) => setF({ ...f, rack: e.target.value })} className={input} /></label>
          {all.map((p: any) => (
            <div key={p.code} className="grid grid-cols-2 gap-2 md:col-span-2">
              <label><span className={label}>{p.label}: re-order</span><input type="number" value={f.minByPlant[p.code] || ""} onChange={(e) => setF({ ...f, minByPlant: { ...f.minByPlant, [p.code]: e.target.value } })} placeholder={f.minAll ? `${f.minAll} (all)` : ""} className={input} /></label>
              <label><span className={label}>{p.label}: bin</span><input value={f.bins[p.code] || ""} onChange={(e) => setF({ ...f, bins: { ...f.bins, [p.code]: e.target.value } })} placeholder={f.rack} className={input} /></label>
            </div>
          ))}
          <label className="md:col-span-2"><span className={label}>Specification</span><input value={f.specification} onChange={(e) => setF({ ...f, specification: e.target.value })} className={input} /></label>
          <label className="md:col-span-2"><span className={label}>Fits machines (hold Ctrl for many)</span>
            <select multiple value={f.machineIds} onChange={(e) => setF({ ...f, machineIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${input} h-[74px]`}>
              {data.machines.map((m: any) => <option key={m.id} value={m.id}>{m.plant} · {m.name}</option>)}
            </select></label>
          <div className="flex items-end gap-2 md:col-span-4">
            {f.id && <label className="flex items-center gap-1.5 pb-2 text-[11px] text-biome-text"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
            <button onClick={save} className={btn}>{f.id ? "Save part" : "Add part"}</button>
            {f.id && <button onClick={() => setF(blank)} className="text-[11px] text-biome-muted underline">New</button>}
          </div>
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts" className={`${inline} w-[280px]`} />
      <div className="overflow-x-auto rounded-2xl border border-biome-line bg-biome-bgSoft p-3">
        <table className="w-full min-w-[760px] text-left text-[11.5px]">
          <thead><tr className={th}><th className="py-2">Code</th><th>Part</th><th>Category</th><th>Unit</th><th>Re-order</th><th>Bins</th><th>Fits</th><th></th></tr></thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className={`border-b border-biome-line/60 ${i.active ? "" : "opacity-50"}`}>
                <td className="py-1.5 font-mono">{i.code}</td>
                <td><b className="text-biome-text">{i.name}</b><span className="text-[10px] text-biome-muted">{i.partNo && ` · ${i.partNo}`}{i.make && ` · ${i.make}`}</span></td>
                <td>{i.category}</td><td>{i.unit}</td>
                <td className="text-[10.5px]">{Object.entries(i.minLevel || {}).map(([k, v]) => `${k || "all"}: ${v}`).join(", ") || "—"}</td>
                <td className="text-[10.5px] text-biome-muted">{[i.rack, ...Object.entries(i.bins || {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(", ") || "—"}</td>
                <td className="text-[10px] text-biome-muted">{i.machineIds.map((id: string) => data.machines.find((m: any) => m.id === id)?.name).filter(Boolean).join(", ") || "—"}</td>
                <td>{data.canManage && <button onClick={() => edit(i)} className={chip}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
