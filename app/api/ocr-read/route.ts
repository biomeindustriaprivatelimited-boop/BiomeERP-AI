import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { requirePermission } from "@/lib/authServer";

/**
 * The OCR Scanner's offline reader, run on the server.
 *
 * The scanner used to OCR in the browser with a bare Tesseract pass: no
 * deskew, no turning sideways/upside-down photos, no lighting correction,
 * a min-max "contrast stretch" that a single black pixel defeats, and
 * Tesseract's page layout that drops boxed table cells (the invoice no.,
 * reference and vehicle sit in exactly those cells). On real phone photos
 * it read almost nothing.
 *
 * This runs the SAME reader the WhatsApp agent uses (whatsapp-agent/lib:
 * photo clean-up, orientation, table-line removal, tiled reading, OCR-slip
 * repair, Biome field rules) inside the app server — fully offline, no key
 * needed — so the scanner and WhatsApp understand a document identically.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eslint-disable-next-line no-eval
const nodeRequire: NodeRequire = eval("require");
const AGENT_LIB = path.join(process.cwd(), "whatsapp-agent", "lib");
const agentModule = (name: string): any => nodeRequire(path.join(AGENT_LIB, name));

const LABELS: [string, string][] = [
  ["referenceNo", "Reference No"],
  ["biomeDocNo", "Our Invoice / Challan No"],
  ["vendorDocNo", "Vendor Document No"],
  ["documentDate", "Document Date"],
  ["vehicleNo", "Vehicle No"],
  ["vendorName", "Vendor"],
  ["vendorGstin", "Other Party GSTIN"],
  ["clientName", "Client"],
  ["ewayBillNo", "E-Way Bill No"],
  ["grNumber", "LR / GR No"],
  ["quantityKg", "Quantity (kg)"],
  ["grossWeight", "Gross Weight"],
  ["tareWeight", "Tare Weight"],
  ["netWeight", "Net Weight"],
  ["totalAmount", "Total Amount"],
  ["driverMobile", "Driver Mobile"],
];

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "ocr");
  if ("response" in auth) return auth.response;

  let body: { fileBase64?: string; fileName?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.fileBase64) return NextResponse.json({ error: "No file was sent." }, { status: 400 });

  const buffer = Buffer.from(body.fileBase64, "base64");
  if (buffer.length > 25 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 25 MB." }, { status: 413 });
  const fileName = body.fileName || "document";
  const mimeType =
    body.mimeType ||
    (/\.pdf$/i.test(fileName) ? "application/pdf" : /\.png$/i.test(fileName) ? "image/png" : /\.webp$/i.test(fileName) ? "image/webp" : "image/jpeg");

  const started = Date.now();
  try {
    const classify = agentModule("classify.js");
    const clients = agentModule("clients.js");
    let clientList: any[] = [];
    try {
      clientList = clients.loadClients();
    } catch {
      /* fields still come out without the client list */
    }
    // Offline on purpose: the scanner's "Best" mode already asks the AI
    // separately; this is the reader that must work with no key and no net.
    const r = await classify.classifyDocument(buffer, mimeType, {
      geminiKey: "",
      anthropicKey: "",
      fileName,
      clients: clientList.map((c: any) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
      vendors: [],
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.message || "No readable text was found.", code: r.reason || "NO_TEXT" }, { status: 422 });
    }
    const d = r.data || {};
    const fields: { label: string; value: string; confidence: number }[] = [];
    const conf = Math.max(40, Math.min(99, Number(d.ocrConfidence ?? d.confidence ?? 70)));
    if (d.documentType && d.documentType !== "other") {
      fields.push({ label: "Document Type", value: classify.DOC_TYPE_LABEL[d.documentType] || d.documentType, confidence: Number(d.confidence) || conf });
    }
    for (const [key, label] of LABELS) {
      const v = d[key];
      if (v !== null && v !== undefined && String(v).trim()) fields.push({ label, value: String(v), confidence: conf });
    }
    return NextResponse.json({
      text: d.transcription || "",
      confidence: Number(d.ocrConfidence ?? 0),
      method: d.readMethod || r.provider,
      documentType: d.documentType || "other",
      issuerSide: d.issuerSide || null,
      fields,
      repairs: d.ocrRepairs || [],
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({ error: `The offline reader failed: ${(err as Error).message}` }, { status: 500 });
  }
}
