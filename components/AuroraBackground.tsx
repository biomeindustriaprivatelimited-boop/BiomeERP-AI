"use client";

import { motion } from "framer-motion";
import { Leaf, Recycle, Factory, Truck, Zap, Sprout } from "lucide-react";

/**
 * Ambient backdrop for the whole app: three large soft-edged gradient
 * "blobs" that slowly drift and breathe, a faint panning grid for a
 * professional SaaS-dashboard feel, plus drifting biomass-themed motes
 * and icons. Everything runs on an infinite loop and sits behind all
 * content (-z-10), never competing with it.
 */
export default function AuroraBackground() {
  const blobs = [
    { color: "rgba(62,213,152,0.22)", size: 620, left: "-8%", top: "-10%", dur: 26 },
    { color: "rgba(79,168,255,0.18)", size: 560, left: "62%", top: "6%", dur: 32 },
    { color: "rgba(255,177,62,0.14)", size: 520, left: "20%", top: "58%", dur: 29 },
  ];

  const motes = [
    { left: "8%", top: "18%", size: 5, delay: 0, color: "leaf" },
    { left: "22%", top: "62%", size: 3, delay: 1.2, color: "bolt" },
    { left: "38%", top: "12%", size: 4, delay: 2.1, color: "sky" },
    { left: "58%", top: "70%", size: 3, delay: 0.6, color: "leaf" },
    { left: "74%", top: "30%", size: 5, delay: 1.8, color: "sky" },
    { left: "88%", top: "58%", size: 3, delay: 0.9, color: "bolt" },
  ];

  const icons = [
    { Icon: Leaf, left: "12%", top: "26%", delay: 0, duration: 9 },
    { Icon: Recycle, left: "82%", top: "16%", delay: 1.4, duration: 11 },
    { Icon: Factory, left: "68%", top: "72%", delay: 0.8, duration: 10 },
    { Icon: Truck, left: "18%", top: "78%", delay: 2.2, duration: 12 },
    { Icon: Sprout, left: "48%", top: "8%", delay: 1.7, duration: 8.5 },
    { Icon: Zap, left: "92%", top: "48%", delay: 0.4, duration: 9.5 },
  ];

  const colorMap: Record<string, string> = {
    leaf: "#7CB342",
    bolt: "#FDE047",
    sky: "#5B9BD5",
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-biome-bg"
    >
      {/* slow-panning grid — subtle "enterprise platform" texture */}
      <motion.div
        className="absolute inset-[-10%] opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(232,246,239,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(232,246,239,0.9) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
        animate={{ backgroundPosition: ["0px 0px", "42px 42px"] }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
      />

      {/* large drifting gradient blobs */}
      {blobs.map((b, i) => (
        <motion.div
          key={`blob-${i}`}
          className="absolute rounded-full blur-[90px]"
          style={{
            width: b.size,
            height: b.size,
            left: b.left,
            top: b.top,
            background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)`,
          }}
          animate={{
            x: [0, 60, -40, 0],
            y: [0, -40, 30, 0],
            scale: [1, 1.15, 0.95, 1],
          }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      {motes.map((m, i) => (
        <motion.span
          key={`mote-${i}`}
          className="absolute rounded-full blur-[1px]"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            background: colorMap[m.color],
            boxShadow: `0 0 12px 2px ${colorMap[m.color]}66`,
          }}
          animate={{ y: [0, -18, 0], opacity: [0.25, 0.7, 0.25] }}
          transition={{
            duration: 6 + i,
            delay: m.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
      {icons.map(({ Icon, left, top, delay, duration }, i) => (
        <motion.div
          key={`icon-${i}`}
          className="absolute text-biome-leaf/[0.09]"
          style={{ left, top }}
          animate={{ y: [0, -22, 0], rotate: [0, 6, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
        >
          <Icon size={32} strokeWidth={1.2} />
        </motion.div>
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#0A0F1A_88%)]" />
    </div>
  );
}
