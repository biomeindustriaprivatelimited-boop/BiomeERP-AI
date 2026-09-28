"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Loader2, ShieldAlert, AlertTriangle, CheckCircle2, Archive, Search } from "lucide-react";

/**
 * Developer → Data: wipe test data by module, and delete single records.
 *
 * The wipe is deliberately slow: preview → a 10-second warning that cannot
 * be skipped (the server refuses earlier) → type DELETE. A verified backup
 * is taken first unless it is explicitly switched off.
 */

const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";

export default function DataTab() {
  const [data, setData] = useState<any>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [left, setLeft] = useState(0);
  const [confirm, setConfirm] = useState("");
  const [skipBackup, setSkipBackup] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kind, setKind] = useState("partner");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/developer/data", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!preview || left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [preview, left]);

  async function post(body: any) {
    const r = await fetch("/api/developer/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Failed (${r.status}).`);
    return j;
  }

  async function startPreview() {
    setBusy("preview"); setMsg(null);
    try {
      const j = await post({ action: "preview", scopes: picked });
      setPreview(j); setLeft(j.waitSeconds || 10); setConfirm("");
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function wipe() {
    setBusy("wipe"); setMsg(null);
    try {
      const j = await post({ action: "wipe", scopes: picked, token: preview.token, confirm, skipBackup });
      setMsg({ ok: true, text: `Deleted ${j.files} file(s) from ${j.removed.join(", ") || "—"}.${j.backup ? ` Safety backup: ${j.backup} (Settings → Backup to restore).` : " No backup was taken."}` });
      setPreview(null); setPicked([]); await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function del(id: string, label: string) {
    const typed = window.prompt(`Permanently delete "${label}"?\n\nThis cannot be undone from the screen (restore a backup to get it back).\nType DELETE to confirm.`);
    if (typed !== "DELETE") return;
    setBusy(id); setMsg(null);
    try {
      await post({ action: "deleteRecord", kind, id, confirm: "DELETE" });
      setMsg({ ok: true, text: `"${label}" deleted.` });
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  if (!data) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;
  const records = (data.records?.[kind] || []).filter((r: any) => !q || `${r.label} ${r.sub}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      {msg && (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-700" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
          {msg.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <AlertTriangle size={14} className="mt-px shrink-0 text-rose-500" />} {msg.text}
        </p>
      )}

      <section className="rounded-2xl border border-rose-500/30 bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text"><ShieldAlert size={15} className="text-rose-500" /> Delete test data</h2>
        <p className="mt-1 max-w-[760px] text-[11px] leading-relaxed text-biome-muted">
          For testing with fresh data. Choose the modules to empty. Logins, plants, number series, settings, the linked WhatsApp account,
          passwords and backups are never deleted. Only the developer sees this.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.scopes.map((s: any) => (
            <label key={s.id} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${picked.includes(s.id) ? "border-rose-500/50 bg-rose-500/[.06]" : "border-biome-line"}`}>
              <input type="checkbox" className="mt-0.5" checked={picked.includes(s.id)} disabled={!!preview}
                onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <span>
                <span className="block text-[12px] font-semibold text-biome-text">{s.label}</span>
                <span className="block text-[10.5px] text-biome-muted">{s.help}</span>
                <span className="block text-[10px] text-biome-muted">{s.files} file(s) · {size(s.bytes)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setPicked(data.scopes.map((s: any) => s.id))} disabled={!!preview} className="bmx-chip rounded-xl border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted">Select all</button>
          <button onClick={startPreview} disabled={!picked.length || !!preview || busy === "preview"}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy === "preview" ? <Loader2 size={13} className="bmx-spin" /> : <Trash2 size={13} />} Delete selected data…
          </button>
        </div>

        {preview && (
          <div className="mt-4 rounded-2xl border-2 border-rose-500/60 bg-rose-500/[.08] p-4">
            <p className="flex items-center gap-2 text-[13px] font-bold text-rose-600"><AlertTriangle size={16} /> Warning — this permanently deletes data</p>
            <ul className="mt-2 space-y-1 text-[11.5px] text-biome-text">
              <li>· <b>{preview.files} file(s), {size(preview.bytes)}</b> from: {preview.scopes.join(", ")}.</li>
              <li>· Every user on every device loses this data at once. Anyone working in these modules loses unsaved work.</li>
              <li>· WhatsApp documents already filed will be gone; the agent will not re-download old messages.</li>
              <li className="flex items-center gap-1.5">· <Archive size={12} /> {skipBackup ? <b className="text-rose-600">NO backup will be taken — this cannot be undone.</b> : <>A full verified backup is taken first; restore it from Settings → Backup if needed.</>}</li>
              <li>· Make sure this is the TEST data folder, not the live one.</li>
            </ul>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-biome-muted">
              <input type="checkbox" checked={skipBackup} onChange={(e) => setSkipBackup(e.target.checked)} /> Don&rsquo;t take a backup first (not recommended)
            </label>
            {left > 0 ? (
              <p className="mt-3 text-[12px] font-semibold text-rose-600">Read the warning — you can confirm in {left} second{left === 1 ? "" : "s"}…</p>
            ) : (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-[200px] flex-1">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Type DELETE to confirm</span>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
                </label>
                <button onClick={wipe} disabled={confirm !== "DELETE" || busy === "wipe"}
                  className="bmx-btn flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                  {busy === "wipe" ? <Loader2 size={13} className="bmx-spin" /> : <Trash2 size={13} />} {skipBackup ? "Delete now" : "Back up, then delete"}
                </button>
              </div>
            )}
            <button onClick={() => setPreview(null)} className="mt-2 text-[11px] text-biome-muted underline">Cancel</button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text"><Trash2 size={15} className="text-biome-leaf" /> Delete one record</h2>
        <p className="mt-1 text-[11px] text-biome-muted">Vendors/clients (registrations, including frozen ones), client master entries, coordination trips, purchase orders.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[["partner", "Vendor / client registrations"], ["client", "Client master"], ["trip", "Coordination trips"], ["po", "Purchase orders"]].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={`bmx-chip rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${kind === k ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>{l} ({(data.records?.[k] || []).length})</button>
          ))}
          <div className="relative ml-auto"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-biome-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={`${input} w-[220px] pl-7`} /></div>
        </div>
        <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto">
          {records.length === 0 && <p className="text-[11px] text-biome-muted">Nothing here.</p>}
          {records.map((r: any) => (
            <div key={r.id} className="flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] font-semibold text-biome-text">{r.label}</p>
                <p className="truncate text-[10px] text-biome-muted">{r.sub}</p>
              </div>
              <button onClick={() => del(r.id, r.label)} disabled={busy === r.id} className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-[10.5px] font-semibold text-rose-600 disabled:opacity-50">
                {busy === r.id ? <Loader2 size={11} className="bmx-spin" /> : "Delete"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
