/**
 * Biome Platform — spare parts & machinery: server helpers
 * -------------------------------------------------------------------
 * The module is procurement's. Who may do what is decided by permission
 * keys, never by role names, so a new role or a one-off grant behaves the
 * same way:
 *
 *   stock          the whole module (requirements, POs, GRNs, stock,
 *                  machines, maintenance). Without `stock.manage` the
 *                  person is pinned to the plant they signed in for.
 *   stock.manage   every plant, masters, adjustments, transfers, cancels
 *   stock.approve  approve adjustments, reopen a FINAL GRN
 *   stock.indent   raise a requirement for MY plant, follow its status
 *   stock.view     read-only purchases, values and spend
 *
 * PDFs, Excel and the vendor email are built here so the procurement
 * screen and the read-only accounts view produce the same documents.
 */

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import type { Permission } from "@/lib/permissions";
import { plantOptions } from "@/lib/plants";
import { loadPartners } from "@/lib/partners";
import { logoPng } from "@/lib/excelLogo";
import { buildTableSheet, addLogo, type XlColumn } from "@/lib/excelStyle";
import {
  loadStock, poView, lineValue, computeBalances, balanceOf, isLive, MAINT_LABEL, nextNo, newId,
  type SparePo, type StockFile, type Indent, type IndentLine,
} from "@/lib/stock";

const nodeRequire: NodeRequire = eval("require");

export const str = (v: unknown, max = 160) => String(v ?? "").trim().slice(0, max);
export const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const today = () => new Date().toISOString().slice(0, 10);
export const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v, 10)) ? str(v, 10) : "");
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface StockCtx {
  session: any;
  user: any;
  perms: Permission[];
  manage: boolean;
  approve: boolean;
  /** Plants this person may work on. */
  plants: string[];
}

/** Guard + who/where. `perm` is the key the route needs. */
export async function stockCtx(req: NextRequest, perm: Permission = "stock"): Promise<StockCtx | { response: Response }> {
  const auth = await requirePermission(req, perm);
  if ("response" in auth) return auth;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const manage = perms.includes("stock.manage");
  const all = plantOptions().map((p) => p.code);
  // Wide roles (procurement, admin, accounts) see every plant; anyone else
  // is pinned by the SESSION's plant, never by a query parameter.
  const wide = manage || perms.includes("stock.view") || perms.includes("users");
  const pinned = !wide && auth.session.plant ? [auth.session.plant] : null;
  const plants = pinned || (wide ? all : []);
  return { session: auth.session, user, perms, manage, approve: perms.includes("stock.approve"), plants };
}

/** Vendors that can supply stores: registered partners marked for parts / consumables / service. */
export function stockVendors() {
  return loadPartners()
    .filter((p) => p.kind !== "client" && p.status !== "blocked")
    .filter((p) => p.supplies.some((x) => x === "spare_parts" || x === "consumables" || x === "machinery_service" || x === "fuel" || x === "civil_electrical"))
    .map((p) => ({
      id: p.id, name: p.name, code: p.code, supplies: p.supplies, status: p.status, plants: p.plants, gstin: p.gstin,
      email: p.email, phone: p.phone, contactPerson: p.contactPerson, paymentTerms: p.paymentTerms,
      address: [p.addressLine, p.city, p.state, p.pincode].filter(Boolean).join(", "),
    }));
}

/* ------------------------------------------------------------------ */
/* PO PDF (server-side jsPDF, so the same file is downloaded and mailed) */
/* ------------------------------------------------------------------ */

const COMPANY = {
  name: "BIOME INDUSTRIA PRIVATE LIMITED",
  gstin: "06AAJCB1927H1ZS",
  pan: "AAJCB1927H",
};

function logoDataUrl(): string | null {
  for (const rel of ["public/assets/logo.png", "public/icons/icon-192.png"]) {
    try {
      const f = path.join(process.cwd(), rel);
      if (fs.existsSync(f)) return "data:image/png;base64," + fs.readFileSync(f).toString("base64");
    } catch { /* next */ }
  }
  return null;
}

const money = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function poPdf(po: SparePo, s: StockFile = loadStock()): Buffer {
  const { jsPDF } = nodeRequire("jspdf");
  const autoTableMod = nodeRequire("jspdf-autotable");
  const autoTable = autoTableMod.default || autoTableMod.autoTable || autoTableMod;
  const v = poView(s, po);
  const plant = plantOptions().find((p) => p.code === po.plant);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const INK: [number, number, number] = [22, 30, 45];
  const MUTED: [number, number, number] = [110, 120, 140];
  const GREEN: [number, number, number] = [31, 122, 76];

  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 3, "F");
  const logo = logoDataUrl();
  let tx = 14;
  if (logo) { try { doc.addImage(logo, "PNG", 14, 8, 15, 15); tx = 33; } catch { /* text only */ } }
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...INK);
  doc.text(COMPANY.name, tx, 14);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text(`GSTIN ${COMPANY.gstin} · PAN ${COMPANY.pan}`, tx, 19);
  doc.text(`Delivery plant: ${plant ? `${plant.label} (${plant.code})${plant.state ? `, ${plant.state}` : ""}` : po.plant}`, tx, 23);
  doc.setDrawColor(222, 226, 232); doc.line(14, 27, W - 14, 27);

  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK);
  doc.text("PURCHASE ORDER — SPARE PARTS", 14, 36);
  if (po.state === "draft" || po.state === "cancelled") {
    doc.setTextColor(180, 35, 24); doc.setFontSize(11);
    doc.text(po.state === "draft" ? "DRAFT — NOT ISSUED" : "CANCELLED", W - 14, 36, { align: "right" });
  }

  doc.setFontSize(9); doc.setTextColor(...INK);
  const left = [
    ["PO No.", po.no], ["PO date", po.date], ["Expected delivery", po.expectedDate || "—"], ["Payment terms", po.paymentTerms || "—"],
  ];
  const right = [
    ["Vendor", po.vendorName], ["GSTIN", po.vendorGstin || "—"], ["Address", po.vendorAddress || "—"], ["Email", po.vendorEmail || "—"],
  ];
  let y = 43;
  for (let i = 0; i < 4; i++) {
    doc.setFont("helvetica", "bold"); doc.text(left[i][0], 14, y); doc.text(right[i][0], 108, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(left[i][1]), 46, y);
    const lines = doc.splitTextToSize(String(right[i][1]), 70);
    doc.text(lines[0] || "", 128, y);
    y += 5;
  }

  const body = po.lines.map((l, i) => {
    const lv = lineValue(l);
    return [String(i + 1), l.partNo || "—", l.description, `${l.qty} ${l.unit}`, money(l.rate), `${l.gstPct}%`, money(lv.taxable), money(lv.total)];
  });
  autoTable(doc, {
    startY: y + 3,
    head: [["#", "Part no", "Description", "Qty", "Rate", "GST", "Taxable", "Amount"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, textColor: INK },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });
  let ty = (doc as any).lastAutoTable?.finalY ?? y + 20;
  ty += 6;
  const totals: [string, string][] = [
    ["Taxable value", money(v.totals.taxable)], ["GST", money(v.totals.gst)],
    ...(v.totals.freight ? [["Freight", money(v.totals.freight)] as [string, string]] : []),
    ["PO total (INR)", money(v.totals.total)],
  ];
  doc.setFontSize(9);
  for (const [k, val] of totals) {
    doc.setFont("helvetica", k.startsWith("PO total") ? "bold" : "normal");
    doc.text(k, W - 60, ty); doc.text(val, W - 14, ty, { align: "right" }); ty += 5;
  }
  ty += 3;
  const block = (title: string, text: string) => {
    if (!text) return;
    if (ty > 260) { doc.addPage(); ty = 20; }
    doc.setFont("helvetica", "bold"); doc.text(title, 14, ty); ty += 4.5;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(text, W - 28);
    doc.text(lines, 14, ty); ty += lines.length * 4 + 3;
  };
  block("Delivery terms", po.deliveryTerms);
  block("Terms & conditions", po.terms || "1. Quote this PO number on the invoice, challan and every packing.\n2. Material is accepted only after inspection at the plant; short, excess or damaged quantity will be reported against this PO.\n3. Invoice rate must match the PO rate.");
  block("Notes", po.notes);
  if (ty > 262) { doc.addPage(); ty = 20; }
  doc.setFont("helvetica", "bold"); doc.text(`For ${COMPANY.name}`, W - 14, ty + 8, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
  doc.text(`Issued by ${po.issuedByName || po.createdByName} (Procurement)`, W - 14, ty + 20, { align: "right" });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(222, 226, 232); doc.line(14, H - 12, W - 14, H - 12);
    doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("Biome Industria Private Limited · Computer-generated purchase order", 14, H - 7);
    doc.text(`Page ${i} of ${pages}`, W - 14, H - 7, { align: "right" });
  }
  return Buffer.from(doc.output("arraybuffer"));
}

/* ------------------------------------------------------------------ */
/* Spend reports (Excel via lib/excelStyle)                            */
/* ------------------------------------------------------------------ */

export interface SpendFilter { from: string; to: string; plants: string[] }

export function vendorSpend(s: StockFile, f: SpendFilter) {
  const rows: Record<string, any>[] = [];
  const by = new Map<string, any>();
  for (const g of s.grns) {
    if (g.state !== "final" || !f.plants.includes(g.plant)) continue;
    if ((f.from && g.date < f.from) || (f.to && g.date > f.to)) continue;
    const po = s.pos.find((p) => p.id === g.poId);
    if (!po) continue;
    let taxable = 0, gst = 0;
    for (const gl of g.lines) {
      const pl = po.lines.find((x) => x.id === gl.poLineId);
      if (!pl) continue;
      const v = lineValue({ qty: Math.max(0, gl.receivedQty - gl.damagedQty), rate: gl.invoiceRate || pl.rate, gstPct: pl.gstPct });
      taxable += v.taxable; gst += v.gst;
    }
    rows.push({ date: g.date, grn: g.no, po: g.poNo, plant: g.plant, vendor: g.vendorName, invoice: g.invoiceNo, taxable: r2(taxable), gst: r2(gst), total: r2(taxable + gst) });
    const e = by.get(g.vendorId) || { vendor: g.vendorName, grns: 0, pos: new Set<string>(), taxable: 0, gst: 0, total: 0, last: "" };
    e.grns += 1; e.pos.add(g.poNo); e.taxable += taxable; e.gst += gst; e.total += taxable + gst; if (g.date > e.last) e.last = g.date;
    by.set(g.vendorId, e);
  }
  const ordered = new Map<string, number>();
  for (const p of s.pos) {
    if (!f.plants.includes(p.plant) || p.state === "draft" || p.state === "cancelled") continue;
    if ((f.from && p.date < f.from) || (f.to && p.date > f.to)) continue;
    ordered.set(p.vendorId, (ordered.get(p.vendorId) || 0) + poView(s, p).totals.total);
  }
  const summary = Array.from(by.entries()).map(([id, e]) => ({
    vendor: e.vendor, grns: e.grns, pos: e.pos.size, ordered: r2(ordered.get(id) || 0), taxable: r2(e.taxable), gst: r2(e.gst), total: r2(e.total), last: e.last,
  })).sort((a, b) => b.total - a.total);
  return { summary, rows: rows.sort((a, b) => a.date.localeCompare(b.date)) };
}

export function machineSpend(s: StockFile, f: SpendFilter) {
  const bal = computeBalances(s.movements);
  const machines = new Map(s.machines.map((m) => [m.id, m]));
  const by = new Map<string, any>();
  const rows: Record<string, any>[] = [];
  const get = (id: string) => {
    const m = machines.get(id);
    return by.get(id) || { machine: m ? `${m.code} · ${m.name}` : "?", plant: m?.plant || "", parts: 0, labour: 0, other: 0, downtime: 0, breakdowns: 0, jobs: 0 };
  };
  for (const mv of s.movements) {
    if (!isLive(mv) || !mv.machineId || !f.plants.includes(mv.plant) || (mv.type !== "issue" && mv.type !== "return")) continue;
    if ((f.from && mv.date < f.from) || (f.to && mv.date > f.to)) continue;
    const rate = mv.rate || balanceOf(bal, mv.itemId, mv.plant).avgRate;
    const sign = mv.type === "issue" ? 1 : -1;
    const e = get(mv.machineId); e.parts += sign * mv.qty * rate; by.set(mv.machineId, e);
    const item = s.items.find((i) => i.id === mv.itemId);
    rows.push({ date: mv.date, doc: mv.no, plant: mv.plant, machine: e.machine, part: item?.name || "?", qty: sign * mv.qty, value: r2(sign * mv.qty * rate) });
  }
  for (const l of s.maintenance) {
    if (l.cancelled || !f.plants.includes(l.plant)) continue;
    if ((f.from && l.date < f.from) || (f.to && l.date > f.to)) continue;
    const e = get(l.machineId);
    e.labour += l.labourCost; e.other += l.otherCost; e.downtime += l.downtimeHours; e.jobs += 1;
    if (l.kind === "breakdown") e.breakdowns += 1;
    by.set(l.machineId, e);
  }
  const summary = Array.from(by.values()).map((e) => ({ ...e, parts: r2(e.parts), total: r2(e.parts + e.labour + e.other) })).sort((a, b) => b.total - a.total);
  const logs = s.maintenance
    .filter((l) => !l.cancelled && f.plants.includes(l.plant) && (!f.from || l.date >= f.from) && (!f.to || l.date <= f.to))
    .map((l) => ({ date: l.date, no: l.no, plant: l.plant, machine: get(l.machineId).machine, kind: MAINT_LABEL[l.kind], work: l.work, downtime: l.downtimeHours, parts: l.partsCost, labour: l.labourCost, other: l.otherCost, total: r2(l.partsCost + l.labourCost + l.otherCost) }));
  return { summary, rows, logs };
}

export async function spendWorkbook(kind: "vendor" | "machine", s: StockFile, f: SpendFilter, by: string): Promise<Buffer> {
  const ExcelJS = nodeRequire("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Platform";
  const logoId = addLogo(wb, logoPng());
  const period = f.from || f.to ? `${f.from || "start"} to ${f.to || today()}` : "All dates";
  const plant = f.plants.join(", ");
  const meta = (title: string) => ({ title, plant, period, generatedBy: by, generatedAt: new Date() });
  if (kind === "vendor") {
    const r = vendorSpend(s, f);
    const cols: XlColumn[] = [
      { key: "vendor", header: "Vendor" }, { key: "pos", header: "POs", type: "int", total: true }, { key: "grns", header: "GRNs", type: "int", total: true },
      { key: "ordered", header: "PO value (issued)", type: "money", total: true }, { key: "taxable", header: "Received — taxable", type: "money", total: true },
      { key: "gst", header: "GST", type: "money", total: true }, { key: "total", header: "Received — total", type: "money", total: true }, { key: "last", header: "Last GRN", type: "date" },
    ];
    buildTableSheet(wb, "Vendor-wise spend", { meta: meta("Spare parts — vendor-wise spend"), columns: cols, rows: r.summary, logoId, totals: true });
    buildTableSheet(wb, "GRN detail", {
      meta: meta("Spare parts — final GRNs"), logoId, totals: true,
      columns: [
        { key: "date", header: "Date", type: "date" }, { key: "grn", header: "GRN" }, { key: "po", header: "PO" }, { key: "plant", header: "Plant" },
        { key: "vendor", header: "Vendor" }, { key: "invoice", header: "Invoice no" }, { key: "taxable", header: "Taxable", type: "money", total: true },
        { key: "gst", header: "GST", type: "money", total: true }, { key: "total", header: "Total", type: "money", total: true },
      ],
      rows: r.rows,
    });
  } else {
    const r = machineSpend(s, f);
    buildTableSheet(wb, "Machine-wise spend", {
      meta: meta("Spare parts & maintenance — machine-wise spend"), logoId, totals: true,
      columns: [
        { key: "machine", header: "Machine" }, { key: "plant", header: "Plant" }, { key: "parts", header: "Parts issued", type: "money", total: true },
        { key: "labour", header: "Labour", type: "money", total: true }, { key: "other", header: "Other cost", type: "money", total: true },
        { key: "total", header: "Total", type: "money", total: true }, { key: "jobs", header: "Jobs", type: "int", total: true },
        { key: "breakdowns", header: "Breakdowns", type: "int", total: true }, { key: "downtime", header: "Downtime (hrs)", type: "number", total: true },
      ],
      rows: r.summary,
    });
    buildTableSheet(wb, "Parts issued", {
      meta: meta("Parts issued to machines"), logoId, totals: true,
      columns: [
        { key: "date", header: "Date", type: "date" }, { key: "doc", header: "Document" }, { key: "plant", header: "Plant" }, { key: "machine", header: "Machine" },
        { key: "part", header: "Part" }, { key: "qty", header: "Qty", type: "number" }, { key: "value", header: "Value", type: "money", total: true },
      ],
      rows: r.rows,
    });
    buildTableSheet(wb, "Maintenance log", {
      meta: meta("Maintenance log"), logoId, totals: true,
      columns: [
        { key: "date", header: "Date", type: "date" }, { key: "no", header: "Job no" }, { key: "plant", header: "Plant" }, { key: "machine", header: "Machine" },
        { key: "kind", header: "Type" }, { key: "work", header: "Work done", width: 40 }, { key: "downtime", header: "Downtime (hrs)", type: "number", total: true },
        { key: "parts", header: "Parts", type: "money", total: true }, { key: "labour", header: "Labour", type: "money", total: true },
        { key: "other", header: "Other", type: "money", total: true }, { key: "total", header: "Total", type: "money", total: true },
      ],
      rows: r.logs,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, name: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function pdfResponse(buf: Buffer, name: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

export const poFileName = (no: string) => `${no.replace(/[^A-Za-z0-9-]+/g, "_")}.pdf`;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------ */
/* A requirement (indent) — shared by procurement and the plant side   */
/* ------------------------------------------------------------------ */
export function buildIndent(
  s: StockFile, body: any, plants: string[], user: { id: string; name: string }
): { indent: Indent } | { error: string } {
  const plant = str(body?.plant, 10).toUpperCase();
  if (!plants.includes(plant)) return { error: "Choose your plant." };
  const urgency = ["normal", "urgent", "breakdown"].includes(body?.urgency) ? body.urgency : "normal";
  const reason = str(body?.reason, 400);
  if (!reason) return { error: "Write why the part is needed (machine problem, routine stock…)." };
  const machineId = s.machines.find((m) => m.id === body?.machineId && m.plant === plant)?.id || "";
  const lines: IndentLine[] = [];
  for (const l of Array.isArray(body?.lines) ? body.lines : []) {
    const item = l?.itemId ? s.items.find((i) => i.id === l.itemId && i.active) : null;
    const name = item?.name || str(l?.name, 160);
    const qty = r3(num(l?.qty));
    if (!name && !qty) continue;
    if (!name) return { error: "A line has no part name." };
    if (qty <= 0) return { error: `Quantity for ${name} must be more than 0.` };
    lines.push({ id: newId(), itemId: item?.id || "", name, partNo: item?.partNo || str(l?.partNo, 60), qty, unit: item?.unit || str(l?.unit, 12) || "Nos" });
  }
  if (!lines.length) return { error: "Add at least one part." };
  const requiredBy = isoDate(body?.requiredBy);
  return {
    indent: {
      id: newId(), no: nextNo(s, `IND-${plant}`), plant, date: today(), requiredBy, urgency, machineId, reason, lines,
      state: "open", decisionNote: "", decidedByName: "", decidedAt: "", poIds: [],
      raisedBy: user.id, raisedByName: user.name, createdAt: new Date().toISOString(),
    },
  };
}

