"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive, Loader2, Check, Download, RotateCcw, ShieldAlert, CalendarClock, Cloud, Upload,
  HardDrive, Lock, Trash2, Server, CheckCircle2, AlertCircle,
} from "lucide-react";

/**
 * Backup, schedule and restore.
 *
 * Top: where the data lives and how it is protected (the server PC is the
 * data centre; phones and client PCs hold nothing).
 * Middle: the automatic schedule — daily, weekly, monthly — each with its
 * own "keep the newest N", plus Google Drive, a second folder and an
 * optional backup password.
 * Bottom: every backup on the server, the ones on Drive, and "restore from
 * a file on this computer". Restoring stays deliberately awkward: a dry run
 * that spells out what happens, Override on, and the word RESTORE typed.
 */

interface BackupRow {
  file: string; createdAt: string; createdBy: string; kind?: string; encrypted?: boolean;
  sizeBytes: number; fileCount: number; note: string; verifiedAt: string;
  drive?: { fileId: string; uploadedAt: string } | null; driveError?: string; extraCopy?: string;
}

const size = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB`
  : `${Math.max(1, Math.round(n / 1024))} KB`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KIND_LABEL: Record<string, string> = {
  manual: "Manual", daily: "Daily", weekly: "Weekly", monthly: "Monthly", uploaded: "Uploaded", drive: "From Drive",
};
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";
const chip = "bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1.5 text-[11px] font-semibold text-biome-muted disabled:opacity-50";

export default function BackupSetting() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sched, setSched] = useState<any>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [driveList, setDriveList] = useState<any[] | null>(null);
  const [restoring, setRestoring] = useState<{ file: string; willDo: string[]; needsOverride: boolean; encrypted: boolean } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadPass, setUploadPass] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/backup", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setData(json);
    setSched((cur: any) => cur ?? json.schedule);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(tag: string, body: any, method = "POST") {
    setBusy(tag); setErr(null); setDone(null);
    try {
      const res = await fetch("/api/backup", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      return json;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(""); }
  }

  async function create(drive: boolean) {
    const json = await call(drive ? "new-drive" : "new", { action: "create", note, drive });
    if (!json) return;
    setNote("");
    setDone(`Backup made: ${json.backup.file}. ${(json.notes || []).join(" ")}`);
    if (json.unreadable?.length) setErr(`${json.unreadable.length} file(s) could not be read: ${json.unreadable.slice(0, 3).join(", ")}`);
    await load();
  }

  async function saveSchedule() {
    if (pass || pass2) {
      if (pass !== pass2) { setErr("The two backup passwords do not match."); return; }
    }
    const json = await call("sched", { action: "schedule", schedule: sched, ...(pass ? { passphrase: pass } : {}) });
    if (!json) return;
    setSched(json.schedule); setPass(""); setPass2("");
    setDone("Backup schedule saved.");
    await load();
  }

  async function removePassword() {
    if (!window.confirm("Stop encrypting new backups? Existing encrypted backups still need the old password to restore.")) return;
    const json = await call("sched", { action: "schedule", schedule: sched, passphrase: "" });
    if (json) { setSched(json.schedule); setDone("New backups will not be encrypted."); await load(); }
  }

  async function loadDrive() {
    setBusy("drive-list"); setErr(null);
    try {
      const res = await fetch("/api/backup?drive=list", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read Drive.");
      if (!json.connected) throw new Error("Google Drive is not connected. Connect it in the Google Drive section below.");
      setDriveList(json.files);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function fromDrive(fileId: string) {
    const json = await call(`fd-${fileId}`, { action: "fromDrive", fileId });
    if (json) { setDone(`Downloaded ${json.backup.file} to the server. Use Restore on it below.`); await load(); await loadDrive(); }
  }

  async function toDrive(file: string) {
    const json = await call(`td-${file}`, { action: "toDrive", file });
    if (json) { setDone(`${file} uploaded to Google Drive.`); await load(); }
  }

  async function del(file: string) {
    if (!window.confirm(`Delete ${file} from the server? Copies on Drive or in the extra folder are not touched.`)) return;
    const json = await call(`del-${file}`, { action: "delete", file });
    if (json) await load();
  }

  async function upload(f: File) {
    setBusy("upload"); setErr(null); setDone(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (uploadPass) fd.append("passphrase", uploadPass);
      const res = await fetch("/api/backup", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Upload failed.");
      setDone(`${json.backup.file} checked (${json.backup.fileCount} files) and added. Use Restore on it below.`);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function askRestore(file: string) {
    const json = await call(file, { file, dryRun: true }, "PUT");
    if (!json) return;
    setRestoring({ file, willDo: json.willDo, needsOverride: json.needsOverride, encrypted: json.encrypted });
    setConfirm(""); setRestorePass("");
  }

  async function doRestore() {
    if (!restoring) return;
    const json = await call("restore", { file: restoring.file, confirm, passphrase: restorePass || undefined }, "PUT");
    if (!json) return;
    setRestoring(null);
    setDone(json.message);
    await load();
  }

  if (!data || !sched) return null;
  const backups: BackupRow[] = data.backups || [];
  const history: any[] = data.state?.history || [];
  const lastFail = history.find((h) => !h.ok);
  const lastOk = history.find((h) => h.ok);

  const set = (patch: any) => setSched((s: any) => ({ ...s, ...patch }));
  const setTier = (k: string, patch: any) => setSched((s: any) => ({ ...s, [k]: { ...s[k], ...patch } }));

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
        <Archive size={15} className="text-biome-leaf" /> Data centre, backup &amp; restore
      </h2>

      {/* ---------------- Where the data lives ---------------- */}
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-biome-text"><Server size={13} className="text-biome-leaf" /> Server PC = data centre</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
            All data lives only in <span className="font-mono">{data.dataRoot}</span> on this server. Phones and client PCs
            only show screens — every answer is sent <em>no-store</em> and client PCs wipe their cache at start and quit.
          </p>
        </div>
        <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-biome-text"><Lock size={13} className="text-biome-leaf" /> Role-based access</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
            The server decides what each login may read. A plant manager&rsquo;s app is never sent another plant&rsquo;s rows,
            coordination&rsquo;s trading data or finance — there is nothing on the device to &ldquo;trick&rdquo; out.
          </p>
        </div>
        <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-biome-text"><CalendarClock size={13} className="text-biome-leaf" /> Last automatic backup</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
            {lastOk ? <>{when(lastOk.at)} · {KIND_LABEL[lastOk.kind] || lastOk.kind}</> : "None yet."}
            {lastFail && (!lastOk || lastFail.at > lastOk.at) && (
              <span className="mt-1 block font-semibold text-rose-500">Last attempt failed: {lastFail.message}</span>
            )}
          </p>
        </div>
      </div>

      {err && <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text"><AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-500" />{err}</p>}
      {done && <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3 py-2 text-[11px] font-semibold text-emerald-600"><CheckCircle2 size={13} className="mt-0.5 shrink-0" />{done}</p>}

      {/* ---------------- Schedule ---------------- */}
      <div className="mt-5 rounded-2xl border border-biome-line bg-biome-bg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-biome-text"><CalendarClock size={14} className="text-biome-leaf" /> Automatic backup schedule</p>
          <label className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
            <input type="checkbox" checked={sched.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Automatic backups on
          </label>
        </div>
        <p className="mt-1 text-[10.5px] text-biome-muted">
          Runs on the server PC. If the PC was off at the set time, the missed backup is taken as soon as the app is running again.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label><span className={label}>Time (every tier)</span>
            <input type="time" value={sched.time} onChange={(e) => set({ time: e.target.value })} className={input} /></label>

          <div className="rounded-xl border border-biome-line p-2.5">
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
              <input type="checkbox" checked={sched.daily.enabled} onChange={(e) => setTier("daily", { enabled: e.target.checked })} /> Daily
            </label>
            <label className="mt-2 block"><span className={label}>Keep last</span>
              <input type="number" min={1} max={365} value={sched.daily.keep} onChange={(e) => setTier("daily", { keep: Number(e.target.value) })} className={input} /></label>
            <p className="mt-1 text-[10px] text-biome-muted">Next: {when(data.next?.daily)}</p>
          </div>

          <div className="rounded-xl border border-biome-line p-2.5">
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
              <input type="checkbox" checked={sched.weekly.enabled} onChange={(e) => setTier("weekly", { enabled: e.target.checked })} /> Weekly
            </label>
            <label className="mt-2 block"><span className={label}>On</span>
              <select value={sched.weekly.weekday} onChange={(e) => setTier("weekly", { weekday: Number(e.target.value) })} className={input}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select></label>
            <label className="mt-2 block"><span className={label}>Keep last</span>
              <input type="number" min={1} max={104} value={sched.weekly.keep} onChange={(e) => setTier("weekly", { keep: Number(e.target.value) })} className={input} /></label>
            <p className="mt-1 text-[10px] text-biome-muted">Next: {when(data.next?.weekly)}</p>
          </div>

          <div className="rounded-xl border border-biome-line p-2.5">
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
              <input type="checkbox" checked={sched.monthly.enabled} onChange={(e) => setTier("monthly", { enabled: e.target.checked })} /> Monthly
            </label>
            <label className="mt-2 block"><span className={label}>Day of month</span>
              <input type="number" min={1} max={28} value={sched.monthly.day} onChange={(e) => setTier("monthly", { day: Number(e.target.value) })} className={input} /></label>
            <label className="mt-2 block"><span className={label}>Keep last</span>
              <input type="number" min={1} max={120} value={sched.monthly.keep} onChange={(e) => setTier("monthly", { keep: Number(e.target.value) })} className={input} /></label>
            <p className="mt-1 text-[10px] text-biome-muted">Next: {when(data.next?.monthly)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-biome-line p-2.5">
            <label className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
              <input type="checkbox" checked={sched.drive} onChange={(e) => set({ drive: e.target.checked })} />
              <Cloud size={13} className="text-biome-leaf" /> Also upload every automatic backup to Google Drive
            </label>
            <p className="mt-1 text-[10.5px] text-biome-muted">
              {data.drive?.connected
                ? <>Connected as <span className="font-semibold">{data.drive.account || "Google account"}</span>. Old Drive copies follow the same keep rule.</>
                : <span className="text-amber-600">Drive is not connected yet — connect it in the Google Drive section below.</span>}
            </p>
          </div>
          <label className="rounded-xl border border-biome-line p-2.5">
            <span className={`${label} flex items-center gap-1.5`}><HardDrive size={12} /> Second copy folder (optional)</span>
            <input value={sched.extraFolder} onChange={(e) => set({ extraFolder: e.target.value })}
              placeholder="D:\Biome Backups   or   \\NAS\biome" className={input} />
            <span className="mt-1 block text-[10px] text-biome-muted">Another disk, USB drive or NAS — a copy that survives this disk failing.</span>
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-biome-line p-2.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-biome-text">
            <Lock size={13} className="text-biome-leaf" /> Backup password (encryption)
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[9.5px] font-bold ${data.schedule.encrypted ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>
              {data.schedule.encrypted ? "ON — backups are AES-256 encrypted" : "OFF"}
            </span>
          </p>
          <p className="mt-1 text-[10.5px] text-biome-muted">
            With a password, a backup on Drive or a pen drive cannot be opened by anyone who finds it. <b>Write the password down
            and keep it safe</b> — without it an encrypted backup cannot be restored on a new server PC.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-[160px] flex-1"><span className={label}>{data.schedule.encrypted ? "New password" : "Password"}</span>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={input} autoComplete="new-password" /></label>
            <label className="min-w-[160px] flex-1"><span className={label}>Repeat</span>
              <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} className={input} autoComplete="new-password" /></label>
            {data.schedule.encrypted && <button onClick={removePassword} className={chip}>Turn encryption off</button>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={saveSchedule} disabled={busy === "sched"}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-60">
            {busy === "sched" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save schedule
          </button>
          {data.schedule.updatedAt && <span className="text-[10px] text-biome-muted">Last changed {when(data.schedule.updatedAt)} by {data.schedule.updatedBy}</span>}
        </div>
      </div>

      {/* ---------------- Make now ---------------- */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className={label}>Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Before the August payroll run" className={input} />
        </label>
        <button onClick={() => create(false)} disabled={!!busy}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy === "new" ? <Loader2 size={14} className="bmx-spin" /> : <Archive size={14} />} Backup now
        </button>
        <button onClick={() => create(true)} disabled={!!busy || !data.drive?.connected}
          className="bmx-btn flex items-center gap-2 rounded-xl border border-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-biome-leaf disabled:opacity-50">
          {busy === "new-drive" ? <Loader2 size={14} className="bmx-spin" /> : <Cloud size={14} />} Backup now + Drive
        </button>
      </div>
      <p className="mt-1.5 text-[10.5px] text-biome-muted">
        Next backup holds {data.wouldInclude.files} files (~{data.wouldInclude.human}). Kept in <span className="font-mono">{data.folder}</span>.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-biome-muted">What is deliberately left out</summary>
        <ul className="mt-1.5 space-y-0.5">
          {(data.excluded || []).map((x: string, i: number) => <li key={i} className="text-[10.5px] text-biome-muted">· {x}</li>)}
        </ul>
        <p className="mt-1 text-[10.5px] text-biome-muted">These are secrets of this server. A restore keeps whatever this server already has, so WhatsApp does not need re-linking.</p>
      </details>

      {/* ---------------- List ---------------- */}
      <div className="mt-4 space-y-2">
        {backups.length === 0 && <p className="text-[11.5px] text-biome-muted">No backups yet. The first one is worth taking now.</p>}
        {backups.map((b) => (
          <div key={b.file} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
            <div className="min-w-[220px] flex-1">
              <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] font-semibold text-biome-text">
                {b.file}
                <span className="rounded-full bg-biome-leaf/15 px-2 py-0.5 font-sans text-[9.5px] font-bold text-biome-leaf">{KIND_LABEL[b.kind || "manual"] || b.kind}</span>
                {b.encrypted && <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-sans text-[9.5px] font-bold text-sky-600"><Lock size={9} /> Encrypted</span>}
                {b.drive && <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-sans text-[9.5px] font-bold text-emerald-600"><Cloud size={9} /> On Drive</span>}
                {b.driveError && !b.drive && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-sans text-[9.5px] font-bold text-amber-600" title={b.driveError}>Drive failed</span>}
              </p>
              <p className="text-[10px] text-biome-muted">
                {when(b.createdAt)} · {b.createdBy} · {b.fileCount} files · {size(b.sizeBytes)}
                {b.verifiedAt && " · verified"}{b.note && ` · ${b.note}`}
              </p>
            </div>
            <a href={`/api/backup?download=${encodeURIComponent(b.file)}`} className={chip}><Download size={12} /> Download</a>
            {!b.drive && data.drive?.connected && (
              <button onClick={() => toDrive(b.file)} disabled={!!busy} className={chip}>
                {busy === `td-${b.file}` ? <Loader2 size={12} className="bmx-spin" /> : <Cloud size={12} />} To Drive
              </button>
            )}
            <button onClick={() => askRestore(b.file)} disabled={!!busy}
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[11px] font-semibold text-amber-600 disabled:opacity-60">
              {busy === b.file ? <Loader2 size={12} className="bmx-spin" /> : <RotateCcw size={12} />} Restore
            </button>
            <button onClick={() => del(b.file)} disabled={!!busy} className={chip} title="Delete from the server"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* ---------------- Bring one back ---------------- */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-biome-text"><Upload size={13} className="text-biome-leaf" /> Restore from a file on this computer</p>
          <p className="mt-1 text-[10.5px] text-biome-muted">A .zip or .biomebak you downloaded earlier or copied from a pen drive. It is checked first, then appears in the list above for Restore.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-[140px] flex-1"><span className={label}>Password (if encrypted)</span>
              <input type="password" value={uploadPass} onChange={(e) => setUploadPass(e.target.value)} className={input} /></label>
            <input ref={fileRef} type="file" accept=".zip,.biomebak" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={chip}>
              {busy === "upload" ? <Loader2 size={12} className="bmx-spin" /> : <Upload size={12} />} Choose backup file
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-biome-text"><Cloud size={13} className="text-biome-leaf" /> Restore from Google Drive</p>
          <p className="mt-1 text-[10.5px] text-biome-muted">For a new or repaired server PC: connect Drive, pick a backup, bring it to this server, then Restore.</p>
          <button onClick={loadDrive} disabled={!!busy} className={`${chip} mt-2`}>
            {busy === "drive-list" ? <Loader2 size={12} className="bmx-spin" /> : <Cloud size={12} />} Show backups on Drive
          </button>
          {driveList && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {driveList.length === 0 && <p className="text-[10.5px] text-biome-muted">No backups on Drive yet.</p>}
              {driveList.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-lg border border-biome-line px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[10.5px] text-biome-text">{f.name}</p>
                    <p className="text-[9.5px] text-biome-muted">{when(f.createdTime)} · {size(f.size)}</p>
                  </div>
                  {f.onThisServer
                    ? <span className="text-[10px] font-semibold text-emerald-600">On server</span>
                    : <button onClick={() => fromDrive(f.id)} disabled={!!busy} className={chip}>
                        {busy === `fd-${f.id}` ? <Loader2 size={11} className="bmx-spin" /> : <Download size={11} />} Bring here
                      </button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-biome-muted">Automatic backup log</summary>
          <ul className="mt-1.5 space-y-0.5">
            {history.map((h, i) => (
              <li key={i} className={`text-[10.5px] ${h.ok ? "text-biome-muted" : "text-rose-500"}`}>
                {h.ok ? "✓" : "✗"} {when(h.at)} · {KIND_LABEL[h.kind] || h.kind} · {h.file || ""} {h.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ---------------- Restore confirmation ---------------- */}
      {restoring && (
        <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/[.08] p-4">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-amber-600"><ShieldAlert size={14} /> Read this before restoring {restoring.file}</p>
          <ul className="mt-2 space-y-1">
            {restoring.willDo.map((line, i) => <li key={i} className="text-[11px] leading-relaxed text-biome-text">· {line}</li>)}
          </ul>
          {restoring.needsOverride ? (
            <p className="mt-3 text-[11px] font-semibold text-amber-600">
              Restoring needs an admin login with Override switched on (top of Settings) — it replaces everything in the data folder.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {restoring.encrypted && (
                <label className="min-w-[160px] flex-1"><span className={label}>Backup password (blank = saved one)</span>
                  <input type="password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} className={input} /></label>
              )}
              <label className="min-w-[160px] flex-1"><span className={label}>Type RESTORE to confirm</span>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} /></label>
              <button onClick={doRestore} disabled={busy === "restore" || confirm !== "RESTORE"}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                {busy === "restore" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Restore this backup
              </button>
            </div>
          )}
          <button onClick={() => setRestoring(null)} className="mt-2 text-[11px] text-biome-muted underline">Cancel</button>
        </div>
      )}
    </section>
  );
}
