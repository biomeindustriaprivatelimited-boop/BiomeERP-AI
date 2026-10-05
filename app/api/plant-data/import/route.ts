import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { resolvePlantScope } from "@/lib/plantScope";
import { sheetPlant } from "@/lib/plantRegistry";
import { TRANSPORT_COLUMNS } from "@/lib/plantSheets";
import { normaliseRowWeights } from "@/lib/units";
import { recordAudit } from "@/lib/audit";
import {
  readRows, writeRows, newRowId, isEntryRole, canUnlock, type SheetKind, type SheetRow,
} from "@/lib/plantSheetStore";
import {
  readSheetWorkbook, checkSheetRows, plantPartners, MAX_IMPORT_ROWS, type RawSheetRow,
} from "@/lib/plantSheetImport";

/**
 * Importing previous data into ONE plant's biomass or transport sheet.
 *
 *   POST (form: file, kind, plant)  — read and check every row. Writes nothing.
 *   PUT  { kind, plant, fileName, rows: [{ rowNumber, values }] }
 *        — re-check those rows against the sheet as it is NOW and add the
 *          valid ones. The plant is the session's (a plant manager) or the
 *          one chosen (accounts / admin / developer) — never anything the
 *          rows themselves say.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

async function context(req: NextRequest, requestedPlant: unknown, kindIn: unknown) {
  const scoped = await resolvePlantScope(req, requestedPlant ? String(requestedPlant) : null);
  if ("response" in scoped) return { response: scoped.response };
  const user = findById(scoped.scope.userId);
  if (!(isEntryRole(scoped.scope.role) || canUnlock(user))) {
    return { response: NextResponse.json({ error: "Only the plant manager, accounts, admin or the developer import plant sheets." }, { status: 403 }) };
  }
  const plant = sheetPlant(scoped.scope.slug);
  if (!plant) return { response: NextResponse.json({ error: "That plant is not in the plant master." }, { status: 404 }) };
  const kind: SheetKind = kindIn === "transport" ? "transport" : "biomass";
  return { scope: scoped.scope, plant, kind, columns: kind === "transport" ? TRANSPORT_COLUMNS : plant.biomass };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });
  }
  const ctx = await context(req, form.get("plant"), form.get("kind"));
  if ("response" in ctx) return ctx.response;

  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is over 10 MB. Import a few months at a time." }, { status: 413 });
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name || "")) {
    return NextResponse.json({ error: "Upload an Excel file (.xlsx) — ideally the app's template." }, { status: 400 });
  }

  const parsed = readSheetWorkbook(Buffer.from(await file.arrayBuffer()), file.name || "", ctx.columns);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "The sheet has no rows under its headings (the example row is skipped)." }, { status: 400 });
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `That sheet has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.` }, { status: 413 });
  }

  const checks = checkSheetRows(parsed.rows, {
    kind: ctx.kind, columns: ctx.columns, existing: readRows(ctx.kind, ctx.scope.slug), partners: plantPartners(ctx.scope.slug),
  });
  const ok = checks.filter((c) => c.verdict === "ok").length;
  return NextResponse.json({
    plant: ctx.scope.slug,
    plantName: ctx.plant.name,
    kind: ctx.kind,
    fileName: file.name,
    sheet: parsed.sheet,
    ignoredColumns: parsed.ignoredColumns,
    exampleRowsSkipped: parsed.exampleRowsSkipped,
    summary: { total: checks.length, ok, errors: checks.length - ok, warnings: checks.filter((c) => c.warnings.length).length },
    checks,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const ctx = await context(req, body.plant, body.kind);
  if ("response" in ctx) return ctx.response;

  const incoming: RawSheetRow[] = (Array.isArray(body.rows) ? body.rows : [])
    .filter((r: any) => r && typeof r.values === "object" && r.values)
    .slice(0, MAX_IMPORT_ROWS)
    .map((r: any) => ({ rowNumber: Number(r.rowNumber) || 0, cells: r.values }));
  if (!incoming.length) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });

  const { kind, scope } = ctx;
  const existing = readRows(kind, scope.slug);
  // Checked again here: the sheet may have changed since the preview, and
  // the browser's copy of the rows is never trusted as-is.
  const checks = checkSheetRows(incoming, { kind, columns: ctx.columns, existing, partners: plantPartners(scope.slug) });

  const now = new Date().toISOString();
  let nextSr = existing.reduce((m, r) => Math.max(m, Number(r.srNo) || 0), 0);
  const added: SheetRow[] = [];
  const skipped: { rowNumber: number; label: string; why: string }[] = [];
  const fileName = String(body.fileName || "").slice(0, 160);
  for (const c of checks) {
    if (c.verdict !== "ok" || !c.values) {
      skipped.push({ rowNumber: c.rowNumber, label: c.label, why: c.errors.join("; ") });
      continue;
    }
    const v = normaliseRowWeights({ ...c.values });
    if (v.srNo === undefined || v.srNo === null || v.srNo === "") v.srNo = ++nextSr;
    else nextSr = Math.max(nextSr, Number(v.srNo) || 0);
    added.push({
      ...v,
      id: newRowId(kind),
      createdAt: now, createdBy: scope.userId, createdByName: scope.userName,
      updatedAt: now,
      // History arrives submitted: complete, and on the five-day clock from today.
      submittedAt: now, submittedBy: scope.userId, submittedByName: scope.userName,
      importSource: { file: fileName, rowNumber: c.rowNumber, at: now, by: scope.userName },
    });
  }

  if (added.length) writeRows(kind, scope.slug, [...existing, ...added]);

  recordAudit({
    action: "SHEET_ROWS_IMPORTED",
    userId: scope.userId, userName: scope.userName, role: scope.role,
    targetType: `${kind}-sheet`, targetId: scope.slug,
    targetLabel: `${added.length} ${kind} row${added.length === 1 ? "" : "s"} into ${ctx.plant.name}`,
    detail: `File "${fileName || "upload"}": ${added.length} imported${skipped.length ? `, ${skipped.length} skipped` : ""}.`,
    plant: scope.slug,
    outcome: added.length ? "ok" : "failed",
  });

  return NextResponse.json({ ok: true, plant: scope.slug, imported: added.length, skipped, rows: [...existing, ...added] });
}
