import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadTrips, derivedStatus } from "@/lib/coordination";
import { loadPlants } from "@/lib/plants";
import { computeAll } from "@/lib/po";
import { loadWork } from "@/lib/work";

/** Business Digital Twin — nodes and edges from live records. */
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work"); if ("response" in auth) return auth.response;
  let trips: ReturnType<typeof loadTrips> = []; try { trips = loadTrips(); } catch { /* none */ }
  const nodes = new Map<string, { id: string; type: string; label: string; count: number; alert: boolean }>();
  const edges: { from: string; to: string; kind: string; weight: number; status: string }[] = [];
  const add = (type: string, label: string, alert = false) => { const id = `${type}:${label}`; const n = nodes.get(id) || { id, type, label, count: 0, alert: false }; n.count += 1; n.alert = n.alert || alert; nodes.set(id, n); return id; };
  try { for (const p of loadPlants().filter((p) => p.active)) add("plant", p.label); } catch { /* none */ }
  const openTitles = loadWork().tasks.filter((t) => t.status === "open").map((t) => t.title.toLowerCase());
  for (const t of trips.slice(-300)) {
    let status = "planned"; try { status = derivedStatus(t); } catch { /* keep */ }
    const v = t.supplier || t.supplierCode; const c = t.client; const veh = t.vehicleNumber;
    if (!v || !c) continue;
    const vId = add("vendor", v, openTitles.some((x) => x.includes(v.toLowerCase()))); const cId = add("client", c, openTitles.some((x) => x.includes(c.toLowerCase())));
    const sId = add("supply", t.ourDocNo || t.id.slice(0, 8), status === "shortage");
    edges.push({ from: vId, to: sId, kind: "supplies", weight: Number(t.vendorChallanWeight) || 0, status });
    edges.push({ from: sId, to: cId, kind: "delivered to", weight: Number(t.receivingQty) || 0, status });
    if (veh) { const vehId = add("vehicle", veh); edges.push({ from: vehId, to: sId, kind: "carried", weight: 0, status }); }
  }
  for (const p of computeAll().pos) { const pid = add("po", `${p.poNumber}`, p.effectiveStatus === "exhausted" || p.effectiveStatus === "low_balance"); edges.push({ from: pid, to: `${p.type}:${p.partyName}`, kind: "PO for", weight: p.remainingKg, status: p.effectiveStatus }); }
  return NextResponse.json({ nodes: [...nodes.values()], edges });
}
