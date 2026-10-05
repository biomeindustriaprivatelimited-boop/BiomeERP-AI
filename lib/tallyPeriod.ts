"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The period every Tally screen reads (home Finance Command Center,
 * Ledgers, Customers, Payments, Reports, Analytics). One choice, shared by
 * all of them and remembered on this PC, so the figures on different pages
 * are always for the same period.
 *
 * The screen only sends From/To; the server (lib/tallyFinance.ts
 * resolvePeriod) validates and clamps them and says what it changed.
 */

export type TallyPeriodPreset =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-fy"
  | "last-fy"
  | "last-3-fys"
  | "books"
  | "custom";

export interface TallyPeriodChoice {
  preset: TallyPeriodPreset;
  /** Custom only: YYYY-MM-DD. */
  from?: string;
  to?: string;
}

export const PERIOD_PRESETS: { id: TallyPeriodPreset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "this-fy", label: "This FY" },
  { id: "last-fy", label: "Last FY" },
  { id: "last-3-fys", label: "Last 3 FYs" },
  { id: "books", label: "Since books beginning" },
  { id: "custom", label: "Custom from–to" },
];

const pad = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymd = (y: number, m: number, d: number) => isoLocal(new Date(y, m - 1, d));
const lastDay = (y: number, m: number) => isoLocal(new Date(y, m, 0));

/** From/To to send for a choice. `from: "books"` = the company's books
 *  beginning (the server knows it, the screen doesn't). */
export function periodDates(choice: TallyPeriodChoice, today = new Date()): { fromDate: string; toDate: string } {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const t = isoLocal(today);
  const fyY = m >= 4 ? y : y - 1; // FY starts 1 April
  switch (choice.preset) {
    case "this-month":
      return { fromDate: ymd(y, m, 1), toDate: t };
    case "last-month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { fromDate: ymd(py, pm, 1), toDate: lastDay(py, pm) };
    }
    case "this-quarter": {
      // Indian FY quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const qStart = m >= 4 ? Math.floor((m - 4) / 3) * 3 + 4 : 1;
      return { fromDate: ymd(y, qStart, 1), toDate: t };
    }
    case "last-fy":
      return { fromDate: `${fyY - 1}-04-01`, toDate: `${fyY}-03-31` };
    case "last-3-fys":
      return { fromDate: `${fyY - 3}-04-01`, toDate: `${fyY}-03-31` };
    case "books":
      return { fromDate: "books", toDate: t };
    case "custom":
      return {
        fromDate: choice.from || `${fyY}-04-01`,
        toDate: choice.to || t,
      };
    case "this-fy":
    default:
      return { fromDate: `${fyY}-04-01`, toDate: t };
  }
}

/** Checks a custom range before it is sent (the server checks again). */
export function validateCustom(from: string, to: string, today = new Date()): string | null {
  if (!from || !to) return "Pick both a From and a To date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Dates must be complete (DD-MM-YYYY).";
  if (from > to) return "The From date is after the To date.";
  if (from > isoLocal(today)) return "The From date is in the future.";
  return null;
}

const KEY = "biome:tallyPeriod";
const EVENT = "biome:tallyPeriod";
const DEFAULT: TallyPeriodChoice = { preset: "this-fy" };

function read(): TallyPeriodChoice {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw);
    if (v && PERIOD_PRESETS.some((p) => p.id === v.preset)) return v;
  } catch {
    /* private window / blocked storage */
  }
  return DEFAULT;
}

/** The shared period choice. Changing it on one screen changes it on all
 *  open screens (and is remembered on this PC). */
export function useTallyPeriod() {
  const [choice, setChoiceState] = useState<TallyPeriodChoice>(DEFAULT);
  useEffect(() => {
    setChoiceState(read());
    const on = () => setChoiceState(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const setChoice = useCallback((c: TallyPeriodChoice) => {
    setChoiceState(c);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { choice, setChoice, dates: periodDates(choice) };
}

/** What the server says the period is (lib/tallyFinance.ts TallyPeriod). */
export interface ResolvedPeriod {
  from: string;
  to: string;
  label?: string;
  range?: string;
  fy?: string;
  asOn?: string;
  openingOn?: string;
  fyCount?: number;
  notes?: string[];
}

export interface TallyProgressInfo {
  phase: "company" | "balances" | "vouchers";
  done: number;
  total: number;
  label: string;
}
