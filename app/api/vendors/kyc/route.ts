import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir, safeJoin, sanitizeSegment } from "@/lib/dataRoot";
import { Vendor, VendorKycFile, normaliseVendorCode } from "@/lib/whatsapp";

/**
 * KYC document storage for vendors: GST certificate, PAN card, cancelled
 * cheque, MSME certificate, agreements — whatever needs keeping.
 *
 * Files live at <DataRoot>/kyc/<VENDORCODE>/, so they're ordinary files
 * you can also open in Explorer, back up, or hand to an auditor. The
 * index is mirrored into the vendor record so the UI can list them
 * without walking the disk.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx"]);

function loadVendors(): Vendor[] {
  return readJson<{ vendors: Vendor[] }>(paths.vendorsFile, { vendors: [] }).vendors || [];
}

function saveVendors(vendors: Vendor[]) {
  ensureDir(paths.configDir);
  writeJsonAtomic(paths.vendorsFile, { vendors, updatedAt: new Date().toISOString() });
}

function findVendor(vendors: Vendor[], code: string) {
  const target = normaliseVendorCode(code);
  const index = vendors.findIndex((v) => normaliseVendorCode(v.code) === target);
  return { index, vendor: index === -1 ? null : vendors[index], code: target };
}

/** GET ?code=MHI            -> list this vendor's KYC files
 *  GET ?code=MHI&file=x.pdf -> download that file */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const code = req.nextUrl.searchParams.get("code") || "";
  const fileName = req.nextUrl.searchParams.get("file");
  const vendors = loadVendors();
  const { vendor, code: normalised } = findVendor(vendors, code);

  if (!vendor) {
    return NextResponse.json({ error: `No vendor is registered under code ${normalised}.` }, { status: 404 });
  }

  if (!fileName) {
    return NextResponse.json({ code: vendor.code, kyc: vendor.kyc ?? [] });
  }

  let target: string;
  try {
    // safeJoin refuses anything that escapes the vendor's own folder, so a
    // crafted "../../creds.json" can't read outside it.
    target = safeJoin(paths.kycDir, normalised, path.basename(fileName));
  } catch {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  if (!fs.existsSync(target)) {
    return NextResponse.json({ error: "That file is no longer on disk." }, { status: 404 });
  }

  const data = fs.readFileSync(target);
  const ext = path.extname(target).toLowerCase();
  const mime =
    ext === ".pdf"
      ? "application/pdf"
      : [".jpg", ".jpeg"].includes(ext)
        ? "image/jpeg"
        : ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${path.basename(target).replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Upload one or more KYC files for a vendor. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const code = String(form.get("code") || "");
  const label = String(form.get("label") || "").trim();
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");

  if (!files.length) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });

  const vendors = loadVendors();
  const { index, vendor, code: normalised } = findVendor(vendors, code);
  if (!vendor) {
    return NextResponse.json(
      { error: `No vendor is registered under code ${normalised}. Register the vendor first.` },
      { status: 404 }
    );
  }

  const dir = safeJoin(paths.kycDir, normalised);
  ensureDir(dir);

  const added: VendorKycFile[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      rejected.push({
        name: file.name,
        reason: `${ext || "This file type"} isn't accepted. Use PDF, an image, Word or Excel.`,
      });
      continue;
    }
    if (file.size > MAX_BYTES) {
      rejected.push({
        name: file.name,
        reason: `${(file.size / 1048576).toFixed(1)} MB is over the 25 MB limit.`,
      });
      continue;
    }

    const base = sanitizeSegment(path.basename(file.name, ext), "document");
    let stored = `${base}${ext}`;
    let n = 1;
    while (fs.existsSync(path.join(dir, stored))) {
      n += 1;
      stored = `${base} (${n})${ext}`;
    }

    fs.writeFileSync(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
    added.push({
      name: stored,
      label: label || base,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
    });
  }

  if (added.length) {
    vendors[index] = {
      ...vendor,
      kyc: [...(vendor.kyc ?? []), ...added],
      updatedAt: new Date().toISOString(),
    };
    saveVendors(vendors);
  }

  return NextResponse.json(
    { added, rejected, kyc: vendors[index].kyc ?? [] },
    { status: added.length ? 201 : 400 }
  );
}

/** Delete one KYC file. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  const code = req.nextUrl.searchParams.get("code") || "";
  const fileName = req.nextUrl.searchParams.get("file") || "";
  if (!fileName) return NextResponse.json({ error: "A `file` is required." }, { status: 400 });

  const vendors = loadVendors();
  const { index, vendor, code: normalised } = findVendor(vendors, code);
  if (!vendor) {
    return NextResponse.json({ error: `No vendor is registered under code ${normalised}.` }, { status: 404 });
  }

  try {
    const target = safeJoin(paths.kycDir, normalised, path.basename(fileName));
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  vendors[index] = {
    ...vendor,
    kyc: (vendor.kyc ?? []).filter((k) => k.name !== path.basename(fileName)),
    updatedAt: new Date().toISOString(),
  };
  saveVendors(vendors);

  return NextResponse.json({ ok: true, kyc: vendors[index].kyc });
}
