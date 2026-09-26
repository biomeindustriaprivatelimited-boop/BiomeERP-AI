import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import fs from "fs";
import { paths, readJson, writeJsonAtomic, ensureDir, safeJoin } from "@/lib/dataRoot";
import {
  Vendor,
  normaliseVendorCode,
  isValidVendorCode,
  isValidGstin,
  isValidPan,
} from "@/lib/whatsapp";

/**
 * The vendor master: the codes that appear in coordination references
 * (the "MHI" in BDC/786/MHI/44), plus each vendor's full details.
 *
 * Stored at <DataRoot>/config/vendors.json. The background agent reads
 * the same file to recognise vendor codes while classifying documents,
 * so a vendor added here immediately improves matching.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VendorFile {
  vendors: Vendor[];
}

function loadVendors(): Vendor[] {
  const data = readJson<VendorFile>(paths.vendorsFile, { vendors: [] });
  return Array.isArray(data.vendors) ? data.vendors : [];
}

function saveVendors(vendors: Vendor[]) {
  ensureDir(paths.configDir);
  writeJsonAtomic(paths.vendorsFile, { vendors, updatedAt: new Date().toISOString() });
}

/** Trim strings, uppercase the codes, and drop anything unexpected. */
function cleanVendor(input: any, existing?: Vendor): Vendor {
  const str = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
  const code = normaliseVendorCode(input.code ?? existing?.code ?? "");

  return {
    code,
    name: str(input.name ?? existing?.name),
    legalName: str(input.legalName ?? existing?.legalName),
    gstin: str(input.gstin ?? existing?.gstin).toUpperCase(),
    pan: str(input.pan ?? existing?.pan).toUpperCase(),
    supplyType: (["trading", "manufacturing", "both", ""].includes(input.supplyType)
      ? input.supplyType
      : existing?.supplyType || "") as Vendor["supplyType"],
    material: str(input.material ?? existing?.material),
    contactPerson: str(input.contactPerson ?? existing?.contactPerson),
    phone: str(input.phone ?? existing?.phone),
    email: str(input.email ?? existing?.email),
    addressLine: str(input.addressLine ?? existing?.addressLine),
    city: str(input.city ?? existing?.city),
    state: str(input.state ?? existing?.state),
    stateCode: str(input.stateCode ?? existing?.stateCode),
    pincode: str(input.pincode ?? existing?.pincode),
    bankName: str(input.bankName ?? existing?.bankName),
    bankAccountNo: str(input.bankAccountNo ?? existing?.bankAccountNo),
    bankIfsc: str(input.bankIfsc ?? existing?.bankIfsc).toUpperCase(),
    paymentTerms: str(input.paymentTerms ?? existing?.paymentTerms),
    notes: str(input.notes ?? existing?.notes),
    active: input.active === undefined ? existing?.active !== false : input.active !== false,
    kyc: existing?.kyc ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Blocking problems only — a vendor with just a code and name is fine. */
function validate(v: Vendor): string[] {
  const errors: string[] = [];
  if (!v.code) errors.push("A vendor code is required.");
  else if (!isValidVendorCode(v.code)) {
    errors.push(
      `"${v.code}" isn't a usable vendor code — use 2 to 8 letters or digits starting with a letter, e.g. MHI.`
    );
  }
  if (!v.name) errors.push("A vendor name is required.");
  if (v.gstin && !isValidGstin(v.gstin)) errors.push(`"${v.gstin}" is not a valid 15-character GSTIN.`);
  if (v.pan && !isValidPan(v.pan)) errors.push(`"${v.pan}" is not a valid 10-character PAN.`);
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    errors.push(`"${v.email}" is not a valid email address.`);
  }
  return errors;
}

/** Vendors that share one code — kept as the business issued them, but shown apart. */
function duplicateGroups(vendors: { code: string; name: string }[]) {
  const by = new Map<string, string[]>();
  for (const v of vendors) { const k = normaliseVendorCode(v.code); by.set(k, [...(by.get(k) || []), v.name]); }
  return [...by.entries()].filter(([, names]) => names.length > 1).map(([code, names]) => ({ code, vendors: names }));
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const vendors = loadVendors().sort((a, b) => a.code.localeCompare(b.code));
  return NextResponse.json({ vendors, dataRoot: paths.root, file: paths.vendorsFile , duplicateGroups: duplicateGroups(vendors) });
}

/** Register a new vendor. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const vendor = cleanVendor(body);
  const errors = validate(vendor);
  if (errors.length) return NextResponse.json({ error: errors.join(" "), errors }, { status: 400 });

  const vendors = loadVendors();
  const holder = vendors.find((v) => normaliseVendorCode(v.code) === vendor.code);
  if (holder) {
    // The business rule: a new vendor can never take a code that exists.
    return NextResponse.json(
      { error: `Not registered — vendor code ${vendor.code} is already used by ${holder.name}. Every vendor needs its own code; choose a different one.`, reason: "duplicate_code", holder: holder.name },
      { status: 409 }
    );
  }

  vendors.push(vendor);
  saveVendors(vendors);
  return NextResponse.json({ vendor }, { status: 201 });
}

/** Update an existing vendor. The code itself is the key and can be changed. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.originalCode) {
    return NextResponse.json({ error: "`originalCode` is required." }, { status: 400 });
  }

  const vendors = loadVendors();
  const originalCode = normaliseVendorCode(body.originalCode);
  const index = vendors.findIndex((v) => normaliseVendorCode(v.code) === originalCode);
  if (index === -1) {
    return NextResponse.json({ error: `No vendor is registered under code ${originalCode}.` }, { status: 404 });
  }

  const updated = cleanVendor(body, vendors[index]);
  const errors = validate(updated);
  if (errors.length) return NextResponse.json({ error: errors.join(" "), errors }, { status: 400 });

  if (
    updated.code !== originalCode &&
    vendors.some((v, i) => i !== index && normaliseVendorCode(v.code) === updated.code)
  ) {
    const holder = vendors.find((v, i) => i !== index && normaliseVendorCode(v.code) === updated.code);
    return NextResponse.json({ error: `Not saved — vendor code ${updated.code} is already used by ${holder?.name || "another vendor"}. Choose a different code.`, reason: "duplicate_code" }, { status: 409 });
  }

  // Keep the KYC folder in step with a renamed code so the files don't
  // become orphaned.
  if (updated.code !== originalCode) {
    try {
      const from = safeJoin(paths.kycDir, originalCode);
      const to = safeJoin(paths.kycDir, updated.code);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    } catch {
      /* the record still updates; the files just stay under the old code */
    }
  }

  vendors[index] = updated;
  saveVendors(vendors);
  return NextResponse.json({ vendor: updated });
}

/** Remove a vendor. KYC files are kept on disk unless purge=1. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const code = normaliseVendorCode(req.nextUrl.searchParams.get("code") || "");
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  if (!code) return NextResponse.json({ error: "A `code` is required." }, { status: 400 });

  const vendors = loadVendors();
  const remaining = vendors.filter((v) => normaliseVendorCode(v.code) !== code);
  if (remaining.length === vendors.length) {
    return NextResponse.json({ error: `No vendor is registered under code ${code}.` }, { status: 404 });
  }

  saveVendors(remaining);

  if (purge) {
    try {
      fs.rmSync(safeJoin(paths.kycDir, code), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  return NextResponse.json({ ok: true, removed: code, kycPurged: purge });
}
