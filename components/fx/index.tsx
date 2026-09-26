"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Game-grade ambience for a business app — restrained enough to work
 * eight hours a day, alive enough to feel premium:
 *
 *   CursorGlow   — a soft light and a lagging ring follow the pointer;
 *                  the ring grows over anything clickable (cursor UX)
 *   Particles    — a slow field of pellets/embers on a canvas, theme-aware,
 *                  pointer-repelled, paused when the tab is hidden
 *   Ripples      — Material-style press ripple on every button
 *
 * All three switch off on touch devices and under prefers-reduced-motion.
 */

function useMotionOk() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    setOk(fine && !reduce);
  }, []);
  return ok;
}

function themeAccent(): string {
  const t = document.documentElement.getAttribute("data-theme") || "dark";
  return t === "sunrise" ? "255,176,60" : t === "command" ? "103,232,249" : t === "midnight" ? "190,255,90" : t === "light" ? "121,200,60" : "159,232,112";
}

export function CursorGlow() {
  const ok = useMotionOk();
  const dot = useRef<HTMLDivElement | null>(null); const ring = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ok) return;
    let mx = -100, my = -100, rx = -100, ry = -100, hot = false, raf = 0;
    const move = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; const t = e.target as HTMLElement | null; hot = Boolean(t?.closest?.("a, button, [role=button], input, select, textarea, label")); };
    const tick = () => {
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      if (dot.current) dot.current.style.transform = `translate3d(${mx - 4}px, ${my - 4}px, 0)`;
      if (ring.current) { ring.current.style.transform = `translate3d(${rx - 18}px, ${ry - 18}px, 0) scale(${hot ? 1.6 : 1})`; ring.current.style.opacity = hot ? "0.9" : "0.5"; }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move, { passive: true }); raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, [ok]);
  if (!ok) return null;
  return (
    <>
      <div ref={dot} className="pointer-events-none fixed left-0 top-0 z-[9998] h-2 w-2 rounded-full mix-blend-screen" style={{ background: "rgb(var(--c-volt))", boxShadow: "0 0 18px 6px rgb(var(--c-volt) / .55)" }} />
      <div ref={ring} className="pointer-events-none fixed left-0 top-0 z-[9998] h-9 w-9 rounded-full border transition-[opacity] duration-200" style={{ borderColor: "rgb(var(--c-volt) / .75)", boxShadow: "inset 0 0 12px rgb(var(--c-volt) / .18)" }} />
    </>
  );
}

export function Particles({ density = 70, className = "" }: { density?: number; className?: string }) {
  const ok = useMotionOk();
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!ok || !ref.current) return;
    const c = ref.current; const ctx = c.getContext("2d")!; let raf = 0; let w = 0, h = 0;
    const pts = Array.from({ length: density }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, vx: (Math.random() - 0.5) * 0.00012, vy: -0.00005 - Math.random() * 0.00012, a: 0.15 + Math.random() * 0.45, p: Math.random() * Math.PI * 2 }));
    let mx = -1, my = -1; const move = (e: PointerEvent) => { mx = e.clientX / w; my = e.clientY / h; };
    const resize = () => { w = c.width = window.innerWidth; h = c.height = window.innerHeight; };
    resize(); window.addEventListener("resize", resize); window.addEventListener("pointermove", move, { passive: true });
    let last = performance.now();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(50, t - last); last = t;
      const accent = themeAccent();
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.p += dt * 0.002;
        if (mx >= 0) { const dx = p.x - mx, dy = p.y - my; const d2 = dx * dx + dy * dy; if (d2 < 0.012) { p.x += dx * 0.02; p.y += dy * 0.02; } }
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); } if (p.x < -0.05) p.x = 1.05; if (p.x > 1.05) p.x = -0.05;
        const tw = 0.6 + 0.4 * Math.sin(p.p);
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${accent},${(p.a * tw).toFixed(3)})`; ctx.fill();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("pointermove", move); };
  }, [ok, density]);
  if (!ok) return null;
  return <canvas ref={ref} aria-hidden="true" data-fx-particles="1" className={`pointer-events-none fixed inset-0 -z-[5] ${className}`} />;
}

export function Ripples() {
  const ok = useMotionOk();
  useEffect(() => {
    if (!ok) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("button, .bmx-btn, .rail-item, a[class*='rounded-']") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect(); const size = Math.max(r.width, r.height) * 1.6;
      const s = document.createElement("span");
      s.className = "fx-ripple"; s.style.width = s.style.height = `${size}px`; s.style.left = `${e.clientX - r.left - size / 2}px`; s.style.top = `${e.clientY - r.top - size / 2}px`;
      const prevPos = getComputedStyle(el).position; if (prevPos === "static") el.style.position = "relative";
      el.style.overflow = el.style.overflow || "hidden";
      el.appendChild(s); s.addEventListener("animationend", () => s.remove(), { once: true });
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ok]);
  return null;
}
