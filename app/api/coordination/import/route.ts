import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission, findById } from "@/lib/authServer";
import { loadTrips, saveTrips, lockStateFor } from "@/lib/coordination";
import { hasPermission } from "@/lib/permissions";
import {
  detectColumns, readRows, matchRows, summariseImport,
  ImportMapping, BLANK_MAPPING, MatchTarget,
} from "@/lib/tallyImport";
import { recordAudit } from "@/lib/audit";
import { isOverrideActive } from "@/lib/override";

/**
 * Bringing the billed figures in from Tally.
 *
 * Two calls, always. POST parses and reports; PUT writes only the rows a
 * person confirmed on screen. The reason is the same one behind every
 * other import in this app: an import that writes on upload is discovered
 * to be wrong afterwards, and afterwards is too late in a register that
 * feeds invoices.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

function readMapping(v: any): ImportMapping | null {
  if (!v || typeof v !== "object") return null;
  const out: ImportMapping = { ...BLANK_MAPPING };
  (Object.keys(BLANK_MAPPING) as (keyof ImportMapping)[]).forEach((k) => {
    out[k] = String(v[k] ?? "").trim();
  });
  return out;
}

function targets(business: string): MatchTarget[] {
  return loadTrips()
    .filter((t) => t.business === business && t.status !== "cancelled")
    .map((t) => ({
      id: t.id,
      serial: t.serial,
      ourDocNo: t.ourDocNo || "",
      vehicleNumber: t.vehicleNumber || "",
      client: t.client || "",
      vehicleEntryDate: t.vehicleEntryDate || "",
      receivingDate: t.receivingDate || "",
      ourDocDate: t.ourDocDate || "",
      billedAlready: Boolean(t.billing?.totalAmount),
    }));
}

/** Parse the upload and report what it would do. Writes nothing. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });
  }

  const file = form.get("file");
  const business = String(form.get("business") || "trading");
  const mappingOverride = readMapping(safeJson(form.get("mapping")));

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 10 MB. Export a single month at a time." }, { status: 413 });
  }

  let raw: Record<string, any>[];
  let headers: string[];
  let sheetNames: string[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
    sheetNames = workbook.SheetNames;
    const wanted = String(form.get("sheet") || "") || sheetNames[0];
    const sheet = workbook.Sheets[wanted] || workbook.Sheets[sheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "That workbook has no readable sheet." }, { status: 400 });
    raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    headers = Object.keys(raw[0] || {});
  } catch (err) {
    return NextResponse.json(
      { error: `That file could not be read as a spreadsheet: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (!raw.length) return NextResponse.json({ error: "The sheet has no rows under its header." }, { status: 400 });
  if (raw.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That sheet has ${raw.length} rows. Import up to ${MAX_ROWS} at a time.` },
      { status: 413 }
    );
  }

  const mapping = mappingOverride && Object.values(mappingOverride).some(Boolean)
    ? mappingOverride
    : detectColumns(headers);

  const rows = readRows(raw, mapping);
  const matches = matchRows(rows, targets(business));

  return NextResponse.json({
    headers,
    sheetNames,
    mapping,
    // Returned so the confirm step needs no second upload — the browser
    // holds the parsed rows between the two calls.
    matches,
    summary: summariseImport(matches),
  });
}

/** Write the confirmed rows. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  // Same rule as a hand edit: being an admin is not enough to write over a
  // frozen row from a spreadsheet. An import touches many rows at once, so
  // this is the LAST place to make an exception.
  const isAdmin = hasPermission(user.role, "users") && isOverrideActive(user.id);

  const body = await req.json().catch(() => null);
  const apply = Array.isArray(body?.apply) ? body.apply : null;
  if (!apply) return NextResponse.json({ error: "Nothing to apply." }, { status: 400 });

  const trips = loadTrips();
  const now = new Date().toISOString();

  let written = 0;
  const skipped: { tripSerial: number; why: string }[] = [];

  for (const item of apply) {
    const trip = trips.find((t) => t.id === String(item?.tripId || ""));
    if (!trip) {
      skipped.push({ tripSerial: 0, why: `Trip ${item?.tripId} no longer exists.` });
      continue;
    }

    // The freeze holds for imports too. A month-old row quietly regaining
    // new figures through a file upload is exactly the hole the freeze was
    // asked for, and an import is the easiest place to forget it.
    const lock = lockStateFor(trip);
    if (lock.locked && !isAdmin) {
      skipped.push({ tripSerial: trip.serial, why: "Frozen — needs an admin's approval, or Override switched on." });
      continue;
    }

    trip.billing = {
      invoiceDate: String(item.invoiceDate || "").slice(0, 10),
      invoiceWeightKg: Number(item.weightKg) || 0,
      taxableAmount: Number(item.taxable) || 0,
      taxAmount: Number(item.tax) || 0,
      totalAmount: Number(item.total) || 0,
      source: "tally-import",
      importedAt: now,
      importedBy: user.name,
    };
    // The document number is filled only when the register has none. An
    // import must never rename a document that has already been issued.
    const docNo = String(item.docNo || "").trim();
    if (docNo && !trip.ourDocNo) {
      trip.ourDocNo = docNo;
      trip.biomeChallanNo = docNo;
      trip.ourDocManual = true;
    }
    if (!trip.ourDocDate && trip.billing.invoiceDate) trip.ourDocDate = trip.billing.invoiceDate;
    trip.updatedAt = now;
    written += 1;
  }

  saveTrips(trips);

  recordAudit({
    action: "COORDINATION_BILLING_IMPORTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "coordination", targetId: "tally-import",
    targetLabel: `${written} row${written === 1 ? "" : "s"}`,
    detail: `Billing figures imported from Tally.${skipped.length ? ` ${skipped.length} skipped.` : ""}`,
  });

  return NextResponse.json({ written, skipped });
}

function safeJson(v: FormDataEntryValue | null): any {
  if (typeof v !== "string" || !v.trim()) return null;
  try { return JSON.parse(v); } catch { return null; }
}
