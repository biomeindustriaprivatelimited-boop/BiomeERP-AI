import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        biome: {
          bg: "#0A0F1A",
          bgSoft: "#0E1524",
          surface: "#111A2E",
          leaf: "#7CB342",
          leafBright: "#9CCC65",
          sky: "#4A7A9C",
          skyBright: "#5B9BD5",
          bolt: "#FDE047",
          boltDeep: "#F4C430",
          text: "#E8EDF5",
          muted: "#8FA3C4",
          line: "rgba(140, 170, 210, 0.14)",
        },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(124, 179, 66, 0.35)",
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
