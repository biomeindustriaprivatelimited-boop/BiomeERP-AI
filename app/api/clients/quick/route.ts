import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { blankPartner, type Partner } from "@/lib/partners";
import { syncClientRegistry, saveClientsAndMirror, findTradingClient, toMirrorEntry } from "@/lib/clientRegistry";

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
 * So the client is created bare and marked as needing setup — as a
 * TRADING client registration (the one client register), which then shows
 * in Client registration for its papers and in clients.json for the agent.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "A client name is required." }, { status: 400 });

  const partners = syncClientRegistry();
  const existing = findTradingClient(partners, name);
  // Not an error — the coordinator wanted this client to exist and it
  // does. Handing back the stored record keeps the form moving.
  if (existing) return NextResponse.json({ client: toMirrorEntry(existing), created: false });

  const partner: Partner = {
    ...blankPartner({ id: user.id, name: user.name }, "client"),
    name,
    category: "trading",
    supplies: [],
    shortName: String(body?.shortName ?? "").trim().slice(0, 40),
    requirementNotes: "Added from coordination. Document requirements not set yet.",
    notes: "Quick-added from coordination. Complete GST, PAN and KYC in Client registration.",
    clientMasterMerged: true,
  };
  partners.push(partner);
  saveClientsAndMirror(partners);

  recordAudit({
    action: "CLIENT_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "client", targetId: name, targetLabel: name,
    detail: "Quick-added from coordination — requirements still to be set.",
  });

  return NextResponse.json({ client: toMirrorEntry(partner), created: true }, { status: 201 });
}
