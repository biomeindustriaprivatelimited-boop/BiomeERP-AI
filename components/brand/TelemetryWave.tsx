"use client";

import { useMemo } from "react";

/**
 * Plant telemetry readout.
 *
 * Five layers on purpose (spec §8): a primary wave, a slower secondary, a
 * faint energy line, travelling data points, and an occasional light pulse
 * that crosses the whole panel. They run at four different speeds, which is
 * what stops it looking like one waveform sliding sideways.
 *
 * Each wave path is drawn twice end to end and the layer is translated by
 * exactly -50%, so the loop has no seam.
 */

function wavePath(width: number, height: number, amp: number, periods: number, phase: number) {
  const mid = height / 2;
  const step = width / (periods * 12);
  let d = `M0 ${mid}`;
  for (let x = 0, i = 0; x <= width; x += step, i++) {
    const t = (i / 12) * Math.PI * 2 + phase;
    const y = mid - Math.sin(t) * amp * (0.62 + 0.38 * Math.sin(t * 0.37 + phase));
    d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

interface TelemetryWaveProps {
  height?: number;
  className?: string;
  /** Denser dots and a brighter primary for the splash's larger panel. */
  intensity?: "calm" | "rich";
}

export default function TelemetryWave({
  height = 44,
  className = "",
  intensity = "calm",
}: TelemetryWaveProps) {
  const W = 480; // one tile; drawn twice for a seamless -50% scroll
  const rich = intensity === "rich";

  const layers = useMemo(
    () => [
      { d: wavePath(W, height, height * 0.30, 3, 0), stroke: "rgba(110,231,183,.95)", w: 1.8, dur: 9,  op: 1 },
      { d: wavePath(W, height, height * 0.22, 2, 1.9), stroke: "rgba(103,232,249,.55)", w: 1.4, dur: 14, op: .75 },
      { d: wavePath(W, height, height * 0.13, 5, 3.4), stroke: "rgba(190,245,255,.30)", w: .9,  dur: 21, op: .6 },
    ],
    [height]
  );

  const dots = useMemo(
    () =>
      Array.from({ length: rich ? 9 : 6 }, (_, i) => ({
        top: 22 + ((i * 37) % 56),
        dur: 6 + (i % 4) * 2.4,
        delay: -i * 1.3,
        size: 2 + (i % 3) * 0.9,
      })),
    [rich]
  );

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height }}>
      {layers.map((l, i) => (
        <div
          key={i}
          className="bmx-wave absolute inset-y-0 left-0"
          style={{ width: "200%", animationDuration: `${l.dur}s`, opacity: l.op }}
        >
          <svg
            viewBox={`0 0 ${W * 2} ${height}`}
            preserveAspectRatio="none"
            className={i === 0 ? "bmx-wave-lift h-full w-full" : "h-full w-full"}
            fill="none"
          >
            <path d={l.d} stroke={l.stroke} strokeWidth={l.w} strokeLinecap="round" />
            <path
              d={l.d}
              stroke={l.stroke}
              strokeWidth={l.w}
              strokeLinecap="round"
              transform={`translate(${W} 0)`}
            />
          </svg>
        </div>
      ))}

      {/* Data points riding the signal */}
      {dots.map((d, i) => (
        <span
          key={i}
          className="bmx-tele-dot absolute rounded-full"
          style={{
            top: `${d.top}%`,
            left: "-6px",
            width: d.size,
            height: d.size,
            background: "rgba(190,255,225,.95)",
            boxShadow: "0 0 7px rgba(110,231,183,.9)",
            animationDuration: `${d.dur}s`,
            animationDelay: `${d.delay}s`,
          }}
        />
      ))}

      {/* The light pulse that crosses the panel every few seconds */}
      <div
        className="bmx-tele-pulse absolute inset-y-0 w-1/4"
        style={{
          background:
            "linear-gradient(90deg,transparent,rgba(165,243,252,.30),rgba(190,255,225,.55),rgba(165,243,252,.30),transparent)",
          filter: "blur(1px)",
        }}
      />
    </div>
  );
}
