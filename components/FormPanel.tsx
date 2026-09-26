"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Portal from "@/components/Portal";

/**
 * The form modal.
 *
 * This used to be a full-screen sheet. Two things were wrong with that:
 * a short form floated in a vast empty page, and anything tall (the
 * "open on phone" QR, a long budget form) had its head clipped because
 * the sheet itself could not scroll — only its body could, and the body
 * started below a header that was already off-screen.
 *
 * It is now a centred card: it grows with its content up to 88% of the
 * viewport, scrolls inside, and is never taller than the window. It
 * springs in from slightly below and fades its backdrop, and reverses on
 * the way out, so opening and closing read as one movement.
 */
export default function FormPanel({
  open,
  title,
  subtitle,
  onClose,
  footer,
  footerLeft,
  children,
  width = "wide",
  icon,
  eyebrow,
  headerRight,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  /** Sits at the far left of the footer — destructive actions belong here. */
  footerLeft?: React.ReactNode;
  children: React.ReactNode;
  /** "wide" is the default card; "full" is for grids that need the room. */
  width?: "wide" | "full" | "narrow";
  icon?: React.ReactNode;
  eyebrow?: string;
  headerRight?: React.ReactNode;
}) {
  // Escape closes it, and the page behind must not scroll while it is up —
  // two scrollbars fighting is what made the old panel feel broken.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const maxW =
    width === "full" ? "max-w-[1320px]" : width === "narrow" ? "max-w-[560px]" : "max-w-[980px]";

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:p-6 md:items-center">
          {/* Backdrop — click anywhere outside the card to close. */}
          <motion.div
            className="fixed inset-0 bg-black/55 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative my-auto flex w-full ${maxW} max-h-[88vh] flex-col overflow-hidden rounded-3xl border border-biome-line bg-biome-bgSoft shadow-[0_40px_120px_-30px_rgb(0_0_0/.75)]`}
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.85 }}
          >
            {/* A quiet wash so the card reads as a place, not a blank sheet. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(90% 60% at 12% -10%, rgb(var(--c-leaf) / .10), transparent 60%)," +
                  "radial-gradient(70% 50% at 100% 0%, rgb(var(--c-sky) / .07), transparent 60%)",
              }}
            />

            <header className="relative shrink-0 overflow-hidden border-b border-biome-line bg-biome-bgSoft/95 backdrop-blur-xl">
              <span
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{ background: "linear-gradient(90deg, rgb(var(--c-leaf)), rgb(var(--c-volt)), rgb(var(--c-sky)), transparent)" }}
              />
              <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-7">
                <div className="flex min-w-0 items-center gap-3">
                  {icon && (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-biome-leaf/12 text-biome-leafBright">
                      {icon}
                    </span>
                  )}
                  <div className="min-w-0">
                    {eyebrow && (
                      <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-biome-muted">{eyebrow}</p>
                    )}
                    <h2 className="truncate text-[19px] font-semibold tracking-[-.03em] text-biome-text">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-[11.5px] leading-relaxed text-biome-muted">{subtitle}</p>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {headerRight}
                  <button
                    onClick={onClose}
                    title="Close (Esc)"
                    className="bmx-toggle flex h-10 w-10 items-center justify-center rounded-xl border border-biome-line text-biome-muted transition-colors hover:border-rose-400/40 hover:text-rose-500"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </header>

            {/* The only scrolling region, so header and footer never move. */}
            <div className="relative flex-1 overflow-y-auto overscroll-contain">
              <div className="px-5 py-6 md:px-7">{children}</div>
            </div>

            {footer && (
              <footer className="relative shrink-0 border-t border-biome-line bg-biome-bgSoft/95 backdrop-blur-xl">
                <div className="flex flex-wrap items-center gap-3 px-5 py-4 md:px-7">
                  {footerLeft && <div className="mr-auto">{footerLeft}</div>}
                  <div className="ml-auto flex flex-wrap items-center gap-3">{footer}</div>
                </div>
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    </Portal>
  );
}

/** A titled block inside a form panel, so a long form reads in sections. */
export function FormSection({
  title,
  hint,
  children,
  columns = 3,
  sectionIcon,
  tone = "default",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  sectionIcon?: React.ReactNode;
  tone?: "default" | "accent" | "warning";
}) {
  const grid = { 1: "", 2: "md:grid-cols-2", 3: "md:grid-cols-2 lg:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" }[columns];
  const edge =
    tone === "accent" ? "border-biome-leaf/30"
    : tone === "warning" ? "border-amber-500/35"
    : "border-biome-line";
  return (
    <section className={`mb-5 overflow-hidden rounded-2xl border ${edge} bg-biome-bg last:mb-0`}>
      <div className="flex items-start gap-3 border-b border-biome-line px-5 py-3.5">
        {sectionIcon && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-biome-leaf/10 text-biome-leafBright">
            {sectionIcon}
          </span>
        )}
        <div>
          <h3 className="text-[12px] font-bold uppercase tracking-[.14em] text-biome-text">{title}</h3>
          {hint && <p className="mt-1 max-w-[640px] text-[11px] leading-relaxed text-biome-muted">{hint}</p>}
        </div>
      </div>
      <div className={`grid gap-4 p-5 ${grid}`}>{children}</div>
    </section>
  );
}
