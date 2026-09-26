import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import * as XLSX from "xlsx";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import {
  Vendor,
  normaliseVendorCode,
  isValidVendorCode,
  isValidGstin,
  isValidPan,
} from "@/lib/whatsapp";

/**
 * Bulk-upload the vendor master from a CSV or Excel sheet.
 *
 * Two-step by design: the first call (mode "preview") parses the file and
 * reports exactly what would change, row by row, without writing anything.
 * Only a second call with mode "commit" saves. Nobody should discover a
 * bad import after the fact.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

/** Accepts loose real-world headers: "Vendor Code", "vendor_code", "CODE". */
const HEADER_ALIASES: Record<string, string> = {
  code: "code",
  vendorcode: "code",
  vendercode: "code",
  suppliercode: "code",
  shortcode: "code",
  name: "name",
  vendorname: "name",
  suppliername: "name",
  partyname: "name",
  firmname: "name",
  legalname: "legalName",
  registeredname: "legalName",
  gstin: "gstin",
  gst: "gstin",
  gstno: "gstin",
  gstnumber: "gstin",
  gstinuin: "gstin",
  pan: "pan",
  panno: "pan",
  pannumber: "pan",
  supplytype: "supplyType",
  type: "supplyType",
  material: "material",
  commodity: "material",
  product: "material",
  contactperson: "contactPerson",
  contact: "contactPerson",
  contactname: "contactPerson",
  phone: "phone",
  mobile: "phone",
  phoneno: "phone",
  contactno: "phone",
  contactdetails: "phone",
  email: "email",
  emailid: "email",
  address: "addressLine",
  addressline: "addressLine",
  city: "city",
  district: "city",
  state: "state",
  statename: "state",
  statecode: "stateCode",
  pincode: "pincode",
  pin: "pincode",
  zip: "pincode",
  bankname: "bankName",
  bank: "bankName",
  bankaccountno: "bankAccountNo",
  accountno: "bankAccountNo",
  accountnumber: "bankAccountNo",
  bankifsc: "bankIfsc",
  ifsc: "bankIfsc",
  ifsccode: "bankIfsc",
  paymentterms: "paymentTerms",
  terms: "paymentTerms",
  notes: "notes",
  remarks: "notes",
};

function canonicalHeader(raw: string): string | null {
  const key = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES[key] || null;
}

interface RowResult {
  row: number;
  code: string;
  name: string;
  action: "create" | "update" | "skip";
  errors: string[];
  vendor?: Vendor;
}

function parseSheet(buffer: Buffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`"${fileName}" has no sheets in it.`);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
  return { sheetName, rows };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  const mode = String(form.get("mode") || "preview");
  const overwrite = String(form.get("overwrite") || "true") !== "false";

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: { sheetName: string; rows: Record<string, any>[] };
  try {
    parsed = parseSheet(buffer, file.name);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          (err as Error).message ||
          "That file could not be read. Save it as .xlsx or .csv and try again.",
      },
      { status: 400 }
    );
  }

  const { sheetName, rows } = parsed;
  if (!rows.length) {
    return NextResponse.json({ error: `Sheet "${sheetName}" has no data rows.` }, { status: 400 });
  }

  // Map the sheet's own headers onto our field names.
  const rawHeaders = Object.keys(rows[0]);
  const headerMap = new Map<string, string>();
  for (const h of rawHeaders) {
    const canonical = canonicalHeader(h);
    if (canonical && !headerMap.has(canonical)) headerMap.set(canonical, h);
  }
  const unmapped = rawHeaders.filter((h) => !canonicalHeader(h));

  if (!headerMap.has("code") || !headerMap.has("name")) {
    return NextResponse.json(
      {
        error:
          "The sheet needs at least a vendor code column and a vendor name column. " +
          `Found these headers: ${rawHeaders.join(", ") || "(none)"}.`,
        headers: rawHeaders,
      },
      { status: 400 }
    );
  }

  const existing = readJson<{ vendors: Vendor[] }>(paths.vendorsFile, { vendors: [] }).vendors || [];
  const byCode = new Map(existing.map((v) => [normaliseVendorCode(v.code), v]));

  const results: RowResult[] = [];
  const seenInFile = new Set<string>();

  rows.forEach((row, i) => {
    const get = (field: string) => {
      const header = headerMap.get(field);
      return header ? String(row[header] ?? "").trim() : "";
    };

    const code = normaliseVendorCode(get("code"));
    const name = get("name");
    const errors: string[] = [];

    // Blank spacer rows are common in real sheets — quietly ignore them.
    if (!code && !name) return;

    if (!code) errors.push("Missing vendor code.");
    else if (!isValidVendorCode(code)) errors.push(`"${code}" is not a valid vendor code.`);
    if (!name) errors.push("Missing vendor name.");

    const gstin = get("gstin").toUpperCase();
    if (gstin && !isValidGstin(gstin)) errors.push(`"${gstin}" is not a valid GSTIN.`);
    const pan = get("pan").toUpperCase();
    if (pan && !isValidPan(pan)) errors.push(`"${pan}" is not a valid PAN.`);

    if (code && seenInFile.has(code)) errors.push(`Vendor code ${code} appears more than once in this file.`);
    if (code) seenInFile.add(code);

    const prior = byCode.get(code);
    let action: RowResult["action"] = prior ? "update" : "create";
    if (errors.length) action = "skip";
    else if (prior && !overwrite) action = "skip";

    const supplyTypeRaw = get("supplyType").toLowerCase();
    const supplyType = (["trading", "manufacturing", "both"].includes(supplyTypeRaw)
      ? supplyTypeRaw
      : "") as Vendor["supplyType"];

    const vendor: Vendor = {
      code,
      name,
      legalName: get("legalName"),
      gstin,
      pan,
      supplyType,
      material: get("material"),
      contactPerson: get("contactPerson"),
      phone: get("phone"),
      email: get("email"),
      addressLine: get("addressLine"),
      city: get("city"),
      state: get("state"),
      stateCode: get("stateCode"),
      pincode: get("pincode"),
      bankName: get("bankName"),
      bankAccountNo: get("bankAccountNo"),
      bankIfsc: get("bankIfsc").toUpperCase(),
      paymentTerms: get("paymentTerms"),
      notes: get("notes"),
      active: true,
      // Never let an import wipe KYC files already attached to this vendor.
      kyc: prior?.kyc ?? [],
      createdAt: prior?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    results.push({ row: i + 2, code, name, action, errors, vendor });
  });

  const summary = {
    sheetName,
    totalRows: results.length,
    toCreate: results.filter((r) => r.action === "create").length,
    toUpdate: results.filter((r) => r.action === "update").length,
    skipped: results.filter((r) => r.action === "skip").length,
    mappedColumns: [...headerMap.keys()],
    unmappedColumns: unmapped,
  };

  if (mode !== "commit") {
    return NextResponse.json({
      mode: "preview",
      summary,
      // Keep the payload small; the counts above cover the rest.
      rows: results.slice(0, 300).map(({ vendor, ...rest }) => rest),
    });
  }

  const merged = new Map(byCode);
  for (const r of results) {
    if (r.action === "skip" || !r.vendor) continue;
    merged.set(r.code, r.vendor);
  }

  ensureDir(paths.configDir);
  writeJsonAtomic(paths.vendorsFile, {
    vendors: [...merged.values()].sort((a, b) => a.code.localeCompare(b.code)),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    mode: "commit",
    summary,
    rows: results.slice(0, 300).map(({ vendor, ...rest }) => rest),
    totalVendors: merged.size,
  });
}
