"use client";

/**
 * Biome motion kit — the patterns from motion.dev, built on the same
 * engine (framer-motion is Motion for React), tuned to this app:
 *
 *   TiltCard      — "Tilt card": 3D perspective tilt that follows the pointer, with a light sheen
 *   SplitText     — "Split text": words/characters rise in with a physical stagger
 *   Scramble      — "Scramble text": numbers resolve from noise (used on money)
 *   CountUp       — spring-driven number
 *   Stagger/Item  — "Physical stagger": grids arrive one after another
 *   Magnetic      — "Spring: follow cursor": buttons lean toward the pointer
 *   PathLogo      — "Infinite path drawing": SVG stroke draws itself
 *   PageWipe      — "Page wipe": route transitions
 *
 * Everything honours prefers-reduced-motion via framer's useReducedMotion.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion, AnimatePresence, type MotionProps } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;

/* ---------- Tilt card (3D) ---------- */
export function TiltCard({ children, className = "", max = 10, glare = true, ...rest }: { children: React.ReactNode; className?: string; max?: number; glare?: boolean } & MotionProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), { stiffness: 260, damping: 22 });
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), { stiffness: 260, damping: 22 });
  const gx = useTransform(x, [-0.5, 0.5], ["0%", "100%"]); const gy = useTransform(y, [-0.5, 0.5], ["0%", "100%"]);
  function move(e: React.PointerEvent) { const r = ref.current?.getBoundingClientRect(); if (!r) return; x.set((e.clientX - r.left) / r.width - 0.5); y.set((e.clientY - r.top) / r.height - 0.5); }
  function leave() { x.set(0); y.set(0); }
  return (
    <motion.div ref={ref} onPointerMove={reduce ? undefined : move} onPointerLeave={leave}
      style={{ rotateX: reduce ? 0 : rx, rotateY: reduce ? 0 : ry, transformStyle: "preserve-3d", perspective: 900 }}
      className={`relative [transform-style:preserve-3d] ${className}`} {...rest}>
      <div style={{ transform: "translateZ(0.01px)" }}>{children}</div>
      {glare && !reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 hover:opacity-100" style={{ background: useTransform([gx, gy], ([a, b]) => `radial-gradient(420px circle at ${a} ${b}, rgb(159 232 112 / .16), transparent 45%)`) }} />}
    </motion.div>
  );
}

/* ---------- Split text ---------- */
export function SplitText({ text, className = "", delay = 0, by = "word", stagger = 0.04 }: { text: string; className?: string; delay?: number; by?: "word" | "char"; stagger?: number }) {
  const reduce = useReducedMotion();
  const parts = by === "char" ? Array.from(text) : text.split(" ");
  return (
    <span className={`inline-block ${className}`} aria-label={text}>
      {parts.map((p, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span className="inline-block" initial={reduce ? false : { y: "110%", opacity: 0, rotateX: -40 }} animate={{ y: 0, opacity: 1, rotateX: 0 }}
            transition={{ delay: delay + i * stagger, duration: 0.6, ease: EASE }}>{p}{by === "word" && i < parts.length - 1 ? "\u00A0" : ""}</motion.span>
        </span>
      ))}
    </span>
  );
}

/* ---------- Scramble (numbers resolve from noise) ---------- */
export function Scramble({ value, className = "", duration = 700 }: { value: string; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(value);
  useEffect(() => {
    if (reduce) { setOut(value); return; }
    const chars = "0123456789₹.,";
    const start = performance.now(); let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setOut(value.split("").map((c, i) => (c === " " || c === "," || c === "." ? c : i / value.length < k ? c : chars[Math.floor(Math.random() * chars.length)])).join(""));
      if (k < 1) raf = requestAnimationFrame(tick); else setOut(value);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);
  return <span className={`tabular-nums ${className}`}>{out}</span>;
}

/* ---------- Count up ---------- */
export function CountUp({ to, className = "", format = (n: number) => Math.round(n).toLocaleString("en-IN") }: { to: number; className?: string; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0); const sp = useSpring(mv, { stiffness: 80, damping: 20 });
  const [txt, setTxt] = useState(format(reduce ? to : 0));
  useEffect(() => { mv.set(to); const un = sp.on("change", (v) => setTxt(format(v))); return () => un(); }, [to, mv, sp, format]);
  return <span className={`tabular-nums ${className}`}>{txt}</span>;
}

/* ---------- Physical stagger ---------- */
export function Stagger({ children, className = "", delay = 0, gap = 0.06 }: { children: React.ReactNode; className?: string; delay?: number; gap?: number }) {
  return <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}>{children}</motion.div>;
}
export function Item({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} variants={{ hidden: reduce ? {} : { opacity: 0, y: 22, scale: 0.97, filter: "blur(4px)" }, show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { ...SPRING, filter: { duration: 0.35, ease: "easeOut" }, opacity: { duration: 0.3 } } } }}>{children}</motion.div>;
}

/* ---------- Magnetic (follows the cursor) ---------- */
export function Magnetic({ children, className = "", strength = 0.35 }: { children: React.ReactNode; className?: string; strength?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 }); const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 });
  return (
    <motion.div ref={ref} style={{ x, y }} className={`inline-block ${className}`}
      onPointerMove={(e) => { if (reduce) return; const r = ref.current!.getBoundingClientRect(); x.set((e.clientX - (r.left + r.width / 2)) * strength); y.set((e.clientY - (r.top + r.height / 2)) * strength); }}
      onPointerLeave={() => { x.set(0); y.set(0); }}>{children}</motion.div>
  );
}

/* ---------- Path-drawing logo (loader / splash) ---------- */
export function PathLogo({ size = 96, loop = false, stroke = "#9fe870" }: { size?: number; loop?: boolean; stroke?: string }) {
  const reduce = useReducedMotion();
  const draw = { hidden: { pathLength: 0, opacity: 0 }, show: (i: number) => ({ pathLength: 1, opacity: 1, transition: { pathLength: { delay: i * 0.25, duration: 1.4, ease: "easeInOut", ...(loop ? { repeat: Infinity, repeatType: "reverse" as const, repeatDelay: 0.6 } : {}) }, opacity: { delay: i * 0.25, duration: 0.2 } } }) };
  return (
    <motion.svg width={size} height={size} viewBox="0 0 64 64" initial={reduce ? "show" : "hidden"} animate="show" aria-label="Biome" role="img">
      <motion.path d="M32 3 55 15.5v25L32 53 9 40.5v-25L32 3z" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" custom={0} variants={draw} />
      <motion.path d="M43.5 17.5c1.2 10.8-4.1 22.4-14.4 26.1-3.2 1.1-6.5 1.2-9.6.4 2.2-9.9 8.6-19.1 17.9-24.1 2-1.1 4.1-1.9 6.1-2.4z" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" custom={1} variants={draw} />
      <motion.path d="M22.5 42.5c4-7.4 9.1-13.7 15.3-18.6M27 34.5l4.2.3M30.5 29.6l3.9-.3M25.2 38.9l3.3 1.6M37.8 23.9l3.6-3.6" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" custom={2} variants={draw} />
    </motion.svg>
  );
}

/* ---------- Page wipe (route transitions) ---------- */
export function PageWipe({ children, id }: { children: React.ReactNode; id: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={id}
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -6, transition: { duration: 0.15 } }}
        transition={{ duration: 0.3, ease: EASE }}
        style={{ minHeight: 0 }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
