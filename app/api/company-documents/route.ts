import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir, safeJoin, sanitizeSegment } from "@/lib/dataRoot";

/**
 * Biome's OWN documents — the ones you get asked for constantly by
 * clients, banks, tenders and auditors, and then hunt through email to
 * find.
 *
 * Vendor KYC already had a home (/api/vendors/kyc). This is the other
 * side: our own certificates, licences and returns, filed by category so
 * "send us your GST certificate and cancelled cheque" is a thirty-second
 * job instead of a twenty-minute one.
 *
 * Files live at <DataRoot>/company-documents/<Category>/ as ordinary
 * files you can also open in Explorer or hand to an auditor on a stick.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic",
  ".doc", ".docx", ".xls", ".xlsx", ".csv", ".zip",
]);

/**
 * The categories an Indian manufacturing/trading company actually needs.
 *
 * NOT exported. A route file may only export the HTTP methods and Next's
 * own config keys; anything else fails the production build with a
 * confusing message about an index signature. The list is served to the
 * UI through the GET response instead, which is where it was being read
 * from anyway.
 */
const DOCUMENT_CATEGORIES = [
  { id: "incorporation", label: "Incorporation & Constitution", hint: "Certificate of Incorporation, MOA, AOA, CIN" },
  { id: "tax", label: "Tax Registrations", hint: "GST Certificate, PAN, TAN" },
  { id: "banking", label: "Banking", hint: "Cancelled cheque, bank statements, sanction letters" },
  { id: "licences", label: "Licences & Approvals", hint: "Factory licence, pollution NOC, fire NOC, MSME/Udyam" },
  { id: "statutory", label: "Statutory Returns", hint: "Filed GST returns, ITR, ROC filings" },
  { id: "financials", label: "Financial Statements", hint: "Audited balance sheets, P&L, CA certificates" },
  { id: "insurance", label: "Insurance", hint: "Policies for plant, stock, vehicles" },
  { id: "agreements", label: "Agreements & Contracts", hint: "Client contracts, vendor agreements, rate letters" },
  { id: "authorisation", label: "Authorisations", hint: "Board resolutions, POA, authorised signatory letters" },
  { id: "other", label: "Other", hint: "Anything that doesn't fit above" },
] as const;

type CategoryId = (typeof DOCUMENT_CATEGORIES)[number]["id"];

interface StoredDoc {
  id: string;
  category: CategoryId;
  fileName: string;
  label: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Optional expiry — licences and insurance lapse, and that matters. */
  expiresOn: string | null;
  notes: string;
}

interface VaultFile {
  documents: StoredDoc[];
}

const vaultDir = () => path.join(paths.root, "company-documents");
const indexFile = () => path.join(paths.configDir, "company-documents.json");

function load(): StoredDoc[] {
  return readJson<VaultFile>(indexFile(), { documents: [] }).documents || [];
}

function save(documents: StoredDoc[]) {
  ensureDir(paths.configDir);
  writeJsonAtomic(indexFile(), { documents, updatedAt: new Date().toISOString() });
}

function categoryLabel(id: string): string {
  return DOCUMENT_CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

/** GET             -> list everything, grouped
 *  GET ?id=xxx     -> download that file */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "company");
  if ("response" in auth) return auth.response;

  const id = req.nextUrl.searchParams.get("id");
  const documents = load();

  if (id) {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return NextResponse.json({ error: "That document isn't in the vault." }, { status: 404 });

    let target: string;
    try {
      target = safeJoin(vaultDir(), categoryLabel(doc.category), doc.fileName);
    } catch {
      return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
    }
    if (!fs.existsSync(target)) {
      return NextResponse.json({ error: "The file is no longer on disk." }, { status: 404 });
    }

    const ext = path.extname(target).toLowerCase();
    const mime =
      ext === ".pdf" ? "application/pdf"
        : [".jpg", ".jpeg"].includes(ext) ? "image/jpeg"
          : ext === ".png" ? "image/png"
            : ext === ".webp" ? "image/webp"
              : "application/octet-stream";

    return new NextResponse(new Uint8Array(fs.readFileSync(target)), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${path.basename(target).replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  return NextResponse.json({
    categories: DOCUMENT_CATEGORIES,
    documents: documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    /** Surfaced separately because a lapsed licence is a real problem. */
    expiring: documents
      .filter((d) => d.expiresOn && d.expiresOn <= soon)
      .map((d) => ({ ...d, expired: !!d.expiresOn && d.expiresOn < today }))
      .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "")),
    vaultPath: vaultDir(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "company");
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const category = String(form.get("category") || "other") as CategoryId;
  if (!DOCUMENT_CATEGORIES.some((c) => c.id === category)) {
    return NextResponse.json({ error: `"${category}" isn't a known category.` }, { status: 400 });
  }
  const label = String(form.get("label") || "").trim();
  const expiresOn = String(form.get("expiresOn") || "").trim() || null;
  const notes = String(form.get("notes") || "").trim();
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");

  if (!files.length) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });

  const dir = safeJoin(vaultDir(), categoryLabel(category));
  ensureDir(dir);

  const documents = load();
  const added: StoredDoc[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      rejected.push({ name: file.name, reason: `${ext || "That type"} isn't accepted.` });
      continue;
    }
    if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: `${(file.size / 1048576).toFixed(1)} MB is over the 50 MB limit.` });
      continue;
    }

    const base = sanitizeSegment(path.basename(file.name, ext), "document");
    let stored = `${base}${ext}`;
    let n = 1;
    while (fs.existsSync(path.join(dir, stored))) {
      n += 1;
      stored = `${base} (${n})${ext}`;
    }
    fs.writeFileSync(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));

    added.push({
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      fileName: stored,
      label: label || base,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      expiresOn,
      notes,
    });
  }

  if (added.length) save([...documents, ...added]);

  return NextResponse.json({ added, rejected }, { status: added.length ? 201 : 400 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission(req, "company");
  if ("response" in auth) return auth.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "An `id` is required." }, { status: 400 });

  const documents = load();
  const doc = documents.find((d) => d.id === id);
  if (!doc) return NextResponse.json({ error: "That document isn't in the vault." }, { status: 404 });

  try {
    const target = safeJoin(vaultDir(), categoryLabel(doc.category), doc.fileName);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    /* the index entry still goes, so the list stays honest */
  }

  save(documents.filter((d) => d.id !== id));
  return NextResponse.json({ ok: true });
}
