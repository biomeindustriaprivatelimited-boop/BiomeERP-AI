import { NextRequest, NextResponse } from "next/server";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { Client } from "@/lib/whatsapp";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";

/**
 * Add a client from wherever you happen to be — the coordination form,
 * mid-entry, with a truck waiting.
 *
 * The full client route insists on at least one required document, and it
 * is right to: a client with no requirements can never have its supply
 * marked complete. But that rule belongs to the requirements screen. A
 * coordinator who cannot add a client without first deciding which papers
 * that plant wants will type the name into the free-text box instead, and
 * that is precisely how one vendor ended up in this system three times
 * under three spellings.
 *
 * So the client is created bare and marked as needing setup. The
 * coordination page shows that state plainly rather than pretending the
 * client is ready.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientFile { clients: Client[]; }

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "A client name is required." }, { status: 400 });

  const file = readJson<ClientFile>(paths.clientsFile, { clients: [] });
  const clients = file.clients || [];

  const existing = clients.find(
    (c) =>
      c.name.trim().toLowerCase() === name.toLowerCase() ||
      (c.aliases || []).some((a) => a.trim().toLowerCase() === name.toLowerCase())
  );
  // Not an error — the coordinator wanted this client to exist and it
  // does. Handing back the stored record keeps the form moving.
  if (existing) return NextResponse.json({ client: existing, created: false });

  const client: Client = {
    name,
    shortName: String(body?.shortName ?? "").trim().slice(0, 40),
    aliases: [],
    requires: [],
    dscOn: [],
    notes: "Added from coordination. Document requirements not set yet.",
    poNumbers: [],
  };

  clients.push(client);
  ensureDir(paths.configDir);
  writeJsonAtomic(paths.clientsFile, { ...file, clients, updatedAt: new Date().toISOString() });

  recordAudit({
    action: "CLIENT_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: name, targetLabel: name,
    detail: "Quick-added from coordination — requirements still to be set.",
  });

  return NextResponse.json({ client, created: true }, { status: 201 });
}
