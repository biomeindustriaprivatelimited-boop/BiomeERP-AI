import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { entity360, graphSearch } from "@/lib/enterprise";

/** 360° entity profile + business graph search. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const u = findById(auth.session.uid)!;
  const user = { id: u.id, role: u.role, plant: auth.session.plant ?? null, name: u.name };
  const q = req.nextUrl.searchParams.get("q");
  if (q !== null) return NextResponse.json({ results: graphSearch(q, user) });
  const type = req.nextUrl.searchParams.get("type") || "vendor";
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  return NextResponse.json(entity360(type, key, user));
}
