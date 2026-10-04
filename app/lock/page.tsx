"use client";

import { useState } from "react";
import { Lock, Loader2, LogOut, KeyRound, AlertCircle } from "lucide-react";
import BiomeLogo from "@/components/brand/BiomeLogo";
import PinInput from "@/components/PinInput";
import { useSession } from "@/lib/session";

/**
 * This device is locked. The signed-in person unlocks with their MPIN (or
 * password). Nothing else in the app answers until then — the server keeps
 * serving every other PC and phone while this screen is up.
 */
export default function LockPage() {
  const { user, signOut } = useSession();
  const [mode, setMode] = useState<"mpin" | "password">(user?.hasMpin === false ? "password" : "mpin");
  const [mpin, setMpin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useMpin = mode === "mpin" && user?.hasMpin !== false;

  async function unlock(pin?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useMpin ? { mpin: pin ?? mpin } : { password }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (res.status === 401 && j.code === "SIGNED_OUT") { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error(j.error || "Could not unlock.");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (e) {
      setError((e as Error).message);
      setMpin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#04110a] p-5 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(159,232,112,.12),transparent_60%)]" />
      <section className="relative w-full max-w-sm rounded-[28px] border border-white/10 bg-white/[.04] p-7 shadow-[0_40px_120px_-40px_rgba(0,0,0,.8)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[.05] p-1.5"><BiomeLogo size={28} /></div>
          <div>
            <p className="text-[13px] font-bold tracking-tight">BIOME <span className="text-[#9fe870]">AI ERP</span></p>
            <p className="text-[9px] font-bold uppercase tracking-[.2em] text-white/40">Locked</p>
          </div>
        </div>

        <div className="mt-7 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9fe870]/12">
            <Lock size={24} className="text-[#9fe870]" />
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight">{user?.name || "Locked"}</h1>
          <p className="mt-1 text-[11px] text-white/50">
            {useMpin ? "Enter your 8-digit MPIN to unlock." : "Enter your password to unlock."}
          </p>
        </div>

        <div className="mt-6">
          {useMpin ? (
            <PinInput value={mpin} onChange={setMpin} onComplete={(v) => unlock(v)} disabled={busy} />
          ) : (
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && unlock()}
              placeholder="Password"
              className="w-full rounded-xl border border-white/15 bg-white/[.06] px-4 py-3 text-[13px] text-white outline-none focus:border-[#9fe870]"
            />
          )}
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-rose-300/25 bg-rose-400/[.08] px-3 py-2 text-[11px] text-rose-100/90" role="alert">
            <AlertCircle size={13} className="mt-px shrink-0" /> {error}
          </p>
        )}

        {!useMpin && (
          <button onClick={() => unlock()} disabled={busy || !password}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#9fe870] py-3 text-[12px] font-bold text-[#163300] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="bmx-spin" /> : <Lock size={14} />} Unlock
          </button>
        )}
        {useMpin && busy && <p className="mt-3 flex justify-center"><Loader2 size={16} className="bmx-spin text-white/60" /></p>}

        <div className="mt-6 flex items-center justify-between text-[10.5px]">
          {user?.hasMpin !== false ? (
            <button onClick={() => { setMode(useMpin ? "password" : "mpin"); setError(null); }} className="flex items-center gap-1 text-white/55 hover:text-white">
              <KeyRound size={12} /> {useMpin ? "Use password" : "Use MPIN"}
            </button>
          ) : <span className="text-white/35">Set an MPIN in Security &amp; MPIN</span>}
          <button onClick={() => signOut()} className="flex items-center gap-1 text-white/55 hover:text-white">
            <LogOut size={12} /> Sign out
          </button>
        </div>
        <p className="mt-5 text-center text-[9.5px] leading-relaxed text-white/35">
          Only this device is locked. The Biome server keeps working for every other PC and phone.
        </p>
      </section>
    </main>
  );
}
