import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import type { Partner, ClientPurchaseOrder } from "@/lib/partners";
import { syncClientRegistry, saveClientsAndMirror, findTradingClient, toMirrorEntry } from "@/lib/clientRegistry";

/**
 * Purchase orders held against a client.
 *
 * Separate from the client route on purpose: that one refuses to save a
 * client with no required documents, which is right for the requirements
 * screen and wrong here — a coordinator adding a PO mid-entry must not be
 * stopped by a rule about paperwork they are not editing.
 *
 * Stored on the client's registration (the one client register) and
 * mirrored into clients.json for coordination's PO picker.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: any, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}

function readPo(body: any, existing?: ClientPurchaseOrder): ClientPurchaseOrder {
  return {
    id: existing?.id || crypto.randomUUID(),
    number: str(body.number, 60),
    date: str(body.date, 10),
    validTill: str(body.validTill, 10),
    quantityMt: Number(body.quantityMt) > 0 ? Number(body.quantityMt) : 0,
    location: str(body.location, 60),
    notes: str(body.notes, 300),
    active: body.active !== false,
  };
}

function put(partners: Partner[], target: Partner, poNumbers: ClientPurchaseOrder[]): Partner {
  const updated = { ...target, poNumbers, updatedAt: new Date().toISOString() };
  partners[partners.indexOf(target)] = updated;
  saveClientsAndMirror(partners);
  return updated;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.client) return NextResponse.json({ error: "Which client?" }, { status: 400 });

  const po = readPo(body);
  if (!po.number) return NextResponse.json({ error: "A PO number is required." }, { status: 400 });

  const partners = syncClientRegistry();
  const target = findTradingClient(partners, String(body.client));
  if (!target) return NextResponse.json({ error: `${body.client} is not in the client master.` }, { status: 404 });

  const existing = target.poNumbers || [];
  // The same PO on the same client twice makes the picker ambiguous and
  // the reports double-count against a contract.
  if (existing.some((p) => p.number.trim().toLowerCase() === po.number.trim().toLowerCase())) {
    return NextResponse.json({ error: `PO ${po.number} is already on ${target.name}.` }, { status: 409 });
  }

  const updated = put(partners, target, [po, ...existing]);
  recordAudit({
    action: "CLIENT_PO_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: updated.name, targetLabel: updated.name,
    detail: `PO ${po.number}${po.date ? ` dated ${po.date}` : ""}`,
  });

  return NextResponse.json({ po, client: toMirrorEntry(updated) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.client || !body?.id) return NextResponse.json({ error: "Which PO?" }, { status: 400 });

  const partners = syncClientRegistry();
  const target = findTradingClient(partners, String(body.client));
  if (!target) return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });

  const list = [...(target.poNumbers || [])];
  const pos = list.findIndex((p) => p.id === body.id);
  if (pos === -1) return NextResponse.json({ error: "That PO isn't on this client." }, { status: 404 });

  const next = readPo(body, list[pos]);
  if (!next.number) return NextResponse.json({ error: "A PO number is required." }, { status: 400 });
  list[pos] = next;
  const updated = put(partners, target, list);

  recordAudit({
    action: "CLIENT_PO_UPDATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: updated.name, targetLabel: updated.name,
    detail: `PO ${next.number}`,
  });

  return NextResponse.json({ po: next, client: toMirrorEntry(updated) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const client = req.nextUrl.searchParams.get("client") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!client || !id) return NextResponse.json({ error: "A client and a PO id are required." }, { status: 400 });

  const partners = syncClientRegistry();
  const target = findTradingClient(partners, client);
  if (!target) return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });

  const list = target.poNumbers || [];
  const po = list.find((p) => p.id === id);
  if (!po) return NextResponse.json({ error: "That PO isn't on this client." }, { status: 404 });

  const updated = put(partners, target, list.filter((p) => p.id !== id));
  recordAudit({
    action: "CLIENT_PO_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: updated.name, targetLabel: updated.name,
    detail: `PO ${po.number}`,
  });

  return NextResponse.json({ ok: true, client: toMirrorEntry(updated) });
}
