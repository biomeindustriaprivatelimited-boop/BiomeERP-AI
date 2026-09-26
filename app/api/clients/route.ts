import crypto from "crypto";
import { requirePermission } from "@/lib/authServer";
import { NextRequest, NextResponse } from "next/server";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { Client, PurchaseOrder, REQUIREMENT_KEYS } from "@/lib/whatsapp";

/**
 * The client master: which papers each power plant insists on, and which
 * of them must carry a Digital Signature Certificate.
 *
 * Seeded from SOP section 7 by the background agent on first run, and
 * editable here — the SOP is the starting point, not a hard-coded rule,
 * because client requirements change without the app being rebuilt.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientFile {
  clients: Client[];
  seededFrom?: string;
  seededAt?: string;
}

function load(): ClientFile {
  return readJson<ClientFile>(paths.clientsFile, { clients: [] });
}

function clean(input: any): Client {
  const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
  const keys = (v: any): string[] => {
    if (!Array.isArray(v)) return [];
    const valid = v.map((x: any) => String(x)).filter((k: string) => REQUIREMENT_KEYS.includes(k));
    return Array.from(new Set<string>(valid));
  };

  // A PO list arriving malformed must not wipe the one already stored, so
  // this only reads what is actually an array and leaves it out otherwise.
  const orders = (v: any): PurchaseOrder[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    return v
      .map((p: any) => ({
        id: str(p.id) || crypto.randomUUID(),
        number: str(p.number),
        date: str(p.date).slice(0, 10),
        validTill: str(p.validTill).slice(0, 10),
        quantityMt: Number(p.quantityMt) > 0 ? Number(p.quantityMt) : 0,
        location: str(p.location),
        notes: str(p.notes).slice(0, 300),
        active: p.active !== false,
      }))
      .filter((p: PurchaseOrder) => p.number);
  };

  return {
    name: str(input.name),
    shortName: str(input.shortName),
    aliases: Array.isArray(input.aliases)
      ? Array.from(
          new Set<string>(input.aliases.map((a: any) => str(a).toLowerCase()).filter(Boolean))
        )
      : [],
    requires: keys(input.requires),
    // A DSC can only be demanded on a document the client actually wants.
    dscOn: keys(input.dscOn).filter((k) => keys(input.requires).includes(k)),
    notes: str(input.notes),
    poNumbers: orders(input.poNumbers),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;

  const file = load();
  return NextResponse.json({
    clients: file.clients || [],
    seededFrom: file.seededFrom || null,
    file: paths.clientsFile,
  });
}

/** Add or update one client, keyed on name. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const client = clean(body);
  if (!client.name) return NextResponse.json({ error: "A client name is required." }, { status: 400 });
  if (!client.requires.length) {
    return NextResponse.json(
      { error: "Pick at least one required document, or the supply can never be marked complete." },
      { status: 400 }
    );
  }

  const file = load();
  const clients = file.clients || [];
  const originalName = String(body.originalName || client.name).trim().toLowerCase();
  const index = clients.findIndex((c) => c.name.trim().toLowerCase() === originalName);

  if (index === -1) {
    if (clients.some((c) => c.name.trim().toLowerCase() === client.name.trim().toLowerCase())) {
      return NextResponse.json({ error: `${client.name} is already in the list.` }, { status: 409 });
    }
    clients.push({ ...client, poNumbers: client.poNumbers || [] });
  } else {
    // An edit from the requirements screen does not send purchase orders.
    // Writing `undefined` over them would quietly delete every PO the
    // coordination form depends on.
    clients[index] = {
      ...client,
      poNumbers: client.poNumbers ?? clients[index].poNumbers ?? [],
    };
  }

  ensureDir(paths.configDir);
  writeJsonAtomic(paths.clientsFile, { ...file, clients, updatedAt: new Date().toISOString() });
  return NextResponse.json({ client, clients });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;

  const name = (req.nextUrl.searchParams.get("name") || "").trim().toLowerCase();
  if (!name) return NextResponse.json({ error: "A `name` is required." }, { status: 400 });

  const file = load();
  const clients = (file.clients || []).filter((c) => c.name.trim().toLowerCase() !== name);
  if (clients.length === (file.clients || []).length) {
    return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });
  }

  ensureDir(paths.configDir);
  writeJsonAtomic(paths.clientsFile, { ...file, clients, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, clients });
}
