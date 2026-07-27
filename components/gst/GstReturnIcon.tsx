"use client";

import { motion } from "framer-motion";
import type { GstReturnType } from "@/lib/gst";

const ringVariants = {
  animate: {
    rotate: 360,
    transition: { duration: 12, repeat: Infinity, ease: "linear" },
  },
};

const pulseVariants = {
  animate: {
    scale: [1, 1.12, 1],
    opacity: [0.55, 0.9, 0.55],
    transition: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
  },
};

export default function GstReturnIcon({
  type,
  size = 44,
}: {
  type: GstReturnType;
  size?: number;
}) {
  const colors: Record<GstReturnType, { a: string; b: string }> = {
    GSTR1: { a: "#3ED598", b: "#1AA36B" }, // outward — leaf green
    GSTR2B: { a: "#4FA8FF", b: "#1E6FE0" }, // inward — sky blue
    GSTR3B: { a: "#FFB13E", b: "#E0821E" }, // summary — amber/bolt
  };
  const { a, b } = colors[type];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <motion.div
        variants={pulseVariants}
        animate="animate"
        className="absolute inset-0 rounded-full blur-md"
        style={{ background: `radial-gradient(circle, ${a}55, transparent 70%)` }}
      />
      <svg viewBox="0 0 48 48" width={size} height={size} className="relative">
        <defs>
          <linearGradient id={`grad-${type}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>

        <motion.circle
          cx="24"
          cy="24"
          r="21"
          fill="none"
          stroke={`url(#grad-${type})`}
          strokeWidth="1.4"
          strokeDasharray="4 5"
          style={{ transformOrigin: "24px 24px" }}
          variants={ringVariants}
          animate="animate"
          opacity={0.55}
        />

        <circle cx="24" cy="24" r="16" fill={`url(#grad-${type})`} opacity="0.16" />
        <circle cx="24" cy="24" r="16" fill="none" stroke={`url(#grad-${type})`} strokeWidth="1.3" />

        {type === "GSTR1" && (
          <motion.g
            initial={{ y: 2, opacity: 0.7 }}
            animate={{ y: [2, -2, 2], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M24 30V17M24 17L18 23M24 17L30 23"
              stroke={`url(#grad-${type})`}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </motion.g>
        )}

        {type === "GSTR2B" && (
          <motion.g
            initial={{ y: -2, opacity: 0.7 }}
            animate={{ y: [-2, 2, -2], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M24 18V31M24 31L18 25M24 31L30 25"
              stroke={`url(#grad-${type})`}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </motion.g>
        )}

        {type === "GSTR3B" && (
          <g>
            {[0, 1, 2].map((i) => (
              <motion.rect
                key={i}
                x={17 + i * 5}
                width="3"
                rx="1"
                fill={`url(#grad-${type})`}
                initial={{ height: 6, y: 28 }}
                animate={{ height: [6, 14 - i * 2, 6], y: [28, 20 + i * 2, 28] }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.2,
                }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
