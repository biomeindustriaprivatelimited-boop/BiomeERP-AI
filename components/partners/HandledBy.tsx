"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";

/**
 * "Handled by" next to a vendor / client wherever it appears outside
 * Registration (Coordination rows, the 360° page). One thin lookup per
 * screen from /api/partners/responsible — same visibility rules as
 * Registration, so nobody learns about a record they could not open.
 */

interface Entry {
  id: string; kind: string; name: string; legalName: string; shortName: string; code: string; aliases: string[];
  responsibleUserId: string; responsibleName: string; backupName: string; team: string;
}
export interface ResponsibleLookup {
  find: (nameOrCode: string, kind: "vendor" | "client") => Entry | null;
  teamLabel: (id: string) => string;
}

const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let cache: Promise<{ entries: Entry[]; teams: { id: string; label: string }[] }> | null = null;
let cachedAt = 0;

function fetchOnce() {
  if (!cache || Date.now() - cachedAt > 60_000) {
    cachedAt = Date.now();
    cache = fetch("/api/partners/responsible", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { entries: [], teams: [] }))
      .catch(() => ({ entries: [], teams: [] }));
  }
  return cache;
}

export function useResponsibleLookup(): ResponsibleLookup | null {
  const [data, setData] = useState<{ entries: Entry[]; teams: { id: string; label: string }[] } | null>(null);
  useEffect(() => { let on = true; fetchOnce().then((d) => { if (on) setData({ entries: d.entries || [], teams: d.teams || [] }); }); return () => { on = false; }; }, []);
  if (!data) return null;
  return {
    teamLabel: (id) => data.teams.find((t) => t.id === id)?.label || "",
    find: (nameOrCode, kind) => {
      const k = key(nameOrCode);
      if (!k) return null;
      const pool = data.entries.filter((e) => (kind === "client" ? e.kind === "client" : e.kind !== "client"));
      return (
        pool.find((e) => e.code && key(e.code) === k) ||
        pool.find((e) => key(e.name) === k) ||
        pool.find((e) => [e.legalName, e.shortName, ...(e.aliases || [])].some((x) => x && key(x) === k)) ||
        null
      );
    },
  };
}

/** Small chip: "👤 Ravi · Coordination". Renders nothing when unknown/unassigned. */
export function HandledBy({ lookup, name, kind, label }: { lookup: ResponsibleLookup | null; name: string | (string | undefined)[]; kind: "vendor" | "client"; label?: string }) {
  const tries = (Array.isArray(name) ? name : [name]).filter(Boolean) as string[];
  let e: ReturnType<ResponsibleLookup["find"]> = null;
  for (const n of tries) { e = lookup?.find(n, kind) || null; if (e) break; }
  if (!e || !e.responsibleName) return null;
  const team = e.team ? lookup!.teamLabel(e.team) : "";
  return (
    <span title={`${label || (kind === "client" ? "Client" : "Vendor")} ${e.name} is handled by ${e.responsibleName}${team ? ` (${team})` : ""}${e.backupName ? ` · backup ${e.backupName}` : ""}`}
      data-testid="handled-by" data-kind={kind}
      className="inline-flex items-center gap-1 rounded-full border border-biome-line bg-biome-bg px-1.5 py-0.5 text-[9px] font-semibold text-biome-muted">
      <UserRound size={9} /> {label ? `${label}: ` : ""}{e.responsibleName}{team ? ` · ${team}` : ""}
    </span>
  );
}
