"use client";

import { useEffect, useState } from "react";
import { Server, MonitorSmartphone, Loader2, Check, AlertCircle, Network } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { useSession } from "@/lib/session";

/**
 * Server & Sync — developer only.
 *
 * Multi-PC works like this: ONE machine is the server and holds every
 * byte of data; every other machine (and every phone) is a client of it.
 * This card is where the developer decides which is which.
 *
 * It only does anything inside the desktop app, because the choice lives
 * in Electron's own config (each PC remembers its own role). In a plain
 * browser the card explains itself instead of showing dead controls.
 *
 * Developer only, and enforced twice: the card renders for no other role,
 * and the underlying window.biomeDesktop bridge changes nothing on the
 * server's data — it only tells THIS installation where to look.
 */

declare global {
  interface Window {
    biomeDesktop?: {
      getSyncConfig: () => Promise<{ mode: string; serverUrl: string; port: number; lan: string[]; tailscale?: string[]; publicAddress?: string; builtInAddresses?: string[]; router?: { checkedAt: string | null; ok: boolean; error?: string | null; externalIp?: string | null; internal?: string | null }; owned?: boolean; configFile: string }>;
      detectPublicIp?: () => Promise<{ ok: boolean; ip?: string; error?: string }>;
      setPublicAddress?: (address: string) => Promise<{ ok: boolean; address?: string; error?: string }>;
      setSyncConfig: (cfg: { mode: string; serverUrl?: string }) => Promise<{ ok: boolean; error?: string; restarting?: boolean }>;
    };
  }
}

export default function SyncSetting() {
  const { user } = useSession();
  const [cfg, setCfg] = useState<{ mode: string; serverUrl: string; port: number; lan: string[]; tailscale?: string[]; publicAddress?: string; builtInAddresses?: string[]; router?: { checkedAt: string | null; ok: boolean; error?: string | null; externalIp?: string | null; internal?: string | null }; owned?: boolean } | null>(null);
  const [publicIp, setPublicIp] = useState("");
  const [ipBusy, setIpBusy] = useState(false);
  const [ipMsg, setIpMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [inDesktop, setInDesktop] = useState(false);
  const [mode, setMode] = useState<"server" | "client">("server");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.biomeDesktop : undefined;
    setInDesktop(Boolean(bridge));
    if (!bridge) return;
    bridge.getSyncConfig().then((c) => {
      setCfg(c);
      setMode(c.mode === "client" ? "client" : "server");
      setServerUrl(c.serverUrl || "");
      setPublicIp(c.publicAddress || "");
    }).catch(() => {});
  }, []);

  // The whole card is the developer's. Everyone else never sees it.
  if (user?.role !== "developer") return null;

  async function detectIp() {
    if (!window.biomeDesktop?.detectPublicIp) return;
    setIpBusy(true); setIpMsg(null);
    const r = await window.biomeDesktop.detectPublicIp().catch((e) => ({ ok: false, error: String(e) }) as any);
    setIpBusy(false);
    if (r.ok && r.ip) { setPublicIp(r.ip); setIpMsg({ kind: "ok", text: `Internet sees this office as ${r.ip}. Check it matches your static IP, then Save.` }); }
    else setIpMsg({ kind: "err", text: r.error || "Could not detect." });
  }

  async function saveIp() {
    if (!window.biomeDesktop?.setPublicAddress) return;
    setIpBusy(true); setIpMsg(null);
    const r = await window.biomeDesktop.setPublicAddress(publicIp).catch((e) => ({ ok: false, error: String(e) }) as any);
    setIpBusy(false);
    if (r.ok) { setPublicIp(r.address || ""); setCfg((c) => (c ? { ...c, publicAddress: r.address || "" } : c)); setIpMsg({ kind: "ok", text: r.address ? "Saved." : "Cleared." }); }
    else setIpMsg({ kind: "err", text: r.error || "Could not save." });
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  }

  async function apply() {
    if (!window.biomeDesktop) return;
    setBusy(true); setMsg(null);
    try {
      const res = await window.biomeDesktop.setSyncConfig(
        mode === "client" ? { mode, serverUrl } : { mode }
      );
      if (!res.ok) throw new Error(res.error || "Could not save.");
      setMsg({ kind: "ok", text: "Saved — the app is restarting to apply it." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Network size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Server &amp; Sync</h2>
        <span className="rounded-full border border-violet-500/35 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-violet-500">
          Developer
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
        One PC is the server and holds all data; every other PC and phone works through it.
        When the server is off, every client blocks itself until it is back — nobody works
        against a machine that isn&rsquo;t there.
      </p>

      {!inDesktop ? (
        <p className="rounded-xl border border-biome-line bg-biome-bg px-4 py-3 text-[11px] leading-relaxed text-biome-muted">
          This browser is already a client of the server it loaded from. The server/client role of a
          machine is set inside the <span className="font-semibold text-biome-text">Biome desktop app</span> on
          that machine — open Settings there.
        </p>
      ) : (
        <div className="space-y-3.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setMode("server")}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                mode === "server" ? "border-biome-leaf/50 bg-biome-leaf/[.08]" : "border-biome-line hover:border-biome-leaf/25"
              }`}>
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-biome-text">
                <Server size={14} className="text-biome-leaf" /> This PC is the server
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                Runs the Biome server and holds all data. Keep this machine on during working hours.
              </p>
            </button>
            <button onClick={() => setMode("client")}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                mode === "client" ? "border-biome-leaf/50 bg-biome-leaf/[.08]" : "border-biome-line hover:border-biome-leaf/25"
              }`}>
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-biome-text">
                <MonitorSmartphone size={14} className="text-biome-leaf" /> This PC is a client
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                Stores nothing here — everything is read from and saved to the server below.
              </p>
            </button>
          </div>

          {mode === "client" && (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
                Server address
              </span>
              <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://192.168.1.10:4173"
                className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 font-mono text-[12px] text-biome-text outline-none" />
              <p className="mt-1 text-[9.5px] text-biome-muted">
                Find it on the server PC — this same card there lists its network addresses.
              </p>
            </label>
          )}

          {mode === "server" && cfg && cfg.mode === "server" && (
            <div className="space-y-1.5 rounded-xl border border-biome-line bg-biome-bg px-4 py-3 text-[11px] leading-relaxed">
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Automatic setup</p>
              <p className={cfg.owned ? "text-emerald-600" : "text-amber-600"}>
                {cfg.owned
                  ? "✓ Developer is signed in on this PC — it is the server, and client PCs and phones can sign in."
                  : "Developer is not signed in on this PC — clients cannot sign in until the developer signs in here."}
              </p>
              <p className="text-emerald-600">✓ Office PCs and phones find this server by themselves (network discovery).</p>
              <p className={cfg.router?.ok ? "text-emerald-600" : "text-amber-600"}>
                {cfg.router?.checkedAt == null
                  ? "Router: checking…"
                  : cfg.router.ok
                    ? `✓ Router opened port ${cfg.port} to this PC automatically${cfg.router.externalIp ? ` (internet address ${cfg.router.externalIp})` : ""}.`
                    : `Router could not be opened automatically: ${cfg.router.error || "unknown reason"} Add the port forward below once.`}
              </p>
              {cfg.builtInAddresses && cfg.builtInAddresses.length > 0 && (
                <p className="text-biome-muted">
                  Built into every installer (PCs outside the office use these):{" "}
                  <span className="font-mono text-biome-text">{cfg.builtInAddresses.join("  ·  ")}</span>
                </p>
              )}
            </div>
          )}

          {mode === "server" && cfg && (() => {
            const remote = cfg.tailscale || [];
            const local = cfg.lan.filter((a) => !remote.includes(a));
            return (
              <div className="space-y-2.5 rounded-xl border border-biome-line bg-biome-bg px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
                    Same office network — clients and phones connect to
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {local.length ? local.map((a) => (
                      <code key={a} className="rounded-lg border border-biome-leaf/30 bg-biome-leaf/[.08] px-2.5 py-1 font-mono text-[11px] text-biome-leaf">
                        http://{a}:{cfg.port}
                      </code>
                    )) : <span className="text-[10.5px] text-biome-muted">No network address found.</span>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
                    Any other place — office static IP
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <input value={publicIp} onChange={(e) => setPublicIp(e.target.value)} placeholder="Your static IP, e.g. 203.0.113.25"
                      className="bmx-input min-w-[200px] flex-1 rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2 font-mono text-[11.5px] text-biome-text outline-none" />
                    <button onClick={detectIp} disabled={ipBusy}
                      className="rounded-full border border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text disabled:opacity-50">
                      Detect
                    </button>
                    <button onClick={saveIp} disabled={ipBusy}
                      className="rounded-full bg-biome-leaf px-3.5 py-1.5 text-[10.5px] font-bold text-white disabled:opacity-50">
                      Save
                    </button>
                  </div>
                  {ipMsg && (
                    <p className={`mt-1.5 text-[10.5px] ${ipMsg.kind === "ok" ? "text-emerald-600" : "text-rose-500"}`}>{ipMsg.text}</p>
                  )}
                  {cfg.publicAddress ? (
                    <button onClick={() => copy(`http://${cfg.publicAddress}${/:\d+$/.test(cfg.publicAddress || "") ? "" : `:${cfg.port}`}`)}
                      className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/[.08] px-2.5 py-1 font-mono text-[12px] text-sky-500"
                      title="Click to copy">
                      http://{cfg.publicAddress}{/:\d+$/.test(cfg.publicAddress) ? "" : `:${cfg.port}`}
                      <span className="ml-2 font-sans text-[9.5px] text-biome-muted">{copied ? "copied" : "copy"}</span>
                    </button>
                  ) : null}
                  <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[.05] px-3 py-2 text-[10.5px] leading-relaxed text-biome-muted">
                    <p className="font-semibold text-biome-text">One-time router step (same as for Remote Desktop):</p>
                    <p>
                      In the office router open <b>Port Forwarding</b> and add: external port <b>30360</b> → this PC&rsquo;s
                      address <b>{local[0] || "192.168.x.x"}</b>, port <b>{cfg.port}</b>, TCP. (Not 30359 — that one is Remote Desktop;
                      one port can carry only one program.) Keep this PC&rsquo;s office address
                      fixed (DHCP reservation in the router), like you did for Remote Desktop.
                    </p>
                    <p className="mt-1">
                      Windows Firewall on this PC is opened for port {cfg.port} automatically. Use strong passwords —
                      the sign-in page is now reachable from the internet; repeated wrong passwords lock that user ID for 15 minutes.
                    </p>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed text-biome-muted">
                  On a new PC, install Biome and type one of these addresses on the first screen.
                </p>
              </div>
            );
          })()}

          {msg && (
            <p className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] ${
              msg.kind === "ok"
                ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-600"
                : "border-rose-500/30 bg-rose-500/[.07] text-rose-500"
            }`}>
              {msg.kind === "ok" ? <Check size={12} /> : <AlertCircle size={12} />} {msg.text}
            </p>
          )}

          <button onClick={apply} disabled={busy || (mode === "client" && !serverUrl)}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />}
            Apply &amp; restart the app
          </button>
        </div>
      )}
    </GlassCard>
  );
}
