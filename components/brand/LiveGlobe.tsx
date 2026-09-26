"use client";

import { useMemo } from "react";

/**
 * The globe on the splash screen.
 *
 * Built from six independent layers rather than one spinning sphere, because
 * a single rotating texture reads as a stock asset. Here the landmass band,
 * the atmosphere, the network arcs, the site nodes, the orbiting particles
 * and the occasional outward pulse all run at different speeds, which is
 * what gives it depth.
 */

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export default function LiveGlobe({ size = 240 }: { size?: number }) {
  /* Sites sit inside the disc, weighted toward the centre so none of them
     appear to float off the edge of the sphere. */
  const nodes = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: 14 }, () => {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 38;
      return {
        cx: 50 + Math.cos(a) * d,
        cy: 50 + Math.sin(a) * d * 0.92,
        dur: 2.6 + r() * 3.4,
        delay: -r() * 6,
      };
    });
  }, []);

  const arcs = useMemo(() => {
    const r = rng(19);
    return Array.from({ length: 5 }, (_, i) => {
      const x1 = 18 + r() * 26;
      const y1 = 26 + r() * 44;
      const x2 = 56 + r() * 26;
      const y2 = 26 + r() * 44;
      const lift = 12 + r() * 20;
      return {
        d: `M${x1} ${y1}Q${(x1 + x2) / 2} ${Math.min(y1, y2) - lift} ${x2} ${y2}`,
        dur: 5 + r() * 4,
        delay: -i * 1.7,
      };
    });
  }, []);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Atmosphere */}
      <div
        className="bmx-atmo absolute inset-[-9%] rounded-full"
        style={{ background: "radial-gradient(circle,rgba(103,232,249,.30),transparent 66%)", filter: "blur(10px)" }}
      />
      {/* Outward pulse, roughly every nine seconds */}
      <div
        className="bmx-globe-pulse absolute inset-0 rounded-full"
        style={{ border: "1px solid rgba(165,243,252,.55)" }}
      />

      {/* Orbiting particles, two rings at different speeds */}
      {[
        { inset: "-6%", dur: 26, n: 3, r: 2 },
        { inset: "-14%", dur: 40, n: 2, r: 1.6 },
      ].map((ring, ri) => (
        <div
          key={ri}
          className="bmx-orbit absolute rounded-full"
          style={{ inset: ring.inset, animationDuration: `${ring.dur}s`, animationDirection: ri ? "reverse" : "normal" }}
        >
          {Array.from({ length: ring.n }, (_, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                width: ring.r * 2,
                height: ring.r * 2,
                background: "rgba(190,250,235,.95)",
                boxShadow: "0 0 8px rgba(103,232,249,.9)",
                top: "50%",
                left: "50%",
                transform: `rotate(${(360 / ring.n) * i}deg) translateX(${size / 2}px)`,
                transformOrigin: "0 0",
              }}
            />
          ))}
        </div>
      ))}

      {/* Sphere */}
      <div
        className="relative h-full w-full overflow-hidden rounded-full"
        style={{
          background:
            "radial-gradient(circle at 34% 26%,rgba(219,250,255,.5),rgba(23,110,130,.42) 44%,rgba(4,32,44,.6) 76%)",
          boxShadow:
            "inset -22px -22px 52px rgba(0,0,0,.45), inset 8px 8px 30px rgba(190,245,255,.14), 0 0 60px rgba(103,232,249,.22)",
          border: "1px solid rgba(165,243,252,.24)",
        }}
      >
        {/* Landmass band — a repeating dotted texture scrolling horizontally
            gives rotation without needing a real projection. */}
        <div
          className="bmx-globe-map absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(circle,rgba(134,239,172,.85) 1px,transparent 1.6px)",
            backgroundSize: "7px 7px",
            maskImage: "radial-gradient(circle at 50% 50%,#000 58%,transparent 76%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 50%,#000 58%,transparent 76%)",
          }}
        />

        {/* Graticule */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" fill="none">
          {[20, 35, 50, 65, 80].map((y) => (
            <path key={y} d={`M6 ${y}q44 ${y < 50 ? 9 : -9} 88 0`} stroke="rgba(190,245,255,.16)" strokeWidth=".4" />
          ))}
          {[25, 50, 75].map((x) => (
            <ellipse key={x} cx="50" cy="50" rx={Math.abs(50 - x) || 2} ry="44" stroke="rgba(190,245,255,.13)" strokeWidth=".4" />
          ))}
          <circle cx="50" cy="50" r="44" stroke="rgba(165,243,252,.22)" strokeWidth=".5" />

          {/* Network arcs between sites */}
          {arcs.map((a, i) => (
            <path
              key={i}
              className="bmx-arc"
              d={a.d}
              stroke="rgba(165,243,252,.9)"
              strokeWidth=".7"
              strokeLinecap="round"
              style={{ animationDuration: `${a.dur}s`, animationDelay: `${a.delay}s` }}
            />
          ))}

          {/* Sites */}
          {nodes.map((n, i) => (
            <circle
              key={i}
              className="bmx-node"
              cx={n.cx}
              cy={n.cy}
              r="1.6"
              fill="rgba(190,250,220,.95)"
              style={{ animationDuration: `${n.dur}s`, animationDelay: `${n.delay}s` }}
            />
          ))}
        </svg>

        {/* Specular highlight */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 22%,rgba(255,255,255,.30),transparent 34%)" }}
        />
      </div>
    </div>
  );
}
