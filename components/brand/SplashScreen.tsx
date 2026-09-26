"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PathLogo, EASE } from "@/components/motion/kit";
import Hero3D from "@/components/brand/Hero3D";

/**
 * SPLASH — ten seconds, five scenes, one brand:
 *   0.0–2.0  the void wakes: grid sweeps, the particle prism assembles
 *   1.2–3.6  the mark draws itself; BIOME slams in letter by letter from
 *            scattered space (split-text scatter)
 *   3.4–5.5  "AI ERP" resolves out of noise (scramble), tagline types
 *   5.0–8.6  HUD boot: modules come online one by one with checks,
 *            counters run up (plants, clients, vendor codes)
 *   8.6–10   READY — progress completes, iris wipes into the app
 * Enter / click after 3 s skips. Once per session, never on reduced-motion.
 */
const KEY = "biome:splashSeen";
const TOTAL = 10_000;
const BOOT = [
  { at: 5.0, t: "WhatsApp document agent", d: "Hindi + English OCR · MuPDF renderer" },
  { at: 5.6, t: "Tally bridge", d: "ledgers · vouchers · GST" },
  { at: 6.2, t: "PO quantity intelligence", d: "balances computed live" },
  { at: 6.8, t: "Command Center", d: "problems → actions" },
  { at: 7.4, t: "Local AI assistant", d: "on this machine" },
  { at: 8.0, t: "Multi-PC sync", d: "one server · one truth" },
];
const LETTERS = "BIOME".split("");

function useClock(run: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!run) return;
    const start = performance.now(); let raf = 0;
    const tick = (now: number) => { setT((now - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [run]);
  return t;
}

function Scrambled({ text, from, to, now }: { text: string; from: number; to: number; now: number }) {
  const k = Math.max(0, Math.min(1, (now - from) / (to - from)));
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&";
  const out = text.split("").map((c, i) => (c === " " ? " " : i / text.length < k ? c : chars[Math.floor((now * 30 + i * 7) % chars.length)])).join("");
  return <span>{k <= 0 ? "" : out}</span>;
}

export default function SplashScreen({ onDone }: { onDone?: () => void }) {
  const [show, setShow] = useState(false);
  const done = useRef(false);
  const t = useClock(show);

  useEffect(() => {
    const seen = window.sessionStorage.getItem(KEY) === "1";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduce) { done.current = true; onDone?.(); return; }
    setShow(true);
  }, [onDone]);

  // The clock is read through a ref. It used to be a dependency of this
  // effect, and because it changes every frame the effect re-ran every
  // frame — clearing and restarting the ten-second timer each time, so the
  // splash reached 100% and then never left.
  const tRef = useRef(0);
  tRef.current = t;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!show) return;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      try { window.sessionStorage.setItem(KEY, "1"); } catch { /* private mode */ }
      setShow(false);
      window.setTimeout(() => onDoneRef.current?.(), 650);
    };
    const timer = window.setTimeout(finish, TOTAL);
    const skip = (e: KeyboardEvent | MouseEvent) => {
      if (tRef.current < 3) return;
      const key = (e as KeyboardEvent).key;
      if (key && key !== "Enter" && key !== "Escape") return;
      finish();
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("click", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("click", skip);
    };
  }, [show]);

  const progress = Math.min(1, t / (TOTAL / 1000));
  const phase = t < 2 ? "Waking the system" : t < 3.6 ? "Assembling the mark" : t < 5.5 ? "Biome AI ERP" : t < 8.6 ? "Bringing modules online" : "Ready";

  return (
    <AnimatePresence>
      {show && (
        <motion.div key="splash" className="fixed inset-0 z-[9000] overflow-hidden bg-[#050a04] text-white" data-force-dark="1" initial={{ opacity: 1 }}
          exit={{ clipPath: "circle(0% at 50% 50%)", transition: { duration: 0.7, ease: EASE } }} style={{ clipPath: "circle(150% at 50% 50%)" }}>
          {/* Scene 1 — the void wakes */}
          <div className="absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 40%, rgb(159 232 112 / .16) 0%, transparent 60%), radial-gradient(40% 40% at 90% 90%, rgb(22 51 0 / .9) 0%, transparent 60%), linear-gradient(180deg,#0b1a06 0%,#050a04 100%)" }} />
          <motion.div className="absolute inset-0 opacity-[.08]" initial={{ backgroundPositionY: "0px" }} animate={{ backgroundPositionY: "56px" }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            style={{ backgroundImage: "linear-gradient(rgb(159 232 112 / .5) 1px, transparent 1px), linear-gradient(90deg, rgb(159 232 112 / .5) 1px, transparent 1px)", backgroundSize: "56px 56px" }} />
          <motion.div className="absolute inset-x-0 top-0 h-1 bg-[#9fe870]" initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: 1.6, ease: EASE }} style={{ transformOrigin: "left", boxShadow: "0 0 30px #9fe870" }} />
          <motion.div initial={{ opacity: 0, scale: 1.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 2, ease: EASE }} className="absolute inset-0">
            <Hero3D className="absolute inset-0" density={2000} intensity={t > 8.6 ? 3 : 1} />
          </motion.div>
          <div className="absolute inset-0" style={{ background: "radial-gradient(80% 80% at 50% 50%, transparent 55%, rgb(0 0 0 / .55) 100%)" }} />
          <div className="absolute inset-0 opacity-[.06]" style={{ background: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px)" }} />

          {/* Scrim directly under the wordmark: the vignette darkens the
              edges, but the type sits in the middle over the brightest part
              of the prism. This keeps it readable without dimming the scene. */}
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(46% 38% at 50% 46%, rgb(3 10 2 / .72) 0%, rgb(3 10 2 / .35) 55%, transparent 78%)" }} />

          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
            {/* Scene 2 — the mark */}
            <motion.div initial={{ scale: 0.6, opacity: 0, rotateY: -60 }} animate={{ scale: 1, opacity: 1, rotateY: 0 }} transition={{ delay: 1.1, duration: 1.2, ease: EASE }} style={{ perspective: 800 }}>
              <PathLogo size={128} />
            </motion.div>

            {/* BIOME — scattered → slammed into place */}
            <h1 className="biome-shout mt-6 flex text-[64px] leading-none tracking-[-0.05em] sm:text-[84px]" aria-label="BIOME">
              {LETTERS.map((ch, i) => (
                <motion.span key={i} className="inline-block"
                  initial={{ opacity: 0, x: (i - 2) * 140, y: (i % 2 ? -1 : 1) * 120, rotate: (i - 2) * 25, scale: 2.2, filter: "blur(10px)" }}
                  animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, filter: "blur(0px)" }}
                  transition={{
                    delay: 1.8 + i * 0.12, type: "spring", stiffness: 260, damping: 18,
                    filter: { delay: 1.8 + i * 0.12, duration: 0.45, ease: "easeOut" },
                    opacity: { delay: 1.8 + i * 0.12, duration: 0.3 },
                  }}>{ch}</motion.span>
              ))}
            </h1>

            {/* Scene 3 — AI ERP */}
            <div className="mt-2 h-[44px] font-mono text-[26px] font-bold tracking-[.35em] text-[#9fe870] sm:text-[34px]" style={{ textShadow: "0 0 24px rgb(159 232 112 / .6)" }}>
              <Scrambled text="AI  ERP" from={3.4} to={4.8} now={t} />
            </div>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: t > 4.6 ? 1 : 0 }} transition={{ duration: 0.5 }} className="mt-2 text-[11px] uppercase tracking-[.4em] text-[#e2f6d5]/70">
              Biomass supply · intelligently run
            </motion.p>

            {/* Scene 4 — HUD boot */}
            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-1.5 sm:grid-cols-2">
              {BOOT.map((b) => {
                const on = t >= b.at;
                return (
                  <motion.div key={b.t} initial={{ opacity: 0, x: -14 }} animate={{ opacity: on ? 1 : 0, x: on ? 0 : -14 }} transition={{ duration: 0.4, ease: EASE }}
                    className="flex items-center gap-2 rounded-xl border border-[#9fe870]/20 bg-black/30 px-3 py-2 backdrop-blur">
                    <span className={`h-2 w-2 rounded-full ${on ? "bg-[#9fe870] shadow-[0_0_10px_#9fe870]" : "bg-white/20"}`} />
                    <span className="text-[11px] font-semibold text-white">{b.t}</span>
                    <span className="ml-auto text-[9.5px] text-[#e2f6d5]/60">{b.d}</span>
                    <span className="font-mono text-[10px] text-[#9fe870]">{on ? "OK" : "…"}</span>
                  </motion.div>
                );
              })}
            </div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: t > 6 ? 1 : 0 }} className="mt-5 flex gap-6 font-mono text-[11px] text-[#e2f6d5]/80">
              {[["2", "plants"], ["27", "power-plant clients"], ["53", "vendor codes"], ["1", "server · N clients"]].map(([n, l]) => (
                <span key={l}><span className="text-[16px] font-bold text-white">{t > 6 ? n : "0"}</span> <span className="text-[#e2f6d5]/50">{l}</span></span>
              ))}
            </motion.div>

            {/* Scene 5 — READY */}
            <div className="mt-8 w-72">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[.25em] text-[#e2f6d5]/60"><span>{phase}</span><span className="font-mono">{Math.round(progress * 100)}%</span></div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#9fe870]" style={{ width: `${progress * 100}%`, boxShadow: "0 0 18px rgb(159 232 112 / .9)" }} /></div>
              <p className="mt-3 text-center text-[9.5px] text-[#e2f6d5]/40">{t > 3 ? "Press Enter to skip" : ""}</p>
            </div>
          </div>
          {t > 8.6 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 0.35, 0] }} transition={{ duration: 0.9, repeat: 1 }} className="absolute inset-0 bg-[#9fe870]" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
