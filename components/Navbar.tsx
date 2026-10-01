"use client";

import { useEffect, useRef, useState } from "react";
import Portal from "@/components/Portal";
import Link from "next/link";
import { Sun, Moon, Factory, Bot, ChevronDown, User, LogOut, Menu } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import StatusCluster from "@/components/StatusCluster";
import NotificationBell from "@/components/NotificationBell";
import AndroidAppButton from "@/components/AndroidAppButton";
import { getColorMode, setColorMode, type ColorMode } from "@/lib/preferences";
import { useSession } from "@/lib/session";
import { ROLES } from "@/lib/permissions";
import { usePlants } from "@/lib/usePlants";

/**
 * The application top bar.
 *
 * Deliberately quiet: a search field, the few controls that belong at the
 * app level, and who's signed in. Everything that changes per-page lives
 * in the page itself, so this never competes with the content below it.
 */
export default function Navbar() {
  const PLANTS = usePlants();
  const { user, plant, can, signOut } = useSession();
  const [mode, setMode] = useState<ColorMode>("light");
  const [menuOpen, setMenuOpen] = useState(false);
  // Where the menu opens, measured from the chip. The menu is portaled to
  // <body> (the header's backdrop-blur would otherwise trap it), so it can
  // no longer anchor to the chip with `absolute` — it must be placed with
  // `fixed` coordinates instead.
  const chipRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  function toggleMenu() {
    const r = chipRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setMenuOpen((o) => !o);
  }

  // A fixed menu would drift away from the chip on resize — just close it.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [menuOpen]);

  useEffect(() => {
    setMode(getColorMode());
  }, []);

  function toggleTheme() {
    const next: ColorMode = mode === "light" ? "dark" : mode === "dark" ? "command" : "light";
    setColorMode(next);
    setMode(next);
    // Keep Tailwind's dark class aligned only with the original dark mode.
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  const themeLabel = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "BIOME Command";
  const ThemeIcon = mode === "light" ? Moon : mode === "dark" ? Factory : Sun;

  function openSearch() {
    // The command palette already listens for Ctrl/Cmd+K app-wide.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-biome-line bg-biome-bgSoft/85 px-3 py-2.5 backdrop-blur-xl sm:px-5 sm:py-3 md:px-7">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Phones: the sidebar is a drawer, opened from here. */}
        <button
          onClick={() => window.dispatchEvent(new Event("biome:toggle-nav"))}
          aria-label="Open menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-biome-line bg-biome-bg text-biome-text md:hidden"
        >
          <Menu size={17} />
        </button>

        {/* Search — a real command palette, not a decorative box */}
        <div className="min-w-0 flex-1 overflow-hidden md:flex-none md:overflow-visible"><GlobalSearch /></div>

        <div className="ml-auto flex items-center gap-2">
          {/* Clock and connectivity — desktop only; a phone has its own. */}
          <div className="max-lg:hidden"><StatusCluster /></div>

          <AndroidAppButton />

          <button
            onClick={toggleTheme}
            title={`Theme: ${themeLabel}. Click to switch.`}
            aria-label={`Current theme ${themeLabel}. Click to change theme.`}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line bg-biome-bg text-biome-muted transition-colors hover:text-biome-text"
          >
            <ThemeIcon size={15} />
          </button>

          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line bg-biome-bg">
            <NotificationBell />
          </div>

          <Link
            href="/assistant"
            title="BIOME AI Business Assistant"
            className="max-sm:hidden flex h-9 w-9 items-center justify-center rounded-xl border border-biome-line bg-gradient-to-br from-violet-500/15 to-indigo-500/15 text-violet-500 transition-transform hover:scale-105"
          >
            <Bot size={15} />
          </Link>

          {/* User */}
          <div className="relative">
            <button
              ref={chipRef}
              onClick={toggleMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bg py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-biome-hover"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-biome-leaf to-biome-leafBright text-biome-text">
                <User size={15} />
              </span>
              <span className="hidden text-left sm:block">
                {/* Was hard-coded to one name. With four roles signing in,
                    the bar has to say who is actually here — and which
                    plant a field session is filing against. */}
                <span className="block text-[12px] font-medium leading-tight text-biome-text">
                  {user?.name ?? "Signed out"}
                </span>
                <span className="block text-[10px] leading-tight text-biome-muted">
                  {ROLES.find((r) => r.id === user?.role)?.label ?? ""}
                  {plant ? ` · ${PLANTS.find((p) => p.code === plant)?.label ?? plant}` : ""}
                </span>
              </span>
              <ChevronDown size={13} className="hidden shrink-0 text-biome-muted sm:block" />
            </button>

            {menuOpen && (
              <>
                <Portal><div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  style={{ top: menuPos?.top ?? 64, right: menuPos?.right ?? 16 }}
                  className="fixed z-[61] w-52 rounded-xl border border-biome-line bg-biome-surface p-1.5 shadow-xl"
                >
                  {/* Same filtering as the sidebar: a link the role can't
                      open would only lead to a refusal page. */}
                  {([
                    ["/company", "Company profile", "company"],
                    ["/settings", "Settings", "settings"],
                    ["/vendors", "Vendor registry", "vendors"],
                  ] as const)
                    .filter(([, , perm]) => can(perm))
                    .map(([href, label]) => (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-[12px] text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
                      >
                        {label}
                      </Link>
                    ))}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      // Clearing a browser flag never ended the session —
                      // the signed cookie lived on the server side of the
                      // request, so the app simply let you back in. This
                      // asks the server to drop it.
                      signOut();
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-biome-line px-3 py-2 pt-2.5 text-left text-[12px] text-biome-bolt transition-colors hover:bg-biome-bolt/5"
                  >
                    <LogOut size={13} /> Sign out
                  </button>
                </div></Portal>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
