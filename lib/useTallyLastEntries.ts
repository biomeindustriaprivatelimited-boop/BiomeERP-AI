"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTallySettings } from "@/lib/preferences";
import { postTallyStream } from "@/lib/tallyClient";

/**
 * Date of the last voucher behind each Tally figure, for the shared period
 * (/api/tally/last-entries, lib/tallyLedgerActivity.ts). Read separately
 * from the balances, so the figures never wait for it.
 *
 *   kpis.cashInHand / bankBalance / receivables / payables / sales /
 *   purchases / taxLiability / expenses … -> "YYYY-MM-DD" | null
 *   ledgers["HDFC Bank"] -> "YYYY-MM-DD"   (scope "ledgers")
 */
export interface TallyLastEntries {
  kpis: Record<string, string | null>;
  ledgers: Record<string, string>;
  complete: boolean;
  error: string | null;
  period?: { from: string; to: string; label: string };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-07" -> "07-Oct-2026" (Tally's own style). */
export function prettyIso(d: string | null | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  return `${d.slice(8, 10)}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
}

export function useTallyLastEntries(opts: {
  fromDate: string;
  toDate: string;
  scope?: "summary" | "ledgers";
  /** Wait (e.g. until the balances are on screen). */
  enabled?: boolean;
}) {
  const { fromDate, toDate, scope = "summary", enabled = true } = opts;
  const [data, setData] = useState<TallyLastEntries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (fresh: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const s = getTallySettings();
        const { ok, status, json } = await postTallyStream<TallyLastEntries>(
          "/api/tally/last-entries",
          {
            mode: s.mode,
            host: s.host,
            port: s.port,
            agentUrl: s.agentUrl,
            agentApiKey: s.agentApiKey,
            company: s.companyName,
            fromDate,
            toDate,
            scope,
            fresh,
          },
          { signal: ctrl.signal }
        );
        if (ctrl.signal.aborted) return;
        if (!ok) throw new Error(json.error || `Last-entry dates couldn't be read (${status}).`);
        setData({ kpis: json.kpis || {}, ledgers: json.ledgers || {}, complete: json.complete !== false, error: json.error ?? null, period: json.period });
      } catch (err) {
        if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        if (abortRef.current === ctrl) setLoading(false);
      }
    },
    [fromDate, toDate, scope]
  );

  // Set by markFresh() before a page-wide Refresh, so the next automatic
  // read (when the balances come back) skips the cache too.
  const freshNext = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const fresh = freshNext.current;
    freshNext.current = false;
    load(fresh);
    return () => abortRef.current?.abort();
  }, [load, enabled]);

  const reload = useCallback((fresh?: unknown) => load(fresh !== false), [load]);
  const markFresh = useCallback(() => {
    freshNext.current = true;
  }, []);
  return { data, loading, error, reload, markFresh };
}
