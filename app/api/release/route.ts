import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Version announcements.
 *
 * The admin publishes a version here; every other machine learns about it
 * on its next page load and shows a download link. Deliberately NOT an
 * auto-updater: pushing a binary onto someone's machine unattended is a far
 * bigger promise than this needs to make, and a wrong push would take the
 * whole office down at once. A notice plus a link keeps a person in the
 * loop while still making sure nobody is left on last month's build.
 */
interface Release {
  version: string;
  notes: string;
  url: string;
  mandatory: boolean;
  publishedAt: string;
  publishedByName: string;
}

function file() { return path.join(paths.root, "config", "release.json"); }

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "release.read");
  if ("response" in auth) return auth.response;

  const release = readJson<Release | null>(file(), null);
  const user = findById(auth.session.uid)!;

  return NextResponse.json({
    release,
    // What THIS machine is running, read from package.json at build time.
    current: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
    canPublish: hasPermission(user.role, "release.publish"),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "release.publish");
  if ("response" in auth) return auth.response;

  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const version = String(body.version || "").trim();
  const url = String(body.url || "").trim();

  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return NextResponse.json({ error: "Use a version like 1.2.0." }, { status: 400 });
  }
  // A link that isn't http(s) could be a file:// or javascript: URL landing
  // in front of every user in the company.
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "The download link must start with http:// or https://" }, { status: 400 });
  }

  const release: Release = {
    version,
    notes: String(body.notes || "").trim().slice(0, 2000),
    url,
    mandatory: Boolean(body.mandatory),
    publishedAt: new Date().toISOString(),
    publishedByName: user.name,
  };

  ensureDir(paths.configDir);
  writeJsonAtomic(file(), release);
  return NextResponse.json({ release }, { status: 201 });
}
