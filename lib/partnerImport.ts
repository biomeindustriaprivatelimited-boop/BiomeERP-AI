/**
 * One-time imports of the owner's master lists into Registration:
 *
 *   - the VENDOR CODE list (name → short code used in reference numbers
 *     BDC/<our no>/<vendor code>/<vendor no>) into the TRADING vendors;
 *   - the CLIENT list into the TRADING clients (one client register).
 *
 * Always previewed first: what will be created, which existing vendors get
 * a code, and the conflicts. A conflict is never applied silently — only
 * when the person ticks "apply conflicts too". Duplicate codes inside the
 * owner's own list (SGE three times) are imported as given and flagged.
 *
 * Pure functions over the partner list; the route saves and audits.
 */
import { blankPartner, normaliseCode, type Partner } from "@/lib/partners";
import { OWNER_VENDOR_CODES, OWNER_CLIENTS } from "@/lib/ownerMasters";

const SUFFIX = /\b(private|pvt|limited|ltd|llp|opc|the)\b/g;

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function strip(s: unknown): string {
  return norm(s).replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/**
 * The spellings a name can be matched by, strongest first. A bracketed
 * part counts too ("ARAVALI POWER COMPANY PVT LTD (APCPL)" also matches
 * "apcpl"), but a short generic remainder ("NTPC" from "NTPC LTD
 * (Khargone)") never does on its own — that is how two plants would merge.
 */
export function matchKeys(name: string): string[] {
  const out: string[] = [];
  const add = (k: string) => { if (k && !out.includes(k)) out.push(k); };
  add(norm(name));
  add(strip(name));
  const m = name.match(/\(([^)]*)\)/);
  if (m) {
    const outside = name.replace(/\([^)]*\)/g, " ");
    add(strip(`${outside} ${m[1]}`));
    const inner = norm(m[1]);
    if (inner.length >= 4) add(inner);
    if (strip(outside).split(" ").length >= 3) { add(norm(outside)); add(strip(outside)); }
  }
  return out;
}

function partnerKeys(p: Partner): Set<string> {
  const s = new Set<string>();
  for (const n of [p.name, p.legalName, p.shortName || "", ...((p as any).aliases || [])]) {
    if (!String(n || "").trim()) continue;
    for (const k of matchKeys(String(n))) s.add(k);
  }
  return s;
}

/** The single record a name matches, or a list when it is ambiguous. */
function findByName(candidates: Partner[], name: string): { one?: Partner; many?: Partner[] } {
  const keyed = candidates.map((p) => ({ p, keys: partnerKeys(p) }));
  for (const k of matchKeys(name)) {
    const hits = keyed.filter((x) => x.keys.has(k)).map((x) => x.p);
    if (hits.length === 1) return { one: hits[0] };
    if (hits.length > 1) return { many: hits };
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* Vendor codes                                                        */
/* ------------------------------------------------------------------ */

export type VendorImportAction = "create" | "set_code" | "unchanged" | "conflict";

export interface VendorImportRow {
  name: string;
  code: string;
  action: VendorImportAction;
  /** Plain words for the preview. */
  note: string;
  existingId?: string;
  existingName?: string;
  existingCode?: string;
  /** For a conflict: what "apply conflicts too" would do. */
  conflictFix?: "replace_code" | "create_anyway";
  /** The code is given to more than one vendor in the owner's own list. */
  dupInList: boolean;
}

function tradingVendors(partners: Partner[]): Partner[] {
  return partners.filter((p) => p.category === "trading" && (p.kind === "biomass_vendor" || p.kind === "other"));
}

export function previewVendorImport(partners: Partner[], list = OWNER_VENDOR_CODES): VendorImportRow[] {
  const vendors = tradingVendors(partners);
  const countInList = new Map<string, number>();
  for (const r of list) countInList.set(normaliseCode(r.code), (countInList.get(normaliseCode(r.code)) || 0) + 1);
  const namesForCode = (code: string) => list.filter((r) => normaliseCode(r.code) === code).flatMap((r) => matchKeys(r.name));

  return list.map((r) => {
    const code = normaliseCode(r.code);
    const dupInList = (countInList.get(code) || 0) > 1;
    const found = findByName(vendors, r.name);
    // Someone already registered holding this code who is NOT one of the
    // names the list gives this code to.
    const holder = vendors.find((v) => normaliseCode(v.code) === code && v.id !== found.one?.id && ![...partnerKeys(v)].some((k) => namesForCode(code).includes(k)));
    const base = { name: r.name, code, dupInList };
    if (found.many) {
      return { ...base, action: "conflict" as const, note: `Matches ${found.many.length} registered vendors (${found.many.map((p) => p.name).join(", ")}) — set the code by hand on the right one.` };
    }
    const p = found.one;
    if (p) {
      const have = normaliseCode(p.code);
      const ex = { existingId: p.id, existingName: p.name, existingCode: have };
      if (have === code) return { ...base, ...ex, action: "unchanged" as const, note: "Already registered with this code." };
      if (holder) return { ...base, ...ex, action: "conflict" as const, conflictFix: "replace_code" as const, note: `Code ${code} is already used by ${holder.name}.` };
      if (!have) return { ...base, ...ex, action: "set_code" as const, note: `Registered without a code — will get ${code}.` };
      return { ...base, ...ex, action: "conflict" as const, conflictFix: "replace_code" as const, note: `Registered with a different code (${have}). Apply conflicts to replace it with ${code}.` };
    }
    if (holder) return { ...base, action: "conflict" as const, conflictFix: "create_anyway" as const, note: `Not registered, and code ${code} is already used by ${holder.name}.` };
    return { ...base, action: "create" as const, note: "Not registered yet — will be created as a trading vendor (draft) with this code." };
  });
}

export function applyVendorImport(
  partners: Partner[], by: { id: string; name: string }, opts: { applyConflicts: boolean }, list = OWNER_VENDOR_CODES
): { partners: Partner[]; created: string[]; coded: string[]; skipped: string[]; removedCodes: string[] } {
  const rows = previewVendorImport(partners, list);
  const next = [...partners];
  const now = new Date().toISOString();
  const created: string[] = [], coded: string[] = [], skipped: string[] = [], replaced: string[] = [];
  for (const r of rows) {
    const doCreate = r.action === "create" || (r.action === "conflict" && opts.applyConflicts && r.conflictFix === "create_anyway");
    const doCode = r.action === "set_code" || (r.action === "conflict" && opts.applyConflicts && r.conflictFix === "replace_code");
    if (doCreate) {
      next.push({
        ...blankPartner(by, "biomass_vendor"),
        name: r.name, legalName: r.name, code: r.code, category: "trading", supplies: ["biomass"],
        notes: "Imported from the owner's vendor code list. Add GST, PAN, bank and KYC papers to complete the registration.",
        codeImportedAt: now,
      });
      created.push(`${r.name} (${r.code})`);
    } else if (doCode && r.existingId) {
      const i = next.findIndex((p) => p.id === r.existingId);
      if (i === -1) continue;
      if (next[i].code && normaliseCode(next[i].code) !== r.code) replaced.push(normaliseCode(next[i].code));
      next[i] = { ...next[i], code: r.code, codeImportedAt: now, updatedAt: now };
      coded.push(`${r.name} → ${r.code}`);
    } else if (r.action === "conflict") {
      skipped.push(`${r.name} (${r.code}): ${r.note}`);
    }
  }
  // An old code leaves the agent's vendor list only if nobody holds it now.
  const removedCodes = replaced.filter((c) => !next.some((p) => normaliseCode(p.code) === c));
  return { partners: next, created, coded, skipped, removedCodes };
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export type ClientImportAction = "create" | "exists" | "conflict";

export interface ClientImportRow {
  name: string;
  action: ClientImportAction;
  note: string;
  existingId?: string;
  existingName?: string;
  /** The owner's spelling is added as an alias so paperwork still matches. */
  addAlias?: string;
}

function tradingClients(partners: Partner[]): Partner[] {
  return partners.filter((p) => p.kind === "client" && p.category === "trading");
}

export function previewClientImport(partners: Partner[], list = OWNER_CLIENTS): ClientImportRow[] {
  const clients = tradingClients(partners);
  return list.map((name) => {
    const found = findByName(clients, name);
    if (found.many) return { name, action: "conflict" as const, note: `Matches ${found.many.length} registered clients (${found.many.map((p) => p.name).join(", ")}) — not imported; check them by hand.` };
    if (found.one) {
      const p = found.one;
      const spelling = norm(name);
      const known = partnerKeys(p).has(spelling);
      return {
        name, action: "exists" as const, existingId: p.id, existingName: p.name,
        addAlias: known ? undefined : spelling,
        note: p.name === name ? "Already registered." : `Already registered as "${p.name}"${known ? "." : " — this spelling is added as an alias so paperwork still matches."}`,
      };
    }
    return { name, action: "create" as const, note: "Not registered yet — will be created as a trading client (draft). Accounts then sets its document requirements." };
  });
}

export function applyClientImport(
  partners: Partner[], by: { id: string; name: string }, list = OWNER_CLIENTS
): { partners: Partner[]; created: string[]; aliased: string[]; skipped: string[] } {
  const rows = previewClientImport(partners, list);
  const next = [...partners];
  const now = new Date().toISOString();
  const created: string[] = [], aliased: string[] = [], skipped: string[] = [];
  for (const r of rows) {
    if (r.action === "create") {
      const m = r.name.match(/\(([^)]*)\)/);
      const inner = m ? norm(m[1]) : "";
      next.push({
        ...blankPartner(by, "client"),
        name: r.name, legalName: r.name, category: "trading", supplies: [],
        aliases: Array.from(new Set([norm(r.name), ...(inner.length >= 4 ? [inner] : [])])),
        notes: "Imported from the owner's client list. Add GST, PAN, contacts and KYC to complete the registration.",
        clientMasterMerged: true,
      });
      created.push(r.name);
    } else if (r.action === "exists" && r.addAlias && r.existingId) {
      const i = next.findIndex((p) => p.id === r.existingId);
      if (i === -1) continue;
      next[i] = { ...next[i], aliases: Array.from(new Set([...(next[i].aliases || []), r.addAlias])), updatedAt: now };
      aliased.push(`${r.existingName} ← "${r.name}"`);
    } else if (r.action === "conflict") {
      skipped.push(`${r.name}: ${r.note}`);
    }
  }
  return { partners: next, created, aliased, skipped };
}
