"use client";

import { useEffect, useRef } from "react";

/**
 * AnimatedBackground
 * ------------------
 * World-class animated backdrop for a Biomass Pellet & Renewable Energy
 * enterprise platform. Communicates sustainability, clean energy, nature +
 * technology, industrial intelligence, and environmental responsibility —
 * without ever feeling flashy, gaming-styled, or distracting.
 *
 * Layered composition (back to front):
 *   1. Deep forest-green -> navy gradient base (#08130F -> #0F172A)
 *   2. Fixed, ultra-soft ambient glows (green / gold / navy) for depth
 *   3. Diagonal light rays drifting slowly (clean-energy sunlight motif)
 *   4. Large, near-invisible floating leaf silhouettes (far background)
 *   5. Ultra-thin flowing energy lines with a traveling glow pulse
 *      (renewable energy moving through a smart grid/network)
 *   6. Hundreds of tiny glowing dust particles (biomass dust / energy motes)
 *      in warm gold, soft green, and white
 *   7. A handful of small rotating biomass-pellet shapes that fade in and
 *      out naturally, never more than a few visible at once
 *   8. Subtle glowing dust concentrated near the viewport edges
 *
 * Engineering:
 *   - Single <canvas>, single requestAnimationFrame loop -> no per-frame DOM
 *     writes, GPU-composited, cheap even with hundreds of particles.
 *   - Everything moves slowly and continuously; no sudden jumps, no flashing.
 *   - Gentle, eased mouse parallax — reacts, never distracts.
 *   - Respects prefers-reduced-motion (renders one static frame, no loop).
 *   - pointer-events: none, fixed, -z-10 -> never intercepts clicks/layout.
 *   - Auto-resizes with the window.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const BG_TOP = "#08130F"; // deep forest green
const BG_BOTTOM = "#0F172A"; // navy

const RGB = {
  gold: "232, 197, 128", // warm golden dust / pellets
  green: "111, 207, 151", // soft renewable-green
  white: "255, 255, 255",
  deepGreen: "20, 83, 60", // for leaf silhouettes
  emberGold: "201, 151, 76", // pellet body
};

const DUST_COLOR_WEIGHTS: Array<[keyof typeof RGB, number]> = [
  ["gold", 0.4],
  ["green", 0.35],
  ["white", 0.25],
];

// ---------------------------------------------------------------------------
// Deterministic PRNG so the field feels organic but stable within a session
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T extends string>(
  rand: () => number,
  weights: Array<[T, number]>
): T {
  const r = rand();
  let acc = 0;
  for (const [key, weight] of weights) {
    acc += weight;
    if (r <= acc) return key;
  }
  return weights[0][0];
}

// ---------------------------------------------------------------------------
// Particle types
// ---------------------------------------------------------------------------
type Dust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // 2-5px
  baseOpacity: number;
  opacity: number;
  phase: number;
  twinkleSpeed: number;
  color: keyof typeof RGB;
  depth: number; // parallax weight
  edge: boolean; // belongs to the edge-dust ring
};

type Pellet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  width: number;
  rotation: number;
  rotSpeed: number;
  life: number; // 0..1, drives fade in/out
  lifeDir: 1 | -1;
  lifeSpeed: number;
  depth: number;
};

type Leaf = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  opacity: number;
  depth: number;
  flip: 1 | -1;
};

type EnergyLine = {
  points: Array<{ x: number; y: number }>;
  pulses: Array<{ t: number; speed: number }>;
  opacity: number;
};

type LightRay = {
  offset: number; // position along the diagonal sweep, 0..1 loops
  speed: number;
  width: number;
  opacity: number;
};

const PARALLAX_STRENGTH = 12; // px max shift
const PARALLAX_EASE = 0.05;

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx2d = canvasEl.getContext("2d", { alpha: true });
    if (!ctx2d) return;
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;

    let rand = mulberry32(20260723);

    let dust: Dust[] = [];
    let pellets: Pellet[] = [];
    let leaves: Leaf[] = [];
    let energyLines: EnergyLine[] = [];
    let lightRays: LightRay[] = [];

    let mouseTargetX = 0;
    let mouseTargetY = 0;
    let mouseX = 0;
    let mouseY = 0;

    // --- field builders ------------------------------------------------

    function dustCount() {
      const area = width * height;
      const base = Math.round(area / 6500); // hundreds, scales with viewport
      return Math.max(160, Math.min(260, base));
    }

    function createDust() {
      const count = dustCount();
      const edgeCount = Math.round(count * 0.18);
      const next: Dust[] = [];
      for (let i = 0; i < count; i++) {
        const edge = i < edgeCount;
        const depth = rand();
        const speedScale = 0.12 + depth * 0.35; // very slow overall
        const angle = rand() * Math.PI * 2;
        const speed = (0.025 + rand() * 0.05) * speedScale;

        let x: number;
        let y: number;
        if (edge) {
          // Bias toward a band near the viewport edges.
          const band = 0.09; // fraction of width/height reserved as the edge band
          const side = Math.floor(rand() * 4);
          if (side === 0) {
            x = rand() * width;
            y = rand() * height * band;
          } else if (side === 1) {
            x = rand() * width;
            y = height - rand() * height * band;
          } else if (side === 2) {
            x = rand() * width * band;
            y = rand() * height;
          } else {
            x = width - rand() * width * band;
            y = rand() * height;
          }
        } else {
          x = rand() * width;
          y = rand() * height;
        }

        next.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 2 + rand() * 3, // 2-5px
          baseOpacity: edge ? 0.18 + rand() * 0.22 : 0.08 + rand() * 0.2,
          opacity: 0.1,
          phase: rand() * Math.PI * 2,
          twinkleSpeed: 0.0012 + rand() * 0.002,
          color: pickWeighted(rand, DUST_COLOR_WEIGHTS),
          depth,
          edge,
        });
      }
      dust = next;
    }

    function createPellets() {
      // Only a handful visible/alive at once.
      const count = Math.max(6, Math.min(10, Math.round((width * height) / 220000)));
      const next: Pellet[] = [];
      for (let i = 0; i < count; i++) {
        const depth = rand();
        next.push({
          x: rand() * width,
          y: rand() * height,
          vx: (rand() - 0.5) * 0.05 * (0.3 + depth),
          vy: (rand() - 0.5) * 0.05 * (0.3 + depth) - 0.01, // faint upward drift
          length: 10 + rand() * 8,
          width: 5 + rand() * 3.5,
          rotation: rand() * Math.PI * 2,
          rotSpeed: (rand() - 0.5) * 0.0025,
          life: rand(), // stagger initial fade phase
          lifeDir: rand() > 0.5 ? 1 : -1,
          lifeSpeed: 0.0009 + rand() * 0.0011,
          depth,
        });
      }
      pellets = next;
    }

    function createLeaves() {
      const count = Math.max(4, Math.min(7, Math.round(width / 320)));
      const next: Leaf[] = [];
      for (let i = 0; i < count; i++) {
        const depth = rand() * 0.4; // leaves stay far / slow
        next.push({
          x: rand() * width,
          y: rand() * height,
          vx: (rand() - 0.5) * 0.012,
          vy: 0.006 + rand() * 0.01,
          size: 70 + rand() * 90,
          rotation: rand() * Math.PI * 2,
          rotSpeed: (rand() - 0.5) * 0.0006,
          opacity: 0.02 + rand() * 0.025,
          depth,
          flip: rand() > 0.5 ? 1 : -1,
        });
      }
      leaves = next;
    }

    function createEnergyLines() {
      const count = Math.max(4, Math.min(7, Math.round(width / 300)));
      const next: EnergyLine[] = [];
      for (let i = 0; i < count; i++) {
        const y0 = rand() * height;
        const amplitude = 40 + rand() * 90;
        const segs = 5;
        const points: Array<{ x: number; y: number }> = [];
        for (let s = 0; s <= segs; s++) {
          const x = (width / segs) * s;
          const y =
            y0 +
            Math.sin(s * 1.3 + i * 1.7) * amplitude +
            (rand() - 0.5) * 30;
          points.push({ x, y });
        }
        next.push({
          points,
          pulses: [
            { t: rand(), speed: 0.00035 + rand() * 0.0004 },
            { t: rand(), speed: 0.00035 + rand() * 0.0004 },
          ],
          opacity: 0.05 + rand() * 0.05,
        });
      }
      energyLines = next;
    }

    function createLightRays() {
      const count = 3;
      const next: LightRay[] = [];
      for (let i = 0; i < count; i++) {
        next.push({
          offset: rand(),
          speed: 0.00006 + rand() * 0.00004,
          width: width * (0.18 + rand() * 0.12),
          opacity: 0.035 + rand() * 0.02,
        });
      }
      lightRays = next;
    }

    function buildField() {
      rand = mulberry32(20260723);
      createDust();
      createPellets();
      createLeaves();
      createEnergyLines();
      createLightRays();
    }

    // --- resize ----------------------------------------------------------

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildField();
    }

    function onPointerMove(e: PointerEvent) {
      const nx = (e.clientX / width) * 2 - 1;
      const ny = (e.clientY / height) * 2 - 1;
      mouseTargetX = nx * PARALLAX_STRENGTH;
      mouseTargetY = ny * PARALLAX_STRENGTH;
    }

    function onPointerLeave() {
      mouseTargetX = 0;
      mouseTargetY = 0;
    }

    // --- painters ----------------------------------------------------------

    function paintBackdrop() {
      const grad = ctx.createLinearGradient(0, 0, width * 0.3, height);
      grad.addColorStop(0, BG_TOP);
      grad.addColorStop(1, BG_BOTTOM);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Fixed ultra-soft ambient glows for depth (green / gold / navy accents).
      const glows: Array<[number, number, number, string]> = [
        [width * 0.16, height * 0.2, Math.max(width, height) * 0.42, `rgba(${RGB.green}, 0.05)`],
        [width * 0.85, height * 0.78, Math.max(width, height) * 0.48, `rgba(${RGB.gold}, 0.04)`],
        [width * 0.72, height * 0.12, Math.max(width, height) * 0.36, "rgba(30, 58, 95, 0.10)"],
      ];
      for (const [gx, gy, gr, color] of glows) {
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        g.addColorStop(0, color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }
    }

    // Simple leaf silhouette drawn from two symmetric bezier lobes + a vein.
    function paintLeaf(l: Leaf) {
      const px = l.x + mouseX * 0.15;
      const py = l.y + mouseY * 0.15;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(l.rotation);
      ctx.scale(l.flip, 1);
      const s = l.size;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.bezierCurveTo(s * 0.42, -s * 0.32, s * 0.42, s * 0.28, 0, s * 0.5);
      ctx.bezierCurveTo(-s * 0.42, s * 0.28, -s * 0.42, -s * 0.32, 0, -s * 0.5);
      ctx.closePath();
      ctx.fillStyle = `rgba(${RGB.deepGreen}, ${l.opacity})`;
      ctx.fill();
      // faint center vein
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.48);
      ctx.lineTo(0, s * 0.48);
      ctx.strokeStyle = `rgba(${RGB.deepGreen}, ${l.opacity * 0.8})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    function paintLightRays(t: number) {
      ctx.save();
      const diag = Math.max(width, height) * 1.6;
      for (const ray of lightRays) {
        ray.offset = (ray.offset + ray.speed) % 1;
        const pos = ray.offset * (diag + ray.width) - ray.width;
        ctx.save();
        ctx.translate(width * 0.5, height * 0.5);
        ctx.rotate(-Math.PI / 7); // gentle diagonal sweep
        const g = ctx.createLinearGradient(pos, -diag, pos + ray.width, diag);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(${RGB.gold}, ${ray.opacity})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(pos - diag, -diag, ray.width, diag * 2);
        ctx.restore();
      }
      ctx.restore();
    }

    function paintEnergyLines() {
      for (const line of energyLines) {
        const pts = line.points;
        ctx.beginPath();
        ctx.moveTo(pts[0].x + mouseX * 0.1, pts[0].y + mouseY * 0.1);
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const mx = (p0.x + p1.x) / 2 + mouseX * 0.1;
          const my = (p0.y + p1.y) / 2 + mouseY * 0.1;
          ctx.quadraticCurveTo(p0.x + mouseX * 0.1, p0.y + mouseY * 0.1, mx, my);
        }
        ctx.strokeStyle = `rgba(${RGB.green}, ${line.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // traveling glow pulses along the path
        for (const pulse of line.pulses) {
          pulse.t = (pulse.t + pulse.speed) % 1;
          const pos = samplePolyline(pts, pulse.t);
          const glow = ctx.createRadialGradient(
            pos.x + mouseX * 0.1,
            pos.y + mouseY * 0.1,
            0,
            pos.x + mouseX * 0.1,
            pos.y + mouseY * 0.1,
            10
          );
          glow.addColorStop(0, `rgba(${RGB.gold}, 0.35)`);
          glow.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pos.x + mouseX * 0.1, pos.y + mouseY * 0.1, 10, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function samplePolyline(pts: Array<{ x: number; y: number }>, t: number) {
      const segCount = pts.length - 1;
      const scaled = t * segCount;
      const idx = Math.min(Math.floor(scaled), segCount - 1);
      const localT = scaled - idx;
      const a = pts[idx];
      const b = pts[idx + 1];
      return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
    }

    function paintPellet(p: Pellet) {
      const opacity = Math.sin(p.life * Math.PI) * 0.5; // smooth fade in/out, peak 0.5
      if (opacity <= 0.01) return;
      const px = p.x + mouseX * (0.2 + p.depth * 0.4);
      const py = p.y + mouseY * (0.2 + p.depth * 0.4);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rotation);
      const rW = p.width / 2;
      const rL = p.length / 2;

      // Capsule body (rounded cylinder silhouette)
      ctx.beginPath();
      ctx.moveTo(-rL + rW, -rW);
      ctx.lineTo(rL - rW, -rW);
      ctx.arc(rL - rW, 0, rW, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-rL + rW, rW);
      ctx.arc(-rL + rW, 0, rW, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();

      const bodyGrad = ctx.createLinearGradient(0, -rW, 0, rW);
      bodyGrad.addColorStop(0, `rgba(${RGB.emberGold}, ${opacity})`);
      bodyGrad.addColorStop(1, `rgba(${RGB.emberGold}, ${opacity * 0.55})`);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // soft outer glow so it reads as an energetic biomass pellet, not a plain shape
      ctx.shadowColor = `rgba(${RGB.gold}, ${opacity * 0.6})`;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore();
    }

    function paintDust(d: Dust) {
      const px = d.x + mouseX * (0.25 + d.depth * 0.6);
      const py = d.y + mouseY * (0.25 + d.depth * 0.6);
      const rgb = RGB[d.color];

      const glowR = d.r * 3.6;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, glowR);
      glow.addColorStop(0, `rgba(${rgb}, ${d.opacity * 0.5})`);
      glow.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, glowR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = `rgba(${rgb}, ${d.opacity})`;
      ctx.arc(px, py, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawStatic() {
      ctx.clearRect(0, 0, width, height);
      paintBackdrop();
      for (const l of leaves) paintLeaf(l);
      paintEnergyLines();
      for (const d of dust) paintDust(d);
      for (const p of pellets) paintPellet(p);
    }

    // --- animation loop ------------------------------------------------

    let rafId = 0;
    let t = 0;

    function tick() {
      t++;
      mouseX += (mouseTargetX - mouseX) * PARALLAX_EASE;
      mouseY += (mouseTargetY - mouseY) * PARALLAX_EASE;

      ctx.clearRect(0, 0, width, height);
      paintBackdrop();
      paintLightRays(t);

      // Leaves — far background, extremely slow drift + rotation.
      for (const l of leaves) {
        l.x += l.vx;
        l.y += l.vy;
        l.rotation += l.rotSpeed;
        const m = 140;
        if (l.x < -m) l.x = width + m;
        if (l.x > width + m) l.x = -m;
        if (l.y < -m) l.y = height + m;
        if (l.y > height + m) l.y = -m;
        paintLeaf(l);
      }

      paintEnergyLines();

      // Dust — hundreds of tiny glowing motes.
      for (const d of dust) {
        d.x += d.vx;
        d.y += d.vy;
        const margin = 16;
        if (d.x < -margin) d.x = width + margin;
        if (d.x > width + margin) d.x = -margin;
        if (d.y < -margin) d.y = height + margin;
        if (d.y > height + margin) d.y = -margin;

        d.phase += d.twinkleSpeed;
        const twinkle = 0.85 + Math.sin(d.phase) * 0.15;
        d.opacity = d.baseOpacity * twinkle;
        paintDust(d);
      }

      // Pellets — a few, rotating slowly, fading in and out naturally.
      for (const p of pellets) {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.life += p.lifeSpeed * p.lifeDir;
        if (p.life > 1) {
          p.life = 1;
          p.lifeDir = -1;
        } else if (p.life < 0) {
          p.life = 0;
          p.lifeDir = 1;
          // respawn at a new spot once fully faded out
          p.x = rand() * width;
          p.y = rand() * height;
        }
        const margin = 30;
        if (p.x < -margin) p.x = width + margin;
        if (p.x > width + margin) p.x = -margin;
        if (p.y < -margin) p.y = height + margin;
        if (p.y > height + margin) p.y = -margin;
        paintPellet(p);
      }

      rafId = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    if (prefersReducedMotion) {
      drawStatic();
    } else {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#08130F]"
      style={{ willChange: "transform" }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ transform: "translate3d(0,0,0)" }}
      />
      {/* Calm vignette so edges stay quiet and attention rests on foreground content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(8,19,15,0.55)_100%)]" />
    </div>
  );
}
