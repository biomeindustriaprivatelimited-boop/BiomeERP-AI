import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, ensureDir } from "@/lib/dataRoot";
import {
  loadBackups, saveBackups, backupsDir, collectFiles, backupFileName,
  humanSize, describeRestore, BackupEntry,
} from "@/lib/backup";
import { recordAudit } from "@/lib/audit";
import { isOverrideActive, lockedMessage } from "@/lib/override";

/**
 * Backups.
 *
 * Making one is admin work. RESTORING one requires Override to be switched
 * on as well — it is the single button in this app that can lose a month
 * of work, and it should not be one mis-click from the button that makes a
 * backup.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const download = req.nextUrl.searchParams.get("download");
  if (download) {
    const entry = loadBackups().find((b) => b.file === download);
    if (!entry) return NextResponse.json({ error: "That backup is not on this machine." }, { status: 404 });
    const full = path.join(backupsDir(), entry.file);
    const bytes = fs.readFileSync(full);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${entry.file}"`,
        "Content-Length": String(bytes.length),
      },
    });
  }

  const backups = loadBackups().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const files = collectFiles();
  let size = 0;
  for (const rel of files) {
    try { size += fs.statSync(path.join(paths.root, rel)).size; } catch { /* skip */ }
  }

  return NextResponse.json({
    backups,
    folder: backupsDir(),
    dataRoot: paths.root,
    // What the next backup would contain, so nobody is surprised by its size.
    wouldInclude: { files: files.length, size, human: humanSize(size) },
    excluded: [
      "whatsapp/auth — the WhatsApp login itself",
      "config/mail.json — the email password",
      "config/cloud-credentials.json and the service account key",
      "runtime — the agent's port and one-time token",
    ],
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => ({}));
  const note = String(body?.note ?? "").trim().slice(0, 200);

  const files = collectFiles();
  if (files.length === 0) {
    return NextResponse.json({ error: "There is nothing in the data folder to back up." }, { status: 400 });
  }

  const zip = new JSZip();
  let added = 0;
  const unreadable: string[] = [];
  for (const rel of files) {
    try {
      zip.file(rel.split(path.sep).join("/"), fs.readFileSync(path.join(paths.root, rel)));
      added += 1;
    } catch {
      // One locked file must not lose the whole backup — but it must be
      // reported, because a backup missing a file nobody was told about is
      // the worst kind.
      unreadable.push(rel);
    }
  }

  ensureDir(backupsDir());
  const name = backupFileName();
  const target = path.join(backupsDir(), name);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  fs.writeFileSync(target, buffer);

  // Read it straight back. A backup nobody has opened is a guess, and the
  // day you find out it was empty is the day you needed it.
  let verifiedAt = "";
  let verifiedCount = 0;
  try {
    const check = await JSZip.loadAsync(fs.readFileSync(target));
    verifiedCount = Object.keys(check.files).filter((k) => !check.files[k].dir).length;
    if (verifiedCount === added) verifiedAt = new Date().toISOString();
  } catch {
    verifiedAt = "";
  }

  if (!verifiedAt) {
    try { fs.unlinkSync(target); } catch { /* nothing else to do */ }
    return NextResponse.json(
      {
        error: `The backup was written but could not be read back (${verifiedCount} of ${added} files). It has been deleted rather than left looking like a good backup.`,
      },
      { status: 500 }
    );
  }

  const entry: BackupEntry = {
    file: name,
    createdAt: new Date().toISOString(),
    createdBy: user.name,
    sizeBytes: buffer.length,
    fileCount: added,
    note,
    excluded: ["whatsapp/auth", "config/mail.json", "cloud credentials", "runtime"],
    verifiedAt,
  };
  saveBackups([entry, ...loadBackups()]);

  recordAudit({
    action: "BACKUP_CREATED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "backup", targetId: name, targetLabel: name,
    detail: `${added} files, ${humanSize(buffer.length)}${unreadable.length ? `, ${unreadable.length} unreadable` : ""}`,
    outcome: unreadable.length ? "failed" : "ok",
  });

  return NextResponse.json({ backup: entry, unreadable }, { status: 201 });
}

/** Restore. Deliberately hard to do by accident. */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const body = await req.json().catch(() => null);
  const file = String(body?.file ?? "");
  const confirm = String(body?.confirm ?? "");

  const entry = loadBackups().find((b) => b.file === file);
  if (!entry) return NextResponse.json({ error: "That backup is not on this machine." }, { status: 404 });

  const movedTo = path.join(paths.root, "..", `biome-data-replaced-${Date.now()}`);

  // A dry run: say exactly what is about to happen, and hand back the
  // phrase that has to be typed. Nothing is touched.
  if (body?.dryRun) {
    return NextResponse.json({
      willDo: describeRestore(entry, movedTo),
      confirmPhrase: "RESTORE",
      needsOverride: !isOverrideActive(user.id),
    });
  }

  if (!hasPermission(user.role, "users") || !isOverrideActive(user.id)) {
    return NextResponse.json(
      { error: lockedMessage("Restoring replaces everything in the data folder."), needsOverride: true },
      { status: 423 }
    );
  }
  if (confirm !== "RESTORE") {
    return NextResponse.json({ error: 'Type RESTORE to confirm.' }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(path.join(backupsDir(), entry.file)));
  } catch (err) {
    return NextResponse.json(
      { error: `That backup could not be opened: ${(err as Error).message}. Nothing has been changed.` },
      { status: 400 }
    );
  }

  // Unpack to a fresh folder FIRST. If anything fails halfway, the live
  // folder has not been touched — a restore that half finished over a live
  // folder leaves a mixture of two months and nobody can tell which rows
  // came from which.
  const staging = path.join(paths.root, "..", `biome-data-restoring-${Date.now()}`);
  try {
    ensureDir(staging);
    const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    for (const name of names) {
      const safe = path.resolve(staging, name);
      // A zip entry naming ../ would write outside the folder.
      if (!safe.startsWith(path.resolve(staging) + path.sep)) continue;
      ensureDir(path.dirname(safe));
      fs.writeFileSync(safe, Buffer.from(await zip.files[name].async("nodebuffer")));
    }

    // Carry across the things the backup deliberately never held, so the
    // WhatsApp login and the mail password survive a restore.
    for (const keep of ["whatsapp/auth", "config/mail.json", "config/cloud-credentials.json", "config/cloud-service-account.json", "runtime"]) {
      const from = path.join(paths.root, keep);
      if (!fs.existsSync(from)) continue;
      const to = path.join(staging, keep);
      ensureDir(path.dirname(to));
      fs.cpSync(from, to, { recursive: true });
    }

    fs.renameSync(paths.root, movedTo);
    fs.renameSync(staging, paths.root);
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    return NextResponse.json(
      { error: `The restore stopped before anything was swapped: ${(err as Error).message}. Your data folder is untouched.` },
      { status: 500 }
    );
  }

  recordAudit({
    action: "BACKUP_RESTORED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "backup", targetId: entry.file, targetLabel: entry.file,
    detail: `Restored the backup of ${entry.createdAt.slice(0, 10)}. The previous folder was moved to ${movedTo}.`,
  });

  return NextResponse.json({
    ok: true,
    movedTo,
    message:
      "Restored. Restart the app so every module reads the restored folder, and check a recent entry before carrying on.",
  });
}
