import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, loadUsers } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import {
  loadPartners, savePartners, partnersVisibleTo, responsibilityLabel, RESPONSIBLE_TEAMS,
  type Partner, type ResponsibleTeam,
} from "@/lib/partners";
import { refreshClientMirror } from "@/lib/clientRegistry";
import { loadAnnouncements, saveAnnouncements, makeAnnouncement } from "@/lib/announcements";

/**
 * Who is responsible for each vendor / client.
 *
 * GET — a thin lookup (name, code, aliases → responsible person, backup,
 *       team) over the records this person may see anyway, so screens like
 *       Coordination can show "handled by" next to a vendor / client
 *       without loading the commercial record. Same scoping as
 *       Registration: a coordinator sees trading, a plant manager their
 *       plant's manufacturing records.
 *
 * PUT — assign (one or many, i.e. bulk). Needs "partners.manage"
 *       (developer, admin, accounts by role). Each change is written to
 *       the record's own history and the audit log, and the newly
 *       assigned person gets an in-app notice.
 *
 *   { ids: string[], responsibleUserId?, responsibleName?, backupUserId?,
 *     backupName?, team? }
 *   responsibleUserId "" + responsibleName "Director (Tanesh Singh Dod)"
 *   is a person without a login. All empty = unassigned.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const mine = partnersVisibleTo(loadPartners(), user.role, auth.session.plant);
  return NextResponse.json({
    teams: RESPONSIBLE_TEAMS,
    entries: mine
      .filter((p) => p.name.trim())
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        category: p.category,
        name: p.name,
        legalName: p.legalName,
        shortName: p.shortName || "",
        code: p.code,
        aliases: (p as any).aliases || [],
        responsibleUserId: p.responsibleUserId || "",
        responsibleName: p.responsibleName || "",
        backupUserId: p.backupUserId || "",
        backupName: p.backupName || "",
        team: p.team || "",
      })),
  });
}

function str(v: unknown, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (!effectivePermissions(user.role, user.access).includes("partners.manage")) {
    return NextResponse.json({ error: "Only accounts, the admin or the developer can change who is responsible for a vendor or client." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : body?.id ? [String(body.id)] : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one vendor or client." }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: "Assign at most 500 at a time." }, { status: 400 });

  const users = loadUsers().filter((u) => u.active && !u.deleted);
  const pick = (idKey: string, nameKey: string): { id: string; name: string } | { error: string } => {
    const id = str(body?.[idKey], 80);
    if (id) {
      const u = users.find((x) => x.id === id);
      if (!u) return { error: "That person is not an active user. Pick someone from the list, or type a name for a person without a login." };
      return { id: u.id, name: u.name };
    }
    return { id: "", name: str(body?.[nameKey], 120) };
  };
  const main = pick("responsibleUserId", "responsibleName");
  if ("error" in main) return NextResponse.json({ error: main.error }, { status: 400 });
  const backup = pick("backupUserId", "backupName");
  if ("error" in backup) return NextResponse.json({ error: backup.error }, { status: 400 });
  if (main.id && backup.id && main.id === backup.id) return NextResponse.json({ error: "The backup must be someone else." }, { status: 400 });
  const team: ResponsibleTeam | "" = RESPONSIBLE_TEAMS.some((t) => t.id === body?.team) ? (body.team as ResponsibleTeam) : "";

  const all = loadPartners();
  // Only records this person can see (accounts / admin / developer see all,
  // but the rule stays the Registration rule, not a hard-coded role list).
  const visible = new Set(partnersVisibleTo(all, user.role, auth.session.plant).map((p) => p.id));
  const now = new Date().toISOString();
  const changed: Partner[] = [];
  const notFound: string[] = [];
  const next = all.map((p) => {
    if (!ids.includes(p.id)) return p;
    if (!visible.has(p.id)) { notFound.push(p.id); return p; }
    const after = {
      responsibleUserId: main.id, responsibleName: main.name,
      backupUserId: backup.id, backupName: backup.name, team,
    };
    const same = (p.responsibleUserId || "") === after.responsibleUserId && (p.responsibleName || "") === after.responsibleName
      && (p.backupUserId || "") === after.backupUserId && (p.backupName || "") === after.backupName && (p.team || "") === after.team;
    if (same) return p;
    const updated: Partner = {
      ...p, ...after,
      responsibilityUpdatedAt: now, responsibilityUpdatedBy: user.name,
      responsibilityHistory: [
        ...(p.responsibilityHistory || []),
        { at: now, byName: user.name, from: responsibilityLabel(p), to: responsibilityLabel(after) },
      ].slice(-50),
    };
    changed.push(updated);
    return updated;
  });
  const missing = ids.filter((id) => !all.some((p) => p.id === id));
  if (!changed.length) {
    return NextResponse.json({ ok: true, changed: 0, notFound: [...notFound, ...missing], note: "Nothing changed — already assigned that way." });
  }
  savePartners(next);
  if (changed.some((p) => p.kind === "client")) refreshClientMirror();

  for (const p of changed) {
    recordAudit({
      action: "PARTNER_RESPONSIBLE_CHANGED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "partner", targetId: p.id, targetLabel: p.name,
      detail: `${(p.responsibilityHistory || []).slice(-1)[0]?.from || "nobody"} → ${responsibilityLabel(p)}`,
    });
  }

  // In-app notice to whoever has just been made responsible (or backup)
  // for something they were not before. One notice per person per save.
  const notified: string[] = [];
  try {
    const before = new Map(all.map((p) => [p.id, p]));
    const perPerson = new Map<string, { name: string; main: string[]; backup: string[] }>();
    for (const p of changed) {
      const prev = before.get(p.id)!;
      const add = (uid: string, role: "main" | "backup") => {
        if (!uid || uid === user.id) return;
        const u = users.find((x) => x.id === uid);
        if (!u) return;
        const e = perPerson.get(uid) || { name: u.name, main: [], backup: [] };
        e[role].push(`${p.name}${p.code ? ` (${p.code})` : ""} — ${p.kind === "client" ? "client" : "vendor"}`);
        perPerson.set(uid, e);
      };
      if (p.responsibleUserId && p.responsibleUserId !== prev.responsibleUserId) add(p.responsibleUserId, "main");
      if (p.backupUserId && p.backupUserId !== prev.backupUserId) add(p.backupUserId, "backup");
    }
    if (perPerson.size) {
      const list = loadAnnouncements();
      const expires = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      for (const [uid, e] of perPerson) {
        const lines = [
          ...(e.main.length ? [`You are now the responsible person for:`, ...e.main.map((x) => `• ${x}`)] : []),
          ...(e.backup.length ? [`${e.main.length ? "\n" : ""}You are now the backup person for:`, ...e.backup.map((x) => `• ${x}`)] : []),
          "",
          `Assigned by ${user.name}. Open Supply → Vendor registration / Client registration and use the "My vendors" / "My clients" filter.`,
        ];
        const count = e.main.length + e.backup.length;
        list.push(makeAnnouncement({
          kind: "info",
          title: count === 1 ? `Assigned to you: ${(e.main[0] || e.backup[0]).split(" — ")[0]}` : `${count} vendors / clients assigned to you`,
          body: lines.join("\n"),
          audience: { roles: "all", plants: [], userIds: [uid] },
          expiresOn: expires,
          by: { id: user.id, name: user.name },
        }));
        notified.push(e.name);
      }
      saveAnnouncements(list);
    }
  } catch { /* the assignment is saved; a failed notice must not undo it */ }

  return NextResponse.json({ ok: true, changed: changed.length, notified, notFound: [...notFound, ...missing] });
}
