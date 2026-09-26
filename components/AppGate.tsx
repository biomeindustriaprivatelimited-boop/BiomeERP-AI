"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import MobileNavDrawer from "@/components/MobileNavDrawer";
import Navbar from "@/components/Navbar";
import { OverrideBanner } from "@/components/settings/OverrideSetting";
import AnimatedBackground from "@/components/AnimatedBackground";
import SplashScreen from "@/components/brand/SplashScreen";
import PreferencesInit from "@/components/PreferencesInit";
import UpdateBanner from "@/components/UpdateBanner";
import ServerGuard from "@/components/ServerGuard";
import { PageWipe } from "@/components/motion/kit";
import FeatureShell from "@/components/FeatureShell";
import { CursorGlow, Particles, Ripples } from "@/components/fx";
import { NotificationsProvider } from "@/lib/notifications";
import { SessionProvider, useSession } from "@/lib/session";

/**
 * App entry/auth gate.
 *
 *   BIOME INDUSTRIA splash -> Login -> application shell
 *
 * The session now comes from a signed, httpOnly cookie checked by the
 * server, not from a sessionStorage flag the browser console could set.
 * This component only decides what to *draw*; the middleware decides what
 * may be *reached*. Both matter: without the gate the app flashes the
 * wrong screen, without the middleware the data is not actually protected.
 */
export default function AppGate({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [splashDone, setSplashDone] = useState(false);

  const signedIn = Boolean(user);
  // Screens that stand alone, outside the sidebar/navbar shell.
  const isBareScreen = pathname === "/login" || pathname === "/change-password";
  // The phone experience. /m/* pages carry their own chrome — a sidebar
  // built for a 1440px desk would be unusable on a 390px screen.
  const isMobileScreen = pathname.startsWith("/m/") || pathname === "/m";

  /**
   * Re-read the session on every navigation.
   *
   * Without this, the session was fetched once when the shell mounted and
   * never again. Signing in navigated to "/" while this component still
   * believed nobody was signed in, so the redirect below fired and threw
   * the person straight back to the login screen — with a valid cookie in
   * hand. /api/auth/me is tiny; reading it per navigation is far cheaper
   * than a login loop.
   */
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (loading || !splashDone) return;

    if (!signedIn && pathname !== "/login") {
      router.replace("/login");
      return;
    }
    if (signedIn && pathname === "/login") {
      router.replace(user?.mustChangePassword ? "/change-password" : "/");
      return;
    }
    // Until the password is changed, every route funnels back here.
    if (signedIn && user?.mustChangePassword && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [loading, splashDone, signedIn, pathname, router, user?.mustChangePassword]);

  if (loading || !splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  // While a redirect is in flight, don't expose the wrong screen.
  if (!signedIn && pathname !== "/login") return null;
  if (signedIn && pathname === "/login") return null;
  if (signedIn && user?.mustChangePassword && pathname !== "/change-password") return null;

  // Login and the first-run password screen sit outside the application
  // shell, exactly as the original did: no sidebar, navbar, assistant —
  // and no PreferencesInit, so nothing here can switch off the scene's
  // animations before it has even drawn.
  if (isBareScreen) {
    return <ServerGuard>{children}</ServerGuard>;
  }

  // Phone pages: session-guarded like everything else, but drawn with
  // their own mobile chrome instead of the desktop sidebar and navbar.
  if (isMobileScreen) {
    return (
      <ServerGuard>
        <NotificationsProvider>{children}</NotificationsProvider>
      </ServerGuard>
    );
  }

  return (
    <ServerGuard>
      <AnimatedBackground />
      <CursorGlow />
      <Particles density={60} />
      <Ripples />
      <PreferencesInit />
      <NotificationsProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <MobileNavDrawer />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Navbar />
            {/* Above the update banner on purpose: while an override is
                running, that is the most important thing on the screen. */}
            <OverrideBanner />
            <UpdateBanner />
            <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-16 pt-4 sm:px-5 sm:pt-5 md:px-7"><PageWipe id={pathname}><FeatureShell>{children}</FeatureShell></PageWipe></main>
          </div>
        </div>
      </NotificationsProvider>
    </ServerGuard>
  );
}
