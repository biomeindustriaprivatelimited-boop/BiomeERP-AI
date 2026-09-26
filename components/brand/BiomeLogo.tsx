/**
 * The Biome mark — a leaf whose veins are a circuit trace, inside a
 * rounded hexagon: biomass + intelligence, in one shape. Pure SVG, so it
 * is crisp at 16 px and at 400 px, and colour-controllable per context.
 */
export default function BiomeLogo({ size = 36, lime = "#9fe870", forest = "#163300", className = "", plain = false }: { size?: number; lime?: string; forest?: string; className?: string; plain?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="Biome Industria" role="img">
      <defs>
        <linearGradient id="bl-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={lime} /><stop offset="1" stopColor="#5fb84a" /></linearGradient>
      </defs>
      {!plain && <path d="M32 3 55 15.5v25L32 53 9 40.5v-25L32 3z" fill={forest} />}
      {!plain && <path d="M32 7.5 51.5 18v20L32 48.5 12.5 38V18L32 7.5z" fill="none" stroke={lime} strokeOpacity=".35" strokeWidth="1.2" />}
      {/* leaf */}
      <path d="M43.5 17.5c1.2 10.8-4.1 22.4-14.4 26.1-3.2 1.1-6.5 1.2-9.6.4 2.2-9.9 8.6-19.1 17.9-24.1 2-1.1 4.1-1.9 6.1-2.4z" fill="url(#bl-grad)" />
      {/* circuit veins */}
      <path d="M22.5 42.5c4-7.4 9.1-13.7 15.3-18.6M27 34.5l4.2.3M30.5 29.6l3.9-.3M25.2 38.9l3.3 1.6" fill="none" stroke={forest} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="31.2" cy="34.8" r="1.4" fill={forest} /><circle cx="34.4" cy="29.3" r="1.4" fill={forest} /><circle cx="28.5" cy="40.5" r="1.4" fill={forest} />
      <path d="M37.8 23.9l3.6-3.6" fill="none" stroke={forest} strokeWidth="1.6" strokeLinecap="round" /><circle cx="41.9" cy="19.8" r="1.5" fill={forest} />
    </svg>
  );
}
