"use client";

import { useEffect, useRef, useState } from "react";

/**
 * An 8-digit MPIN field drawn as eight boxes.
 *
 * One real (transparent) input sits over the boxes and takes every key —
 * eight separate inputs juggling focus dropped digits when typed quickly.
 * Paste works, Backspace works, and the 8th digit (or Enter) calls
 * onComplete.
 *
 * Every colour here is set inline and explicitly. The boxes used to take
 * `color: inherit` on a fallback white background, and drew a "•" glyph,
 * so in a dark theme (light text) the box was white with a white dot —
 * nobody could see what they typed. An entered digit is now a filled dot
 * <span> with its own background colour, which no text-colour rule in the
 * theme CSS can hide.
 *
 *   dark  (default)  login, lock screen — solid dark fill, white dots
 *   dark={false}     inside the themed app — theme surface + theme ink
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
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const palette = dark
    ? {
        fill: "#0b1a14",
        filledFill: "#112a1d",
        border: "rgba(255,255,255,.24)",
        filledBorder: "rgba(159,232,112,.55)",
        dot: "#ffffff",
        ring: "#9fe870",
        ringGlow: "rgba(159,232,112,.35)",
      }
    : {
        fill: "rgb(var(--c-surface))",
        filledFill: "rgb(var(--c-surface))",
        border: "rgb(var(--c-line))",
        filledBorder: "rgb(var(--c-leaf-bright) / .6)",
        dot: "rgb(var(--c-text))",
        ring: "rgb(var(--c-leaf-bright))",
        ringGlow: "rgb(var(--c-volt) / .35)",
      };
  const active = Math.min(value.length, 7);

  return (
    <div className="relative" onClick={() => ref.current?.focus()} data-pin-input={dark ? "dark" : "theme"}>
      <div className="flex justify-between gap-1.5" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => {
          const filled = Boolean(value[i]);
          const isActive = focused && !disabled && i === active;
          return (
            <div
              key={i}
              className="flex h-11 w-full min-w-0 items-center justify-center rounded-xl border transition-[box-shadow,border-color] duration-150"
              style={{
                background: filled ? palette.filledFill : palette.fill,
                borderColor: isActive ? palette.ring : filled ? palette.filledBorder : palette.border,
                boxShadow: isActive ? `0 0 0 3px ${palette.ringGlow}` : "none",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {filled ? (
                <span data-pin-dot style={{ display: "block", width: 12, height: 12, borderRadius: 9999, background: palette.dot }} />
              ) : isActive ? (
                <span className="bmx-pin-caret" style={{ display: "block", width: 2, height: 18, borderRadius: 2, background: palette.ring }} />
              ) : null}
            </div>
          );
        })}
      </div>
      <input
        ref={ref}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="8-digit MPIN"
        maxLength={8}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
