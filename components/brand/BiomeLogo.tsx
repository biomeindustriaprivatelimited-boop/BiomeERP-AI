"use client";

import { useId } from "react";

/**
 * The Biome mark — green energy from biomass.
 *
 * A lime leaf whose midrib is a lightning bolt (biomass → power), inside a
 * slowly turning energy ring that carries a small amber "sun / pellet"
 * spark, on a deep-forest badge. Pure inline SVG: crisp from 16 px to
 * 400 px, readable on dark and light backgrounds (the badge brings its own
 * dark field), and the shapes are bold enough to survive 20 px.
 *
 * Motion is quiet: the ring turns once every 16 s, the leaf breathes and a
 * light sweep crosses it every few seconds. All of it stops for
 * prefers-reduced-motion, and the static frame is a complete logo.
 *
 * Props are unchanged from the earlier mark, so every usage still works:
 *   size, lime (leaf/ring colour), forest (badge + bolt), className,
 *   plain (no badge — just the leaf and ring).
 */
export default function BiomeLogo({
  size = 36,
  lime = "#9fe870",
  forest = "#163300",
  className = "",
  plain = false,
  animated = true,
}: {
  size?: number;
  lime?: string;
  forest?: string;
  className?: string;
  plain?: boolean;
  /** Set false for a still mark (print, tiny favicons). */
  animated?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (k: string) => `bl-${k}-${uid}`;
  // Below ~24 px the light sweep and the dashes turn to noise; keep the
  // ring solid and drop the sweep.
  const tiny = size < 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`biome-logo ${animated ? "biome-logo-anim" : ""} ${className}`}
      aria-label="Biome Industria"
      role="img"
    >
      <style>{`
        .biome-logo-anim .bl-ring { transform-origin: 32px 32px; animation: bl-spin 16s linear infinite; }
        .biome-logo-anim .bl-leaf { transform-origin: 32px 33px; animation: bl-breathe 3.6s ease-in-out infinite; }
        .biome-logo-anim .bl-shine { animation: bl-sweep 5.5s ease-in-out infinite; }
        .biome-logo-anim .bl-spark { animation: bl-twinkle 2.4s ease-in-out infinite; }
        .biome-logo .bl-shine { transform: translate(-46px, 46px); }
        @keyframes bl-spin { to { transform: rotate(360deg); } }
        @keyframes bl-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
        @keyframes bl-sweep { 0%, 55% { transform: translate(-46px, 46px); } 85%, 100% { transform: translate(46px, -46px); } }
        @keyframes bl-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
        @media (prefers-reduced-motion: reduce) {
          .biome-logo-anim .bl-ring, .biome-logo-anim .bl-leaf, .biome-logo-anim .bl-shine, .biome-logo-anim .bl-spark { animation: none !important; }
        }
      `}</style>
      <defs>
        <linearGradient id={id("badge")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4a12" />
          <stop offset=".55" stopColor={forest} />
          <stop offset="1" stopColor="#081a06" />
        </linearGradient>
        <linearGradient id={id("leaf")} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fae5b" />
          <stop offset=".55" stopColor={lime} />
          <stop offset="1" stopColor="#e6ff9e" />
        </linearGradient>
        <linearGradient id={id("ring")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={lime} />
          <stop offset="1" stopColor="#45c9ec" />
        </linearGradient>
        <linearGradient id={id("shine")} x1="0" y1="1" x2="1" y2="0">
          <stop offset=".35" stopColor="#ffffff" stopOpacity="0" />
          <stop offset=".5" stopColor="#ffffff" stopOpacity=".7" />
          <stop offset=".65" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d="M17 47C15 30 27 16 48 15c1 20-10 33-31 32z" />
        </clipPath>
      </defs>

      {/* badge */}
      {!plain && (
        <>
          <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id("badge")})`} />
          <rect x="3" y="3" width="58" height="58" rx="16" fill="none" stroke={lime} strokeOpacity=".28" strokeWidth="1.2" />
        </>
      )}

      {/* energy ring with its spark */}
      <g className="bl-ring">
        <circle
          cx="32" cy="32" r="23.5" fill="none"
          stroke={`url(#${id("ring")})`} strokeWidth={tiny ? 3 : 2.6} strokeLinecap="round"
          strokeDasharray={tiny ? undefined : "44 8 22 8 52 14"}
          opacity=".9"
        />
        <circle className="bl-spark" cx="32" cy="8.5" r={tiny ? 3.6 : 3.2} fill="#ffcf4a" />
        <circle cx="32" cy="8.5" r={tiny ? 1.4 : 1.2} fill="#fff7d6" />
      </g>

      {/* leaf with a lightning-bolt midrib */}
      <g className="bl-leaf">
        <path d="M17 47C15 30 27 16 48 15c1 20-10 33-31 32z" fill={`url(#${id("leaf")})`} />
        {!tiny && (
          <g clipPath={`url(#${id("clip")})`}>
            <rect className="bl-shine" x="0" y="0" width="64" height="64" fill={`url(#${id("shine")})`} />
          </g>
        )}
        <path d="M38.5 21.5 27 34.2h6.4l-5.2 9.3 12-13.4h-6.3l4.6-8.6z" fill={forest} />
        <path d="M17 47l-4.5 4.5" stroke={lime} strokeWidth="3.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
