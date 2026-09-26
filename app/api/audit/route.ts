import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { readAudit, auditSummary, AuditCategory } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The audit log. Admin only — it holds every user's activity, and a
 * colleague's movements are not something the rest of the office reads.
 * There is no POST here on purpose: events are written by the modules that
 * cause them, never by a client.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "users");
  if ("response" in auth) return auth.response;

  const p = req.nextUrl.searchParams;
  const month = p.get("month") || undefined;

  const { events, months } = readAudit({
    month,
    userId: p.get("userId") || undefined,
    category: (p.get("category") as AuditCategory | "all") || "all",
    outcome: (p.get("outcome") as "all" | "ok" | "failed") || "all",
    search: p.get("search") || undefined,
    limit: Math.min(2000, Number(p.get("limit")) || 500),
  });

  // The developer's own movements do not appear in anyone else's audit
  // view. They are still WRITTEN — nothing is deleted — and the developer
  // reads them on their own screen. A record that was never written could
  // not be produced later if it were ever needed.
  const me = findById(auth.session.uid);
  const visible = me?.role === "developer" ? events : events.filter((e) => e.role !== "developer");

  return NextResponse.json({
    events: visible,
    months,
    summary: auditSummary(month),
  });
}
