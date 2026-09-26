import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { paths, ensureDir, sanitizeSegment } from "@/lib/dataRoot";
import { loadPartners } from "@/lib/partners";
import { devStamp } from "@/lib/devEdit";
import { loadTrips } from "@/lib/coordination";
import { loadPoFile, savePoFile, blankPo, computeAll, computePo, poAnalytics, syncPurchaseOrders, checkConsumption, type PurchaseOrder, type PoConfig } from "@/lib/po";

/**
 * PO Control Center API.
 *  GET  ?view=list|analytics|config|check&poId=&qtyKg=
 *  POST { action: create|update|adjust|attach|status|config|reviewed|sync|renewal }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KG = 1000;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const view = req.nextUrl.searchParams.get("view") || "list";
  if (view === "analytics") return NextResponse.json(poAnalytics());
  if (view === "config") return NextResponse.json({ config: loadPoFile().config });
  if (view === "check") {
    const r = checkConsumption(String(req.nextUrl.searchParams.get("poId") || ""), Number(req.nextUrl.searchParams.get("qtyKg")) || 0);
    return NextResponse.json(r);
  }
  const { pos, config } = computeAll();
  const partyFilter = req.nextUrl.searchParams.get("party");
  const typeFilter = req.nextUrl.searchParams.get("type");
  const list = pos.filter((p) => (!partyFilter || p.partyKey === partyFilter || p.partyName === partyFilter) && (!typeFilter || p.type === typeFilter));
  const vendors = loadPartners().filter((p) => p.kind === "biomass_vendor").map((p) => ({ key: p.code || p.name, name: p.name }));
  let clients: string[] = [];
  try { clients = [...new Set(loadTrips().map((t) => t.client).filter(Boolean))]; } catch { /* none */ }
  try { const c = JSON.parse(fs.readFileSync(paths.clientsFile, "utf8")); for (const x of c.clients || []) if (!clients.includes(x.name)) clients.push(x.name); } catch { /* none */ }
  return NextResponse.json({ pos: list, config, vendors, clients });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));
  const f = loadPoFile();
  const audit = (action: string, po: PurchaseOrder | null, detail?: string) =>
    recordAudit({ action, userId: user.id, userName: user.name, role: user.role, targetType: "po", targetId: po?.id, targetLabel: po ? `${po.partyName} ${po.poNumber}` : undefined, detail });

  if (body.action === "sync") { const r = await syncPurchaseOrders({ id: user.id, name: user.name, role: user.role }); return NextResponse.json({ result: r }); }

  if (body.action === "config") {
    const perm = await requirePermission(req, "settings"); if ("response" in perm) return perm.response;
    const c = body.config || {};
    const list = (v: any) => (Array.isArray(v) ? v : String(v || "").split(/[,\s]+/)).map((x: string) => String(x).trim()).filter(Boolean);
    const next: PoConfig = {
      overConsumption: ["block", "approve", "exception"].includes(c.overConsumption) ? c.overConsumption : f.config.overConsumption,
      recipients: { vendorExhausted: list(c.recipients?.vendorExhausted), clientExhausted: list(c.recipients?.clientExhausted), lowBalance: list(c.recipients?.lowBalance), expiry: list(c.recipients?.expiry) },
      emailOnLowBalance: Boolean(c.emailOnLowBalance), emailOnExpiry: Boolean(c.emailOnExpiry),
      expiryAlertDays: (Array.isArray(c.expiryAlertDays) ? c.expiryAlertDays : f.config.expiryAlertDays).map(Number).filter((n: number) => n > 0).sort((a: number, b: number) => b - a),
      defaultThresholds: (Array.isArray(c.defaultThresholds) ? c.defaultThresholds : f.config.defaultThresholds).map(Number).filter((n: number) => n > 0 && n <= 100),
      defaultMinRemainingKg: Number(c.defaultMinRemainingMt) > 0 ? Number(c.defaultMinRemainingMt) * KG : f.config.defaultMinRemainingKg,
    };
    f.config = next; savePoFile(f); audit("po.config", null, JSON.stringify({ overConsumption: next.overConsumption }));
    return NextResponse.json({ config: next });
  }

  if (body.action === "create") {
    const po = blankPo({ id: user.id, name: user.name }, body.type === "client" ? "client" : "vendor", f.config);
    Object.assign(po, {
      partyKey: String(body.partyKey || body.partyName || "").trim(), partyName: String(body.partyName || "").trim(), poNumber: String(body.poNumber || "").trim(),
      workOrderNumber: String(body.workOrderNumber || ""), poDate: body.poDate || po.poDate, material: String(body.material || ""),
      totalQuantity: Number(body.totalQuantity) || 0, unit: body.unit === "KG" ? "KG" : "MT", rate: body.rate ? Number(body.rate) : null, value: body.value ? Number(body.value) : null,
      startDate: body.startDate || po.startDate, expiryDate: body.expiryDate || "", notes: String(body.notes || ""),
      thresholds: Array.isArray(body.thresholds) && body.thresholds.length ? body.thresholds.map(Number) : po.thresholds,
      // Absolute floor: explicit value, else the default capped at 20% of this PO so a small PO isn't born 'low'.
      minRemainingKg: Number(body.minRemainingMt) > 0 ? Number(body.minRemainingMt) * KG : Math.min(po.minRemainingKg, 0.2 * (Number(body.totalQuantity) || 0) * (body.unit === "KG" ? 1 : KG)),
      manualStatus: body.status === "draft" ? "draft" : null, status: body.status === "draft" ? "draft" : "active",
    });
    if (!po.partyName || !po.poNumber || po.totalQuantity <= 0) return NextResponse.json({ error: "Party, PO number and a total quantity are required." }, { status: 400 });
    if (f.pos.some((p) => p.type === po.type && p.partyKey === po.partyKey && p.poNumber === po.poNumber)) return NextResponse.json({ error: "That PO number already exists for this party." }, { status: 409 });
    f.pos.unshift(po); savePoFile(f); audit("po.create", po, `${po.totalQuantity} ${po.unit}`);
    return NextResponse.json({ po: computePo(po, safeTrips(), f.config) });
  }

  const po = f.pos.find((p) => p.id === body.id);
  if (!po) return NextResponse.json({ error: "PO not found." }, { status: 404 });
  const now = new Date().toISOString();

  if (body.action === "adjust") {
    // Sensitive fields: old/new/user/time/reason recorded; quantity and number changes.
    const reason = String(body.reason || "").trim();
    if (!reason) return NextResponse.json({ error: "A reason is required for PO adjustments." }, { status: 400 });
    const allowed: Record<string, (v: any) => any> = { totalQuantity: Number, poNumber: String, expiryDate: String, startDate: String, material: String, rate: (v) => (v ? Number(v) : null), value: (v) => (v ? Number(v) : null), notes: String, unit: (v) => (v === "KG" ? "KG" : "MT"), workOrderNumber: String };
    for (const [field, cast] of Object.entries(allowed)) {
      if (body[field] === undefined) continue;
      const oldValue = String((po as any)[field] ?? ""); const newValue = String(cast(body[field]) ?? "");
      if (oldValue === newValue) continue;
      (po as any)[field] = cast(body[field]);
      po.adjustments.push({ at: now, byId: user.id, byName: user.name, field, oldValue, newValue, reason });
      audit("po.adjust", po, `${field}: ${oldValue} → ${newValue} (${reason})`);
    }
    if (Array.isArray(body.thresholds)) po.thresholds = body.thresholds.map(Number).filter((n: number) => n > 0 && n <= 100);
    if (body.minRemainingMt !== undefined) po.minRemainingKg = Number(body.minRemainingMt) * KG;
    // Quantity went up? Exhaustion / thresholds may no longer hold — let alerts re-arm for the new size.
    if (body.totalQuantity !== undefined) po.alerted = {};
    po.updatedBy = user.id; po.updatedAt = now;
    Object.assign(po, devStamp({ ...po }, { ...po, adjustments: [] }, { name: user.name, role: user.role }, reason));
    savePoFile(f);
    return NextResponse.json({ po: computePo(po, safeTrips(), f.config) });
  }

  if (body.action === "status") {
    const s = body.status;
    if (!["active", "draft", "closed", "cancelled"].includes(s)) return NextResponse.json({ error: "Status must be active, draft, closed or cancelled." }, { status: 400 });
    po.manualStatus = s === "active" ? null : s; po.status = s; po.updatedBy = user.id; po.updatedAt = now; savePoFile(f);
    audit(`po.${s}`, po, body.reason ? String(body.reason) : undefined);
    return NextResponse.json({ po: computePo(po, safeTrips(), f.config) });
  }

  if (body.action === "attach" && body.fileBase64 && body.fileName) {
    const dir = path.join(paths.root, "po", po.id); ensureDir(dir);
    const name = sanitizeSegment(String(body.fileName)) || "po.pdf";
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(body.fileBase64), "base64"));
    po.attachment = { name, file: path.join("po", po.id, name) }; po.updatedAt = now; savePoFile(f); audit("po.attach", po, name);
    return NextResponse.json({ po: computePo(po, safeTrips(), f.config) });
  }

  if (body.action === "reviewed") { po.alerted[`reviewed:${body.key || "all"}`] = now; savePoFile(f); audit("po.reviewed", po, String(body.key || "all")); return NextResponse.json({ ok: true }); }

  if (body.action === "renewal") {
    // PO renewal / extension request → a Work task with the AI estimate.
    const { loadWork, saveWork, today } = await import("@/lib/work");
    const c = computePo(po, safeTrips(), f.config);
    const suggestedKg = c.avgDailyKg ? Math.round(c.avgDailyKg * 60) : Math.round((po.unit === "MT" ? po.totalQuantity * KG : po.totalQuantity));
    const w = loadWork();
    w.tasks.unshift({
      id: crypto.randomUUID(), key: `po:${po.id}:renewal`, kind: "followup", module: "PO Control", title: `PO renewal / extension — ${po.partyName} ${po.poNumber}`,
      why: `Remaining ${Math.round(c.remainingKg / KG)} MT${c.predictedExhaustionDays !== null ? `, predicted exhaustion in ${c.predictedExhaustionDays} day(s) (estimate)` : ""}${c.daysToExpiry !== null ? `, expiry in ${c.daysToExpiry} day(s)` : ""}.`,
      nextAction: `Initiate new PO / extension for an estimated ${Math.round(suggestedKg / KG)} MT (60 days at the current rate — an estimate, not a commitment).`,
      href: "/po", priority: "urgent", status: "open", source: "manual", ownerRoles: [po.type === "client" ? "coordinator" : "accounts", "admin"], assigneeId: null, assigneeName: null, plant: null,
      dueOn: today(), createdAt: now, updatedAt: now, resolvedAt: null, snoozedUntil: null, escalation: 0, followupStep: 0, amount: null, evidence: [`Requested by ${user.name}`],
    });
    saveWork(w); audit("po.renewal", po, `${Math.round(suggestedKg / KG)} MT suggested`);
    return NextResponse.json({ ok: true, suggestedMt: Math.round(suggestedKg / KG) });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

function safeTrips() { try { return loadTrips(); } catch { return []; } }
