import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import {
  loadStock, saveStock, nextNo, newId, nextPoNo, poView, grnMatch, computeBalances, balanceOf,
  type SparePo, type PoLine, type Grn, type GrnLine, type Movement,
} from "@/lib/stock";
import { stockCtx, stockVendors, str, num, today, isoDate, poPdf, poFileName, buildIndent } from "@/lib/spares";

/**
 * Spare-part purchasing: requirement → PO → goods receipt → FINAL.
 *
 *   indent.decide   approve / reject a plant's requirement
 *   indent.create   procurement raises a requirement itself
 *   po.save         create or edit a DRAFT PO (vendor from the registry)
 *   po.issue        draft → issued (number fixed, locked, optional email)
 *   po.email        (re)send the PO PDF to the vendor via lib/mailer
 *   po.cancel       issued PO with nothing received → cancelled
 *   po.close        short-close a partly received PO
 *   grn.save        record / edit a DRAFT receipt against an issued PO
 *   grn.delete      throw away a draft
 *   grn.final       "Match & OK" — stock in, PO received qty up, locked
 *   grn.reopen      admin / developer (stock.approve): back to draft, audited
 *
 * Everything here needs `stock` (procurement). Received quantity on a PO
 * is never stored: it is the sum of FINAL GRNs, so reopening a GRN puts the
 * PO back exactly where it was.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function POST(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const { user } = c;
  const body = await req.json().catch(() => null);
  const action = str(body?.action, 40);
  const s = loadStock();
  const now = new Date().toISOString();
  const deny = (msg: string, status = 403) => NextResponse.json({ error: msg }, { status });
  const audit = (a: string, plant: string, id: string, label: string, detail?: string) =>
    recordAudit({ action: a, userId: user.id, userName: user.name, role: user.role, plant, targetType: "spare_purchase", targetId: id, targetLabel: label, detail });

  /* ================= Requirements ================= */
  if (action === "indent.decide") {
    const ind = s.indents.find((i) => i.id === body?.id);
    if (!ind || !c.plants.includes(ind.plant)) return deny("Requirement not found.", 404);
    if (ind.state !== "open" && ind.state !== "approved") return deny("This requirement is already closed.", 409);
    const decision = body?.decision === "reject" ? "rejected" : "approved";
    const note = str(body?.note, 300);
    if (decision === "rejected" && !note) return deny("Tell the plant why it is rejected.", 400);
    ind.state = decision; ind.decisionNote = note; ind.decidedByName = user.name; ind.decidedAt = now;
    saveStock(s);
    audit(decision === "approved" ? "INDENT_APPROVED" : "INDENT_REJECTED", ind.plant, ind.id, ind.no, note);
    return NextResponse.json({ indent: ind });
  }

  if (action === "indent.create") {
    const r = buildIndent(s, body, c.plants, user);
    if ("error" in r) return deny(r.error, 400);
    s.indents.push(r.indent);
    saveStock(s);
    audit("INDENT_RAISED", r.indent.plant, r.indent.id, r.indent.no, `${r.indent.lines.length} line(s) · ${r.indent.urgency}`);
    return NextResponse.json({ indent: r.indent }, { status: 201 });
  }

  /* ================= Purchase orders ================= */
  if (action === "po.save") {
    const existing = body?.id ? s.pos.find((p) => p.id === body.id) : null;
    if (existing && existing.state !== "draft") return deny("An issued PO is locked. Cancel or short-close it instead.", 409);
    if (existing && !c.plants.includes(existing.plant)) return deny("Not your plant.");
    const plant = str(body?.plant, 10).toUpperCase();
    if (!c.plants.includes(plant)) return deny("Choose the delivery plant.", 400);
    const v = stockVendors().find((x) => x.id === body?.vendorId);
    if (!v) return deny("Choose a registered vendor. Register spare-part vendors in Vendor & Client Registration with “Machine spare parts” ticked.", 400);
    const date = isoDate(body?.date) || today();
    const rawLines: any[] = Array.isArray(body?.lines) ? body.lines : [];
    const lines: PoLine[] = [];
    for (const l of rawLines) {
      const item = l?.itemId ? s.items.find((i) => i.id === l.itemId) : null;
      const description = str(l?.description, 200) || item?.name || "";
      const qty = r3(num(l?.qty));
      const rate = Math.max(0, num(l?.rate));
      if (!description && !qty) continue;
      if (!item) return deny(`“${description || "A line"}” is not in the item master. Add it in Items first so the receipt can go into stock.`, 400);
      if (qty <= 0) return deny(`Quantity for ${description} must be more than 0.`, 400);
      if (rate <= 0) return deny(`Enter the rate for ${description}.`, 400);
      const gst = num(l?.gstPct);
      if (![0, 5, 12, 18, 28].includes(gst)) return deny(`GST for ${description} must be 0, 5, 12, 18 or 28%.`, 400);
      lines.push({
        id: existing?.lines.find((x) => x.id === l?.id)?.id || newId(),
        itemId: item.id, partNo: str(l?.partNo, 60) || item.partNo, description, qty, unit: str(l?.unit, 12) || item.unit, rate, gstPct: gst,
      });
    }
    if (!lines.length) return deny("Add at least one part to the PO.", 400);
    const indentIds = (Array.isArray(body?.indentIds) ? body.indentIds.map(String) : [])
      .filter((id: string) => s.indents.some((i) => i.id === id && i.plant === plant && (i.state === "open" || i.state === "approved")));
    const po: SparePo = {
      id: existing?.id || newId(),
      no: existing?.no || "",
      date, plant,
      vendorId: v.id, vendorName: v.name, vendorGstin: v.gstin || "", vendorEmail: str(body?.vendorEmail, 160) || v.email || "", vendorAddress: v.address,
      lines,
      freight: Math.max(0, num(body?.freight)),
      expectedDate: isoDate(body?.expectedDate),
      paymentTerms: str(body?.paymentTerms, 200) || v.paymentTerms || "",
      deliveryTerms: str(body?.deliveryTerms, 300),
      terms: str(body?.terms, 1500),
      notes: str(body?.notes, 500),
      indentIds,
      state: "draft",
      issuedAt: "", issuedByName: "", stateNote: "",
      emails: existing?.emails || [],
      history: [...(existing?.history || []), { at: now, byName: user.name, action: existing ? "Draft edited" : "Draft created", note: "" }],
      createdBy: existing?.createdBy || user.id, createdByName: existing?.createdByName || user.name, createdAt: existing?.createdAt || now, updatedAt: now,
    };
    if (po.expectedDate && po.expectedDate < po.date) return deny("Expected delivery cannot be before the PO date.", 400);
    s.pos = existing ? s.pos.map((p) => (p.id === po.id ? po : p)) : [...s.pos, po];
    // Approving the requirement is implied by putting it on a PO.
    for (const ind of s.indents) {
      if (indentIds.includes(ind.id)) {
        if (!ind.poIds.includes(po.id)) ind.poIds.push(po.id);
        if (ind.state === "open") { ind.state = "approved"; ind.decidedByName = user.name; ind.decidedAt = now; }
      } else if (ind.poIds.includes(po.id)) ind.poIds = ind.poIds.filter((x) => x !== po.id);
    }
    saveStock(s);
    audit(existing ? "SPARE_PO_DRAFT_EDITED" : "SPARE_PO_DRAFT_CREATED", plant, po.id, `Draft PO · ${v.name}`);
    return NextResponse.json({ po: poView(s, po) }, { status: existing ? 200 : 201 });
  }

  if (action === "po.delete") {
    const po = s.pos.find((p) => p.id === body?.id);
    if (!po || !c.plants.includes(po.plant)) return deny("PO not found.", 404);
    if (po.state !== "draft") return deny("Only a draft can be deleted. Cancel an issued PO instead.", 409);
    s.pos = s.pos.filter((p) => p.id !== po.id);
    for (const ind of s.indents) ind.poIds = ind.poIds.filter((x) => x !== po.id);
    saveStock(s);
    audit("SPARE_PO_DRAFT_DELETED", po.plant, po.id, `Draft PO · ${po.vendorName}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "po.issue" || action === "po.email") {
    const po = s.pos.find((p) => p.id === body?.id);
    if (!po || !c.plants.includes(po.plant)) return deny("PO not found.", 404);
    if (action === "po.issue") {
      if (po.state !== "draft") return deny("This PO is already issued.", 409);
      po.no = nextPoNo(s, po.plant, po.date);
      po.state = "issued"; po.issuedAt = now; po.issuedByName = user.name; po.updatedAt = now;
      po.history.push({ at: now, byName: user.name, action: "Issued", note: "" });
      saveStock(s);
      audit("SPARE_PO_ISSUED", po.plant, po.id, po.no, `${po.vendorName} · ₹${poView(s, po).totals.total}`);
    } else if (po.state === "draft" || po.state === "cancelled") {
      return deny("Only an issued PO can be emailed.", 409);
    }
    let mail: { ok: boolean; note: string } | null = null;
    if (action === "po.email" || body?.email) {
      const to = str(body?.to, 200) || po.vendorEmail;
      if (!to) {
        mail = { ok: false, note: "The vendor has no email address — add it in Vendor registration or type one." };
      } else {
        try {
          const pdf = poPdf(po, s);
          const r = await sendMail({
            to,
            subject: `Purchase Order ${po.no} — Biome Industria Private Limited`,
            text: `Dear ${po.vendorName},\n\nPlease find attached our Purchase Order ${po.no} dated ${po.date} for spare parts, to be delivered at our ${po.plant} plant${po.expectedDate ? ` by ${po.expectedDate}` : ""}.\n\nPlease quote the PO number on your invoice and delivery challan.\n\nRegards,\n${user.name}\nProcurement, Biome Industria Private Limited`,
            attachments: [{ filename: poFileName(po.no), content: pdf, contentType: "application/pdf" }],
          });
          mail = r.ok ? { ok: true, note: `Emailed to ${to}.` } : { ok: false, note: `Not emailed: ${r.error}` };
        } catch (e: any) {
          mail = { ok: false, note: `Not emailed: ${String(e?.message || e).slice(0, 200)}` };
        }
      }
      // Never undo the issue because mail failed — record it and say so.
      po.emails.push({ at: now, to, ok: mail.ok, note: mail.note });
      po.history.push({ at: now, byName: user.name, action: mail.ok ? "Emailed to vendor" : "Email failed", note: mail.note });
      saveStock(s);
    }
    return NextResponse.json({ po: poView(s, po), mail });
  }

  if (action === "po.cancel" || action === "po.close") {
    const po = s.pos.find((p) => p.id === body?.id);
    if (!po || !c.plants.includes(po.plant)) return deny("PO not found.", 404);
    const reason = str(body?.reason, 300);
    if (!reason) return deny("Give the reason.", 400);
    if (po.state !== "issued") return deny("Only an open (issued) PO can be cancelled or closed.", 409);
    const view = poView(s, po);
    if (s.grns.some((g) => g.poId === po.id && g.state === "draft")) return deny("A draft GRN is waiting on this PO. Finish or delete it first.", 409);
    if (action === "po.cancel" && view.status !== "issued") return deny("Material has already been received on this PO — short-close it instead.", 409);
    if (action === "po.close" && view.status === "received") return deny("This PO is already fully received.", 409);
    po.state = action === "po.cancel" ? "cancelled" : "closed";
    po.stateNote = reason; po.updatedAt = now;
    po.history.push({ at: now, byName: user.name, action: action === "po.cancel" ? "Cancelled" : "Short-closed", note: reason });
    saveStock(s);
    audit(action === "po.cancel" ? "SPARE_PO_CANCELLED" : "SPARE_PO_SHORT_CLOSED", po.plant, po.id, po.no, reason);
    return NextResponse.json({ po: poView(s, po) });
  }

  /* ================= Goods receipt ================= */
  if (action === "grn.save") {
    const existing = body?.id ? s.grns.find((g) => g.id === body.id) : null;
    if (existing && existing.state === "final") return deny("This GRN is FINAL and locked. An admin can reopen it with a reason.", 409);
    const po = s.pos.find((p) => p.id === (existing?.poId || body?.poId));
    if (!po || !c.plants.includes(po.plant)) return deny("Choose the PO this material came against.", 400);
    const view = poView(s, po);
    if (po.state !== "issued" || view.status === "received") return deny(`PO ${po.no || ""} is ${view.status === "received" ? "fully received" : po.state} — nothing more can be received on it.`, 409);
    const date = isoDate(body?.date) || today();
    if (date > today()) return deny("The received date cannot be in the future.", 400);
    if (date < po.date) return deny("The received date cannot be before the PO date.", 400);
    if (!str(body?.invoiceNo, 40) && !str(body?.challanNo, 40)) return deny("Enter the vendor's invoice or challan number.", 400);
    const lines: GrnLine[] = [];
    for (const pl of po.lines) {
      const l = (Array.isArray(body?.lines) ? body.lines : []).find((x: any) => x?.poLineId === pl.id) || {};
      const receivedQty = r3(Math.max(0, num(l.receivedQty)));
      const damagedQty = r3(Math.max(0, num(l.damagedQty)));
      if (damagedQty > receivedQty) return deny(`Damaged quantity of ${pl.description} is more than received.`, 400);
      lines.push({ poLineId: pl.id, itemId: pl.itemId, receivedQty, damagedQty, invoiceRate: Math.max(0, num(l.invoiceRate)), remarks: str(l.remarks, 200) });
    }
    if (!lines.some((l) => l.receivedQty > 0)) return deny("Enter the quantity received for at least one line.", 400);
    const g: Grn = {
      id: existing?.id || newId(),
      no: existing?.no || nextNo(s, `GRN-${po.plant}`),
      poId: po.id, poNo: po.no, plant: po.plant, vendorId: po.vendorId, vendorName: po.vendorName,
      date, invoiceNo: str(body?.invoiceNo, 40), invoiceDate: isoDate(body?.invoiceDate), challanNo: str(body?.challanNo, 40),
      vehicleNo: str(body?.vehicleNo, 20).toUpperCase(), lines, remarks: str(body?.remarks, 400),
      state: "draft", matchNote: str(body?.matchNote, 400) || existing?.matchNote || "", finalAt: "", finalByName: "",
      reopens: existing?.reopens || [],
      createdBy: existing?.createdBy || user.id, createdByName: existing?.createdByName || user.name, createdAt: existing?.createdAt || now, updatedAt: now,
    };
    s.grns = existing ? s.grns.map((x) => (x.id === g.id ? g : x)) : [...s.grns, g];
    saveStock(s);
    audit(existing ? "GRN_DRAFT_EDITED" : "GRN_DRAFT_CREATED", g.plant, g.id, `${g.no} · ${po.no}`);
    return NextResponse.json({ grn: { ...g, match: grnMatch(s, po, g) } }, { status: existing ? 200 : 201 });
  }

  if (action === "grn.delete") {
    const g = s.grns.find((x) => x.id === body?.id);
    if (!g || !c.plants.includes(g.plant)) return deny("GRN not found.", 404);
    if (g.state !== "draft") return deny("A FINAL GRN cannot be deleted.", 409);
    s.grns = s.grns.filter((x) => x.id !== g.id);
    saveStock(s);
    audit("GRN_DRAFT_DELETED", g.plant, g.id, g.no);
    return NextResponse.json({ ok: true });
  }

  if (action === "grn.final") {
    const g = s.grns.find((x) => x.id === body?.id);
    if (!g || !c.plants.includes(g.plant)) return deny("GRN not found.", 404);
    if (g.state === "final") return deny("Already FINAL.", 409);
    const po = s.pos.find((p) => p.id === g.poId);
    if (!po || po.state !== "issued") return deny("The PO is not open any more.", 409);
    const match = grnMatch(s, po, g);
    if (!match.anyAccepted) return deny("Nothing good was received — every quantity is zero or damaged.", 400);
    const note = str(body?.matchNote, 400) || g.matchNote;
    if (match.needsNote && !note) return deny("There is an excess quantity or a rate difference against the PO. Write a note explaining it before pressing Match & OK.", 400);
    if (body?.confirm !== true) return deny("Tick “I have matched this receipt against the PO” first.", 400);
    const made: Movement[] = [];
    for (const ml of match.lines) {
      if (ml.acceptedQty <= 0) continue;
      const gl = g.lines.find((x) => x.poLineId === ml.poLineId);
      made.push({
        id: newId(), no: g.no, type: "receipt", date: g.date, plant: g.plant, itemId: ml.itemId, qty: ml.acceptedQty,
        rate: ml.invoiceRate, amount: Math.round(ml.acceptedQty * ml.invoiceRate * 100) / 100,
        vendorId: g.vendorId, vendorName: g.vendorName, invoiceNo: g.invoiceNo, challanNo: g.challanNo,
        machineId: "", issuedTo: "", purpose: `Against PO ${po.no}`, remarks: gl?.remarks || "",
        transferId: "", cancelled: false, cancelReason: "", cancelledByName: "",
        createdBy: user.id, createdByName: user.name, createdAt: now, grnId: g.id,
      });
    }
    s.movements.push(...made);
    g.state = "final"; g.matchNote = note; g.finalAt = now; g.finalByName = user.name; g.updatedAt = now;
    po.history.push({ at: now, byName: user.name, action: `GRN ${g.no} matched & final`, note: match.lines.filter((l) => l.flags[0] !== "ok").map((l) => `${l.description}: ${l.flags.join("/")}`).join("; ") });
    saveStock(s);
    const v = poView(s, po);
    audit("GRN_FINAL", g.plant, g.id, `${g.no} · ${po.no}`, `${made.length} line(s) into stock · PO now ${v.status}`);
    return NextResponse.json({ grn: { ...g, match: grnMatch(s, po, g) }, po: v });
  }

  if (action === "grn.reopen") {
    if (!c.approve) return deny("Reopening a FINAL GRN needs Spare parts — approve (admin / developer).");
    const g = s.grns.find((x) => x.id === body?.id);
    if (!g || !c.plants.includes(g.plant)) return deny("GRN not found.", 404);
    if (g.state !== "final") return deny("This GRN is not final.", 409);
    const reason = str(body?.reason, 300);
    if (!reason) return deny("Give the reason for reopening.", 400);
    const ids = new Set(s.movements.filter((m) => m.grnId === g.id && !m.cancelled).map((m) => m.id));
    const trial = s.movements.map((m) => (ids.has(m.id) ? { ...m, cancelled: true } : m));
    const bal = computeBalances(trial);
    for (const m of s.movements.filter((x) => ids.has(x.id))) {
      if (balanceOf(bal, m.itemId, m.plant).qty < -1e-9) {
        const item = s.items.find((i) => i.id === m.itemId);
        return deny(`Cannot reopen: ${item?.name || "a part"} from this GRN has already been issued — stock at ${m.plant} would go negative.`, 409);
      }
    }
    s.movements = s.movements.map((m) => (ids.has(m.id) ? { ...m, cancelled: true, cancelReason: `GRN reopened: ${reason}`, cancelledByName: user.name } : m));
    g.state = "draft"; g.reopens.push({ at: now, byName: user.name, reason }); g.updatedAt = now;
    const po = s.pos.find((p) => p.id === g.poId);
    if (po) {
      // A short-closed / fully received PO opens again so the corrected GRN can be finalised.
      if (po.state === "closed") po.state = "issued";
      po.history.push({ at: now, byName: user.name, action: `GRN ${g.no} reopened`, note: reason });
    }
    saveStock(s);
    audit("GRN_REOPENED", g.plant, g.id, g.no, reason);
    return NextResponse.json({ ok: true });
  }

  return deny("Unknown action.", 400);
}

