import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadTrips, type Trip } from "@/lib/coordination";
import { docsForTrip, filePathFor, loadAgentDocs } from "@/lib/tripDocs";
import { agentFetch } from "@/lib/whatsappAgent";

/**
 * WhatsApp documents linked to coordination trips.
 *
 *   ?tripId=…                 documents (category-wise), missing papers, notices
 *   ?tripId=…&docId=…         the file itself — only if it is linked to that trip
 *   ?summary=1&business=…     per-trip counts for the register's badges
 *   POST {action:"sweep"}     ask the agent to file waiting vendor papers now
 *
 * Needs `coordination`; a plant manager only ever reaches trips of their own
 * site (same rule as the register).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function visibleTrip(trip: Trip | undefined, role: string, plant: string | null): boolean {
  if (!trip) return false;
  if (role === "plant_manager") return trip.business === "manufacturing" && (!plant || (trip.location || "").toUpperCase().includes(plant.toUpperCase()));
  return true;
}

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const q = req.nextUrl.searchParams;
  const trips = loadTrips();

  if (q.get("summary")) {
    const business = q.get("business") === "manufacturing" ? "manufacturing" : "trading";
    const all = loadAgentDocs();
    const out: Record<string, { docs: number; warnings: number; missing: number }> = {};
    for (const t of trips.filter((x) => x.business === business && visibleTrip(x, user.role, auth.session.plant))) {
      const r = docsForTrip(t, all);
      out[t.id] = { docs: r.docs.length, warnings: r.notices.filter((n) => n.level === "warning").length, missing: r.missing.length };
    }
    return NextResponse.json({ summary: out });
  }

  const trip = trips.find((t) => t.id === q.get("tripId"));
  if (!visibleTrip(trip, user.role, auth.session.plant)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const docId = q.get("docId");
  if (docId) {
    const f = filePathFor(trip!, docId);
    if (!f) return NextResponse.json({ error: "That document is not linked to this supply." }, { status: 404 });
    const bytes = fs.readFileSync(f.filePath);
    const ext = path.extname(f.fileName || f.filePath).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(f.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(docsForTrip(trip!));
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (body?.action === "sweep") {
    try {
      const res = await agentFetch("/staged/sweep", { method: "POST" });
      return NextResponse.json(await res.json().catch(() => ({})));
    } catch {
      return NextResponse.json({ ok: false, note: "WhatsApp agent is not running — documents already read are still linked here." });
    }
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
