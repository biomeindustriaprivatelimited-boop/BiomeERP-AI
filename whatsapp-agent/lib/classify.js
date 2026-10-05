/**
 * Biome Platform — WhatsApp Agent / document understanding
 * -------------------------------------------------------------------
 * Takes one downloaded file (PDF or image) and works out:
 *   - which of our supply document types it is
 *   - the coordination reference (BDC/786/MHI/44)
 *   - the key numbers we file and reconcile against
 *
 * Both Gemini and Anthropic accept PDFs natively, so we send the file
 * as-is — no rasterising, no local OCR step, no quality loss.
 *
 * IMPORTANT: if no API key is configured this module does NOT guess.
 * It returns { ok: false, reason: "NO_API_KEY" } and the caller files
 * the document under "_Needs Review" so a human can classify it. A
 * confident-looking wrong filing is far worse than an honest unknown.
 */

/** The document set from SOP section 3.3, split by who issued it. */
const DOC_TYPES = [
  "biome_tax_invoice",
  "biome_delivery_challan",
  "biome_eway_bill",
  "vendor_tax_invoice",
  "vendor_delivery_challan",
  "vendor_eway_bill",
  "bilty_lr",
  "weight_slip",
  "fast_tag",
  "consignment_tag",
  "coa",
  "receiving",
  "lab_report",
  "biome_debit_note",
  "vendor_debit_note",
  "biome_credit_note",
  "vendor_credit_note",
  "other",
];

const DOC_TYPE_LABEL = {
  biome_tax_invoice: "Biome Tax Invoice",
  biome_delivery_challan: "Biome Delivery Challan",
  biome_eway_bill: "Biome Eway Bill",
  vendor_tax_invoice: "Vendor Tax Invoice",
  vendor_delivery_challan: "Vendor Delivery Challan",
  vendor_eway_bill: "Vendor Eway Bill",
  bilty_lr: "Bilty / LR Copy",
  weight_slip: "Weight Slip",
  fast_tag: "Fast Tag Details",
  consignment_tag: "Consignment Tag",
  coa: "COA (Certificate of Analysis)",
  receiving: "Receiving (client weight slip)",
  lab_report: "Lab Report",
  biome_debit_note: "Biome Debit Note",
  vendor_debit_note: "Vendor Debit Note",
  biome_credit_note: "Biome Credit Note",
  vendor_credit_note: "Vendor Credit Note",
  other: "Other",
};

/** Who issued the paper. The Bilty, weight slip, fast tag, consignment
 *  tag and COA are the same physical documents used on both the vendor's
 *  set and ours, so they count as shared. */
const { extractOffline, extractWithLocalLlm } = require("./offlineExtract");
const { extractPdfPages } = require("./pdfText");
const { ocrScannedPdf } = require("./scannedPdf");
const { parseFileName, applyFileNameHints } = require("./fileNameParser");
const samples = require("./samples");
const docRules = require("./docRules");
const patterns = require("./patterns");

const DOC_TYPE_SIDE = {
  biome_tax_invoice: "biome",
  biome_delivery_challan: "biome",
  biome_eway_bill: "biome",
  vendor_tax_invoice: "vendor",
  vendor_delivery_challan: "vendor",
  vendor_eway_bill: "vendor",
  bilty_lr: "shared",
  weight_slip: "shared",
  fast_tag: "shared",
  consignment_tag: "shared",
  coa: "shared",
  receiving: "client",
  lab_report: "client",
  biome_debit_note: "biome",
  vendor_debit_note: "vendor",
  biome_credit_note: "biome",
  vendor_credit_note: "vendor",
  other: "other",
};

function buildSystemPrompt(ctx) {
  const vendorList = (ctx.vendors || [])
    .slice(0, 400)
    .map((v) => `${v.code} = ${v.name}`)
    .join("\n");

  const clientList = (ctx.clients || [])
    .slice(0, 100)
    .map((c) => {
      const alt = [c.shortName, ...(c.aliases || [])].filter(Boolean).join(", ");
      return alt ? `${c.name} (also called: ${alt})` : c.name;
    })
    .join("\n");

  return `You are the document-understanding engine for BIOME INDUSTRIA PRIVATE LIMITED (GSTIN 06AAJCB1927H1ZS, Rewari, Haryana). You read documents that arrive on the company WhatsApp and classify + extract them so they can be filed automatically.

Documents are photos or PDFs of real Indian commercial paperwork. They may be stamped, skewed, creased, low-resolution, partially handwritten, or mix Hindi and English. Read with maximum care.

## Our business
We supply biomass to power-plant clients in two ways:
- TRADING: we buy from a vendor and supply straight to the client.
- MANUFACTURING: we supply our own produced material.

A single consignment ("supply set") produces these documents:
- Vendor side: Vendor Tax Invoice, Vendor Eway Bill, Bill T, Weight Slip
- Biome side:  Biome Tax Invoice OR Biome Delivery Challan, Biome Eway Bill, Bill T, Weight Slip
Bill T and the Weight Slip are the SAME physical document used on both sides.

## Telling "biome" documents from "vendor" documents — this is the single most important judgement
- If the document is ISSUED BY Biome Industria Private Limited (Biome is the seller / consignor / the name in the letterhead), it is a biome_* type.
- If the document is issued by someone else and Biome Industria appears as the BUYER / "Billed to" / "Bill To" party, it is a vendor_* type.
Never decide this from the vendor code alone — decide it from who issued the paper.

## Document types (pick exactly one)
- "biome_tax_invoice"      — tax invoice issued BY Biome. Invoice numbers look like BI26-27-HR0786.
- "biome_delivery_challan" — delivery note/challan issued BY Biome. Numbers look like BIPL/2026-27/884.
- "biome_eway_bill"        — GST e-way bill where Biome is the consignor.
- "vendor_tax_invoice"     — tax invoice issued by a supplier TO Biome.
- "vendor_eway_bill"       — e-way bill where the vendor is the consignor and Biome/our client is the consignee.
- "vendor_delivery_challan" — vehicle challan / delivery challan issued by a supplier.
- "bilty_lr"               — the Bilty / LR (lorry receipt) copy issued by the transporter. Also written "Bill T" internally.
- "weight_slip"            — weighbridge slip: gross / tare / net weight.
- "fast_tag"               — FASTag details: a toll account statement, transaction list or tag screenshot for the vehicle.
- "consignment_tag"        — the consignment tag / gate tag issued for the consignment.
- "coa"                    — Certificate of Analysis, or any coal/biomass quality or combustion laboratory test report.
- "biome_debit_note" / "vendor_debit_note"   — a debit note, e.g. numbered DN-BI-26-27-068. Issued when a rate or quality deduction is applied after the invoice.
- "biome_credit_note" / "vendor_credit_note" — a credit note.
- "other"                  — anything else (chat screenshot, payment receipt, random photo).

## The coordination reference — read this very carefully
Biome documents carry a reference in the "Other References" box shaped like:

    BDC / 786 / MHI / 44

  BDC = our company code
  786 = OUR document number (our tax invoice no, or our challan no)
  MHI = the VENDOR CODE of the supplier
  44  = the VENDOR's document number (their tax invoice no, or their challan no)

Copy it EXACTLY as printed into "referenceNo". Do not invent one. If the document does not print a reference, set referenceNo to null — a vendor's own tax invoice usually has NO reference on it, and that is expected.

${vendorList ? `## Known vendor codes\n${vendorList}\n` : ""}
${clientList ? `## Our clients (power plants we supply). Match the consignee / "Ship to" party on the document to one of these exact names when you can — the chat may abbreviate them (e.g. "JPL" = Jhajjar Power Limited):\n${clientList}\n` : ""}
## Lab report rules
- A client laboratory report is \`lab_report\`, not a generic \`coa\`.
- Extract \`sampleCollectionDate\` from the report when printed.
- A lab report may cover multiple vehicles; extract every readable vehicle number into \`transcription\` even if only one \`vehicleNo\` field is returned.
- If the report shows a date range or several sample dates, preserve all dates in \`transcription\`; the filing engine will use the first and last detected sample date.
- A client receiving weight slip is \`receiving\`; its \`vehicleNo\`, \`clientName\`, \`documentDate\` and \`netWeight\` are critical.

## Output
Respond with ONLY one JSON object, no markdown fences, no commentary:

{
  "documentType": one of ${DOC_TYPES.map((t) => `"${t}"`).join(" | ")},
  "confidence": number 0-100,
  "issuedBy": string | null,          // the party whose letterhead this is
  "referenceNo": string | null,       // exactly as printed, e.g. "BDC/786/MHI/44"
  "biomeDocNo": string | null,        // our invoice/challan no, e.g. "BI26-27-HR0786"
  "vendorDocNo": string | null,       // vendor's invoice/challan no, e.g. "44"
  "vendorName": string | null,
  "vendorGstin": string | null,
  "clientName": string | null,        // the consignee / buyer power plant
  "clientGstin": string | null,
  "documentDate": string | null,      // YYYY-MM-DD
  "sampleCollectionDate": string | null, // YYYY-MM-DD; client lab sample date
  "ewayBillNo": string | null,
  "vehicleNo": string | null,         // e.g. "RJ29GC7686"
  "grossWeight": string | null,
  "tareWeight": string | null,
  "netWeight": string | null,
  "driverMobile": string | null,      // 10-digit Indian mobile if printed anywhere
  "hasDigitalSignature": boolean,     // true if a Digital Signature Certificate (DSC) stamp/block is visible
  "taxableValue": string | null,      // digits only, no symbols or commas
  "totalAmount": string | null,       // digits only, no symbols or commas
  "transcription": string             // full plain-text of everything legible
}

Rules:
- Never fabricate a value you cannot actually read. Use null instead.
- "confidence" is your honest self-assessment: under 50 = a guess, 50-80 = probably right but the scan is unclear, above 80 = the text is crisp and unambiguous.
- Always fill "transcription" as completely as you can — it is what we re-scan the reference out of if you miss it.`;
}

const USER_INSTRUCTION =
  "Classify and extract this document. Respond with ONLY the JSON object described in your instructions.";

const MAX_INLINE_BYTES = 15 * 1024 * 1024; // both APIs reject much beyond this

function stripFences(raw) {
  return String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function safeParse(raw) {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Models occasionally add a stray sentence before the object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("The AI response was not valid JSON.");
  }
}

async function callGemini(apiKey, buffer, mimeType, systemPrompt, userText) {
  // Model list, fallback and plain-language errors live in gemini.js.
  const { generate } = require("./gemini");
  const r = await generate(apiKey, {
    system: systemPrompt,
    parts: [{ mime: mimeType, base64: buffer.toString("base64") }, { text: userText }],
    json: true,
  });
  const parsed = safeParse(r.text);
  parsed.aiModel = r.model;
  return parsed;
}

async function callAnthropic(apiKey, buffer, mimeType, systemPrompt, userText) {
  const isPdf = mimeType === "application/pdf";
  const block = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: mimeType, data: buffer.toString("base64") },
      };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: [block, { type: "text", text: userText }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return safeParse(textBlock?.text ?? "");
}

function coerce(result, ctx) {
  const out = {
    documentType: DOC_TYPES.includes(result?.documentType) ? result.documentType : "other",
    confidence: Number.isFinite(Number(result?.confidence)) ? Number(result.confidence) : 0,
  };

  // ---- Deterministic rules outrank every fuzzy read ----
  // Built from the company's own documents (see docRules.js). This is
  // the single choke point every result passes through — AI and offline
  // alike — so a delivery note that prints an "e-Way Bill No" column
  // can never again leave here labelled as an e-way bill, and a file
  // named "Consignment tag …" can never leave as a weight slip.
  try {
    const ruled = docRules.decideType({
      text: result?.transcription || "",
      fileName: ctx?.fileName || result?.fileName || "",
      clients: ctx?.clients || [],
      vendors: ctx?.vendors || [],
    });
    if (ruled && ruled.confidence >= 88 && ruled.documentType !== out.documentType) {
      out.documentTypeFromReader = out.documentType;
      out.documentType = ruled.documentType;
      out.confidence = Math.max(out.confidence, ruled.confidence);
      out.ruleReason = ruled.reason;
    } else if (ruled && ruled.documentType === out.documentType) {
      // Same answer from two independent witnesses — say so.
      out.confidence = Math.max(out.confidence, ruled.confidence);
      out.ruleReason = ruled.reason;
    }
  } catch {
    /* rules are an aid, never a reason to fail the read */
  }

  const strFields = [
    "issuedBy",
    "referenceNo",
    "biomeDocNo",
    "vendorDocNo",
    "vendorName",
    "vendorGstin",
    "clientName",
    "clientGstin",
    "documentDate",
    "sampleCollectionDate",
    "ewayBillNo",
    "vehicleNo",
    "grossWeight",
    "tareWeight",
    "netWeight",
    "driverMobile",
    // Added later for matching; without these the GR number and the
    // unit-normalised quantity were silently dropped on the way out,
    // so a bilty could never match and quantity never compared.
    "grNumber",
    "quantityKg",
    "taxableValue",
    "totalAmount",
    "vendorOwnDocNo",
    "issuerSide",
    "issuerReason",
    "offlineDocumentType",
  ];
  for (const f of strFields) {
    const v = result?.[f];
    out[f] = v === null || v === undefined || v === "" ? null : String(v).trim();
  }
  out.hasDigitalSignature = result?.hasDigitalSignature === true;
  // Carried through so the supply-set checklist can credit every
  // document inside a merged PDF, and so the UI can explain itself.
  if (Array.isArray(result?.containedDocumentTypes)) out.containedDocumentTypes = result.containedDocumentTypes;
  if (result?.isMergedDocument) out.isMergedDocument = true;
  if (result?.pageCount) out.pageCount = result.pageCount;
  if (result?.readMethod) out.readMethod = result.readMethod;
  if (Number.isFinite(Number(result?.ocrConfidence))) out.ocrConfidence = Number(result.ocrConfidence);
  if (Array.isArray(result?.fileNameHints)) out.fileNameHints = result.fileNameHints;
  if (Array.isArray(result?.ocrRepairs)) out.ocrRepairs = result.ocrRepairs.slice(0, 30);
  if (result?.aiError) out.aiError = String(result.aiError).slice(0, 400);
  if (result?.aiModel) out.aiModel = String(result.aiModel);
  if (result?.sampleMatch) out.sampleMatch = result.sampleMatch;
  if (result?.ruleReason && !out.ruleReason) out.ruleReason = result.ruleReason;
  if (Array.isArray(result?.learnedReasons)) out.learnedReasons = result.learnedReasons;
  if (result?.engine) out.engine = String(result.engine);
  if (result?.captionHints) out.captionHints = result.captionHints;
  out.transcription = typeof result?.transcription === "string" ? result.transcription : "";
  return out;
}

/**
 * @param {Buffer} buffer   the downloaded file
 * @param {string} mimeType e.g. "application/pdf", "image/jpeg"
 * @param {object} ctx      { geminiKey, anthropicKey, vendors }
 */
/**
 * Read one document.
 *
 * Order matters, and it is deliberately offline-first:
 *
 *   1. OCR the file locally with Tesseract   — no network
 *   2. Extract fields with the rule engine   — no network
 *   3. If a local LLM (Ollama) is running, let it improve weak results
 *   4. Only if a cloud key is configured AND offline confidence is low,
 *      fall back to the cloud
 *
 * That means the whole pipeline works with the network unplugged, and a
 * cloud key becomes an optional accuracy boost rather than a requirement.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {object} ctx  { geminiKey, anthropicKey, vendors, clients,
 *                        chatContext, caption, preferCloud, ocrText }
 */
async function classifyDocument(buffer, mimeType, ctx = {}) {
  const rawGemini = (ctx.geminiKey || "").trim();
  const rawAnthropic = (ctx.anthropicKey || "").trim();
  // Google issues Gemini keys in two shapes — "AIza..." and "AQ..." —
  // and both are valid. Rejecting the second cost a user a working key.
  // Any key-shaped value is TRIED; Google's answer decides, and a rejected
  // key is reported (gemini.health → WhatsApp page) instead of being
  // silently ignored for not matching a pattern.
  const gem = require("./gemini");
  const geminiKey = gem.plausibleKey(rawGemini) ? gem.cleanKey(rawGemini) : "";
  if (rawGemini && !geminiKey) {
    gem.health.lastError = "The Gemini key saved in Settings does not look like a key (too short or contains spaces). Paste it again from aistudio.google.com/apikey.";
    gem.health.lastErrorCode = "INVALID_KEY";
    gem.health.lastErrorAt = new Date().toISOString();
  }
  const anthropicKey = /^sk-ant-[0-9A-Za-z_\-]{20,}$/.test(rawAnthropic) ? rawAnthropic : "";

  // ---- 0: the filename, which is free and often the most reliable
  //         source of the vehicle number and document numbers ----
  const nameHints = parseFileName(ctx.fileName || "", {
    vendors: ctx.vendors || [],
    companyCodes: ctx.companyCodes || ["BDC"],
  });
  // The caption a person typed with the file ("JPL weight slip HR55AB1234",
  // "BDC/912/AAT/338 bilty") is the same kind of evidence as a filename.
  const captionHints = ctx.caption
    ? parseFileName(String(ctx.caption).slice(0, 200), { vendors: ctx.vendors || [], companyCodes: ctx.companyCodes || ["BDC"] })
    : null;

  // ---- 1 & 2: read and extract, entirely offline ----
  let ocrText = ctx.ocrText || (Array.isArray(ctx.pages) ? ctx.pages.join("\n\n") : "");
  let pages = Array.isArray(ctx.pages) && ctx.pages.length ? ctx.pages : (ocrText ? [ocrText] : []);
  let ocrError = null;
  let readMethod = ocrText ? "provided" : null;
  let ocrConfidence = ocrText ? 99 : null;

  if (!ocrText) {
    try {
      const read = await readLocally(buffer, mimeType, ctx.fileName);
      ocrText = read.text;
      pages = read.pages;
      readMethod = read.method;
      ocrConfidence = Number.isFinite(Number(read.confidence)) ? Number(read.confidence) : null;
    } catch (err) {
      ocrError = err.message;
    }
  }

  // Put back the characters OCR swapped inside the identifiers that drive
  // matching (GSTIN, reference, our invoice number, vehicle) — see
  // ocrRepair.js. Done in place so positions on the page still count.
  let ocrRepairs = [];
  if (ocrText && readMethod !== "provided") {
    try {
      const fixed = require("./ocrRepair").repairText(ocrText, {
        companyCodes: ctx.companyCodes || ["BDC"],
        vendorCodes: (ctx.vendors || []).map((v) => v.code).filter(Boolean),
        plantCodes: ctx.plantCodes || [],
        knownGstins: (ctx.vendors || []).map((v) => v.gstin).filter(Boolean),
      });
      if (fixed.repairs.length) {
        ocrRepairs = fixed.repairs;
        ocrText = fixed.text;
        pages = pages.map((p) => require("./ocrRepair").repairText(p, { companyCodes: ctx.companyCodes || ["BDC"], vendorCodes: (ctx.vendors || []).map((v) => v.code).filter(Boolean), plantCodes: ctx.plantCodes || [] }).text);
      }
    } catch {
      /* repairs are an aid, never a reason to fail the read */
    }
  }

  const extractCtx = {
    vendors: ctx.vendors || [],
    clients: ctx.clients || [],
    companyCodes: ctx.companyCodes || ["BDC"],
  };

  let offline = null;
  if (ocrText && ocrText.trim().length > 20) {
    // Multi-page files get classified page by page so a merged vendor
    // PDF is recognised as the four documents it actually contains.
    offline =
      pages.length > 1
        ? combinePages(classifyPages(pages, extractCtx), ocrText, extractCtx)
        : extractOffline(ocrText, extractCtx);
    offline.readMethod = readMethod;
    if (ocrConfidence != null) offline.ocrConfidence = Math.round(ocrConfidence);
    if (ocrRepairs.length) offline.ocrRepairs = ocrRepairs;

    // ---- 3: a local model, if one happens to be running ----
    if (offline.confidence < 70) {
      const better = await extractWithLocalLlm(ocrText, ctx).catch(() => null);
      if (better) {
        // Keep whatever the rules found; the model only fills the gaps,
        // because the rules are exact where they fire and the model isn't.
        offline = {
          ...offline,
          ...Object.fromEntries(
            Object.entries(better).filter(([k, v]) => v != null && offline[k] == null)
          ),
          confidence: Math.max(offline.confidence, 65),
          engine: `${offline.engine}+${better.engine}`,
        };
      }
    }
  }

  // The filename fills whatever the page didn't say. This is what turns
  // a weight slip with an illegible plate into one with the right
  // vehicle number attached.
  if (offline) offline = applyFileNameHints(offline, nameHints);
  if (offline && captionHints) {
    const before = { ...offline };
    // Caption fills only what the page and filename left empty.
    const withCaption = applyFileNameHints({ ...offline, fileNameOverrode: true }, captionHints);
    for (const k of ["vehicleNo", "referenceNo", "biomeDocNo", "vendorDocNo", "clientName", "documentDate"]) {
      if (!before[k] && withCaption[k]) offline[k] = withCaption[k];
    }
    if ((!offline.documentType || offline.documentType === "other") && withCaption.documentType && withCaption.documentType !== "other") {
      offline.documentType = withCaption.documentType;
      offline.confidence = Math.max(Number(offline.confidence) || 0, 60);
    }
    const used = Object.keys(captionHints).filter((k) => captionHints[k] && !["raw", "hints"].includes(k));
    if (used.length) offline.captionHints = { caption: String(ctx.caption).slice(0, 200), found: used };
  }

  // ---- What do the TAUGHT documents say this looks like? ----
  // Uploaded exemplars are the strongest evidence about LAYOUT: the same
  // half-dozen forms arrive every day, and a clear fingerprint match to
  // a document a person labelled beats keyword guessing. A filename a
  // person typed still outranks it (fileNameOverrode), because an
  // explicit name is a direct human statement about THIS file.
  if (offline && ocrText && !offline.fileNameOverrode) {
    try {
      const looked = samples.matchSamples(ocrText);
      if (looked) {
        offline.sampleMatch = looked;
        const weak = !offline.documentType || offline.documentType === "other" || (Number(offline.confidence) || 0) < 75;
        if (looked.decide && (weak || looked.documentType !== offline.documentType)) {
          if (offline.documentType && offline.documentType !== looked.documentType) {
            offline.documentTypeFromReader = offline.documentType;
          }
          offline.documentType = looked.documentType;
          offline.confidence = Math.max(Number(offline.confidence) || 0, Math.round(70 + looked.similarity * 25));
          offline.engine = `${offline.engine}+exemplar`;
        }
      }
    } catch {
      /* samples are an aid, never a reason to fail the read */
    }
  }

  // ---- What have we learned from documents like this one? ----
  // Applied when the reader is unsure, and it only ever RAISES
  // confidence — a learned pattern never overrides a clear read.
  if (offline && (offline.confidence < 70 || offline.documentType === "other")) {
    const learned = patterns.suggest({
      fileName: ctx.fileName,
      senderName: ctx.senderName,
      transcription: ocrText,
      vendorName: offline.vendorName,
    });
    if (learned.documentType && learned.confidence > (offline.confidence || 0)) {
      offline.documentType = learned.documentType;
      offline.confidence = learned.confidence;
      offline.learnedReasons = learned.reasons;
      offline.engine = `${offline.engine}+learned`;
    }
    if (!offline.clientName && learned.clientName) {
      offline.clientName = learned.clientName;
      offline.learnedReasons = [...(offline.learnedReasons || []), ...learned.reasons];
    }
  }

  // Even with no readable text, a filename alone can be enough to file
  // a document correctly — far better than dropping it into review.
  if (!offline && (nameHints.vehicleNo || nameHints.biomeDocNo || nameHints.referenceNo)) {
    offline = applyFileNameHints(
      {
        documentType: "other",
        confidence: 0,
        transcription: ocrText || "",
        engine: "filename-only",
      },
      nameHints
    );
  }

  // A file we deliberately don't process is not an unclassified failure.
  if (!offline && String(ocrError || "").startsWith("NOT_A_SUPPLY_DOCUMENT:")) {
    return {
      ok: true,
      data: coerce({
        documentType: "other",
        confidence: 100,
        summary: ocrError.split(":").slice(1).join(":"),
        transcription: "",
        engine: "not-a-document",
      }),
      provider: "not-a-document",
      notADocument: true,
    };
  }

  // A page the OCR itself was unsure of (blurred photo, tiny WhatsApp
  // thumbnail), or OUR invoice/challan whose reference could not be read,
  // is worth a second opinion from the AI when a key is configured. The
  // offline answer still stands when there is no key or the AI fails.
  const lowOcr = offline && offline.ocrConfidence != null && offline.ocrConfidence < 60;
  const oursWithoutReference = offline && /^biome_(tax_invoice|delivery_challan)$/.test(offline.documentType) && !offline.referenceNo;
  const goodEnough = offline && offline.confidence >= 60 && offline.documentType !== "other" && !lowOcr && !oursWithoutReference;
  if (goodEnough && !ctx.preferCloud) {
    return { ok: true, data: coerce(offline, ctx), provider: offline.engine };
  }

  // ---- 4: cloud, only if configured ----
  if (!geminiKey && !anthropicKey) {
    if (offline) {
      // Return the offline result anyway — a low-confidence answer the
      // user can correct beats nothing at all.
      return {
        ok: true,
        data: coerce(offline, ctx),
        provider: offline.engine,
        lowConfidence: !(offline.confidence >= 60 && offline.documentType !== "other"),
      };
    }
    return {
      ok: false,
      reason: "NO_TEXT",
      message: ocrError
        ? `Couldn't read any text from this file: ${ocrError}`
        : "No readable text was found in this file, and no AI key is configured for a deeper read.",
    };
  }

  if (buffer.length > MAX_INLINE_BYTES) {
    if (offline) return { ok: true, data: coerce(offline, ctx), provider: offline.engine, lowConfidence: true };
    return { ok: false, reason: "TOO_LARGE", message: `File is larger than ${MAX_INLINE_BYTES / 1048576} MB.` };
  }

  const supported =
    mimeType === "application/pdf" ||
    ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mimeType);
  if (!supported) {
    if (offline) return { ok: true, data: coerce(offline, ctx), provider: offline.engine, lowConfidence: true };
    return { ok: false, reason: "UNSUPPORTED_TYPE", message: `Cannot read files of type ${mimeType}.` };
  }

  const systemPrompt = buildSystemPrompt(ctx);
  let userText = USER_INSTRUCTION;
  const ctxBits = [];
  if (ctx.caption) ctxBits.push(`Caption sent with this file: "${String(ctx.caption).slice(0, 400)}"`);
  if (ctx.chatContext) ctxBits.push(`Recent messages in this WhatsApp group (newest first), for context only:\n${String(ctx.chatContext).slice(0, 1200)}`);
  if (ctxBits.length) {
    userText =
      USER_INSTRUCTION +
      "\n\n--- SURROUNDING CHAT (a hint about which client/consignment these papers belong to — the document itself always wins if they disagree) ---\n" +
      ctxBits.join("\n\n");
  }

  const providers = [];
  if (anthropicKey) providers.push(["anthropic", () => callAnthropic(anthropicKey, buffer, mimeType, systemPrompt, userText)]);
  if (geminiKey) providers.push(["gemini", () => callGemini(geminiKey, buffer, mimeType, systemPrompt, userText)]);

  let lastErr = null;
  for (const [name, call] of providers) {
    try {
      const rawResult = await call();
      // The AI is the second opinion, not a replacement: anything it left
      // blank that the offline read DID find is kept, and the offline
      // transcription is kept when the AI returned none.
      const merged = { ...rawResult };
      if (offline) {
        for (const [k, v] of Object.entries(offline)) {
          if (v != null && v !== "" && (merged[k] == null || merged[k] === "")) merged[k] = v;
        }
        if (!merged.transcription || String(merged.transcription).length < 40) merged.transcription = offline.transcription;
        merged.offlineDocumentType = offline.documentType;
      }
      merged.readMethod = `${offline?.readMethod ? offline.readMethod + "+" : ""}${name}`;
      return { ok: true, data: coerce(merged, ctx), provider: offline ? `${offline.engine}+${name}` : name };
    } catch (err) {
      lastErr = err;
    }
  }

  // Cloud failed — the offline answer is still better than nothing, but
  // the reason is kept on the document so the "Why?" view can show it.
  if (offline) {
    const why = lastErr ? lastErr.message : "AI reading failed.";
    return { ok: true, data: coerce({ ...offline, aiError: why }, ctx), provider: offline.engine, lowConfidence: true, aiError: why, aiErrorCode: lastErr?.code || null };
  }
  return { ok: false, reason: "AI_FAILED", message: lastErr ? lastErr.message : "All readers failed.", aiError: lastErr ? lastErr.message : null, aiErrorCode: lastErr?.code || null };
}

/**
 * Local OCR with Tesseract. Runs entirely on this machine.
 *
 * PDFs aren't rasterised here — Tesseract can't read them directly and
 * pulling in a renderer would bloat the agent. A PDF with no text layer
 * therefore falls through to the cloud path if one is configured, or to
 * "needs review" if not. Photos and scans, which are the bulk of what
 * arrives on WhatsApp, are handled fully offline.
 */
/**
 * Read a file locally — no network, no API.
 *
 * PDFs go through pdfjs, which is what was missing: the agent could only
 * OCR images, so every PDF fell through to "Needs Review" regardless of
 * how clean it was. That one gap accounted for the bulk of the manual
 * pile.
 *
 * Returns { text, pages, method }. `pages` matters because vendors send
 * merged PDFs and each page is often a different document.
 */
async function readLocally(buffer, mimeType, fileName) {
  const name = String(fileName || "");
  const { sniffMime, ocrImage } = require("./imageOcr");
  const kind = sniffMime(buffer, mimeType);

  // Word / Excel attachments: read their text instead of refusing them.
  // A weighment register or a typed challan sent as .docx/.xlsx is still
  // supply paperwork; if the text says nothing supply-like the classifier
  // calls it "other" and it is set aside like any other non-document.
  if (/\.(docx|xlsx|xlsm|xls|csv|txt)$/i.test(name) || /officedocument|ms-excel|text\/(plain|csv)/i.test(mimeType || "")) {
    let text = "";
    try {
      text = await officeText(buffer, name, mimeType);
    } catch {
      text = "";
    }
    if (text.replace(/\s/g, "").length > 20) {
      return { text, pages: [text], method: /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? "spreadsheet_text" : "office_text", confidence: 95 };
    }
    const label = /\.(xlsx?|xlsm|csv)$/i.test(name) ? "spreadsheet" : "office file";
    throw new Error(`NOT_A_SUPPLY_DOCUMENT:This is a ${label} with no readable supply details.`);
  }
  if (/\.(docx?|pptx?|zip|rar|7z)$/i.test(name)) {
    throw new Error(`NOT_A_SUPPLY_DOCUMENT:This is an office file or archive, not supply paperwork.`);
  }

  const isPdf = kind === "application/pdf" || mimeType === "application/pdf" || /\.pdf$/i.test(name);

  if (isPdf) {
    let result = null;
    try {
      result = await extractPdfPages(buffer, { maxPages: 20 });
    } catch {
      result = null; // damaged text layer — the pages can still be rendered and read
    }
    if (result && result.hasTextLayer) {
      // A merged PDF can mix typed pages with photographed ones (our
      // invoice, then a scanned weight slip). Pages with no text of their
      // own are OCRd so nothing in the file goes unread.
      const blank = result.pages
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => String(t || "").replace(/\s/g, "").length < 40)
        .map(({ i }) => i)
        .slice(0, 8);
      if (!blank.length) return { text: result.text, pages: result.pages, method: "pdf_text", confidence: 99 };
      try {
        const scanned = await ocrScannedPdf(buffer, { maxPages: 20, pageIndexes: blank });
        const pages = result.pages.slice();
        blank.forEach((pi, k) => { if (scanned.pages[k]) pages[pi] = scanned.pages[k]; });
        return { text: pages.join("\n\n"), pages, method: "pdf_text+ocr", confidence: Math.min(99, scanned.confidence || 70) };
      } catch {
        return { text: result.text, pages: result.pages, method: "pdf_text", confidence: 99 };
      }
    }
    // No text layer — a phone-scanner PDF. Every page is rendered and read
    // through the photo pipeline (orientation, deskew, lighting).
    const scanned = await ocrScannedPdf(buffer, { maxPages: 8 });
    return { text: scanned.text, pages: scanned.pages, method: "pdf_scan_ocr", confidence: scanned.confidence };
  }

  if (!String(kind || "").startsWith("image/") && !String(mimeType || "").startsWith("image/")) {
    throw new Error(`Can't read files of type ${mimeType} locally.`);
  }

  // Photos: decoded, turned the right way up, straightened, lighting
  // evened out and contrast stretched before Tesseract reads them — see
  // lib/imageOcr.js. Fully offline.
  const read = await ocrImage(buffer, kind.startsWith("image/") ? kind : mimeType);
  return { text: read.text, pages: [read.text], method: read.method, confidence: read.confidence };
}

/** Plain text out of .docx / .xlsx / .csv / .txt, all in JavaScript. */
async function officeText(buffer, name, mimeType) {
  if (/\.(txt|csv)$/i.test(name) || /text\/(plain|csv)/i.test(mimeType || "")) return buffer.toString("utf8");
  if (/\.docx$/i.test(name) || /wordprocessingml/i.test(mimeType || "")) {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const parts = Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f)).sort();
    let out = "";
    for (const part of parts) {
      const xml = await zip.file(part).async("string");
      out += xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<\/w:p>|<w:br\/>|<\/w:tr>/g, "\n")
        .replace(/<\/w:tc>/g, "  ")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'") + "\n";
    }
    return out;
  }
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.slice(0, 5).map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t", blankrows: false }).replace(/"/g, "").replace(/\t+/g, "  ")).join("\n\n");
}

/**
 * Classify a merged PDF page by page.
 *
 * A single vendor PDF routinely holds the tax invoice, the e-way bill,
 * the Bill T and the weight slip. Reading it as one blob lets whichever
 * document has the most text win and loses the rest — so each page is
 * classified separately and the distinct types are reported together.
 */
function classifyPages(pages, ctx) {
  const perPage = [];
  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i];
    if (!pageText || pageText.replace(/\s/g, "").length < 30) continue;
    const extracted = extractOffline(pageText, ctx);
    perPage.push({ page: i + 1, ...extracted });
  }
  return perPage;
}

/** Merge page-level results into one record for the whole file. */
function combinePages(perPage, wholeText, ctx) {
  if (!perPage.length) return extractOffline(wholeText, ctx);

  // The most confident page decides the file's primary type.
  const primary = [...perPage].sort((a, b) => b.confidence - a.confidence)[0];
  const combined = { ...primary };

  // Fill any blank from whichever page did read it. A weight slip page
  // carries the vehicle; the invoice page carries the reference — the
  // file as a whole knows both.
  const FILL = [
    "referenceNo", "biomeDocNo", "vendorDocNo", "vendorName", "vendorGstin",
    "clientName", "clientGstin", "documentDate", "ewayBillNo", "vehicleNo",
    "grossWeight", "tareWeight", "netWeight", "totalAmount", "driverMobile",
  ];
  for (const page of perPage) {
    for (const field of FILL) {
      if (!combined[field] && page[field]) combined[field] = page[field];
    }
    if (page.hasDigitalSignature) combined.hasDigitalSignature = true;
  }

  // Record every distinct document found, so the supply-set checklist
  // credits all four when one merged PDF delivers all four.
  const types = [...new Set(perPage.map((p) => p.documentType).filter((t) => t && t !== "other"))];
  // Resolve the client from the WHOLE document, not from whichever page
  // happened to score highest.
  //
  // On a merged vendor PDF the invoice page names "Jhajjhar Power
  // Limited" while the e-way bill page prints only the plant location,
  // "Jharli" — which belongs to a different client entirely. Taking the
  // primary page's answer meant a Jhajjar supply could be filed under
  // Aravali Power depending on which page won.
  try {
    const { matchClient } = require("./clients");
    const whole = matchClient(wholeText, ctx.clients && ctx.clients.length ? ctx.clients : undefined);
    if (whole) combined.clientName = whole.name;
  } catch {
    /* keep whatever the pages agreed on */
  }

  combined.containedDocumentTypes = types;
  combined.pageCount = perPage.length;
  combined.transcription = wholeText;
  if (types.length > 1) {
    combined.isMergedDocument = true;
  }
  return combined;
}



module.exports = {
  classifyPages,
  combinePages,
  classifyDocument,
  readLocally,
  DOC_TYPES,
  DOC_TYPE_LABEL,
  DOC_TYPE_SIDE,
};
