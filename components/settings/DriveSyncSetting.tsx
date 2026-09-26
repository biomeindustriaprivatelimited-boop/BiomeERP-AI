"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, Link2, Upload, CheckCircle2, AlertCircle, Unplug } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * Google Drive sync — backups of all platform data into the company's
 * OWN Drive account.
 *
 * Setup is honest about what it needs: the business makes its own free
 * OAuth "Desktop app" credential at console.cloud.google.com (so no
 * shared secret ships in the build), pastes the ID and Secret here
 * once, connects, and from then on "Back up to Drive" is one press.
 */
export default function DriveSyncSetting() {
  const [st, setSt] = useState<any>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gdrive", { cache: "no-store" });
      if (res.ok) setSt(await res.json());
    } catch {
      /* settings page shows what it can */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(action: string, extra: Record<string, string> = {}, after?: (json: any) => void) {
    setBusy(action); setNote(null);
    try {
      const res = await fetch("/api/gdrive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      after?.(json);
      await load();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const [mirrorAuto, setMirrorAuto] = useState(false);
  useEffect(() => { fetch("/api/gdrive/mirror").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setMirrorAuto(Boolean(j.auto)); }).catch(() => {}); }, []);
  async function toggleAuto(enabled: boolean) { setMirrorAuto(enabled); await fetch("/api/gdrive/mirror", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto", enabled }) }); }
  async function mirrorNow() {
    setBusy("mirror"); setNote(null);
    try { const res = await fetch("/api/gdrive/mirror", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const json = await res.json().catch(() => ({})); if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`); setNote({ ok: true, text: `Documents mirrored: ${json.uploaded} uploaded, ${json.skipped} unchanged, ${json.failed} failed. Same Month/Client/Date/Reference folders under "Biome Platform Documents".${json.notes?.length ? " " + json.notes.join(" ") : ""}` }); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  async function backupNow() {
    setBusy("backup"); setNote(null);
    try {
      const res = await fetch("/api/gdrive/backup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setNote({ ok: true, text: `Uploaded ${json.name} (${json.files} files) to Google Drive.` });
      await load();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 font-mono text-[11px] text-biome-text outline-none";

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Cloud size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Google Drive sync</h2>
        {st?.connected && (
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-emerald-500">
            Connected
          </span>
        )}
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
        Uploads the same backup the local Backup card makes into a &ldquo;Biome Platform Backups&rdquo;
        folder in your own Google Drive. The app can only see files it created there — nothing else
        in the Drive.
      </p>

      {!st ? (
        <Loader2 size={16} className="bmx-spin text-biome-muted" />
      ) : !st.connected ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-biome-line bg-biome-bg px-4 py-3 text-[10.5px] leading-relaxed text-biome-muted">
            One-time setup (about 5 minutes): at <b className="text-biome-text">console.cloud.google.com</b> create a
            project → enable the <b className="text-biome-text">Google Drive API</b> → OAuth consent screen (External,
            add your own email as a test user) → Credentials → <b className="text-biome-text">OAuth client ID → Web
            application</b> → add this exact redirect URI:
            <code className="mt-1 block rounded-lg border border-biome-leaf/25 bg-biome-leaf/[.06] px-2 py-1 font-mono text-[10px] text-biome-leafBright">
              {st.redirectUri}
            </code>
            Then paste the Client ID and Secret below.
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" className={input} />
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" type="password" className={input} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => act("save-credentials", { clientId, clientSecret }, () => setNote({ ok: true, text: "Credentials saved. Now press Connect." }))}
              disabled={busy !== null || !clientId || !clientSecret}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-50">
              {busy === "save-credentials" ? <Loader2 size={13} className="bmx-spin" /> : <CheckCircle2 size={13} />} Save credentials
            </button>
            <button
              onClick={() => act("connect-url", {}, (json) => { if (json.url) window.open(json.url, "_blank"); setNote({ ok: true, text: "Google opened in the browser — approve access, then come back and refresh this card." }); })}
              disabled={busy !== null || !st.configured}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy === "connect-url" ? <Loader2 size={13} className="bmx-spin" /> : <Link2 size={13} />} Connect Google Drive
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-biome-muted">
            <span>Account: <b className="text-biome-text">{st.accountEmail || "connected"}</b></span>
            <span>
              Last Drive backup: <b className="text-biome-text">
                {st.lastBackupAt ? new Date(st.lastBackupAt).toLocaleString("en-IN") : "never yet"}
              </b>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={backupNow} disabled={busy !== null}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy === "backup" ? <Loader2 size={13} className="bmx-spin" /> : <Upload size={13} />} Back up to Drive now
            </button>
            <button onClick={mirrorNow} disabled={busy !== null}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-60">
              {busy === "mirror" ? <Loader2 size={13} className="bmx-spin" /> : <Upload size={13} />} Mirror documents to Drive now
            </button>
            <label className="flex items-center gap-2 text-[11px] text-biome-text">
              <input type="checkbox" checked={mirrorAuto} onChange={(e) => toggleAuto(e.target.checked)} /> Auto-mirror new documents (runs with the autopilot)
            </label>
            <button onClick={() => act("disconnect")} disabled={busy !== null}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-60">
              <Unplug size={13} /> Disconnect
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className={`mt-3 flex items-start gap-1.5 rounded-xl border px-3 py-2 text-[11px] ${
          note.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-600" : "border-rose-500/30 bg-rose-500/[.07] text-rose-500"
        }`}>
          {note.ok ? <CheckCircle2 size={12} className="mt-px shrink-0" /> : <AlertCircle size={12} className="mt-px shrink-0" />} {note.text}
        </p>
      )}
    </GlassCard>
  );
}
