"use client";

import { useState } from "react";
import { CalendarClock, ClipboardCheck, Plus, Trash2, Loader2, XCircle, BarChart3, Download, Wrench } from "lucide-react";
import { inr, input, inline, label, card, th, btn, chip, today, Badge, Empty, SectionTitle, type Post } from "@/components/spares/ui";

/* ================================================================== */
/* Preventive maintenance + maintenance log                            */
/* ================================================================== */

export function MaintenanceTab({ data, post, setOk }: { data: any; post: Post; setOk: (s: string) => void }) {
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  const blankS = { id: "", machineId: "", task: "", checklist: "", everyDays: "", everyHours: "", lastDoneDate: "", lastDoneHours: "", active: true };
  const [sf, setSf] = useState<any>(blankS);
  const [showS, setShowS] = useState(false);
  const [log, setLog] = useState<any | null>(null);
  const sched = [...(data.schedules as any[])].sort((a, b) => rank(a) - rank(b));

  async function saveSchedule() {
    const j = await post("/api/stock/maintenance", { action: "schedule.save", ...sf });
    if (j) { setOk(`Schedule “${j.schedule.task}” saved.`); setSf(blankS); setShowS(false); }
  }

  return (
    <div className="space-y-3">
      <section className={card}>
        <SectionTitle icon={CalendarClock} title="Preventive maintenance schedule" sub="Every N days and/or every N running hours per machine. Due within 3 days (or 10% of the hours) shows amber; past due shows red."
          right={<div className="flex gap-2">
            <button onClick={() => { setSf(blankS); setShowS(!showS); }} className={chip}><Plus size={11} /> Schedule</button>
            <button onClick={() => setLog({ machineId: "", kind: "breakdown", scheduleId: "" })} className={btn}><ClipboardCheck size={13} /> Log a job</button>
          </div>} />
        {showS && (
          <div className="mb-3 grid gap-2 rounded-xl border border-biome-line bg-biome-bg p-3 md:grid-cols-4">
            <label className="md:col-span-2"><span className={label}>Machine</span>
              <select value={sf.machineId} onChange={(e) => setSf({ ...sf, machineId: e.target.value })} className={input} disabled={!!sf.id}>
                <option value="">Choose…</option>{(data.machines as any[]).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.plant} · {m.code} · {m.name}</option>)}
              </select></label>
            <label className="md:col-span-2"><span className={label}>Task</span><input value={sf.task} onChange={(e) => setSf({ ...sf, task: e.target.value })} placeholder="Grease main bearings / change die & rollers" className={input} /></label>
            <label><span className={label}>Every N days</span><input type="number" min={0} value={sf.everyDays} onChange={(e) => setSf({ ...sf, everyDays: e.target.value })} className={input} /></label>
            <label><span className={label}>Every N running hours</span><input type="number" min={0} value={sf.everyHours} onChange={(e) => setSf({ ...sf, everyHours: e.target.value })} className={input} /></label>
            <label><span className={label}>Last done on</span><input type="date" max={today()} value={sf.lastDoneDate} onChange={(e) => setSf({ ...sf, lastDoneDate: e.target.value })} className={input} /></label>
            <label><span className={label}>Last done at (hours)</span><input type="number" min={0} value={sf.lastDoneHours} onChange={(e) => setSf({ ...sf, lastDoneHours: e.target.value })} placeholder={sf.machineId ? String(machines.get(sf.machineId)?.runningHours ?? "") : ""} className={input} /></label>
            <label className="md:col-span-3"><span className={label}>Checklist</span><input value={sf.checklist} onChange={(e) => setSf({ ...sf, checklist: e.target.value })} placeholder="Check belt tension; clean cooler; grease 4 points" className={input} /></label>
            <div className="flex items-end gap-2">
              {sf.id && <label className="flex items-center gap-1.5 pb-2 text-[11px] text-biome-text"><input type="checkbox" checked={sf.active} onChange={(e) => setSf({ ...sf, active: e.target.checked })} /> Active</label>}
              <button onClick={saveSchedule} className={btn}>Save</button>
            </div>
          </div>
        )}
        {sched.length === 0 ? <Empty>No schedule yet. Add one for each machine’s routine work (greasing, die change, belt check…).</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="py-2">Machine</th><th>Task</th><th>Frequency</th><th>Last done</th><th>Next due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {sched.map((x) => {
                  const m = machines.get(x.machineId);
                  return (
                    <tr key={x.id} className={`border-b border-biome-line/60 ${x.active ? "" : "opacity-50"}`}>
                      <td className="py-2"><p className="font-semibold text-biome-text">{m?.name || "?"}</p><p className="text-[10px] text-biome-muted">{m?.code} · {x.plant} · meter {m?.runningHours ?? 0} h</p></td>
                      <td><p className="text-biome-text">{x.task}</p>{x.checklist && <p className="text-[10px] text-biome-muted">{x.checklist}</p>}</td>
                      <td className="text-[11px]">{[x.everyDays ? `${x.everyDays} days` : "", x.everyHours ? `${x.everyHours} h` : ""].filter(Boolean).join(" / ")}</td>
                      <td className="text-[11px] text-biome-muted">{x.lastDoneDate || "—"}{x.lastDoneHours ? ` @ ${x.lastDoneHours} h` : ""}</td>
                      <td className="text-[11px]">{x.due.nextDate && <p>{x.due.nextDate} <span className="text-biome-muted">({x.due.daysLeft >= 0 ? `${x.due.daysLeft} d left` : `${-x.due.daysLeft} d late`})</span></p>}
                        {x.due.nextHours ? <p>@ {x.due.nextHours} h <span className="text-biome-muted">({x.due.hoursLeft >= 0 ? `${x.due.hoursLeft} h left` : `${-x.due.hoursLeft} h over`})</span></p> : null}</td>
                      <td><Badge tone={x.due.status === "overdue" ? "red" : x.due.status === "due" ? "amber" : "green"}>{x.due.status === "ok" ? "On track" : x.due.status}</Badge></td>
                      <td className="whitespace-nowrap text-right">
                        <button onClick={() => setLog({ machineId: x.machineId, kind: "preventive", scheduleId: x.id, work: x.task + (x.checklist ? ` — ${x.checklist}` : "") })} className={`${chip} mr-1`}><ClipboardCheck size={11} /> Done</button>
                        <button onClick={() => { setSf({ ...blankS, ...x }); setShowS(true); }} className={chip}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {log && <LogForm data={data} initial={log} post={post} onClose={(msg) => { setLog(null); if (msg) setOk(msg); }} />}

      <LogList data={data} post={post} setOk={setOk} />
    </div>
  );
}

const rank = (x: any) => (!x.active ? 9 : x.due.status === "overdue" ? 0 : x.due.status === "due" ? 1 : 2);

function LogForm({ data, initial, post, onClose }: { data: any; initial: any; post: Post; onClose: (msg?: string) => void }) {
  const [f, setF] = useState<any>({ date: today(), work: "", doneBy: "", downtimeHours: "", labourCost: "", otherCost: "", hoursReading: "", ...initial });
  const [parts, setParts] = useState<any[]>([{ itemId: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const m = data.machines.find((x: any) => x.id === f.machineId);
  const items = (data.items as any[]).filter((i) => i.active);
  const onHand = (itemId: string) => (data.rows as any[]).find((r) => r.itemId === itemId && r.plant === m?.plant)?.qty ?? 0;
  const fits = new Set(items.filter((i) => f.machineId && i.machineIds.includes(f.machineId)).map((i) => i.id));
  async function save() {
    setBusy(true);
    const j = await post("/api/stock/maintenance", { action: "log.save", ...f, parts: parts.filter((p) => p.itemId) });
    setBusy(false);
    if (j) onClose(`${j.log.no} logged${j.log.partsCost ? ` — parts worth ${inr(j.log.partsCost)} issued from stock` : ""}.`);
  }
  return (
    <section className={`${card} border-biome-leaf/40`}>
      <SectionTitle icon={Wrench} title="Log a maintenance job" sub="Parts used are issued from the plant’s stock under the job number." right={<button onClick={() => onClose()} className={chip}>Cancel</button>} />
      <div className="grid gap-2 md:grid-cols-4">
        <label className="md:col-span-2"><span className={label}>Machine</span>
          <select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value, scheduleId: "" })} className={input}>
            <option value="">Choose…</option>{(data.machines as any[]).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.plant} · {x.code} · {x.name}</option>)}
          </select></label>
        <label><span className={label}>Type</span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={input}>
            {Object.entries(data.maintLabels).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label><span className={label}>Date</span><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></label>
        {f.kind === "preventive" && (
          <label className="md:col-span-2"><span className={label}>Against schedule</span>
            <select value={f.scheduleId} onChange={(e) => setF({ ...f, scheduleId: e.target.value })} className={input}>
              <option value="">— none —</option>{(data.schedules as any[]).filter((x) => x.machineId === f.machineId).map((x) => <option key={x.id} value={x.id}>{x.task}</option>)}
            </select></label>
        )}
        <label className={f.kind === "preventive" ? "md:col-span-2" : "md:col-span-4"}><span className={label}>Work done</span><input value={f.work} onChange={(e) => setF({ ...f, work: e.target.value })} placeholder="Replaced main shaft bearing, re-aligned motor" className={input} /></label>
        <label><span className={label}>Done by</span><input value={f.doneBy} onChange={(e) => setF({ ...f, doneBy: e.target.value })} placeholder="Fitter name / vendor" className={input} /></label>
        <label><span className={label}>Downtime (hours)</span><input type="number" min={0} step="any" value={f.downtimeHours} onChange={(e) => setF({ ...f, downtimeHours: e.target.value })} className={input} /></label>
        <label><span className={label}>Labour ₹</span><input type="number" min={0} value={f.labourCost} onChange={(e) => setF({ ...f, labourCost: e.target.value })} className={input} /></label>
        <label><span className={label}>Other cost ₹</span><input type="number" min={0} value={f.otherCost} onChange={(e) => setF({ ...f, otherCost: e.target.value })} className={input} /></label>
        <label><span className={label}>Hour meter now</span><input type="number" min={0} value={f.hoursReading} onChange={(e) => setF({ ...f, hoursReading: e.target.value })} placeholder={m ? String(m.runningHours) : ""} className={input} /></label>
      </div>
      <div className="mt-3 space-y-2">
        <p className={label}>Parts used (issued from {m?.plant || "the plant’s"} stock)</p>
        {parts.map((p, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-biome-line bg-biome-bg p-2 md:grid-cols-[1fr_110px_120px_36px]">
            <select aria-label="Part used" value={p.itemId} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={input}>
              <option value="">Choose…</option>
              {fits.size > 0 && <optgroup label="Fits this machine">{items.filter((it) => fits.has(it.id)).map((it) => <option key={it.id} value={it.id}>{it.name} — on hand {onHand(it.id)} {it.unit}</option>)}</optgroup>}
              <optgroup label="All parts">{items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name} — on hand {onHand(it.id)} {it.unit}</option>)}</optgroup>
            </select>
            <input type="number" min={0} step="any" aria-label="Quantity used" placeholder="Qty" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={input} />
            <span className="pb-2 text-[10.5px] text-biome-muted">{p.itemId ? `On hand ${onHand(p.itemId)}` : ""}</span>
            <button aria-label="Remove part" onClick={() => setParts(parts.length > 1 ? parts.filter((_, j) => j !== i) : parts)} className="mb-1 rounded-lg border border-biome-line p-2 text-rose-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button onClick={() => setParts([...parts, { itemId: "", qty: "" }])} className={`${chip} py-1.5`}><Plus size={12} /> Add part</button>
          <button onClick={save} disabled={busy} className={`${btn} ml-auto`}>{busy ? <Loader2 size={13} className="bmx-spin" /> : <ClipboardCheck size={13} />} Save job</button>
        </div>
      </div>
    </section>
  );
}

function LogList({ data, post, setOk }: { data: any; post: Post; setOk: (s: string) => void }) {
  const [mf, setMf] = useState("");
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  const list = (data.maintenance as any[]).filter((l) => !mf || l.machineId === mf);
  async function cancel(l: any) {
    const reason = window.prompt(`Cancel ${l.no}? The parts it issued go back to stock. Reason:`);
    if (!reason) return;
    const j = await post("/api/stock/maintenance", { action: "log.cancel", id: l.id, reason });
    if (j) setOk(`${l.no} cancelled.`);
  }
  return (
    <section className={card}>
      <SectionTitle icon={ClipboardCheck} title="Maintenance log" right={
        <select value={mf} onChange={(e) => setMf(e.target.value)} className={inline} aria-label="Filter by machine">
          <option value="">Every machine</option>{(data.machines as any[]).map((m) => <option key={m.id} value={m.id}>{m.plant} · {m.name}</option>)}
        </select>} />
      {list.length === 0 ? <Empty>No job logged yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[11.5px]">
            <thead><tr className={th}><th className="py-2">Job / date</th><th>Machine</th><th>Type</th><th>Work</th><th className="text-right">Downtime</th><th className="text-right">Parts</th><th className="text-right">Labour + other</th><th></th></tr></thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} className={`border-b border-biome-line/60 ${l.cancelled ? "opacity-50 line-through" : ""}`}>
                  <td className="py-1.5"><p className="font-mono font-semibold text-biome-text">{l.no}</p><p className="text-[10px] text-biome-muted">{l.date}</p></td>
                  <td>{machines.get(l.machineId)?.name || "?"}<p className="text-[10px] text-biome-muted">{l.plant}</p></td>
                  <td><Badge tone={l.kind === "breakdown" ? "red" : l.kind === "preventive" ? "green" : "blue"}>{data.maintLabels[l.kind]}</Badge></td>
                  <td className="max-w-[300px] text-[11px]">{l.work}<p className="text-[10px] text-biome-muted">by {l.doneBy}{l.cancelled && ` · cancelled: ${l.cancelReason}`}</p></td>
                  <td className="text-right font-mono">{l.downtimeHours} h</td>
                  <td className="text-right font-mono">{inr(l.partsCost)}</td>
                  <td className="text-right font-mono">{inr(l.labourCost + l.otherCost)}</td>
                  <td>{data.canManage && !l.cancelled && <button aria-label={`Cancel ${l.no}`} onClick={() => cancel(l)} className="rounded-lg border border-biome-line p-1 text-rose-500"><XCircle size={12} /></button>}</td>
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
/* Reports                                                             */
/* ================================================================== */

export function ReportsTab({ data, base = "/api/stock/report", viewOnly = false, preview }: { data: any; base?: string; viewOnly?: boolean; preview?: { vendor: any[]; machine: any[] } }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plant, setPlant] = useState("");
  const qs = (kind: string) => {
    const p = new URLSearchParams();
    p.set(viewOnly ? "xlsx" : "kind", kind);
    if (from) p.set("from", from); if (to) p.set("to", to); if (plant) p.set("plant", plant);
    return `${base}?${p.toString()}`;
  };
  return (
    <section className={card}>
      <SectionTitle icon={BarChart3} title="Spend reports" sub="Excel with the Biome letterhead. Vendor-wise: what each vendor supplied (final GRNs) against what was ordered. Machine-wise: parts issued plus maintenance labour, other cost and downtime." />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label><span className={label}>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inline} /></label>
        <label><span className={label}>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inline} /></label>
        {data.plants.length > 1 && <label><span className={label}>Plant</span><select value={plant} onChange={(e) => setPlant(e.target.value)} className={inline}><option value="">All plants</option>{data.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>}
        <a href={qs("vendor")} className={btn}><Download size={13} /> Vendor-wise spend</a>
        <a href={qs("machine")} className={btn}><Download size={13} /> Machine-wise spend</a>
      </div>
      {preview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className={label}>Top vendors (all dates)</p>
            {preview.vendor.length === 0 ? <Empty>No final GRN yet.</Empty> : preview.vendor.slice(0, 8).map((v) => (
              <div key={v.vendor} className="flex justify-between border-b border-biome-line/60 py-1 text-[11.5px]"><span className="text-biome-text">{v.vendor}</span><span className="font-mono text-biome-text">{inr(v.total)}</span></div>
            ))}
          </div>
          <div>
            <p className={label}>Top machines (all dates)</p>
            {preview.machine.length === 0 ? <Empty>No parts issued / jobs yet.</Empty> : preview.machine.slice(0, 8).map((m) => (
              <div key={m.machine} className="flex justify-between border-b border-biome-line/60 py-1 text-[11.5px]"><span className="text-biome-text">{m.machine}</span><span className="font-mono text-biome-text">{inr(m.total)}</span></div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
