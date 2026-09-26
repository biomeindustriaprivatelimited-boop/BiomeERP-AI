import type { Metadata, Viewport } from "next";

import "./globals.css";
import "./themes.css";
import AppGate from "@/components/AppGate";
import PwaRegister from "@/components/PwaRegister";

// Fonts ship as files inside the app (@fontsource) — no download at build
// time, no download at run time, no fallback to the system font ever.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/900.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/800.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/800.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";

export const metadata: Metadata = {
  title: "Biome AI ERP",
  description:
    "Reconciliation, OCR and document intelligence platform for Biome Industria Private Limited.",
  // Installable on a phone: Android reads the manifest, iOS reads these.
  manifest: "/manifest.json",
  applicationName: "Biome AI ERP",
  appleWebApp: { capable: true, title: "Biome", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#14300a",
  width: "device-width",
  initialScale: 1,
  // A field user must be able to zoom into a weighbridge slip.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved accent + light/dark before first paint, so
            there's no flash of the default theme on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var a=localStorage.getItem('biome:accent')||'leaf';var saved=localStorage.getItem('biome:colorMode');var m=(saved==='dark'||saved==='command'||saved==='midnight'||saved==='sunrise')?saved:'light';var e=document.documentElement;e.setAttribute('data-accent',a);e.setAttribute('data-theme',m);var f=localStorage.getItem('biome:font')||'inter';e.setAttribute('data-font',f);if(m==='dark'||m==='command'||m==='midnight'){e.classList.add('dark')}else{e.classList.remove('dark')}if(!localStorage.getItem('biome:motionReset2')){localStorage.removeItem('biome:reduceMotion');localStorage.setItem('biome:motionReset2','1');}var rm=localStorage.getItem('biome:reduceMotion');if(rm==='1')e.classList.add('reduce-motion');}catch(_){}})();`,
          }}
        />
      </head>
      <body
        className="font-body antialiased"
      >
        <PwaRegister />
        <AppGate>{children}</AppGate>
      </body>
    </html>
  );
}
