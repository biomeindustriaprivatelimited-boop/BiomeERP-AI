"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck, KeyRound, Activity, AlertCircle } from "lucide-react";
import BiomassLoginScene from "@/components/brand/BiomassLoginScene";
import { useSession } from "@/lib/session";

/**
 * Seeded and admin-reset accounts land here. Until the password is
 * changed the person's password is known to whoever created the account,
 * so nothing else in the app is worth showing yet.
 *
 * Visually this is part of the sign-in flow, not the application shell —
 * it reuses the login screen's scene, card and inputs so the step between
 * "Welcome back" and the dashboard doesn't look like a different product.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, refresh } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const reveal = useCallback(() => setReady(true), []);

  async function submit() {
    if (busy) return;
    setError(null);

    if (newPassword !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("The new password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setError(json.error || `Couldn't change the password (${res.status}).`);
        return;
      }
      await refresh();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(`Couldn't reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="biome-login-page relative min-h-screen overflow-hidden bg-[#06151d] text-white">
      <BiomassLoginScene onRevealLogin={reveal} />

      <div className="relative z-[60] flex min-h-screen items-center justify-end px-4 py-5 sm:px-7 lg:px-10 xl:px-14">
        <motion.section
          initial={{ opacity: 0, y: 26, x: 34, scale: .97, filter: "blur(10px)" }}
          animate={ready ? { opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" } : { opacity: 0, y: 26, x: 34, scale: .97, filter: "blur(10px)" }}
          transition={{ duration: .9, ease: [0.22, 1, 0.36, 1] }}
          className="biome-login-card relative w-full max-w-[430px] overflow-hidden rounded-[30px] border p-6 text-white sm:p-7 xl:mr-[2.5vw]"
          aria-hidden={!ready}
        >
          <div className="biome-login-card-glow absolute -right-24 -top-24 h-64 w-64 rounded-full" />
          <div className="biome-login-card-line absolute inset-x-6 top-0 h-px" />
          {/* Same slow sweep the splash readout card carries, so the screen
              you land on after start-up feels like the same object. */}
          <div className="bsx-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[.06] to-transparent" />

          <div className="relative z-10 flex items-center justify-between border-b border-white/[.08] pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] p-2">
                <img src="/assets/logo.png" alt="BIOME INDUSTRIA" className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-[14px] font-bold tracking-[-.03em]">BIOME <span className="text-cyan-300">ERP</span></p>
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[.22em] text-white/35">Industrial command layer</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-2.5 py-1.5">
              <span className="biome-live-dot bmx-status-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />
              <span className="text-[7px] font-bold uppercase tracking-[.18em] text-emerald-100/65">Secure</span>
            </div>
          </div>

          <div className="relative z-10 mt-7">
            <div className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-[.24em] text-cyan-200/55">
              <Activity size={12} /> First sign-in
            </div>
            <h1 className="mt-3 text-[30px] font-semibold leading-none tracking-[-.055em] text-white sm:text-[34px]">
              Choose your password.
            </h1>
            <p className="mt-3 max-w-[350px] text-[11px] leading-5 text-white/45">
              {user ? `Signed in as ${user.name}. ` : ""}
              Pick something only you know — the temporary password was set by someone else.
            </p>
          </div>

          <div className="relative z-10 mt-7 space-y-4">
            <Field label="Current password" icon={<KeyRound size={15} />}>
              <input
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                placeholder="The password you just used"
                autoComplete="current-password"
                className="biome-login-input biome-login-input-dark bmx-input pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="bmx-toggle absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-white/35 hover:bg-white/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </Field>

            <Field label="New password" icon={<ShieldCheck size={15} />}>
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className="biome-login-input biome-login-input-dark bmx-input"
              />
            </Field>

            <Field label="Confirm new password" icon={<ShieldCheck size={15} />}>
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                placeholder="Type it once more"
                autoComplete="new-password"
                className="biome-login-input biome-login-input-dark bmx-input"
              />
            </Field>

            {error && (
              <div className="bmx-msg-in bmx-nudge flex items-start gap-2 rounded-xl border border-rose-300/25 bg-rose-400/[.08] px-3 py-2.5" role="alert">
                <AlertCircle size={14} className="mt-px shrink-0 text-rose-300" />
                <p className="text-[10.5px] leading-relaxed text-rose-100/80">{error}</p>
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={busy}
            className="biome-login-button bmx-btn group relative z-10 mt-6 flex w-full items-center justify-between overflow-hidden rounded-2xl border border-cyan-200/10 px-4 py-4 text-[12px] font-bold text-white disabled:opacity-70"
          >
            <span className="relative z-10 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10"><ShieldCheck size={14} /></span>
              {busy ? "Saving…" : "Save and continue"}
            </span>
            {busy
              ? <Loader2 size={16} className="relative z-10 animate-spin" />
              : <ArrowRight size={16} className="relative z-10 transition-transform group-hover:translate-x-1" />}
          </button>

          <div className="relative z-10 mt-5 flex items-center justify-between border-t border-white/[.07] pt-4 text-[8px] text-white/30">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Platform ready</span>
            <span>BIOME INDUSTRIA • 2026</span>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="bmx-field block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-white/45">{label}</span>
      <div className="relative">
        <span className="bmx-icon bmx-icon-lead absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-white/35">{icon}</span>
        {children}
        <span className="bmx-field-line" />
      </div>
    </label>
  );
}
