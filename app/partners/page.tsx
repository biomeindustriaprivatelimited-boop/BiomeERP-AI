"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * The old combined "Vendor & client registration" address. Registration
 * is now two pages — Vendor registration and Client registration. Old
 * links (Work tasks, the entity page, bookmarks) still land in the right
 * one: ?kind=client / ?tab=clients open the clients page, everything else
 * the vendors page. Any ?id= / ?partnerId= is carried over; for a known id
 * the right page is looked up.
 */
export default function PartnersRedirect() {
  const router = useRouter();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("id") || q.get("partnerId");
    const go = (clients: boolean) => router.replace(`/partners/${clients ? "clients" : "vendors"}${q.toString() ? `?${q}` : ""}`);
    if (q.get("kind") === "client" || q.get("tab") === "clients") return go(true);
    if (!id) return go(false);
    fetch("/api/partners", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => go(((j.partners || []) as any[]).some((p) => p.id === id && p.kind === "client")))
      .catch(() => go(false));
  }, [router]);
  return (
    <p className="flex items-center gap-2 py-16 text-[12px] text-biome-muted">
      <Loader2 size={14} className="animate-spin" /> Opening registration…
    </p>
  );
}
