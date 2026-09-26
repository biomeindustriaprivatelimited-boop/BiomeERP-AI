import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadTrips, saveTrips, loadEditRequests, saveEditRequests,
  lockStateFor, EditRequest, EDIT_WINDOW_HOURS,
} from "@/lib/coordination";
import { recordAudit } from "@/lib/audit";

/**
 * Unfreezing one row, once, with a name against it.
 *
 * A frozen entry is not read-only forever — a genuine correction has to be
 * possible or people will keep a private spreadsheet, which is worse than
 * an edited row. What it must not be is quiet. So: the coordinator says
 * what they want to change and why, an admin decides, and the approval
 * opens that ONE row for a limited time. Every step lands in the audit log.
 *
 * The approval deliberately expires. An open-ended unlock is a permanently
 * unlocked row that nobody remembers granting.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canDecide(role: string): boolean {
  // Same rule as everywhere else in this app: the person who decides is
  // not the person who asked, and here that means admin.
  return hasPermission(role as any, "users");
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const all = loadEditRequests();
  const mine = canDecide(user.role) ? all : all.filter((r) => r.requestedBy === user.id);

  return NextResponse.json({
    requests: [...mine].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 200),
    pending: mine.filter((r) => r.status === "pending").length,
    canDecide: canDecide(user.role),
    windowHours: EDIT_WINDOW_HOURS,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const tripId = String(body?.tripId ?? "");
  const reason = String(body?.reason ?? "").trim().slice(0, 600);
  const fields = String(body?.fields ?? "").trim().slice(0, 300);

  if (!tripId) return NextResponse.json({ error: "Which trip?" }, { status: 400 });
  if (reason.length < 10) {
    return NextResponse.json(
      { error: "Say what needs changing and why — an admin approving a blank request is not approving anything." },
      { status: 400 }
    );
  }

  const trip = loadTrips().find((t) => t.id === tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const lock = lockStateFor(trip);
  if (!lock.locked) {
    return NextResponse.json({ error: "This row is still open — you can edit it directly." }, { status: 400 });
  }

  const requests = loadEditRequests();
  const already = requests.find((r) => r.tripId === tripId && r.status === "pending");
  if (already) {
    return NextResponse.json(
      { error: `${already.requestedByName} already has a request pending on this row.` },
      { status: 409 }
    );
  }

  const request: EditRequest = {
    id: crypto.randomUUID(),
    tripId,
    tripSerial: trip.serial,
    tripLabel: `${trip.supplier || "BIOME"} → ${trip.client || "?"} · ${trip.vehicleNumber || "no vehicle"}${
      trip.ourDocNo ? ` · ${trip.ourDocNo}` : ""
    }`,
    reason,
    fields,
    requestedBy: user.id,
    requestedByName: user.name,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };

  saveEditRequests([request, ...requests]);

  recordAudit({
    action: "COORDINATION_EDIT_REQUESTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "trip", targetId: tripId, targetLabel: `#${trip.serial} ${trip.vehicleNumber}`,
    detail: `${fields ? `${fields}: ` : ""}${reason}`,
  });

  return NextResponse.json({ request }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canDecide(user.role)) {
    return NextResponse.json({ error: "Only an admin can decide an edit request." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const approve = body?.approve === true;
  const note = String(body?.note ?? "").trim().slice(0, 600);
  if (!id) return NextResponse.json({ error: "Which request?" }, { status: 400 });

  const requests = loadEditRequests();
  const index = requests.findIndex((r) => r.id === id);
  if (index === -1) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  if (requests[index].status !== "pending") {
    return NextResponse.json({ error: "That request has already been decided." }, { status: 409 });
  }
  if (!approve && !note) {
    return NextResponse.json({ error: "Give a reason for turning it down." }, { status: 400 });
  }

  const request = requests[index];
  // Nobody approves their own — the same rule imprest and leave already run
  // on, and the reason it exists is that the person who made the mistake is
  // the person who most wants it unmade quietly.
  if (request.requestedBy === user.id) {
    return NextResponse.json(
      { error: "You raised this request — another admin has to decide it." },
      { status: 403 }
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EDIT_WINDOW_HOURS * 3600000).toISOString();

  requests[index] = {
    ...request,
    status: approve ? "approved" : "rejected",
    decidedBy: user.id,
    decidedByName: user.name,
    decidedAt: now.toISOString(),
    decisionNote: note,
    expiresAt: approve ? expiresAt : undefined,
  };
  saveEditRequests(requests);

  if (approve) {
    const trips = loadTrips();
    const t = trips.find((x) => x.id === request.tripId);
    if (t) {
      t.editGrant = {
        approvedBy: user.id,
        approvedByName: user.name,
        approvedAt: now.toISOString(),
        expiresAt,
        reason: request.reason,
        requestId: request.id,
      };
      saveTrips(trips);
    }
  }

  recordAudit({
    action: approve ? "COORDINATION_EDIT_APPROVED" : "COORDINATION_EDIT_REJECTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "trip", targetId: request.tripId, targetLabel: `#${request.tripSerial}`,
    detail: approve
      ? `Opened for ${request.requestedByName} until ${expiresAt}. ${request.reason}`
      : `Refused: ${note}`,
  });

  return NextResponse.json({ request: requests[index] });
}
