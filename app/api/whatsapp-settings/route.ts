import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import fs from "fs";
import path from "path";
import os from "os";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

/**
 * Where WhatsApp documents get saved.
 *
 * The default is <home>/Documents/Biome Platform. Plenty of businesses
 * want that somewhere else — a synced Google Drive folder, a shared
 * network drive, a different disk — so this lets them point it anywhere
 * writable.
 *
 * The value is written to config/whatsapp-settings.json AND to a
 * .biome-data-root marker the agent reads at startup, because the agent
 * runs as its own process and can't see this one's memory.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WaSettings {
  companyCodes?: string[];
  allowedChats?: string[];
  watchAllChats?: boolean;
  ignoreOwnMessages?: boolean;
  autoProcess?: boolean;
  /** Absolute path overriding where the inbox lives. */
  saveRoot?: string | null;
}

const rootMarker = () => path.join(os.homedir(), ".biome-data-root");

function currentSettings(): WaSettings {
  return readJson<WaSettings>(paths.settingsFile, {});
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  const s = currentSettings();
  return NextResponse.json({
    settings: {
      companyCodes: s.companyCodes ?? ["BDC"],
      allowedChats: s.allowedChats ?? [],
      watchAllChats: s.watchAllChats === true,
      ignoreOwnMessages: s.ignoreOwnMessages !== false,
      autoProcess: s.autoProcess !== false,
      saveRoot: s.saveRoot ?? null,
    },
    effectiveRoot: paths.root,
    effectiveInbox: paths.inbox,
    defaultRoot: path.join(os.homedir(), "Documents", "Biome Platform"),
    settingsFile: paths.settingsFile,
  });
}

/** Check a folder is genuinely usable before saving it as the target. */
function validateRoot(raw: string): { ok: true; resolved: string } | { ok: false; error: string } {
  const resolved = path.resolve(raw.trim());

  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: "Enter a full path, e.g. D:\\\\Biome Documents." };
  }

  // Refuse the drive/filesystem root — filing thousands of documents there
  // is never what someone means, and it's hard to undo.
  const parsedRoot = path.parse(resolved).root;
  if (resolved === parsedRoot) {
    return { ok: false, error: "Pick a folder inside the drive, not the drive root itself." };
  }

  try {
    ensureDir(resolved);
  } catch (err) {
    return {
      ok: false,
      error: `That folder can't be created: ${(err as Error).message}. Check the drive is connected and you have permission.`,
    };
  }

  // Prove it's writable now rather than discovering it at 2am when a
  // document arrives.
  const probe = path.join(resolved, `.biome-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (err) {
    return {
      ok: false,
      error: `That folder isn't writable: ${(err as Error).message}.`,
    };
  }

  return { ok: true, resolved };
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const s = currentSettings();
  const next: WaSettings = { ...s };
  const notices: string[] = [];

  if (body.saveRoot !== undefined) {
    const raw = String(body.saveRoot ?? "").trim();
    if (!raw) {
      next.saveRoot = null;
      try {
        if (fs.existsSync(rootMarker())) fs.unlinkSync(rootMarker());
      } catch {
        /* non-fatal */
      }
      notices.push("Reset to the default folder.");
    } else {
      // Destructured rather than narrowed through `check.ok`, because
      // narrowing a discriminated union only works when strictNullChecks
      // is on — and a build that has it off would reject this line
      // instead of understanding it.
      const check = validateRoot(raw);
      if (check.ok !== true) {
        const reason = "error" in check ? check.error : "That folder can't be used.";
        return NextResponse.json({ error: reason }, { status: 400 });
      }
      next.saveRoot = check.resolved;
      try {
        fs.writeFileSync(rootMarker(), check.resolved, "utf8");
      } catch (err) {
        return NextResponse.json(
          { error: `Saved the setting but couldn't tell the agent: ${(err as Error).message}` },
          { status: 500 }
        );
      }
      notices.push(
        "Documents already filed stay where they are — only new ones go to the new folder. Move the old ones across yourself if you want everything together."
      );
    }
  }

  if (Array.isArray(body.companyCodes)) {
    const codes = body.companyCodes
      .map((c: any) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean);
    if (codes.length) next.companyCodes = Array.from(new Set<string>(codes));
  }
  if (Array.isArray(body.allowedChats)) {
    next.allowedChats = body.allowedChats.map((c: any) => String(c).trim()).filter(Boolean);
  }
  if (typeof body.watchAllChats === "boolean") next.watchAllChats = body.watchAllChats;
  if (typeof body.ignoreOwnMessages === "boolean") next.ignoreOwnMessages = body.ignoreOwnMessages;
  if (typeof body.autoProcess === "boolean") next.autoProcess = body.autoProcess;

  ensureDir(paths.configDir);
  writeJsonAtomic(paths.settingsFile, { ...next, updatedAt: new Date().toISOString() });

  notices.push("Restart the app for the change to take effect.");

  return NextResponse.json({ settings: next, notices });
}

/**
 * The Save-Location panel sends POST, the Automation panel sends PUT, and
 * both mean the same thing: apply this patch to the settings file. Only
 * PUT existed, so every attempt to change the save folder came back 405
 * with an HTML body — which then failed to parse as JSON and surfaced as
 * a meaningless error. Same handler, both verbs.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "whatsapp");
  if ("response" in auth) return auth.response;

  return PUT(req);
}
