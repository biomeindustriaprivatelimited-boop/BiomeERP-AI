import { NextRequest, NextResponse } from "next/server";
import { devStamp } from "@/lib/devEdit";
import crypto from "crypto";
import { requirePermission, getSession, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadEntries, saveEntries, loadPeople, personForUser, balanceFor,
  spentInMonth, isEditable, event, ImprestEntry, ImprestKind, IMPREST_CATEGORIES,
  PaymentMode, PAYMENT_MODES,
} from "@/lib/imprest";
import { loadBudgets, usageForMonth, impactOf } from "@/lib/imprestBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ImprestKind[] = ["advance", "expense", "return"];

/**
 * Who may see which entries.
 *
 * Three tiers, deliberately narrow:
 *
 *   viewAll (admin)  — every holder's whole ledger.
 *   approve (accounts) — their own float, plus anything still awaiting a
 *     decision and anything they themselves decided. They cannot browse a
 *     colleague's settled spending history; approving does not grant that.
 *   everyone else — their own float only.
 *
 * The business asked that one employee must never see another's imprest and
 * that the full view is the admin's alone. Approval still has to work, so
 * an approver sees exactly what they must act on and no more.
 */
function visibleTo(
  entries: ImprestEntry[],
  opts: { viewAll: boolean; canApprove: boolean; myPersonId: string | null; myUserId: string }
) {
  if (opts.viewAll) return entries;
  const own = (e: ImprestEntry) => opts.myPersonId && e.personId === opts.myPersonId;
  if (opts.canApprove) {
    return entries.filter(
      (e) => own(e) || e.status === "submitted" || e.decidedBy === opts.myUserId
    );
  }
  if (!opts.myPersonId) return [];
  return entries.filter(own);
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canApprove = hasPermission(user.role, "imprest.approve");
  const viewAll = hasPermission(user.role, "imprest.viewAll");
  const people = loadPeople();
  const all = loadEntries();
  const me = personForUser(user.id) || null;
  const scopeOpts = { viewAll, canApprove, myPersonId: me?.id ?? null, myUserId: user.id };

  let entries = visibleTo(all, scopeOpts);

  /**
   * Plant isolation. A manager signed in for Rewari must not see Gangakhed
   * work, and the two plants' figures must not mix in anyone's view but the
   * office roles'. The session carries the plant it was opened for, so this
   * holds even for someone assigned to both.
   */
  if (!canApprove && auth.session.plant) {
    entries = entries.filter((e) => !e.plant || e.plant === auth.session.plant);
  }

  // Filters. Applied after the visibility cut, never instead of it.
  const url = req.nextUrl.searchParams;
  const status = url.get("status");
  const personId = url.get("personId");
  const month = url.get("month");
  const plant = url.get("plant");
  if (status && status !== "all") entries = entries.filter((e) => e.status === status);
  if (personId) entries = entries.filter((e) => e.personId === personId);
  if (month) entries = entries.filter((e) => e.date.slice(0, 7) === month);
  if (plant) entries = entries.filter((e) => e.plant === plant);

  entries = [...entries].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));

  // What each entry still awaiting a decision would do to its budgets.
  const budgets = loadBudgets();
  const budgetMonth = month || new Date().toISOString().slice(0, 7);
  const budgetImpacts: Record<string, ReturnType<typeof impactOf>> = {};
  for (const e of entries) {
    if (e.status !== "submitted") continue;
    const impacts = impactOf(e, budgets, all);
    if (impacts.length) budgetImpacts[e.id] = impacts;
  }

  // The holder list follows the same rule: an approver needs names to put
  // against pending entries, everyone else needs only their own record.
  const scope = viewAll
    ? people
    : canApprove
    ? people.filter((p) => p.id === me?.id || entries.some((e) => e.personId === p.id))
    : people.filter((p) => p.id === me?.id);

  return NextResponse.json({
    entries,
    people: scope.map((p) => ({ ...p, balance: balanceFor(p.id, all) })),
    me: me ? { ...me, balance: balanceFor(me.id, all) } : null,
    canApprove,
    viewAll,
    canManage: hasPermission(user.role, "imprest.manage"),
    // Drives the first-run guide: an admin with no holders needs telling
    // where to start, not an empty screen.
    needsSetup: people.length === 0,
    myPlant: auth.session.plant,
    categories: IMPREST_CATEGORIES,
    paymentModes: PAYMENT_MODES,
    // Lets the approvals screen poll cheaply and only redraw on a change.
    revision: all.length ? all.reduce((m, e) => (e.updatedAt > m ? e.updatedAt : m), "") : "",
    pendingCount: visibleTo(all, scopeOpts).filter((e) => e.status === "submitted").length,
    // Budgets travel with the entries so the approval card can say what
    // passing an entry would do, in the same response that draws it. A
    // second round-trip would mean the card renders first and the warning
    // arrives after the button has been pressed.
    budgetMonth,
    budgetUsage: usageForMonth(budgets, budgetMonth, all),
    budgetImpacts,
  });
}

function readPayload(body: any) {
  const kind = String(body.kind || "") as ImprestKind;
  const date = String(body.date || "").slice(0, 10);
  const amount = Number(body.amount);
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const reference = String(body.reference || "").trim();
  const mode = (PAYMENT_MODES.some((m) => m.id === body.mode) ? body.mode : "cash") as PaymentMode;
  const transactionRef = String(body.transactionRef || "").trim().slice(0, 60);

  if (!KINDS.includes(kind)) return { error: "Choose whether this is an advance, an expense or a return." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter a valid date." };
  if (date > new Date().toISOString().slice(0, 10)) return { error: "The date can't be in the future." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (amount > 10_000_000) return { error: "That amount looks wrong. Check it before filing." };
  if (kind === "expense" && !category) return { error: "Pick what the money was spent on." };
  if (!description) return { error: "Write a short description so accounts knows what this is." };

  return { kind, date, amount: Math.round(amount * 100) / 100, category, description, reference, mode, transactionRef };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.entry");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const parsed = readPayload(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const people = loadPeople();
  const mine = personForUser(user.id);
  const canApprove = hasPermission(user.role, "imprest.approve");

  // Accounts may file on someone's behalf (a cash hand-over at the desk);
  // everyone else files only against their own float.
  const targetId = canApprove && body.personId ? String(body.personId) : mine?.id;
  const person = people.find((p) => p.id === targetId && p.active);
  if (!person) {
    return NextResponse.json(
      { error: mine ? "That imprest holder wasn't found." : "You don't have an imprest account yet. Ask accounts to open one." },
      { status: 400 }
    );
  }

  // Only accounts hands out cash. If an employee could file their own
  // advance, the float would be self-service.
  if (parsed.kind === "advance" && !canApprove) {
    return NextResponse.json(
      { error: "Only accounts can record an advance. File the expense and they'll top you up." },
      { status: 403 }
    );
  }

  const all = loadEntries();
  const now = new Date().toISOString();

  const entry: ImprestEntry = {
    id: crypto.randomUUID(),
    personId: person.id,
    kind: parsed.kind,
    date: parsed.date,
    category: parsed.kind === "expense" ? parsed.category : "",
    amount: parsed.amount,
    description: parsed.description,
    reference: parsed.reference,
    mode: parsed.mode,
    transactionRef: parsed.transactionRef,
    plant: person.plant,
    attachments: [],
    // An advance recorded by accounts is already a decision, so it lands
    // approved. Anything filed by a holder waits for one.
    status: parsed.kind === "advance" && canApprove ? "approved" : "submitted",
    createdBy: user.id,
    createdByName: user.name,
    createdAt: now,
    updatedAt: now,
    decidedBy: parsed.kind === "advance" && canApprove ? user.id : null,
    decidedByName: parsed.kind === "advance" && canApprove ? user.name : null,
    decidedAt: parsed.kind === "advance" && canApprove ? now : null,
    decisionNote: null,
    history: [event(user.id, user.name, "filed")],
  };

  saveEntries([...all, entry]);

  // Advisory only — a genuine overspend still gets filed, it just arrives
  // at approval with a flag on it.
  const monthSpend = spentInMonth(person.id, parsed.date.slice(0, 7), [...all, entry]);
  const overLimit = person.monthlyLimit > 0 && monthSpend > person.monthlyLimit;

  return NextResponse.json({ entry, overLimit, monthSpend, limit: person.monthlyLimit }, { status: 201 });
}

/** Edit an entry that has not been decided yet. */
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Which entry should be updated?" }, { status: 400 });

  const all = loadEntries();
  const existing = all.find((e) => e.id === body.id);
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const canApprove = hasPermission(user.role, "imprest.approve");
  const mine = personForUser(user.id);
  const isOwn = mine && existing.personId === mine.id;

  if (!isOwn && !canApprove) {
    return NextResponse.json({ error: "You can only edit your own imprest entries." }, { status: 403 });
  }
  // A settled entry stays settled for everyone except the developer, who
  // may rewrite it — the record is then stamped and highlighted, and the
  // audit trail keeps the old values.
  if (!isEditable(existing) && user.role !== "developer") {
    return NextResponse.json(
      { error: `This entry was already ${existing.status}. File a fresh entry instead of changing a settled one.` },
      { status: 409 }
    );
  }

  const parsed = readPayload({ ...existing, ...body });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated: ImprestEntry = {
    ...existing,
    kind: parsed.kind,
    date: parsed.date,
    amount: parsed.amount,
    category: parsed.kind === "expense" ? parsed.category : "",
    description: parsed.description,
    reference: parsed.reference,
    mode: parsed.mode,
    transactionRef: parsed.transactionRef,
    updatedAt: new Date().toISOString(),
    history: [...existing.history, event(user.id, user.name, "edited")],
  };
  const stamped = devStamp(updated, existing, { name: user.name, role: user.role }, body.devNote);

  saveEntries(all.map((e) => (e.id === stamped.id ? stamped : e)));
  return NextResponse.json({ entry: stamped });
}

/** Withdraw an entry. Only while it is still undecided. */
export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "This account is no longer active." }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which entry?" }, { status: 400 });

  const all = loadEntries();
  const existing = all.find((e) => e.id === id);
  if (!existing) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const canApprove = hasPermission(user.role, "imprest.approve");
  const mine = personForUser(user.id);
  const isOwn = mine && existing.personId === mine.id;

  if (!isOwn && !canApprove) {
    return NextResponse.json({ error: "You can only withdraw your own imprest entries." }, { status: 403 });
  }
  if (!isEditable(existing)) {
    return NextResponse.json({ error: "A decided entry stays on the record." }, { status: 409 });
  }

  saveEntries(all.filter((e) => e.id !== id));
  return NextResponse.json({ ok: true });
}
