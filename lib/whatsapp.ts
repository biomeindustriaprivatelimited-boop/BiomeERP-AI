/**
 * Biome Platform — WhatsApp module
 * -------------------------------------------------------------------
 * Types, label maps and validation helpers shared between the UI and the
 * background agent.
 *
 * This file must stay free of `fs` and every other Node built-in: client
 * components import it, and a stray `require("fs")` here breaks the build
 * with "Module not found: Can't resolve 'fs'". Anything that touches the
 * filesystem belongs in lib/whatsappAgent.ts instead.
 */

// ==================== shared types ====================

export type AgentStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "logged_out"
  | "error"
  | "unavailable";

/** The document set from SOP section 3.3, split by who issued it. */
export type DocumentType =
  | "biome_tax_invoice"
  | "biome_delivery_challan"
  | "biome_eway_bill"
  | "vendor_tax_invoice"
  | "vendor_delivery_challan"
  | "vendor_eway_bill"
  | "bilty_lr"
  | "weight_slip"
  | "fast_tag"
  | "consignment_tag"
  | "coa"
  | "receiving"
  | "lab_report"
  | "biome_debit_note"
  | "vendor_debit_note"
  | "biome_credit_note"
  | "vendor_credit_note"
  | "other";

export const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  biome_tax_invoice: "Biome Tax Invoice",
  biome_delivery_challan: "Biome Delivery Challan",
  biome_eway_bill: "Biome Eway Bill",
  vendor_tax_invoice: "Vendor Tax Invoice",
  vendor_delivery_challan: "Vendor Delivery Challan",
  vendor_eway_bill: "Vendor Eway Bill",
  bilty_lr: "Bilty / LR Copy",
  weight_slip: "Weight Slip",
  fast_tag: "Fast Tag Details",
  consignment_tag: "Consignment Tag",
  coa: "COA (Certificate of Analysis)",
  receiving: "Receiving (client weight slip)",
  lab_report: "Lab Report",
  biome_debit_note: "Biome Debit Note",
  vendor_debit_note: "Vendor Debit Note",
  biome_credit_note: "Biome Credit Note",
  vendor_credit_note: "Vendor Credit Note",
  other: "Other",
};

/**
 * Who issued the document.
 *
 * "client" is a fourth party alongside us, the vendor and the shared
 * papers: a receiving slip and a lab report are produced by the power
 * plant, not by either side of the purchase.
 */
export const DOC_TYPE_SIDE: Record<
  DocumentType,
  "biome" | "vendor" | "shared" | "client" | "other"
> = {
  biome_tax_invoice: "biome",
  biome_delivery_challan: "biome",
  biome_eway_bill: "biome",
  vendor_tax_invoice: "vendor",
  vendor_delivery_challan: "vendor",
  vendor_eway_bill: "vendor",
  bilty_lr: "shared",
  weight_slip: "shared",
  fast_tag: "shared",
  consignment_tag: "shared",
  coa: "shared",
  receiving: "client",
  lab_report: "client",
  biome_debit_note: "biome",
  vendor_debit_note: "vendor",
  biome_credit_note: "biome",
  vendor_credit_note: "vendor",
  other: "other",
};

/** Everything coordination collects, per SOP section 3.3. */
export const REQUIREMENTS: Record<string, string> = {
  tax_invoice: "Tax Invoice",
  delivery_challan: "Delivery Challan",
  eway_bill: "E-Way Bill",
  bilty_lr: "Bilty / LR Copy",
  weight_slip: "Weight Slip",
  fast_tag: "Fast Tag Details",
  consignment_tag: "Consignment Tag",
  coa: "COA (Certificate of Analysis)",
  driver_mobile: "Driver Mobile Number",
};

export const REQUIREMENT_KEYS = Object.keys(REQUIREMENTS);

/**
 * A purchase order the client has placed on us.
 *
 * Held against the client rather than typed on every trip: their own
 * register shows one PO number repeated across 122 rows, and a PO typed
 * 122 times is a PO typed wrong at least once.
 */
export interface PurchaseOrder {
  id: string;
  number: string;
  date: string;
  /** Blank when open-ended. Past this date the picker warns rather than blocks. */
  validTill: string;
  /** Contracted quantity in MT, 0 when not specified. */
  quantityMt: number;
  /** Which site this PO covers — a client can run several. */
  location: string;
  notes: string;
  active: boolean;
}

/** A client and the papers it insists on. Seeded from SOP section 7. */
export interface Client {
  name: string;
  shortName: string;
  aliases: string[];
  requires: string[];
  dscOn: string[];
  notes: string;
  /** Purchase orders, newest first. Optional so older files still load. */
  poNumbers?: PurchaseOrder[];
}

/** SOP section 6.3 — what every vendor must submit at registration. */
export const VENDOR_KYC_PRESETS = [
  "GST Certificate",
  "PAN Card",
  "Aadhaar Card",
  "Cancelled Cheque",
  "Vendor Registration Form",
] as const;

export interface ParsedReference {
  canonical: string; // "BDC/786/MHI/44"
  companyCode: string; // "BDC"
  biomeDocNo: string; // "786"
  vendorCode: string; // "MHI"
  vendorDocNo: string; // "44"
  confidence: number;
}

export interface ExtractedFields {
  documentType: DocumentType;
  confidence: number;
  issuedBy: string | null;
  referenceNo: string | null;
  biomeDocNo: string | null;
  vendorDocNo: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  clientName: string | null;
  clientGstin: string | null;
  documentDate: string | null;
  sampleCollectionDate?: string | null;
  ewayBillNo: string | null;
  vehicleNo: string | null;
  grossWeight: string | null;
  tareWeight: string | null;
  netWeight: string | null;
  driverMobile: string | null;
  /** True when a Digital Signature Certificate block is visible on the page. */
  hasDigitalSignature: boolean;
  taxableValue: string | null;
  totalAmount: string | null;
  transcription: string;
}

export interface WhatsappDocument {
  id: string;
  messageId: string;
  receivedAt: string;
  sender: { chatJid: string; isGroup: boolean; participantJid: string | null; name: string | null };
  originalName: string;
  mimeType: string;
  sizeBytes?: number;
  caption?: string;
  /**
   * Where the document sits:
   *   filed          — in its supply folder
   *   unmatched      — filed under Month/Client/Date, waiting on a reference
   *   _Staged        — a vendor paper held until our invoice claims it
   *   _Not A Document— a screenshot or photo, set aside
   */
  bucket: "filed" | "unmatched" | "_Staged" | "_Not A Document";
  filePath: string | null;
  relativePath?: string;
  sha256?: string;
  deduped?: boolean;
  reference: ParsedReference | null;
  extracted: ExtractedFields | null;
  aiStatus: "ok" | "skipped" | "error";
  aiMessage: string | null;
  reviewRequired?: boolean;
  reviewReason?: string | null;
}

export interface SupplySet {
  reference: string;
  companyCode: string;
  biomeDocNo: string;
  vendorCode: string;
  vendorDocNo: string;
  clientName: string | null;
  vendorName: string | null;
  vehicleNo: string | null;
  receivingWeightKg?: number | null;
  receivingDate?: string | null;
  firstSeen: string;
  lastSeen: string;
  documents: WhatsappDocument[];
  /**
   * Re-shares that were folded away. The same invoice gets sent into the
   * group several times; those copies are kept here rather than counted,
   * so the set reads honestly but nothing is lost.
   */
  duplicates?: WhatsappDocument[];
  duplicateCount?: number;
  /** Papers this client requires that have not arrived yet. */
  missing: { key: string; label: string }[];
  /** Papers that arrived but are missing the DSC this client demands. */
  dscMissing: { key: string; label: string }[];
  clientMatched: boolean;
  clientCanonicalName: string | null;
  clientNotes: string;
  driverMobile: string | null;
  requiredCount: number;
  satisfiedCount: number;
  complete: boolean;
}

export interface AgentState {
  status: AgentStatus;
  qrDataUrl: string | null;
  qrExpiresAt: string | null;
  me: { id: string; name: string | null } | null;
  lastError: string | null;
  lastEventAt: string | null;
  startedAt: string;
  processing: number;
  queueDepth: number;
  hasAiKey: boolean;
  /** What happened to each message since the agent started (Diagnostics). */
  diag?: {
    messagesSeen: number;
    undecryptable: number;
    noMedia: number;
    fromUnselectedChat: number;
    heldUntilGroupList: number;
    alreadyHandled: number;
    queued: number;
    processed: number;
    failed: number;
    lastDocumentAt: string | null;
    selectedChats: string[];
    autoProcess: boolean;
    log: string[];
  };
  build?: string;
  /** "web" (WhatsApp Web in Edge/Chrome) or "baileys". */
  engine?: string;
  browser?: string;
  dataRoot: string;
  inbox: string;
  stats: {
    totalDocuments: number;
    needsReview: number;
    notADocument: number;
    filed: number;
    totalSets: number;
    completeSets: number;
    unknownClientSets: number;
  };
}

// ==================== chats to watch ====================

/** One chat as the agent's GET /chats lists it. */
export interface WaChat {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastSeen: string | null;
  documentCount: number;
  messageCount: number;
  participants: number | null;
  /** Watched in any role (or "watch everything" is on). */
  watched: boolean;
  /** Sales / supply paperwork — the main "Watch" switch. */
  selected: boolean;
  receivingSelected: boolean;
  labSelected: boolean;
  learnFrom: boolean;
  /** A group whose name looks like the supply/sales group. */
  suggested: boolean;
}

export type WaChatRole = "sales" | "receiving" | "lab" | "learn";

export interface WaChatsResponse {
  chats: WaChat[];
  watchingAll: boolean;
  allowedChats: string[];
  receivingChats: string[];
  labChats: string[];
  learnChats: string[];
  listState?: {
    status: AgentStatus | string;
    engine: string | null;
    linked: boolean;
    loading: boolean;
    refreshedAt: string | null;
    lastError: string | null;
    groups: number;
    people: number;
  };
  refreshed?: number;
  note?: string;
}

// ==================== vendor registry ====================

export interface VendorKycFile {
  name: string;
  label: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Vendor {
  /** The short code printed in the reference, e.g. "MHI". Unique key. */
  code: string;
  name: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  supplyType?: "trading" | "manufacturing" | "both" | "";
  material?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  paymentTerms?: string;
  notes?: string;
  active?: boolean;
  kyc?: VendorKycFile[];
  createdAt?: string;
  updatedAt?: string;
}

export const VENDOR_IMPORT_COLUMNS = [
  "code",
  "name",
  "legalName",
  "gstin",
  "pan",
  "supplyType",
  "material",
  "contactPerson",
  "phone",
  "email",
  "addressLine",
  "city",
  "state",
  "stateCode",
  "pincode",
  "bankName",
  "bankAccountNo",
  "bankIfsc",
  "paymentTerms",
  "notes",
] as const;

/** Vendor codes are compared case-insensitively and without punctuation. */
export function normaliseVendorCode(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isValidVendorCode(raw: string): boolean {
  return /^[A-Z][A-Z0-9]{1,7}$/.test(normaliseVendorCode(raw));
}

/** GSTIN: 2-digit state code, 10-char PAN, entity digit, "Z", checksum. */
export function isValidGstin(raw: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(String(raw || "").toUpperCase());
}

export function isValidPan(raw: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(raw || "").toUpperCase());
}
