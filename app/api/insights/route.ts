import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { insightsSnapshot, whatIf } from "@/lib/intelligence";
import { cashFlow, paymentPriority } from "@/lib/enterprise2";

/** Intelligence: one snapshot for the Insights screen; POST runs a what-if. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const view = req.nextUrl.searchParams.get("view");
  if (view === "cashflow") return NextResponse.json(cashFlow());
  if (view === "payments") return NextResponse.json(paymentPriority());
  return NextResponse.json(insightsSnapshot());
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ result: whatIf(body || {}) });
}
