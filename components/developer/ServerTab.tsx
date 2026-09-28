"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Server, MonitorSmartphone, Smartphone, Laptop, Globe, Loader2, Ban, LogOut, RefreshCw, MessageSquare,
  Trash2, Upload, Download, CheckCircle2, AlertTriangle, Pencil, HardDrive, Archive,
} from "lucide-react";
import SyncSetting from "@/components/settings/SyncSetting";

/**
 * Developer → Server & devices.
 *
 *  - Make this PC the server, or a client of another (desktop app only)
 *  - The server's identity: addresses to connect to, data folder, disk,
 *    uptime, last backup
 *  - Every device using this server (desktop app, browsers, phones): who,
 *    from which IP, on which version, online or not — and control it:
 *    message, reload, sign out, block
 *  - Upload the new Windows installer / Android APK; every user is told
 *    to install the update
 */

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const KIND_ICON: Record<string, any> = { "desktop-app": Laptop, "android-app": Smartphone, "phone-browser": Smartphone, browser: Globe };

export default function ServerTab() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [files, setFiles] = useState<any>(null);
  const [rel, setRel] = useState({ version: "", notes: "", mandatory: false });
  const winRef = useRef<HTMLInputElement | null>(null);
  const apkRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/devices", { cache: "no-store" });
    if (r.ok) setD(await r.json());
    const f = await fetch("/api/release/files?info=1", { cache: "no-store" });
    if (f.ok) setFiles(await f.json());
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function act(action: string, extra: any = {}) {
    setBusy(`${action}:${extra.deviceId || extra.userId || ""}`); setMsg(null);
    try {
      const r = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Failed.");
      setMsg({ ok: true, text: "Done — the device picks it up within a minute." });
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function upload(kind: "windows" | "android", f: File) {
    setBusy(`up:${kind}`); setMsg(null);
    try {
      const fd = new FormData(); fd.append("kind", kind); fd.append("file", f);
      const r = await fetch("/api/release/files", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      setMsg({ ok: true, text: `${j.name} uploaded.${kind === "windows" ? " Now publish the version below so every user is told to install it." : " The Android app button now downloads it."}` });
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function publish() {
    setBusy("publish"); setMsg(null);
    try {
      const r = await fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rel, url: "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not publish.");
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "messageAll", message: `Biome ${rel.version} is available. Use "Download & install" at the top of the app.${rel.notes ? `\n\n${rel.notes}` : ""}` }) });
      setMsg({ ok: true, text: `Version ${rel.version} published — every user sees "Download & install" and gets a notice.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  if (!d) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;
  const s = d.server;

  return (
    <div className="space-y-5">
      {msg && (
        <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-700" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
          {msg.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <AlertTriangle size={14} className="mt-px shrink-0 text-rose-500" />} {msg.text}
        </p>
      )}

      <SyncSetting />

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text"><Server size={15} className="text-biome-leaf" /> This server</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Info label="Computer" value={s.hostname} sub={s.platform} />
          <Info label="Connect other devices to" value={s.urls[0] || `port ${s.port}`} sub={s.urls.slice(1).join(" · ") || "same Wi-Fi / LAN"} mono />
          <Info label="Running" value={`v${s.version} · ${s.uptimeHours} h`} sub={`${s.cpus} CPU · ${s.memoryMB} MB used`} />
          <Info label="Disk" value={s.disk ? `${s.disk.freeGB} GB free` : "—"} sub={s.disk ? `of ${s.disk.totalGB} GB` : ""} icon={<HardDrive size={12} />} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-biome-muted">
          <Archive size={11} /> Data: <span className="font-mono">{s.dataRoot}</span> · Last backup: {s.lastBackup ? `${s.lastBackup.file} (${ago(s.lastBackup.at)})` : "none yet — Settings → Backup"}
        </p>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 text-[13px] font-semibold text-biome-text"><MonitorSmartphone size={15} className="text-biome-leaf" /> Devices ({d.devices.length}, {d.online} online)</h2>
          <button onClick={() => { const m = window.prompt("Message to show on EVERY device:"); if (m) act("messageAll", { message: m }); }} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted"><MessageSquare size={12} /> Message all</button>
          <button onClick={() => act("reloadAll")} className="bmx-chip flex items-center gap-1 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted"><RefreshCw size={12} /> Reload all</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {d.devices.length === 0 && <p className="text-[11px] text-biome-muted">No device has checked in yet.</p>}
          {d.devices.map((x: any) => {
            const Icon = KIND_ICON[x.kind] || Globe;
            const b = (a: string) => busy === `${a}:${x.id}`;
            return (
              <div key={x.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${x.blocked ? "border-rose-500/40 bg-rose-500/[.05]" : "border-biome-line"}`}>
                <span className={`h-2 w-2 rounded-full ${x.online ? "bg-emerald-500" : "bg-slate-400"}`} title={x.online ? "online" : "offline"} />
                <Icon size={15} className="text-biome-muted" />
                <div className="min-w-[220px] flex-1">
                  <p className="text-[12px] font-semibold text-biome-text">{x.name} {x.blocked && <span className="ml-1 text-[10px] font-bold text-rose-600">BLOCKED</span>}</p>
                  <p className="text-[10px] text-biome-muted">{x.userName} ({x.role}) · {x.ip} · v{x.version || "?"}{x.shellVersion ? ` · app ${x.shellVersion}` : ""} · {x.online ? `on ${x.page}` : `last seen ${ago(x.lastSeen)}`}</p>
                </div>
                <Btn t="Rename" onClick={() => { const n = window.prompt("Name this device (e.g. Accounts PC 2):", x.name); if (n) act("rename", { deviceId: x.id, name: n }); }}><Pencil size={11} /></Btn>
                <Btn t="Send a message" onClick={() => { const m = window.prompt(`Message for ${x.userName} on ${x.name}:`); if (m) act("message", { deviceId: x.id, message: m }); }}><MessageSquare size={11} /></Btn>
                <Btn t="Reload the app on it" onClick={() => act("reload", { deviceId: x.id })}>{b("reload") ? <Loader2 size={11} className="bmx-spin" /> : <RefreshCw size={11} />}</Btn>
                <Btn t="Sign out this device" onClick={() => act("signOut", { deviceId: x.id })}><LogOut size={11} /></Btn>
                <Btn t={`Sign ${x.userName} out on every device`} onClick={() => { if (window.confirm(`Sign ${x.userName} out on every device?`)) act("signOutUser", { userId: x.userId }); }}><LogOut size={11} className="text-amber-600" /></Btn>
                {x.blocked
                  ? <Btn t="Unblock" onClick={() => act("unblock", { deviceId: x.id })}><CheckCircle2 size={11} className="text-emerald-600" /></Btn>
                  : <Btn t="Block this device" onClick={() => { const r = window.prompt(`Block ${x.name}? Reason shown on the device:`, "Blocked by the administrator."); if (r !== null) act("block", { deviceId: x.id, reason: r }); }}><Ban size={11} className="text-rose-600" /></Btn>}
                <Btn t="Forget (remove from list)" onClick={() => act("forget", { deviceId: x.id })}><Trash2 size={11} /></Btn>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-biome-muted">Blocking refuses every request from that device (except the developer&rsquo;s). For a hard stop on a person, disable the user in Users &amp; Access.</p>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text"><Upload size={15} className="text-biome-leaf" /> App updates &amp; Android app</h2>
        <p className="mt-1 max-w-[760px] text-[11px] leading-relaxed text-biome-muted">
          Client PCs and phones load their screens from this server, so after you install a new version <b>on this server PC</b> every device gets the new
          features on its next reload (use &ldquo;Reload all&rdquo;). The desktop app itself only needs reinstalling on other PCs when its shell changed:
          upload the installer here and publish the version — every user sees &ldquo;Download &amp; install&rdquo;.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FileBox label="Windows installer (.exe)" f={files?.windows} busy={busy === "up:windows"} onPick={() => winRef.current?.click()} href="/api/release/files?kind=windows" />
          <FileBox label="Android app (.apk)" f={files?.android} busy={busy === "up:android"} onPick={() => apkRef.current?.click()} href="/api/release/files?kind=android" />
          <input ref={winRef} type="file" accept=".exe,.msi,.zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("windows", f); e.target.value = ""; }} />
          <input ref={apkRef} type="file" accept=".apk" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("android", f); e.target.value = ""; }} />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[140px_1fr_auto_auto] md:items-end">
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Version</span>
            <input value={rel.version} onChange={(e) => setRel({ ...rel, version: e.target.value })} placeholder="0.2.0" className={input} /></label>
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">What&rsquo;s new</span>
            <input value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} placeholder="Stock module, WhatsApp fixes…" className={input} /></label>
          <label className="flex items-center gap-1.5 pb-2 text-[11px] text-biome-muted"><input type="checkbox" checked={rel.mandatory} onChange={(e) => setRel({ ...rel, mandatory: e.target.checked })} /> Required</label>
          <button onClick={publish} disabled={!rel.version || busy === "publish"} className="bmx-btn rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">Publish &amp; notify everyone</button>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value, sub, mono, icon }: { label: string; value: string; sub?: string; mono?: boolean; icon?: any }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
      <p className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">{icon}{label}</p>
      <p className={`mt-0.5 break-all text-[12.5px] font-semibold text-biome-text ${mono ? "font-mono" : ""}`}>{value}</p>
      {sub && <p className="break-all text-[10px] text-biome-muted">{sub}</p>}
    </div>
  );
}

function Btn({ t, onClick, children }: { t: string; onClick: () => void; children: any }) {
  return <button title={t} aria-label={t} onClick={onClick} className="rounded-lg border border-biome-line p-1.5 text-biome-muted hover:text-biome-text">{children}</button>;
}

function FileBox({ label, f, busy, onPick, href }: { label: string; f: any; busy: boolean; onPick: () => void; href: string }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg p-3">
      <p className="text-[11.5px] font-semibold text-biome-text">{label}</p>
      <p className="mt-0.5 text-[10.5px] text-biome-muted">{f ? `${f.name} · ${(f.size / 1e6).toFixed(1)} MB · ${new Date(f.uploadedAt).toLocaleString("en-IN")}` : "Not uploaded yet"}</p>
      <div className="mt-2 flex gap-2">
        <button onClick={onPick} disabled={busy} className="bmx-chip flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted">{busy ? <Loader2 size={11} className="bmx-spin" /> : <Upload size={11} />} Upload</button>
        {f && <a href={href} className="bmx-chip flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted"><Download size={11} /> Download</a>}
      </div>
    </div>
  );
}
