import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById, verifyPassword, loadUsers, saveUsers, SEEDED_USERNAME } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { runBackup } from "@/lib/backupEngine";
import { backupsDir, humanSize } from "@/lib/backup";
import { previewReset, performReset, RESET_PHRASE, COMPANY_PROFILE_FILES, SETTINGS_FILES } from "@/lib/factoryReset";
import { endAllSessions } from "@/lib/sessionEpoch";
import { setServerOwner } from "@/lib/serverOwner";
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, SERVER_PC_DEVELOPER_TTL_SECONDS, SERVER_PC_HEADER,
  isServerPcRequest, signSession,
} from "@/lib/authToken";
import { effectivePermissions } from "@/lib/access";

/**
 * Developer → Data → Start fresh. Deletes ALL app data for everyone.
 *
 *   GET  ?keepCompanyProfile=1&keepSettings=1   what would be deleted
 *   POST { password, phrase: "RESET BIOME", keepCompanyProfile, keepSettings }
 *
 * Developer role only (not merely the `developer` permission), the
 * developer's own password, the typed phrase, and a verified backup taken
 * first — if the backup fails, nothing is deleted. See lib/factoryReset.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function requireDeveloper(req: NextRequest) {
  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth;
  const user = findById(auth.session.uid);
  if (!user || user.role !== "developer") {
    return { response: NextResponse.json({ error: "Only the developer can reset the app." }, { status: 403 }) };
  }
  return { user };
}

const flag = (v: unknown, dflt = true) => (v === undefined || v === null || v === "" ? dflt : v === true || v === "1" || v === "true");

export async function GET(req: NextRequest) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  const sp = req.nextUrl.searchParams;
  const opts = { keepCompanyProfile: flag(sp.get("keepCompanyProfile")), keepSettings: flag(sp.get("keepSettings")) };
  return NextResponse.json({
    ...previewReset(opts),
    phrase: RESET_PHRASE,
    companyProfileFiles: COMPANY_PROFILE_FILES,
    settingsFiles: SETTINGS_FILES,
    backupsFolder: backupsDir(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireDeveloper(req);
  if ("response" in auth) return auth.response;
  const me = auth.user;

  const body = await req.json().catch(() => ({}));
  const opts = { keepCompanyProfile: flag(body?.keepCompanyProfile), keepSettings: flag(body?.keepSettings) };

  if (String(body?.phrase || "").trim() !== RESET_PHRASE) {
    return NextResponse.json({ error: `Type ${RESET_PHRASE} exactly to confirm.` }, { status: 400 });
  }
  if (!body?.password || !verifyPassword(String(body.password), me)) {
    recordAudit({
      action: "APP_RESET_REFUSED", userId: me.id, userName: me.name, role: me.role,
      targetType: "data", targetLabel: "Fresh-start reset", detail: "Wrong developer password", outcome: "failed",
    });
    return NextResponse.json({ error: "That is not the developer password. Nothing was deleted." }, { status: 403 });
  }

  // 1. The safety backup. No backup, no reset.
  let backup: { file: string; path: string; encrypted: boolean; size: string; fileCount: number; notes: string[] };
  try {
    const r = await runBackup({ kind: "manual", by: me.name, note: "Before fresh-start reset (all app data deleted)" });
    backup = {
      file: r.entry.file,
      path: path.join(backupsDir(), r.entry.file),
      encrypted: Boolean(r.entry.encrypted),
      size: humanSize(r.entry.sizeBytes),
      fileCount: r.entry.fileCount,
      notes: r.notes,
    };
  } catch (e) {
    return NextResponse.json(
      { error: `The safety backup failed, so nothing was deleted: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // 2. Delete.
  const result = performReset(opts);

  // 3. The first-run developer account (developer / biome-admin, must change it).
  saveUsers([]);
  const dev = loadUsers().find((u) => u.username === SEEDED_USERNAME)!;

  // 4. This server keeps serving — the new developer account owns it.
  setServerOwner(dev.id, dev.username);

  // 5. Everyone else back to the sign-in page.
  endAllSessions("fresh-start reset");

  recordAudit({
    action: "APP_RESET",
    userId: me.id, userName: me.name, role: me.role,
    targetType: "data", targetLabel: "Fresh-start reset (all app data)",
    detail: `${result.files} file(s) deleted · company profile ${opts.keepCompanyProfile ? "kept" : "deleted"} · settings ${opts.keepSettings ? "kept" : "deleted"} · backup ${backup.file}`,
  });

  // The developer who pressed the button stays signed in — as the new
  // first-run account, which goes straight to "change your password".
  const onServerPc = await isServerPcRequest(req.headers.get(SERVER_PC_HEADER));
  const token = await signSession(
    {
      uid: dev.id, username: dev.username, name: dev.name, role: dev.role, plant: null,
      perms: effectivePermissions(dev.role, dev.access), av: dev.accessVersion || 0,
    },
    onServerPc ? SERVER_PC_DEVELOPER_TTL_SECONDS : SESSION_TTL_SECONDS
  );
  const res = NextResponse.json({
    ok: true,
    files: result.files,
    removed: result.removed,
    kept: previewReset(opts).kept,
    backup,
    signIn: { username: SEEDED_USERNAME, note: "Password is the first-run default (biome-admin). You must set a new one now." },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/",
    ...(onServerPc ? { maxAge: 400 * 24 * 60 * 60 } : {}),
  });
  return res;
}
