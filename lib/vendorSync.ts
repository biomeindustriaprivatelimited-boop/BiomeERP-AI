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

/** Registration → vendors.json (what the agent reads). Keeps every extra field the master file already had. */
export function syncMasterFromRegistration(): void {
  let file: any = { vendors: [] };
  try { file = JSON.parse(fs.readFileSync(paths.vendorsFile, "utf8")); } catch { /* fresh */ }
  const existing = new Map<string, MasterVendor>((file.vendors || []).map((v: MasterVendor) => [`${String(v.code).toUpperCase()}|${v.name.trim().toLowerCase()}`, v]));
  const vendors: MasterVendor[] = [];
  for (const p of loadPartners().filter((p) => p.kind === "biomass_vendor" && p.code)) {
    const key = `${p.code.toUpperCase()}|${p.name.trim().toLowerCase()}`;
    const prev: Partial<MasterVendor> = existing.get(key) || {};
    const aliases = Array.from(new Set([...(prev.aliases || []), ...((p as any).aliases || []), p.name.toLowerCase(), ...(p.legalName ? [p.legalName.toLowerCase()] : [])])).filter(Boolean);
    vendors.push({ ...prev, code: p.code.toUpperCase(), name: p.name, aliases, active: p.status !== "blocked", gstin: p.gstin || prev.gstin || "", category: p.category, kyc: prev.kyc || [] });
  }
  writeJsonAtomic(paths.vendorsFile, { ...file, vendors, syncedFromRegistrationAt: new Date().toISOString() });
}
