"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Loader2, Check, AlertCircle, Download, RotateCcw, ShieldAlert } from "lucide-react";

/**
 * Backup and restore.
 *
 * The restore half is deliberately awkward: a dry run that spells out what
 * is about to happen, a typed confirmation, and Override switched on. It
 * is the one button here that can lose a month of work, and it sits next
 * to the one that makes a backup.
 */

interface BackupRow {
  file: string; createdAt: string; createdBy: string;
  sizeBytes: number; fileCount: number; note: string; verifiedAt: string;
}

const size = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB`
  : `${Math.round(n / 1024)} KB`;

export default function BackupSetting() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [restoring, setRestoring] = useState<{ file: string; willDo: string[]; needsOverride: boolean } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/backup", { cache: "no-store" });
    if (!res.ok) return;
    setData(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy("new"); setErr(null); setDone(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not make a backup.");
      setNote("");
      if (json.unreadable?.length) {
        setErr(`Backup made, but ${json.unreadable.length} file(s) could not be read: ${json.unreadable.slice(0, 3).join(", ")}`);
      }
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function askRestore(file: string) {
    setBusy(file); setErr(null);
    try {
      const res = await fetch("/api/backup", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, dryRun: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read that backup.");
      setRestoring({ file, willDo: json.willDo, needsOverride: json.needsOverride });
      setConfirm("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function doRestore() {
    if (!restoring) return;
    setBusy("restore"); setErr(null);
    try {
      const res = await fetch("/api/backup", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: restoring.file, confirm }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "The restore did not run.");
      setRestoring(null);
      setDone(json.message);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  if (!data) return null;
  const backups: BackupRow[] = data.backups || [];

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
        <Archive size={15} className="text-biome-leaf" /> Backup &amp; restore
      </h2>
      <p className="mt-1.5 max-w-[680px] text-[11.5px] leading-relaxed text-biome-muted">
        Everything this app runs on lives in one folder. A backup is a single zip of it —
        {" "}{data.wouldInclude.files} files, about {data.wouldInclude.human} right now. Keep a copy somewhere that
        is not this machine: the same disk holding both is not a backup.
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-biome-muted">What is deliberately left out</summary>
        <ul className="mt-1.5 space-y-0.5">
          {(data.excluded || []).map((x: string, i: number) => (
            <li key={i} className="text-[10.5px] text-biome-muted">· {x}</li>
          ))}
        </ul>
        <p className="mt-1.5 max-w-[600px] text-[10.5px] leading-relaxed text-biome-muted">
          The WhatsApp login is the account itself — anyone holding those files can read the company&rsquo;s
          WhatsApp, so it does not travel in a zip. A restore keeps whatever is currently on this machine, which
          means you will not have to scan the QR code again.
        </p>
      </details>

      {err && (
        <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>
      )}
      {done && (
        <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-3 py-2 text-[11px] font-semibold text-emerald-600">{done}</p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Before the August payroll run"
            className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none" />
        </label>
        <button onClick={create} disabled={busy === "new"}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy === "new" ? <Loader2 size={14} className="bmx-spin" /> : <Archive size={14} />} Make a backup
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {backups.length === 0 && (
          <p className="text-[11.5px] text-biome-muted">No backups yet. The first one is worth taking now.</p>
        )}
        {backups.map((b) => (
          <div key={b.file} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
            <div className="min-w-[200px] flex-1">
              <p className="font-mono text-[11.5px] font-semibold text-biome-text">{b.file}</p>
              <p className="text-[10px] text-biome-muted">
                {new Date(b.createdAt).toLocaleString("en-IN")} · {b.createdBy} · {b.fileCount} files · {size(b.sizeBytes)}
                {b.verifiedAt && " · read back and verified"}
                {b.note && ` · ${b.note}`}
              </p>
            </div>
            <a href={`/api/backup?download=${encodeURIComponent(b.file)}`}
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted">
              <Download size={12} /> Download
            </a>
            <button onClick={() => askRestore(b.file)} disabled={busy === b.file}
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-[11px] font-semibold text-amber-600 disabled:opacity-60">
              {busy === b.file ? <Loader2 size={12} className="bmx-spin" /> : <RotateCcw size={12} />} Restore
            </button>
          </div>
        ))}
      </div>

      {restoring && (
        <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/[.08] p-4">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-amber-600">
            <ShieldAlert size={14} /> Read this before restoring
          </p>
          <ul className="mt-2 space-y-1">
            {restoring.willDo.map((line, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-biome-text">· {line}</li>
            ))}
          </ul>

          {restoring.needsOverride ? (
            <p className="mt-3 text-[11px] font-semibold text-amber-600">
              Switch Override on above first — restoring is the one action here that can lose a month of work, so it
              is not one click from the button that makes a backup.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex-1">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
                  Type RESTORE to confirm
                </span>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none" />
              </label>
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
