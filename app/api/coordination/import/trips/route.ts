import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadTrips, saveTrips } from "@/lib/coordination";
import {
  readWorkbook, loadImportContext, checkRows, summariseChecks, buildTrips,
  registerImportedNumbers, fileFingerprint, RowCheck,
} from "@/lib/coordinationImport";
import { recordAudit } from "@/lib/audit";
import { agentFetch } from "@/lib/whatsappAgent";

/**
 * Importing previous working data (challan, tax invoice, receiving, lab
 * report) into the coordination register, from the app's template.
 *
 * One endpoint, two steps:
 *   mode=check     parse and report, per consignment, what is missing and
 *                  what is wrong. Writes nothing.
 *   mode=all       import every row without errors (gaps allowed).
 *   mode=complete  import only rows with no errors AND nothing missing.
 *
 * The commit re-reads the same file and checks it again against the
 * register as it is NOW, so a trip someone added between the two steps
 * can never be duplicated. The fingerprint ties the commit to the file the
 * person actually looked at.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

/** What the browser needs to show a row — never the internal body. */
function publicRow(c: RowCheck) {
  const { body: _body, ...rest } = c;
  void _body;
  return rest;
}

export async function POST(req: NextRequest) {
  // Same key as adding a trip by hand (coordinator, accounts, admin, developer).
  const auth = await requirePermission(req, "vendors");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid);
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });
  }
  const file = form.get("file");
  const mode = String(form.get("mode") || "check");
  const fallback = form.get("business") === "manufacturing" ? "manufacturing" : "trading";
  if (!["check", "all", "complete"].includes(mode)) {
    return NextResponse.json({ error: "Unknown import mode." }, { status: 400 });
  }
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 10 MB. Split it by month and import each part." }, { status: 413 });
  }
  const name = (file as File).name || "import.xlsx";
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(name)) {
    return NextResponse.json({ error: "Upload the template as .xlsx (or a .csv saved from it)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fingerprint = fileFingerprint(buffer);
  const parsed = readWorkbook(buffer, name, fallback);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "The template has no consignments under its headings (the example row is skipped)." }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `That file has ${parsed.rows.length} rows. Import up to ${MAX_ROWS} at a time.` }, { status: 413 });
  }

  const trips = loadTrips();
  const checks = checkRows(parsed.rows, loadImportContext(trips));
  const summary = summariseChecks(checks);

  if (mode === "check") {
    return NextResponse.json({
      file: name, fingerprint,
      sheetsRead: parsed.sheetsRead,
      ignoredColumns: parsed.ignoredColumns,
      exampleRowsSkipped: parsed.exampleRowsSkipped,
      summary,
      rows: checks.map(publicRow),
    });
  }

  const seen = String(form.get("fingerprint") || "");
  if (seen && seen !== fingerprint) {
    return NextResponse.json({ error: "This is not the file that was checked. Check it again before importing." }, { status: 409 });
  }

  const chosen = checks.filter((c) => c.body && (mode === "all" || c.verdict === "ok"));
  const skipped = checks
    .filter((c) => !chosen.includes(c))
    .map((c) => ({
      sheet: c.sheet, row: c.rowNumber, label: c.label,
      why: c.verdict === "error" ? c.errors.join(" ") : `Missing: ${c.missing.join(", ")}`,
    }));
  if (!chosen.length) {
    return NextResponse.json(
      { error: mode === "complete" ? "No row is complete — nothing was imported." : "Every row has an error — nothing was imported.", skipped, summary },
      { status: 400 }
    );
  }

  const fresh = buildTrips(chosen, trips, { id: user.id, name: user.name }, name);
  saveTrips([...trips, ...fresh]);
  registerImportedNumbers(fresh, { id: user.id, name: user.name });

  // Imported trips are matching anchors for WhatsApp papers too.
  agentFetch("/staged/sweep", { method: "POST", timeoutMs: 15000 }).catch(() => { /* agent off */ });

  const withGaps = chosen.filter((c) => c.verdict === "missing").length;
  const byReg = (r: string) => fresh.filter((t) => t.business === r).length;
  recordAudit({
    action: "COORDINATION_DATA_IMPORTED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "coordination", targetId: "data-import",
    targetLabel: `${fresh.length} trip${fresh.length === 1 ? "" : "s"} from ${name}`.slice(0, 120),
    detail: `Historical data import (${mode === "all" ? "all valid rows" : "complete rows only"}): ${byReg("trading")} trading, ${byReg("manufacturing")} manufacturing; ${withGaps} with missing data; ${skipped.length} row(s) not imported. File ${fingerprint}.`,
  });

  return NextResponse.json({
    imported: fresh.length,
    withMissing: withGaps,
    trips: fresh.map((t, i) => ({ serial: t.serial, business: t.business, sheet: chosen[i].sheet, row: chosen[i].rowNumber, label: chosen[i].label })),
    skipped,
    summary,
  });
}
