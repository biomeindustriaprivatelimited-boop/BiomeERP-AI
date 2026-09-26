/** Small local-only (per-machine) app preferences — stored in localStorage,
 *  never sent anywhere. Kept deliberately tiny: only add a preference here
 *  once there's a real, safe way to apply it across the app. */

const REDUCE_MOTION_KEY = "biome:reduceMotion";
const TALLY_SETTINGS_KEY = "biome:tallySettings";

export interface TallyStoredSettings {
  mode: "direct" | "agent";
  host: string;
  port: number;
  companyName: string;
  agentUrl: string;
  agentApiKey: string;
}

const DEFAULT_TALLY_SETTINGS: TallyStoredSettings = {
  mode: "direct",
  host: "localhost",
  port: 9000,
  companyName: "",
  agentUrl: "",
  agentApiKey: "",
};

export function getTallySettings(): TallyStoredSettings {
  if (typeof window === "undefined") return DEFAULT_TALLY_SETTINGS;
  try {
    const raw = localStorage.getItem(TALLY_SETTINGS_KEY);
    if (!raw) return DEFAULT_TALLY_SETTINGS;
    return { ...DEFAULT_TALLY_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TALLY_SETTINGS;
  }
}

export function setTallySettings(settings: TallyStoredSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TALLY_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Stored as "1"/"0" — the app's original format, restored deliberately.
 *
 * A previous attempt to "fix" this wrote "true"/"false" so the pre-paint
 * script in app/layout.tsx would finally match it. It matched, the
 * `reduce-motion` class went on, and `html.reduce-motion *` in globals.css
 * switched off every animation in the product — splash, login scene,
 * dashboard, all of it. The setting working correctly was worth far less
 * than the animations, so this reads and writes exactly what it used to.
 */
export function getReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REDUCE_MOTION_KEY) === "1";
}

export function setReduceMotion(value: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REDUCE_MOTION_KEY, value ? "1" : "0");
  applyReduceMotionClass(value);
}

export function applyReduceMotionClass(value: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("reduce-motion", value);
}

// ---------------------------------------------------------------------
// Appearance: accent colour + light/dark. Applied to <html> so a reload
// keeps the choice (see app/layout.tsx bootstrap script).
// ---------------------------------------------------------------------

export type AccentTheme = "leaf" | "ocean" | "sunset" | "violet" | "slate";
export type ColorMode = "dark" | "light" | "command" | "midnight" | "sunrise";

const ACCENT_KEY = "biome:accent";
const MODE_KEY = "biome:colorMode";

export const ACCENT_OPTIONS: { id: AccentTheme; label: string; swatch: string }[] = [
  { id: "leaf", label: "Biome Leaf", swatch: "#7cb342" },
  { id: "ocean", label: "Ocean", swatch: "#3b9ea3" },
  { id: "sunset", label: "Sunset", swatch: "#e8873b" },
  { id: "violet", label: "Violet", swatch: "#8b6fd6" },
  { id: "slate", label: "Slate", swatch: "#64748b" },
];

export function getAccent(): AccentTheme {
  if (typeof window === "undefined") return "leaf";
  const v = window.localStorage.getItem(ACCENT_KEY) as AccentTheme | null;
  return v && ACCENT_OPTIONS.some((o) => o.id === v) ? v : "leaf";
}

export function setAccent(accent: AccentTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCENT_KEY, accent);
  document.documentElement.setAttribute("data-accent", accent);
}

export function getColorMode(): ColorMode {
  // Preserve the user's selected visual mode. The new BIOME Command theme
  // is a third mode and never removes or changes the existing light/dark modes.
  if (typeof window === "undefined") return "light";
  const value = window.localStorage.getItem(MODE_KEY);
  return value === "dark" || value === "command" || value === "midnight" || value === "sunrise" ? value : "light";
}

export function setColorMode(mode: ColorMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODE_KEY, mode);
  document.documentElement.setAttribute("data-theme", mode);
  // Tailwind is configured with darkMode: "class". The bootstrap script
  // sets this class on load but nothing kept it in step afterwards, so
  // switching mode from Settings left the class stale until a reload.
  document.documentElement.classList.toggle("dark", mode === "dark" || mode === "command" || mode === "midnight");
}

/** Apply saved appearance on load. Call once, early. */
export function applyAppearance() {
  if (typeof window === "undefined") return;
  document.documentElement.setAttribute("data-accent", getAccent());
  document.documentElement.setAttribute("data-theme", getColorMode());
  applyFont();
}


/* ------------------------------------------------------------------ */
/* Font family — premium choices, applied through one data attribute    */
/* ------------------------------------------------------------------ */
export type FontChoice = "inter" | "manrope" | "jakarta" | "plex" | "sora" | "grotesk";
export const FONT_CHOICES: { id: FontChoice; label: string; note: string }[] = [
  { id: "inter", label: "Inter", note: "Neutral, dense screens — the default" },
  { id: "manrope", label: "Manrope", note: "Rounded, modern, very readable" },
  { id: "jakarta", label: "Plus Jakarta Sans", note: "Premium SaaS feel" },
  { id: "plex", label: "IBM Plex Sans", note: "Precise, enterprise" },
  { id: "sora", label: "Sora", note: "Geometric, bold headlines" },
  { id: "grotesk", label: "Space Grotesk", note: "Technical character" },
];
const FONT_KEY = "biome:font";
export function getFont(): FontChoice {
  if (typeof window === "undefined") return "inter";
  const v = window.localStorage.getItem(FONT_KEY) as FontChoice | null;
  return FONT_CHOICES.some((f) => f.id === v) ? (v as FontChoice) : "inter";
}
export function setFont(font: FontChoice) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_KEY, font);
  document.documentElement.setAttribute("data-font", font);
}
export function applyFont() {
  if (typeof window === "undefined") return;
  document.documentElement.setAttribute("data-font", getFont());
}
