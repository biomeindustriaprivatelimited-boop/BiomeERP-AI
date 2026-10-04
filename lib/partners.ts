/**
 * Biome Platform — biomass vendor and transporter registration
 * -------------------------------------------------------------------
 * Separate from the existing vendor master on purpose, and worth saying
 * why before anyone tries to merge them.
 *
 * `lib/whatsapp.ts`'s `Vendor` is an OPERATIONAL record: a short code that
 * appears in a coordination reference, so a document arriving on WhatsApp
 * can be matched to a supplier. A coordinator needs it constantly.
 *
 * This is a COMMERCIAL record: who the company is, whether their GST and
 * PAN have been seen, what was agreed and on what terms, and the signed
 * purchase agreement itself. The business asked explicitly that a
 * coordinator not have access to it — a rate card and a signed agreement
 * are not something the person chasing weight slips needs to read.
 *
 * The two are linked by `vendorCode` where a partner is also in the
 * operational master, so nothing has to be typed twice, and neither table
 * has to know how the other works.
 *
 * ONBOARDING IS A STATE, NOT A CHECKBOX. A partner sits at `draft` until
 * the papers that matter are actually on file, and the app says which ones
 * are missing rather than letting somebody tick "verified" over an empty
 * folder.
 */

import crypto from "crypto";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export type PartnerKind = "biomass_vendor" | "client" | "transporter" | "other";

/**
 * A vendor is one of two kinds of business, and the business asked for a
 * hard split between them:
 *
 *   trading      — bought-and-sold material, managed by the COORDINATOR.
 *   raw_material — material for the plant's own line, managed by the
 *                  PLANT MANAGER of the site it serves.
 *
 * A coordinator never sees a raw-material vendor here, and a plant manager
 * never sees a trading one. Transporters always count as raw_material —
 * they belong to the site whose material they move.
 */
export type VendorCategory = "trading" | "raw_material";

export const VENDOR_CATEGORIES: { id: VendorCategory; label: string; help: string }[] = [
  // The id stays "raw_material" so years of stored records keep working;
  // the business calls this side MANUFACTURING.
  { id: "raw_material", label: "Manufacturing (plant)", help: "Vendors and clients of the plant's own manufacturing. Registered by the plant manager of that site." },
  { id: "trading", label: "Trading", help: "Bought-and-sold material — vendors and clients. Registered by the coordinator." },
];

/**
 * What a vendor is handled for. Chosen at registration, several allowed,
 * and read by the modules that pick a vendor: the stock module only offers
 * vendors marked "spare_parts" / "consumables", coordination the biomass
 * ones, and so on — one vendor master, filtered by what each vendor does.
 */
export type SupplyCategory =
  | "biomass" | "spare_parts" | "consumables" | "machinery_service"
  | "transport" | "packaging" | "fuel" | "civil_electrical" | "other";

export const SUPPLY_CATEGORIES: { id: SupplyCategory; label: string }[] = [
  { id: "biomass", label: "Biomass / raw material" },
  { id: "spare_parts", label: "Machine spare parts" },
  { id: "consumables", label: "Consumables & stores" },
  { id: "machinery_service", label: "Machinery repair / service" },
  { id: "transport", label: "Transport" },
  { id: "packaging", label: "Packaging" },
  { id: "fuel", label: "Fuel / lubricants" },
  { id: "civil_electrical", label: "Civil / electrical work" },
  { id: "other", label: "Other" },
];

/**
 * SUBMIT & FREEZE.
 *
 * The coordinator (trading) or plant manager (manufacturing) fills the
 * record, uploads the KYC and business documents, checks everything and
 * presses "Submit & freeze". From then on THEY cannot change it. Accounts,
 * admin and the developer can correct it, or unlock it and send it back
 * for correction — every lock and unlock is on the record's own history
 * and in the audit log.
 */
export type LockState = "open" | "submitted";

export interface LockEvent {
  at: string;
  by: string;
  byName: string;
  action: "submitted" | "unlocked";
  reason: string;
}

/**
 * How long a plant manager's submission stays editable.
 *
 * One week from the day the record was registered, the record freezes for
 * the plant manager who filed it. Admin and accounts can still correct it —
 * the freeze exists so a site cannot quietly rewrite an agreement after the
 * fact, not so a genuine typo lives forever.
 */
export const PARTNER_FREEZE_DAYS = 7;

export interface FreezeInfo {
  /** True once the plant-manager edit window has closed. */
  frozen: boolean;
  /** Whole days left before it closes. 0 on the last day. */
  daysLeft: number;
  /** The date (YYYY-MM-DD) the record freezes on. */
  freezesOn: string;
}

export function freezeInfoFor(p: Pick<Partner, "submittedAt" | "createdAt"> & Partial<Pick<Partner, "lockState" | "lockedAt">>, now = new Date()): FreezeInfo {
  if (p.lockState) {
    const frozen = p.lockState === "submitted";
    return { frozen, daysLeft: frozen ? 0 : 999, freezesOn: frozen ? String(p.lockedAt || "").slice(0, 10) : "" };
  }
  const started = new Date(p.submittedAt || p.createdAt);
  const closes = new Date(started.getTime() + PARTNER_FREEZE_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = closes.getTime() - now.getTime();
  return {
    frozen: msLeft <= 0,
    daysLeft: Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000))),
    freezesOn: closes.toISOString().slice(0, 10),
  };
}

export const PARTNER_KINDS: { id: PartnerKind; label: string; help: string }[] = [
  { id: "biomass_vendor", label: "Vendor / supplier", help: "Supplies material, parts or services — husk, pellet, spare parts, repairs." },
  { id: "client", label: "Client / customer", help: "Buys from us. Their PO, GST and PAN go on file." },
  { id: "transporter", label: "Transporter", help: "Moves the material. Bilty and LR come from them." },
  { id: "other", label: "Other", help: "Contractors, service providers, anyone else on paper." },
];

export type PartnerStatus = "draft" | "active" | "on_hold" | "blocked";

export const PARTNER_STATUS: { id: PartnerStatus; label: string; help: string }[] = [
  { id: "draft", label: "Draft", help: "Being set up. Papers still missing." },
  { id: "active", label: "Active", help: "Registered and cleared to supply." },
  { id: "on_hold", label: "On hold", help: "Paused — a paper has expired or something is being checked." },
  { id: "blocked", label: "Blocked", help: "Do not deal with them. Reason required." },
];

/**
 * The document types this module expects, and which of them a partner
 * cannot be marked Active without.
 *
 * `required` is deliberately short. A long compulsory list means people
 * upload a blank page to get past it, and then the folder looks complete
 * and is worth nothing.
 */
export interface DocumentType {
  id: string;
  label: string;
  /** Which kinds of partner it applies to. Empty means all. */
  kinds: PartnerKind[];
  required: boolean;
  /** True where the paper has a validity date worth chasing. */
  expires: boolean;
  help: string;
}

export const PARTNER_DOCUMENT_TYPES: DocumentType[] = [
  { id: "purchase_agreement", label: "Purchase agreement", kinds: ["biomass_vendor"], required: true, expires: true,
    help: "The signed agreement. Rate, quantity, period, payment terms." },
  { id: "transport_agreement", label: "Transport agreement", kinds: ["transporter"], required: true, expires: true,
    help: "The signed contract for movement — rate per tonne or per trip." },
  { id: "sales_agreement", label: "Sales agreement / contract", kinds: ["client"], required: false, expires: true,
    help: "The signed supply contract with the client." },
  { id: "client_po", label: "Client purchase order", kinds: ["client"], required: false, expires: true,
    help: "The client's PO / work order." },
  { id: "po", label: "Purchase order", kinds: ["biomass_vendor", "transporter", "other"], required: false, expires: true,
    help: "A PO raised against the agreement." },
  { id: "gst_certificate", label: "GST certificate", kinds: [], required: true, expires: false,
    help: "GST registration. Without it their invoice cannot be claimed." },
  { id: "pan", label: "PAN card", kinds: [], required: true, expires: false, help: "" },
  { id: "cancelled_cheque", label: "Cancelled cheque", kinds: ["biomass_vendor", "transporter", "other"], required: true, expires: false,
    help: "Proves the bank account before a payment is made to it." },
  { id: "aadhaar", label: "Owner / proprietor Aadhaar", kinds: [], required: false, expires: false,
    help: "For a proprietorship or a farmer-supplier." },
  { id: "incorporation", label: "Incorporation / partnership deed", kinds: [], required: false, expires: false,
    help: "COI, MOA, partnership deed or LLP agreement." },
  { id: "trade_license", label: "Trade licence / shop act", kinds: [], required: false, expires: true, help: "" },
  { id: "address_proof", label: "Business address proof", kinds: [], required: false, expires: false,
    help: "Electricity bill, rent agreement or property paper." },
  { id: "bank_letter", label: "Bank confirmation letter", kinds: [], required: false, expires: false, help: "" },
  { id: "msme", label: "MSME / Udyam certificate", kinds: [], required: false, expires: false,
    help: "Changes the payment window under the MSMED Act — worth having on file." },
  { id: "rc", label: "Vehicle RC", kinds: ["transporter"], required: false, expires: true, help: "" },
  { id: "insurance", label: "Insurance", kinds: ["transporter"], required: false, expires: true,
    help: "Goods-in-transit or vehicle insurance." },
  { id: "permit", label: "Permit / fitness", kinds: ["transporter"], required: false, expires: true, help: "" },
  { id: "pollution", label: "Pollution certificate", kinds: ["transporter"], required: false, expires: true, help: "" },
  { id: "other", label: "Other document", kinds: [], required: false, expires: false, help: "" },
];

export function documentTypesFor(kind: PartnerKind): DocumentType[] {
  return PARTNER_DOCUMENT_TYPES.filter((d) => d.kinds.length === 0 || d.kinds.includes(kind));
}

export interface PartnerDocument {
  id: string;
  /** One of PARTNER_DOCUMENT_TYPES. */
  type: string;
  label: string;
  /** Reference on the paper itself — PO number, agreement number. */
  reference: string;
  /** When it was signed or issued. */
  documentDate: string;
  /** When it stops being valid. Empty where it does not expire. */
  validTill: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  /** Path relative to the partners folder. Never absolute. */
  file: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
  /** Which site uploaded it — this is what makes the Documents view work. */
  plant: string;
  note: string;
}

export interface Partner {
  id: string;
  kind: PartnerKind;
  /** Trading (coordinator's) or raw material (plant manager's). */
  category: VendorCategory;
  /** When the record was first created. Kept for older code. */
  submittedAt: string;
  /** What this vendor is handled for — spare parts, biomass, transport… */
  supplies: SupplyCategory[];
  /** Submit & freeze state. */
  lockState: LockState;
  lockedAt: string;
  lockedByName: string;
  lockHistory: LockEvent[];
  /** Set when a developer rewrote this record (stays highlighted). */
  devEdited?: { by: string; at: string; fields: string[]; note?: string } | null;
  /** Short code. Matches the operational vendor master where it exists. */
  code: string;
  name: string;
  legalName: string;
  gstin: string;
  pan: string;
  /** Which sites this partner serves. Empty means all. */
  plants: string[];
  material: string;
  contactPerson: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  /** Agreed rate, in words rather than a number — terms vary too much. */
  rateTerms: string;
  paymentTerms: string;
  agreementFrom: string;
  agreementTo: string;
  status: PartnerStatus;
  statusReason: string;
  documents: PartnerDocument[];
  notes: string;
  registeredBy: string;
  registeredByName: string;
  createdAt: string;
  updatedAt: string;
}

interface PartnerFile { partners: Partner[]; updatedAt?: string; }

export function partnersDir(): string {
  return path.join(paths.root, "partners");
}
function file(): string {
  return path.join(partnersDir(), "partners.json");
}

export function loadPartners(): Partner[] {
  const f = readJson<PartnerFile>(file(), { partners: [] });
  const list = Array.isArray(f.partners) ? f.partners : [];
  // Records written before the trading/raw-material split carry neither
  // field. Everything old was registered from a plant, so raw_material is
  // the honest default; the freeze clock starts from when it was created.
  return list.map((p: any) => {
    const submittedAt = p.submittedAt || p.createdAt || new Date().toISOString();
    // Records from before Submit & freeze: the old rule froze a plant
    // manager's record 7 days after registration. Honour that for anything
    // already past it, so nothing that was frozen becomes editable again.
    const legacyFrozen = !p.lockState && Date.now() - new Date(submittedAt).getTime() > PARTNER_FREEZE_DAYS * 86400000;
    return {
      ...p,
      category: p.category === "trading" ? "trading" : "raw_material",
      submittedAt,
      supplies: Array.isArray(p.supplies) ? p.supplies : p.kind === "transporter" ? ["transport"] : p.kind === "biomass_vendor" ? ["biomass"] : [],
      lockState: p.lockState === "submitted" || legacyFrozen ? "submitted" : "open",
      lockedAt: p.lockedAt || (legacyFrozen ? submittedAt : ""),
      lockedByName: p.lockedByName || (legacyFrozen ? "Auto-frozen (old 7-day rule)" : ""),
      lockHistory: Array.isArray(p.lockHistory) ? p.lockHistory : [],
    };
  });
}

export function savePartners(partners: Partner[]): void {
  ensureDir(partnersDir());
  writeJsonAtomic(file(), { partners, updatedAt: new Date().toISOString() });
}

export function blankPartner(by: { id: string; name: string }, kind: PartnerKind = "biomass_vendor"): Partner {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind, category: "raw_material", submittedAt: now,
    supplies: kind === "transporter" ? ["transport"] : kind === "biomass_vendor" ? ["biomass"] : [],
    lockState: "open", lockedAt: "", lockedByName: "", lockHistory: [],
    code: "", name: "", legalName: "", gstin: "", pan: "",
    plants: [], material: "", contactPerson: "", phone: "", email: "",
    addressLine: "", city: "", state: "", pincode: "",
    bankName: "", accountNumber: "", ifsc: "",
    rateTerms: "", paymentTerms: "", agreementFrom: "", agreementTo: "",
    status: "draft", statusReason: "",
    documents: [], notes: "",
    registeredBy: by.id, registeredByName: by.name,
    createdAt: now, updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Name suggestions for the plant sheets                               */
/* ------------------------------------------------------------------ */

/** The sheet-facing names for the three kinds a sheet column can offer. */
export type SuggestKind = "vendor" | "transporter" | "client";

export const SUGGEST_KIND_TO_PARTNER: Record<SuggestKind, PartnerKind> = {
  vendor: "biomass_vendor",
  transporter: "transporter",
  client: "client",
};

/**
 * Just enough of a partner to fill a sheet cell. Deliberately thin: no
 * bank, GST, rate or agreement — a dropdown is not the place to leak the
 * commercial record, and nothing here is needed to type a name.
 */
export interface PartnerSuggestion {
  id: string;
  kind: SuggestKind;
  code: string;
  name: string;
  legalName: string;
  city: string;
  status: PartnerStatus;
}

/**
 * Which registered partners a sheet column may offer.
 *
 *   { trading: true }        — the coordinator's trading register only.
 *   { plantCode: "REW" }     — manufacturing partners tagged with THAT plant
 *                              only. Strict on purpose: a partner with no
 *                              plant, or another plant's partner, never
 *                              appears, so one site's names cannot leak into
 *                              the other's sheet. Trading never appears.
 *
 * Blocked partners are left out — offering one invites a delivery that the
 * business has already said must not happen.
 */
export function partnerSuggestions(
  scope: { trading: true } | { plantCode: string },
  kinds: SuggestKind[],
  partners: Partner[] = loadPartners()
): PartnerSuggestion[] {
  const wanted = new Map<PartnerKind, SuggestKind>(kinds.map((k) => [SUGGEST_KIND_TO_PARTNER[k], k]));
  const plantCode = "plantCode" in scope ? String(scope.plantCode || "").toUpperCase() : "";
  return partners
    .filter((p) => wanted.has(p.kind) && p.status !== "blocked" && p.name.trim())
    .filter((p) =>
      "trading" in scope
        ? p.category === "trading"
        : p.category !== "trading" && !!plantCode && p.plants.some((x) => String(x).toUpperCase() === plantCode)
    )
    .map((p) => ({
      id: p.id,
      kind: wanted.get(p.kind)!,
      code: p.code || "",
      name: p.name,
      legalName: p.legalName || "",
      city: p.city || "",
      status: p.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* What is missing, and what is about to expire                        */
/* ------------------------------------------------------------------ */

export interface PartnerGaps {
  /** Required documents with nothing uploaded against them. */
  missing: { id: string; label: string }[];
  /** Documents whose validity has already passed. */
  expired: { id: string; label: string; validTill: string }[];
  /** Expiring within the next 30 days. */
  expiringSoon: { id: string; label: string; validTill: string; days: number }[];
  /** Fields the paperwork needs that nobody has filled. */
  missingFields: string[];
  /** True when everything required is on file and in date. */
  readyToActivate: boolean;
}

/**
 * Pure, so the same answer appears on the list, on the panel and in the
 * check that refuses to activate a partner. A screen saying "complete"
 * over a server that disagrees is worse than no check at all.
 */
export function gapsFor(p: Partner, today: string = new Date().toISOString().slice(0, 10)): PartnerGaps {
  const types = documentTypesFor(p.kind);
  const have = new Set(p.documents.map((d) => d.type));

  const missing = types
    .filter((t) => t.required && !have.has(t.id))
    .map((t) => ({ id: t.id, label: t.label }));

  const expired: PartnerGaps["expired"] = [];
  const expiringSoon: PartnerGaps["expiringSoon"] = [];
  for (const d of p.documents) {
    if (!d.validTill) continue;
    const days = Math.ceil((new Date(d.validTill + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
    if (days < 0) expired.push({ id: d.id, label: d.label || d.type, validTill: d.validTill });
    else if (days <= 30) expiringSoon.push({ id: d.id, label: d.label || d.type, validTill: d.validTill, days });
  }

  const missingFields: string[] = [];
  if (!p.name.trim()) missingFields.push("Name");
  if (!p.gstin.trim()) missingFields.push("GSTIN");
  if (!p.pan.trim()) missingFields.push("PAN");
  // A payment made to an unverified account is the single most expensive
  // mistake this register can prevent.
  // A client is paid BY us never, so their bank details are optional.
  if (p.kind !== "client" && (!p.accountNumber.trim() || !p.ifsc.trim())) missingFields.push("Bank account and IFSC");

  return {
    missing, expired, expiringSoon, missingFields,
    readyToActivate: missing.length === 0 && expired.length === 0 && missingFields.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Light validation — shape only, never a claim of truth               */
/* ------------------------------------------------------------------ */

/**
 * Checks the SHAPE of a GSTIN, not whether it exists.
 *
 * Worth being clear about: this catches a typo, it does not verify the
 * registration. Saying "GST verified" from a regex would be a lie, and the
 * screen says "looks right" rather than "verified".
 */
export function gstinLooksRight(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

export function panLooksRight(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase());
}

export function ifscLooksRight(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/** The state code a GSTIN begins with, to cross-check the address. */
export function stateCodeFromGstin(gstin: string): string {
  return gstin.trim().slice(0, 2);
}

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
]);
export const MAX_PARTNER_DOC_BYTES = 15 * 1024 * 1024;

export function partnerDocAllowed(type: string, size: number): string | null {
  if (!ALLOWED_TYPES.has(type)) return "Attach a PDF or a photo — agreements are usually PDFs.";
  if (size > MAX_PARTNER_DOC_BYTES) return "That file is over 15 MB. Scan at a lower quality or split it.";
  return null;
}
