"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet, CalendarCheck, Truck, ListChecks, Loader2, LogOut,
  CheckCircle2, ScanLine, FileText, ChevronRight, AlertCircle,
} from "lucide-react";
import { useSession } from "@/lib/session";
import BiomeLogo from "@/components/brand/BiomeLogo";

/**
 * THE PHONE HOME.
 *
 * Everything here is chosen by what the signed-in person may actually
 * open. The previous version linked to Issues, Forms and the Work planner
 * for everyone; those became developer-only, so a plant manager tapping
 * them got a permission wall. A tile that cannot be opened is worse than
 * no tile, so the list is now built from the session's own permissions.
 *
 * Receiving confirmation stays on this screen rather than behind a tile:
 * it is the one thing a plant manager does at the gate with one hand.
 */
export default function MobileHome() {
  const { user, signOut, can } = useSession();
  const [rx, setRx] = useState({ vehicle: "", qty: "", date: new Date().toISOString().slice(0, 10) });
  const [rxMsg, setRxMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  const confirmReceiving = useCallback(async () => {
    setBusy(true); setRxMsg(null);
    try {
      const plate = rx.vehicle.replace(/\s/g, "").toUpperCase();
      if (!plate) throw new Error("Which vehicle?");
      if (!Number(rx.qty)) throw new Error("Enter the received weight.");

      // A coordinator's book is trading; admin and accounts see both, so
      // look in trading first and then manufacturing.
      const registers = user?.role === "coordinator" ? ["trading"] : ["trading", "manufacturing"];
      let pool: any[] = [];
      for (const reg of registers) {
        const r = await fetch(`/api/coordination?business=${reg}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok) pool = pool.concat(j.trips || []);
      }

      const trip = pool
        .filter((t: any) => String(t.vehicleNumber || "").replace(/\s/g, "").toUpperCase() === plate && !t.receivingQty)
        .sort((a: any, b: any) => String(b.vehicleEntryDate).localeCompare(String(a.vehicleEntryDate)))[0];
      if (!trip) throw new Error(`No open trip for ${rx.vehicle}. Check the number, or it may already be received.`);

      const put = await fetch("/api/coordination", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...trip, id: trip.id, receivingQty: Number(rx.qty), receivingDate: rx.date, status: "received" }),
      });
      const pj = await put.json().catch(() => ({}));
      if (!put.ok) throw new Error(pj.error || "Could not save the receiving.");

      setRxMsg({ ok: true, text: `Saved — ${trip.vehicleNumber} → ${trip.client}, ${Number(rx.qty).toLocaleString("en-IN")} kg.` });
      setRx({ vehicle: "", qty: "", date: rx.date });
    } catch (e) {
      setRxMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [rx]);

  // Only what this person can open. Each tile names the job, not the module.
  const tiles = [
    { href: "/m/imprest", label: "Imprest", sub: "File an expense, see your float", icon: <Wallet size={20} />, show: can("imprest.entry") || can("imprest.view") },
    { href: "/attendance", label: "Attendance", sub: "Mark today for your site", icon: <CalendarCheck size={20} />, show: can("attendance.entry") },
    { href: "/coordination", label: "Supply register", sub: "Trips, weights, receivings", icon: <Truck size={20} />, show: can("coordination") },
    { href: "/ocr", label: "Scan a document", icon: <ScanLine size={20} />, sub: "Photograph it, read it, export it", show: can("ocr") },
    { href: "/documents", label: "Documents", sub: "Search what has been filed", icon: <FileText size={20} />, show: can("documents") },
    { href: "/po", label: "PO balances", sub: "What is left on each order", icon: <ListChecks size={20} />, show: can("operations") },
  ].filter((t) => t.show);

  // Receiving is written into the supply register, which only people with
  // the coordination permission may change. Showing the form to anyone else
  // would only end in a refusal.
  const canReceive = can("coordination");

  return (
    <main className="min-h-screen bg-biome-bg pb-10">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-10 border-b border-biome-line bg-biome-bgSoft/95 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <BiomeLogo size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold leading-tight text-biome-text">
              {user?.name || "Biome"}
            </p>
            <p className="truncate text-[10.5px] text-biome-muted">
              {user?.designation || user?.role?.replace("_", " ")}
              {user?.plants?.length ? ` · ${user.plants.join(", ")}` : ""}
            </p>
          </div>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-biome-line text-biome-muted"
          >
            <LogOut size={15} />
          </button>
        </div>
        {!online && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/12 px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-600">
            <AlertCircle size={12} /> No signal — nothing can be filed until it returns.
          </p>
        )}
      </header>

      {/* ---- Receiving: the one-handed job at the gate ---- */}
      {canReceive && (
        <section className="mx-4 mt-4 rounded-3xl border border-biome-line bg-biome-bgSoft p-4">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-biome-leafBright">
            <Truck size={14} /> Confirm a receiving
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
            Type the vehicle number and the weight on the kanta. The open trip for that vehicle is
            found for you.
          </p>
          <input
            value={rx.vehicle}
            onChange={(e) => setRx({ ...rx, vehicle: e.target.value.toUpperCase() })}
            placeholder="HR 63 E 2262"
            inputMode="text"
            autoCapitalize="characters"
            className="mt-3 w-full rounded-2xl border border-biome-line bg-biome-surface px-4 py-3.5 text-[15px] font-semibold tracking-wide text-biome-text"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={rx.qty}
              onChange={(e) => setRx({ ...rx, qty: e.target.value })}
              placeholder="Net kg"
              inputMode="numeric"
              className="rounded-2xl border border-biome-line bg-biome-surface px-4 py-3.5 text-[15px] font-semibold text-biome-text"
            />
            <input
              type="date"
              value={rx.date}
              onChange={(e) => setRx({ ...rx, date: e.target.value })}
              className="rounded-2xl border border-biome-line bg-biome-surface px-3 py-3.5 text-[13px] text-biome-text"
            />
          </div>
          <button
            onClick={confirmReceiving}
            disabled={busy || !online}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-biome-leaf px-4 py-3.5 text-[13px] font-bold text-white disabled:opacity-55"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {busy ? "Saving…" : "Save receiving"}
          </button>
          {rxMsg && (
            <p className={`mt-2 text-[11.5px] leading-relaxed ${rxMsg.ok ? "text-biome-leafBright" : "text-rose-500"}`}>
              {rxMsg.text}
            </p>
          )}
        </section>
      )}

      {/* ---- What this person can open ---- */}
      <section className="mx-4 mt-5 space-y-2">
        <p className="px-1 text-[10px] font-bold uppercase tracking-[.16em] text-biome-muted">Your work</p>
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3.5 active:scale-[.985]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-biome-leaf/12 text-biome-leafBright">
              {t.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold text-biome-text">{t.label}</span>
              <span className="block truncate text-[11px] text-biome-muted">{t.sub}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-biome-muted" />
          </Link>
        ))}
        {tiles.length === 0 && (
          <p className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-5 text-center text-[11.5px] text-biome-muted">
            Nothing is assigned to this account yet. Ask the admin to grant what you need.
          </p>
        )}
      </section>

      <p className="mt-6 px-6 text-center text-[10px] leading-relaxed text-biome-muted">
        Biome AI ERP · the same account works on the phone, the desktop app and the browser. Anything
        you file here appears on every device at once.
      </p>
    </main>
  );
}
