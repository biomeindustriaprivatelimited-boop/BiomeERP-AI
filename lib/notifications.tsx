"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

export interface AppNotification {
  id: string;
  title: string;
  detail?: string;
  time: Date;
  read: boolean;
  kind: "success" | "info" | "warning";
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  notify: (n: Omit<AppNotification, "id" | "time" | "read">) => void;
  markAllRead: () => void;
  clear: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/** Wrap the app once (see app/layout.tsx) so any component can call
 *  useNotifications().notify({...}) when something real happens —
 *  a document export finishing, the local AI model loading, a
 *  reconciliation run completing, etc. Nothing here is simulated or
 *  randomly generated; every notification maps to an actual event a
 *  component fired. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const notify = useCallback((n: Omit<AppNotification, "id" | "time" | "read">) => {
    setNotifications((prev) =>
      [{ ...n, id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: new Date(), read: false }, ...prev].slice(0, 30)
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clear = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, notify, markAllRead, clear }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Safe no-op fallback so a component doesn't crash if it's ever
    // rendered outside the provider (e.g. in isolation/tests).
    return {
      notifications: [],
      unreadCount: 0,
      notify: () => {},
      markAllRead: () => {},
      clear: () => {},
    } satisfies NotificationsContextValue;
  }
  return ctx;
}
