/**
 * ONE vendor register.
 *
 * Registration (partners) is the single place vendors and transporters
 * are created, with KYC and the role rules the business set:
 *   plant manager  → raw-material vendors + transporters of their plant
 *   coordinator    → trading vendors
 *   admin/accounts/developer → all
 * A coordinator never sees plant vendors; a plant manager never sees
 * trading ones (enforced in /api/partners).
 *
 * The WhatsApp agent still reads config/vendors.json for codes and
 * aliases — so that file is now DERIVED from Registration, never edited
 * on its own. One-time import brings the 53 seeded vendors (the trading
 * supply list) into Registration; after that every save syncs back.
 */
import fs from "fs";
import { paths, readJson, writeJsonAtomic } from "@/lib/dataRoot";
import { loadPartners, savePartners, blankPartner, type Partner } from "@/lib/partners";

interface MasterVendor { code: string; name: string; aliases?: string[]; active?: boolean; kyc?: any[]; [k: string]: any }

export function importMasterIntoRegistration(): number {
  let master: MasterVendor[] = [];
  try { master = JSON.parse(fs.readFileSync(paths.vendorsFile, "utf8")).vendors || []; } catch { return 0; }
  const partners = loadPartners();
  const have = new Set(partners.map((p) => (p.code || "").toUpperCase() + "|" + p.name.trim().toLowerCase()));
  let added = 0;
  for (const v of master) {
    if (!v.code || !v.name) continue;
    if ([...have].some((k) => k.endsWith("|" + v.name.trim().toLowerCase()))) continue;
    const p: Partner = { ...blankPartner({ id: "system", name: "Vendor master import" }, "biomass_vendor"), code: String(v.code).toUpperCase(), name: v.name, legalName: v.name, category: "trading", status: v.active === false ? "blocked" : "active", plants: [], notes: `Imported from the vendor master (WhatsApp supply list). Aliases: ${(v.aliases || []).join(", ")}` } as Partner;
    (p as any).aliases = v.aliases || [];
    partners.push(p); added += 1;
  }
  if (added) savePartners(partners);
  return added;
}

/**
 * Registration → vendors.json (what the agent reads).
 *
 * ADDS and UPDATES; it does not replace. It used to rebuild the file from
 * Registration alone, so on a fresh install (Registration still empty, or
 * holding one test vendor) the first save wiped the company's 53-code
 * master and every WhatsApp document went unmatched. A vendor leaves the
 * master only when it is deleted from Registration (`removedCodes`).
 */
export function syncMasterFromRegistration(removedCodes: string[] = []): void {
  let file: any = { vendors: [] };
  try { file = JSON.parse(fs.readFileSync(paths.vendorsFile, "utf8")); } catch { /* fresh */ }
  const removed = new Set(removedCodes.map((c) => String(c).toUpperCase()));
  const byCode = new Map<string, MasterVendor>();
  for (const v of (Array.isArray(file.vendors) ? file.vendors : []) as MasterVendor[]) {
    const code = String(v.code || "").toUpperCase();
    if (!code || removed.has(code)) continue;
    byCode.set(code, v);
  }
  // Codes are unique per plant (and within trading), so two plants may use
  // the same code. The agent's list is keyed by code alone: trading vendors
  // (the coordination register it serves) claim a code first, and a code is
  // written once per pass — never two vendors' names and aliases merged.
  const claimed = new Set<string>();
  const ordered = loadPartners()
    .filter((p) => p.kind === "biomass_vendor" && p.code)
    .sort((a, b) => (a.category === "trading" ? 0 : 1) - (b.category === "trading" ? 0 : 1));
  for (const p of ordered) {
    const code = p.code.toUpperCase();
    if (claimed.has(code)) continue;
    claimed.add(code);
    const prev: Partial<MasterVendor> = byCode.get(code) || {};
    const aliases = Array.from(new Set([...(prev.aliases || []), ...((p as any).aliases || []), p.name.toLowerCase(), ...(p.legalName ? [p.legalName.toLowerCase()] : [])])).filter(Boolean);
    byCode.set(code, { ...prev, code, name: p.name, aliases, active: p.status !== "blocked", gstin: p.gstin || prev.gstin || "", category: p.category, kyc: prev.kyc || [] });
  }
  writeJsonAtomic(paths.vendorsFile, { ...file, vendors: Array.from(byCode.values()), syncedFromRegistrationAt: new Date().toISOString() });
}
