"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

/**
 * A page that throws while rendering used to leave the main area empty
 * with no clue. This shows what happened and a way back, and keeps the
 * sidebar and top bar working.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Page error:", error); }, [error]);
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-rose-400/30 bg-rose-500/[.06] p-6 text-center">
      <AlertTriangle size={26} className="mx-auto text-rose-500" />
      <p className="mt-2 text-[15px] font-semibold text-biome-text">This screen hit a problem</p>
      <p className="mt-1 text-[12px] text-biome-muted">{error?.message || "Something went wrong while showing this page."}</p>
      {error?.digest && <p className="mt-1 font-mono text-[10px] text-biome-muted">ref {error.digest}</p>}
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={() => reset()} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[12px] font-bold text-white"><RotateCcw size={13} /> Try again</button>
        <button onClick={() => { location.href = "/"; }} className="flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2 text-[12px] text-biome-text"><Home size={13} /> Home</button>
      </div>
    </div>
  );
}
