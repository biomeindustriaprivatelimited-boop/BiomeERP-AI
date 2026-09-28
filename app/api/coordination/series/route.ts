import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadSeriesFile, saveSeriesFile, previewNext, formatSeriesNumber,
  NumberSeries, DOC_TYPES, NUMBERING_METHODS, methodOf,
} from "@/lib/numberSeries";
import { recordAudit } from "@/lib/audit";

/**
 * The invoice and challan number books.
 *
 * Readable by anyone who can see coordination — a coordinator needs to
 * know what the next number will be. Only an admin may change a pattern or
 * move a count, because moving a count is how a book ends up with a
 * duplicate or a hole, and both are found much later by someone else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canEdit(role: string): boolean {
  return hasPermission(role as any, "settings");
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const f = loadSeriesFile();
  return NextResponse.json({
    series: f.series.map((s) => ({ ...s, method: methodOf(s), next: previewNext(s) })),
    methods: NUMBERING_METHODS,
    issued: f.issued.slice(0, 50),
    docTypes: DOC_TYPES,
    canEdit: canEdit(user.role),
    seededAt: f.seededAt,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canEdit(user.role)) {
    return NextResponse.json({ error: "Only an admin can add a number series." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const pattern = String(body?.pattern ?? "").trim();
  if (!name || !pattern) return NextResponse.json({ error: "A name and a pattern are required." }, { status: 400 });
  if (!pattern.includes("{SEQ}")) {
    return NextResponse.json(
      { error: "The pattern must contain {SEQ} — that is where the running number goes." },
      { status: 400 }
    );
  }

  const f = loadSeriesFile();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `series-${Date.now()}`;
  if (f.series.some((s) => s.id === id)) {
    return NextResponse.json({ error: `A series called "${name}" already exists.` }, { status: 409 });
  }

  const series: NumberSeries = {
    id,
    name,
    docType: body.docType === "tax_invoice" ? "tax_invoice" : "delivery_challan",
    business: ["trading", "manufacturing", "both"].includes(body.business) ? body.business : "both",
    pattern,
    minDigits: Number(body.minDigits) > 0 ? Number(body.minDigits) : 1,
    nextSeq: Number(body.nextSeq) > 0 ? Math.trunc(Number(body.nextSeq)) : 1,
    resetOn: body.resetOn === "financial_year" ? "financial_year" : "never",
    fy: String(body.fy || "").trim() || new Date().toISOString().slice(0, 4),
    clientHints: Array.isArray(body.clientHints) ? body.clientHints.map(String) : [],
    note: String(body.note ?? "").slice(0, 500),
    active: body.active !== false,
    method: methodOf({ method: body.method }),
  };

  f.series = [...f.series, series];
  saveSeriesFile(f);

  recordAudit({
    action: "SERIES_CREATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "series", targetId: series.id, targetLabel: series.name,
    detail: `${series.pattern} starting at ${previewNext(series)}`,
  });

  return NextResponse.json({ series: { ...series, next: previewNext(series) } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canEdit(user.role)) {
    return NextResponse.json({ error: "Only an admin can change a number series." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which series?" }, { status: 400 });

  const f = loadSeriesFile();
  const index = f.series.findIndex((s) => s.id === body.id);
  if (index === -1) return NextResponse.json({ error: "That series no longer exists." }, { status: 404 });

  const before = f.series[index];
  const updated: NumberSeries = {
    ...before,
    name: body.name !== undefined ? String(body.name).trim() || before.name : before.name,
    pattern: body.pattern !== undefined ? String(body.pattern).trim() || before.pattern : before.pattern,
    minDigits: body.minDigits !== undefined && Number(body.minDigits) > 0 ? Math.trunc(Number(body.minDigits)) : before.minDigits,
    nextSeq: body.nextSeq !== undefined && Number(body.nextSeq) > 0 ? Math.trunc(Number(body.nextSeq)) : before.nextSeq,
    resetOn: body.resetOn !== undefined ? (body.resetOn === "financial_year" ? "financial_year" : "never") : before.resetOn,
    fy: body.fy !== undefined ? String(body.fy).trim() || before.fy : before.fy,
    business: body.business !== undefined && ["trading", "manufacturing", "both"].includes(body.business) ? body.business : before.business,
    clientHints: Array.isArray(body.clientHints) ? body.clientHints.map(String) : before.clientHints,
    note: body.note !== undefined ? String(body.note).slice(0, 500) : before.note,
    active: body.active !== undefined ? body.active !== false : before.active,
    method: body.method !== undefined ? methodOf({ method: body.method }) : methodOf(before),
  };

  if (!updated.pattern.includes("{SEQ}")) {
    return NextResponse.json({ error: "The pattern must contain {SEQ}." }, { status: 400 });
  }

  // Moving the count backwards over numbers already handed out would put
  // two documents on one number. Say which one, so it can be fixed rather
  // than guessed at.
  const nextNumber = formatSeriesNumber(updated, updated.nextSeq);
  const clash = f.issued.find((i) => i.number === nextNumber);
  if (clash) {
    return NextResponse.json(
      {
        error: `That would issue ${nextNumber} again — it is already on trip ${clash.tripId ? `#${clash.seq || ""}` : "record"} from ${clash.at.slice(0, 10)}. Set the count past the last number actually used.`,
      },
      { status: 409 }
    );
  }

  f.series[index] = updated;
  saveSeriesFile(f);

  const changes: string[] = [];
  if (before.pattern !== updated.pattern) changes.push(`pattern ${before.pattern} → ${updated.pattern}`);
  if (before.nextSeq !== updated.nextSeq) changes.push(`next count ${before.nextSeq} → ${updated.nextSeq}`);
  if (before.minDigits !== updated.minDigits) changes.push(`padding ${before.minDigits} → ${updated.minDigits}`);
  if (before.active !== updated.active) changes.push(updated.active ? "switched on" : "switched off");
  if (methodOf(before) !== methodOf(updated)) changes.push(`numbering ${methodOf(before)} → ${methodOf(updated)}`);
  if (before.name !== updated.name) changes.push(`name ${before.name} → ${updated.name}`);

  recordAudit({
    action: "SERIES_UPDATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "series", targetId: updated.id, targetLabel: updated.name,
    detail: changes.join("; ") || "no change",
  });

  return NextResponse.json({ series: { ...updated, next: previewNext(updated) } });
}
