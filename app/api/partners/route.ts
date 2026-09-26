import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { paths } from "@/lib/dataRoot";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { plantOptions } from "@/lib/plants";
import {
  loadPartners, savePartners, blankPartner, gapsFor, partnersDir,
  documentTypesFor, partnerDocAllowed, gstinLooksRight, panLooksRight, ifscLooksRight,
  PARTNER_KINDS, PARTNER_STATUS, PARTNER_DOCUMENT_TYPES, VENDOR_CATEGORIES,
  freezeInfoFor, PARTNER_FREEZE_DAYS,
  Partner, PartnerKind, PartnerStatus, PartnerDocument, VendorCategory,
} from "@/lib/partners";
import { devStamp } from "@/lib/devEdit";
import { importMasterIntoRegistration, syncMasterFromRegistration } from "@/lib/vendorSync";
import { recordAudit } from "@/lib/audit";

/**
 * Biomass vendor and transporter registration.
 *
 * Guarded by `partners`, which admin, accounts and plant managers hold and
 * a coordinator does not. That was asked for directly, and it is enforced
 * here rather than by hiding a menu item — a typed URL fails the same way
 * a click would.
 *
 * A plant manager sees and edits the partners for THEIR site. They are the
 * ones standing in front of the vendor with the paperwork, so shutting
 * them out would mean the papers never reach the app at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown, max = 160): string {
  return String(v ?? "").trim().slice(0, max);
}

function kindOf(v: unknown): PartnerKind {
  return PARTNER_KINDS.some((k) => k.id === v) ? (v as PartnerKind) : "biomass_vendor";
}

/**
 * Who sees which records. The business asked for a hard split:
 *
 *   coordinator    — TRADING vendors only. The plant-side register —
 *                    raw-material vendors and transporters — is not theirs.
 *   plant_manager  — raw-material vendors and transporters for THEIR site.
 *                    Trading vendors never appear for them.
 *   admin/accounts — everything.
 */
function visibleTo(partners: Partner[], role: string, plant: string | null): Partner[] {
  if (role === "coordinator") {
    return partners.filter((p) => p.kind === "biomass_vendor" && p.category === "trading");
  }
  if (role === "plant_manager") {
    return partners.filter(
      (p) =>
        p.category !== "trading" &&
        // A partner with no plants named serves the whole business — a head
        // office contract is not hidden from the site that works with it.
        (!plant || p.plants.length === 0 || p.plants.includes(plant))
    );
  }
  return partners;
}

/**
 * Whether THIS user may still change THIS record.
 *
 * A plant manager's submission freezes one week after it was registered.
 * After that, corrections go through accounts or the admin — the freeze
 * exists so a site cannot quietly rewrite an agreement after the fact.
 */
function frozenFor(p: Partner, role: string): string | null {
  if (role !== "plant_manager") return null;
  const f = freezeInfoFor(p);
  if (!f.frozen) return null;
  return `This record froze on ${f.freezesOn} — a plant manager's submission stays editable for ${PARTNER_FREEZE_DAYS} days. Ask accounts or the admin for a correction.`;
}

function categoryOf(v: unknown): VendorCategory {
  return v === "trading" ? "trading" : "raw_material";
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  // The vendor master lives here now; anything only in vendors.json comes in once.
  try { if (importMasterIntoRegistration()) syncMasterFromRegistration(); } catch { /* best effort */ }
  const user = findById(auth.session.uid)!;

  const all = loadPartners();
  const mine = visibleTo(all, user.role, auth.session.plant);

  const kind = req.nextUrl.searchParams.get("kind");
  const status = req.nextUrl.searchParams.get("status");
  const search = (req.nextUrl.searchParams.get("search") || "").trim().toLowerCase();

  let list = mine;
  if (kind && kind !== "all") list = list.filter((p) => p.kind === kind);
  if (status && status !== "all") list = list.filter((p) => p.status === status);
  if (search) {
    list = list.filter((p) =>
      [p.name, p.legalName, p.code, p.gstin, p.pan, p.city, p.contactPerson, p.phone]
        .join(" ").toLowerCase().includes(search)
    );
  }

  const enriched = list
    .map((p) => ({ ...p, gaps: gapsFor(p), freeze: freezeInfoFor(p), locked: Boolean(frozenFor(p, user.role)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The two numbers worth putting at the top: papers that have run out,
  // and papers about to. Both are counted over everything visible, not
  // over the current filter — a filtered-away expiry is still an expiry.
  const expired = mine.reduce((n, p) => n + gapsFor(p).expired.length, 0);
  const expiringSoon = mine.reduce((n, p) => n + gapsFor(p).expiringSoon.length, 0);

  return NextResponse.json({
    partners: enriched,
    kinds: PARTNER_KINDS,
    statuses: PARTNER_STATUS,
    documentTypes: PARTNER_DOCUMENT_TYPES,
    plants: plantOptions(),
    summary: {
      total: mine.length,
      active: mine.filter((p) => p.status === "active").length,
      draft: mine.filter((p) => p.status === "draft").length,
      expired,
      expiringSoon,
    },
    myPlant: auth.session.plant,
    myRole: user.role,
    categories: VENDOR_CATEGORIES,
    freezeDays: PARTNER_FREEZE_DAYS,
    canActivate: hasPermission(user.role, "users") || hasPermission(user.role, "finance"),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const name = str(body?.name);
  if (!name) return NextResponse.json({ error: "Give the company its name." }, { status: 400 });

  const partners = loadPartners();
  const kind = kindOf(body?.kind);
  let category = kind === "biomass_vendor" ? categoryOf(body?.category) : "raw_material" as VendorCategory;

  // Ownership is decided by role, not by what the form sent.
  if (user.role === "coordinator") {
    if (kind !== "biomass_vendor") {
      return NextResponse.json(
        { error: "A coordinator registers trading vendors. Raw-material vendors and transporters are registered by the plant manager of the site they serve." },
        { status: 403 }
      );
    }
    category = "trading";
  }
  if (user.role === "plant_manager") {
    if (category === "trading") {
      return NextResponse.json(
        { error: "Trading vendors are the coordinator's register. A plant manager registers raw-material vendors and transporters for their own site." },
        { status: 403 }
      );
    }
    category = "raw_material";
  }

  // Two records for one company means two sets of papers, two agreements,
  // and a payment made against whichever one someone opened first.
  const clash = partners.find(
    (p) =>
      (p.gstin && body?.gstin && p.gstin.toUpperCase() === str(body.gstin).toUpperCase()) ||
      (p.name.trim().toLowerCase() === name.toLowerCase() && p.kind === kind)
  );
  if (clash) {
    return NextResponse.json(
      { error: `${clash.name} is already registered${clash.gstin ? ` under ${clash.gstin}` : ""}.` },
      { status: 409 }
    );
  }
  // A code identifies exactly one company. Duplicates are refused with the
  // reason, across registrations AND the vendor master the agent uses.
  const wantedCode = str(body?.code, 12).toUpperCase();
  if (wantedCode) {
    const taken = partners.find((p) => p.code && p.code.toUpperCase() === wantedCode);
    const masterTaken = vendorMasterHolder(wantedCode);
    if (taken || masterTaken) {
      return NextResponse.json(
        { error: `Not registered — code ${wantedCode} is already used by ${taken?.name || masterTaken}. Every vendor / transporter needs its own code; choose a different one.`, reason: "duplicate_code" },
        { status: 409 }
      );
    }
  }

  const partner: Partner = {
    ...blankPartner({ id: user.id, name: user.name }, kind),
    ...readPartner(body, auth.session.plant, user.role),
    category,
  };

  savePartners([...partners, partner]);
  try { syncMasterFromRegistration(); } catch { /* agent file is derived; app data is safe */ }
  recordAudit({
    action: "PARTNER_REGISTERED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "partner", targetId: partner.id, targetLabel: partner.name,
    detail: `${PARTNER_KINDS.find((k) => k.id === kind)?.label}${partner.gstin ? ` · ${partner.gstin}` : ""}`,
  });

  return NextResponse.json({ partner: { ...partner, gaps: gapsFor(partner) } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which partner?" }, { status: 400 });

  const partners = loadPartners();
  const existing = partners.find((p) => p.id === body.id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!visibleTo([existing], user.role, auth.session.plant).length) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lock = frozenFor(existing, user.role);
  if (lock) return NextResponse.json({ error: lock }, { status: 423 });

  const updated: Partner = devStamp({
    ...existing,
    ...readPartner(body, auth.session.plant, user.role),
    // Category and the freeze clock never change on edit. A coordinator's
    // trading vendor cannot be re-filed as raw material, and re-saving a
    // record must not restart its one-week window.
    category: existing.category,
    submittedAt: existing.submittedAt,
    updatedAt: new Date().toISOString(),
  }, existing, { name: user.name, role: user.role }, body.devNote);

  // Status is where the money risk sits, so it has its own rules.
  const nextStatus = PARTNER_STATUS.some((s) => s.id === body.status) ? (body.status as PartnerStatus) : existing.status;
  if (nextStatus !== existing.status) {
    const canDecide = hasPermission(user.role, "users") || hasPermission(user.role, "finance");
    if (!canDecide) {
      return NextResponse.json(
        { error: "A plant manager can register a partner and upload their papers. Marking one Active is accounts' or the admin's call." },
        { status: 403 }
      );
    }
    if (nextStatus === "active") {
      // Activating over an empty folder is exactly how an unverified bank
      // account ends up receiving a payment.
      const gaps = gapsFor(updated);
      if (!gaps.readyToActivate) {
        const why = [
          ...gaps.missing.map((m) => m.label),
          ...gaps.expired.map((e) => `${e.label} (expired ${e.validTill})`),
          ...gaps.missingFields,
        ];
        return NextResponse.json(
          { error: `Not ready to activate — still missing: ${why.join(", ")}.` },
          { status: 409 }
        );
      }
    }
    if ((nextStatus === "blocked" || nextStatus === "on_hold") && !str(body?.statusReason)) {
      return NextResponse.json({ error: "Give a reason — it is what the next person reads." }, { status: 400 });
    }
    updated.status = nextStatus;
    updated.statusReason = str(body?.statusReason, 300);

    recordAudit({
      action: nextStatus === "blocked" ? "PARTNER_BLOCKED" : "PARTNER_STATUS_CHANGED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "partner", targetId: updated.id, targetLabel: updated.name,
      detail: `${existing.status} → ${nextStatus}${updated.statusReason ? ` · ${updated.statusReason}` : ""}`,
    });
  }

  savePartners(partners.map((p) => (p.id === updated.id ? updated : p)));
  try { syncMasterFromRegistration(); } catch { /* derived file */ }
  return NextResponse.json({ partner: { ...updated, gaps: gapsFor(updated), freeze: freezeInfoFor(updated), locked: false } });
}

/** Attach a document. Multipart, so it lives on this route as a POST-alike. */
export async function PATCH(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const partnerId = String(form.get("partnerId") || "");
  const uploaded = form.get("file");
  const type = String(form.get("type") || "other");
  if (!partnerId || !(uploaded instanceof File)) {
    return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  }

  const partners = loadPartners();
  const partner = partners.find((p) => p.id === partnerId);
  if (!partner) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!visibleTo([partner], user.role, auth.session.plant).length) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lock = frozenFor(partner, user.role);
  if (lock) return NextResponse.json({ error: lock }, { status: 423 });

  const allowedType = documentTypesFor(partner.kind).find((t) => t.id === type);
  if (!allowedType) {
    return NextResponse.json({ error: "That document type does not apply to this kind of partner." }, { status: 400 });
  }

  const problem = partnerDocAllowed(uploaded.type, uploaded.size);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const dir = path.join(partnersDir(), partner.id);
  fs.mkdirSync(dir, { recursive: true });

  // Generated name, never the browser's — an uploaded name can carry path
  // separators and walk out of the folder.
  const ext = (uploaded.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const id = crypto.randomUUID();
  const stored = `${id}.${ext || "bin"}`;
  fs.writeFileSync(path.join(dir, stored), bytes);

  const doc: PartnerDocument = {
    id, type,
    label: str(form.get("label"), 120) || allowedType.label,
    reference: str(form.get("reference"), 80),
    documentDate: str(form.get("documentDate"), 10),
    validTill: str(form.get("validTill"), 10),
    fileName: String(uploaded.name).slice(0, 180),
    sizeBytes: bytes.length,
    mimeType: uploaded.type,
    file: path.join(partner.id, stored),
    uploadedAt: new Date().toISOString(),
    uploadedBy: user.id,
    uploadedByName: user.name,
    // Stamped with the uploader's site. This is what lets a plant manager
    // see "documents uploaded from our side" on the Documents screen.
    plant: auth.session.plant || "",
    note: str(form.get("note"), 300),
  };

  const updated: Partner = {
    ...partner,
    documents: [...partner.documents, doc],
    updatedAt: doc.uploadedAt,
  };
  savePartners(partners.map((p) => (p.id === partner.id ? updated : p)));

  recordAudit({
    action: "PARTNER_DOCUMENT_ADDED",
    userId: user.id, userName: user.name, role: user.role,
    plant: auth.session.plant,
    targetType: "partner", targetId: partner.id, targetLabel: partner.name,
    detail: `${doc.label}${doc.reference ? ` (${doc.reference})` : ""}`,
  });

  return NextResponse.json({ partner: { ...updated, gaps: gapsFor(updated) }, document: doc }, { status: 201 });
}

/** Who holds a code in the vendor master (config/vendors.json), if anyone. */
function vendorMasterHolder(code: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.vendorsFile, "utf8"));
    const hit = (raw.vendors || []).find((v: any) => String(v.code || "").toUpperCase() === code);
    return hit ? String(hit.name) : null;
  } catch { return null; }
}

function readPartner(body: any, sessionPlant: string | null, role: string): Partial<Partner> {
  const gstin = str(body?.gstin, 20).toUpperCase();
  const pan = str(body?.pan, 12).toUpperCase();
  const ifsc = str(body?.ifsc, 12).toUpperCase();

  // A plant manager registering a partner is registering it for their own
  // site. Letting them name another plant would put a contract on a site
  // they do not run.
  const plants =
    role === "plant_manager" && sessionPlant
      ? [sessionPlant]
      : Array.isArray(body?.plants) ? body.plants.map((p: any) => String(p).toUpperCase()) : [];

  return {
    kind: kindOf(body?.kind),
    code: str(body?.code, 12).toUpperCase(),
    name: str(body?.name),
    legalName: str(body?.legalName),
    gstin, pan,
    plants,
    material: str(body?.material),
    contactPerson: str(body?.contactPerson),
    phone: str(body?.phone, 20),
    email: str(body?.email, 120),
    addressLine: str(body?.addressLine, 240),
    city: str(body?.city, 80),
    state: str(body?.state, 80),
    pincode: str(body?.pincode, 10),
    bankName: str(body?.bankName, 120),
    accountNumber: str(body?.accountNumber, 40),
    ifsc,
    rateTerms: str(body?.rateTerms, 400),
    paymentTerms: str(body?.paymentTerms, 300),
    agreementFrom: str(body?.agreementFrom, 10),
    agreementTo: str(body?.agreementTo, 10),
    notes: str(body?.notes, 600),
  };
}
