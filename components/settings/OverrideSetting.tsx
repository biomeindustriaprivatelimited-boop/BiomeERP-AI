"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Loader2, Check, X, Clock } from "lucide-react";

/**
 * Admin override — the switch, and the banner that will not let you forget
 * it is on.
 *
 * The banner is the important half. An override that is quietly running is
 * how an admin edits a frozen record without realising the record was
 * frozen — which is exactly the situation the lock existed to prevent. So
 * it sits at the top of the screen, counts down in real time, and offers
 * one button: turn it off.
 */

interface Grant {
  userId: string; userName: string; reason: string;
  startedAt: string; expiresAt: string; used: number;
}

function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

export function OverrideBanner() {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [left, setLeft] = useState(0);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/override", { cache: "no-store" });
      // A non-admin gets 403 here, which is the correct answer and not an
      // error worth showing anyone.
      if (!res.ok) { setGrant(null); return; }
      const json = await res.json();
      setGrant(json.active ? json.grant : null);
    } catch { setGrant(null); }
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [check]);

  // Counted down locally every ten seconds so the figure on screen is not
  // a minute stale — the whole point is knowing how long is left.
  useEffect(() => {
    if (!grant) return;
    const tick = () => {
      const m = minutesLeft(grant.expiresAt);
      setLeft(m);
      if (m === 0) setGrant(null);
    };
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [grant]);

  async function end() {
    await fetch("/api/override", { method: "DELETE" }).catch(() => {});
    setGrant(null);
  }

  if (!grant) return null;

  return (
    <div className="bmx-msg-in sticky top-0 z-[120] flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/[.12] px-4 py-2 backdrop-blur">
      <ShieldAlert size={15} className="shrink-0 text-amber-600" />
      <p className="text-[11.5px] font-semibold text-amber-700 dark:text-amber-500">
        Override is on — you can edit frozen records, and every change is recorded against your name.
      </p>
      <span className="flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-600">
        <Clock size={10} /> {left} min left
      </span>
      {grant.used > 0 && (
        <span className="text-[10px] text-amber-600">{grant.used} change{grant.used === 1 ? "" : "s"} so far</span>
      )}
      <button onClick={end}
        className="bmx-chip ml-auto rounded-lg border border-amber-500/40 px-3 py-1 text-[10.5px] font-bold text-amber-700 dark:text-amber-500">
        Turn it off
      </button>
    </div>
  );
}

export default function OverrideSetting() {
  const [state, setState] = useState<{ active: boolean; grant: Grant | null; minutes: number } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/override", { cache: "no-store" });
    if (!res.ok) return;
    setState(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function start() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/override", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not switch it on.");
      setReason("");
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true); setErr(null);
    try {
      await fetch("/api/override", { method: "DELETE" });
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!state) return null;

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
        <ShieldAlert size={15} className="text-amber-600" /> Override
      </h2>
      <p className="mt-1.5 max-w-[640px] text-[11.5px] leading-relaxed text-biome-muted">
        Some records stop being editable on purpose — a coordination entry a week after the client
        unloaded, a payroll month already paid. Override lets you change one anyway, for{" "}
        {state.minutes} minutes, with your reason attached to every change in the audit log.
      </p>
      <p className="mt-2 max-w-[640px] text-[11px] leading-relaxed text-biome-muted">
        It does <strong className="text-biome-text">not</strong> let you approve your own imprest
        entry, your own leave, or your own edit request. Those rules exist so that two people see
        every decision, and an override that dissolved them would make every approval in the app
        worthless.
      </p>

      {err && (
        <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>
      )}

      {state.active && state.grant ? (
        <div className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/[.08] px-4 py-3">
          <p className="flex items-center gap-2 text-[11.5px] font-semibold text-amber-600">
            <Clock size={13} /> Running — {minutesLeft(state.grant.expiresAt)} minutes left
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
            &ldquo;{state.grant.reason}&rdquo; · {state.grant.used} change{state.grant.used === 1 ? "" : "s"} made under it.
          </p>
          <button onClick={stop} disabled={busy}
            className="bmx-btn mt-3 flex items-center gap-2 rounded-xl border border-amber-500/40 px-4 py-2 text-[11.5px] font-bold text-amber-600 disabled:opacity-60">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <X size={13} />} Turn it off now
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
              What do you need to change, and why?
            </span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Trip #412 was entered against the wrong vehicle — the plant sent the corrected slip on 14 Aug."
              className="bmx-input w-full resize-y rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none"
            />
          </label>
          <button onClick={start} disabled={busy || reason.trim().length < 15}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />} Switch on for {state.minutes} minutes
          </button>
        </div>
      )}
    </section>
  );
}
