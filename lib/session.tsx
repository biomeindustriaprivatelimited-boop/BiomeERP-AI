"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Permission, Role } from "@/lib/permissions";

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
}

interface SessionValue {
  user: SessionUser | null;
  plant: string | null;
  permissions: Permission[];
  loading: boolean;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  plant: null,
  permissions: [],
  loading: true,
  can: () => false,
  refresh: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [plant, setPlant] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
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
      refresh,
      signOut,
    }),
    [user, plant, permissions, loading, refresh, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
