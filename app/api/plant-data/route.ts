import { normaliseRowWeights } from "@/lib/units";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { resolvePlantScope } from "@/lib/plantScope";

/**
 * Plant vendors and sheet rows, stored on disk.
 *
 * Sheet entries were held in the browser session, which meant closing
 * the tab lost a morning's data entry. They live in the data folder now,
 * beside the WhatsApp documents, so they survive a restart and are
 * included in whatever the company already backs up.
 *
 * Vendors are kept PER PLANT. Rewari buys from farmers around Khaleta
 * and Gangakhed from a different set entirely — one shared list would
 * let a Rewari code be picked on a Gangakhed row, which is exactly the
 * mistake this is meant to prevent.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { allSlugs } from "@/lib/plantRegistry";

interface Vendor {
  code: string;
  name: string;
}

interface SheetRow extends Record<string, any> {
  id: string;
  updatedAt: string;
}

function plantFile(kind: "vendors" | "biomass" | "transport", plant: string) {
  const slugs = allSlugs();
  const safe = slugs.includes(plant) ? plant : slugs[0] || "rewari";
  return path.join(paths.configDir, "plants", `${safe}-${kind}.json`);
}

function readList<T>(file: string, key: string): T[] {
  const data = readJson<Record<string, T[]>>(file, {} as any);
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function writeList<T>(file: string, key: string, list: T[]) {
  ensureDir(path.dirname(file));
  writeJsonAtomic(file, { [key]: list, updatedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  const what = req.nextUrl.searchParams.get("what") || "rows";
  const kind = req.nextUrl.searchParams.get("kind") === "transport" ? "transport" : "biomass";

  // The plant comes from the session for a field role, never from the query.
  // Before this, `?plant=gangakhed` handed a Rewari manager the other
  // plant's book, and the same held for the transport sheet.
  const scoped = await resolvePlantScope(req, req.nextUrl.searchParams.get("plant"));
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;

  if (what === "vendors") {
    return NextResponse.json({
      plant,
      vendors: readList<Vendor>(plantFile("vendors", plant), "vendors"),
    });
  }

  return NextResponse.json({
    plant,
    kind,
    rows: readList<SheetRow>(plantFile(kind, plant), "rows"),
    // Office roles read the plant's book; only the plant manager writes it.
    readOnly: !(scoped.scope.role === "plant_manager" || scoped.scope.role === "developer"),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "plant");
  if ("response" in auth) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Writes are scoped the same way. A field role saving rows can only ever
  // write into their own plant's file, whatever the body claims.
  const scoped = await resolvePlantScope(req, body.plant);
  if ("response" in scoped) return scoped.response;
  const plant = scoped.scope.slug;

  // ---- Importing a vendor list ----
  if (body.what === "vendors") {
    if (!(scoped.scope.role === "plant_manager" || scoped.scope.role === "developer")) {
      return NextResponse.json({ error: "Only the plant manager keeps the plant's vendor list." }, { status: 403 });
    }
    // Accepts a pasted block from Excel: "BIO01<tab>AMAN MAYAN" per line,
    // or comma-separated. Pasting is what people actually do; asking for
    // a file upload for four columns would be ceremony.
    let incoming: Vendor[] = [];

    if (typeof body.paste === "string" && body.paste.trim()) {
      incoming = body.paste
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => {
          const parts = line.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
          return { code: (parts[0] || "").toUpperCase(), name: parts.slice(1).join(" ").trim() };
        })
        // Drop a header row and anything without both fields.
        .filter((v: Vendor) => v.code && v.name && !/^vend(o|e)r\s*code$/i.test(v.code));
    } else if (Array.isArray(body.vendors)) {
      incoming = body.vendors
        .map((v: any) => ({
          code: String(v.code || "").trim().toUpperCase(),
          name: String(v.name || "").trim(),
        }))
        .filter((v: Vendor) => v.code && v.name);
    }

    if (!incoming.length) {
      return NextResponse.json(
        { error: "No vendors found. Paste rows as 'CODE  NAME', one per line." },
        { status: 400 }
      );
    }

    // Merge on code: a re-import corrects names rather than duplicating.
    const existing = readList<Vendor>(plantFile("vendors", plant), "vendors");
    const byCode = new Map(existing.map((v) => [v.code, v]));
    let added = 0;
    let updated = 0;
    for (const v of incoming) {
      if (byCode.has(v.code)) {
        if (byCode.get(v.code)!.name !== v.name) updated += 1;
      } else {
        added += 1;
      }
      byCode.set(v.code, v);
    }

    const merged = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
    writeList(plantFile("vendors", plant), "vendors", merged);

    return NextResponse.json({ ok: true, total: merged.length, added, updated, plant });
  }

  // ---- Saving sheet rows ----
  const kind = body.kind === "transport" ? "transport" : "biomass";

  // The plant's books are the plant manager's: only they (and the
  // developer) enter or change rows. Accounts / admin read them and may
  // write in their own remarks column — nothing else they send is kept.
  const entryRole = scoped.scope.role === "plant_manager" || scoped.scope.role === "developer";
  if (!entryRole) {
    const existing = readList<SheetRow>(plantFile(kind, plant), "rows");
    const incoming = new Map<string, any>((Array.isArray(body.rows) ? body.rows : []).filter((r: any) => r?.id).map((r: any) => [String(r.id), r]));
    const merged = existing.map((r: any) => {
      const inc = incoming.get(String(r.id));
      return inc && inc.accountsRemarks !== undefined && inc.accountsRemarks !== r.accountsRemarks
        ? { ...r, accountsRemarks: String(inc.accountsRemarks).slice(0, 500), updatedAt: new Date().toISOString() }
        : r;
    });
    writeList(plantFile(kind, plant), "rows", merged);
    return NextResponse.json({ ok: true, saved: merged.length, plant, kind, rows: merged, readOnly: true });
  }

  const rows: SheetRow[] = Array.isArray(body.rows)
    ? body.rows.map((r: any, i: number) => ({
        // Weights are kept in kg — "28.4 MT" or "284 qtl" is converted here.
        ...normaliseRowWeights(r),
        id: r.id || `${kind}-${Date.now()}-${i}`,
        updatedAt: new Date().toISOString(),
      }))
    : [];

  writeList(plantFile(kind, plant), "rows", rows);
  return NextResponse.json({ ok: true, saved: rows.length, plant, kind, rows });
}
