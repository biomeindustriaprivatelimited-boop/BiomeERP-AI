/**
 * Biome Platform — imprest (server only)
 * -------------------------------------------------------------------
 * An imprest account is a cash float held by a person. Money moves two
 * ways and the sign convention matters, so it is fixed here once:
 *
 *   advance  ("Money received") — cash reaches the holder   (+ to their float)
 *   expense  ("Money spent")    — the holder pays it out    (- from the float)
 *
 * Cash handed back to the office is "Money spent" with the category
 * "Cash returned to office" — it leaves the float but is not spending.
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

/**
 * Two entry types only: "advance" is shown as "Money received", "expense"
 * as "Money spent". The old third type "return" is migrated on load.
 */
export type ImprestKind = "advance" | "expense";
/**
 * `pending_budget_approval` — the expense would take an enforced budget
 * past its amount, so it is held for the admin/developer. Once they pass
 * it, it becomes an ordinary `submitted` claim for accounts.
 */
export type ImprestStatus = "submitted" | "approved" | "rejected" | "pending_budget_approval";

/** Why an entry was held for budget approval, and what was decided. */
export interface BudgetHold {
  at: string;
  breaches: {
    budgetId: string; label: string; periodLabel: string;
    amount: number; remainingBefore: number; overBy: number;
  }[];
  /** Total excess across the worst breach — the figure people quote. */
  overBy: number;
  decision: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  /** The amount the admin agreed to. An edit above it is checked again. */
  approvedAmount: number | null;
}

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

  // --- Not a spend: leftover cash handed back to the office ---
  "Cash returned to office",
] as const;

/**
 * There are only two kinds of entry a person files: money spent and money
 * received. Handing leftover cash back to the office is "money spent" with
 * this category — it leaves the holder's hands — but it is NOT spending, so
 * budgets, spend totals and reports leave it out (see isCashReturn).
 *
 * Older data had a third kind, "return". loadEntries() migrates those to
 * kind "expense" + this category, and keeps the old kind in `legacyKind`.
 */
export const RETURN_CATEGORY = "Cash returned to office";

/** Category given to "money received" entries that never had one. */
export const RECEIVED_CATEGORY = "Advance / float received";

/** Where received money came from — a short pick list, free text allowed. */
export const RECEIVED_SOURCES = [
  "Accounts / head office",
  "Plant manager",
  "Director",
  "Client / party",
  "Other",
] as const;

/**
 * Above this amount a "money spent" entry needs a bill photo or PDF. The
 * form refuses to file without one, and accounts cannot approve such an
 * entry while it has no bill attached.
 */
export const BILL_REQUIRED_ABOVE = 500;

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
  /** "Money received": who handed it over (accounts, a director, a party…). */
  receivedFrom?: string;
  /** The kind this entry had before the two-type migration, if it changed. */
  legacyKind?: string;
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
  /** Set when the entry crossed an enforced budget. Kept after the decision. */
  budgetHold?: BudgetHold | null;
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
  const list = Array.isArray(f.entries) ? f.entries : [];
  // One-time, idempotent migration to the two entry types. Written back so
  // every later reader (reports, budgets, backups) sees the same thing.
  let changed = false;
  const out = list.map((e) => {
    const m = migrateEntry(e);
    if (m !== e) changed = true;
    return m;
  });
  if (changed) {
    try { saveEntries(out); } catch { /* read-only data root: migrate in memory only */ }
  }
  return out;
}

/**
 * Old "return" → money spent, category "Cash returned to office".
 * Old "advance" with no category → category "Advance / float received".
 * Returns the same object when nothing needs to change.
 */
export function migrateEntry(e: ImprestEntry): ImprestEntry {
  if ((e.kind as string) === "return") {
    return {
      ...e,
      kind: "expense",
      legacyKind: "return",
      category: e.category && e.category !== RETURN_CATEGORY ? `${RETURN_CATEGORY} (${e.category})` : RETURN_CATEGORY,
    };
  }
  if (e.kind === "advance" && !e.category) {
    return { ...e, category: RECEIVED_CATEGORY, legacyKind: e.legacyKind || "advance" };
  }
  return e;
}

/** Leftover cash handed back — leaves the float but is not spending. */
export function isCashReturn(e: Pick<ImprestEntry, "kind" | "category">): boolean {
  return (e.kind as string) === "return" || (e.kind === "expense" && (e.category || "").startsWith(RETURN_CATEGORY));
}

/** Real spending: "money spent" that is not cash handed back. */
export function isSpend(e: Pick<ImprestEntry, "kind" | "category">): boolean {
  return e.kind === "expense" && !isCashReturn(e);
}

/** Text normalised for duplicate checks. */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Entries that look like the same money filed twice: same holder, same
 * type, same date, same amount, and the same description (ignoring case
 * and punctuation). Rejected entries don't count — re-filing a rejected
 * claim is the expected fix.
 */
export function findDuplicates(
  entries: ImprestEntry[],
  c: { id?: string; personId: string; kind: string; date: string; amount: number; description: string }
): ImprestEntry[] {
  const d = norm(c.description);
  return entries.filter(
    (e) =>
      e.id !== c.id &&
      e.personId === c.personId &&
      e.status !== "rejected" &&
      e.kind === c.kind &&
      e.date === c.date &&
      Math.abs(e.amount - c.amount) < 0.005 &&
      norm(e.description) === d
  );
}

/** True when a "money spent" entry of this size must carry a bill. */
export function billRequired(e: Pick<ImprestEntry, "kind" | "category" | "amount">): boolean {
  return isSpend(e) && e.amount > BILL_REQUIRED_ABOVE;
}

export function saveEntries(entries: ImprestEntry[]): void {
  ensureDir(imprestDir());
  writeJsonAtomic(entriesFile(), { entries, updatedAt: new Date().toISOString() });
}

/**
 * Plain-language labels. Only two types are offered to anyone filing:
 * money spent and money received. (The API still understands "return"
 * from an old client and converts it to money spent / cash returned.)
 */
export const KIND_LABELS: Record<"advance" | "expense", { short: string; long: string; help: string }> = {
  advance: {
    short: "Money received",
    long: "Money received — cash or transfer given to you",
    help: "Say who gave it. It increases what you hold once accounts confirms it.",
  },
  expense: {
    short: "Money spent",
    long: "Money spent — you paid for something (or gave cash back to the office)",
    help: "Attach the bill. It reduces what you hold.",
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
  /** Over-budget entries waiting for the admin. */
  budgetHeldCount: number;
  budgetHeldAmount: number;
  lastActivity: string | null;
}

export function balanceFor(personId: string, entries: ImprestEntry[]): ImprestBalance {
  const mine = entries.filter((e) => e.personId === personId);
  let advanced = 0, spent = 0, returned = 0, pendingClaims = 0, pendingCount = 0;
  let budgetHeldCount = 0, budgetHeldAmount = 0;
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
      else if (isCashReturn(e)) returned += e.amount;
      else spent += e.amount;
    } else if (e.status === "submitted") {
      pendingCount += 1;
      // An advance awaiting approval is money not yet handed over, so it
      // is not "pending against the float" the way a claim is.
      if (e.kind !== "advance") pendingClaims += e.amount;
    } else if (e.status === "pending_budget_approval") {
      budgetHeldCount += 1;
      budgetHeldAmount += e.amount;
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
    budgetHeldCount,
    budgetHeldAmount,
    lastActivity: last,
  };
}

/** Approved spend by this holder inside a calendar month (YYYY-MM). */
export function spentInMonth(personId: string, month: string, entries: ImprestEntry[]): number {
  return entries
    .filter(
      (e) =>
        e.personId === personId &&
        isSpend(e) &&
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
  return entry.status === "submitted" || entry.status === "pending_budget_approval";
}

export const STATUS_LABELS: Record<ImprestStatus, string> = {
  submitted: "Waiting for accounts",
  approved: "Approved",
  rejected: "Rejected",
  pending_budget_approval: "Over budget — needs admin approval",
};

/**
 * Opens a float for a login that may file imprest but has none yet.
 *
 * Plant managers, coordinators and procurement hold `imprest.entry`, but
 * until now they could file only after accounts had opened a holder
 * record linked to their login — and the register refuses anyone not on
 * the employee master, so a plant manager often never got one and the
 * "File an entry" button never appeared. The login itself is the
 * authority here: it already carries the permission to file.
 *
 * Details are taken from the employee master when the person is on it.
 */
export function ensureSelfHolder(
  user: { id: string; username: string; name: string; plants?: string[] },
  sessionPlant: string | null,
  employees: { code: string; name: string; designation?: string; plant?: string; active?: boolean }[] = []
): ImprestPerson {
  const people = loadPeople();
  const existing = people.find((p) => p.userId === user.id);
  // A holder switched off by accounts stays off — never re-opened here.
  if (existing) return existing;
  const emp = employees.find((e) => e.active !== false && e.name.trim().toLowerCase() === user.name.trim().toLowerCase());
  const taken = new Set(people.map((p) => p.code));
  const base = ((emp?.code || user.username || "USER").toUpperCase().replace(/[^A-Z0-9-]/g, "") || "USER").slice(0, 10).padEnd(2, "X");
  let code = base;
  for (let i = 2; taken.has(code) && i < 999; i++) code = `${base.slice(0, 12 - String(i).length - 1)}-${i}`;
  const person = makePerson({
    code,
    name: user.name,
    designation: emp?.designation || "",
    plant: sessionPlant || emp?.plant || (user.plants && user.plants.length === 1 ? user.plants[0] : "") || "",
    userId: user.id,
    monthlyLimit: 0,
  });
  savePeople([...people, person]);
  return person;
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
