import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths } from "@/lib/dataRoot";
import { loadBackups, saveBackups, backupsDir, collectFiles, humanSize, describeRestore } from "@/lib/backup";
import {
  runBackup, loadSchedule, saveSchedule, publicSchedule, setPassphrase, loadState,
  nextDueSlot, dueTiers, copyToDrive, driveBackupList, fetchFromDrive, importBackupFile,
  restoreBackup, runScheduledIfDue, startBackupScheduler, BackupSchedule,
} from "@/lib/backupEngine";
import { driveConnected, loadDrive } from "@/lib/gdrive";
import { recordAudit } from "@/lib/audit";
import { isOverrideActive, lockedMessage } from "@/lib/override";

/**
 * Backups — make, schedule, copy to Drive, bring back, restore.
 *
 * Making one and changing the schedule is admin work (`settings`).
 * RESTORING needs `users` AND Override switched on, plus the typed word
 * RESTORE — it is the one button in this app that can lose a month of work.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  // Belt and braces: if instrumentation did not start the timer (an older
  // Next, a dev reload), the first visit to this screen does.
  startBackupScheduler();

  const download = req.nextUrl.searchParams.get("download");
  if (download) {
    const entry = loadBackups().find((b) => b.file === download);
    if (!entry) return NextResponse.json({ error: "That backup is not on this machine." }, { status: 404 });
    const bytes = fs.readFileSync(path.join(backupsDir(), entry.file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${entry.file}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.nextUrl.searchParams.get("drive") === "list") {
    try {
      return NextResponse.json(await driveBackupList());
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const backups = loadBackups().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const files = collectFiles();
  let size = 0;
  for (const rel of files) {
    try { size += fs.statSync(path.join(paths.root, rel)).size; } catch { /* skip */ }
  }
  const schedule = loadSchedule();
  const state = loadState();

  return NextResponse.json({
    backups,
    folder: backupsDir(),
    dataRoot: paths.root,
    wouldInclude: { files: files.length, size, human: humanSize(size) },
    excluded: [
      "whatsapp/auth — the WhatsApp login itself",
      "config/mail.json — the email password",
      "Google Drive / cloud credentials and the backup password",
      "runtime — the agent's port and one-time token",
    ],
    schedule: publicSchedule(schedule),
    state: { lastRun: state.lastRun, history: state.history.slice(0, 15) },
    next: {
      daily: schedule.daily.enabled ? nextDueSlot("daily", schedule).toISOString() : null,
      weekly: schedule.weekly.enabled ? nextDueSlot("weekly", schedule).toISOString() : null,
      monthly: schedule.monthly.enabled ? nextDueSlot("monthly", schedule).toISOString() : null,
    },
    due: dueTiers(schedule, state),
    drive: { connected: driveConnected(), account: loadDrive().accountEmail || "" },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  // Upload of a backup file from this computer (multipart).
  const ctype = req.headers.get("content-type") || "";
  if (ctype.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a backup file (.zip or .biomebak)." }, { status: 400 });
    if (!/\.(zip|biomebak)$/i.test(file.name)) return NextResponse.json({ error: "Only .zip or .biomebak backup files." }, { status: 400 });
    try {
      const entry = await importBackupFile(
        Buffer.from(await file.arrayBuffer()), file.name, "uploaded", user.name,
        String(form?.get("passphrase") || "") || undefined,
      );
      recordAudit({ action: "BACKUP_UPLOADED", userId: user.id, userName: user.name, role: user.role, targetType: "backup", targetId: entry.file, targetLabel: entry.file, detail: `${entry.fileCount} files` });
      return NextResponse.json({ backup: entry }, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "create");

  try {
    if (action === "create") {
      const r = await runBackup({
        kind: "manual", by: user.name,
        note: String(body?.note ?? "").trim().slice(0, 200),
        drive: Boolean(body?.drive),
      });
      return NextResponse.json({ backup: r.entry, notes: r.notes, unreadable: r.unreadable }, { status: 201 });
    }

    if (action === "schedule") {
      const cur = loadSchedule();
      const s = body?.schedule || {};
      let next: BackupSchedule = {
        ...cur,
        enabled: Boolean(s.enabled),
        time: /^\d{2}:\d{2}$/.test(String(s.time || "")) ? String(s.time) : cur.time,
        daily: { enabled: Boolean(s.daily?.enabled), keep: Number(s.daily?.keep) || cur.daily.keep },
        weekly: { enabled: Boolean(s.weekly?.enabled), keep: Number(s.weekly?.keep) || cur.weekly.keep, weekday: Number(s.weekly?.weekday ?? cur.weekly.weekday) },
        monthly: { enabled: Boolean(s.monthly?.enabled), keep: Number(s.monthly?.keep) || cur.monthly.keep, day: Number(s.monthly?.day ?? cur.monthly.day) },
        drive: Boolean(s.drive),
        extraFolder: String(s.extraFolder || "").trim().slice(0, 400),
        updatedAt: new Date().toISOString(),
        updatedBy: user.name,
      };
      if (next.extraFolder && !path.isAbsolute(next.extraFolder)) {
        return NextResponse.json({ error: "The extra backup folder must be a full path, e.g. D:\\Biome Backups or \\\\NAS\\backups." }, { status: 400 });
      }
      if (typeof body?.passphrase === "string") {
        const p = body.passphrase;
        if (p && p.length < 8) return NextResponse.json({ error: "Use a backup password of at least 8 characters." }, { status: 400 });
        next = setPassphrase(next, p);
      }
      saveSchedule(next);
      // Re-read so defaults and clamps apply.
      const saved = loadSchedule();
      recordAudit({
        action: "BACKUP_SCHEDULE_CHANGED", userId: user.id, userName: user.name, role: user.role,
        targetType: "backup", targetId: "schedule", targetLabel: "Backup schedule",
        detail: `${saved.enabled ? "on" : "off"} · ${saved.time} · daily ${saved.daily.enabled ? saved.daily.keep : "off"} · weekly ${saved.weekly.enabled ? saved.weekly.keep : "off"} · monthly ${saved.monthly.enabled ? saved.monthly.keep : "off"} · drive ${saved.drive ? "on" : "off"}${typeof body?.passphrase === "string" ? " · password changed" : ""}`,
      });
      return NextResponse.json({ schedule: publicSchedule(saved) });
    }

    if (action === "runDue") {
      const rec = await runScheduledIfDue();
      return NextResponse.json({ ran: rec });
    }

    if (action === "toDrive") {
      const entry = loadBackups().find((b) => b.file === body?.file);
      if (!entry) return NextResponse.json({ error: "That backup is not on this machine." }, { status: 404 });
      const updated = await copyToDrive(entry);
      return NextResponse.json({ backup: updated });
    }

    if (action === "fromDrive") {
      const entry = await fetchFromDrive(String(body?.fileId || ""), user.name, body?.passphrase || undefined);
      return NextResponse.json({ backup: entry });
    }

    if (action === "delete") {
      if (!hasPermission(user.role, "users")) return NextResponse.json({ error: "Only an admin can delete a backup." }, { status: 403 });
      const entry = loadBackups().find((b) => b.file === body?.file);
      if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
      try { fs.unlinkSync(path.join(backupsDir(), entry.file)); } catch { /* gone */ }
      saveBackups(loadBackups().filter((b) => b.file !== entry.file));
      recordAudit({ action: "BACKUP_DELETED", userId: user.id, userName: user.name, role: user.role, targetType: "backup", targetId: entry.file, targetLabel: entry.file });
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/** Restore. Deliberately hard to do by accident. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const file = String(body?.file ?? "");
  const confirm = String(body?.confirm ?? "");
  const passphrase = typeof body?.passphrase === "string" && body.passphrase ? body.passphrase : undefined;

  const entry = loadBackups().find((b) => b.file === file);
  if (!entry) return NextResponse.json({ error: "That backup is not on this machine." }, { status: 404 });

  const movedTo = path.join(path.dirname(paths.root), `biome-data-replaced-<time>`);

  if (body?.dryRun) {
    return NextResponse.json({
      willDo: [
        ...describeRestore(entry, movedTo),
        entry.encrypted ? "This backup is encrypted — the saved backup password is used unless you type a different one." : "",
        "Users, vendors, registrations, coordination, plant sheets, stock, imprest, payroll, documents and uploaded files all come back exactly as they were at that moment.",
      ].filter(Boolean),
      confirmPhrase: "RESTORE",
      encrypted: Boolean(entry.encrypted),
      needsOverride: !hasPermission(user.role, "users") || !isOverrideActive(user.id),
    });
  }

  if (!hasPermission(user.role, "users") || !isOverrideActive(user.id)) {
    return NextResponse.json(
      { error: lockedMessage("Restoring replaces everything in the data folder."), needsOverride: true },
      { status: 423 }
    );
  }
  if (confirm !== "RESTORE") {
    return NextResponse.json({ error: "Type RESTORE to confirm." }, { status: 400 });
  }

  try {
    const r = await restoreBackup(entry, passphrase);
    recordAudit({
      action: "BACKUP_RESTORED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "backup", targetId: entry.file, targetLabel: entry.file,
      detail: `Restored ${r.files} files from the backup of ${entry.createdAt.slice(0, 10)}. The previous folder was kept at ${r.movedTo}.`,
    });
    return NextResponse.json({
      ok: true,
      movedTo: r.movedTo,
      message: `Restored ${r.files} files. The previous data was kept at ${r.movedTo}. Restart the app on the server PC so every module (and the WhatsApp agent) reads the restored folder.`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
