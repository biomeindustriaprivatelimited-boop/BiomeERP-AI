import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { loadStock, saveStock, stockDir } from "@/lib/stock";
import { stockCtx } from "@/lib/spares";
import { recordAudit } from "@/lib/audit";

/**
 * Purchase invoice / kanta parchi / challan / material photos attached to a
 * stock document or a GRN (GRN-REW-0001). Anyone with `stock` for that
 * plant can attach and open them.
 *   POST multipart {no, file}     attach (PDF or photo, 15 MB)
 *   GET ?no=…&id=…                open
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);

/** The plant a document number belongs to, if this person may see it. */
function docPlant(s: ReturnType<typeof loadStock>, no: string, plants: string[]): string | null {
  const plant = s.movements.find((m) => m.no === no)?.plant || s.grns.find((g) => g.no === no)?.plant || null;
  return plant && plants.includes(plant) ? plant : null;
}

export async function GET(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const no = req.nextUrl.searchParams.get("no") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  const s = loadStock();
  if (!docPlant(s, no, c.plants)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const a = (s.attachments[no] || []).find((x) => x.id === id);
  if (!a) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const full = path.join(stockDir(), a.file);
  if (!fs.existsSync(full)) return NextResponse.json({ error: "The file is missing on the server." }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(full)), {
    headers: { "Content-Type": a.type || "application/octet-stream", "Content-Disposition": `inline; filename="${encodeURIComponent(a.name)}"`, "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const c = await stockCtx(req, "stock");
  if ("response" in c) return c.response;
  const form = await req.formData().catch(() => null);
  const no = String(form?.get("no") || "");
  const files = (form?.getAll("file") || []).filter((f): f is File => f instanceof File);
  if (!no || !files.length) return NextResponse.json({ error: "Choose the bill / parchi to attach." }, { status: 400 });
  const s = loadStock();
  const plant = docPlant(s, no, c.plants);
  if (!plant) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const list = s.attachments[no] || [];
  for (const f of files) {
    if (!OK.has(f.type)) return NextResponse.json({ error: `${f.name}: attach a PDF or a photo.` }, { status: 400 });
    if (f.size > 15 * 1024 * 1024) return NextResponse.json({ error: `${f.name} is over 15 MB.` }, { status: 400 });
    const id = crypto.randomUUID();
    const ext = (f.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "bin";
    const rel = path.join("attachments", no.replace(/[^A-Za-z0-9-]/g, "_"), `${id}.${ext}`);
    fs.mkdirSync(path.dirname(path.join(stockDir(), rel)), { recursive: true });
    fs.writeFileSync(path.join(stockDir(), rel), Buffer.from(await f.arrayBuffer()));
    list.push({ id, name: f.name.slice(0, 160), size: f.size, type: f.type, file: rel, uploadedAt: new Date().toISOString(), uploadedByName: c.user.name });
  }
  s.attachments[no] = list;
  saveStock(s);
  recordAudit({ action: "STOCK_ATTACHMENT_ADDED", userId: c.user.id, userName: c.user.name, role: c.user.role, plant, targetType: "stock_movement", targetId: no, targetLabel: no, detail: files.map((f) => f.name).join(", ") });
  return NextResponse.json({ ok: true, attachments: list });
}
