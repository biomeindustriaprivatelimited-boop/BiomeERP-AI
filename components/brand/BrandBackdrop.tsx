"use client";

import { useMemo } from "react";

export default function BrandBackdrop({ intensity = "full" }: { intensity?: "full" | "subtle" }) {
  const leafCount = intensity === "subtle" ? 8 : 18;
  const birdCount = intensity === "subtle" ? 3 : 7;

  const leaves = useMemo(() => Array.from({ length: leafCount }, (_, i) => {
    const seed = (i * 2654435761) % 1000;
    return {
      left: (seed % 96) + 2,
      delay: (seed % 17) * 0.7,
      duration: 12 + (seed % 10),
      size: 12 + (seed % 14),
      drift: (seed % 2 ? 1 : -1) * (18 + (seed % 45)),
      spin: seed % 2 ? 420 : -420,
      opacity: 0.35 + ((seed % 30) / 100),
    };
  }), [leafCount]);

  const birds = useMemo(() => Array.from({ length: birdCount }, (_, i) => {
    const seed = (i * 40503) % 997;
    return { top: 9 + (seed % 30), delay: (seed % 23) * 1.3, duration: 20 + (seed % 13), scale: 0.48 + ((seed % 40) / 100) };
  }), [birdCount]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="brand-globe-wrap absolute -right-28 top-1/2 h-[560px] w-[560px] -translate-y-1/2 sm:-right-12">
        <div className="brand-globe-halo absolute inset-[-12%] rounded-full" />
        <svg viewBox="0 0 200 200" className="brand-globe relative h-full w-full">
          <defs>
            <radialGradient id="globeFill" cx="35%" cy="28%">
              <stop offset="0" stopColor="#dff9ff" stopOpacity=".95" />
              <stop offset=".52" stopColor="#8ed4df" stopOpacity=".38" />
              <stop offset="1" stopColor="#0e6974" stopOpacity=".08" />
            </radialGradient>
            <linearGradient id="globeLand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#b7e7a0" />
              <stop offset="1" stopColor="#3c8b62" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="78" fill="url(#globeFill)" />
          <g opacity=".7" fill="none" stroke="#9ee6df" strokeWidth=".55">
            {[20, 40, 60, 78].map(r => <ellipse key={`lat-${r}`} cx="100" cy="100" rx="78" ry={r} />)}
            {[20, 40, 60, 78].map(r => <ellipse key={`lon-${r}`} cx="100" cy="100" rx={r} ry="78" />)}
            <circle cx="100" cy="100" r="78" />
          </g>
          <g fill="url(#globeLand)" opacity=".48">
            <path d="M49 67c9-9 20-12 29-9l7 7-5 8-12 1-6 8-11-4-5-7z" />
            <path d="M87 42l13-4 14 6 3 10-8 5-7 12-8 1-4-11-9-5 3-14z" />
            <path d="M119 86l14-5 13 8 8 14-7 9-11-2-6 10-8-4-1-14-7-7z" />
            <path d="M67 119l12-4 8 8-4 11-8 6-7-6-8-7z" />
          </g>
          <g fill="#d8fff3" opacity=".75">
            {Array.from({ length: 42 }, (_, i) => {
              const a = (i * 137.5 * Math.PI) / 180;
              const r = 72 * Math.sqrt((i + .5) / 42);
              return <circle key={i} cx={100 + r * Math.cos(a)} cy={100 + r * Math.sin(a) * .92} r=".9" />;
            })}
          </g>
        </svg>
        <div className="brand-orbit brand-orbit-a absolute inset-[7%] rounded-full" />
        <div className="brand-orbit brand-orbit-b absolute inset-[18%] rounded-full" />
      </div>

      {birds.map((b, i) => (
        <div key={`bird-${i}`} className="brand-bird absolute left-[-8%]" style={{ top: `${b.top}%`, "--delay": `${b.delay}s`, "--dur": `${b.duration}s`, zoom: b.scale } as React.CSSProperties}>
          <svg width="34" height="14" viewBox="0 0 34 14" className="opacity-55">
            <path d="M2 8 Q9 1 16 8 Q23 1 32 8" fill="none" stroke="#31576c" strokeWidth="1.6" strokeLinecap="round" className="brand-wing" />
          </svg>
        </div>
      ))}

      {leaves.map((l, i) => (
        <div key={`leaf-${i}`} className="brand-leaf absolute top-[-10%]" style={{ left: `${l.left}%`, "--delay": `${l.delay}s`, "--dur": `${l.duration}s`, opacity: l.opacity, "--drift": `${l.drift}px`, "--spin": `${l.spin}deg` } as React.CSSProperties}>
          <svg width={l.size} height={l.size} viewBox="0 0 24 24">
            <path d="M12 2C7 6 4 10 4 15a8 8 0 0 0 16 0c0-5-3-9-8-13z" fill="#4c9b62" />
            <path d="M12 4v16" stroke="#d9f4d1" strokeWidth=".9" />
          </svg>
        </div>
      ))}
    </div>
  );
}
