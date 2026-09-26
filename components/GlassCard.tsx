"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

/**
 * The app's standard surface.
 *
 * Pass 8 gave it the premium treatment the rest of the app now carries:
 * a slightly springier entrance, a whisper of lift on hover, and the
 * light-sweep sheen from the .glass rule in globals.css. All of it is
 * decoration on top of the same box — content and layout are untouched,
 * and reduced-motion strips every bit of it.
 */
export default function GlassCard({
  children,
  className = "",
  delay = 0,
  activeBorder = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  activeBorder?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`energy-pulse-border glass rounded-2xl ${
        activeBorder ? "is-active" : ""
      } ${className}`}
    >
      {children}
    </motion.div>
  );
}
