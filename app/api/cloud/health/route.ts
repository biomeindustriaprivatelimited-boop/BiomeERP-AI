import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadConnection, getProvider, isConfigured } from "@/lib/cloud/googleDrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Machine-readable health. Never returns a credential of any kind. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const connection = loadConnection();
  const provider = getProvider();

  let storage: unknown = null;
  let connected = false;
  let error: string | null = null;

  if (provider) {
    try {
      storage = await provider.getStorageQuota();
      connected = true;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  return NextResponse.json({
    provider: "google_drive",
    configurationStatus: isConfigured() ? "configured" : "not_configured",
    connected,
    account: connection?.accountEmail ?? null,
    rootFolder: connection?.rootFolderName ?? null,
    storage,
    lastSync: null,
    queueSize: 0,
    errors: error ? [error] : [],
  });
}
