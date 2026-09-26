import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadPartners, savePartners, partnersDir, PARTNER_KINDS } from "@/lib/partners";
import { recordAudit } from "@/lib/audit";

/**
 * Partner documents — opening one, listing them, removing one.
 *
 * The list is what the Documents screen uses. A plant manager asked to see
 * "documents uploaded from our side", and that is exactly what this
 * returns for them: the papers their own site put on file, for the
 * partners their site works with. Everyone else sees the lot.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves a stored path, refusing anything pointing outside the folder. */
function resolveDoc(relative: string): string | null {
  const base = partnersDir();
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const partnerId = req.nextUrl.searchParams.get("partnerId");
  const docId = req.nextUrl.searchParams.get("id");
  const partners = loadPartners();

  // One file, streamed back.
  if (partnerId && docId) {
    const partner = partners.find((p) => p.id === partnerId);
    const doc = partner?.documents.find((d) => d.id === docId);
    if (!partner || !doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (
      user.role === "plant_manager" &&
      ((auth.session.plant && partner.plants.length > 0 && !partner.plants.includes(auth.session.plant)) ||
        (partner as any).category === "trading")
    ) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    // A coordinator's register is trading vendors only.
    if (user.role === "coordinator" && (partner as any).category !== "trading") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const full = resolveDoc(doc.file);
    if (!full) {
      return NextResponse.json(
        { error: "The file is missing from the store. The record is still here — re-upload it." },
        { status: 404 }
      );
    }
    const bytes = fs.readFileSync(full);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // The flat list, for the Documents screen.
  const plantFilter = req.nextUrl.searchParams.get("plant") || "";
  const scoped =
    user.role === "coordinator"
      ? partners.filter((p) => (p as any).category === "trading")
      : user.role === "plant_manager" && auth.session.plant
        ? partners.filter((p) => (p as any).category !== "trading" && (p.plants.length === 0 || p.plants.includes(auth.session.plant!)))
        : partners;

  const rows = scoped.flatMap((p) =>
    p.documents
      .filter((d) => {
        if (!plantFilter) return true;
        return d.plant === plantFilter;
      })
      // A plant manager sees what THEIR site uploaded, plus anything
      // uploaded centrally for a partner they work with. Hiding the head
      // office copy of an agreement they are working under would be worse
      // than useless.
      .filter((d) => {
        if (user.role !== "plant_manager" || !auth.session.plant) return true;
        return !d.plant || d.plant === auth.session.plant;
      })
      .map((d) => ({
        ...d,
        partnerId: p.id,
        partnerName: p.name,
        partnerKind: p.kind,
        partnerKindLabel: PARTNER_KINDS.find((k) => k.id === p.kind)?.label || p.kind,
        partnerStatus: p.status,
      }))
  );

  rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return NextResponse.json({
    documents: rows,
    total: rows.length,
    myPlant: auth.session.plant,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const partnerId = req.nextUrl.searchParams.get("partnerId") || "";
  const docId = req.nextUrl.searchParams.get("id") || "";

  const partners = loadPartners();
  const partner = partners.find((p) => p.id === partnerId);
  const doc = partner?.documents.find((d) => d.id === docId);
  if (!partner || !doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Only the person who uploaded it, or someone senior, may remove it — a
  // signed agreement is not something any passing user should be able to
  // take off the file.
  const senior = user.role === "admin" || user.role === "accounts" || user.role === "developer";
  if (doc.uploadedBy !== user.id && !senior) {
    return NextResponse.json(
      { error: `${doc.uploadedByName} put this on file. Ask them, or ask accounts.` },
      { status: 403 }
    );
  }

  const updated = { ...partner, documents: partner.documents.filter((d) => d.id !== docId), updatedAt: new Date().toISOString() };
  savePartners(partners.map((p) => (p.id === partner.id ? updated : p)));

  // The bytes are left on disk deliberately. Removing the row takes it out
  // of the register; shredding the file would make an accidental delete
  // unrecoverable, and this folder is backed up as a whole anyway.
  recordAudit({
    action: "PARTNER_DOCUMENT_REMOVED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "partner", targetId: partner.id, targetLabel: partner.name,
    detail: `${doc.label}${doc.reference ? ` (${doc.reference})` : ""} — file kept on disk, row removed.`,
  });

  return NextResponse.json({ ok: true });
}
