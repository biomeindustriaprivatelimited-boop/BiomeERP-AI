"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Loader2, AlertTriangle, Archive, KeyRound, CheckCircle2, FolderOpen, LogOut, Building2, Settings2 } from "lucide-react";

/**
 * Developer → Data → Danger zone: start the whole app fresh.
 *
 * Deletes every user, partner, sheet, imprest entry, WhatsApp file and so
 * on — for everyone — after a verified backup. Asks for the developer's
 * password and the typed phrase; the server checks both again.
 */

const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

export default function FactoryReset() {
  const [keepCompanyProfile, setKeepCompany] = useState(true);
  const [keepSettings, setKeepSettings] = useState(true);
  const [preview, setPreview] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/developer/reset?keepCompanyProfile=${keepCompanyProfile ? 1 : 0}&keepSettings=${keepSettings ? 1 : 0}`, { cache: "no-store" });
      if (r.ok) setPreview(await r.json());
    } catch { /* preview is informational */ }
  }, [keepCompanyProfile, keepSettings]);
  useEffect(() => { load(); }, [load]);

  const PHRASE = preview?.phrase || "RESET BIOME";
  const ready = password.length > 0 && phrase.trim() === PHRASE && !busy;

  async function reset() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/developer/reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, phrase, keepCompanyProfile, keepSettings }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status}).`);
      setDone(j);
      setPassword(""); setPhrase("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <section className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-500/[.06] p-5" data-testid="reset-done">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-emerald-700"><CheckCircle2 size={17} /> The app has been reset — it starts fresh now</h2>
        <ul className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-biome-text">
          <li className="flex items-start gap-2"><Archive size={14} className="mt-px shrink-0 text-biome-leaf" />
            <span>Safety backup taken first: <b>{done.backup.file}</b> ({done.backup.size}, {done.backup.fileCount} files{done.backup.encrypted ? ", encrypted with your backup passphrase" : ""}).<br />
              <span className="text-biome-muted">Saved at:</span> <code className="break-all rounded bg-biome-bg px-1.5 py-0.5 text-[10.5px]">{done.backup.path}</code><br />
              <span className="text-biome-muted">To undo: Settings → Backup → restore this file.</span></span></li>
          <li className="flex items-start gap-2"><RotateCcw size={14} className="mt-px shrink-0 text-biome-leaf" /><span>{done.files} file(s) deleted.{done.kept?.length ? ` Kept: ${done.kept.join(", ")}.` : ""}</span></li>
          <li className="flex items-start gap-2"><LogOut size={14} className="mt-px shrink-0 text-biome-leaf" /><span>Everyone else has been signed out — every PC and phone goes back to the sign-in page.</span></li>
          <li className="flex items-start gap-2"><KeyRound size={14} className="mt-px shrink-0 text-biome-leaf" /><span>Sign-in is now <b>developer</b> / <b>biome-admin</b>. This PC stays the server. Set a new password now.</span></li>
        </ul>
        <button onClick={() => { window.location.href = "/change-password"; }}
          className="bmx-btn mt-4 flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[12px] font-bold text-white">
          <KeyRound size={14} /> Set the new developer password
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-rose-600/50 bg-biome-bgSoft p-5" data-testid="factory-reset">
      <p className="text-[9.5px] font-bold uppercase tracking-[.18em] text-rose-600">Danger zone</p>
      <h2 className="mt-1 flex items-center gap-2 text-[14px] font-bold text-biome-text">
        <RotateCcw size={16} className="text-rose-600" /> Start fresh — delete ALL app data
      </h2>
      <p className="mt-1 max-w-[780px] text-[11.5px] leading-relaxed text-biome-muted">
        For the testing phase. Deletes every user ID, vendor and client, plant sheet, imprest entry, payroll and attendance record,
        WhatsApp document and every other record — for the developer, the admin and all users. The app then opens like a new
        install: sign in as <b className="text-biome-text">developer / biome-admin</b> and set a new password. Backups are never deleted.
      </p>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${keepCompanyProfile ? "border-biome-leaf/40 bg-biome-leaf/[.06]" : "border-rose-500/40 bg-rose-500/[.05]"}`}>
          <input type="checkbox" className="mt-0.5" checked={keepCompanyProfile} onChange={(e) => setKeepCompany(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-biome-text"><Building2 size={13} /> Keep company profile</span>
            <span className="block text-[10.5px] text-biome-muted">Plants, departments / designations / work locations, holiday calendar, attendance rules.</span>
          </span>
        </label>
        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${keepSettings ? "border-biome-leaf/40 bg-biome-leaf/[.06]" : "border-rose-500/40 bg-rose-500/[.05]"}`}>
          <input type="checkbox" className="mt-0.5" checked={keepSettings} onChange={(e) => setKeepSettings(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-biome-text"><Settings2 size={13} /> Keep settings &amp; connections</span>
            <span className="block text-[10.5px] text-biome-muted">Email (SMTP), Google Drive, AI keys, backup schedule, WhatsApp link, feature switches, number series. These secrets are NOT in a backup — untick only if you really want to enter them again.</span>
          </span>
        </label>
      </div>

      {preview && (
        <div className="mt-3 rounded-xl border border-biome-line bg-biome-bg/50 px-4 py-3 text-[11px] text-biome-text">
          <p><b>{preview.files} file(s), {size(preview.bytes)}</b> would be deleted from the data folder <code className="break-all text-[10.5px] text-biome-muted">{preview.dataRoot}</code></p>
          {preview.items?.length > 0 && (
            <p className="mt-1 text-[10.5px] text-biome-muted">{preview.items.map((i: any) => `${i.folder} (${i.files})`).join(" · ")}</p>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-biome-muted"><FolderOpen size={11} /> Backups stay in {preview.backupsFolder}</p>
        </div>
      )}

      {!open ? (
        <button onClick={() => { setOpen(true); setError(null); }} data-testid="reset-open"
          className="bmx-btn mt-4 flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[11.5px] font-bold text-white">
          <RotateCcw size={13} /> Reset the app…
        </button>
      ) : (
        <div className="mt-4 rounded-2xl border-2 border-rose-500/60 bg-rose-500/[.08] p-4">
          <p className="flex items-center gap-2 text-[13px] font-bold text-rose-600"><AlertTriangle size={16} /> This deletes everything, for everyone</p>
          <ul className="mt-2 space-y-1 text-[11.5px] text-biome-text">
            <li>· All user IDs (admin, accounts, plant managers, coordinators…) are deleted. Only <b>developer</b> remains, with the first-run password.</li>
            <li>· Every PC and phone is signed out at once and goes back to the sign-in page.</li>
            <li className="flex items-center gap-1.5">· <Archive size={12} /> A full verified backup is taken first. If the backup fails, nothing is deleted.</li>
            <li>· Make sure this is the TEST data folder, not live company data.</li>
          </ul>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Your developer password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} data-testid="reset-password" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Type {PHRASE} to confirm</span>
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={PHRASE} className={input} data-testid="reset-phrase" />
            </label>
          </div>
          {error && <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[.07] px-3 py-2 text-[11.5px] text-biome-text"><AlertTriangle size={14} className="mt-px shrink-0 text-rose-500" /> {error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={reset} disabled={!ready} data-testid="reset-confirm"
              className="bmx-btn flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="bmx-spin" /> : <RotateCcw size={13} />} {busy ? "Backing up, then resetting…" : "Back up, then reset everything"}
            </button>
            <button onClick={() => { setOpen(false); setPassword(""); setPhrase(""); }} disabled={busy} className="text-[11px] text-biome-muted underline">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
