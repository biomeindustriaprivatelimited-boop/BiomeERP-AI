"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, Send, Undo2 } from "lucide-react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { Msg, card, th, chip, inline, Badge, Empty, SectionTitle, INDENT_TONE, URGENCY_TONE } from "@/components/spares/ui";
import { IndentForm } from "@/components/spares/IndentForm";

/**
 * Spare-part requirements — the plant's side.
 *
 * A plant manager tells procurement what the plant needs and follows it:
 * waiting → approved → PO issued (number + expected date) → received.
 * No rates, values, vendors or stock balances here: spare parts and
 * machinery are procurement's (owner's rule).
 */
export default function IndentPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [filter, setFilter] = useState("active");

  const load = useCallback(async () => {
    const res = await fetch("/api/stock/indent", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Could not load."); return; }
    setData(json);
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load());

  async function post(body: any) {
    setErr(null); setOk(null);
    const res = await fetch("/api/stock/indent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || `Failed (${res.status}).`); return null; }
    await load();
    return json;
  }

  if (!data) return err ? <Msg err={err} ok={null} /> : <div className="flex items-center gap-2 text-[12px] text-biome-muted"><Loader2 size={14} className="bmx-spin" /> Loading…</div>;
  const machines = new Map((data.machines as any[]).map((m) => [m.id, m]));
  const list = (data.indents as any[]).filter((i) => filter === "all" || (filter === "active" ? !["received", "rejected", "withdrawn"].includes(i.status.code) : i.status.code === filter));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text"><ClipboardList size={19} className="text-biome-leaf" /> Spare-part requirements</h1>
        <p className="mt-1 max-w-[720px] text-[11.5px] leading-relaxed text-biome-muted">
          Tell procurement what your plant needs. They order it, and you can see here when the PO is issued, when it is expected and when it reached the plant.
        </p>
      </header>
      <Msg err={err} ok={ok} />
      <section className={card}>
        <SectionTitle icon={Send} title="Raise a requirement" />
        {data.plants.length === 0 ? <Empty>Sign in for your plant to raise a requirement.</Empty> : (
          <IndentForm plants={data.plants} myPlant={data.myPlant} machines={data.machines} items={data.items} urgencyLabels={data.urgencyLabels}
            onSubmit={async (body) => { const j = await post({ action: "create", ...body }); if (j) setOk(`${j.indent.no} sent to procurement.`); return !!j; }} />
        )}
      </section>
      <section className={card}>
        <SectionTitle icon={ClipboardList} title="My plant’s requirements" right={
          <select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className={inline}>
            <option value="active">Not yet received</option><option value="received">Received</option><option value="rejected">Rejected</option><option value="all">All</option>
          </select>} />
        {list.length === 0 ? <Empty>Nothing here.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[11.5px]">
              <thead><tr className={th}><th className="py-2">No / date</th><th>Parts</th><th>Machine / reason</th><th>Urgency</th><th>Status</th><th>PO / expected</th><th></th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="border-b border-biome-line/60 align-top">
                    <td className="py-2"><p className="font-mono font-semibold text-biome-text">{i.no}</p><p className="text-[10px] text-biome-muted">{i.date} · {i.raisedByName}</p></td>
                    <td>{i.lines.map((l: any) => <p key={l.id} className="text-biome-text">{l.name} <span className="font-mono text-biome-muted">× {l.qty} {l.unit}</span></p>)}</td>
                    <td className="max-w-[240px] text-[11px]">{i.machineId && <p className="font-semibold text-biome-text">{machines.get(i.machineId)?.name}</p>}<p className="text-biome-muted">{i.reason}</p></td>
                    <td><Badge tone={URGENCY_TONE[i.urgency]}>{i.urgency}</Badge></td>
                    <td><Badge tone={INDENT_TONE[i.status.code] || "grey"}>{i.status.label}</Badge>{i.decisionNote && <p className="mt-0.5 text-[10px] text-biome-muted">“{i.decisionNote}”</p>}</td>
                    <td className="text-[10.5px]">{i.status.pos.map((p: any) => <p key={p.no} className="font-mono text-biome-text">{p.no}{p.expectedDate && <span className="text-biome-muted"> · by {p.expectedDate}</span>}</p>)}</td>
                    <td className="text-right">{i.mine && i.status.code === "open" && (
                      <button onClick={async () => { if (!window.confirm(`Withdraw ${i.no}?`)) return; const j = await post({ action: "withdraw", id: i.id }); if (j) setOk(`${i.no} withdrawn.`); }} className={chip}><Undo2 size={11} /> Withdraw</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
