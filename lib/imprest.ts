/**
 * Biome Platform — imprest (server only)
 * -------------------------------------------------------------------
 * An imprest account is a cash float held by a person. Money moves three
 * ways and the sign convention matters, so it is fixed here once:
 *
 *   advance  — the company hands cash to the holder      (+ to their float)
 *   expense  — the holder spends it and produces a bill  (- from the float)
 *   return   — the holder hands unspent cash back        (- from the float)
 *
 * Only APPROVED movements change a balance. A pending expense is a claim,
 * not a fact, and counting claims would let anyone inflate their own float
 * by filing entries nobody has looked at.
 *
 * Everything lives in <DataRoot>/imprest/, so a backup of the data folder
 * carries the ledger and its bills together.
 */

import crypto from "crypto";
import path from "path";
import fs from "fs";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export type ImprestKind = "advance" | "expense" | "return";
export type ImprestStatus = "submitted" | "approved" | "rejected";

/**
 * How the money physically moved.
 *
 * The business pays some people by bank transfer and some in cash, and the
 * same person can be paid either way in different months. Without this the
 * float reconciles against the ledger but nobody can say which advance went
 * through the bank, which is exactly what accounts needs when they tie the
 * imprest back to Tally.
 */
export type PaymentMode = "cash" | "bank" | "upi" | "cheque";

export const PAYMENT_MODES: { id: PaymentMode; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank transfer" },
  { id: "upi", label: "UPI" },
  { id: "cheque", label: "Cheque" },
];

/** Spend categories. Editable list would be nicer; this covers their work. */
/**
 * Expense heads.
 *
 * Grouped the way the money is actually spent at a biomass plant, because
 * a flat list of twelve makes people pick whichever is nearest the top.
 * Anything genuinely new goes under "Other" and gets added here once it
 * has happened more than once — a head nobody uses is worse than none.
 */
export const IMPREST_CATEGORIES = [
  // --- Vehicles and movement ---
  "Fuel & diesel",
  "Vehicle repair & tyre",
  "Toll, FASTag & parking",
  "Driver payment / bhatta",
  "Loading / unloading labour",
  "Weighbridge charges",
  "Freight & cartage",

  // --- Plant and machinery ---
  "Machine spare parts",
  "Machine servicing & repair",
  "Electrical & wiring",
  "Welding & fabrication",
  "Lubricants & grease",
  "Plant consumables",
  "Tools & equipment",
  "Safety equipment (PPE)",
  "Housekeeping & cleaning",

  // --- Material and site ---
  "Raw material advance",
  "Packing material (bags, bori)",
  "Water & sanitation",
  "Electricity & generator fuel",
  "Rent & site charges",

  // --- People ---
  "Labour payment",
  "Staff welfare",
  "Food & refreshment",
  "Medical & first aid",
  "Travel & lodging",

  // --- Office and statutory ---
  "Office & stationery",
  "Printing & photocopy",
  "Mobile & internet",
  "Courier & postage",
  "Statutory / government fee",
  "Bank charges",
  "Legal & professional",
  "Miscellaneous / Other",
] as const;

export interface ImprestPerson {
  id: string;
  code: string;
  name: string;
  designation: string;
  /** Plant they draw against. Empty for head-office staff. */
  plant: string;
  /** The login this holder files from, when they have one. */
  userId: string | null;
  /** Soft ceiling — filing above it is allowed but flagged for approval. */
  monthlyLimit: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImprestAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Path relative to the imprest folder, never absolute. */
  file: string;
  uploadedAt: string;
}

export interface ImprestEvent {
  at: string;
  by: string;
  byName: string;
  action: string;
  note?: string;
}

export interface ImprestEntry {
  id: string;
  /** Set when a developer rewrote this entry (stays highlighted). */
  devEdited?: { by: string; at: string; fields: string[]; note?: string } | null;
  personId: string;
  kind: ImprestKind;
  /** Date of the spend or the hand-over, not the date it was typed. */
  date: string;
  category: string;
  amount: number;
  description: string;
  /** Bill number, voucher number, vehicle number — whatever ties it to paper. */
  reference: string;
  /** Cash, bank, UPI or cheque — how this movement actually happened. */
  mode: PaymentMode;
  /** UTR, cheque number or transaction id, when there is one. */
  transactionRef: string;
  plant: string;
  attachments: ImprestAttachment[];
  status: ImprestStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  history: ImprestEvent[];
}

interface PeopleFile { people: ImprestPerson[]; }
interface EntriesFile { entries: ImprestEntry[]; }

function imprestDir() { return path.join(paths.root, "imprest"); }
function peopleFile() { return path.join(imprestDir(), "people.json"); }
function entriesFile() { return path.join(imprestDir(), "entries.json"); }
export function attachmentsDir() { return path.join(imprestDir(), "attachments"); }

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function loadPeople(): ImprestPerson[] {
  const f = readJson<PeopleFile>(peopleFile(), { people: [] });
  return Array.isArray(f.people) ? f.people : [];
}

export function savePeople(people: ImprestPerson[]): void {
  ensureDir(imprestDir());
  writeJsonAtomic(peopleFile(), { people, updatedAt: new Date().toISOString() });
}

/** The holder record for a login, if that login has one. */
export function personForUser(userId: string): ImprestPerson | undefined {
  return loadPeople().find((p) => p.userId === userId && p.active);
}

export function makePerson(input: {
  code: string;
  name: string;
  designation: string;
  plant: string;
  userId: string | null;
  monthlyLimit: number;
}): ImprestPerson {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    code: input.code,
    name: input.name,
    designation: input.designation,
    plant: input.plant,
    userId: input.userId,
    monthlyLimit: input.monthlyLimit,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

export function loadEntries(): ImprestEntry[] {
  const f = readJson<EntriesFile>(entriesFile(), { entries: [] });
  return Array.isArray(f.entries) ? f.entries : [];
}

export function saveEntries(entries: ImprestEntry[]): void {
  ensureDir(imprestDir());
  writeJsonAtomic(entriesFile(), { entries, updatedAt: new Date().toISOString() });
}

/** Plain-language labels. "Return" reads as a rejection to most people. */
export const KIND_LABELS: Record<ImprestKind, { short: string; long: string; help: string }> = {
  advance: {
    short: "Money received",
    long: "Money received — cash or transfer given to you",
    help: "Recorded by accounts when they hand over the float. It increases what you hold.",
  },
  expense: {
    short: "Money spent",
    long: "Money spent — you paid for something",
    help: "Attach the bill. It reduces what you hold.",
  },
  return: {
    short: "Money given back",
    long: "Money given back — you returned unspent cash to the office",
    help: "Use this when you hand leftover cash back. It reduces what you hold.",
  },
};

/**
 * Signed effect of one entry on a float.
 *
 * Rejected entries contribute nothing — that is the whole point of the
 * rejection. Submitted entries contribute nothing either, so a balance
 * never moves on a claim alone.
 */
export function signedAmount(entry: ImprestEntry): number {
  if (entry.status !== "approved") return 0;
  return entry.kind === "advance" ? entry.amount : -entry.amount;
}

export interface ImprestBalance {
  personId: string;
  advanced: number;
  spent: number;
  returned: number;
  /** Split of what has been advanced, for tying back to the bank statement. */
  advancedByBank: number;
  advancedByCash: number;
  /** Cash the holder should physically have right now. */
  inHand: number;
  /** Filed but not yet decided — shown separately, never mixed into inHand. */
  pendingClaims: number;
  pendingCount: number;
  lastActivity: string | null;
}

export function balanceFor(personId: string, entries: ImprestEntry[]): ImprestBalance {
  const mine = entries.filter((e) => e.personId === personId);
  let advanced = 0, spent = 0, returned = 0, pendingClaims = 0, pendingCount = 0;
  let advancedByBank = 0, advancedByCash = 0;
  let last: string | null = null;

  for (const e of mine) {
    if (e.status === "approved") {
      if (e.kind === "advance") {
        advanced += e.amount;
        // Anything not physically cash is money accounts can find on a
        // statement; cash is the part that only this ledger accounts for.
        if (e.mode && e.mode !== "cash") advancedByBank += e.amount;
        else advancedByCash += e.amount;
      }
      else if (e.kind === "expense") spent += e.amount;
      else returned += e.amount;
    } else if (e.status === "submitted") {
      pendingCount += 1;
      // An advance awaiting approval is money not yet handed over, so it
      // is not "pending against the float" the way a claim is.
      if (e.kind !== "advance") pendingClaims += e.amount;
    }
    if (!last || e.updatedAt > last) last = e.updatedAt;
  }

  return {
    personId,
    advanced,
    spent,
    returned,
    advancedByBank,
    advancedByCash,
    // Expenses add up against the float and receipts come back off it —
    // in hand = what was given, less what was spent, less what was returned.
    inHand: advanced - spent - returned,
    pendingClaims,
    pendingCount,
    lastActivity: last,
  };
}

/** Approved spend by this holder inside a calendar month (YYYY-MM). */
export function spentInMonth(personId: string, month: string, entries: ImprestEntry[]): number {
  return entries
    .filter(
      (e) =>
        e.personId === personId &&
        e.kind === "expense" &&
        e.status === "approved" &&
        e.date.slice(0, 7) === month
    )
    .reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Whether an entry may still be changed by the person who filed it.
 *
 * Once accounts has approved or rejected it, the paper trail is settled and
 * editing it would rewrite a decision someone signed off. They file a fresh
 * entry instead.
 */
export function isEditable(entry: ImprestEntry): boolean {
  return entry.status === "submitted";
}

export function event(by: string, byName: string, action: string, note?: string): ImprestEvent {
  return { at: new Date().toISOString(), by, byName, action, note };
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
]);
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export function attachmentAllowed(type: string, size: number): string | null {
  if (!ALLOWED_TYPES.has(type)) return "Only photos (JPG, PNG, WEBP) and PDF bills can be attached.";
  if (size > MAX_ATTACHMENT_BYTES) return "That file is over 12 MB. Photograph the bill instead of scanning it at full size.";
  return null;
}

export async function storeAttachment(entryId: string, name: string, type: string, bytes: Buffer): Promise<ImprestAttachment> {
  const dir = path.join(attachmentsDir(), entryId);
  ensureDir(dir);
  // The stored name is generated, never the browser's — an uploaded name
  // can contain path separators and walk out of the folder.
  const ext = (name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const id = crypto.randomUUID();
  const fileName = `${id}.${ext || "bin"}`;
  fs.writeFileSync(path.join(dir, fileName), bytes);
  return {
    id,
    name: name.slice(0, 180),
    size: bytes.length,
    type,
    file: path.join(entryId, fileName),
    uploadedAt: new Date().toISOString(),
  };
}

/** Resolves a stored attachment path, refusing anything outside the folder. */
export function attachmentPath(relative: string): string | null {
  const base = attachmentsDir();
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}
