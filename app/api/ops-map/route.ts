import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadTrips, derivedStatus } from "@/lib/coordination";
import { loadPlants } from "@/lib/plants";
import { paths, readJson } from "@/lib/dataRoot";
import { daysBetween, today } from "@/lib/work";

/**
 * Live operations board — schematic, not GPS.
 * Nodes: our plants and the clients. Edges: trips in motion (dispatched,
 * no receiving yet) with an ETA from the typical entry→receiving time for
 * that client, and a delay flag past 3 days. Honest by design: the
 * business does not track vehicle GPS, so this shows what the paperwork
 * proves, not where a truck is on the road.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  let trips: ReturnType<typeof loadTrips> = [];
  try { trips = loadTrips(); } catch { /* none */ }
  const t0 = today();

  const clients = (() => { try { return (readJson<{ clients: { name: string }[] }>(paths.clientsFile, { clients: [] }).clients || []).map((c) => c.name); } catch { return [] as string[]; } })();
  const plants = (() => { try { return loadPlants().filter((p) => p.active).map((p) => ({ code: p.code, label: p.label })); } catch { return [] as { code: string; label: string }[]; } })();

  // Typical transit per client from history.
  const typical = new Map<string, number>();
  for (const c of new Set(trips.map((t) => t.client))) {
    const ds = trips.filter((t) => t.client === c && t.vehicleEntryDate && t.receivingDate).map((t) => daysBetween(t.vehicleEntryDate, t.receivingDate));
    typical.set(c, ds.length ? Math.max(1, Math.round(ds.reduce((a, b) => a + b, 0) / ds.length)) : 2);
  }

  const moving = trips.filter((t) => { try { return derivedStatus(t) === "dispatched"; } catch { return false; } }).map((t) => {
    const from = t.supplier || t.supplierCode || "Vendor";
    const days = t.vehicleEntryDate ? daysBetween(t.vehicleEntryDate, t0) : 0;
    const eta = typical.get(t.client) || 2;
    return { id: t.id, vehicle: t.vehicleNumber, from, to: t.client, dispatched: t.vehicleEntryDate, daysOut: days, etaDays: eta, delayed: days > Math.max(3, eta), weightKg: Number(t.vendorChallanWeight) || 0, docNo: t.ourDocNo };
  });

  const recent = trips.filter((t) => t.receivingDate && daysBetween(t.receivingDate, t0) <= 7).length;
  const clientSet = new Set([...clients, ...trips.map((t) => t.client)].filter(Boolean));
  const vendorSet = new Set(moving.map((m) => m.from));
  return NextResponse.json({
    plants, clients: [...clientSet], vendors: [...vendorSet], moving,
    stats: { inTransit: moving.length, delayed: moving.filter((m) => m.delayed).length, receivedLast7d: recent },
  });
}
