import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import { loadPartners, savePartners, duplicateCodes } from "@/lib/partners";
import { previewVendorImport, applyVendorImport, previewClientImport, applyClientImport } from "@/lib/partnerImport";
import { syncMasterFromRegistration } from "@/lib/vendorSync";
import { syncClientRegistry, saveClientsAndMirror } from "@/lib/clientRegistry";

/**
 * Import the owner's vendor code list / client list into Registration.
 *
 *   GET  ?what=vendors|clients        → preview (nothing is saved)
 *   POST { what, applyConflicts? }    → apply
 *
 * Developer, admin and accounts ("partners.manage"). Everything lands in
 * the TRADING register (the list is the coordinator's supply list).
 * Duplicate codes in the owner's own list are imported as given and come
 * back in `duplicates` so the screen can flag them for him to fix.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return { response: auth.response };
  const user = findById(auth.session.uid)!;
  if (!effectivePermissions(user.role, user.access).includes("partners.manage")) {
    return { response: NextResponse.json({ error: "Only accounts, the admin or the developer can import the master lists." }, { status: 403 }) };
  }
  return { user };
}

function what(v: unknown): "vendors" | "clients" | null {
  return v === "vendors" || v === "clients" ? v : null;
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const w = what(req.nextUrl.searchParams.get("what"));
  if (!w) return NextResponse.json({ error: "What to import — vendors or clients?" }, { status: 400 });
  if (w === "vendors") {
    const partners = loadPartners();
    const rows = previewVendorImport(partners);
    return NextResponse.json({ what: w, rows, duplicates: duplicateCodes(partners.filter((p) => p.category === "trading")) });
  }
  let partners;
  try { partners = syncClientRegistry(); } catch { partners = loadPartners(); }
  return NextResponse.json({ what: w, rows: previewClientImport(partners) });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const user = g.user;
  const body = await req.json().catch(() => ({}));
  const w = what(body?.what);
  if (!w) return NextResponse.json({ error: "What to import — vendors or clients?" }, { status: 400 });
  const by = { id: user.id, name: user.name };

  if (w === "vendors") {
    const r = applyVendorImport(loadPartners(), by, { applyConflicts: Boolean(body?.applyConflicts) });
    savePartners(r.partners);
    try { syncMasterFromRegistration(r.removedCodes); } catch { /* derived file — Registration is saved */ }
    recordAudit({
      action: "VENDOR_CODE_LIST_IMPORTED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "partner", targetId: "vendor-code-list", targetLabel: "Owner's vendor code list",
      detail: `${r.created.length} created, ${r.coded.length} code(s) set, ${r.skipped.length} conflict(s) left${body?.applyConflicts ? " (conflicts applied)" : ""}`,
    });
    return NextResponse.json({
      ok: true, created: r.created, coded: r.coded, skipped: r.skipped,
      duplicates: duplicateCodes(r.partners.filter((p) => p.category === "trading")),
    });
  }

  let partners;
  try { partners = syncClientRegistry(); } catch { partners = loadPartners(); }
  const r = applyClientImport(partners, by);
  saveClientsAndMirror(r.partners);
  recordAudit({
    action: "CLIENT_LIST_IMPORTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "partner", targetId: "client-list", targetLabel: "Owner's client list",
    detail: `${r.created.length} created, ${r.aliased.length} spelling(s) added as alias, ${r.skipped.length} left for checking`,
  });
  return NextResponse.json({ ok: true, created: r.created, aliased: r.aliased, skipped: r.skipped });
}
