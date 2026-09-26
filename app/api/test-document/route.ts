import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import path from "path";

/**
 * Document pipeline self-test — run inside the Next server.
 *
 * WHY THIS DOESN'T GO THROUGH THE AGENT
 * The first version of this asked the WhatsApp agent to run the test.
 * That made the diagnostic depend on the very thing people reach for it
 * to diagnose: when the agent was down, the test reported "agent isn't
 * running" and told you nothing about your document.
 *
 * The agent's reading modules are plain CommonJS with no WhatsApp
 * dependency, so this route loads them directly. The test now works with
 * the agent stopped, mid-crash, or never started.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_LIB = path.join(process.cwd(), "whatsapp-agent", "lib");

/**
 * Load an agent module from disk at runtime.
 *
 * A plain require() here is rewritten by webpack into its own module
 * registry, which has no idea about files outside the bundle — so it
 * failed with "Cannot find module" even though the path printed was
 * correct and the file was sitting right there.
 *
 * createRequire() looked like the right tool, but webpack special-cases
 * it the same way it special-cases require() — it tries to statically
 * read the argument so it can bundle whatever's being required. Our
 * argument is built at runtime (path.join(...)), so webpack can't read
 * it, logs "module.createRequire failed parsing argument", and swaps in
 * a broken stub instead of a real require function. That stub is what
 * threw "nodeRequire is not a function".
 *
 * eval("require") sidesteps this: webpack cannot statically see through
 * an eval() call, so it leaves this line alone entirely and we get
 * Node's real, unmodified require — which happily loads any absolute
 * path, bundled or not.
 */
// eslint-disable-next-line no-eval
const nodeRequire: NodeRequire = eval("require");

function agentModule(name: string): any {
  return nodeRequire(path.join(AGENT_LIB, name));
}

interface Step {
  name: string;
  ok: boolean;
  detail: string;
  data?: Record<string, any>;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "documents");
  if ("response" in auth) return auth.response;

  let body: { fileBase64?: string; fileName?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.fileBase64) {
    return NextResponse.json({ error: "Send `fileBase64` and `fileName`." }, { status: 400 });
  }

  const steps: Step[] = [];
  const add = (name: string, ok: boolean, detail: string, data?: Record<string, any>) => {
    steps.push({ name, ok, detail, data });
    return ok;
  };

  const buffer = Buffer.from(body.fileBase64, "base64");
  const fileName = body.fileName || "test.pdf";
  const mimeType =
    body.mimeType ||
    (/\.pdf$/i.test(fileName)
      ? "application/pdf"
      : /\.(jpe?g)$/i.test(fileName)
        ? "image/jpeg"
        : /\.png$/i.test(fileName)
          ? "image/png"
          : "application/octet-stream");

  add(
    "File received",
    true,
    `${fileName} · ${(buffer.length / 1024).toFixed(0)} KB · ${mimeType}`
  );

  // ---- Load the reading modules ----
  let classify: any, reference: any, clients: any, filing: any, verify: any, dataRoot: any;
  try {
    classify = agentModule("classify.js");
    reference = agentModule("reference.js");
    clients = agentModule("clients.js");
    filing = agentModule("filing.js");
    verify = agentModule("verify.js");
    dataRoot = agentModule("paths.js");
    add("Reading modules loaded", true, "Running in-process — the WhatsApp agent isn't needed for this.");
  } catch (err) {
    add(
      "Reading modules loaded",
      false,
      `Could not load the document reader: ${(err as Error).message}. Run \`npm install\` in the project folder.`
    );
    return NextResponse.json({ steps, verdict: "failed", failedAt: "modules" });
  }

  // ---- Registries ----
  let vendorList: any[] = [];
  let clientList: any[] = [];
  let companyCodes = ["BDC"];
  try {
    const fs = nodeRequire("fs");
    const vendorsFile = path.join(dataRoot.PATHS.configDir, "vendors.json");
    if (fs.existsSync(vendorsFile)) {
      vendorList = JSON.parse(fs.readFileSync(vendorsFile, "utf8")).vendors || [];
    }
    clientList = clients.loadClients();
    const settingsFile = path.join(dataRoot.PATHS.configDir, "whatsapp-settings.json");
    if (fs.existsSync(settingsFile)) {
      const cfg = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      if (Array.isArray(cfg.companyCodes) && cfg.companyCodes.length) companyCodes = cfg.companyCodes;
    }
  } catch {
    // Non-fatal — the reader still works, just with less to match against.
  }

  add(
    "Registries loaded",
    true,
    `${vendorList.length} vendor(s), ${clientList.length} client(s)`,
    vendorList.length === 0
      ? { warning: "No vendors registered — vendor codes can't be matched. Add them under Vendors." }
      : undefined
  );

  // ---- Read the document ----
  let ai: any;
  try {
    ai = await classify.classifyDocument(buffer, mimeType, {
      geminiKey: process.env.GEMINI_API_KEY,
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
      clients: clientList.map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
      companyCodes,
      fileName,
    });
  } catch (err) {
    add("Reading the document", false, (err as Error).message);
    return NextResponse.json({ steps, verdict: "failed", failedAt: "reading" });
  }

  if (!ai.ok) {
    add("Reading the document", false, ai.message || ai.reason || "The reader returned nothing.");
    return NextResponse.json({ steps, verdict: "failed", failedAt: "reading" });
  }

  const ex = ai.data;
  const textLen = String(ex.transcription || "").replace(/\s/g, "").length;
  add(
    "Text extracted",
    textLen > 40,
    textLen > 40
      ? `${textLen} characters read via ${ex.readMethod || ai.provider}`
      : `Only ${textLen} characters found. If this is a scan, the page images may use a format this reader can't open.`,
    { sample: String(ex.transcription || "").slice(0, 800) }
  );

  add(
    "Document identified",
    ex.documentType !== "other",
    ex.documentType !== "other"
      ? `${classify.DOC_TYPE_LABEL[ex.documentType] || ex.documentType} · ${ex.confidence}% confident`
      : ai.notADocument
        ? String(ex.summary || "Not supply paperwork.")
        : "Could not tell what this document is.",
    {
      type: ex.documentType,
      confidence: ex.confidence,
      containedTypes: ex.containedDocumentTypes || [],
      engine: ai.provider,
      pages: ex.pageCount,
      fileNameHints: ex.fileNameHints || [],
      learnedReasons: ex.learnedReasons || [],
    }
  );

  add("Fields extracted", true, "", {
    reference: ex.referenceNo,
    ourDocNo: ex.biomeDocNo,
    vendorDocNo: ex.vendorDocNo,
    vendor: ex.vendorName,
    client: ex.clientName,
    date: ex.documentDate,
    vehicle: ex.vehicleNo,
    grNumber: ex.grNumber,
    quantityKg: ex.quantityKg,
    netWeight: ex.netWeight,
    ewayBill: ex.ewayBillNo,
    amount: ex.totalAmount,
    hasDigitalSignature: ex.hasDigitalSignature,
  });

  // ---- Reference ----
  const opts = { companyCodes, vendorCodes: vendorList.map((v) => v.code) };
  const ref =
    (ex.referenceNo ? reference.parseReference(ex.referenceNo, opts) : null) ||
    (ex.transcription ? reference.parseReference(ex.transcription, opts) : null);

  add(
    "Coordination reference",
    Boolean(ref),
    ref
      ? `${ref.canonical} → our doc ${ref.biomeDocNo}, vendor ${ref.vendorCode} doc ${ref.vendorDocNo}`
      : "None found. This is expected on vendor paperwork — only our own tax invoice or delivery challan carries one.",
    ref ? { ...ref, ...(ref.typoNote ? { warning: ref.typoNote } : {}) } : undefined
  );

  if (ref?.likelyTypo) {
    add("Reference check", false, ref.typoNote);
  }

  // ---- Client ----
  const client = clients.matchClient(ex.clientName, clientList);
  add(
    "Client matched",
    Boolean(client),
    client
      ? client.name
      : ex.clientName
        ? `Read "${ex.clientName}" but no client matches. Add it as an alias under Clients.`
        : "No consignee found on the page.",
  );

  // ---- Trading or manufacturing ----
  const supply = verify.detectSupplyType([ex], ref);
  add("Supply type", supply.type !== "unknown", `${supply.type} — ${supply.reason}`);

  // ---- Where it would go ----
  const isOurs = ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(
    ex.documentType
  );
  const plan = filing.planFiling({
    reference: ref,
    supplyType: supply.type,
    extracted: ex,
    originalName: fileName,
    mimeType,
    receivedAt: new Date(),
    senderName: "Test",
    anchorDate: ex.documentDate,
  });
  const target = path.relative(dataRoot.PATHS.inbox, path.join(plan.dir, `${plan.baseName}${plan.ext}`));

  if (!isOurs && supply.type === "trading" && !ai.notADocument) {
    add(
      "What happens next",
      true,
      `This is a vendor document, so it would be HELD until your invoice arrives. It would then be filed as:\n${target}`,
      { wouldStage: true, targetPath: target }
    );
  } else {
    add("Where it would be saved", plan.bucket === "filed", target, {
      bucket: plan.bucket,
      targetPath: target,
    });
  }

  const failed = steps.filter((s) => !s.ok);
  return NextResponse.json({
    steps,
    verdict: failed.length === 0 ? "ok" : "partial",
    problems: failed.map((f) => `${f.name}: ${f.detail}`),
    extracted: ex,
  });
}
