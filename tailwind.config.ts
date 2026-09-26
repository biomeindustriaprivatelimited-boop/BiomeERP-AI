import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Every colour reads a CSS variable holding SPACE-SEPARATED RGB
        // channels, e.g. --c-leaf: 124 179 66. That form is what lets
        // Tailwind keep working with opacity modifiers (bg-biome-leaf/10)
        // while the actual hue is swappable at runtime from Settings.
        //
        // These used to be hard-coded hex, which is why the theme switch
        // appeared to do nothing: `text-biome-leafBright` compiled to a
        // literal colour and ignored the variables entirely.
        biome: {
          bg: "rgb(var(--c-bg) / <alpha-value>)",
          bgSoft: "rgb(var(--c-bg-soft) / <alpha-value>)",
          surface: "rgb(var(--c-surface) / <alpha-value>)",
          leaf: "rgb(var(--c-leaf) / <alpha-value>)",
          leafBright: "rgb(var(--c-leaf-bright) / <alpha-value>)",
          sky: "rgb(var(--c-sky) / <alpha-value>)",
          skyBright: "rgb(var(--c-sky-bright) / <alpha-value>)",
          bolt: "rgb(var(--c-bolt) / <alpha-value>)",
          boltDeep: "rgb(var(--c-bolt-deep) / <alpha-value>)",
          text: "rgb(var(--c-text) / <alpha-value>)",
          muted: "rgb(var(--c-muted) / <alpha-value>)",
          line: "rgb(var(--c-line) / <alpha-value>)",
          // Hover/fill wash. White-on-dark only reads on dark themes,
          // so this is a token the theme sets rather than a literal.
          // A WASH, not a colour: bare `bg-biome-hover` is ~6% of the theme's
          // ink (the old bg-white/5 … /10), and an explicit /50 scales that.
          hover: "rgb(var(--c-hover) / calc(<alpha-value> * 0.06))",
        },
      },
      fontFamily: {
        display: ["var(--font-display-active, var(--font-space-grotesk))", "sans-serif"],
        body: ["var(--font-body-active, var(--font-inter))", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      boxShadow: {
        glow: "0 0 34px -10px rgba(159, 232, 112, 0.5)",
        boltGlow: "0 0 30px -6px rgba(253, 224, 71, 0.45)",
      },
      backgroundImage: {
        "aurora": "radial-gradient(60% 50% at 20% 0%, rgba(124,179,66,0.16) 0%, transparent 60%), radial-gradient(50% 40% at 85% 15%, rgba(91,155,213,0.14) 0%, transparent 60%), radial-gradient(40% 35% at 50% 100%, rgba(253,224,71,0.08) 0%, transparent 60%)",
      },
      keyframes: {
        pulseBorder: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "50%": { transform: "translateY(-14px) rotate(3deg)" },
        },
        driftX: {
          "0%": { transform: "translateX(-6%)" },
          "100%": { transform: "translateX(6%)" },
        },
      },
      animation: {
        pulseBorder: "pulseBorder 3.5s ease infinite",
        floatSlow: "floatSlow 5s ease-in-out infinite",
        driftX: "driftX 12s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};
export default config;
