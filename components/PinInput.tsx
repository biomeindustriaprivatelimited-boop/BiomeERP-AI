"use client";

import { useEffect, useRef } from "react";

/**
 * An 8-digit MPIN field drawn as eight boxes.
 *
 * One real (transparent) input sits over the boxes and takes every key —
 * eight separate inputs juggling focus dropped digits when typed quickly.
 * Paste works, Backspace works, and the 8th digit (or Enter) calls
 * onComplete.
 */
export default function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus = true,
  dark = true,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  dark?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const box = dark
    ? { background: "rgba(255,255,255,.07)", color: "#ffffff", borderColor: "rgba(255,255,255,.16)" }
    : { background: "var(--biome-bg, #fff)", color: "inherit" };
  const active = Math.min(value.length, 7);

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <div className="flex justify-between gap-1.5" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{ ...box, ...(i === active && !disabled ? { borderColor: dark ? "#9fe870" : undefined } : {}) }}
            className={`flex h-11 w-full min-w-0 items-center justify-center rounded-xl border text-[20px] font-bold ${
              dark ? "" : `border-biome-line text-biome-text ${i === active ? "border-biome-leaf" : ""}`
            }`}
          >
            {value[i] ? "•" : ""}
          </div>
        ))}
      </div>
      <input
        ref={ref}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="8-digit MPIN"
        maxLength={8}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 8);
          onChange(v);
          if (v.length === 8) onComplete?.(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.length === 8) onComplete?.(value);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        style={{ caretColor: "transparent" }}
      />
    </div>
  );
}
