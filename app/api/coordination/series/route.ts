import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import {
  loadSeriesFile, saveSeriesFile, previewNext, formatSeriesNumber, hasSeqToken, resolvedPattern,
  NumberSeries, DOC_TYPES, NUMBERING_METHODS, methodOf, defaultVoucherType, financialYearFor,
} from "@/lib/numberSeries";
import { loadPlants, STATES } from "@/lib/plants";
import { recordAudit } from "@/lib/audit";

/**
 * The number-series master — invoice, challan and other voucher books.
 *
 * Readable by anyone who can see coordination: a coordinator needs to know
 * which books exist and what the next number will be. Adding, changing or
 * retiring a book needs "series.manage" (accounts, admin, developer — and
 * anyone the developer grants it to), checked HERE, because moving a count
 * is how a book ends up with a duplicate or a hole, and both are found much
 * later by someone else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManage(user: { role: any; access?: any }): boolean {
  return effectivePermissions(user.role, user.access).includes("series.manage");
}

const DENIED = "Only accounts, an admin or the developer can manage number series.";

const upList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim().toUpperCase()).filter(Boolean))]
    : String(v ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))]
    : String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const scopeKey = (s: Pick<NumberSeries, "plants" | "states">) =>
  `${[...(s.plants || [])].sort().join(",")}|${[...(s.states || [])].sort().join(",")}`;

/** Rules every saved series must pass — the same for add and edit. */
function validate(s: NumberSeries, others: NumberSeries[], issued: { number: string }[]): string | null {
  if (!s.name.trim()) return "Give the series a name.";
  if (!hasSeqToken(s.pattern)) return "The format must contain {n} (or {SEQ}) — that is where the running number goes.";
  if (s.minDigits > 10) return "Padding above 10 digits is not a real number book.";
  if (others.some((o) => o.name.trim().toLowerCase() === s.name.trim().toLowerCase())) {
    return `A series called "${s.name}" already exists.`;
  }
  // Two books printing the same numbers would hand one number to two documents.
  const mine = resolvedPattern(s);
  const twin = others.find((o) => resolvedPattern(o) === mine);
  if (twin) return `"${twin.name}" already prints numbers in this exact format (${mine}). Change the prefix, suffix or format.`;
  const next = formatSeriesNumber(s, s.nextSeq);
  if (issued.some((i) => i.number.trim().toUpperCase() === next.trim().toUpperCase())) {
    return `That would issue ${next} again — it is already on the books. Set the next number past the last one actually used.`;
  }
  return null;
}

function readSeries(body: any, before: NumberSeries | undefined): NumberSeries {
  const b = before;
  const pick = <T,>(key: string, read: (v: any) => T, fallback: T): T => (body[key] !== undefined ? read(body[key]) : fallback);
  const docType = pick("docType", (v) => (v === "tax_invoice" ? "tax_invoice" : "delivery_challan"), b?.docType || "tax_invoice") as NumberSeries["docType"];
  return {
    ...(b || ({} as NumberSeries)),
    id: b?.id || "",
    name: pick("name", (v) => String(v).trim().slice(0, 80), b?.name || ""),
    docType,
    voucherType: pick("voucherType", (v) => String(v).trim().slice(0, 60), b?.voucherType || "") || defaultVoucherType(docType),
    business: pick("business", (v) => (["trading", "manufacturing", "both"].includes(v) ? v : "both"), b?.business || "both"),
    prefix: pick("prefix", (v) => String(v).trim().slice(0, 30), b?.prefix || ""),
    suffix: pick("suffix", (v) => String(v).trim().slice(0, 30), b?.suffix || ""),
    pattern: pick("pattern", (v) => String(v).trim().slice(0, 80), b?.pattern || "{PREFIX}/{FYSHORT}/{SEQ}") || b?.pattern || "",
    minDigits: pick("minDigits", (v) => (Number(v) > 0 ? Math.trunc(Number(v)) : 1), b?.minDigits || 1),
    nextSeq: pick("nextSeq", (v) => (Number(v) > 0 ? Math.trunc(Number(v)) : 1), b?.nextSeq || 1),
    resetOn: pick("resetOn", (v) => (v === "financial_year" ? "financial_year" : "never"), b?.resetOn || "never"),
    fy: pick("fy", (v) => String(v).trim(), b?.fy || "") || b?.fy || financialYearFor(new Date()),
    clientHints: pick("clientHints", strList, b?.clientHints || []),
    plants: pick("plants", upList, b?.plants || []),
    states: pick("states", upList, b?.states || []),
    isDefault: pick("isDefault", (v) => v === true, b?.isDefault === true),
    note: pick("note", (v) => String(v).slice(0, 500), b?.note || ""),
    active: pick("active", (v) => v !== false, b ? b.active : true),
    method: pick("method", (v) => methodOf({ method: v }), methodOf(b)),
  };
}

/** Only one default per document type within the same plant / state scope. */
function settleDefault(all: NumberSeries[], s: NumberSeries): string[] {
  if (!s.isDefault) return [];
  const cleared: string[] = [];
  for (const o of all) {
    if (o.id !== s.id && o.isDefault && o.docType === s.docType && scopeKey(o) === scopeKey(s)) {
      o.isDefault = false;
      cleared.push(o.name);
    }
  }
  return cleared;
}

function view(s: NumberSeries) {
  return { ...s, method: methodOf(s), next: previewNext(s), resolved: resolvedPattern(s) };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const manage = canManage(user);

  const f = loadSeriesFile();
  return NextResponse.json({
    series: f.series.map(view),
    methods: NUMBERING_METHODS,
    // The full issued list is for the people who keep the books.
    issued: manage ? f.issued.slice(0, 50) : [],
    docTypes: DOC_TYPES,
    plants: loadPlants().filter((p) => p.active).map((p) => ({ code: p.code, label: p.label, state: p.state })),
    states: STATES.map((s) => ({ code: s.code, label: s.label })),
    canEdit: manage,
    canManage: manage,
    seededAt: f.seededAt,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canManage(user)) return NextResponse.json({ error: DENIED }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const f = loadSeriesFile();
  const series = readSeries(body, undefined);
  const base = series.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "series";
  let id = base;
  for (let n = 2; f.series.some((s) => s.id === id); n++) id = `${base}-${n}`;
  const now = new Date().toISOString();
  Object.assign(series, { id, builtIn: false, createdAt: now, createdBy: user.name, updatedAt: now, updatedBy: user.name });
  if (!body.fy) series.fy = financialYearFor(now.slice(0, 10));

  const problem = validate(series, f.series, f.issued);
  if (problem) return NextResponse.json({ error: problem }, { status: problem.includes("already") ? 409 : 400 });

  const cleared = settleDefault(f.series, series);
  f.series = [...f.series, series];
  saveSeriesFile(f);

  recordAudit({
    action: "SERIES_CREATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "series", targetId: series.id, targetLabel: series.name,
    detail: `${series.voucherType} · ${series.pattern}${series.prefix ? ` (prefix ${series.prefix})` : ""} starting at ${previewNext(series)}${
      series.plants?.length ? ` · plants ${series.plants.join(",")}` : ""}${series.states?.length ? ` · states ${series.states.join(",")}` : ""}${
      cleared.length ? ` · now the default (was: ${cleared.join(", ")})` : ""}`,
  });

  return NextResponse.json({ series: view(series) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "coordination");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!canManage(user)) return NextResponse.json({ error: DENIED }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which series?" }, { status: 400 });

  const f = loadSeriesFile();
  const index = f.series.findIndex((s) => s.id === body.id);
  if (index === -1) return NextResponse.json({ error: "That series no longer exists." }, { status: 404 });

  const before = { ...f.series[index] };
  const updated = readSeries(body, before);
  updated.updatedAt = new Date().toISOString();
  updated.updatedBy = user.name;

  const problem = validate(updated, f.series.filter((s) => s.id !== updated.id), f.issued);
  if (problem) return NextResponse.json({ error: problem }, { status: problem.includes("already") || problem.includes("again") ? 409 : 400 });

  const cleared = settleDefault(f.series, updated);
  f.series[index] = updated;
  saveSeriesFile(f);

  const changes: string[] = [];
  const diff = (label: string, a: unknown, b: unknown) => {
    const x = Array.isArray(a) ? a.join(",") : String(a ?? "");
    const y = Array.isArray(b) ? b.join(",") : String(b ?? "");
    if (x !== y) changes.push(`${label} ${x || "—"} → ${y || "—"}`);
  };
  diff("name", before.name, updated.name);
  diff("voucher type", before.voucherType, updated.voucherType);
  diff("document type", before.docType, updated.docType);
  diff("prefix", before.prefix, updated.prefix);
  diff("suffix", before.suffix, updated.suffix);
  diff("format", before.pattern, updated.pattern);
  diff("padding", before.minDigits, updated.minDigits);
  diff("next number", before.nextSeq, updated.nextSeq);
  diff("restart", before.resetOn, updated.resetOn);
  diff("register", before.business, updated.business);
  diff("plants", before.plants, updated.plants);
  diff("states", before.states, updated.states);
  diff("clients", before.clientHints, updated.clientHints);
  diff("numbering", methodOf(before), methodOf(updated));
  if (before.isDefault !== updated.isDefault) changes.push(updated.isDefault ? "made default" : "no longer default");
  if (before.active !== updated.active) changes.push(updated.active ? "switched on" : "deactivated");
  if (cleared.length) changes.push(`default taken from ${cleared.join(", ")}`);

  recordAudit({
    action: before.active && !updated.active ? "SERIES_DEACTIVATED" : "SERIES_UPDATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "series", targetId: updated.id, targetLabel: updated.name,
    detail: changes.join("; ") || "no change",
  });

  return NextResponse.json({ series: view(updated) });
}
