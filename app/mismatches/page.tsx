"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag, Loader2, Mail, MessageCircle, Bell, CheckCircle2, AlertTriangle, Truck, Factory, RotateCcw, StickyNote } from "lucide-react";

/**
 * Mismatches — plant dispatch sheet vs coordination manufacturing register.
 * Accounts / admin / developer only: the one place both books are seen side
 * by side. A row open for 3+ days with no fix and no note is a red flag;
 * send the responsible person a notice in the app, by email or WhatsApp.
 */

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const kg = (n?: number | null) => (n ? `${Math.round(n).toLocaleString("en-IN")} kg` : "—");

function describe(r: any): string {
  if (r.status === "weight_differs") return `Weight differs by ${kg(Math.abs(r.weightDiffKg || 0))} (plant ${kg(r.dispatch?.weightKg)} vs coordination ${kg(r.trip?.weightKg)})`;
  if (r.dispatch && !r.trip) return "In the plant's dispatch sheet, not in the coordination manufacturing register";
  return "In the coordination manufacturing register, not in the plant's dispatch sheet";
}

function draftFor(r: any, person: any): { subject: string; message: string } {
  const veh = r.dispatch?.vehicleRaw || r.trip?.vehicle || "";
  const date = r.since;
  const fix = person.side === "plant"
    ? "Please check the transport (dispatch) sheet of your plant — add the missing entry or correct the vehicle number, date or weight."
    : "Please check the coordination manufacturing register — add the missing trip or correct the vehicle number, date, location (plant) or weight.";
  return {
    subject: `Vehicle mismatch ${veh} (${date}) — please fix`,
    message: [
      `${person.name} ji,`,
      "",
      `Vehicle ${veh} on ${date} at ${r.plantName} plant does not match between the plant dispatch sheet and the coordination register.`,
      `Problem: ${describe(r)}.`,
      `Open for ${r.ageDays} day(s).`,
      "",
      fix,
      "If the difference is correct, add a note against the row in the app so accounts know.",
      "",
      "— Accounts, Biome Industria",
    ].join("\n"),
  };
}

export default function MismatchesPage() {
  const [data, setData] = useState<any>(null);
  const [only, setOnly] = useState<"flagged" | "all">("flagged");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/mismatches", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setData(j); else setMsg({ ok: false, text: j.error || "Could not load." });
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.rows || []).filter((r: any) => only === "all" || r.flagged), [data, only]);
  if (!data) return <p className="text-[12px] text-biome-muted"><Loader2 size={13} className="bmx-spin mr-1 inline" /> Loading…</p>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text"><Flag size={19} className="text-rose-500" /> Plant ↔ Coordination mismatches</h1>
          <p className="mt-1 max-w-[780px] text-[11.5px] text-biome-muted">
            The plant manager&apos;s transport sheet and the coordinator&apos;s manufacturing register are matched automatically on vehicle number, date (±1 day) and weight (kg).
            Anything not fixed or explained within {data.flagAfterDays} days turns red here. Only accounts, admin and developer see both sides.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["flagged", "all"] as const).map((t) => (
            <button key={t} onClick={() => setOnly(t)} className={`bmx-chip rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${only === t ? "border-rose-400/50 bg-rose-500/10 text-rose-600" : "border-biome-line text-biome-muted"}`}>
              {t === "flagged" ? `Red flags (${data.summary.flagged})` : `All open (${data.summary.open})`}
            </button>
          ))}
        </div>
      </header>

      {msg && (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-700" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
          {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} className="text-rose-500" />} {msg.text}
        </p>
      )}

      {rows.length === 0 && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/[.06] px-3 py-3 text-[11.5px] text-emerald-700">
          {only === "flagged" ? "No red flags — every mismatch is either fixed or still inside its 3 days." : "Plant and coordination agree on every vehicle."}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r: any) => (
          <div key={r.key} className={`rounded-2xl border p-3.5 ${r.flagged ? "border-rose-500/45 bg-rose-500/[.05]" : "border-biome-line bg-biome-bgSoft"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-biome-text">
                  {r.flagged && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-white">⚑ Red flag</span>}
                  {r.explained && <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[9.5px] font-bold text-sky-600">Explained</span>}
                  {r.dispatch?.vehicleRaw || r.trip?.vehicle} · {r.since} · {r.plantName}
                  <span className="text-[10.5px] font-normal text-biome-muted">open {r.ageDays} day(s)</span>
                </p>
                <p className="mt-0.5 text-[11px] text-rose-600">{describe(r)}</p>
              </div>
              <button onClick={() => setOpen(open === r.key ? null : r.key)} className="rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-text">{open === r.key ? "Close" : "Details & notify"}</button>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Side icon={<Factory size={12} />} title="Plant transport sheet" v={r.dispatch && [
                ["Date", r.dispatch.date], ["Vehicle", r.dispatch.vehicleRaw], ["Party", r.dispatch.party], ["To", r.dispatch.to], ["Weight", kg(r.dispatch.weightKg)],
              ]} />
              <Side icon={<Truck size={12} />} title="Coordination register" v={r.trip && [
                ["Date", r.trip.date], ["Vehicle", r.trip.vehicle], ["Client", r.trip.client], ["Doc no", r.trip.ourDocNo || "—"], ["Weight", kg(r.trip.weightKg)],
              ]} />
            </div>
            {open === r.key && <Detail row={r} onDone={(m) => { setMsg(m); load(); }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Side({ icon, title, v }: { icon: React.ReactNode; title: string; v: any[] | null }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{icon} {title}</p>
      {!v ? <p className="text-[11px] font-semibold text-rose-500">Not entered</p> : (
        <div className="grid grid-cols-[70px_1fr] gap-x-2 text-[11px]">
          {v.map(([k, val]: any) => [<span key={k + "k"} className="text-biome-muted">{k}</span>, <span key={k + "v"} className="truncate text-biome-text">{val || "—"}</span>])}
        </div>
      )}
    </div>
  );
}

function Detail({ row, onDone }: { row: any; onDone: (m: { ok: boolean; text: string }) => void }) {
  const [who, setWho] = useState(row.responsible[0]?.id || "");
  const person = row.responsible.find((p: any) => p.id === who);
  const [draft, setDraft] = useState(() => (person ? draftFor(row, person) : { subject: "", message: "" }));
  const [to, setTo] = useState<{ email: string; phone: string }>({ email: person?.email || "", phone: person?.phone || "" });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const p = row.responsible.find((x: any) => x.id === who);
    if (p) { setDraft(draftFor(row, p)); setTo({ email: p.email || "", phone: p.phone || "" }); }
  }, [who, row]);

  async function post(body: any, label: string) {
    setBusy(label);
    try {
      const r = await fetch("/api/mismatches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: row.key, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Not sent.");
      if (j.link) window.open(j.link, "_blank");
      onDone({ ok: true, text: j.note || (label === "note" ? "Note saved." : label === "reopen" ? "Flag re-opened." : `Notice sent to ${person?.name}.`) });
    } catch (e) { onDone({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  return (
    <div className="mt-3 space-y-2.5 border-t border-biome-line pt-3">
      {(row.notes.length > 0 || row.notices.length > 0) && (
        <div className="space-y-1">
          {row.notes.map((n: any, i: number) => <p key={"n" + i} className="text-[10.5px] text-biome-text"><StickyNote size={11} className="mr-1 inline text-sky-500" /> <b>{n.byName}</b> ({n.side}) — {n.text} <span className="text-biome-muted">· {new Date(n.at).toLocaleString("en-IN")}</span></p>)}
          {row.notices.map((n: any, i: number) => <p key={"s" + i} className="text-[10.5px] text-biome-muted"><Bell size={11} className="mr-1 inline" /> {n.byName} → {n.toName} by {n.channel.replace("_", " ")}{n.ok ? "" : ` (failed: ${n.error})`} · {new Date(n.at).toLocaleString("en-IN")}</p>)}
        </div>
      )}
      {row.responsible.length === 0 ? (
        <p className="text-[11px] text-biome-muted">No active plant manager / coordinator sign-in to notify for this row. Add one in Users.</p>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Notify</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className={input}>
                {row.responsible.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.side === "plant" ? "plant manager" : "coordinator"}</option>)}
              </select></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Email</span>
              <input value={to.email} onChange={(e) => setTo({ ...to, email: e.target.value })} placeholder="name@company.com" className={input} /></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">WhatsApp number</span>
              <input value={to.phone} onChange={(e) => setTo({ ...to, phone: e.target.value })} placeholder="98XXXXXXXX" className={input} /></label>
          </div>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={input} />
          <textarea rows={8} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} className={`${input} resize-y`} />
          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={() => post({ channel: "app", userId: who, ...draft }, "app")} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-50">{busy === "app" ? <Loader2 size={12} className="bmx-spin" /> : <Bell size={12} />} Notice in app</button>
            <button disabled={!!busy || !to.email} onClick={() => post({ channel: "email", userId: who, to: to.email, ...draft }, "email")} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-50">{busy === "email" ? <Loader2 size={12} className="bmx-spin" /> : <Mail size={12} />} Email</button>
            <button disabled={!!busy || !to.phone} onClick={() => post({ channel: "whatsapp", userId: who, to: to.phone, ...draft }, "whatsapp")} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-50">{busy === "whatsapp" ? <Loader2 size={12} className="bmx-spin" /> : <MessageCircle size={12} />} WhatsApp</button>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Office note (e.g. confirmed with plant — second trip)" className={`${input} max-w-[460px]`} />
        <button disabled={!note || !!busy} onClick={() => post({ action: "note", note, explained: true }, "note")} className="rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-text disabled:opacity-50">Save note &amp; clear flag</button>
        {row.explained && <button disabled={!!busy} onClick={() => post({ action: "reopen" }, "reopen")} className="flex items-center gap-1 rounded-xl border border-rose-400/40 px-3 py-2 text-[11px] font-semibold text-rose-600"><RotateCcw size={12} /> Re-open flag</button>}
      </div>
    </div>
  );
}
