import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import AnimatedBackground from "@/components/AnimatedBackground";
import AutomationAgent from "@/components/agent/AutomationAgent";
import PreferencesInit from "@/components/PreferencesInit";
import { NotificationsProvider } from "@/lib/notifications";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Biome Industria | Enterprise Platform",
  description:
    "Reconciliation, OCR and document intelligence platform for Biome Industria Private Limited.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} font-body antialiased`}
      >
        <AnimatedBackground />
        <PreferencesInit />
        <NotificationsProvider>
          <div className="relative flex min-h-screen">
            <Sidebar />
            <div className="flex min-h-screen flex-1 flex-col">
              <Navbar />
              <main className="flex-1 px-5 pb-10 pt-4 md:px-8">{children}</main>
            </div>
          </div>
          <AutomationAgent />
        </NotificationsProvider>
      </body>
    </html>
  );
}
