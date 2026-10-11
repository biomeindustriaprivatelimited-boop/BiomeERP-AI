/**
 * ONE client register.
 *
 * Clients used to be created in two places that did not know about each
 * other:
 *
 *   - Registration (partners.json, kind "client") — GST, PAN, contacts,
 *     KYC papers, Submit & freeze;
 *   - the client master (config/clients.json) — which documents each
 *     power plant requires, DSC rules, aliases the WhatsApp agent matches
 *     on, and the client POs coordination picks from.
 *
 * They are now ONE record: the registration. clients.json is DERIVED
 * from it (the same pattern vendors.json follows, see lib/vendorSync.ts),
 * so every reader — the WhatsApp agent, coordination, billing, follow-ups,
 * the AI tools, reports — keeps reading the file it always read, in the
 * shape it always had, plus a stable `id` (= the registration id).
 *
 * MIGRATION (runs on every sync, idempotent):
 *   - a clients.json entry with no `id` (old data, the agent's SOP seed,
 *     anything another tool added) is merged into the trading client
 *     registration of the same name, or becomes a new one — and from then
 *     on carries that registration's id;
 *   - an entry whose id is unknown is re-created with THAT id, never
 *     dropped (data is not lost because a file was restored);
 *   - POs and aliases found only in the file are kept (union), so a writer
 *     that has not been moved over yet cannot lose them.
 *
 * Only TRADING clients go into clients.json: it is what coordination (the
 * coordinator's register) reads, and a coordinator must never see the
 * plant's manufacturing clients.
 */
import crypto from "crypto";
import fs from "fs";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { loadPartners, savePartners, blankPartner, clientFieldsOf, type Partner, type ClientPurchaseOrder } from "@/lib/partners";

/** The shape clients.json has always had, plus the registration id. */
export interface ClientMirrorEntry {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  requires: string[];
  dscOn: string[];
  notes: string;
  poNumbers: ClientPurchaseOrder[];
  code?: string;
  active?: boolean;
  [k: string]: any;
}

interface ClientFile { clients: any[]; seededFrom?: string; seededAt?: string; [k: string]: any }

export function nameKey(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Every name a client is known by (for matching an old entry to it). */
function keysOf(p: Partial<Partner>): string[] {
  return [p.name, p.legalName, p.shortName].map(nameKey).filter(Boolean);
}

export function toMirrorEntry(p: Partner, previous: any = {}): ClientMirrorEntry {
  const c = clientFieldsOf(p);
  return {
    ...previous,
    id: p.id,
    name: p.name,
    shortName: c.shortName,
    aliases: c.aliases,
    requires: c.requires,
    dscOn: c.dscOn,
    notes: c.requirementNotes,
    poNumbers: c.poNumbers,
    code: p.code || "",
    active: p.status !== "blocked",
  };
}

function mergePos(a: ClientPurchaseOrder[], b: ClientPurchaseOrder[]): ClientPurchaseOrder[] {
  const out = [...a];
  for (const po of b) {
    if (!po || !po.number) continue;
    const dupe = out.some((x) => (po.id && x.id === po.id) || x.number.trim().toLowerCase() === String(po.number).trim().toLowerCase());
    if (!dupe) out.push({ ...po, id: po.id || crypto.randomUUID() });
  }
  return out;
}

/** A registration built from an old client-master entry. */
function partnerFromEntry(entry: any): Partner {
  const base = blankPartner({ id: "system", name: "Client master (merged)" }, "client");
  const c = clientFieldsOf({ ...entry, requirementNotes: entry.notes });
  return {
    ...base,
    id: String(entry.id || "").trim() || base.id,
    name: String(entry.name || "").trim(),
    legalName: String(entry.legalName || "").trim(),
    gstin: String(entry.gstin || "").trim().toUpperCase(),
    code: String(entry.code || "").trim().toUpperCase(),
    category: "trading",
    supplies: [],
    ...c,
    notes: "Merged from the client master (document requirements list). Add GST, PAN and KYC papers to complete the registration.",
    clientMasterMerged: true,
  };
}

let syncing = false;

/**
 * Merge clients.json into the registrations, then rewrite clients.json
 * from them. Returns the (possibly updated) partner list.
 */
export function syncClientRegistry(): Partner[] {
  const partners = loadPartners();
  if (syncing) return partners;
  syncing = true;
  try {
    const exists = fs.existsSync(paths.clientsFile);
    const file = readJson<ClientFile>(paths.clientsFile, { clients: [] });
    const entries: any[] = Array.isArray(file.clients) ? file.clients : [];
    let changed = false;

    for (const entry of entries) {
      if (!entry || !String(entry.name || "").trim()) continue;
      const id = String(entry.id || "").trim();
      let match = id ? partners.find((p) => p.id === id) : undefined;
      if (match && match.kind !== "client") match = undefined;
      // De-duplicate by GSTIN first (the one identifier that cannot be
      // spelt two ways), then by name / legal name / short name.
      const gst = String(entry.gstin || "").trim().toUpperCase();
      if (!match && gst) {
        match = partners.find((p) => p.kind === "client" && p.category === "trading" && String(p.gstin || "").toUpperCase() === gst);
      }
      if (!match) {
        // Any of the entry's names (name, short name, legal name) against
        // any of the registration's — "NTPC Limited – Tanda" (short name
        // "NTPC Tanda") is the registration "NTPC Tanda".
        const ek = keysOf(entry);
        match = partners.find((p) => p.kind === "client" && p.category === "trading" && keysOf(p).some((k) => ek.includes(k)));
      }
      if (!match) {
        partners.push(partnerFromEntry(entry));
        changed = true;
        continue;
      }
      const c = clientFieldsOf(match);
      const ec = clientFieldsOf({ ...entry, requirementNotes: entry.notes });
      const next: Partner = { ...match, ...c };
      if (!match.clientMasterMerged) {
        // First merge of a registration that already existed: requirements
        // come from the master unless the registration already had some.
        next.requires = c.requires.length ? c.requires : ec.requires;
        next.dscOn = c.requires.length ? c.dscOn : ec.dscOn;
        next.requirementNotes = c.requirementNotes || ec.requirementNotes;
        next.shortName = c.shortName || ec.shortName;
        next.clientMasterMerged = true;
      }
      // The old master's spelling keeps matching on paperwork: if the
      // entry was named differently, its name becomes an alias.
      const entryNames = [entry.name, entry.shortName].map((x: any) => String(x || "").trim().toLowerCase()).filter((x: string) => x && !keysOf(match!).includes(nameKey(x)));
      next.aliases = Array.from(new Set([...c.aliases, ...ec.aliases, ...entryNames]));
      next.poNumbers = mergePos(c.poNumbers, ec.poNumbers);
      if (JSON.stringify(next) !== JSON.stringify(match)) {
        partners[partners.indexOf(match)] = next;
        changed = true;
      }
    }

    if (changed) savePartners(partners);
    writeMirror(partners, file, exists);
    return partners;
  } finally {
    syncing = false;
  }
}

/** Rewrite clients.json from the registrations (trading clients only). */
function writeMirror(partners: Partner[], file: ClientFile = readJson<ClientFile>(paths.clientsFile, { clients: [] }), exists = fs.existsSync(paths.clientsFile)) {
  const previous: any[] = Array.isArray(file.clients) ? file.clients : [];
  const trading = partners.filter((p) => p.kind === "client" && p.category === "trading" && p.name.trim());
  // Keep the file's existing order (people know where things are), new ones at the end.
  const order = new Map<string, number>();
  previous.forEach((e, i) => { if (e?.id) order.set(String(e.id), i); });
  const byName = new Map<string, any>();
  for (const e of previous) if (e?.name) byName.set(nameKey(e.name), e);
  const rows = trading
    .map((p) => {
      const prev = previous.find((e) => e?.id === p.id) || byName.get(nameKey(p.name)) || {};
      return { row: toMirrorEntry(p, prev), at: order.has(p.id) ? order.get(p.id)! : 1e9 };
    })
    .sort((a, b) => a.at - b.at || a.row.name.localeCompare(b.row.name))
    .map((x) => x.row);
  // Never CREATE an empty file: the WhatsApp agent seeds the SOP client
  // list only when the file is missing.
  if (!exists && rows.length === 0) return;
  const next = { ...file, clients: rows };
  if (exists && JSON.stringify(previous) === JSON.stringify(rows)) return;
  ensureDir(paths.configDir);
  writeJsonAtomic(paths.clientsFile, { ...next, updatedAt: new Date().toISOString(), syncedFromRegistrationAt: new Date().toISOString() });
}

/** Save the registrations and refresh clients.json in one step. */
export function saveClientsAndMirror(partners: Partner[]): void {
  savePartners(partners);
  writeMirror(partners);
}

/** Refresh clients.json after any registration save (best effort). */
export function refreshClientMirror(): void {
  try { writeMirror(loadPartners()); } catch { /* derived file — the registration is safe */ }
}

/** Remove one client from clients.json (its registration was deleted). */
export function dropFromClientMirror(idOrName: string): void {
  try {
    const file = readJson<ClientFile>(paths.clientsFile, { clients: [] });
    const key = nameKey(idOrName);
    const clients = (file.clients || []).filter((c: any) => c?.id !== idOrName && nameKey(c?.name) !== key);
    if (clients.length !== (file.clients || []).length) writeJsonAtomic(paths.clientsFile, { ...file, clients, updatedAt: new Date().toISOString() });
  } catch { /* nothing to do */ }
}

/** Find a TRADING client registration by id, name, short name or alias. */
export function findTradingClient(partners: Partner[], idOrName: string): Partner | undefined {
  const raw = String(idOrName || "").trim();
  if (!raw) return undefined;
  const byId = partners.find((p) => p.id === raw && p.kind === "client");
  if (byId) return byId;
  const k = nameKey(raw);
  const clients = partners.filter((p) => p.kind === "client" && p.category === "trading");
  return (
    clients.find((p) => nameKey(p.name) === k) ||
    clients.find((p) => keysOf(p).includes(k)) ||
    clients.find((p) => (p.aliases || []).some((a) => nameKey(a) === k))
  );
}

/** clients.json as the readers see it, after a sync. */
export function loadClientMirror(): ClientMirrorEntry[] {
  syncClientRegistry();
  const f = readJson<ClientFile>(paths.clientsFile, { clients: [] });
  return Array.isArray(f.clients) ? f.clients : [];
}

export function clientMirrorMeta(): { seededFrom: string | null; file: string } {
  const f = readJson<ClientFile>(paths.clientsFile, { clients: [] });
  return { seededFrom: f.seededFrom || null, file: paths.clientsFile };
}
