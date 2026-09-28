/**
 * Vendor / client follow-ups (server only)
 * -------------------------------------------------------------------
 * What is still owed to us, by whom — and a ready message to ask for it,
 * by email or WhatsApp:
 *
 *   tax_invoice_pending   the vendor's challan is in, their tax invoice is not
 *   credit_note_pending   we raised a debit note, their credit note is not in
 *   documents_missing     supply papers not received (from the WhatsApp link)
 *   kyc_pending           registration papers missing or expired
 *   po_ending             PO nearly used up / expiring — confirm balance, plan
 *   po_extend             ask the client/vendor to extend or renew the PO
 *   po_closed             PO fully used — tell them it is closed
 *   custom                anything else
 *
 * Nothing is sent by itself. The screen shows the suggestion, the person
 * edits the message and presses Send. Every send is logged.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, readJson, ensureDir } from "@/lib/dataRoot";
import { loadPartners, gapsFor, type Partner } from "@/lib/partners";
import { loadTrips, type Trip } from "@/lib/coordination";
import { computeAll as computePos } from "@/lib/po";
import { docsForTrip, loadAgentDocs } from "@/lib/tripDocs";

export type FollowupKind =
  | "tax_invoice_pending" | "credit_note_pending" | "documents_missing" | "kyc_pending"
  | "po_ending" | "po_extend" | "po_closed" | "custom";

export const FOLLOWUP_KINDS: { id: FollowupKind; label: string }[] = [
  { id: "tax_invoice_pending", label: "Tax invoice pending against challan" },
  { id: "credit_note_pending", label: "Credit note pending against debit note" },
  { id: "documents_missing", label: "Supply documents missing" },
  { id: "kyc_pending", label: "KYC / registration documents" },
  { id: "po_ending", label: "PO nearly exhausted / expiring" },
  { id: "po_extend", label: "Request PO extension / renewal" },
  { id: "po_closed", label: "PO completed — closure notice" },
  { id: "custom", label: "Custom message" },
];

export interface Followup {
  key: string;
  kind: FollowupKind;
  partyName: string;
  partyType: "vendor" | "client";
  partnerId: string | null;
  email: string;
  phone: string;
  tripId: string | null;
  poId: string | null;
  business: "trading" | "manufacturing" | null;
  plant: string | null;
  title: string;
  detail: string;
  subject: string;
  body: string;
  lastSent: { at: string; channel: string; by: string } | null;
}

const COMPANY = "Biome Industria Private Limited";
const sign = (by: string) => `\n\nRegards,\n${by}\n${COMPANY}`;
const kgs = (n: number) => `${Math.round(n).toLocaleString("en-IN")} kg`;

function partnerFor(name: string, code: string, partners: Partner[]): Partner | undefined {
  const c = String(code || "").toUpperCase();
  const n = String(name || "").trim().toLowerCase();
  return partners.find((p) => (c && p.code.toUpperCase() === c) || (n && p.name.trim().toLowerCase() === n));
}

function logFile() { return path.join(paths.root, "followups", "log.jsonl"); }

export interface FollowupLog { id: string; key: string; kind: FollowupKind; party: string; channel: "email" | "whatsapp" | "whatsapp_link"; to: string; subject: string; body: string; ok: boolean; error: string | null; at: string; by: string; byName: string }

export function readFollowupLog(limit = 1000): FollowupLog[] {
  try {
    if (!fs.existsSync(logFile())) return [];
    return fs.readFileSync(logFile(), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse().slice(0, limit);
  } catch { return []; }
}

export function logFollowup(e: Omit<FollowupLog, "id" | "at">): FollowupLog {
  const rec = { ...e, id: crypto.randomUUID(), at: new Date().toISOString() };
  ensureDir(path.dirname(logFile()));
  fs.appendFileSync(logFile(), JSON.stringify(rec) + "\n", "utf8");
  return rec;
}

/**
 * Every follow-up currently due, newest problems first. `by` is the
 * sender's name for the signature; `scope` narrows to what the caller
 * may see (trading for a coordinator, manufacturing for a plant manager).
 */
export function pendingFollowups(opts: { by: string; business?: "trading" | "manufacturing" | null; plant?: string | null; includePo?: boolean; includeKyc?: boolean }): Followup[] {
  const partners = loadPartners();
  const trips = loadTrips().filter((t) => t.status !== "cancelled" && (!opts.business || t.business === opts.business));
  const log = readFollowupLog(3000);
  const last = (key: string) => { const l = log.find((x) => x.key === key && x.ok); return l ? { at: l.at, channel: l.channel, by: l.byName } : null; };
  const out: Followup[] = [];
  const base = (p: Partner | undefined, name: string, t: Trip | null) => ({
    partyName: p?.name || name, partyType: "vendor" as const, partnerId: p?.id || null,
    email: p?.email || "", phone: p?.phone || "", tripId: t?.id || null, poId: null,
    business: t?.business || null, plant: null,
  });

  const docs = loadAgentDocs();
  for (const t of trips) {
    const p = partnerFor(t.supplier, t.supplierCode, partners);
    const ref = `vehicle ${t.vehicleNumber || "—"}, dated ${t.vehicleEntryDate || t.ourDocDate || "—"}${t.ourDocNo ? `, our document ${t.ourDocNo}` : ""}`;

    if (t.business === "trading" && t.vendorChallanNo && !t.vendorInvoiceNo) {
      const key = `tax_invoice_pending:${t.id}`;
      out.push({
        ...base(p, t.supplier, t), key, kind: "tax_invoice_pending",
        title: `${t.supplier || "Vendor"}: tax invoice pending for challan ${t.vendorChallanNo}`,
        detail: `Challan ${t.vendorChallanNo} · ${ref}`,
        subject: `Tax invoice pending — challan ${t.vendorChallanNo} (${t.vehicleNumber || ""})`,
        body: `Dear ${p?.contactPerson || t.supplier || "Sir/Madam"},\n\nWe have received your delivery challan no. ${t.vendorChallanNo} for the supply against ${ref}${t.vendorChallanWeight ? ` (${kgs(t.vendorChallanWeight)})` : ""}.\n\nThe tax invoice for this supply is still pending. Kindly share the tax invoice at the earliest so that we can process it in our books and release the payment.${sign(opts.by)}`,
        lastSent: last(key),
      });
    }
    if (t.debitNoteNo && !t.creditNoteNo) {
      const key = `credit_note_pending:${t.id}`;
      out.push({
        ...base(p, t.supplier, t), key, kind: "credit_note_pending",
        title: `${t.supplier || t.client}: credit note pending against debit note ${t.debitNoteNo}`,
        detail: ref,
        subject: `Credit note pending against our debit note ${t.debitNoteNo}`,
        body: `Dear ${p?.contactPerson || t.supplier || "Sir/Madam"},\n\nWe have raised debit note no. ${t.debitNoteNo} for the supply against ${ref}. The corresponding credit note from your side has not been received yet.\n\nKindly issue the credit note and share a copy so that both books match.${sign(opts.by)}`,
        lastSent: last(key),
      });
    }
    // Missing papers from the WhatsApp link — only once the supply is moving.
    if (t.business === "trading" && ["dispatched", "received", "accepted", "shortage"].includes(t.status) || t.receivingQty) {
      const r = docsForTrip(t, docs);
      const vendorSide = r.missing.filter((m) => /vendor|bilty|weight|e-way/i.test(m));
      if (vendorSide.length) {
        const key = `documents_missing:${t.id}`;
        out.push({
          ...base(p, t.supplier, t), key, kind: "documents_missing",
          title: `${t.supplier || "Vendor"}: ${vendorSide.join(", ")} not received`,
          detail: `Reference ${r.reference.canonical} · ${ref}`,
          subject: `Documents pending — ${r.reference.canonical}`,
          body: `Dear ${p?.contactPerson || t.supplier || "Sir/Madam"},\n\nFor the supply against ${ref} (reference ${r.reference.canonical}), the following documents have not been received yet:\n\n${vendorSide.map((m) => `  • ${m}`).join("\n")}\n\nKindly send them on the supply WhatsApp group or reply to this mail, quoting the reference ${r.reference.canonical}.${sign(opts.by)}`,
          lastSent: last(key),
        });
      }
    }
  }

  if (opts.includeKyc !== false) {
    for (const p of partners.filter((x) => !opts.business || (opts.business === "trading" ? x.category === "trading" : x.category !== "trading"))) {
      if (opts.plant && p.plants.length && !p.plants.includes(opts.plant)) continue;
      const g = gapsFor(p);
      const items = [...g.missing.map((m) => `${m.label} (not received)`), ...g.expired.map((e) => `${e.label} (expired ${e.validTill})`), ...g.expiringSoon.map((e) => `${e.label} (expires ${e.validTill})`)];
      if (!items.length) continue;
      const key = `kyc_pending:${p.id}`;
      out.push({
        partyName: p.name, partyType: p.kind === "client" ? "client" : "vendor", partnerId: p.id, email: p.email, phone: p.phone,
        tripId: null, poId: null, business: p.category === "trading" ? "trading" : "manufacturing", plant: p.plants[0] || null, key, kind: "kyc_pending",
        title: `${p.name}: ${items.length} registration document(s) needed`,
        detail: items.join(" · "),
        subject: `Documents required for registration — ${p.name}`,
        body: `Dear ${p.contactPerson || p.name},\n\nTo complete / keep your registration with ${COMPANY} active, please share the following:\n\n${items.map((i) => `  • ${i}`).join("\n")}\n\nScanned copies (PDF or clear photos) by reply are fine.${sign(opts.by)}`,
        lastSent: last(key),
      });
    }
  }

  if (opts.includePo) {
    for (const po of computePos().pos) {
      if (po.effectiveStatus === "cancelled" || po.effectiveStatus === "closed") continue;
      const p = partners.find((x) => x.code && x.code.toUpperCase() === String(po.partyKey).toUpperCase()) || partners.find((x) => x.name.toLowerCase() === po.partyName.toLowerCase());
      const partyType = po.type === "vendor" ? "vendor" : "client";
      const facts = `PO ${po.poNumber}${po.poDate ? ` dated ${po.poDate}` : ""} for ${po.material || "material"}: ${kgs(po.consumedKg)} supplied of ${kgs(po.consumedKg + po.remainingKg)} (${Math.round(po.utilisationPct)}%), balance ${kgs(po.remainingKg)}${po.expiryDate ? `, valid till ${po.expiryDate}` : ""}`;
      const common = { partyName: po.partyName, partyType: partyType as "vendor" | "client", partnerId: p?.id || null, email: p?.email || "", phone: p?.phone || "", tripId: null, poId: po.id, business: null, plant: null };
      if (po.remainingKg <= 0) {
        const key = `po_closed:${po.id}`;
        out.push({ ...common, key, kind: "po_closed", title: `${po.partyName}: PO ${po.poNumber} fully used`, detail: facts,
          subject: `PO ${po.poNumber} — quantity completed`,
          body: `Dear Sir/Madam,\n\nThis is to inform you that the quantity under ${facts} has been fully supplied and the PO stands completed.\n\nFor further supplies, kindly issue a fresh / extended PO.${sign(opts.by)}`, lastSent: last(key) });
      } else if (po.utilisationPct >= 75 || (po.daysToExpiry !== null && po.daysToExpiry <= 30)) {
        const key = `po_extend:${po.id}`;
        out.push({ ...common, key, kind: "po_extend", title: `${po.partyName}: PO ${po.poNumber} ${po.utilisationPct >= 75 ? `${Math.round(po.utilisationPct)}% used` : `expires in ${po.daysToExpiry} days`}`, detail: facts,
          subject: `Request for extension / renewal of PO ${po.poNumber}`,
          body: `Dear Sir/Madam,\n\n${facts}.\n\nTo continue supplies without interruption, we request you to kindly extend / renew the PO (quantity and validity). Please share the amended PO at the earliest.${sign(opts.by)}`, lastSent: last(key) });
      }
    }
  }
  return out.sort((a, b) => (a.lastSent ? 1 : 0) - (b.lastSent ? 1 : 0));
}

/** WhatsApp click-to-chat link — works without the agent, opens WhatsApp with the text ready. */
export function waLink(phone: string, text: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  const n = d.length === 10 ? `91${d}` : d;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function clientContact(name: string): { email: string; phone: string } {
  const f = readJson<{ clients: any[] }>(paths.clientsFile, { clients: [] });
  const c = (f.clients || []).find((x: any) => String(x.name).toLowerCase() === name.toLowerCase());
  return { email: c?.email || "", phone: c?.phone || "" };
}
