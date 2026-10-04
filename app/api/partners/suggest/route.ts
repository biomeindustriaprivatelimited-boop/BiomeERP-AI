import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { resolvePlantScope, slugToCode, codeToSlug } from "@/lib/plantScope";
import { partnerSuggestions, SuggestKind } from "@/lib/partners";

/**
 * Registered names for the plant sheets' typeahead.
 *
 *   GET /api/partners/suggest?kind=vendor,transporter,client[&plant=rewari|REW][&q=ram]
 *
 * The plant is decided HERE, from the session, never from the caller:
 *
 *   plant_manager (and any other field role) — their session's plant only.
 *       Asking for another plant is refused with 403, not quietly
 *       corrected, so a probe is visible as one.
 *   coordinator — trading partners only; `plant` is ignored.
 *   accounts / admin / developer (finance) — any plant via `plant`.
 *
 * Manufacturing results are only partners explicitly tagged with that
 * plant; trading partners never reach a plant sheet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: SuggestKind[] = ["vendor", "transporter", "client"];

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid);
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const kindParam = (sp.get("kind") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const kinds = kindParam.length ? KINDS.filter((k) => kindParam.includes(k)) : KINDS;
  if (!kinds.length) return NextResponse.json({ error: "kind must be vendor, transporter or client." }, { status: 400 });
  const q = (sp.get("q") || "").trim().toLowerCase();
  const requested = (sp.get("plant") || "").trim();

  let list;
  let scopeOut: { category: "trading" | "manufacturing"; plant: string | null; slug: string | null };

  if (user.role === "coordinator") {
    list = partnerSuggestions({ trading: true }, kinds);
    scopeOut = { category: "trading", plant: null, slug: null };
  } else {
    const scoped = await resolvePlantScope(req, requested || null);
    if ("response" in scoped) return scoped.response;
    const { scope } = scoped;
    if (!scope.unrestricted && requested) {
      // Accept either spelling of their own plant; anything else is another site.
      const wantSlug = codeToSlug(slugToCode(requested) || requested) || requested.toLowerCase();
      if (wantSlug !== scope.slug) {
        return NextResponse.json({ error: "You can only see the partners registered for your own plant." }, { status: 403 });
      }
    }
    const code = slugToCode(scope.slug);
    if (!code) return NextResponse.json({ error: "That plant is not in the plant master." }, { status: 404 });
    list = partnerSuggestions({ plantCode: code }, kinds);
    scopeOut = { category: "manufacturing", plant: code, slug: scope.slug };
  }

  if (q) {
    list = list.filter((p) => [p.code, p.name, p.legalName].join(" ").toLowerCase().includes(q));
  }

  return NextResponse.json({ scope: scopeOut, partners: list });
}
