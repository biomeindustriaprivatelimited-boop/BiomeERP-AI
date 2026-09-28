import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { paths } from "@/lib/dataRoot";
import { resolvePlantScope } from "@/lib/plantScope";
import { parseWeightSlip, verifyAgainstSlip, SheetRowValues } from "@/lib/weightSlip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const nodeRequire = createRequire(import.meta.url);

/**
 * Read an uploaded weight slip and check it against what was typed.
 *
 * OCR runs offline with Tesseract, which is already bundled — a weighbridge
 * slip does not need a cloud model, and the plant machines cannot be
 * assumed to have internet.
 *
 * A PDF slip is not OCR'd here: pdfjs already extracts its text directly,
 * and rasterising a text PDF to run OCR over it would be slower and worse.
 */
async function textFromFile(full: string, type: string): Promise<string> {
  if (type === "application/pdf") {
    try {
      // The module exports extractPdfPages(buffer) and returns an array of
      // page texts — not a path-taking helper, and not a single string.
      const { extractPdfPages } = nodeRequire(
        path.join(process.cwd(), "whatsapp-agent", "lib", "pdfText.js")
      );
      const pages = await extractPdfPages(fs.readFileSync(full), { maxPages: 3 });
      return Array.isArray(pages) ? pages.join("\n") : String(pages || "");
    } catch {
      // A PDF we cannot read is reported as unreadable rather than crashing
      // the whole check — the manager still gets a useful message.
      return "";
    }
  }

  // The WhatsApp agent's offline OCR helper: bundled LSTM model, writable
  // cache, timeouts. A bare createWorker("eng") downloads its model from a
  // CDN and hangs forever when that download fails.
  const { recognize } = nodeRequire(path.join(process.cwd(), "whatsapp-agent", "lib", "ocrWorker.js"));
  return await recognize(full);
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "operations");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.attachmentId) {
    return NextResponse.json({ error: "No weight slip is attached to this row." }, { status: 400 });
  }

  const scoped = await resolvePlantScope(req, body.plant);
  if ("response" in scoped) return scoped.response;

  const id = String(body.attachmentId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const folders = scoped.scope.unrestricted ? ["rewari", "gangakhed"] : [scoped.scope.slug];
  let full: string | null = null;
  let type = "";

  for (const plant of folders) {
    const dir = path.join(paths.root, "plants", plant, "uploads");
    const indexFile = path.join(dir, "index.json");
    if (!fs.existsSync(indexFile)) continue;
    try {
      const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      const entry = index[id];
      if (!entry) continue;
      const candidate = path.resolve(dir, entry.file);
      if (!candidate.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(candidate)) continue;
      full = candidate;
      type = entry.type || "";
      break;
    } catch { continue; }
  }

  if (!full) return NextResponse.json({ error: "That slip is missing from disk." }, { status: 404 });

  // Everything that could reasonably be wrong, checked before OCR so the
  // answer names the actual problem instead of "scanning failed".
  const stat = fs.statSync(full);
  const diagnostics: string[] = [];

  if (stat.size < 8_000) {
    diagnostics.push(`The file is only ${(stat.size / 1024).toFixed(0)} KB — that is usually a thumbnail or a failed upload rather than a photograph of a slip.`);
  }
  if (!type) {
    diagnostics.push("The upload has no file type recorded, so it may have been stored by an older version of the app. Re-attach it.");
  }
  if (type && !/^image\/|pdf$/.test(type)) {
    diagnostics.push(`This is a ${type} file. Only photos (JPG, PNG, WEBP) and PDF can be read.`);
  }

  let text = "";
  let ocrError: string | null = null;
  const startedAt = Date.now();
  try {
    text = await textFromFile(full, type);
  } catch (err) {
    ocrError = (err as Error).message;
  }

  const elapsed = Date.now() - startedAt;

  if (ocrError) {
    return NextResponse.json(
      {
        error: `The slip couldn't be scanned: ${ocrError}`,
        diagnostics: [
          ...diagnostics,
          `File: ${path.basename(full)} · ${(stat.size / 1024).toFixed(0)} KB · ${type || "unknown type"}`,
          "If this says tesseract.js is missing, run `npm install` and restart the app.",
        ],
      },
      { status: 500 }
    );
  }

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 5) {
    // OCR ran and found nothing. That is a photograph problem, not a
    // software problem, and saying so is far more use than "failed".
    return NextResponse.json({
      error: "The scan found almost no text on this slip.",
      diagnostics: [
        ...diagnostics,
        `Scanned in ${(elapsed / 1000).toFixed(1)}s and recognised ${words} word(s).`,
        "Usually this means the photo is blurred, too dark, taken at an angle, or the slip is a faint thermal print.",
        "Re-photograph it flat, in daylight, with the whole slip in frame and no shadow across it.",
      ],
      readableText: text.slice(0, 400),
    }, { status: 200 });
  }

  const slip = parseWeightSlip(text);
  const row: SheetRowValues = {
    vehicleNo: body.row?.vehicleNo,
    weightSlipNo: body.row?.weightSlipNo,
    name: body.row?.name,
    grossWeight: body.row?.grossWeight,
    tareWeight: body.row?.tareWeight,
    netWeight: body.row?.netWeight,
  };

  const tolerance = Number(body.toleranceKg);
  const verification = verifyAgainstSlip(
    row,
    slip,
    Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 10
  );

  // When the scan worked but no weights were found, the layout is the
  // problem — and the recognised text is the only thing that lets anyone
  // work out which label this weighbridge prints.
  const foundNothing =
    slip.grossWeight === null && slip.netWeight === null && slip.vehicleNo === null;

  return NextResponse.json({
    slip: { ...slip, rawLines: slip.rawLines.slice(0, 30) },
    verification,
    scan: {
      words,
      seconds: Number((elapsed / 1000).toFixed(1)),
      found: {
        vehicleNo: slip.vehicleNo, slipNo: slip.slipNo, partyName: slip.partyName,
        grossWeight: slip.grossWeight, tareWeight: slip.tareWeight, netWeight: slip.netWeight,
      },
    },
    diagnostics: foundNothing
      ? [
          ...diagnostics,
          `The scan read ${words} words but recognised no weights or vehicle number on this layout.`,
          "The text it did read is below — send it over and the reader can be taught this weighbridge's wording.",
        ]
      : diagnostics,
    readableText: foundNothing ? text.slice(0, 1200) : undefined,
  });
}
