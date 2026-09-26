import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { vaultIndex, vaultSearch, vaultIntelligence } from "@/lib/vault";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "documents"); if ("response" in auth) return auth.response;
  const q = req.nextUrl.searchParams.get("q");
  const docs = vaultIndex();
  if (q) return NextResponse.json({ results: vaultSearch(q, docs) });
  return NextResponse.json({ intelligence: vaultIntelligence(docs), recent: docs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40) });
}
