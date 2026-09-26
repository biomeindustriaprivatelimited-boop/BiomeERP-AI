/*
 * Biome AI ERP — service worker.
 *
 * What it is for: the phone app must open instantly at a plant gate with
 * one bar of signal, and must not show a browser error page when the
 * signal drops mid-shift.
 *
 * What it deliberately does NOT do: cache any API response. Imprest
 * floats, attendance and supply data must always come from the server —
 * a stale balance is worse than no balance. Only the application shell
 * (HTML, JS, CSS, icons, fonts) is cached.
 */

const VERSION = "biome-v3";
const SHELL = `${VERSION}-shell`;

// The screens a field user opens first. Pre-cached so the first tap after
// install is instant even before the network answers.
const PRECACHE = [
  "/m",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // One bad URL must not fail the whole install.
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve business data from a cache. Every /api call goes to the
  // network, and a failure is reported honestly rather than papered over
  // with yesterday's numbers.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first so the user always gets the current build,
  // falling back to the cached shell, and finally to a plain offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/offline") || caches.match("/m"))
        )
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icons/"))) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
