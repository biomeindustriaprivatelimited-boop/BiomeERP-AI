"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Permission, Role } from "@/lib/permissions";
import { permissionForPath } from "@/lib/permissions";

/** A module the developer has frozen ("readonly") or switched off. */
export interface InactiveSwitch {
  id: string;
  label: string;
  state: "readonly" | "off";
  prefixes: string[];
}

function switchCovering(switches: InactiveSwitch[], href: string): InactiveSwitch | null {
  const path = href.split(/[?#]/)[0];
  return switches.find((s) => s.prefixes.some((p) => path === p || path.startsWith(p + "/"))) || null;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  plants: string[];
  active: boolean;
  mustChangePassword: boolean;
  /** From Organisation — shown on the phone header and payslips. */
  designation?: string;
  department?: string;
  /** An 8-digit MPIN is set (lib/mpin.ts). */
  hasMpin?: boolean;
  /** Lock this device after this many idle minutes (0 = never). */
  autoLockMinutes?: number;
}

interface SessionValue {
  user: SessionUser | null;
  plant: string | null;
  permissions: Permission[];
  loading: boolean;
  can: (permission: Permission) => boolean;
  /** Frozen / switched-off modules (empty when everything is live). */
  switches: InactiveSwitch[];
  /**
   * May this person SEE a link to `href`? False when the route needs a
   * permission they do not hold (or `perm` is given and missing), and —
   * for everyone except the developer — when the module is frozen or off.
   * Every menu, hub card, search result and home tile goes through this,
   * so a thing the person cannot use is never drawn, not even greyed out.
   */
  visible: (href: string, perm?: string) => boolean;
  /** The switch covering `href`, for the developer's "frozen" badge. */
  switchFor: (href: string) => InactiveSwitch | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  plant: null,
  permissions: [],
  loading: true,
  can: () => false,
  switches: [],
  visible: () => false,
  switchFor: () => null,
  refresh: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [plant, setPlant] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [switches, setSwitches] = useState<InactiveSwitch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // no-store matters: a cached "nobody is signed in" answer would keep
      // the shell redirecting to /login after a perfectly good sign-in.
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = await res.json();
      setUser(json.user ?? null);
      setPlant(json.plant ?? null);
      setPermissions(Array.isArray(json.permissions) ? json.permissions : []);
      setSwitches(Array.isArray(json.switches) ? json.switches : []);
    } catch {
      // A failed check means "not signed in" rather than "crash the shell".
      setUser(null);
      setPlant(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setPlant(null);
    setPermissions([]);
    window.location.href = "/login";
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      plant,
      permissions,
      loading,
      can: (permission: Permission) => permissions.includes(permission),
      switches,
      visible: (href: string, perm?: string) => {
        if (!user) return false;
        if (perm && !permissions.includes(perm as Permission)) return false;
        const needed = permissionForPath(href.split(/[?#]/)[0]);
        if (needed && !permissions.includes(needed)) return false;
        if (user.role !== "developer" && switchCovering(switches, href)) return false;
        return true;
      },
      switchFor: (href: string) => switchCovering(switches, href),
      refresh,
      signOut,
    }),
    [user, plant, permissions, switches, loading, refresh, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
