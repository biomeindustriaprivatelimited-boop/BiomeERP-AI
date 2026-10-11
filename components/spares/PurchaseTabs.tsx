"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList, FileText, PackageCheck, AlertTriangle, Wrench, Truck, Plus, Trash2, Send, Mail, Download,
  CheckCircle2, XCircle, Lock, Unlock, Loader2, ShoppingCart, Eye, Ban, Scissors,
} from "lucide-react";
import {
  inr, inr2, input, inline, label, card, th, btn, chip, today, Tile, Badge, Empty, SectionTitle, Attachments, AttachButton,
  PO_TONE, INDENT_TONE, URGENCY_TONE, FLAG_TONE, FLAG_LABEL, type Post,
} from "@/components/spares/ui";
import { IndentForm } from "@/components/spares/IndentForm";

type Go = (tab: string, payload?: any) => void;
const plantName = (data: any, code: string) => data.allPlants?.find((p: any) => p.code === code)?.label || code;

/* ================================================================== */
/* Dashboard                                                           */
/* ================================================================== */

export function Dashboard({ data, go }: { data: any; go: Go }) {
  const s = data.summary;
  const urgent = (data.indents as any[]).filter((i) => (i.status.code === "open" || i.status.code === "approved")).slice(0, 6);
  const overdue = (data.pos as any[]).filter((p) => p.overdue).slice(0, 6);
  const low = (data.rows as any[]).filter((r) => r.status !== "ok" && r.minLevel > 0).slice(0, 8);
  const due = (data.schedules as any[]).filter((x) => x.active && x.due.status !== "ok").sort((a, b) => (a.due.status === "overdue" ? -1 : 1) - (b.due.status === "overdue" ? -1 : 1)).slice(0, 6);
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Open requirements" value={s.openIndents} sub={s.urgentIndents ? `${s.urgentIndents} urgent / breakdown` : "from the plants"} tone={s.urgentIndents ? "bad" : s.openIndents ? "warn" : undefined} onClick={() => go("indents")} />
        <Tile label="Open POs" value={s.openPos} sub={`${inr(s.openPoValue)} still to receive${s.overduePos ? ` · ${s.overduePos} overdue` : ""}`} tone={s.overduePos ? "warn" : undefined} onClick={() => go("pos")} />
        <Tile label="GRNs waiting for Match & OK" value={s.pendingGrns} sub="draft receipts" tone={s.pendingGrns ? "warn" : undefined} onClick={() => go("grn")} />
        <Tile label="Low / out of stock" value={s.low + s.out} sub={`${s.items} parts tracked`} tone={s.low + s.out ? "bad" : "good"} onClick={() => go("stock")} />
        <Tile label="Maintenance due" value={s.maintenanceDue + s.maintenanceOverdue} sub={s.maintenanceOverdue ? `${s.maintenanceOverdue} overdue` : "next 3 days"} tone={s.maintenanceOverdue ? "bad" : s.maintenanceDue ? "warn" : undefined} onClick={() => go("maintenance")} />
        <Tile label="Stock value" value={inr(s.value)} sub={`Issued this month ${inr(s.issuedThisMonth)}`} onClick={() => go("stock")} />
        <Tile label="In transit between plants" value={s.inTransit} sub="transfers not yet received" tone={s.inTransit ? "warn" : undefined} onClick={() => go("moves")} />
        <Tile label="Adjustments awaiting approval" value={s.pendingAdjust} sub="admin approves" tone={s.pendingAdjust ? "warn" : undefined} onClick={() => go("moves")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <SectionTitle icon={ClipboardList} title="Requirements waiting" right={<button onClick={() => go("indents")} className={chip}>Open</button>} />
          {urgent.length === 0 ? <Empty>No open requirement.</Empty> : urgent.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
              <span className="font-mono font-semibold text-biome-text">{i.no}</span>
              <Badge tone={URGENCY_TONE[i.urgency]}>{data.urgencyLabels[i.urgency]?.split(" ")[0]}</Badge>
              <span className="text-biome-text">{i.lines.map((l: any) => `${l.name} × ${l.qty}`).join(", ")}</span>
              <span className="ml-auto text-[10.5px] text-biome-muted">{plantName(data, i.plant)} · {i.raisedByName}</span>
            </div>
          ))}
        </section>
        <section className={card}>
          <SectionTitle icon={AlertTriangle} title="Re-order now" sub="At or below the re-order level" right={low.length ? <button onClick={() => go("pos", { lowStock: true })} className={chip}><ShoppingCart size={11} /> PO for low stock</button> : undefined} />
          {low.length === 0 ? <Empty>Every tracked part is above its re-order level.</Empty> : low.map((r) => (
            <div key={`${r.itemId}-${r.plant}`} className="flex items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
              <Badge tone={r.status === "out" ? "red" : "amber"}>{r.status === "out" ? "Out" : "Low"}</Badge>
              <span className="text-biome-text">{r.name}</span>
              <span className="ml-auto font-mono text-[11px] text-biome-muted">{r.plant} · {r.qty}/{r.minLevel} {r.unit}{r.onOrder ? ` · ${r.onOrder} on order` : ""}</span>
            </div>
          ))}
        </section>
        <section className={card}>
          <SectionTitle icon={Truck} title="POs past the expected date" />
          {overdue.length === 0 ? <Empty>No PO is late.</Empty> : overdue.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
              <span className="font-mono font-semibold text-biome-text">{p.no}</span>
              <span className="text-biome-text">{p.vendorName}</span>
              <span className="ml-auto text-[10.5px] text-rose-500">expected {p.expectedDate}</span>
            </div>
          ))}
        </section>
        <section className={card}>
          <SectionTitle icon={Wrench} title="Preventive maintenance due" right={<button onClick={() => go("maintenance")} className={chip}>Open</button>} />
          {due.length === 0 ? <Empty>Nothing due in the next 3 days.</Empty> : due.map((x) => (
            <div key={x.id} className="flex items-center gap-2 border-b border-biome-line/60 py-1.5 text-[11.5px] last:border-0">
              <Badge tone={x.due.status === "overdue" ? "red" : "amber"}>{x.due.status}</Badge>
              <span className="text-biome-text">{machines.get(x.machineId)?.name || "?"} — {x.task}</span>
              <span className="ml-auto text-[10.5px] text-biome-muted">{x.due.nextDate || ""}{x.due.nextHours ? ` · @${x.due.nextHours} h` : ""}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Requirements (indents)                                              */
/* ================================================================== */

export function IndentsTab({ data, post, setOk, go }: { data: any; post: Post; setOk: (s: string) => void; go: Go }) {
  const [filter, setFilter] = useState("pending");
  const [pick, setPick] = useState<string[]>([]);
  const [showNew, setShowNew] = useState(false);
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  const list = (data.indents as any[]).filter((i) =>
    filter === "all" ? true : filter === "pending" ? ["open", "approved"].includes(i.status.code) : filter === "ordered" ? ["ordered", "partial"].includes(i.status.code) : i.status.code === filter);
  const picked = (data.indents as any[]).filter((i) => pick.includes(i.id));
  const samePlant = new Set(picked.map((i) => i.plant)).size <= 1;

  async function decide(i: any, decision: "approve" | "reject") {
    const note = decision === "reject" ? window.prompt(`Reject ${i.no}? Tell the plant why:`) : "";
    if (decision === "reject" && !note) return;
    const j = await post("/api/stock/purchase", { action: "indent.decide", id: i.id, decision, note });
    if (j) setOk(`${i.no} ${decision === "approve" ? "approved" : "rejected"}.`);
  }

  return (
    <div className="space-y-3">
      <section className={card}>
        <SectionTitle icon={ClipboardList} title="Spare-part requirements" sub="Raised by the plants (and by procurement). Approve, reject, or tick several from one plant and make one PO."
          right={<button onClick={() => setShowNew(!showNew)} className={chip}><Plus size={11} /> {showNew ? "Close" : "New requirement"}</button>} />
        {showNew && (
          <div className="mb-4 rounded-xl border border-biome-line bg-biome-bg p-3">
            <IndentForm plants={data.plants} myPlant={data.myPlant} machines={data.machines} items={(data.items as any[]).filter((i) => i.active)} urgencyLabels={data.urgencyLabels}
              onSubmit={async (body) => { const j = await post("/api/stock/purchase", { action: "indent.create", ...body }); if (j) { setOk(`${j.indent.no} raised.`); setShowNew(false); } return !!j; }} />
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inline}>
            <option value="pending">Waiting for procurement</option><option value="ordered">PO issued / partly received</option>
            <option value="received">Received</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option><option value="all">All</option>
          </select>
          {pick.length > 0 && (
            <>
              <span className="text-[11px] text-biome-muted">{pick.length} ticked</span>
              <button disabled={!samePlant} onClick={() => go("pos", { indentIds: pick })} className={btn}><FileText size={13} /> Make PO from ticked</button>
              {!samePlant && <span className="text-[10.5px] text-amber-600">Tick requirements of one plant only — a PO has one delivery plant.</span>}
              <button onClick={() => setPick([])} className="text-[11px] text-biome-muted underline">Clear</button>
            </>
          )}
        </div>
        {list.length === 0 ? <Empty>No requirement here.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="w-6 py-2"></th><th>No / date</th><th>Plant</th><th>Parts</th><th>Machine / reason</th><th>Urgency</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {list.map((i) => {
                  const pending = ["open", "approved"].includes(i.status.code);
                  return (
                    <tr key={i.id} className="border-b border-biome-line/60 align-top">
                      <td className="py-2">{pending && <input type="checkbox" aria-label={`Pick ${i.no}`} checked={pick.includes(i.id)} onChange={(e) => setPick(e.target.checked ? [...pick, i.id] : pick.filter((x) => x !== i.id))} />}</td>
                      <td className="py-2"><p className="font-mono font-semibold text-biome-text">{i.no}</p><p className="text-[10px] text-biome-muted">{i.date}{i.requiredBy && ` · need by ${i.requiredBy}`}</p></td>
                      <td>{plantName(data, i.plant)}<p className="text-[10px] text-biome-muted">{i.raisedByName}</p></td>
                      <td>{i.lines.map((l: any) => <p key={l.id} className="text-biome-text">{l.name} <span className="font-mono text-biome-muted">× {l.qty} {l.unit}</span>{!l.itemId && <span className="ml-1 text-[9.5px] text-amber-600">(not in item master)</span>}</p>)}</td>
                      <td className="max-w-[240px] text-[11px]">{i.machineId && <p className="font-semibold text-biome-text">{machines.get(i.machineId)?.name}</p>}<p className="text-biome-muted">{i.reason}</p></td>
                      <td><Badge tone={URGENCY_TONE[i.urgency]}>{i.urgency}</Badge></td>
                      <td><Badge tone={INDENT_TONE[i.status.code] || "grey"}>{i.status.label}</Badge>
                        {i.status.pos.map((p: any) => <p key={p.no} className="mt-0.5 font-mono text-[10px] text-biome-muted">{p.no}</p>)}
                        {i.decisionNote && <p className="mt-0.5 text-[10px] text-biome-muted">“{i.decisionNote}”</p>}</td>
                      <td className="whitespace-nowrap text-right">
                        {i.status.code === "open" && <button onClick={() => decide(i, "approve")} className={`${chip} mr-1`}><CheckCircle2 size={11} /> Approve</button>}
                        {pending && <button onClick={() => decide(i, "reject")} className={`${chip} text-rose-500`}><XCircle size={11} /> Reject</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================================================================== */
/* Purchase orders                                                     */
/* ================================================================== */

const GST = [0, 5, 12, 18, 28];

export function PoTab({ data, post, setOk, setErr, go, seed, clearSeed }: { data: any; post: Post; setOk: (s: string) => void; setErr: (s: string | null) => void; go: Go; seed: any; clearSeed: () => void }) {
  const [editing, setEditing] = useState<any | null>(null);
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Arriving from "Make PO from ticked" or "PO for low stock".
  useEffect(() => {
    if (!seed) return;
    if (seed.indentIds) {
      const inds = (data.indents as any[]).filter((i) => seed.indentIds.includes(i.id));
      const plant = inds[0]?.plant || data.plants[0]?.code;
      const lines: any[] = [];
      for (const ind of inds) for (const l of ind.lines) {
        const it = data.items.find((x: any) => x.id === l.itemId);
        lines.push({ itemId: l.itemId, partNo: l.partNo || it?.partNo || "", description: it?.name || l.name, qty: l.qty, unit: it?.unit || l.unit, rate: "", gstPct: 18, _missing: !l.itemId ? l.name : "" });
      }
      setEditing(blankPo(data, { plant, indentIds: seed.indentIds, lines }));
    } else if (seed.lowStock) {
      const low = (data.rows as any[]).filter((r) => r.status !== "ok" && r.minLevel > 0);
      const plant = low[0]?.plant || data.plants[0]?.code;
      const lines = low.filter((r) => r.plant === plant).map((r) => ({
        itemId: r.itemId, partNo: r.partNo, description: r.name, unit: r.unit, gstPct: 18, rate: r.avgRate || "",
        qty: Math.max(r.minLevel, r.minLevel * 2 - r.qty - (r.onOrder || 0)),
      }));
      setEditing(blankPo(data, { plant, lines }));
    }
    clearSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const list = (data.pos as any[]).filter((p) =>
    (filter === "all" || (filter === "open" ? ["draft", "issued", "partial"].includes(p.status) : p.status === filter)) &&
    (!q || `${p.no} ${p.vendorName} ${p.lines.map((l: any) => l.description).join(" ")}`.toLowerCase().includes(q.toLowerCase())));

  async function act(p: any, action: string, extra: any = {}) {
    setBusy(p.id + action);
    const j = await post("/api/stock/purchase", { action, id: p.id, ...extra });
    setBusy(null);
    return j;
  }
  async function issue(p: any) {
    const email = p.vendorEmail ? window.confirm(`Issue this PO and email the PDF to ${p.vendorEmail}?\n\nOnce issued the number is fixed and the PO is locked.\nOK = issue and email · Cancel = other choices`) : false;
    if (!email && !window.confirm("Issue this PO without emailing it? (You can email it later.)")) return;
    const j = await act(p, "po.issue", { email });
    if (j) { setOk(`PO ${j.po.no} issued.${j.mail ? ` ${j.mail.note}` : ""}`); if (j.mail && !j.mail.ok) setErr(j.mail.note); }
  }
  async function email(p: any) {
    const to = window.prompt("Email the PO PDF to:", p.vendorEmail || "");
    if (!to) return;
    const j = await act(p, "po.email", { to });
    if (j?.mail) { if (j.mail.ok) setOk(j.mail.note); else setErr(j.mail.note); }
  }
  async function reasonAct(p: any, action: "po.cancel" | "po.close") {
    const reason = window.prompt(action === "po.cancel" ? `Cancel ${p.no}? Reason:` : `Short-close ${p.no}? The pending quantity will not come. Reason:`);
    if (!reason) return;
    const j = await act(p, action, { reason });
    if (j) setOk(`${p.no} ${action === "po.cancel" ? "cancelled" : "short-closed"}.`);
  }

  if (editing) return <PoEditor data={data} initial={editing} post={post} onClose={(msg) => { setEditing(null); if (msg) setOk(msg); }} />;

  return (
    <section className={card}>
      <SectionTitle icon={FileText} title="Spare-part purchase orders" sub="Draft → Issued (numbered, locked, PDF, email) → Partially received → Closed. Received quantity comes only from FINAL GRNs."
        right={<button onClick={() => setEditing(blankPo(data, {}))} className={btn}><Plus size={13} /> New PO</button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inline}>
          <option value="open">Open (draft, issued, partial)</option>
          {Object.entries(data.poStatusLabels).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}
          <option value="all">All</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO no, vendor, part" className={`${inline} w-[240px]`} />
      </div>
      {list.length === 0 ? <Empty>No PO here. Start from a requirement, from low stock, or press New PO.</Empty> : (
        <div className="space-y-2">
          {list.map((p) => {
            const ordered = p.lineStatus.reduce((t: number, l: any) => t + l.ordered, 0);
            const got = p.lineStatus.reduce((t: number, l: any) => t + Math.min(l.received, l.ordered), 0);
            const pct = ordered ? Math.round((got / ordered) * 100) : 0;
            return (
              <div key={p.id} className="rounded-xl border border-biome-line bg-biome-bg p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] font-semibold text-biome-text">{p.no || "Draft (no number yet)"}</span>
                  <Badge tone={PO_TONE[p.status]}>{data.poStatusLabels[p.status]}</Badge>
                  {p.overdue && <Badge tone="red">Late</Badge>}
                  {p.pendingGrns > 0 && <Badge tone="amber">{p.pendingGrns} GRN to match</Badge>}
                  <span className="text-[11.5px] text-biome-text">{p.vendorName}</span>
                  <span className="text-[10.5px] text-biome-muted">→ {plantName(data, p.plant)} · {p.date}{p.expectedDate && ` · expected ${p.expectedDate}`}</span>
                  <span className="ml-auto font-mono text-[12px] font-semibold text-biome-text">{inr2(p.totals.total)}</span>
                </div>
                <p className="mt-1 text-[11px] text-biome-muted">{p.lines.map((l: any, i: number) => `${l.description} × ${l.qty} ${l.unit} (rcvd ${p.lineStatus[i]?.received || 0})`).join(" · ")}</p>
                {p.state !== "draft" && p.status !== "cancelled" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-biome-line/60" title={`${pct}% received`}>
                    <div className="h-full rounded-full bg-biome-leaf" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {p.status === "draft" && <>
                    <button onClick={() => setEditing({ ...p, lines: p.lines.map((l: any) => ({ ...l })) })} className={chip}>Edit</button>
                    <button onClick={() => issue(p)} disabled={!!busy} className={btn}>{busy === p.id + "po.issue" ? <Loader2 size={12} className="bmx-spin" /> : <Send size={12} />} Issue PO</button>
                    <button onClick={async () => { if (window.confirm("Delete this draft?")) { const j = await act(p, "po.delete"); if (j) setOk("Draft deleted."); } }} className={`${chip} text-rose-500`}><Trash2 size={11} /> Delete</button>
                  </>}
                  <a href={`/api/stock/pdf?po=${p.id}`} target="_blank" rel="noreferrer" className={chip}><Download size={11} /> PDF</a>
                  {["issued", "partial", "received", "closed"].includes(p.status) && <button onClick={() => email(p)} disabled={!!busy} className={chip}><Mail size={11} /> Email vendor</button>}
                  {["issued", "partial"].includes(p.status) && <button onClick={() => go("grn", { poId: p.id })} className={btn}><PackageCheck size={12} /> Receive material</button>}
                  {p.status === "issued" && <button onClick={() => reasonAct(p, "po.cancel")} className={`${chip} text-rose-500`}><Ban size={11} /> Cancel</button>}
                  {p.status === "partial" && <button onClick={() => reasonAct(p, "po.close")} className={chip}><Scissors size={11} /> Short-close</button>}
                  {p.emails?.length > 0 && <span className="text-[10px] text-biome-muted">{p.emails[p.emails.length - 1].ok ? "✉ emailed" : "✉ email failed"} {p.emails[p.emails.length - 1].at.slice(0, 10)}</span>}
                  {p.grnNos.length > 0 && <span className="ml-auto text-[10px] text-biome-muted">GRN: {p.grnNos.join(", ")}</span>}
                </div>
                {p.stateNote && <p className="mt-1 text-[10.5px] text-biome-muted">Note: {p.stateNote}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function blankPo(data: any, over: any) {
  return {
    id: "", plant: data.plants[0]?.code || "", vendorId: "", vendorEmail: "", date: today(), expectedDate: "",
    paymentTerms: "", deliveryTerms: "Door delivery at our plant, freight inclusive unless stated.", terms: "", notes: "", freight: "",
    indentIds: [], lines: [{ itemId: "", partNo: "", description: "", qty: "", unit: "Nos", rate: "", gstPct: 18 }], ...over,
  };
}

function PoEditor({ data, initial, post, onClose }: { data: any; initial: any; post: Post; onClose: (msg?: string) => void }) {
  const [f, setF] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const items = (data.items as any[]).filter((i) => i.active);
  const vendor = data.vendors.find((v: any) => v.id === f.vendorId);
  const set = (i: number, patch: any) => setF({ ...f, lines: f.lines.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  const totals = f.lines.reduce((t: any, l: any) => {
    const tx = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    return { taxable: t.taxable + tx, gst: t.gst + tx * (Number(l.gstPct) || 0) / 100 };
  }, { taxable: 0, gst: 0 });
  const openIndents = (data.indents as any[]).filter((i) => i.plant === f.plant && ["open", "approved"].includes(i.status.code) || f.indentIds.includes(i.id));

  async function save() {
    setBusy(true);
    const j = await post("/api/stock/purchase", { action: "po.save", ...f, lines: f.lines.filter((l: any) => l.itemId || l.description || l.qty) });
    setBusy(false);
    if (j) onClose(`Draft PO for ${j.po.vendorName} saved — check it, then press Issue PO.`);
  }

  return (
    <section className={card}>
      <SectionTitle icon={FileText} title={f.id ? "Edit draft PO" : "New spare-part PO"} sub="Saved as a draft. Nothing is sent until you press Issue PO."
        right={<button onClick={() => onClose()} className={chip}>Back to list</button>} />
      <div className="grid gap-3 md:grid-cols-4">
        <label><span className={label}>Delivery plant</span>
          <select value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value, indentIds: [] })} className={input}>
            {data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label} ({p.code})</option>)}
          </select></label>
        <label className="md:col-span-2"><span className={label}>Vendor (registered)</span>
          <select value={f.vendorId} onChange={(e) => { const v = data.vendors.find((x: any) => x.id === e.target.value); setF({ ...f, vendorId: e.target.value, vendorEmail: v?.email || "", paymentTerms: f.paymentTerms || v?.paymentTerms || "" }); }} className={input}>
            <option value="">Choose…</option>
            {data.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ""}{v.status !== "active" ? ` — ${v.status}` : ""}</option>)}
          </select>
          {data.vendors.length === 0 && <span className="mt-1 block text-[10px] text-amber-600">No spare-part vendor registered — register one in Vendor &amp; Client Registration and tick “Machine spare parts”.</span>}
          {vendor && <span className="mt-1 block text-[10px] text-biome-muted">{vendor.gstin || "No GSTIN"} · {vendor.address || "no address"}</span>}
        </label>
        <label><span className={label}>Vendor email (for the PO)</span><input value={f.vendorEmail} onChange={(e) => setF({ ...f, vendorEmail: e.target.value })} className={input} /></label>
        <label><span className={label}>PO date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></label>
        <label><span className={label}>Expected delivery</span><input type="date" min={f.date} value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} className={input} /></label>
        <label><span className={label}>Payment terms</span><input value={f.paymentTerms} onChange={(e) => setF({ ...f, paymentTerms: e.target.value })} placeholder="30 days after receipt" className={input} /></label>
        <label><span className={label}>Freight ₹ (if charged)</span><input type="number" min={0} value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} className={input} /></label>
      </div>

      <div className="mt-4 space-y-2">
        {f.lines.map((l: any, i: number) => {
          const tx = (Number(l.qty) || 0) * (Number(l.rate) || 0);
          return (
            <div key={i} className="grid items-end gap-2 rounded-xl border border-biome-line bg-biome-bg p-2.5 md:grid-cols-[1.5fr_1fr_90px_70px_110px_80px_100px_36px]">
              <label><span className={label}>Part {l._missing && <span className="normal-case text-amber-600">— “{l._missing}” not in master</span>}</span>
                <select value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); set(i, { itemId: e.target.value, partNo: it?.partNo || "", description: it?.name || "", unit: it?.unit || "Nos", _missing: "" }); }} className={input}>
                  <option value="">Choose…</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}{it.partNo ? ` · ${it.partNo}` : ""}</option>)}
                </select></label>
              <label><span className={label}>Description on PO</span><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} className={input} /></label>
              <label><span className={label}>Part no</span><input value={l.partNo} onChange={(e) => set(i, { partNo: e.target.value })} className={input} /></label>
              <label><span className={label}>Unit</span><input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} className={input} /></label>
              <label><span className={label}>Qty</span><input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className={input} /></label>
              <label><span className={label}>GST %</span><select value={l.gstPct} onChange={(e) => set(i, { gstPct: Number(e.target.value) })} className={input}>{GST.map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
              <label><span className={label}>Rate ₹</span><input type="number" min={0} step="any" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} className={input} /><span className="mt-0.5 block text-right font-mono text-[10px] text-biome-muted">{inr2(tx)}</span></label>
              <button type="button" aria-label="Remove line" onClick={() => setF({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_: any, j: number) => j !== i) : f.lines })} className="mb-5 rounded-lg border border-biome-line p-2 text-rose-500"><Trash2 size={12} /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => setF({ ...f, lines: [...f.lines, { itemId: "", partNo: "", description: "", qty: "", unit: "Nos", rate: "", gstPct: 18 }] })} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted"><Plus size={12} /> Add line</button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label><span className={label}>Delivery terms</span><textarea rows={2} value={f.deliveryTerms} onChange={(e) => setF({ ...f, deliveryTerms: e.target.value })} className={input} /></label>
        <label><span className={label}>Terms & conditions (blank = standard terms)</span><textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} className={input} /></label>
        <label className="md:col-span-2"><span className={label}>Notes to vendor</span><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={input} /></label>
      </div>

      {openIndents.length > 0 && (
        <div className="mt-3 rounded-xl border border-biome-line bg-biome-bg p-3">
          <span className={label}>Requirements this PO fulfils</span>
          <div className="flex flex-wrap gap-2">
            {openIndents.map((i: any) => (
              <label key={i.id} className="flex items-center gap-1.5 rounded-lg border border-biome-line px-2 py-1 text-[11px] text-biome-text">
                <input type="checkbox" checked={f.indentIds.includes(i.id)} onChange={(e) => setF({ ...f, indentIds: e.target.checked ? [...f.indentIds, i.id] : f.indentIds.filter((x: string) => x !== i.id) })} />
                {i.no} · {i.lines.map((l: any) => l.name).join(", ").slice(0, 50)}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-biome-line pt-3">
        <span className="font-mono text-[11.5px] text-biome-muted">Taxable {inr2(totals.taxable)} · GST {inr2(totals.gst)}{Number(f.freight) ? ` · Freight ${inr2(Number(f.freight))}` : ""}</span>
        <span className="font-mono text-[13px] font-semibold text-biome-text">Total {inr2(totals.taxable + totals.gst + (Number(f.freight) || 0))}</span>
        <button onClick={save} disabled={busy} className={`${btn} ml-auto`}>{busy ? <Loader2 size={13} className="bmx-spin" /> : <CheckCircle2 size={13} />} Save draft</button>
      </div>
    </section>
  );
}

/* ================================================================== */
/* Goods receipt (GRN) — record, match against the PO, Match & OK      */
/* ================================================================== */

export function GrnTab({ data, post, setOk, seed, clearSeed, reload }: { data: any; post: Post; setOk: (s: string) => void; seed: any; clearSeed: () => void; reload: () => void }) {
  const openPos = (data.pos as any[]).filter((p) => p.status === "issued" || p.status === "partial");
  const [form, setForm] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [filter, setFilter] = useState("draft");

  useEffect(() => {
    if (seed?.poId) startFor(seed.poId);
    if (seed) clearSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  function startFor(poId: string, existing?: any) {
    const po = data.pos.find((p: any) => p.id === poId);
    if (!po) return;
    setForm({
      id: existing?.id || "", poId,
      date: existing?.date || today(), invoiceNo: existing?.invoiceNo || "", invoiceDate: existing?.invoiceDate || "", challanNo: existing?.challanNo || "",
      vehicleNo: existing?.vehicleNo || "", remarks: existing?.remarks || "", files: [] as File[],
      lines: po.lines.map((l: any, i: number) => {
        const g = existing?.lines.find((x: any) => x.poLineId === l.id);
        return { poLineId: l.id, receivedQty: g ? g.receivedQty : "", damagedQty: g ? g.damagedQty : "", invoiceRate: g?.invoiceRate || "", remarks: g?.remarks || "", _pending: po.lineStatus[i]?.pending ?? l.qty };
      }),
    });
    setView(null);
  }

  async function saveDraft() {
    const { files, ...body } = form;
    const j = await post("/api/stock/purchase", { action: "grn.save", ...body });
    if (!j) return;
    if (files.length) {
      const fd = new FormData(); fd.append("no", j.grn.no); files.forEach((f: File) => fd.append("file", f));
      await fetch("/api/stock/attachment", { method: "POST", body: fd }).catch(() => null);
      reload();
    }
    setOk(`${j.grn.no} saved as draft — check the match below and press Match & OK.`);
    setForm(null); setView(j.grn.id);
  }

  const grns = (data.grns as any[]).filter((g) => filter === "all" || g.state === filter);
  const shown = view ? data.grns.find((g: any) => g.id === view) : null;

  return (
    <div className="space-y-3">
      {!form && (
        <section className={card}>
          <SectionTitle icon={PackageCheck} title="Goods receipt against PO" sub="Material arrived? Choose the PO / consignment, enter what came, check the match, then press Match & OK. Only then does stock go up." />
          {openPos.length === 0 ? <Empty>No open PO to receive against. Issue a PO first.</Empty> : (
            <div className="flex flex-wrap items-center gap-2">
              <select defaultValue="" onChange={(e) => e.target.value && startFor(e.target.value)} className={`${inline} min-w-[320px]`} aria-label="Choose PO to receive">
                <option value="">Choose the PO this material came against…</option>
                {openPos.map((p) => <option key={p.id} value={p.id}>{p.no} · {p.vendorName} · {p.plant} ({data.poStatusLabels[p.status]})</option>)}
              </select>
            </div>
          )}
        </section>
      )}

      {form && <GrnForm data={data} form={form} setForm={setForm} onSave={saveDraft} onCancel={() => setForm(null)} />}

      {shown && <GrnMatchCard data={data} g={shown} post={post} setOk={setOk} onEdit={() => startFor(shown.poId, shown)} onClose={() => setView(null)} reload={reload} />}

      <section className={card}>
        <SectionTitle icon={ClipboardList} title="GRN register" right={
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inline}>
            <option value="draft">Waiting for Match & OK</option><option value="final">Final</option><option value="all">All</option>
          </select>} />
        {grns.length === 0 ? <Empty>No GRN here.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="py-2">GRN / date</th><th>PO</th><th>Vendor</th><th>Invoice / challan / vehicle</th><th>Match</th><th>State</th><th></th></tr></thead>
              <tbody>
                {grns.map((g) => {
                  const flags = g.match ? Array.from(new Set(g.match.lines.filter((l: any) => l.receivedQty > 0 || l.pendingBefore > 0).flatMap((l: any) => l.flags))) as string[] : [];
                  return (
                    <tr key={g.id} className="border-b border-biome-line/60">
                      <td className="py-2"><p className="font-mono font-semibold text-biome-text">{g.no}</p><p className="text-[10px] text-biome-muted">{g.date} · {g.plant}</p></td>
                      <td className="font-mono text-[10.5px]">{g.poNo}</td>
                      <td>{g.vendorName}</td>
                      <td className="text-[10.5px] text-biome-muted">{g.invoiceNo && `inv ${g.invoiceNo}`}{g.challanNo && ` · ch ${g.challanNo}`}{g.vehicleNo && ` · ${g.vehicleNo}`}<br /><Attachments list={data.attachments?.[g.no]} no={g.no} /></td>
                      <td><span className="flex flex-wrap gap-1">{flags.map((f) => <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Badge>)}</span></td>
                      <td>{g.state === "final" ? <Badge tone="green"><Lock size={9} className="mr-1" />Final</Badge> : <Badge tone="amber">Draft</Badge>}</td>
                      <td className="text-right"><button onClick={() => { setForm(null); setView(g.id); }} className={chip}><Eye size={11} /> Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function GrnForm({ data, form, setForm, onSave, onCancel }: { data: any; form: any; setForm: (f: any) => void; onSave: () => Promise<void>; onCancel: () => void }) {
  const po = data.pos.find((p: any) => p.id === form.poId);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: any) => setForm({ ...form, lines: form.lines.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <section className={card}>
      <SectionTitle icon={PackageCheck} title={`${form.id ? "Edit draft GRN" : "Receive material"} · ${po.no}`} sub={`${po.vendorName} → ${plantName(data, po.plant)}`} right={<button onClick={onCancel} className={chip}>Cancel</button>} />
      <div className="grid gap-3 md:grid-cols-6">
        <label><span className={label}>Received date</span><input type="date" max={today()} min={po.date} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} /></label>
        <label><span className={label}>Vendor invoice no</span><input value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} className={input} /></label>
        <label><span className={label}>Invoice date</span><input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} className={input} /></label>
        <label><span className={label}>Challan no</span><input value={form.challanNo} onChange={(e) => setForm({ ...form, challanNo: e.target.value })} className={input} /></label>
        <label><span className={label}>Vehicle no</span><input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} placeholder="HR55AB1234" className={input} /></label>
        <label><span className={label}>Remarks</span><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={input} /></label>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[11.5px]">
          <thead><tr className={th}><th className="py-2">Part</th><th className="text-right">Ordered</th><th className="text-right">Pending</th><th>Received now</th><th>Of which damaged</th><th>Invoice rate ₹ (blank = PO)</th><th>Remarks</th></tr></thead>
          <tbody>
            {po.lines.map((l: any, i: number) => (
              <tr key={l.id} className="border-b border-biome-line/60">
                <td className="py-1.5"><p className="font-semibold text-biome-text">{l.description}</p><p className="text-[10px] text-biome-muted">{l.partNo} · PO rate {inr2(l.rate)}</p></td>
                <td className="text-right font-mono">{l.qty} {l.unit}</td>
                <td className="text-right font-mono">{form.lines[i]._pending}</td>
                <td className="px-1"><input type="number" min={0} step="any" aria-label={`Received ${l.description}`} value={form.lines[i].receivedQty} onChange={(e) => set(i, { receivedQty: e.target.value })} className={input} /></td>
                <td className="px-1"><input type="number" min={0} step="any" aria-label={`Damaged ${l.description}`} value={form.lines[i].damagedQty} onChange={(e) => set(i, { damagedQty: e.target.value })} className={input} /></td>
                <td className="px-1"><input type="number" min={0} step="any" value={form.lines[i].invoiceRate} onChange={(e) => set(i, { invoiceRate: e.target.value })} className={input} /></td>
                <td className="px-1"><input value={form.lines[i].remarks} onChange={(e) => set(i, { remarks: e.target.value })} className={input} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded-xl border border-dashed border-biome-line bg-biome-bg p-3">
        <span className={label}>Invoice / challan / photos of the material (PDF or photo)</span>
        <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setForm({ ...form, files: Array.from(e.target.files || []) })}
          className="block w-full text-[11px] text-biome-muted file:mr-3 file:rounded-lg file:border-0 file:bg-biome-leaf file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white" />
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={async () => { setBusy(true); await onSave(); setBusy(false); }} disabled={busy} className={btn}>{busy ? <Loader2 size={13} className="bmx-spin" /> : <CheckCircle2 size={13} />} Save &amp; check match</button>
      </div>
    </section>
  );
}

function GrnMatchCard({ data, g, post, setOk, onEdit, onClose, reload }: { data: any; g: any; post: Post; setOk: (s: string) => void; onEdit: () => void; onClose: () => void; reload: () => void }) {
  const [note, setNote] = useState(g.matchNote || "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = g.match;
  const po = data.pos.find((p: any) => p.id === g.poId);
  async function finalise() {
    setBusy(true);
    const j = await post("/api/stock/purchase", { action: "grn.final", id: g.id, matchNote: note, confirm });
    setBusy(false);
    if (j) setOk(`${g.no} is FINAL — stock updated at ${g.plant}. PO ${j.po.no} is now “${data.poStatusLabels[j.po.status]}”.`);
  }
  async function reopen() {
    const reason = window.prompt(`Reopen FINAL ${g.no}? Stock from it will be taken back out. Reason:`);
    if (!reason) return;
    const j = await post("/api/stock/purchase", { action: "grn.reopen", id: g.id, reason });
    if (j) setOk(`${g.no} reopened as draft.`);
  }
  async function del() {
    if (!window.confirm(`Delete draft ${g.no}?`)) return;
    const j = await post("/api/stock/purchase", { action: "grn.delete", id: g.id });
    if (j) { setOk(`${g.no} deleted.`); onClose(); }
  }
  return (
    <section className={`${card} border-biome-leaf/40`}>
      <SectionTitle icon={PackageCheck} title={`${g.no} · match against ${g.poNo}`} sub={`${g.vendorName} · received ${g.date} at ${plantName(data, g.plant)}${g.vehicleNo ? ` · ${g.vehicleNo}` : ""}${g.invoiceNo ? ` · invoice ${g.invoiceNo}` : ""}`}
        right={<div className="flex items-center gap-2">{g.state === "final" ? <Badge tone="green"><Lock size={9} className="mr-1" />Final · {g.finalByName}</Badge> : <Badge tone="amber">Draft</Badge>}<button onClick={onClose} className={chip}>Close</button></div>} />
      {m && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[11.5px]">
            <thead><tr className={th}><th className="py-2">Part</th><th className="text-right">Ordered</th><th className="text-right">Earlier GRNs</th><th className="text-right">Pending</th><th className="text-right">Received</th><th className="text-right">Damaged</th><th className="text-right">Accepted → stock</th><th className="text-right">PO rate / invoice rate</th><th>Result</th></tr></thead>
            <tbody>
              {m.lines.map((l: any) => (
                <tr key={l.poLineId} className="border-b border-biome-line/60">
                  <td className="py-1.5 font-semibold text-biome-text">{l.description}</td>
                  <td className="text-right font-mono">{l.ordered} {l.unit}</td>
                  <td className="text-right font-mono text-biome-muted">{l.receivedBefore}</td>
                  <td className="text-right font-mono">{l.pendingBefore}</td>
                  <td className="text-right font-mono">{l.receivedQty}</td>
                  <td className={`text-right font-mono ${l.damagedQty ? "text-rose-500" : "text-biome-muted"}`}>{l.damagedQty}</td>
                  <td className="text-right font-mono font-semibold text-emerald-600">{l.acceptedQty}</td>
                  <td className={`text-right font-mono ${Math.abs(l.rateDiff) > 0.004 ? "text-sky-600" : ""}`}>{inr2(l.poRate)} / {inr2(l.invoiceRate)}</td>
                  <td><span className="flex flex-wrap gap-1">{l.flags.map((f: string) => <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}{f === "short" ? ` ${l.short}` : f === "excess" ? ` ${l.excess}` : ""}</Badge>)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
        Documents: <Attachments list={data.attachments?.[g.no]} no={g.no} /> <AttachButton no={g.no} text="+ attach" onDone={reload} />
      </div>
      {g.reopens?.length > 0 && <p className="mt-1 text-[10.5px] text-amber-600">Reopened: {g.reopens.map((r: any) => `${r.at.slice(0, 10)} by ${r.byName} — ${r.reason}`).join("; ")}</p>}
      {g.state === "draft" ? (
        <div className="mt-3 space-y-2 rounded-xl border border-biome-line bg-biome-bg p-3">
          {m?.needsNote && <p className="text-[11px] font-semibold text-amber-600">Excess quantity or a rate difference against the PO — write a note before pressing Match &amp; OK.</p>}
          <label><span className={label}>Match note {m?.needsNote ? "(required)" : "(optional)"}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vendor sent 2 extra belts as replacement for last damaged lot / rate revised per mail of 05-10" className={input} /></label>
          <label className="flex items-center gap-2 text-[11.5px] text-biome-text">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have matched this receipt against PO {g.poNo} and the material at the plant.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onEdit} className={chip}>Edit quantities</button>
            <button onClick={del} className={`${chip} text-rose-500`}><Trash2 size={11} /> Delete draft</button>
            <button onClick={finalise} disabled={busy || !confirm || po?.state !== "issued"} className={`${btn} ml-auto`}>{busy ? <Loader2 size={13} className="bmx-spin" /> : <CheckCircle2 size={13} />} Match &amp; OK — make final</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
          <Lock size={12} /> Final {g.finalAt?.slice(0, 16).replace("T", " ")} by {g.finalByName}. Locked.{g.matchNote && ` Note: ${g.matchNote}`}
          {data.canApprove && <button onClick={reopen} className={`${chip} ml-auto`}><Unlock size={11} /> Reopen (admin)</button>}
        </div>
      )}
    </section>
  );
}
