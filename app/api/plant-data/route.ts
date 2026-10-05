import { normaliseRowWeights } from "@/lib/units";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { resolvePlantScope } from "@/lib/plantScope";
import { recordAudit } from "@/lib/audit";
import { TRANSPORT_COLUMNS, missingRequired } from "@/lib/plantSheets";
import { sheetPlant } from "@/lib/plantRegistry";
import { lockInfo, entrySignature, LOCK_META_KEYS, SHEET_FREEZE_DAYS, UNLOCK_HOURS } from "@/lib/sheetLock";
import {
  plantFile, readList, writeList, readRows, writeRows, newRowId, rowLabel,
  isEntryRole, canUnlock, type SheetRow,
} from "@/lib/plantSheetStore";

/**
 * Plant vendors and sheet rows, stored on disk.
 *
 * Sheet entries were held in the browser session, which meant closing
 * the tab lost a morning's data entry. They live in the data folder now,
 * beside the WhatsApp documents, so they survive a restart and are
 * included in whatever the company already backs up.
 *
 * Vendors are kept PER PLANT. Rewari buys from farmers around Khaleta
 * and Gangakhed from a different set entirely — one shared list would
 * let a Rewari code be picked on a Gangakhed row, which is exactly the
 * mistake this is meant to prevent.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Vendor {
  code: string;
  name: string;
}

function columnsFor(kind: "biomass" | "transport", plant: string) {
  return kind === "transport" ? TRANSPORT_COLUMNS : sheetPlant(plant)?.biomass || [];
}

/** The keys a person types — what "a frozen row changed" is measured on. */
function entryKeys(kind: "biomass" | "transport", plant: string): string[] {
  return columnsFor(kind, plant).filter((c) => c.kind !== "derived").map((c) => c.key);
}

function stripMeta(r: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (k.startsWith("__") || (LOCK_META_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function metaOf(r: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!r) return out;
  for (const k of LOCK_META_KEYS) if (r[k] !== undefined) out[k] = r[k];
  return out;
}

// ---------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  const what = req.nextUrl.searchParams.get("what") || "rows";
  const kind = req.nextUrl.searchParams.get("kind") === "transport" ? "transport" : "biomass";

  // The plant comes from the session for a field role, never from the query.
  // Before this, `?plant=gangakhed` handed a Rewari manager the other
  // plant's book, and the same held for the transport sheet.
  const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;

  if (what === "vendors") {
    return NextResponse.json({
      plant,
      vendors: readList<Vendor>(plantFile("vendors", plant), "vendors"),
    });
  }

  const user = findById(scoped.scope.userId);
  return NextResponse.json({
    plant,
    kind,
    rows: readRows(kind, plant),
    // Office roles read the plant's book; only the plant manager writes it.
    readOnly: !isEntryRole(scoped.scope.role),
    // Holds plant.unlock: decides edit requests and is not held by the freeze.
    canUnlock: canUnlock(user),
    freezeDays: SHEET_FREEZE_DAYS,
    unlockHours: UNLOCK_HOURS,
    // The import is open to whoever enters rows, and to the approvers
    // (admin / accounts / developer) bringing history in for a plant.
    canImport: isEntryRole(scoped.scope.role) || canUnlock(user),
    // An approver who is not the plant manager corrects existing rows in
    // place (never adds or deletes them).
    approverEdit: !isEntryRole(scoped.scope.role) && canUnlock(user),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Writes are scoped the same way. A field role saving rows can only ever
  // write into their own plant's file, whatever the body claims.
  const scoped = await resolvePlantScope(req, body.plant);
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;

  // ---- Importing a vendor list ----
  if (body.what === "vendors") {
    if (!(scoped.scope.role === "plant_manager" || scoped.scope.role === "developer")) {
      return NextResponse.json({ error: "Only the plant manager keeps the plant's vendor list." }, { status: 403 });
    }
    // Accepts a pasted block from Excel: "BIO01<tab>AMAN MAYAN" per line,
    // or comma-separated. Pasting is what people actually do; asking for
    // a file upload for four columns would be ceremony.
    let incoming: Vendor[] = [];

    if (typeof body.paste === "string" && body.paste.trim()) {
      incoming = body.paste
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const parts = line.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
          return { code: (parts[0] || "").toUpperCase(), name: parts.slice(1).join(" ").trim() };
        })
        // Drop a header row and anything without both fields.
        .filter((v: Vendor) => v.code && v.name && !/^vend(o|e)r\s*code$/i.test(v.code));
    } else if (Array.isArray(body.vendors)) {
      incoming = body.vendors
        .map((v: any) => ({
          code: String(v.code || "").trim().toUpperCase(),
          name: String(v.name || "").trim(),
        }))
        .filter((v: Vendor) => v.code && v.name);
    }

    if (!incoming.length) {
      return NextResponse.json(
        { error: "No vendors found. Paste rows as 'CODE  NAME', one per line." },
        { status: 400 }
      );
    }

    // Merge on code: a re-import corrects names rather than duplicating.
    const existing = readList<Vendor>(plantFile("vendors", plant), "vendors");
    const byCode = new Map(existing.map((v) => [v.code, v]));
    let added = 0;
    let updated = 0;
    for (const v of incoming) {
      if (byCode.has(v.code)) {
        if (byCode.get(v.code)!.name !== v.name) updated += 1;
      } else {
        added += 1;
      }
      byCode.set(v.code, v);
    }

    const merged = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
    writeList(plantFile("vendors", plant), "vendors", merged);

    return NextResponse.json({ ok: true, total: merged.length, added, updated, plant });
  }

  // ---- Submitting rows (Draft → Submitted, or Unlocked → resubmitted) ----
  const kind = body.kind === "transport" ? "transport" : "biomass";
  const user = findById(scoped.scope.userId);
  const entryRole = isEntryRole(scoped.scope.role);
  const unlocker = canUnlock(user);

  if (body.what === "submit") {
    if (!entryRole) {
      return NextResponse.json({ error: "Only the plant manager submits the plant's rows." }, { status: 403 });
    }
    const ids = new Set<string>((Array.isArray(body.ids) ? body.ids : []).map((x: any) => String(x)));
    if (!ids.size) return NextResponse.json({ error: "Which rows?" }, { status: 400 });
    const columns = columnsFor(kind, plant);
    const rows = readRows(kind, plant);
    const now = new Date();
    const submitted: string[] = [];
    const refused: { id: string; label: string; why: string }[] = [];
    for (const r of rows) {
      if (!ids.has(String(r.id))) continue;
      const lock = lockInfo(r, now);
      if (lock.state === "submitted") { refused.push({ id: r.id, label: rowLabel(kind, r), why: "Already submitted." }); continue; }
      if (lock.state === "frozen") { refused.push({ id: r.id, label: rowLabel(kind, r), why: "Frozen — request an edit first." }); continue; }
      const missing = missingRequired(kind, columns, r);
      if (missing.length) { refused.push({ id: r.id, label: rowLabel(kind, r), why: `Fill in: ${missing.join(", ")}.` }); continue; }
      if (lock.state === "unlocked") {
        // Re-submission closes the approved window. The original submission
        // date stands, so a row past its five days freezes again at once.
        r.resubmittedAt = now.toISOString();
        r.unlock = undefined;
      } else {
        r.submittedAt = now.toISOString();
      }
      r.submittedBy = scoped.scope.userId;
      r.submittedByName = scoped.scope.userName;
      submitted.push(r.id);
    }
    if (submitted.length) {
      writeRows(kind, plant, rows);
      recordAudit({
        action: "SHEET_ROWS_SUBMITTED",
        userId: scoped.scope.userId, userName: scoped.scope.userName, role: scoped.scope.role,
        targetType: `${kind}-sheet`, targetId: plant,
        targetLabel: `${submitted.length} ${kind} row${submitted.length === 1 ? "" : "s"}`,
        detail: rows.filter((r) => submitted.includes(r.id)).map((r) => rowLabel(kind, r)).slice(0, 20).join(" | "),
        plant,
      });
    }
    return NextResponse.json({ ok: true, submitted, refused, rows });
  }

  // ---- Saving sheet rows ----

  // The plant's books are the plant manager's: only they (and the
  // developer) add or delete rows. Accounts / admin read them and write in
  // their own remarks column; if they hold plant.unlock they may also
  // correct an existing row directly (submitted or frozen) — that is the
  // approver's own edit, and it is audited like one.
  if (!entryRole) {
    const existing = readRows(kind, plant);
    const incoming = new Map<string, any>((Array.isArray(body.rows) ? body.rows : []).filter((r: any) => r?.id).map((r: any) => [String(r.id), r]));
    const keys = entryKeys(kind, plant);
    const stamp = new Date().toISOString();
    const edited: SheetRow[] = [];
    let changed = 0;
    const merged = existing.map((r) => {
      const inc = incoming.get(String(r.id));
      if (!inc) return r;
      let next: SheetRow = r;
      if (unlocker) {
        const clean = normaliseRowWeights(stripMeta(inc));
        if (entrySignature(keys, normaliseRowWeights(stripMeta(r))) !== entrySignature(keys, clean)) {
          const patch: Record<string, any> = {};
          for (const k of keys) if (k !== "accountsRemarks") patch[k] = clean[k];
          next = { ...r, ...patch, updatedAt: stamp };
          edited.push(next);
        }
      }
      if (inc.accountsRemarks !== undefined && String(inc.accountsRemarks ?? "") !== String(r.accountsRemarks ?? "")) {
        next = { ...next, accountsRemarks: String(inc.accountsRemarks).slice(0, 500), updatedAt: stamp };
      }
      if (next !== r) changed += 1;
      return next;
    });
    if (changed) writeRows(kind, plant, merged);
    if (edited.length) {
      recordAudit({
        action: "SHEET_LOCKED_ROWS_EDITED",
        userId: scoped.scope.userId, userName: scoped.scope.userName, role: scoped.scope.role,
        targetType: `${kind}-sheet`, targetId: plant,
        targetLabel: `${edited.length} row${edited.length === 1 ? "" : "s"}`,
        detail: edited.map((r) => `${rowLabel(kind, r)} (approver's own edit, ${lockInfo(r).state})`).slice(0, 20).join(" | "),
        plant,
      });
    }
    return NextResponse.json({ ok: true, saved: merged.length, plant, kind, rows: merged, readOnly: true });
  }

  /*
   * Merge, not replace. The browser sends the rows it holds plus the ids it
   * deleted; a row it never knew about (imported a minute ago, or added on
   * another PC) is kept rather than wiped by a stale tab.
   *
   * The freeze is enforced HERE: a frozen row the sender cannot unlock must
   * arrive unchanged and must not be deleted, or nothing is saved at all.
   */
  const now = new Date();
  const existing = readRows(kind, plant);
  const byId = new Map(existing.map((r) => [String(r.id), r]));
  const deleted = new Set<string>((Array.isArray(body.deleted) ? body.deleted : []).map((x: any) => String(x)));
  const keys = entryKeys(kind, plant);
  const incomingRows: Record<string, any>[] = Array.isArray(body.rows) ? body.rows : [];

  if (!unlocker) {
    const violations: { id: string; label: string; what: "changed" | "deleted" }[] = [];
    for (const inc of incomingRows) {
      const old = inc?.id ? byId.get(String(inc.id)) : undefined;
      if (!old || lockInfo(old, now).state !== "frozen") continue;
      const a = entrySignature(keys, normaliseRowWeights(stripMeta(old)));
      const b = entrySignature(keys, normaliseRowWeights(stripMeta(inc)));
      if (a !== b) violations.push({ id: old.id, label: rowLabel(kind, old), what: "changed" });
    }
    for (const id of deleted) {
      const old = byId.get(id);
      if (old && lockInfo(old, now).state === "frozen") violations.push({ id, label: rowLabel(kind, old), what: "deleted" });
    }
    if (violations.length) {
      recordAudit({
        action: "SHEET_FROZEN_EDIT_REFUSED",
        userId: scoped.scope.userId, userName: scoped.scope.userName, role: scoped.scope.role,
        targetType: `${kind}-sheet`, targetId: plant,
        targetLabel: `${violations.length} frozen row${violations.length === 1 ? "" : "s"}`,
        detail: violations.map((v) => `${v.what}: ${v.label}`).slice(0, 20).join(" | "),
        plant, outcome: "failed",
      });
      return NextResponse.json(
        {
          error: `${violations.length} row${violations.length === 1 ? " is" : "s are"} frozen (submitted more than ${SHEET_FREEZE_DAYS} days ago). Nothing was saved — use "Request edit" on the row.`,
          code: "ROW_FROZEN",
          frozen: violations,
          rows: existing,
        },
        { status: 423 }
      );
    }
  }

  const seen = new Set<string>();
  const out: SheetRow[] = [];
  const stamp = now.toISOString();
  const fresh = (inc: Record<string, any>): SheetRow => {
    const id = String(inc.id || newRowId(kind));
    const old = byId.get(id);
    const clean = normaliseRowWeights(stripMeta(inc));
    const same = old && entrySignature(keys, normaliseRowWeights(stripMeta(old))) === entrySignature(keys, clean);
    return {
      ...clean,
      // Lock state, import trail and creator come from the stored row —
      // never from what the browser sent.
      ...metaOf(old),
      ...(old ? {} : { createdAt: stamp, createdBy: scoped.scope.userId, createdByName: scoped.scope.userName }),
      id,
      updatedAt: same ? old!.updatedAt || stamp : stamp,
    } as SheetRow;
  };
  const incomingById = new Map<string, Record<string, any>>();
  for (const inc of incomingRows) if (inc && inc.id) incomingById.set(String(inc.id), inc);
  // Stored order first (updated in place), then the rows that are new.
  for (const old of existing) {
    const id = String(old.id);
    if (deleted.has(id)) continue;
    const inc = incomingById.get(id);
    out.push(inc ? fresh(inc) : old);
    seen.add(id);
  }
  for (const inc of incomingRows) {
    if (!inc) continue;
    const id = inc.id ? String(inc.id) : "";
    if (id && (seen.has(id) || deleted.has(id))) continue;
    const row = fresh(inc);
    seen.add(row.id);
    out.push(row);
  }

  const removed = existing.filter((r) => deleted.has(String(r.id)));
  writeRows(kind, plant, out);
  if (removed.length) {
    recordAudit({
      action: "SHEET_ROWS_DELETED",
      userId: scoped.scope.userId, userName: scoped.scope.userName, role: scoped.scope.role,
      targetType: `${kind}-sheet`, targetId: plant,
      targetLabel: `${removed.length} ${kind} row${removed.length === 1 ? "" : "s"}`,
      detail: removed.map((r) => `${rowLabel(kind, r)}${r.submittedAt ? " (submitted)" : ""}`).slice(0, 20).join(" | "),
      plant,
    });
  }
  // A frozen row changed under an approval, or by an approver: on the record.
  const touchedLocked = out.filter((r) => {
    const old = byId.get(String(r.id));
    if (!old) return false;
    const st = lockInfo(old, now).state;
    return (st === "frozen" || st === "unlocked") && r.updatedAt !== old.updatedAt;
  });
  if (touchedLocked.length) {
    recordAudit({
      action: "SHEET_LOCKED_ROWS_EDITED",
      userId: scoped.scope.userId, userName: scoped.scope.userName, role: scoped.scope.role,
      targetType: `${kind}-sheet`, targetId: plant,
      targetLabel: `${touchedLocked.length} row${touchedLocked.length === 1 ? "" : "s"}`,
      detail: touchedLocked.map((r) => `${rowLabel(kind, r)}${r.unlock?.requestId ? ` (approval ${r.unlock.requestId.slice(0, 8)})` : " (approver's own edit)"}`).slice(0, 20).join(" | "),
      plant,
    });
  }
  return NextResponse.json({ ok: true, saved: out.length, plant, kind, rows: out });
}
