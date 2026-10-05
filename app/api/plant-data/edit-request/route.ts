import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { resolvePlantScope, slugToCode } from "@/lib/plantScope";
import { recordAudit } from "@/lib/audit";
import { sheetPlant, allSlugs } from "@/lib/plantRegistry";
import { lockInfo, UNLOCK_HOURS, fmtDateTime } from "@/lib/sheetLock";
import {
  readRows, writeRows, rowLabel, isEntryRole, canUnlock, approversFor, noticeTo,
  loadSheetRequests, saveSheetRequests, type SheetEditRequest, type SheetKind,
} from "@/lib/plantSheetStore";

/**
 * Asking to change a frozen plant-sheet row, and deciding.
 *
 *   GET   the requests this person may see — an approver (plant.unlock):
 *         every plant they can read; a plant manager: their own.
 *   POST  { kind, plant, rowId, reason }  — the plant manager asks.
 *   PUT   { id, approve, note }           — an approver decides. Approval
 *         opens THAT row for UNLOCK_HOURS, or until it is submitted again.
 *
 * Every step is audited and the other side gets an in-app notice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plantName(slug: string) {
  return sheetPlant(slug)?.name || slug;
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const scoped = await resolvePlantScope(req, null);
  if ("response" in scoped) return scoped.response;

  const approver = canUnlock(user);
  const visiblePlants = scoped.scope.unrestricted ? allSlugs() : [scoped.scope.slug];
  const all = loadSheetRequests().filter((r) => visiblePlants.includes(r.plant));
  const list = approver ? all : all.filter((r) => r.requestedBy === user.id);
  return NextResponse.json({
    requests: list.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 300)
      .map((r) => ({ ...r, plantName: plantName(r.plant) })),
    pending: list.filter((r) => r.status === "pending").length,
    canDecide: approver,
    meId: user.id,
    unlockHours: UNLOCK_HOURS,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  const scoped = await resolvePlantScope(req, body?.plant);
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;
  if (!isEntryRole(user.role)) {
    return NextResponse.json({ error: "Only the plant manager asks to edit the plant's rows." }, { status: 403 });
  }

  const kind: SheetKind = body?.kind === "transport" ? "transport" : "biomass";
  const rowId = String(body?.rowId ?? "");
  const reason = String(body?.reason ?? "").trim().slice(0, 600);
  if (!rowId) return NextResponse.json({ error: "Which row?" }, { status: 400 });
  if (reason.length < 10) {
    return NextResponse.json({ error: "Say what needs changing and why (at least a short sentence)." }, { status: 400 });
  }

  const row = readRows(kind, plant).find((r) => String(r.id) === rowId);
  if (!row) return NextResponse.json({ error: "That row no longer exists." }, { status: 404 });
  const lock = lockInfo(row);
  if (lock.state !== "frozen") {
    return NextResponse.json({ error: lock.state === "unlocked" ? "This row is already unlocked — edit it, then submit it again." : "This row is not frozen — you can edit it directly." }, { status: 400 });
  }

  const requests = loadSheetRequests();
  const already = requests.find((r) => r.rowId === rowId && r.plant === plant && r.kind === kind && r.status === "pending");
  if (already) {
    return NextResponse.json({ error: `${already.requestedByName} already asked to edit this row — waiting for approval.` }, { status: 409 });
  }

  const label = rowLabel(kind, row);
  const request: SheetEditRequest = {
    id: crypto.randomUUID(),
    plant, kind, rowId, rowLabel: label, reason,
    requestedBy: user.id, requestedByName: user.name,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };
  saveSheetRequests([request, ...requests]);

  recordAudit({
    action: "SHEET_EDIT_REQUESTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: `${kind}-row`, targetId: rowId, targetLabel: label,
    detail: reason, plant,
  });

  const sheet = kind === "transport" ? "Transport" : "Biomass";
  noticeTo(
    approversFor(plant).map((u) => u.id).filter((id) => id !== user.id),
    {
      kind: "warning",
      title: `Edit request — ${plantName(plant)} ${sheet} sheet`,
      body: `${user.name} asks to edit a frozen row: ${label}.\nReason: ${reason}\nOpen the ${sheet} sheet → Edit requests to approve or reject.`,
      by: { id: user.id, name: user.name },
    }
  );

  return NextResponse.json({ request }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canUnlock(user)) {
    return NextResponse.json({ error: "Only accounts, admin or the developer can decide an edit request." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const approve = body?.approve === true;
  const note = String(body?.note ?? "").trim().slice(0, 600);
  if (!id) return NextResponse.json({ error: "Which request?" }, { status: 400 });

  const requests = loadSheetRequests();
  const index = requests.findIndex((r) => r.id === id);
  if (index === -1) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  const request = requests[index];

  // The approver must be able to read that plant.
  const scoped = await resolvePlantScope(req, request.plant);
  if ("response" in scoped) return scoped.response;
  if (scoped.scope.slug !== request.plant) {
    return NextResponse.json({ error: "That request is for a plant you do not look after." }, { status: 403 });
  }
  if (request.status !== "pending") return NextResponse.json({ error: "That request has already been decided." }, { status: 409 });
  if (!approve && !note) return NextResponse.json({ error: "Give a reason for turning it down." }, { status: 400 });
  if (request.requestedBy === user.id) {
    return NextResponse.json({ error: "You raised this request — someone else has to decide it." }, { status: 403 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + UNLOCK_HOURS * 3600000).toISOString();

  if (approve) {
    const rows = readRows(request.kind, request.plant);
    const row = rows.find((r) => String(r.id) === request.rowId);
    if (!row) {
      requests[index] = { ...request, status: "rejected", decidedBy: user.id, decidedByName: user.name, decidedAt: now.toISOString(), decisionNote: "The row no longer exists." };
      saveSheetRequests(requests);
      return NextResponse.json({ error: "That row no longer exists — the request was closed." }, { status: 404 });
    }
    row.unlock = {
      until: expiresAt, by: user.id, byName: user.name, at: now.toISOString(),
      requestId: request.id, reason: request.reason,
    };
    writeRows(request.kind, request.plant, rows);
  }

  requests[index] = {
    ...request,
    status: approve ? "approved" : "rejected",
    decidedBy: user.id, decidedByName: user.name, decidedAt: now.toISOString(),
    decisionNote: note,
    expiresAt: approve ? expiresAt : undefined,
  };
  saveSheetRequests(requests);

  recordAudit({
    action: approve ? "SHEET_EDIT_APPROVED" : "SHEET_EDIT_REJECTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: `${request.kind}-row`, targetId: request.rowId, targetLabel: request.rowLabel,
    detail: approve
      ? `Unlocked for ${request.requestedByName} until ${expiresAt}${note ? ` — ${note}` : ""}. Request: ${request.reason}`
      : `Refused: ${note}`,
    plant: request.plant,
  });

  const sheet = request.kind === "transport" ? "Transport" : "Biomass";
  noticeTo([request.requestedBy], {
    kind: approve ? "update" : "warning",
    title: approve ? `Edit approved — ${sheet} row unlocked` : `Edit request rejected — ${sheet} row`,
    body: approve
      ? `${user.name} unlocked ${request.rowLabel} until ${fmtDateTime(expiresAt)}. Make the change, then press Submit on the row again.${note ? `\nNote: ${note}` : ""}`
      : `${user.name} turned down your request for ${request.rowLabel}.\nReason: ${note}`,
    by: { id: user.id, name: user.name },
  });

  return NextResponse.json({ request: requests[index], plantCode: slugToCode(request.plant) });
}
