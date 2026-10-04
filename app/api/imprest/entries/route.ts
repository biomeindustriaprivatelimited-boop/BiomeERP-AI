import { NextRequest, NextResponse } from "next/server";
import { devStamp } from "@/lib/devEdit";
import crypto from "crypto";
import { requirePermission, getSession, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadEntries, saveEntries, loadPeople, personForUser, balanceFor,
  spentInMonth, isEditable, event, ImprestEntry, ImprestKind, IMPREST_CATEGORIES,
  PaymentMode, PAYMENT_MODES, ensureSelfHolder, ImprestPerson, BudgetHold, STATUS_LABELS,
  RETURN_CATEGORY, RECEIVED_CATEGORY, RECEIVED_SOURCES, BILL_REQUIRED_ABOVE, billRequired, findDuplicates,
  isCashReturn, KIND_LABELS,
} from "@/lib/imprest";
import {
  loadBudgets, usageForMonth, impactOf, breachesOf, breachMessage, makeLookup,
  visibleBudgets, isBudgetAuthority, BudgetImpact,
} from "@/lib/imprestBudget";
import { loadEmployees } from "@/lib/payroll";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only two types. "return" is still understood from older clients. */
const KINDS: string[] = ["advance", "expense", "return"];

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
  opts: { viewAll: boolean; canApprove: boolean; myPersonId: string | null; myUserId: string; plantView?: string | null }
) {
  if (opts.viewAll) return entries;
  const own = (e: ImprestEntry) => opts.myPersonId && e.personId === opts.myPersonId;
  // Plant manager: every holder at the plant this session is signed in
  // for — read only, and never another plant's.
  if (opts.plantView) return entries.filter((e) => own(e) || e.plant === opts.plantView);
  if (opts.canApprove) {
    return entries.filter(
      (e) => own(e) || e.status === "submitted" || e.decidedBy === opts.myUserId
    );
  }
  if (!opts.myPersonId) return [];
  return entries.filter(own);
}

/**
 * Field logins (plant manager, coordinator, procurement) file for
 * themselves. If accounts never opened a float for them, open one now —
 * otherwise the "File an entry" button simply never appears. Office roles
 * (approve / manage) are left alone: they file on other people's behalf
 * and an automatic float of their own would only clutter the register.
 */
function selfHolder(user: any, sessionPlant: string | null): ImprestPerson | null {
  const existing = personForUser(user.id);
  if (existing) return existing;
  if (!hasPermission(user.role, "imprest.entry")) return null;
  if (hasPermission(user.role, "imprest.approve") || hasPermission(user.role, "imprest.manage")) return null;
  const before = loadPeople().some((p) => p.userId === user.id);
  const p = ensureSelfHolder(user, sessionPlant, loadEmployees());
  if (!before) {
    recordAudit({
      action: "IMPREST_HOLDER_AUTO",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "imprest_person", targetId: p.id, targetLabel: `${p.name} (${p.code})`,
      detail: "Float opened automatically on first use", plant: p.plant || null,
    });
  }
  return p.active ? p : null;
}

function budgetLookup(people: ImprestPerson[]) {
  return makeLookup(people, loadEmployees());
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const canApprove = hasPermission(user.role, "imprest.approve");
  const viewAll = hasPermission(user.role, "imprest.viewAll");
  const me = selfHolder(user, auth.session.plant || null);
  const people = loadPeople();
  const all = loadEntries();
  const plantView = hasPermission(user.role, "imprest.viewPlant") && auth.session.plant ? auth.session.plant : null;
  const scopeOpts = { viewAll, canApprove, myPersonId: me?.id ?? null, myUserId: user.id, plantView };

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
  const lookup = budgetLookup(people);
  const budgets = visibleBudgets(loadBudgets(), {
    all: viewAll || canApprove,
    personId: me?.id ?? null,
    plantView,
    sessionPlant: auth.session.plant || null,
    lookup,
  });
  const budgetMonth = month || new Date().toISOString().slice(0, 7);
  const budgetImpacts: Record<string, ReturnType<typeof impactOf>> = {};
  for (const e of entries) {
    if (e.status !== "submitted" && e.status !== "pending_budget_approval") continue;
    const impacts = impactOf(e, budgets, all, lookup);
    if (impacts.length) budgetImpacts[e.id] = impacts;
  }

  // The holder list follows the same rule: an approver needs names to put
  // against pending entries, everyone else needs only their own record.
  const scope = viewAll
    ? people
    : plantView
    ? people.filter((p) => p.id === me?.id || p.plant === plantView)
    : canApprove
    ? people.filter((p) => p.id === me?.id || entries.some((e) => e.personId === p.id))
    : people.filter((p) => p.id === me?.id);

  return NextResponse.json({
    entries,
    people: scope.map((p) => ({ ...p, balance: balanceFor(p.id, all) })),
    me: me ? { ...me, balance: balanceFor(me.id, all) } : null,
    canApprove,
    viewAll,
    plantView,
    canManage: hasPermission(user.role, "imprest.manage"),
    // Plant manager: may file for any holder at the plant signed in for.
    canFileForPlant: !canApprove && !!plantView && hasPermission(user.role, "imprest.entry"),
    // Admin / developer: set budgets and pass over-budget entries.
    canBudgetApprove: isBudgetAuthority(user.role),
    myUserId: user.id,
    budgetHeldCount: isBudgetAuthority(user.role) ? all.filter((e) => e.status === "pending_budget_approval").length : 0,
    statusLabels: STATUS_LABELS,
    // Drives the first-run guide: an admin with no holders needs telling
    // where to start, not an empty screen.
    needsSetup: people.length === 0,
    myPlant: auth.session.plant,
    categories: IMPREST_CATEGORIES,
    returnCategory: RETURN_CATEGORY,
    receivedSources: RECEIVED_SOURCES,
    billRequiredAbove: BILL_REQUIRED_ABOVE,
    kindLabels: KIND_LABELS,
    paymentModes: PAYMENT_MODES,
    // Lets the approvals screen poll cheaply and only redraw on a change.
    revision: all.length ? all.reduce((m, e) => (e.updatedAt > m ? e.updatedAt : m), "") : "",
    pendingCount: visibleTo(all, scopeOpts).filter((e) => e.status === "submitted").length,
    // Budgets travel with the entries so the approval card can say what
    // passing an entry would do, in the same response that draws it. A
    // second round-trip would mean the card renders first and the warning
    // arrives after the button has been pressed.
    budgetMonth,
    budgetUsage: usageForMonth(budgets, budgetMonth, all, lookup),
    budgetImpacts,
  });
}

function readPayload(body: any) {
  const rawKind = String(body.kind || "");
  // Older phone builds may still send "return" — that is money spent with
  // the "Cash returned to office" category now.
  const kind = (rawKind === "return" ? "expense" : rawKind) as ImprestKind;
  const date = String(body.date || "").slice(0, 10);
  const amount = Number(body.amount);
  let category = rawKind === "return" ? RETURN_CATEGORY : String(body.category || "").trim();
  if (kind === "advance" && !category) category = RECEIVED_CATEGORY;
  const receivedFrom = kind === "advance" ? String(body.receivedFrom || "").trim().slice(0, 80) : "";
  const description = String(body.description || "").trim();
  const reference = String(body.reference || "").trim();
  const mode = (PAYMENT_MODES.some((m) => m.id === body.mode) ? body.mode : "cash") as PaymentMode;
  const transactionRef = String(body.transactionRef || "").trim().slice(0, 60);

  if (!KINDS.includes(rawKind)) return { error: "Choose whether this is money spent or money received." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter a valid date." };
  if (date > new Date().toISOString().slice(0, 10)) return { error: "The date can't be in the future." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (amount > 10_000_000) return { error: "That amount looks wrong. Check it before filing." };
  if (kind === "expense" && !category) return { error: "Pick what the money was spent on." };
  if (!description) return { error: "Write a short description so accounts knows what this is." };

  return { kind, date, amount: Math.round(amount * 100) / 100, category, receivedFrom, description, reference, mode, transactionRef };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.entry");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const parsed = readPayload(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const sessionPlant = auth.session.plant || null;
  const mine = selfHolder(user, sessionPlant);
  const people = loadPeople();
  const canApprove = hasPermission(user.role, "imprest.approve");
  const plantView = hasPermission(user.role, "imprest.viewPlant") && sessionPlant ? sessionPlant : null;

  // Accounts may file on anyone's behalf (a cash hand-over at the desk); a
  // plant manager for any holder at the plant they are signed in for;
  // everyone else only against their own float.
  const wanted = body.personId ? String(body.personId) : "";
  let targetId = mine?.id;
  if (wanted && canApprove) targetId = wanted;
  else if (wanted && plantView && wanted !== mine?.id) {
    const other = people.find((p) => p.id === wanted && p.active);
    if (!other || other.plant !== plantView) {
      return NextResponse.json({ error: "You can only file for imprest holders at your own plant." }, { status: 403 });
    }
    targetId = wanted;
  }
  const person = people.find((p) => p.id === targetId && p.active);
  if (!person) {
    return NextResponse.json(
      { error: mine ? "That imprest holder wasn't found." : "You don't have an imprest account yet. Ask accounts to open one." },
      { status: 400 }
    );
  }
  const forSelf = !!mine && person.id === mine.id;

  // "Money received" may be filed by anyone, but only an approver's entry
  // lands approved. A holder's own "I received ₹5,000 from X" waits for
  // accounts to confirm it, so the float is never self-service.
  if (parsed.kind === "advance" && !parsed.receivedFrom) {
    if (canApprove) parsed.receivedFrom = "Accounts / head office";
    else if (body.preview !== true) {
      return NextResponse.json({ error: "Say who gave you this money (for example: Accounts / head office)." }, { status: 400 });
    }
  }

  const all = loadEntries();
  const now = new Date().toISOString();

  const entry: ImprestEntry = {
    id: crypto.randomUUID(),
    personId: person.id,
    kind: parsed.kind,
    date: parsed.date,
    category: parsed.category,
    receivedFrom: parsed.receivedFrom || undefined,
    amount: parsed.amount,
    description: parsed.description,
    reference: parsed.reference,
    mode: parsed.mode,
    transactionRef: parsed.transactionRef,
    // A manager signed in for a plant files against that plant, even if
    // their float was first opened at another one.
    plant: forSelf && sessionPlant && !canApprove ? sessionPlant : person.plant,
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

  // Budgets. An expense that would take an ENFORCED budget past its
  // amount is not filed as a normal claim: it is held for the admin.
  const lookup = budgetLookup(people);
  const impacts = impactOf(entry, loadBudgets(), all, lookup);
  const breaches = breachesOf(impacts);

  // Mistake guards. Worked out once, used by the live preview and by the
  // real filing alike, so what the form warns about is what the server
  // checks.
  const bal = balanceFor(person.id, all);
  // Cash the holder can still account for: approved balance less claims
  // already filed but not yet decided.
  const available = Math.round((bal.inHand - bal.pendingClaims) * 100) / 100;
  const after = Math.round((available + (entry.kind === "advance" ? entry.amount : -entry.amount)) * 100) / 100;
  const overBalance = entry.kind === "expense" && after < 0;
  const duplicates = findDuplicates(all, entry).map((d) => ({
    id: d.id, date: d.date, amount: d.amount, description: d.description, status: d.status, createdByName: d.createdByName,
  }));
  const needsBill = billRequired(entry);
  const guards = { available, after, overBalance, duplicates, needsBill, billRequiredAbove: BILL_REQUIRED_ABOVE };

  // Live preview for the form: what this amount would do, nothing saved.
  if (body.preview === true) {
    return NextResponse.json({ preview: true, impacts, breaches, blocked: breaches.length > 0, message: breaches.length ? breachMessage(breaches) : "", ...guards });
  }

  // A bill is required above the limit. The form sends `hasBill` when it
  // has a file ready to upload straight after this entry is saved.
  if (needsBill && body.hasBill !== true) {
    return NextResponse.json({
      error: `A bill photo or PDF is required for money spent above ₹${BILL_REQUIRED_ABOVE.toLocaleString("en-IN")}. Attach it and file again.`,
      needsBill: true,
    }, { status: 400 });
  }
  // Same money filed twice is the commonest imprest mistake. Ask once.
  if (duplicates.length && body.confirmDuplicate !== true) {
    return NextResponse.json({
      error: `This looks like an entry already filed on ${entry.date} for ₹${entry.amount.toLocaleString("en-IN")} with the same description. File it again only if it really is a second payment.`,
      duplicate: true, ...guards,
    }, { status: 409 });
  }
  // Spending more than the holder has. Possible (they paid from their own
  // pocket), so it is a question, not a refusal.
  if (overBalance && body.confirmOverBalance !== true) {
    return NextResponse.json({
      error: `This is more than the cash available (₹${available.toLocaleString("en-IN")}). After this entry the balance would be −₹${Math.abs(after).toLocaleString("en-IN")}. If you paid the extra from your own pocket, confirm and file.`,
      ...guards,
    }, { status: 409 });
  }

  if (breaches.length) applyHold(entry, breaches, user);

  saveEntries([...all, entry]);

  if (breaches.length) {
    recordAudit({
      action: "IMPREST_BUDGET_HOLD",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "imprest_entry", targetId: entry.id,
      targetLabel: `${entry.description} · ₹${entry.amount.toLocaleString("en-IN")}`,
      detail: breachMessage(breaches), plant: entry.plant || null,
    });
  }

  // Advisory only — a genuine overspend still gets filed, it just arrives
  // at approval with a flag on it.
  const monthSpend = spentInMonth(person.id, parsed.date.slice(0, 7), [...all, entry]);
  const overLimit = person.monthlyLimit > 0 && monthSpend > person.monthlyLimit;

  return NextResponse.json({
    entry, overLimit, monthSpend, limit: person.monthlyLimit, ...guards,
    impacts,
    budgetBlocked: breaches.length > 0,
    breaches,
    message: breaches.length
      ? `Over budget — not filed as a normal entry. It is waiting for admin approval. ${breachMessage(breaches)}`
      : "",
  }, { status: 201 });
}

/** Marks an entry as held for budget approval. */
function applyHold(entry: ImprestEntry, breaches: BudgetImpact[], user: { id: string; name: string }) {
  const hold: BudgetHold = {
    at: new Date().toISOString(),
    breaches: breaches.map((b) => ({
      budgetId: b.budgetId, label: b.label, periodLabel: b.periodLabel,
      amount: b.amount, remainingBefore: b.remainingBefore, overBy: b.overBy,
    })),
    overBy: Math.max(...breaches.map((b) => b.overBy)),
    decision: "pending",
    decidedBy: null, decidedByName: null, decidedAt: null, note: null,
    approvedAmount: null,
  };
  entry.status = "pending_budget_approval";
  entry.budgetHold = hold;
  entry.history = [...entry.history, event(user.id, user.name, "held — over budget", breachMessage(breaches))];
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
  const isOwn = (mine && existing.personId === mine.id) || filedForPlant(user, session.plant, existing);

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
    category: parsed.category,
    receivedFrom: parsed.kind === "advance" ? (parsed.receivedFrom || existing.receivedFrom || undefined) : undefined,
    description: parsed.description,
    reference: parsed.reference,
    mode: parsed.mode,
    transactionRef: parsed.transactionRef,
    updatedAt: new Date().toISOString(),
    history: [...existing.history, event(user.id, user.name, "edited")],
  };
  // Re-check the budgets for anything not yet settled. An edit that brings
  // a held entry back inside its budget releases it; an edit that pushes a
  // claim over (or above what the admin agreed) holds it again.
  let breaches: BudgetImpact[] = [];
  if (existing.status === "submitted" || existing.status === "pending_budget_approval") {
    breaches = updated.kind === "expense" && !isCashReturn(updated)
      ? breachesOf(impactOf(updated, loadBudgets(), all, budgetLookup(loadPeople())))
      : [];
    const agreed = existing.budgetHold?.decision === "approved" ? existing.budgetHold.approvedAmount ?? 0 : null;
    if (breaches.length && !(agreed !== null && updated.amount <= agreed)) {
      applyHold(updated, breaches, user);
    } else if (existing.status === "pending_budget_approval") {
      updated.status = "submitted";
      updated.budgetHold = breaches.length ? existing.budgetHold : null;
      updated.history = [...updated.history, event(user.id, user.name, "released — now inside budget")];
      breaches = [];
    } else {
      breaches = [];
    }
  }

  const stamped = devStamp(updated, existing, { name: user.name, role: user.role }, body.devNote);

  saveEntries(all.map((e) => (e.id === stamped.id ? stamped : e)));
  return NextResponse.json({
    entry: stamped,
    budgetBlocked: stamped.status === "pending_budget_approval",
    breaches,
    message: stamped.status === "pending_budget_approval" && breaches.length
      ? `Over budget — waiting for admin approval. ${breachMessage(breaches)}`
      : "",
  });
}

/** A plant manager may change what they filed for a holder at their plant. */
function filedForPlant(user: { id: string; role: any }, sessionPlant: string | null | undefined, e: ImprestEntry): boolean {
  return (
    !!sessionPlant &&
    hasPermission(user.role, "imprest.viewPlant") &&
    hasPermission(user.role, "imprest.entry") &&
    e.createdBy === user.id &&
    e.plant === sessionPlant
  );
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
  const isOwn = (mine && existing.personId === mine.id) || filedForPlant(user, session.plant, existing);

  if (!isOwn && !canApprove) {
    return NextResponse.json({ error: "You can only withdraw your own imprest entries." }, { status: 403 });
  }
  if (!isEditable(existing)) {
    return NextResponse.json({ error: "A decided entry stays on the record." }, { status: 409 });
  }

  saveEntries(all.filter((e) => e.id !== id));
  return NextResponse.json({ ok: true });
}
