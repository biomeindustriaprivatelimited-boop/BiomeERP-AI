"use client";

import { useState, MouseEvent, ButtonHTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

type Variant = "primary" | "secondary" | "ghost";

interface PremiumButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  children: ReactNode;
  variant?: Variant;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    "bg-biome-leaf text-biome-bg shadow-[0_0_0_0_rgba(124,179,66,0)] hover:shadow-glow",
  secondary:
    "border border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright hover:bg-biome-leaf/20 hover:shadow-glow",
  ghost:
    "border border-biome-line text-biome-muted hover:text-biome-text hover:bg-white/5",
};

/**
 * Drop-in button with the standard "premium UI" micro-interaction set:
 * a real ripple from the click point, a subtle hover scale, a soft
 * brand-colour glow, and smooth transitions throughout — used for
 * primary/secondary CTAs across the app.
 */
export default function PremiumButton({
  children,
  variant = "primary",
  className = "",
  onClick,
  disabled,
  ...rest
}: PremiumButtonProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!disabled) {
      const rect = e.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple: Ripple = {
        id: Date.now() + Math.random(),
        x: e.clientX - rect.left - size / 2,
        y: e.clientY - rect.top - size / 2,
        size,
      };
      setRipples((r) => [...r, ripple]);
      setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== ripple.id)), 650);
    }
    onClick?.(e);
  }

  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.035 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      onClick={handleClick}
      disabled={disabled}
      className={`relative isolate flex items-center justify-center gap-1.5 overflow-hidden rounded-xl px-4 py-2 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...(rest as any)}
    >
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full bg-white/30"
          style={{
            left: r.x,
            top: r.y,
            width: r.size,
            height: r.size,
            animation: "premium-ripple 650ms ease-out forwards",
          }}
        />
      ))}
    </motion.button>
  );
}
