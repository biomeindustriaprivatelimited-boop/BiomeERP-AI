"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={`energy-pulse-border glass rounded-2xl ${
        activeBorder ? "is-active" : ""
      } ${className}`}
    >
      {children}
    </motion.div>
  );
}
