import { NextRequest, NextResponse } from "next/server";
import { requirePermission, getSession, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { loadConnection, publicConnection, getProvider, isConfigured } from "@/lib/cloud/googleDrive";
import { formatBytes } from "@/lib/cloud/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cloud status.
 *
 * Two audiences, two answers. An admin gets the account, the quota and the
 * folder; everyone else gets only whether syncing is on — the Google
 * address, folder ids and controls are none of their business.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const user = findById(session.uid);
  if (!user || !user.active) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isAdmin = hasPermission(user.role, "settings");
  const connection = loadConnection();

  if (!isAdmin) {
    return NextResponse.json({ admin: false, active: Boolean(connection) });
  }

  const provider = getProvider();
  if (!provider) {
    return NextResponse.json({
      admin: true,
      configured: isConfigured(),
      connection: publicConnection(connection),
      quota: null,
      status: isConfigured() ? "disconnected" : "not_configured",
    });
  }

  try {
    const quota = await provider.getStorageQuota();
    const pct = quota.total ? Math.round((quota.used / quota.total) * 100) : 0;
    return NextResponse.json({
      admin: true,
      configured: true,
      connection: publicConnection(connection),
      quota: {
        ...quota,
        usedLabel: formatBytes(quota.used),
        totalLabel: formatBytes(quota.total),
        availableLabel: formatBytes(quota.available),
        percentUsed: pct,
      },
      // Uploads pause at 100% but the ERP keeps working — a full Drive must
      // never stop someone filing an expense.
      status: pct >= 100 ? "full" : pct >= 95 ? "critical" : pct >= 75 ? "warning" : "connected",
    });
  } catch (err) {
    return NextResponse.json({
      admin: true,
      configured: true,
      connection: publicConnection(connection),
      quota: null,
      status: "error",
      error: (err as Error).message,
    });
  }
}
