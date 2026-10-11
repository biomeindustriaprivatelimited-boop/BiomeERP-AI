import { requirePermission, findById } from "@/lib/authServer";
import { NextRequest, NextResponse } from "next/server";
import { effectivePermissions } from "@/lib/access";
import { REQUIREMENT_KEYS } from "@/lib/whatsapp";
import { blankPartner, type Partner } from "@/lib/partners";
import {
  syncClientRegistry, saveClientsAndMirror, findTradingClient, loadClientMirror, clientMirrorMeta,
  dropFromClientMirror, nameKey,
} from "@/lib/clientRegistry";
import { recordAudit } from "@/lib/audit";

/**
 * The client master — COMPATIBILITY ROUTE.
 *
 * Clients now live in ONE place: client Registration (/partners/clients,
 * lib/clientRegistry.ts). This route keeps its old contract for every
 * screen that still calls it (WhatsApp manual classify, settings, the AI
 * tools): GET returns the trading clients with their requirements, PUT
 * edits requirements, DELETE removes a client — all against the
 * registration, never a second copy.
 *
 * Editing requirements needs "customers.requirements" (developer, admin,
 * accounts — or anyone the developer grants it to). A coordinator can
 * read them, not change them.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function keys(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set<string>(v.map((x: any) => String(x)).filter((k: string) => REQUIREMENT_KEYS.includes(k))));
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "customers");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const clients = loadClientMirror();
  const meta = clientMirrorMeta();
  return NextResponse.json({
    clients,
    seededFrom: meta.seededFrom,
    file: meta.file,
    canEditRequirements: effectivePermissions(user.role, user.access).includes("customers.requirements"),
  });
}

/** Add or update one client's requirements, keyed on id or name. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "customers.requirements");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const name = String(body.name ?? "").trim().slice(0, 160);
  if (!name) return NextResponse.json({ error: "A client name is required." }, { status: 400 });
  const requires = keys(body.requires);
  if (!requires.length) {
    return NextResponse.json(
      { error: "Pick at least one required document, or the supply can never be marked complete." },
      { status: 400 }
    );
  }
  const dscOn = keys(body.dscOn).filter((k) => requires.includes(k));

  const partners = syncClientRegistry();
  const existing = findTradingClient(partners, String(body.id || body.originalName || name));
  const now = new Date().toISOString();
  const aliases = Array.isArray(body.aliases)
    ? Array.from(new Set<string>(body.aliases.map((a: any) => String(a).trim().toLowerCase()).filter(Boolean)))
    : undefined;

  let saved: Partner;
  if (!existing) {
    saved = {
      ...blankPartner({ id: user.id, name: user.name }, "client"),
      name, category: "trading", supplies: [],
      shortName: String(body.shortName ?? "").trim().slice(0, 60),
      aliases: aliases || [],
      requires, dscOn,
      requirementNotes: String(body.notes ?? "").trim().slice(0, 600),
      requirementsUpdatedAt: now, requirementsUpdatedBy: user.name,
      clientMasterMerged: true,
    };
    partners.push(saved);
  } else {
    const clash = partners.some((p) => p.id !== existing.id && p.kind === "client" && p.category === "trading" && nameKey(p.name) === nameKey(name));
    if (clash) return NextResponse.json({ error: `${name} is already in the list.` }, { status: 409 });
    saved = {
      ...existing,
      name,
      shortName: body.shortName !== undefined ? String(body.shortName).trim().slice(0, 60) : existing.shortName,
      aliases: aliases ?? existing.aliases,
      requires, dscOn,
      requirementNotes: body.notes !== undefined ? String(body.notes).trim().slice(0, 600) : existing.requirementNotes,
      // POs are never touched by a requirements edit.
      poNumbers: existing.poNumbers,
      requirementsUpdatedAt: now, requirementsUpdatedBy: user.name,
      updatedAt: now,
    };
    partners[partners.indexOf(existing)] = saved;
  }
  saveClientsAndMirror(partners);
  recordAudit({
    action: "CLIENT_REQUIREMENTS_CHANGED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "partner", targetId: saved.id, targetLabel: saved.name,
    detail: `${requires.length} document(s) required${dscOn.length ? ` · DSC on ${dscOn.join(", ")}` : ""}`,
  });
  const clients = loadClientMirror();
  return NextResponse.json({ client: clients.find((c) => c.id === saved.id) || null, clients });
}

/**
 * Remove a client. Same permission as editing requirements. A client with
 * KYC papers on file or a submitted registration is not deleted — block
 * it instead, so its history stays.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "customers.requirements");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const key = (req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("name") || "").trim();
  if (!key) return NextResponse.json({ error: "A `name` is required." }, { status: 400 });

  const partners = syncClientRegistry();
  const target = findTradingClient(partners, key);
  if (!target) return NextResponse.json({ error: "That client isn't in the list." }, { status: 404 });
  if (target.documents.length || target.lockState === "submitted") {
    return NextResponse.json(
      { error: `${target.name} has KYC papers on file or a submitted registration, so it is not deleted. Open it in Client registration and set its status to Blocked instead.` },
      { status: 409 }
    );
  }
  saveClientsAndMirror(partners.filter((p) => p.id !== target.id));
  dropFromClientMirror(target.id);
  recordAudit({
    action: "CLIENT_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "partner", targetId: target.id, targetLabel: target.name,
    detail: "Removed from the client register",
  });
  return NextResponse.json({ ok: true, clients: loadClientMirror() });
}
