/**
 * Biome AI OS — Document Intelligence Vault + Report Builder (server only)
 * -------------------------------------------------------------------
 * 32 · Vault: one index over every document the app holds — partner KYC,
 *      company documents, contracts, issue evidence, form uploads, PO
 *      attachments — with entity linking, duplicate detection, expiry
 *      intelligence and a search that tolerates different filenames and
 *      spellings (token + trigram similarity; honest "semantic-lite", no
 *      embedding model is shipped).
 * 37/38 · Reports: no-code and natural-language report specs over the
 *      app's data sources, executed server-side into rows + a chart series.
 */

import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadPartners, gapsFor } from "@/lib/partners";
import { loadContracts } from "@/lib/enterprise2";
import { loadIssues, loadForms } from "@/lib/ops";
import { loadPoFile, computeAll as computePos } from "@/lib/po";
import { loadTrips, derivedStatus, type Trip } from "@/lib/coordination";
import { loadEntries as loadImprestEntries, loadPeople } from "@/lib/imprest";
import { loadWork, daysBetween, today } from "@/lib/work";
import { loadEmployees } from "@/lib/payroll";

/* ------------------------------------------------------------------ */
/* Vault                                                               */
/* ------------------------------------------------------------------ */

export interface VaultDoc {
  id: string; source: "partner" | "company" | "contract" | "issue" | "form" | "po"; title: string; fileName: string; type: string;
  entity: { type: string; name: string } | null; date: string; expiresOn: string | null; text: string; href: string; size: number | null;
}

export function vaultIndex(): VaultDoc[] {
  const out: VaultDoc[] = [];
  for (const p of loadPartners()) for (const d of p.documents) out.push({ id: `partner:${p.id}:${d.id}`, source: "partner", title: d.label || d.type, fileName: d.fileName, type: d.type, entity: { type: p.kind === "transporter" ? "transporter" : "vendor", name: p.name }, date: d.documentDate || d.uploadedAt?.slice(0, 10) || "", expiresOn: d.validTill || null, text: `${d.label} ${d.type} ${d.reference || ""} ${p.name} ${p.code} ${p.gstin}`, href: "/partners", size: (d as any).size ?? null });
  try { for (const d of readJson<{ documents: any[] }>(path.join(paths.configDir, "company-documents.json"), { documents: [] }).documents) out.push({ id: `company:${d.id}`, source: "company", title: d.title || d.name || "Document", fileName: d.fileName || d.name || "", type: d.category || d.type || "company", entity: { type: "company", name: "Biome Industria" }, date: d.issuedOn || d.uploadedAt?.slice(0, 10) || "", expiresOn: d.expiresOn || null, text: `${d.title || ""} ${d.category || ""} ${d.notes || ""}`, href: "/company-documents", size: d.size ?? null }); } catch { /* none */ }
  for (const c of loadContracts()) out.push({ id: `contract:${c.id}`, source: "contract", title: c.title, fileName: c.attachment?.name || "", type: `contract · ${c.kind}`, entity: { type: c.partyType, name: c.party }, date: c.startDate, expiresOn: c.expiryDate || null, text: `${c.title} ${c.party} ${c.kind} ${c.notes} ${c.obligations.map((o) => o.text).join(" ")}`, href: "/contracts", size: null });
  for (const i of loadIssues()) for (const e of i.evidence) out.push({ id: `issue:${i.id}:${e.id}`, source: "issue", title: `${i.title} — evidence`, fileName: e.name, type: "evidence", entity: i.party ? { type: "party", name: i.party } : null, date: i.createdAt.slice(0, 10), expiresOn: null, text: `${i.title} ${i.description} ${i.party} ${e.ocrText || ""}`, href: "/issues", size: null });
  const forms = loadForms();
  for (const s of forms.submissions) for (const f of s.files) out.push({ id: `form:${s.id}:${f.fieldId}`, source: "form", title: `${forms.forms.find((x) => x.id === s.formId)?.name || "Form"} — ${f.name}`, fileName: f.name, type: "form upload", entity: null, date: s.submittedAt.slice(0, 10), expiresOn: null, text: Object.values(s.values).map(String).join(" "), href: "/forms", size: null });
  for (const p of loadPoFile().pos) if (p.attachment) out.push({ id: `po:${p.id}`, source: "po", title: `PO ${p.poNumber} — ${p.partyName}`, fileName: p.attachment.name, type: "purchase order", entity: { type: p.type, name: p.partyName }, date: p.poDate, expiresOn: p.expiryDate || null, text: `${p.poNumber} ${p.partyName} ${p.material} ${p.notes}`, href: "/po", size: null });
  return out;
}

const SYN: Record<string, string[]> = { contract: ["agreement", "mou", "karar"], gst: ["gstin", "gst certificate", "registration certificate"], pan: ["pan card"], cheque: ["cancelled cheque", "bank", "bank proof"], invoice: ["bill", "tax invoice"], weight: ["weighment", "kanta", "weight slip"], licence: ["license", "permit"], insurance: ["policy", "cover"], challan: ["delivery note", "dn"] };
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097F ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
const trigrams = (s: string) => { const t = ` ${s.toLowerCase()} `; const g = new Set<string>(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
function similarity(a: string, b: string) { const A = trigrams(a), B = trigrams(b); let hit = 0; for (const g of A) if (B.has(g)) hit++; return A.size ? hit / A.size : 0; }

export function vaultSearch(query: string, docs = vaultIndex()) {
  const q = query.toLowerCase().trim(); if (!q) return [];
  const qTokens = tokens(q);
  const expanded = new Set(qTokens);
  for (const [k, syns] of Object.entries(SYN)) if (q.includes(k) || syns.some((s) => q.includes(s))) { expanded.add(k); syns.forEach((s) => tokens(s).forEach((t) => expanded.add(t))); }
  return docs.map((d) => {
    const hay = `${d.title} ${d.fileName} ${d.type} ${d.entity?.name || ""} ${d.text}`.toLowerCase();
    const hayTokens = new Set(tokens(hay));
    let score = 0;
    for (const t of expanded) { if (hayTokens.has(t)) score += 3; else if (hay.includes(t)) score += 1.5; else { for (const h of hayTokens) if (h.length > 4 && similarity(t, h) >= 0.6) { score += 1; break; } } }
    if (d.entity && qTokens.some((t) => d.entity!.name.toLowerCase().includes(t))) score += 4;
    return { doc: d, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 60);
}

export function vaultIntelligence(docs = vaultIndex()) {
  const t0 = today();
  const dupes: { a: VaultDoc; b: VaultDoc; why: string }[] = [];
  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
    const a = docs[i], b = docs[j];
    if (a.fileName && a.fileName === b.fileName && a.entity?.name === b.entity?.name) dupes.push({ a, b, why: "same file name for the same party" });
    else if (a.type === b.type && a.entity?.name && a.entity.name === b.entity?.name && a.source === "partner" && b.source === "partner") dupes.push({ a, b, why: `two "${a.type}" documents for the same party — keep the newer` });
  }
  const expiring = docs.filter((d) => d.expiresOn && daysBetween(t0, d.expiresOn) <= 45).map((d) => ({ doc: d, days: daysBetween(t0, d.expiresOn!) })).sort((a, b) => a.days - b.days);
  const missing: { party: string; missing: string[] }[] = [];
  for (const p of loadPartners()) { const g = gapsFor(p); if (g.missing.length) missing.push({ party: p.name, missing: g.missing.map((m) => m.label) }); }
  return { total: docs.length, bySource: docs.reduce((m, d) => ({ ...m, [d.source]: (m[d.source] || 0) + 1 }), {} as Record<string, number>), duplicates: dupes.slice(0, 30), expiring: expiring.slice(0, 30), missing: missing.slice(0, 30) };
}

/* ------------------------------------------------------------------ */
/* Report builder — sources, spec, execution, NL parsing               */
/* ------------------------------------------------------------------ */

export interface ReportSpec { id?: string; name: string; source: "trips" | "imprest" | "tasks" | "pos" | "partners" | "issues" | "employees"; fields?: string[]; filters: { field: string; op: "is" | "is_not" | "contains" | "gt" | "lt"; value: string }[]; groupBy: string | null; groupByMonthOf: string | null; metric: { kind: "count" | "sum" | "avg"; field?: string }; dateField?: string; from?: string; to?: string; chart: "bar" | "line" | "table"; createdBy?: string; roles?: string[]; createdAt?: string }

export const SOURCES: Record<ReportSpec["source"], { label: string; fields: string[]; numeric: string[]; dates: string[] }> = {
  trips: { label: "Supplies / coordination", fields: ["client", "supplier", "vehicleNumber", "status", "business", "vehicleEntryDate", "receivingDate", "vendorChallanWeight", "receivingQty", "shortageKg", "lossPct", "invoiceAmount", "ourDocNo", "location"], numeric: ["vendorChallanWeight", "receivingQty", "shortageKg", "lossPct", "invoiceAmount"], dates: ["vehicleEntryDate", "receivingDate"] },
  imprest: { label: "Imprest entries", fields: ["person", "kind", "category", "amount", "date", "status", "mode"], numeric: ["amount"], dates: ["date"] },
  tasks: { label: "Work tasks", fields: ["module", "kind", "priority", "status", "assigneeName", "dueOn", "createdAt", "amount", "escalation"], numeric: ["amount", "escalation"], dates: ["dueOn", "createdAt"] },
  pos: { label: "Purchase orders", fields: ["type", "partyName", "poNumber", "effectiveStatus", "totalMt", "consumedMt", "remainingMt", "utilisationPct", "expiryDate", "poDate"], numeric: ["totalMt", "consumedMt", "remainingMt", "utilisationPct"], dates: ["poDate", "expiryDate"] },
  partners: { label: "Registrations", fields: ["name", "kind", "category", "status", "plants", "missingDocs", "expiredDocs", "createdAt"], numeric: ["missingDocs", "expiredDocs"], dates: ["createdAt"] },
  issues: { label: "Issues", fields: ["kind", "priority", "status", "party", "ownerName", "createdAt"], numeric: [], dates: ["createdAt"] },
  employees: { label: "Employees", fields: ["name", "code", "designation", "plant", "type", "active"], numeric: [], dates: [] },
};

export function sourceRows(source: ReportSpec["source"]): Record<string, any>[] {
  switch (source) {
    case "trips": return safeTrips().map((t) => { let status = "planned"; try { status = derivedStatus(t); } catch { /* keep */ } const disp = Number(t.vendorChallanWeight) || 0, rec = Number(t.receivingQty) || 0; return { client: t.client, supplier: t.supplier || t.supplierCode, vehicleNumber: t.vehicleNumber, status, business: t.business, vehicleEntryDate: t.vehicleEntryDate, receivingDate: t.receivingDate, vendorChallanWeight: disp, receivingQty: rec, shortageKg: disp && rec ? Math.max(0, disp - rec) : 0, lossPct: disp && rec ? Math.round(((disp - rec) / disp) * 1000) / 10 : 0, invoiceAmount: Number(t.billing?.totalAmount) || 0, ourDocNo: t.ourDocNo, location: t.location }; });
    case "imprest": { const people = loadPeople(); return loadImprestEntries().map((e) => ({ person: people.find((p) => p.id === e.personId)?.name || e.personId, kind: e.kind, category: e.category, amount: e.amount, date: e.date, status: e.status, mode: e.mode })); }
    case "tasks": return loadWork().tasks.map((t) => ({ module: t.module, kind: t.kind, priority: t.priority, status: t.status, assigneeName: t.assigneeName || "", dueOn: t.dueOn, createdAt: t.createdAt.slice(0, 10), amount: t.amount || 0, escalation: t.escalation }));
    case "pos": return computePos().pos.map((p) => ({ type: p.type, partyName: p.partyName, poNumber: p.poNumber, effectiveStatus: p.effectiveStatus, totalMt: p.unit === "MT" ? p.totalQuantity : p.totalQuantity / 1000, consumedMt: p.consumedKg / 1000, remainingMt: p.remainingKg / 1000, utilisationPct: p.utilisationPct, expiryDate: p.expiryDate, poDate: p.poDate }));
    case "partners": { return loadPartners().map((p) => { const g = gapsFor(p); return { name: p.name, kind: p.kind, category: p.category, status: p.status, plants: p.plants.join("/"), missingDocs: g.missing.length, expiredDocs: g.expired.length, createdAt: p.createdAt.slice(0, 10) }; }); }
    case "issues": return loadIssues().map((i) => ({ kind: i.kind, priority: i.priority, status: i.status, party: i.party, ownerName: i.ownerName || "", createdAt: i.createdAt.slice(0, 10) }));
    case "employees": try { return loadEmployees().map((e) => ({ name: e.name, code: e.code, designation: e.designation, plant: e.plant, type: (e as any).type || "", active: e.active })); } catch { return []; }
  }
}

export function runReport(spec: ReportSpec) {
  let rows = sourceRows(spec.source);
  const df = spec.dateField || SOURCES[spec.source].dates[0];
  if (df && spec.from) rows = rows.filter((r) => String(r[df] || "") >= spec.from!);
  if (df && spec.to) rows = rows.filter((r) => String(r[df] || "") <= spec.to!);
  for (const f of spec.filters || []) rows = rows.filter((r) => { const v = r[f.field]; const w = f.value; switch (f.op) { case "is": return String(v).toLowerCase() === w.toLowerCase(); case "is_not": return String(v).toLowerCase() !== w.toLowerCase(); case "contains": return String(v).toLowerCase().includes(w.toLowerCase()); case "gt": return Number(v) > Number(w); case "lt": return Number(v) < Number(w); } });
  const keyOf = (r: Record<string, any>) => { const parts: string[] = []; if (spec.groupByMonthOf) parts.push(String(r[spec.groupByMonthOf] || "").slice(0, 7) || "—"); if (spec.groupBy) parts.push(String(r[spec.groupBy] ?? "—")); return parts.join(" · ") || "All"; };
  const groups = new Map<string, Record<string, any>[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) || []), r]);
  const metric = (list: Record<string, any>[]) => { const k = spec.metric.kind; if (k === "count") return list.length; const vals = list.map((r) => Number(r[spec.metric.field || ""]) || 0); if (k === "sum") return Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100; return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0; };
  const series = [...groups.entries()].map(([label, list]) => ({ label, value: metric(list), rows: list.length })).sort((a, b) => (spec.groupByMonthOf ? a.label.localeCompare(b.label) : b.value - a.value)).slice(0, 60);
  const fields = spec.fields?.length ? spec.fields : SOURCES[spec.source].fields.slice(0, 8);
  return { rows: rows.slice(0, 500).map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))), fields, series, total: rows.length, metricLabel: `${spec.metric.kind}${spec.metric.field ? ` of ${spec.metric.field}` : ""}` };
}

/** Natural-language → spec. Rule-based, explains what it could not map. */
export function parseNaturalReport(text: string): { spec: ReportSpec; notes: string[] } {
  const q = text.toLowerCase(); const notes: string[] = [];
  const source: ReportSpec["source"] = /supply|supplies|trip|weight|discrepan|shortage|vehicle|client|vendor delivery/.test(q) ? "trips" : /imprest|expense|spend|petty/.test(q) ? "imprest" : /\bpo\b|purchase order|work order/.test(q) ? "pos" : /task|follow.?up|pending work/.test(q) ? "tasks" : /registration|kyc|partner/.test(q) ? "partners" : /issue|incident|complaint/.test(q) ? "issues" : /employee|staff|headcount/.test(q) ? "employees" : "trips";
  const src = SOURCES[source];
  const spec: ReportSpec = { name: text.slice(0, 80), source, filters: [], groupBy: null, groupByMonthOf: null, metric: { kind: "count" }, chart: "bar" };
  if (/monthly|per month|by month|month/.test(q) && src.dates[0]) { spec.groupByMonthOf = src.dates[0]; spec.chart = "line"; }
  const by = q.match(/by (client|vendor|supplier|vehicle|plant|category|person|status|party|module|kind|priority|department|designation)/);
  if (by) { const map: Record<string, string> = { client: "client", vendor: "supplier", supplier: "supplier", vehicle: "vehicleNumber", plant: source === "employees" ? "plant" : "location", category: "category", person: "person", status: source === "trips" ? "status" : source === "pos" ? "effectiveStatus" : "status", party: source === "pos" ? "partyName" : "party", module: "module", kind: "kind", priority: "priority", department: "designation", designation: "designation" }; spec.groupBy = map[by[1]] && src.fields.includes(map[by[1]]) ? map[by[1]] : null; if (!spec.groupBy) notes.push(`Could not group by "${by[1]}" for ${src.label}.`); }
  if (/volume|quantity|weight|tonnage|mt\b/.test(q) && source === "trips") spec.metric = { kind: "sum", field: "vendorChallanWeight" };
  if (/discrepan|shortage|loss/.test(q) && source === "trips") { spec.metric = { kind: "sum", field: "shortageKg" }; if (/only|with shortage|short loads/.test(q)) spec.filters.push({ field: "status", op: "is", value: "shortage" }); }
  if (/amount|spend|cost|value|rupee|₹/.test(q)) { const f = src.numeric.find((n) => /amount|value/i.test(n)); if (f) spec.metric = { kind: "sum", field: f }; }
  if (/average|avg|mean/.test(q) && spec.metric.field) spec.metric.kind = "avg";
  if (/remaining|balance/.test(q) && source === "pos") spec.metric = { kind: "sum", field: "remainingMt" };
  const months = q.match(/last (\d+) months?/); if (months) { const d = new Date(); d.setMonth(d.getMonth() - Number(months[1])); spec.from = d.toISOString().slice(0, 10); }
  if (/this month/.test(q)) spec.from = today().slice(0, 7) + "-01";
  if (/last month/.test(q)) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); spec.from = d.toISOString().slice(0, 10); const e = new Date(); e.setDate(0); spec.to = e.toISOString().slice(0, 10); }
  if (/table|list/.test(q)) spec.chart = "table";
  notes.push(`Source: ${src.label}. Metric: ${spec.metric.kind}${spec.metric.field ? ` of ${spec.metric.field}` : ""}.${spec.groupBy ? ` Grouped by ${spec.groupBy}.` : ""}${spec.groupByMonthOf ? " Per month." : ""}${spec.from ? ` From ${spec.from}.` : ""}`);
  notes.push("Limits: figures come from the app's own records (not Tally); text is matched by keywords — adjust the spec if a field was mis-read.");
  return { spec, notes };
}

const reports = { load: () => readJson<{ reports: ReportSpec[] }>(path.join(paths.root, "work", "reports.json"), { reports: [] }).reports, save: (list: ReportSpec[]) => { ensureDir(path.join(paths.root, "work")); writeJsonAtomic(path.join(paths.root, "work", "reports.json"), { reports: list }); } };
export function loadReports() { return reports.load(); }
export function saveReport(spec: ReportSpec, by: string) { const list = reports.load(); const s = { ...spec, id: spec.id || crypto.randomUUID(), createdBy: by, createdAt: new Date().toISOString() }; reports.save([s, ...list.filter((r) => r.id !== s.id)]); return s; }
export function deleteReport(id: string) { reports.save(reports.load().filter((r) => r.id !== id)); }

function safeTrips(): Trip[] { try { return loadTrips(); } catch { return []; } }
