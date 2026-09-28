"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Mail, MessageCircle, Loader2, CheckCircle2, AlertTriangle, Filter, Plus, History } from "lucide-react";

/**
 * Follow-ups: everything a vendor or client still owes us, with a ready
 * message to ask for it — by email (Settings → Mail) or WhatsApp (the
 * linked account; if the agent is off, WhatsApp opens with the text ready).
 */

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";

export default function FollowupsPage() {
  const [data, setData] = useState<any>(null);
  const [kind, setKind] = useState("all");
  const [sel, setSel] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"pending" | "sent">("pending");

  const load = useCallback(async () => {
    const r = await fetch("/api/followups", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep links: /followups?tripId=… or ?partnerId=… opens that party's first item.
  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams(location.search);
    const trip = q.get("tripId") || q.get("followup"); const partner = q.get("partnerId");
    const hit = data.items.find((i: any) => (trip && i.tripId === trip) || (partner && i.partnerId === partner));
    if (hit && !sel) open(hit);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(item: any) {
    setSel(item); setMsg(null);
    setDraft({ key: item.key, kind: item.kind, party: item.partyName, email: item.email, phone: item.phone, subject: item.subject, body: item.body });
  }
  function custom() {
    setSel({ title: "New message", kind: "custom" }); setMsg(null);
    setDraft({ key: `custom:${Date.now()}`, kind: "custom", party: "", email: "", phone: "", subject: "", body: "" });
  }

  async function send(channel: "email" | "whatsapp") {
    setBusy(channel); setMsg(null);
    try {
      const r = await fetch("/api/followups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to: channel === "email" ? draft.email : draft.phone, subject: draft.subject, body: channel === "whatsapp" && draft.subject ? `*${draft.subject}*\n\n${draft.body}` : draft.body, kind: draft.kind, key: draft.key, party: draft.party }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Not sent.");
      if (j.link) { window.open(j.link, "_blank"); setMsg({ ok: true, text: j.note }); }
      else setMsg({ ok: true, text: channel === "email" ? `Email sent to ${draft.email}.` : `WhatsApp sent to ${draft.phone}.` });
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  const items = useMemo(() => (data?.items || []).filter((i: any) => kind === "all" || i.kind === kind), [data, kind]);
  if (!data) return <p className="text-[12px] text-biome-muted"><Loader2 size={13} className="bmx-spin mr-1 inline" /> Loading…</p>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text"><Inbox size={19} className="text-biome-leaf" /> Follow-ups</h1>
          <p className="mt-1 max-w-[760px] text-[11.5px] text-biome-muted">
            What vendors and clients still owe — tax invoices, credit notes, supply papers, KYC, PO extensions. Open one, check the message, send by email or WhatsApp.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["pending", "sent"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`bmx-chip flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${tab === t ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
              {t === "pending" ? <Inbox size={12} /> : <History size={12} />} {t === "pending" ? `Pending (${data.items.length})` : `Sent (${data.log.length})`}
            </button>
          ))}
          <button onClick={custom} className="bmx-btn flex items-center gap-1 rounded-xl bg-biome-leaf px-3 py-1.5 text-[11px] font-bold text-white"><Plus size={12} /> New message</button>
        </div>
      </header>

      {tab === "sent" ? (
        <section className="space-y-1.5">
          {data.log.length === 0 && <p className="text-[11.5px] text-biome-muted">Nothing sent yet.</p>}
          {data.log.map((l: any) => (
            <div key={l.id} className="rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2">
              <p className="text-[11.5px] font-semibold text-biome-text">{l.channel === "email" ? "✉" : "🟢"} {l.party || l.to} — {l.subject || l.kind}</p>
              <p className="text-[10px] text-biome-muted">{new Date(l.at).toLocaleString("en-IN")} · {l.channel.replace("_", " ")} → {l.to} · {l.byName}{l.error ? ` · ${l.error}` : ""}</p>
            </div>
          ))}
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Filter size={13} className="text-biome-muted" />
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text">
                <option value="all">Everything pending</option>
                {data.kinds.filter((k: any) => k.id !== "custom").map((k: any) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            {items.length === 0 && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/[.06] px-3 py-3 text-[11.5px] text-emerald-700">Nothing pending here.</p>}
            {items.map((i: any) => (
              <button key={i.key} onClick={() => open(i)}
                className={`block w-full rounded-xl border px-3 py-2.5 text-left ${sel?.key === i.key ? "border-biome-leaf/50 bg-biome-leaf/[.08]" : "border-biome-line bg-biome-bgSoft"}`}>
                <p className="text-[11.5px] font-semibold text-biome-text">{i.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] text-biome-muted">{i.detail}</p>
                <p className="mt-1 text-[9.5px] text-biome-muted">
                  {data.kinds.find((k: any) => k.id === i.kind)?.label}
                  {i.lastSent ? ` · last asked ${new Date(i.lastSent.at).toLocaleDateString("en-IN")} by ${i.lastSent.by} (${i.lastSent.channel})` : " · not asked yet"}
                  {!i.email && !i.phone ? " · no contact on file" : ""}
                </p>
              </button>
            ))}
          </section>

          <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
            {!draft ? (
              <p className="text-[11.5px] text-biome-muted">Choose a follow-up on the left, or write a new message.</p>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[12.5px] font-semibold text-biome-text">{sel?.title}</p>
                {msg && (
                  <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-700" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
                    {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} className="text-rose-500" />} {msg.text}
                  </p>
                )}
                <div className="grid gap-2 md:grid-cols-3">
                  <label><span className={lbl}>To (party)</span><input value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} className={input} /></label>
                  <label><span className={lbl}>Email</span><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="accounts@vendor.com" className={input} /></label>
                  <label><span className={lbl}>WhatsApp number</span><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="98XXXXXXXX" className={input} /></label>
                </div>
                <label><span className={lbl}>Subject</span><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={input} /></label>
                <label><span className={lbl}>Message</span><textarea rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${input} resize-y font-[inherit]`} /></label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => send("email")} disabled={!draft.email || !!busy} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                    {busy === "email" ? <Loader2 size={13} className="bmx-spin" /> : <Mail size={13} />} Send email
                  </button>
                  <button onClick={() => send("whatsapp")} disabled={!draft.phone || !!busy} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                    {busy === "whatsapp" ? <Loader2 size={13} className="bmx-spin" /> : <MessageCircle size={13} />} Send WhatsApp
                  </button>
                </div>
                <p className="text-[10px] text-biome-muted">Email uses Settings → Mail. WhatsApp goes from the linked company number; if it is not connected, WhatsApp opens with this message ready to send. Contacts come from Vendor &amp; Client Registration — fill them there once.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
