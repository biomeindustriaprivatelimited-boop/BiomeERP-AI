"use client";

/**
 * Biome Platform — what this device does when its account is disabled
 * -------------------------------------------------------------------
 * When an employee resigns or is terminated, the admin disables the
 * account in Users. From then on the server answers every request made
 * with that person's session with 401 + `x-biome-account: disabled`
 * (body code ACCOUNT_DISABLED) — see lib/authServer.ts.
 *
 * This file is the browser side of that answer (web, the Android app's
 * WebView, and the desktop app's window): it wipes THIS APP'S OWN storage
 * on this device — localStorage, sessionStorage, IndexedDB, Cache Storage
 * and service workers — and shows the login screen with
 * "This account has been disabled by the administrator."
 *
 * It never touches anything outside the app's own storage, and it never
 * reaches the server's data folder: the server keeps all company data.
 * The desktop shell (electron/main.js) additionally clears its cookies and
 * HTTP cache for the app when it sees the same signal.
 *
 * An ordinary "please sign in" (expired session) or a network error does
 * NOT trigger any of this — only the explicit disabled signal does.
 */

export const ACCOUNT_DISABLED_CODE = "ACCOUNT_DISABLED";
export const ACCOUNT_DISABLED_TEXT = "This account has been disabled by the administrator.";

let wiping = false;

/** Clears this app's own browser storage on this device. */
export async function wipeLocalAppData(): Promise<void> {
  try { localStorage.clear(); } catch { /* no storage */ }
  try { sessionStorage.clear(); } catch { /* no storage */ }
  try {
    const idb: any = typeof indexedDB !== "undefined" ? indexedDB : null;
    if (idb && typeof idb.databases === "function") {
      const dbs: { name?: string }[] = await idb.databases();
      await Promise.all(
        dbs.filter((d) => d.name).map(
          (d) => new Promise<void>((resolve) => {
            try {
              const r = idb.deleteDatabase(d.name);
              r.onsuccess = r.onerror = r.onblocked = () => resolve();
            } catch { resolve(); }
          })
        )
      );
    }
  } catch { /* not supported */ }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* not supported */ }
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* not supported */ }
}

/** Wipe, tell the desktop shell, and land on the login screen with the reason. */
export async function handleAccountDisabled(): Promise<void> {
  if (wiping || typeof window === "undefined") return;
  wiping = true;
  await wipeLocalAppData();
  try {
    const desk = (window as any).biomeDesktop;
    // The desktop shell clears cookies + HTTP cache and loads the login page.
    if (desk?.accountDisabled) {
      await desk.accountDisabled();
      return;
    }
  } catch { /* fall through to the plain redirect */ }
  window.location.replace("/login?disabled=1");
}

/** True when a response is the server's "this account is disabled" answer. */
export function isAccountDisabledResponse(res: Response): boolean {
  return (res.status === 401 || res.status === 403) && res.headers.get("x-biome-account") === "disabled";
}

/**
 * Watches every fetch the app makes for the disabled signal. Installed
 * once, as early as the client bundle loads (lib/session.tsx imports it).
 */
export function installAccountGuard(): void {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (w.__biomeAccountGuard) return;
  w.__biomeAccountGuard = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    try {
      if (isAccountDisabledResponse(res)) {
        // On the login page itself, the message is shown there; still wipe.
        void handleAccountDisabled();
      }
    } catch { /* never break the caller */ }
    return res;
  };
}
