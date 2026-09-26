import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { Client, PurchaseOrder } from "@/lib/whatsapp";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";

/**
 * Purchase orders held against a client.
 *
 * Separate from the client route on purpose: that one refuses to save a
 * client with no required documents, which is right for the requirements
 * screen and wrong here — a coordinator adding a PO mid-entry must not be
 * stopped by a rule about paperwork they are not editing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientFile { clients: Client[]; }

function load(): ClientFile {
  return readJson<ClientFile>(paths.clientsFile, { clients: [] });
}

function save(file: ClientFile) {
  ensureDir(paths.configDir);
  writeJsonAtomic(paths.clientsFile, { ...file, updatedAt: new Date().toISOString() });
}

function str(v: any, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}

function findClient(clients: Client[], name: string): number {
  const key = name.trim().toLowerCase();
  return clients.findIndex((c) => c.name.trim().toLowerCase() === key);
}

function readPo(body: any, existing?: PurchaseOrder): PurchaseOrder {
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

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.client) return NextResponse.json({ error: "Which client?" }, { status: 400 });

  const po = readPo(body);
  if (!po.number) return NextResponse.json({ error: "A PO number is required." }, { status: 400 });

  const file = load();
  const clients = file.clients || [];
  const index = findClient(clients, String(body.client));
  if (index === -1) return NextResponse.json({ error: `${body.client} is not in the client master.` }, { status: 404 });

  const existing = clients[index].poNumbers || [];
  // The same PO on the same client twice makes the picker ambiguous and
  // the reports double-count against a contract.
  if (existing.some((p) => p.number.trim().toLowerCase() === po.number.trim().toLowerCase())) {
    return NextResponse.json({ error: `PO ${po.number} is already on ${clients[index].name}.` }, { status: 409 });
  }

  clients[index] = { ...clients[index], poNumbers: [po, ...existing] };
  save({ ...file, clients });

  recordAudit({
    action: "CLIENT_PO_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: clients[index].name, targetLabel: clients[index].name,
    detail: `PO ${po.number}${po.date ? ` dated ${po.date}` : ""}`,
  });

  return NextResponse.json({ po, client: clients[index] }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.client || !body?.id) return NextResponse.json({ error: "Which PO?" }, { status: 400 });

  const file = load();
  const clients = file.clients || [];
  const index = findClient(clients, String(body.client));
  if (index === -1) return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });

  const list = clients[index].poNumbers || [];
  const pos = list.findIndex((p) => p.id === body.id);
  if (pos === -1) return NextResponse.json({ error: "That PO isn't on this client." }, { status: 404 });

  const updated = readPo(body, list[pos]);
  if (!updated.number) return NextResponse.json({ error: "A PO number is required." }, { status: 400 });

  list[pos] = updated;
  clients[index] = { ...clients[index], poNumbers: list };
  save({ ...file, clients });

  recordAudit({
    action: "CLIENT_PO_UPDATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: clients[index].name, targetLabel: clients[index].name,
    detail: `PO ${updated.number}`,
  });

  return NextResponse.json({ po: updated, client: clients[index] });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const client = req.nextUrl.searchParams.get("client") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!client || !id) return NextResponse.json({ error: "A client and a PO id are required." }, { status: 400 });

  const file = load();
  const clients = file.clients || [];
  const index = findClient(clients, client);
  if (index === -1) return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });

  const list = clients[index].poNumbers || [];
  const po = list.find((p) => p.id === id);
  if (!po) return NextResponse.json({ error: "That PO isn't on this client." }, { status: 404 });

  clients[index] = { ...clients[index], poNumbers: list.filter((p) => p.id !== id) };
  save({ ...file, clients });

  recordAudit({
    action: "CLIENT_PO_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: clients[index].name, targetLabel: clients[index].name,
    detail: `PO ${po.number}`,
  });

  return NextResponse.json({ ok: true, client: clients[index] });
}
