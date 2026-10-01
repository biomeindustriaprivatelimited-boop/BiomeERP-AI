"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, UserRound, Fingerprint, Activity, KeyRound, Factory, AlertCircle } from "lucide-react";
import BiomassLoginScene from "@/components/brand/BiomassLoginScene";
import BiomeLogo from "@/components/brand/BiomeLogo";
import { CursorGlow } from "@/components/fx";
import { useSession } from "@/lib/session";
import { usePlants } from "@/lib/usePlants";

export default function LoginPage() {
  const PLANTS = usePlants();
  const router = useRouter();
  const { refresh } = useSession();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginReady, setLoginReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every refused sign-in so the error block re-mounts and its
  // entrance animation plays again rather than sitting there unchanged.
  const [attempt, setAttempt] = useState(0);
  /**
   * Which plants this account may sign in as. Stays empty — and the
   * picker stays hidden — until the server says so, so the screen looks
   * exactly as before for everyone who works at one place or none.
   */
  const [plantChoices, setPlantChoices] = useState<string[]>([]);
  const [plant, setPlant] = useState<string>("");

  const revealLogin = useCallback(() => setLoginReady(true), []);

  /**
   * Desktop app only: which server this PC signs in to, with a way to
   * change it. A PC pointed at the wrong server (or one an older version
   * turned into its own empty server) shows "user ID not found" for every
   * real account — this link is the way out without reinstalling.
   */
  const [desk, setDesk] = useState<{ mode: string; serverUrl: string } | null>(null);
  useEffect(() => {
    const d = (window as any).biomeDesktop;
    if (!d?.getAppInfo || !d?.openSetup) return;
    d.getAppInfo().then((i: any) => setDesk({ mode: i?.mode || "server", serverUrl: i?.serverUrl || "" })).catch(() => {});
  }, []);

  function fail(message: string) {
    setAttempt(n => n + 1);
    setError(message);
  }

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userId.trim(), password, plant: plant || null }),
      });
      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        if (Array.isArray(json.needsPlant) && json.needsPlant.length > 0) {
          setPlantChoices(json.needsPlant);
          if (json.needsPlant.length === 1) setPlant(json.needsPlant[0]);
          fail(json.needsPlant.length === 1
            ? "Confirm the plant and sign in again."
            : "Choose which plant you are signing in for.");
          return;
        }
        fail(json.error || `Sign-in failed (${res.status}).`);
        return;
      }

      // Tell the shell about the new session before navigating, or it
      // sends us straight back here believing nobody signed in.
      await refresh();
      router.replace(json.user?.mustChangePassword ? "/change-password" : "/");
    } catch (err) {
      fail(`Couldn't reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="biome-login-page relative min-h-screen overflow-hidden bg-[#06151d] text-white" data-force-dark="1">
      <BiomassLoginScene onRevealLogin={revealLogin} />
      <CursorGlow />

      <div className="relative z-[60] flex min-h-screen items-center justify-end px-4 py-5 sm:px-7 lg:px-10 xl:px-14">
        <motion.section
          initial={{ opacity: 0, y: 26, x: 34, scale: .97, filter: "blur(10px)" }}
          animate={loginReady ? { opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" } : { opacity: 0, y: 26, x: 34, scale: .97, filter: "blur(10px)" }}
          transition={{ duration: .9, ease: [0.22,1,0.36,1] }}
          className="biome-login-card relative w-full max-w-[440px] overflow-hidden rounded-[30px] border border-[#9fe870]/25 bg-[#0b1a06]/70 p-6 text-white shadow-[0_30px_80px_-30px_rgb(159_232_112/.35)] backdrop-blur-xl sm:p-7 xl:mr-[2.5vw]"
          aria-hidden={!loginReady}
        >
          <div className="biome-login-card-glow absolute -right-24 -top-24 h-64 w-64 rounded-full" />
          <div className="biome-login-card-line absolute inset-x-6 top-0 h-px" />
          {/* Same slow sweep the splash readout card carries, so the screen
              you land on after start-up feels like the same object. */}
          <div className="bsx-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[.06] to-transparent" />

          <div className={`relative z-10 flex items-center justify-between border-b border-white/[.08] pb-5 ${loginReady ? "bmx-rise" : "opacity-0"}`} style={{ animationDelay: ".08s" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] p-2">
                <BiomeLogo size={30} />
              </div>
              <div>
                <p className="text-[14px] font-bold tracking-[-.03em]">BIOME <span className="text-[#9fe870]">AI ERP</span></p>
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[.22em] text-white/35">Biomass supply · Rewari & Gangakhed</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-2.5 py-1.5">
              <span className="biome-live-dot bmx-status-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />
              <span className="text-[7px] font-bold uppercase tracking-[.18em] text-emerald-100/65">Secure</span>
            </div>
          </div>

          <div className={`relative z-10 mt-7 ${loginReady ? "bmx-rise" : "opacity-0"}`} style={{ animationDelay: ".18s" }}>
            <div className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-[.24em] text-cyan-200/55"><Activity size={12} /> Command gateway</div>
            <h1 className="mt-3 text-[34px] font-semibold leading-none tracking-[-.055em] text-white sm:text-[38px]">Welcome back.</h1>
            <p className="mt-3 max-w-[350px] text-[11px] leading-5 text-white/45">Access your biomass supply, plant operations, finance and compliance workspace.</p>
          </div>

          <div className={`relative z-10 mt-7 space-y-4 ${loginReady ? "bmx-rise" : "opacity-0"}`} style={{ animationDelay: ".3s" }}>
            <Field label="User ID" icon={<UserRound size={15} />} dark filled={userId.trim().length > 0}>
              <input value={userId} onChange={e => setUserId(e.target.value)} onKeyDown={e => e.key === "Enter" && signIn()} placeholder="Enter your User ID" autoComplete="username" className="biome-login-input biome-login-input-dark bmx-input pr-9" />
            </Field>
            <Field label="Password" icon={<KeyRound size={15} />} dark>
              <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && signIn()} placeholder="Enter your password" autoComplete="current-password" className="biome-login-input biome-login-input-dark bmx-input pr-12" />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="bmx-toggle absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-white/35 hover:bg-white/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </Field>

            {/* Both of these render nothing in the normal case, so the
                screen looks exactly as it did before. The picker appears
                only for an account assigned to more than one plant; the
                message only when a sign-in is refused. */}
            {plantChoices.length > 0 && (
              <Field label="Signing in for" icon={<Factory size={15} />} dark>
                <select value={plant} onChange={e => setPlant(e.target.value)} className="biome-login-input biome-login-input-dark bmx-input appearance-none">
                  <option value="">Select plant…</option>
                  {plantChoices.map(code => (
                    <option key={code} value={code} className="bg-[#06151d]">{PLANTS.find(p => p.code === code)?.label || code} ({code})</option>
                  ))}
                </select>
              </Field>
            )}

            {/* Keyed on the attempt count so a repeated failure replays the
                nudge — otherwise the second wrong password looks ignored. */}
            {error && (
              <div key={attempt} className="bmx-msg-in bmx-nudge flex items-start gap-2 rounded-xl border border-rose-300/25 bg-rose-400/[.08] px-3 py-2.5" role="alert">
                <AlertCircle size={14} className="mt-px shrink-0 text-rose-300" />
                <p className="text-[10.5px] leading-relaxed text-rose-100/85">{error}</p>
              </div>
            )}
          </div>

          <div className={`relative z-10 mt-5 flex items-center justify-between ${loginReady ? "bmx-rise" : "opacity-0"}`} style={{ animationDelay: ".4s" }}>
            <span className="inline-flex items-center gap-1.5 text-[9px] text-white/35"><Fingerprint size={13} className="text-emerald-300/70" /> Identity layer ready</span>
            <span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[7px] font-bold uppercase tracking-[.15em] text-white/30">Testing mode</span>
          </div>

          <div className={`relative z-10 mt-6 ${loginReady ? "bmx-rise" : "opacity-0"}`} style={{ animationDelay: ".48s" }}>
          <button onClick={signIn} disabled={busy} className="biome-login-button bmx-btn group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border border-cyan-200/10 px-4 py-4 text-[12px] font-bold text-white disabled:opacity-70">
            <span className="bmx-btn-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent)" }} />
            <span className="relative z-10 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 transition-transform duration-300 group-hover:scale-110"><ShieldCheck size={14} /></span>
              {busy ? "Opening command center…" : "Enter BIOME command center"}
            </span>
            {busy
              ? <Loader2 size={16} className="bmx-spin relative z-10" />
              : <ArrowRight size={16} className="relative z-10 transition-transform duration-300 group-hover:translate-x-1.5" />}
          </button>
          </div>

          {desk && (
            <div className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2 text-[9.5px] text-white/45">
              <span className="min-w-0 truncate">
                {desk.mode === "client"
                  ? <>Server: <span className="font-mono text-white/70">{desk.serverUrl}</span></>
                  : <>This PC is the <span className="font-semibold text-white/70">server</span></>}
              </span>
              <button type="button" onClick={() => (window as any).biomeDesktop?.openSetup?.()}
                className="rounded-full border border-white/15 px-2.5 py-1 font-semibold text-[#9fe870] hover:border-[#9fe870]/50">
                {desk.mode === "client" ? "Change server" : "Connect to another server"}
              </button>
            </div>
          )}

          <div className="relative z-10 mt-5 flex items-center justify-between border-t border-white/[.07] pt-4 text-[8px] text-white/30">
            <span className="inline-flex items-center gap-1.5"><span className="bmx-status-dot h-1.5 w-1.5 rounded-full bg-emerald-300" /> Platform ready</span>
            <span>BIOME INDUSTRIA • 2026</span>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

/**
 * A labelled input.
 *
 * The interaction states live here rather than on each input so every field
 * behaves identically: a small lift on hover, the leading icon brightening
 * on focus, an underline growing from the centre, and a quiet dot once the
 * field has something in it. `filled` is optional — a field that does not
 * pass it simply never shows the dot.
 */
function Field({ label, icon, children, dark = false, filled = false }: { label: string; icon: React.ReactNode; children: React.ReactNode; dark?: boolean; filled?: boolean }) {
  return (
    <label className="bmx-field block">
      <span className={`mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] ${dark ? "text-white/45" : "text-slate-500"}`}>{label}</span>
      <div className="relative">
        <span className={`bmx-icon bmx-icon-lead absolute left-3.5 top-1/2 z-10 -translate-y-1/2 ${dark ? "text-white/35" : "text-slate-400"}`}>{icon}</span>
        {children}
        <span className="bmx-field-line" />
        {filled && (
          <span className="bmx-filled-dot pointer-events-none absolute right-3.5 top-1/2 z-10 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300/80" />
        )}
      </div>
    </label>
  );
}

function TrustItem({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="flex items-center justify-center gap-1.5 text-[9px] font-semibold text-white/45">{icon}<span>{title}</span></div>;
}
