import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { resolvePlantScope, slugToCode } from "@/lib/plantScope";
import { plantOptions } from "@/lib/plants";
import { matchAll, summarise } from "@/lib/plantMatch";

/**
 * Vehicle match between the plant's dispatch (transport) sheet and the
 * coordination team's manufacturing register.
 *
 *   ?side=plant         → verdicts for the caller's OWN plant rows only
 *   ?side=coordination  → verdicts for manufacturing trips only (needs `coordination`)
 *   ?side=full          → both sides with details (accounts / admin / developer)
 *
 * Only verdicts cross between teams — never the other side's figures.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const side = req.nextUrl.searchParams.get("side") || "plant";

  if (side === "plant") {
    const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
    if ("response" in scoped) return scoped.response;
    const code = slugToCode(scoped.scope.slug);
    if (!code) return NextResponse.json({ statuses: {} });
    const pairs = matchAll([code]).filter((p) => p.dispatch);
    const statuses: Record<string, string> = {};
    for (const p of pairs) statuses[p.plantKey!] = p.status;
    return NextResponse.json({
      plant: code,
      statuses,
      summary: {
        matched: pairs.filter((p) => p.status === "matched").length,
        weightDiffers: pairs.filter((p) => p.status === "weight_differs").length,
        unmatched: pairs.filter((p) => p.status === "unmatched").length,
      },
    });
  }

  if (side === "coordination") {
    if (!perms.includes("coordination")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const pairs = matchAll(plantOptions().map((p) => p.code)).filter((p) => p.trip);
    const statuses: Record<string, string> = {};
    for (const p of pairs) statuses[p.tripId!] = p.status;
    return NextResponse.json({
      statuses,
      summary: {
        matched: pairs.filter((p) => p.status === "matched").length,
        weightDiffers: pairs.filter((p) => p.status === "weight_differs").length,
        unmatched: pairs.filter((p) => p.status === "unmatched").length,
      },
    });
  }

  if (side === "full") {
    if (!perms.includes("finance") && !perms.includes("users")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const pairs = matchAll(plantOptions().map((p) => p.code));
    return NextResponse.json({ pairs, summary: summarise(pairs) });
  }

  return NextResponse.json({ error: "Unknown side." }, { status: 400 });
}
