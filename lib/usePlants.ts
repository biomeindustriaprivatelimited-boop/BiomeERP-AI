"use client";
import { useEffect, useState } from "react";
import { PLANTS } from "@/lib/permissions";

/**
 * Plants for pickers, from the plant master (so a plant the developer adds
 * appears everywhere). Falls back to the two original plants until loaded.
 */
let cache: { code: string; label: string }[] | null = null;
export function usePlants(): { code: string; label: string }[] {
  const [list, setList] = useState(cache || PLANTS);
  useEffect(() => {
    if (cache) return;
    fetch("/api/plants", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.plants?.length) { cache = j.plants; setList(j.plants); }
    }).catch(() => {});
  }, []);
  return list;
}
