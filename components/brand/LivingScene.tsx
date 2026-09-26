"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * BIOME living scene — the animated environment behind the splash and the
 * login screen, and nothing else in the product.
 *
 * Why one component for two screens: the two are meant to read as the same
 * place, seen a moment apart. Sharing the environment guarantees that far
 * better than trying to keep two copies in step by hand.
 *
 * Everything moves through CSS keyframes rather than a JavaScript loop.
 * That keeps the work on the compositor, and it means the whole scene stops
 * dead for anyone whose operating system asks for reduced motion, without a
 * single conditional in here.
 *
 * The one JS listener is the parallax: a single rAF-throttled pointer handler
 * that writes two CSS variables. Each layer reads them at its own depth, so
 * depth costs nothing extra per layer.
 */

/* Deterministic pseudo-random. Math.random() would produce different values
   on the server and the client and React would discard the markup as a
   hydration mismatch — so the "randomness" is seeded and identical on both,
   while still looking unpatterned. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface LivingSceneProps {
  /** "night" for the login screen's darker plant, "dusk" for the splash. */
  tone?: "dusk" | "night";
  /** Pointer parallax. Off on low-powered machines is better than janky. */
  parallax?: boolean;
  className?: string;
}

export default function LivingScene({
  tone = "dusk",
  parallax = true,
  className = "",
}: LivingSceneProps) {
  const root = useRef<HTMLDivElement>(null);

  /* ---- Pointer parallax: one listener, one rAF, two CSS variables ---- */
  useEffect(() => {
    if (!parallax) return;
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Touch devices have no hover; the listener would only cost battery.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let frame = 0;
    let nx = 0;
    let ny = 0;

    const onMove = (e: PointerEvent) => {
      // -1..1 from the centre of the viewport.
      nx = (e.clientX / window.innerWidth) * 2 - 1;
      ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty("--mx", nx.toFixed(3));
        el.style.setProperty("--my", ny.toFixed(3));
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [parallax]);

  /* ---- Scene contents, generated once ---- */
  const clouds = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 6 }, () => ({
      top: 4 + r() * 26,
      w: 190 + r() * 300,
      h: 26 + r() * 34,
      dur: 130 + r() * 150,
      delay: -r() * 220,
      op: 0.06 + r() * 0.12,
      blur: 14 + r() * 22,
    }));
  }, []);

  const blades = useMemo(() => {
    const r = rng(23);
    // Two bands: the far band is shorter and paler, so the field has depth.
    return Array.from({ length: 96 }, (_, i) => {
      const far = i % 3 === 0;
      const x = (i / 96) * 1460 - 10 + r() * 14;
      const h = far ? 26 + r() * 26 : 44 + r() * 62;
      return {
        x,
        h,
        far,
        lean: (r() - 0.5) * 16,
        sway: (far ? 1.6 : 3.2) + r() * 2.4,
        dur: 3.6 + r() * 3.4,
        delay: -r() * 6,
        w: far ? 2 : 2.6 + r() * 1.6,
      };
    });
  }, []);

  const leaves = useMemo(() => {
    const r = rng(37);
    return Array.from({ length: 18 }, () => {
      const depth = r(); // 0 = far, 1 = near camera
      return {
        left: r() * 104 - 2,
        size: 7 + depth * 13,
        dur: 15 + (1 - depth) * 16 + r() * 6,
        delay: -r() * 30,
        drift: (r() - 0.5) * 240,
        rot: (r() < 0.5 ? -1 : 1) * (180 + r() * 420),
        op: 0.24 + depth * 0.5,
        tumble: 2.4 + r() * 3.6,
        hue: r() < 0.35 ? "rgba(190,225,150,.9)" : "rgba(122,200,150,.85)",
        blur: depth > 0.82 ? 1.2 : 0,
      };
    });
  }, []);

  const motes = useMemo(() => {
    const r = rng(53);
    return Array.from({ length: 30 }, () => ({
      left: r() * 100,
      top: 34 + r() * 62,
      size: 1 + r() * 2.6,
      dur: 9 + r() * 12,
      delay: -r() * 20,
      dx: (r() - 0.5) * 90,
      dy: -(60 + r() * 130),
      op: 0.25 + r() * 0.5,
    }));
  }, []);

  const night = tone === "night";

  return (
    <div
      ref={root}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {/* ================= SKY ================= */}
      <div
        className="absolute inset-0"
        style={{
          background: night
            ? "linear-gradient(180deg,#04121a 0%,#062430 42%,#07303a 74%,#052029 100%)"
            : "linear-gradient(180deg,#07263a 0%,#0b4356 38%,#1d6f6a 68%,#0d3a3c 100%)",
        }}
      />

      {/* Warm source low on the horizon — sunset for dusk, plant glow at night */}
      <div
        className="bmx-daylight absolute"
        style={{
          left: night ? "62%" : "-6%",
          bottom: night ? "18%" : "22%",
          width: "62vw",
          height: "62vh",
          background: night
            ? "radial-gradient(circle,rgba(103,232,249,.20),transparent 62%)"
            : "radial-gradient(circle,rgba(255,196,120,.42),rgba(255,150,90,.16) 38%,transparent 66%)",
          filter: "blur(6px)",
        }}
      />

      {/* Light rays. Slow, low contrast — atmosphere, not a lens flare. */}
      <div className="bmx-par absolute inset-0" style={{ ["--depth" as string]: -2 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bmx-ray absolute origin-top"
            style={{
              left: `${(night ? 58 : 2) + i * 9}%`,
              top: "-14%",
              width: `${60 + i * 26}px`,
              height: "88%",
              ["--ray-tilt" as string]: `${(night ? -1 : 1) * (7 + i * 3)}deg`,
              animationDelay: `${-i * 2.7}s`,
              background: night
                ? "linear-gradient(180deg,rgba(165,243,252,.16),transparent 72%)"
                : "linear-gradient(180deg,rgba(255,214,150,.22),transparent 70%)",
              filter: "blur(11px)",
            }}
          />
        ))}
      </div>

      {/* Clouds — the slowest thing on screen (spec: no time-lapse) */}
      <div className="bmx-par absolute inset-x-0 top-0 h-[46%]" style={{ ["--depth" as string]: -4 }}>
        {clouds.map((c, i) => (
          <div
            key={i}
            className="bmx-cloud absolute rounded-full"
            style={{
              top: `${c.top}%`,
              width: c.w,
              height: c.h,
              opacity: c.op,
              filter: `blur(${c.blur}px)`,
              background: night
                ? "linear-gradient(90deg,transparent,rgba(190,225,240,.85),transparent)"
                : "linear-gradient(90deg,transparent,rgba(255,236,214,.95),transparent)",
              animationDuration: `${c.dur}s`,
              animationDelay: `${c.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Atmospheric haze */}
      <div
        className="bmx-haze absolute"
        style={{
          left: "-8%",
          top: "18%",
          width: "70vw",
          height: "56vh",
          background: "radial-gradient(circle,rgba(148,220,235,.16),transparent 64%)",
        }}
      />
      <div
        className="bmx-haze absolute"
        style={{
          right: "-12%",
          top: "6%",
          width: "58vw",
          height: "58vh",
          background: "radial-gradient(circle,rgba(52,211,153,.13),transparent 64%)",
          animationDelay: "-8s",
        }}
      />

      {/* ================= FACTORY (mid ground) ================= */}
      <div
        className="bmx-par absolute inset-x-0"
        style={{ bottom: "26%", ["--depth" as string]: 3 }}
      >
        <svg
          viewBox="0 0 1440 260"
          preserveAspectRatio="xMidYMax slice"
          className="h-[30vh] w-full"
          fill="none"
        >
          <FactoryBlock night={night} />
        </svg>
      </div>

      {/* ================= FIELD + WORKERS ================= */}
      <div
        className="bmx-par absolute inset-x-0 bottom-0"
        style={{ ["--depth" as string]: 7 }}
      >
        <svg
          viewBox="0 0 1440 300"
          preserveAspectRatio="xMidYMax slice"
          className="h-[38vh] w-full"
          fill="none"
        >
          {/* Ground */}
          <path
            d="M0 150c210-26 380 14 560 6s330-40 520-30 250 34 360 22v152H0z"
            fill={night ? "rgba(4,20,26,.92)" : "rgba(10,44,42,.86)"}
          />

          {/* Far crop band, gusting as one mass */}
          <g className="bmx-gust" opacity={night ? 0.5 : 0.72}>
            {blades
              .filter((b) => b.far)
              .map((b, i) => (
                <path
                  key={`f${i}`}
                  className="bmx-blade"
                  d={`M${b.x} 190 q ${b.lean} ${-b.h * 0.6} ${b.lean * 1.7} ${-b.h}`}
                  stroke={night ? "rgba(90,150,140,.55)" : "rgba(150,205,140,.6)"}
                  strokeWidth={b.w}
                  strokeLinecap="round"
                  style={{
                    ["--sway-a" as string]: `${b.sway}deg`,
                    animationDuration: `${b.dur}s`,
                    animationDelay: `${b.delay}s`,
                  }}
                />
              ))}
          </g>

          {/* Workers sit between the two crop bands, so the field hides their feet */}
          <WorkerWalking x={196} y={214} scale={1} night={night} seed={1} />
          <WorkerPicking x={470} y={220} scale={1.06} night={night} seed={2} />
          <WorkerCarrying x={760} y={216} scale={0.98} night={night} seed={3} />
          <WorkerPicking x={1010} y={224} scale={1.12} night={night} seed={4} />
          <WorkerWalking x={1215} y={210} scale={0.9} night={night} seed={5} />

          {/* Near crop band — taller, denser, and it hides the workers' feet */}
          <g opacity={night ? 0.72 : 0.95}>
            {blades
              .filter((b) => !b.far)
              .map((b, i) => (
                <path
                  key={`n${i}`}
                  className="bmx-blade"
                  d={`M${b.x} 300 q ${b.lean} ${-b.h * 0.55} ${b.lean * 1.6} ${-b.h}`}
                  stroke={night ? "rgba(74,138,124,.75)" : "rgba(126,196,124,.8)"}
                  strokeWidth={b.w}
                  strokeLinecap="round"
                  style={{
                    ["--sway-a" as string]: `${b.sway}deg`,
                    animationDuration: `${b.dur}s`,
                    animationDelay: `${b.delay}s`,
                  }}
                />
              ))}
          </g>
        </svg>
      </div>

      {/* ================= AIR: motes, then leaves nearest the camera ========= */}
      <div className="bmx-par absolute inset-0" style={{ ["--depth" as string]: 5 }}>
        {motes.map((m, i) => (
          <span
            key={i}
            className="bmx-particle"
            style={{
              left: `${m.left}%`,
              top: `${m.top}%`,
              width: m.size,
              height: m.size,
              background: "rgba(190,245,220,.9)",
              boxShadow: "0 0 6px rgba(134,239,172,.7)",
              animationDuration: `${m.dur}s`,
              animationDelay: `${m.delay}s`,
              ["--p-x" as string]: `${m.dx}px`,
              ["--p-y" as string]: `${m.dy}px`,
              ["--p-o" as string]: m.op,
            }}
          />
        ))}
      </div>

      <div className="bmx-par absolute inset-0" style={{ ["--depth" as string]: 9 }}>
        {leaves.map((l, i) => (
          <span
            key={i}
            className="bmx-leaf"
            style={{
              left: `${l.left}%`,
              top: 0,
              animationDuration: `${l.dur}s`,
              animationDelay: `${l.delay}s`,
              ["--leaf-x" as string]: `${l.drift}px`,
              ["--leaf-r" as string]: `${l.rot}deg`,
              ["--leaf-o" as string]: l.op,
              ["--leaf-s" as string]: 1,
              filter: l.blur ? `blur(${l.blur}px)` : undefined,
            }}
          >
            <svg
              className="bmx-leaf-inner block"
              width={l.size}
              height={l.size}
              viewBox="0 0 24 24"
              style={{ animationDuration: `${l.tumble}s`, animationDelay: `${-i * 0.7}s` }}
            >
              <path
                d="M12 2C7.5 6 4.5 10 4.5 14.6A7.5 7.5 0 0 0 19.5 15C19.5 10.2 16.5 6 12 2z"
                fill={l.hue}
              />
              <path d="M12 4v15" stroke="rgba(20,60,40,.35)" strokeWidth="1" />
            </svg>
          </span>
        ))}
      </div>

      {/* Grade the bottom so UI text always has something quiet to sit on */}
      <div
        className="absolute inset-x-0 bottom-0 h-[42%]"
        style={{
          background: night
            ? "linear-gradient(180deg,transparent,rgba(4,17,23,.62) 55%,rgba(4,17,23,.9))"
            : "linear-gradient(180deg,transparent,rgba(5,26,30,.55) 55%,rgba(5,26,30,.86))",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 40%,transparent 40%,rgba(3,14,20,.55))" }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Factory: silos, a working conveyor, a stack, lamps, a passing truck  */
/* ------------------------------------------------------------------ */
function FactoryBlock({ night }: { night: boolean }) {
  const body = night ? "rgba(9,34,44,.95)" : "rgba(12,44,50,.88)";
  const edge = night ? "rgba(150,220,235,.22)" : "rgba(180,235,225,.24)";
  const lamp = night ? "rgba(255,214,150,.95)" : "rgba(255,228,170,.85)";

  return (
    <g>
      {/* Tree line, so the plant sits in a landscape rather than on a plane */}
      <path
        d="M0 190c40-16 70 6 96-10s52 8 84-6 60 10 92-4 66 12 100-2 70 14 104 0 66 10 96-4 62 12 96-2 70 12 104-2 66 10 98-4 62 12 94-2 68 10 100-4 66 12 96-2 68 10 100-4 68 12 90 6v70H0z"
        fill={night ? "rgba(5,24,30,.9)" : "rgba(8,38,38,.8)"}
      />

      {/* Stack with smoke */}
      <rect x="352" y="34" width="26" height="150" fill={body} stroke={edge} />
      <rect x="348" y="30" width="34" height="9" fill={body} stroke={edge} />
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          className="bmx-smoke"
          cx="365"
          cy="26"
          r={7 + i * 2}
          fill="rgba(215,240,248,.5)"
          style={{ animationDuration: `${7 + i * 1.4}s`, animationDelay: `${-i * 2.1}s` }}
        />
      ))}

      {/* Silos */}
      {[
        { x: 430, w: 62, h: 118 },
        { x: 500, w: 74, h: 138 },
        { x: 582, w: 58, h: 104 },
      ].map((s, i) => (
        <g key={i}>
          <rect x={s.x} y={184 - s.h} width={s.w} height={s.h} rx="4" fill={body} stroke={edge} />
          <path
            d={`M${s.x} ${184 - s.h}q${s.w / 2} -22 ${s.w} 0`}
            fill={body}
            stroke={edge}
          />
          <path
            d={`M${s.x + 8} ${184 - s.h * 0.62}h${s.w - 16}M${s.x + 8} ${184 - s.h * 0.34}h${s.w - 16}`}
            stroke={edge}
            opacity=".55"
          />
          <circle
            className="bmx-lamp"
            cx={s.x + s.w / 2}
            cy={184 - s.h - 8}
            r="2.6"
            fill={lamp}
            style={{ animationDuration: `${4.5 + i * 1.7}s`, animationDelay: `${-i * 1.3}s` }}
          />
        </g>
      ))}

      {/* Inclined conveyor feeding the tallest silo */}
      <g>
        <path d="M646 184L780 96" stroke={edge} strokeWidth="12" strokeLinecap="round" opacity=".5" />
        <path d="M646 184L780 96" stroke={body} strokeWidth="9" strokeLinecap="round" />
        <foreignObject x="640" y="88" width="150" height="104">
          <div
            className="bmx-belt h-full w-full"
            style={{ transform: "rotate(-33deg)", transformOrigin: "6px 96px", opacity: 0.5 }}
          />
        </foreignObject>
        <circle className="bmx-wheel" cx="646" cy="184" r="9" fill="none" stroke={edge} strokeWidth="2"
          style={{ animationDuration: "3.4s" }} />
        <circle className="bmx-wheel" cx="780" cy="96" r="7" fill="none" stroke={edge} strokeWidth="2"
          style={{ animationDuration: "2.6s" }} />
      </g>

      {/* Main shed */}
      <g>
        <rect x="800" y="112" width="270" height="72" fill={body} stroke={edge} />
        <path d="M800 112l52-26h218l-48 26z" fill={body} stroke={edge} />
        {Array.from({ length: 7 }, (_, i) => (
          <rect
            key={i}
            className="bmx-lamp"
            x={820 + i * 36}
            y="132"
            width="20"
            height="14"
            rx="2"
            fill={lamp}
            opacity=".7"
            style={{ animationDuration: `${5 + (i % 4) * 1.6}s`, animationDelay: `${-i * 0.9}s` }}
          />
        ))}
        {/* A vent that works */}
        <g className="bmx-piston">
          <rect x="1084" y="128" width="18" height="56" fill={body} stroke={edge} />
        </g>
      </g>

      {/* Cooling tower */}
      <path d="M1140 184V118q0-26 22-34 22 8 22 34v66z" fill={body} stroke={edge} />
      {[0, 1].map((i) => (
        <circle
          key={i}
          className="bmx-smoke"
          cx="1162"
          cy="80"
          r={9 + i * 3}
          fill="rgba(200,235,245,.4)"
          style={{ animationDuration: `${9 + i * 2}s`, animationDelay: `${-i * 4}s` }}
        />
      ))}

      {/* Plant road: a truck goes by now and then, not constantly */}
      <path d="M0 196h1440" stroke={edge} strokeWidth="1" opacity=".3" />
      <g
        className="bmx-vehicle"
        style={{ animationDuration: "26s", ["--veh-dist" as string]: "560px" }}
      >
        <rect x="180" y="176" width="34" height="14" rx="2" fill={body} stroke={edge} />
        <rect x="214" y="180" width="16" height="10" rx="2" fill={body} stroke={edge} />
        <circle cx="190" cy="192" r="3" fill={edge} />
        <circle cx="222" cy="192" r="3" fill={edge} />
        <circle className="bmx-lamp" cx="232" cy="184" r="2.2" fill={lamp} style={{ animationDuration: "3s" }} />
      </g>

      {/* Two figures on the plant apron — small, distant, still alive */}
      <g opacity=".72">
        <MiniFigure x={880} y={196} night={night} dur={2.6} />
        <MiniFigure x={918} y={196} night={night} dur={3.4} />
      </g>
    </g>
  );
}

function MiniFigure({ x, y, night, dur }: { x: number; y: number; night: boolean; dur: number }) {
  const fill = night ? "rgba(8,28,34,.95)" : "rgba(7,32,32,.9)";
  return (
    <g className="bmx-worker" style={{ animationDuration: `${dur}s` }} transform={`translate(${x} ${y})`}>
      <circle cx="0" cy="-13" r="2.4" fill={fill} />
      <rect x="-1.8" y="-11" width="3.6" height="7" rx="1.4" fill={fill} />
      <rect className="bmx-leg-a" x="-1.8" y="-4" width="1.6" height="5" fill={fill}
        style={{ animationDuration: `${dur * 0.7}s` }} />
      <rect className="bmx-leg-b" x="0.2" y="-4" width="1.6" height="5" fill={fill}
        style={{ animationDuration: `${dur * 0.7}s` }} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Workers. Three behaviours, each with its own timing, so no two ever  */
/* fall into step (spec §2: avoid synchronised movement).               */
/* ------------------------------------------------------------------ */
interface WorkerProps { x: number; y: number; scale: number; night: boolean; seed: number; }

function workerPalette(night: boolean) {
  return {
    body: night ? "rgba(6,24,30,.96)" : "rgba(8,34,34,.92)",
    rim: night ? "rgba(140,210,220,.28)" : "rgba(255,214,160,.35)",
    crop: night ? "rgba(90,150,120,.8)" : "rgba(196,168,92,.9)",
  };
}

/** Walks a stretch of field, then reappears from where they started. */
function WalkCycle({ dur, p }: { dur: number; p: ReturnType<typeof workerPalette> }) {
  return (
    <>
      <g className="bmx-head" style={{ animationDuration: `${dur * 2.4}s` }}>
        <circle cx="0" cy="-46" r="6.4" fill={p.body} />
        {/* Sun hat */}
        <path d="M-11 -50h22q-3 -6 -11 -6t-11 6z" fill={p.body} />
        <path d="M-12.5 -49.5h25" stroke={p.rim} strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <rect x="-5.5" y="-41" width="11" height="21" rx="4" fill={p.body} />
      <path d="M-5.5 -38h11" stroke={p.rim} strokeWidth="1" opacity=".7" />
      <g className="bmx-arm-a" style={{ animationDuration: `${dur}s` }}>
        <rect x="-8.5" y="-39" width="3.4" height="17" rx="1.7" fill={p.body} />
      </g>
      <g className="bmx-arm-b" style={{ animationDuration: `${dur}s` }}>
        <rect x="5.1" y="-39" width="3.4" height="17" rx="1.7" fill={p.body} />
      </g>
      <g className="bmx-leg-a" style={{ animationDuration: `${dur}s` }}>
        <rect x="-4.6" y="-21" width="4" height="21" rx="1.8" fill={p.body} />
      </g>
      <g className="bmx-leg-b" style={{ animationDuration: `${dur}s` }}>
        <rect x="0.6" y="-21" width="4" height="21" rx="1.8" fill={p.body} />
      </g>
    </>
  );
}

function WorkerWalking({ x, y, scale, night, seed }: WorkerProps) {
  const p = workerPalette(night);
  const r = rng(seed * 97);
  const step = 0.92 + r() * 0.5;
  const trip = 30 + r() * 26;
  const dist = 150 + r() * 190;
  const flip = seed % 2 === 0;

  return (
    <g
      className="bmx-traverse"
      style={{ animationDuration: `${trip}s`, animationDelay: `${-r() * trip}s`, ["--walk-dist" as string]: `${flip ? -dist : dist}px` }}
    >
      <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
        <g className="bmx-worker" style={{ animationDuration: `${step}s` }}>
          <WalkCycle dur={step} p={p} />
        </g>
      </g>
    </g>
  );
}

/** Bends into the crop, gathers, straightens. The slowest of the three. */
function WorkerPicking({ x, y, scale, night, seed }: WorkerProps) {
  const p = workerPalette(night);
  const r = rng(seed * 131);
  const cycle = 4.4 + r() * 2.6;
  const flip = seed % 2 === 1;

  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      {/* Legs stay planted — only the torso works */}
      <rect x="-5" y="-20" width="4.2" height="20" rx="1.8" fill={p.body} />
      <rect x="1" y="-20" width="4.2" height="20" rx="1.8" fill={p.body} />

      <g className="bmx-torso-bend" style={{ animationDuration: `${cycle}s`, animationDelay: `${-r() * cycle}s` }}>
        <rect x="-5.5" y="-40" width="11" height="21" rx="4" fill={p.body} />
        <path d="M-5.5 -37h11" stroke={p.rim} strokeWidth="1" opacity=".65" />
        <g className="bmx-head" style={{ animationDuration: `${cycle * 1.6}s` }}>
          <circle cx="0" cy="-45" r="6.2" fill={p.body} />
          <path d="M-11 -49h22q-3 -6 -11 -6t-11 6z" fill={p.body} />
          <path d="M-12.5 -48.5h25" stroke={p.rim} strokeWidth="1.2" strokeLinecap="round" />
        </g>
        {/* The reaching arm, and a cut bundle growing in the other hand */}
        <g className="bmx-arm-reach" style={{ animationDuration: `${cycle}s`, animationDelay: `${-r() * cycle}s` }}>
          <rect x="-8.6" y="-38" width="3.4" height="18" rx="1.7" fill={p.body} />
        </g>
        <rect x="5.2" y="-38" width="3.4" height="16" rx="1.7" fill={p.body} />
        <g opacity=".9">
          <path d="M8 -24l7 -9M9.6 -23l7.6 -8M11 -22l7.4 -7" stroke={p.crop} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}

/** Carries a bundle across the field — the weight shows in the walk. */
function WorkerCarrying({ x, y, scale, night, seed }: WorkerProps) {
  const p = workerPalette(night);
  const r = rng(seed * 173);
  const step = 1.15 + r() * 0.4;
  const trip = 38 + r() * 22;
  const dist = 130 + r() * 150;

  return (
    <g
      className="bmx-traverse"
      style={{ animationDuration: `${trip}s`, animationDelay: `${-r() * trip}s`, ["--walk-dist" as string]: `${dist}px` }}
    >
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <g className="bmx-carry" style={{ animationDuration: `${step * 2}s` }}>
          <g className="bmx-worker" style={{ animationDuration: `${step}s` }}>
            <circle cx="0" cy="-45" r="6.2" fill={p.body} />
            <path d="M-11 -49h22q-3 -6 -11 -6t-11 6z" fill={p.body} />
            <path d="M-12.5 -48.5h25" stroke={p.rim} strokeWidth="1.2" strokeLinecap="round" />

            {/* Bundle of stalks on the shoulder */}
            <g transform="rotate(-16 0 -40)">
              <rect x="-16" y="-58" width="34" height="7" rx="3" fill={p.crop} opacity=".9" />
              <path d="M-14 -58v-3M-8 -58v-4M-2 -58v-3M4 -58v-4M10 -58v-3M15 -58v-4"
                stroke={p.crop} strokeWidth="1.2" strokeLinecap="round" />
            </g>

            <rect x="-5.5" y="-41" width="11" height="21" rx="4" fill={p.body} />
            {/* One arm up steadying the load, one swinging */}
            <rect x="-9" y="-50" width="3.4" height="14" rx="1.7" fill={p.body} transform="rotate(-24 -7 -46)" />
            <g className="bmx-arm-b" style={{ animationDuration: `${step}s` }}>
              <rect x="5.1" y="-39" width="3.4" height="17" rx="1.7" fill={p.body} />
            </g>
            <g className="bmx-leg-a" style={{ animationDuration: `${step}s` }}>
              <rect x="-4.6" y="-21" width="4" height="21" rx="1.8" fill={p.body} />
            </g>
            <g className="bmx-leg-b" style={{ animationDuration: `${step}s` }}>
              <rect x="0.6" y="-21" width="4" height="21" rx="1.8" fill={p.body} />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
