import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { resolvePlantScope, slugToCode } from "@/lib/plantScope";
import { plantOptions } from "@/lib/plants";
import { matchAll, summarise } from "@/lib/plantMatch";
import { withFlags, addNote, pairKey, FLAG_AFTER_DAYS } from "@/lib/matchFlags";

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
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const side = req.nextUrl.searchParams.get("side") || "plant";

  if (side === "plant") {
    if (!perms.includes("plant")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
    if ("response" in scoped) return scoped.response;
    const code = slugToCode(scoped.scope.slug);
    if (!code) return NextResponse.json({ statuses: {} });
    const pairs = withFlags(matchAll([code])).filter((p) => p.dispatch);
    const statuses: Record<string, string> = {};
    const flags: Record<string, { key: string; flagged: boolean; ageDays: number; explained: boolean; notes: number }> = {};
    for (const p of pairs) {
      statuses[p.plantKey!] = p.status;
      if (p.status !== "matched") flags[p.plantKey!] = { key: p.key, flagged: p.flagged, ageDays: p.ageDays, explained: p.explained, notes: p.notes.length };
    }
    return NextResponse.json({
      plant: code,
      statuses,
      flags,
      flagAfterDays: FLAG_AFTER_DAYS,
      flagged: pairs.filter((p) => p.flagged).length,
      summary: {
        matched: pairs.filter((p) => p.status === "matched").length,
        weightDiffers: pairs.filter((p) => p.status === "weight_differs").length,
        unmatched: pairs.filter((p) => p.status === "unmatched").length,
      },
    });
  }

  if (side === "coordination") {
    if (!perms.includes("coordination")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const pairs = withFlags(matchAll(plantOptions().map((p) => p.code))).filter((p) => p.trip);
    const statuses: Record<string, string> = {};
    const flags: Record<string, { key: string; flagged: boolean; ageDays: number; explained: boolean; notes: number }> = {};
    for (const p of pairs) {
      statuses[p.tripId!] = p.status;
      if (p.status !== "matched") flags[p.tripId!] = { key: p.key, flagged: p.flagged, ageDays: p.ageDays, explained: p.explained, notes: p.notes.length };
    }
    return NextResponse.json({
      statuses,
      flags,
      flagAfterDays: FLAG_AFTER_DAYS,
      flagged: pairs.filter((p) => p.flagged).length,
      summary: {
        matched: pairs.filter((p) => p.status === "matched").length,
        weightDiffers: pairs.filter((p) => p.status === "weight_differs").length,
        unmatched: pairs.filter((p) => p.status === "unmatched").length,
      },
    });
  }

  if (side === "full") {
    if (!perms.includes("reco")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const pairs = matchAll(plantOptions().map((p) => p.code));
    return NextResponse.json({ pairs, summary: summarise(pairs) });
  }

  return NextResponse.json({ error: "Unknown side." }, { status: 400 });
}

/**
 * A note against one of MY OWN mismatched rows — the "action" that stops
 * the 3-day clock when the difference is real ("vehicle went to a trading
 * client", "second trip same day"). The plant side can only annotate its
 * own plant's dispatches; the coordination side only trips.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const perms = effectivePermissions(user.role, (user as any).access);
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || "");
  const text = String(b.note || "").trim().slice(0, 500);
  if (!key || !text) return NextResponse.json({ error: "Write what happened with this vehicle." }, { status: 400 });

  let side: "plant" | "coordination" | "office";
  if (key.startsWith("P:")) {
    const code = key.split(":")[1];
    if (perms.includes("reco")) side = "office";
    else {
      if (!perms.includes("plant")) return NextResponse.json({ error: "Not found." }, { status: 404 });
      const scoped = await resolvePlantScope(req, null);
      if ("response" in scoped) return scoped.response;
      if (slugToCode(scoped.scope.slug) !== code) return NextResponse.json({ error: "Not found." }, { status: 404 });
      side = "plant";
    }
  } else if (key.startsWith("T:")) {
    if (perms.includes("reco")) side = "office";
    else if (perms.includes("coordination")) side = "coordination";
    else return NextResponse.json({ error: "Not found." }, { status: 404 });
  } else return NextResponse.json({ error: "Unknown row." }, { status: 400 });

  // The row must still be a live mismatch.
  const live = withFlags(matchAll(plantOptions().map((p) => p.code))).some((p) => pairKey(p) === key && p.status !== "matched");
  if (!live) return NextResponse.json({ error: "This row matches now — nothing to explain." }, { status: 409 });

  addNote(key, { text, by: user.id, byName: user.name, side, at: new Date().toISOString() }, b.explained !== false);
  return NextResponse.json({ ok: true });
}
