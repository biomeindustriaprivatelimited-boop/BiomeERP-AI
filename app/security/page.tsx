"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, KeyRound, Lock, Loader2, Check, AlertCircle, Timer } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PinInput from "@/components/PinInput";
import { useSession } from "@/lib/session";
import { lockNow } from "@/components/IdleLock";

const LOCK_CHOICES = [0, 2, 5, 10, 15, 30, 60];

/**
 * Security & MPIN — every signed-in person, for their own account.
 *   - 8-digit MPIN: sign back in on this PC/phone without the password,
 *     and unlock a locked screen. A NEW device always needs the password.
 *   - Auto-lock after N idle minutes (the developer cannot turn it off).
 */
export default function SecurityPage() {
  const { user, refresh } = useSession();
  const [info, setInfo] = useState<{ hasMpin: boolean; autoLockMinutes: number; role: string } | null>(null);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/auth/security", { cache: "no-store" }).catch(() => null);
    if (r && r.ok) setInfo(await r.json());
  }
  useEffect(() => { load(); }, []);

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/auth/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error || "Could not save.");
      setMsg({ ok: true, text: okText });
      setPin1(""); setPin2(""); setPassword("");
      await load(); await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  function saveMpin() {
    if (pin1.length !== 8) return setMsg({ ok: false, text: "Enter all 8 digits." });
    if (pin1 !== pin2) return setMsg({ ok: false, text: "The two MPINs do not match." });
    if (!password) return setMsg({ ok: false, text: "Enter your account password to confirm." });
    post({ action: "setMpin", mpin: pin1, password }, "MPIN saved. On this PC you can now sign in and unlock with it.");
  }

  const isDev = info?.role === "developer" || user?.role === "developer";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-biome-leaf/10"><ShieldCheck size={20} className="text-biome-leafBright" /></span>
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-biome-text">Security &amp; MPIN</h1>
          <p className="text-[11.5px] text-biome-muted">Protect your account on shared PCs. These settings are only for <b>{user?.name}</b>.</p>
        </div>
      </div>

      {msg && (
        <p className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] ${msg.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-600" : "border-rose-500/30 bg-rose-500/[.07] text-rose-500"}`}>
          {msg.ok ? <Check size={13} /> : <AlertCircle size={13} />} {msg.text}
        </p>
      )}

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-semibold text-biome-text">8-digit MPIN</h2>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${info?.hasMpin ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600" : "border-biome-line text-biome-muted"}`}>
            {info?.hasMpin ? "Set" : "Not set"}
          </span>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
          After you sign out on a PC or phone where you have signed in before, sign back in with this MPIN instead of the
          password, and unlock a locked screen with it. A <b>new</b> PC or phone always asks for the user ID and password.
          Five wrong MPINs block it until you next sign in with your password.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{info?.hasMpin ? "New MPIN" : "MPIN"}</p>
            <PinInput value={pin1} onChange={setPin1} dark={false} autoFocus={false} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Repeat MPIN</p>
            <PinInput value={pin2} onChange={setPin2} dark={false} autoFocus={false} />
          </div>
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Your account password (to confirm)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none" />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={saveMpin} disabled={busy}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />} {info?.hasMpin ? "Change MPIN" : "Set MPIN"}
          </button>
          {info?.hasMpin && (
            <button onClick={() => (password ? post({ action: "removeMpin", password }, "MPIN removed. Sign in with your password from now on.") : setMsg({ ok: false, text: "Enter your password to remove the MPIN." }))}
              disabled={busy} className="rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted hover:text-biome-text">
              Remove MPIN
            </button>
          )}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <Timer size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-semibold text-biome-text">Auto-lock</h2>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
          Lock this screen after a few minutes without use. Unlock with your MPIN or password. Only this device locks — on the
          server PC the server keeps working for everyone.{isDev && " The developer account cannot switch this off."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LOCK_CHOICES.filter((m) => !(isDev && m === 0)).map((m) => (
            <button key={m} disabled={busy} onClick={() => post({ action: "autoLock", minutes: m }, m ? `Auto-lock after ${m} minutes.` : "Auto-lock is off.")}
              className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold ${info?.autoLockMinutes === m ? "border-biome-leaf bg-biome-leaf text-white" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
              {m ? `${m} min` : "Off"}
            </button>
          ))}
        </div>
        <button onClick={() => lockNow()} className="mt-4 flex items-center gap-2 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-text hover:border-biome-leaf/40">
          <Lock size={13} /> Lock now
        </button>
      </GlassCard>
    </div>
  );
}
