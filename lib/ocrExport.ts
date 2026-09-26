/**
 * Biome Platform — OCR batch export, rebuilt
 * -------------------------------------------------------------------
 * What was wrong with the old export, and why it produced nonsense:
 *
 *   1. Every field label found anywhere in the batch became a column on
 *      EVERY row. Upload 100 mixed documents and you get a sheet forty
 *      columns wide that is ninety per cent empty, because a weight slip
 *      has no "Test Method" and a lab report has no "Tare Weight".
 *   2. The whole recognised text of each document was dumped into a cell
 *      on its own row. A hundred slips made a workbook nobody could open,
 *      let alone read.
 *   3. Nothing was grouped. Weight slips, lab reports and invoices all
 *      landed on one "Summary" sheet as if they were the same thing.
 *
 * The fix is to do what a person would do with a pile of paper: sort it
 * first. Each document is classified, each type gets its own sheet with
 * only its own columns, and the raw text goes to the back of the book
 * where it belongs rather than through the middle of the table.
 */

export interface ExportField { label: string; value: string; }

export interface ExportDoc {
  fileName: string;
  fields: Record<string, ExportField>;
  confidence: number;
  lowConfidenceWordCount: number;
  table?: { headers: string[]; rows: Record<string, any>[] } | null;
  rawText?: string;
}

export type DocKind =
  | "weight_slip" | "lab_report" | "tax_invoice" | "delivery_challan"
  | "eway_bill" | "bilty" | "identity" | "bank" | "table" | "other";

export interface KindSpec {
  id: DocKind;
  label: string;
  /** Columns for this kind, in the order a person would want to read them. */
  columns: string[];
  /** Label fragments that map an extracted field onto one of the columns. */
  aliases: Record<string, string[]>;
}

/**
 * The document types this business actually handles. A type earns a place
 * here only if its columns are genuinely different — otherwise it belongs
 * under "other" rather than adding an almost-empty sheet.
 */
export const KIND_SPECS: KindSpec[] = [
  {
    id: "weight_slip",
    label: "Weight slips",
    columns: ["Slip No", "Date", "Vehicle No", "Party", "Material", "Gross Wt", "Tare Wt", "Net Wt"],
    aliases: {
      "Slip No": ["slip", "ticket", "rst", "serial", "receipt"],
      Date: ["date"],
      "Vehicle No": ["vehicle", "vehical", "truck", "lorry"],
      Party: ["party", "supplier", "name", "consignor", "vendor", "farmer"],
      Material: ["material", "commodity", "product", "item"],
      "Gross Wt": ["gross"],
      "Tare Wt": ["tare", "trare"],
      "Net Wt": ["net", "nett"],
    },
  },
  {
    id: "lab_report",
    label: "Lab reports",
    columns: ["Report No", "Date", "Sample", "GCV", "Moisture %", "Ash %", "Sulphur %", "Volatile %"],
    aliases: {
      "Report No": ["report", "certificate", "coa", "ref"],
      Date: ["date"],
      Sample: ["sample", "material", "description"],
      GCV: ["gcv", "calorific", "kcal"],
      "Moisture %": ["moisture", "moist"],
      "Ash %": ["ash"],
      "Sulphur %": ["sulphur", "sulfur"],
      "Volatile %": ["volatile", "vm"],
    },
  },
  {
    id: "tax_invoice",
    label: "Tax invoices",
    columns: ["Invoice No", "Date", "Party", "GSTIN", "Vehicle No", "Quantity", "Rate", "Taxable Value", "Total"],
    aliases: {
      "Invoice No": ["invoice", "bill no", "inv"],
      Date: ["date"],
      Party: ["party", "buyer", "consignee", "customer", "name", "billed to"],
      GSTIN: ["gst", "gstin"],
      "Vehicle No": ["vehicle", "vehical", "truck"],
      Quantity: ["quantity", "qty", "weight"],
      Rate: ["rate"],
      "Taxable Value": ["taxable", "sub total", "subtotal"],
      Total: ["total", "grand", "amount"],
    },
  },
  {
    id: "delivery_challan",
    label: "Delivery challans",
    columns: ["Challan No", "Date", "Party", "Vehicle No", "Material", "Quantity"],
    aliases: {
      "Challan No": ["challan", "dc no", "delivery"],
      Date: ["date"],
      Party: ["party", "consignee", "name"],
      "Vehicle No": ["vehicle", "truck"],
      Material: ["material", "description", "goods"],
      Quantity: ["quantity", "qty", "weight"],
    },
  },
  {
    id: "eway_bill",
    label: "E-way bills",
    columns: ["EWB No", "Date", "From", "To", "Vehicle No", "Value", "Valid Until"],
    aliases: {
      "EWB No": ["eway", "e-way", "ewb"],
      Date: ["date"],
      From: ["from", "dispatch", "consignor"],
      To: ["to", "ship to", "consignee"],
      "Vehicle No": ["vehicle", "truck"],
      Value: ["value", "amount"],
      "Valid Until": ["valid"],
    },
  },
  {
    id: "bilty",
    label: "Bilty / LR",
    columns: ["LR No", "Date", "Transporter", "Vehicle No", "From", "To", "Freight"],
    aliases: {
      "LR No": ["lr", "gr no", "bilty", "consignment"],
      Date: ["date"],
      Transporter: ["transport", "carrier"],
      "Vehicle No": ["vehicle", "truck"],
      From: ["from", "origin"],
      To: ["to", "destination"],
      Freight: ["freight", "charges"],
    },
  },
  {
    id: "identity",
    label: "Identity documents",
    columns: ["Name", "Number", "Date of Birth", "Father / Spouse", "Address"],
    aliases: {
      Name: ["name"],
      Number: ["aadhaar", "pan", "number", "id"],
      "Date of Birth": ["birth", "dob"],
      "Father / Spouse": ["father", "spouse", "husband"],
      Address: ["address"],
    },
  },
  {
    id: "bank",
    label: "Bank documents",
    columns: ["Account Holder", "Account No", "IFSC", "Bank", "Branch"],
    aliases: {
      "Account Holder": ["holder", "name"],
      "Account No": ["account", "a/c"],
      IFSC: ["ifsc"],
      Bank: ["bank"],
      Branch: ["branch"],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** Words that give a document type away, weighted by how decisive they are. */
const SIGNALS: { kind: DocKind; weight: number; pattern: RegExp }[] = [
  { kind: "weight_slip", weight: 4, pattern: /\b(weigh\s?bridge|weighbridge|kanta|dharam\s?kanta|tare\s*w|gross\s*w)\b/i },
  { kind: "weight_slip", weight: 2, pattern: /\b(net\s*wt|nett\s*wt|slip\s*no)\b/i },
  { kind: "lab_report", weight: 4, pattern: /\b(gcv|calorific|proximate|ultimate\s+analysis|test\s+report|coa|certificate\s+of\s+analysis)\b/i },
  { kind: "lab_report", weight: 2, pattern: /\b(ash\s*%|volatile\s+matter|moisture\s*%)\b/i },
  { kind: "tax_invoice", weight: 4, pattern: /\b(tax\s+invoice|gstin|cgst|sgst|igst)\b/i },
  { kind: "delivery_challan", weight: 4, pattern: /\b(delivery\s+challan|challan\s+no)\b/i },
  { kind: "eway_bill", weight: 5, pattern: /\b(e-?way\s*bill|ewb\s*no)\b/i },
  { kind: "bilty", weight: 4, pattern: /\b(bilty|lorry\s+receipt|goods\s+receipt|\bg\.?r\.?\s*no|\bl\.?r\.?\s*no)\b/i },
  { kind: "identity", weight: 5, pattern: /\b(aadhaar|आधार|permanent\s+account\s+number|income\s+tax\s+department)\b/i },
  { kind: "bank", weight: 4, pattern: /\b(ifsc|cancelled\s+cheque|account\s+number|passbook)\b/i },
];

/**
 * What kind of document this is.
 *
 * Filename first — a person naming a file "weight slip 42.jpg" has told us
 * more reliably than OCR will. Then the text signals. A table-shaped
 * document with no signal at all is a table, not an "unclassified" row.
 */
export function classifyDoc(doc: ExportDoc): { kind: DocKind; confidence: number } {
  const haystack = `${doc.fileName} ${doc.rawText || ""} ${Object.values(doc.fields).map((f) => `${f.label} ${f.value}`).join(" ")}`;

  const scores = new Map<DocKind, number>();
  const name = doc.fileName.toLowerCase();
  const nameHints: [DocKind, RegExp][] = [
    ["weight_slip", /weight|weigh|kanta|slip|parchi/],
    ["lab_report", /lab|coa|gcv|analysis|test/],
    ["tax_invoice", /invoice|tax|bill/],
    ["delivery_challan", /challan|dc/],
    ["eway_bill", /eway|e-way|ewb/],
    ["bilty", /bilty|lr|gr[-_ ]?no/],
    ["identity", /aadhaar|aadhar|pan/],
    ["bank", /cheque|bank|passbook/],
  ];
  for (const [kind, re] of nameHints) if (re.test(name)) scores.set(kind, (scores.get(kind) || 0) + 3);
  for (const s of SIGNALS) if (s.pattern.test(haystack)) scores.set(s.kind, (scores.get(s.kind) || 0) + s.weight);

  let best: DocKind = "other";
  let bestScore = 0;
  scores.forEach((score, kind) => { if (score > bestScore) { bestScore = score; best = kind; } });

  if (bestScore === 0) {
    const hasTable = Boolean(doc.table?.headers?.length && doc.table.rows.length);
    return { kind: hasTable ? "table" : "other", confidence: 0 };
  }
  // Roughly: 4 points is one decisive signal, which is enough to file it.
  return { kind: best, confidence: Math.min(100, Math.round((bestScore / 8) * 100)) };
}

/** Best value for a column, matched by alias against the extracted fields. */
function valueForColumn(doc: ExportDoc, column: string, spec: KindSpec): string {
  const aliases = spec.aliases[column] || [];
  const fields = Object.values(doc.fields);

  // An exact label match wins over an alias — the extractor already got it right.
  const exact = fields.find((f) => f.label.toLowerCase() === column.toLowerCase());
  if (exact?.value?.trim()) return exact.value.trim();

  for (const alias of aliases) {
    const hit = fields.find((f) => f.label.toLowerCase().includes(alias));
    if (hit?.value?.trim()) return hit.value.trim();
  }
  return "";
}

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: Record<string, any>[];
}

export interface ExportPlan {
  sheets: ExportSheet[];
  /** Documents nothing could be made of, listed so they aren't lost. */
  unreadable: { fileName: string; reason: string }[];
  counts: Record<string, number>;
  total: number;
}

/**
 * Turn a batch into sheets.
 *
 * `filledOnly` drops a column no document in its group actually filled —
 * this is what stops a "Sulphur %" column appearing on a sheet of slips
 * that never mentioned sulphur.
 */
export function buildExportPlan(docs: ExportDoc[], opts: { filledOnly?: boolean } = {}): ExportPlan {
  const filledOnly = opts.filledOnly !== false;
  const grouped = new Map<DocKind, { doc: ExportDoc; confidence: number }[]>();
  const unreadable: { fileName: string; reason: string }[] = [];

  for (const doc of docs) {
    const hasAnything =
      Object.values(doc.fields).some((f) => f.value?.trim()) ||
      (doc.table?.rows?.length ?? 0) > 0 ||
      (doc.rawText || "").trim().length > 20;
    if (!hasAnything) {
      unreadable.push({
        fileName: doc.fileName,
        reason: doc.confidence < 40
          ? "Too blurred or dark to read — re-photograph it in better light."
          : "Nothing recognisable was found in this file.",
      });
      continue;
    }
    const { kind, confidence } = classifyDoc(doc);
    const list = grouped.get(kind) || [];
    list.push({ doc, confidence });
    grouped.set(kind, list);
  }

  const sheets: ExportSheet[] = [];
  const counts: Record<string, number> = {};

  // Known kinds, in the order they are listed above.
  for (const spec of KIND_SPECS) {
    const group = grouped.get(spec.id);
    if (!group?.length) continue;

    const rows = group.map(({ doc, confidence }) => {
      const row: Record<string, any> = { File: doc.fileName };
      for (const column of spec.columns) row[column] = valueForColumn(doc, column, spec);
      row["Read quality"] = `${doc.confidence.toFixed(0)}%`;
      row["Type match"] = confidence >= 50 ? "Confident" : "Probable";
      return row;
    });

    const columns = ["File", ...spec.columns, "Read quality", "Type match"].filter((column) => {
      if (!filledOnly) return true;
      if (["File", "Read quality", "Type match"].includes(column)) return true;
      return rows.some((r) => String(r[column] ?? "").trim());
    });

    sheets.push({ name: spec.label, columns, rows });
    counts[spec.label] = rows.length;
  }

  // Table-shaped documents get one sheet each — their columns are their own.
  const tables = grouped.get("table") || [];
  const used = new Set<string>();
  for (const { doc } of tables) {
    if (!doc.table?.headers?.length) continue;
    let name = doc.fileName.replace(/\.[^.]+$/, "").replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28) || "Table";
    while (used.has(name)) name = `${name.slice(0, 25)} ${used.size + 1}`;
    used.add(name);
    sheets.push({ name, columns: doc.table.headers, rows: doc.table.rows });
    counts[name] = doc.table.rows.length;
  }

  // Anything classified but not matching a known spec.
  const others = grouped.get("other") || [];
  if (others.length) {
    const labels: string[] = [];
    for (const { doc } of others) {
      for (const f of Object.values(doc.fields)) {
        if (f.value?.trim() && !labels.includes(f.label)) labels.push(f.label);
      }
    }
    const rows = others.map(({ doc }) => {
      const row: Record<string, any> = { File: doc.fileName };
      for (const label of labels) {
        const hit = Object.values(doc.fields).find((f) => f.label === label);
        row[label] = hit?.value ?? "";
      }
      row["Read quality"] = `${doc.confidence.toFixed(0)}%`;
      return row;
    });
    sheets.push({ name: "Other documents", columns: ["File", ...labels, "Read quality"], rows });
    counts["Other documents"] = rows.length;
  }

  return { sheets, unreadable, counts, total: docs.length };
}

/**
 * The recognised text, kept OUT of the data sheets.
 *
 * It used to sit in a cell on every row, which is what made a hundred-slip
 * export unusable. It is still worth having — it is the fallback when a
 * field was missed — so it goes on its own sheet at the back.
 */
export function buildTextSheet(docs: ExportDoc[]): ExportSheet {
  return {
    name: "Recognised text",
    columns: ["File", "Text"],
    rows: docs
      .filter((d) => (d.rawText || "").trim())
      // Excel refuses a cell over 32,767 characters, and the write fails
      // silently enough to look like a broken export.
      .map((d) => ({ File: d.fileName, Text: (d.rawText || "").slice(0, 32000) })),
  };
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

const INK = "FF0B1F27";
const LEAF = "FF1F7A4C";
const SOFT = "FFEFF4F2";
const BAND = "FFF8FAF9";

/**
 * Write the plan to an Excel workbook and download it.
 *
 * One sheet per document type, a contents sheet at the front so a
 * hundred-document batch can be navigated, and the recognised text at the
 * back rather than through the middle of the data.
 */
export async function downloadClassifiedExcel(docs: ExportDoc[], fileName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const plan = buildExportPlan(docs);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Biome Industria";
  wb.created = new Date();

  // ---- Contents ----
  const contents = wb.addWorksheet("Contents");
  contents.mergeCells(1, 1, 1, 3);
  const title = contents.getCell(1, 1);
  title.value = "BIOME INDUSTRIA — document batch";
  title.font = { size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  title.alignment = { horizontal: "center" };
  contents.getRow(1).height = 24;

  contents.addRow([]);
  contents.addRow([
    `${plan.total} file(s) read on ${new Date().toLocaleDateString("en-IN")}`,
  ]);
  contents.addRow([]);
  const head = contents.addRow(["Sheet", "What it holds", "Rows"]);
  head.eachCell((c: any) => {
    c.font = { bold: true, color: { argb: INK } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
  });
  for (const sheet of plan.sheets) {
    contents.addRow([sheet.name, sheet.columns.slice(1, 5).join(", "), sheet.rows.length]);
  }
  if (plan.unreadable.length) {
    contents.addRow([]);
    const w = contents.addRow([`${plan.unreadable.length} file(s) could not be read — see the last sheet`]);
    w.getCell(1).font = { bold: true, color: { argb: "FFB3261E" } };
  }
  contents.getColumn(1).width = 28;
  contents.getColumn(2).width = 60;
  contents.getColumn(3).width = 10;

  // ---- One sheet per type ----
  for (const sheet of plan.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sheet.columns.map((key) => ({
      header: key, key,
      width: key === "File" ? 30 : Math.min(28, Math.max(12, key.length + 6)),
    }));
    ws.getRow(1).eachCell((c: any) => {
      c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEAF } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    ws.getRow(1).height = 22;

    sheet.rows.forEach((row, i) => {
      const r = ws.addRow(row);
      r.eachCell((c: any) => {
        c.font = { size: 10 };
        c.alignment = { vertical: "middle", wrapText: false };
        if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
      });
    });
    if (sheet.rows.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rows.length + 1, column: sheet.columns.length } };
    }
  }

  // ---- Unreadable, so nothing disappears silently ----
  if (plan.unreadable.length) {
    const ws = wb.addWorksheet("Could not read");
    ws.columns = [{ header: "File", key: "File", width: 34 }, { header: "Why", key: "Why", width: 60 }];
    ws.getRow(1).eachCell((c: any) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB3261E" } };
    });
    for (const u of plan.unreadable) ws.addRow({ File: u.fileName, Why: u.reason });
  }

  // ---- Raw text at the back ----
  const text = buildTextSheet(docs);
  if (text.rows.length) {
    const ws = wb.addWorksheet(text.name);
    ws.columns = [{ header: "File", key: "File", width: 30 }, { header: "Text", key: "Text", width: 110 }];
    ws.getRow(1).eachCell((c: any) => {
      c.font = { bold: true, color: { argb: INK } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    });
    for (const r of text.rows) {
      const row = ws.addRow(r);
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 4000);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);

  return plan;
}

/**
 * The same classified plan, as a PDF.
 *
 * The Excel export sorts a mixed batch into a sheet per document kind.
 * A PDF of the same plan is what people actually attach to an email or
 * hand to an auditor, so it follows exactly the same grouping: a contents
 * page, then one section per kind with its own table, then the documents
 * that could not be read. Landscape, because these tables are wide.
 */
/** One line describing what a sheet holds, for the contents page. */
function sheetBlurb(sheet: ExportSheet): string {
  const detail = sheet.columns.filter((c) => !["File", "Read quality", "Type match"].includes(c));
  return detail.length ? detail.slice(0, 6).join(", ") : "File list";
}

export async function downloadClassifiedPdf(docs: ExportDoc[], fileName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { drawLetterhead, drawFooter } = await import("./pdfBranding");

  const plan = buildExportPlan(docs);
  const pdf = new jsPDF({ orientation: "landscape" });
  const green: [number, number, number] = [124, 179, 66];

  // ---- Contents: what was found, before any detail ----
  let y = await drawLetterhead(
    pdf,
    "Document Extraction Report",
    `${docs.length} file${docs.length === 1 ? "" : "s"} · sorted by document type · ${new Date().toLocaleString("en-IN")}`
  );
  autoTable(pdf, {
    startY: y,
    head: [["Document type", "How many", "What is in it"]],
    body: [
      ...plan.sheets.map((s) => [s.name, String(s.rows.length), sheetBlurb(s)]),
      ...(plan.unreadable.length ? [["Could not read", String(plan.unreadable.length), "Listed at the end with the reason"]] : []),
    ],
    theme: "striped",
    headStyles: { fillColor: green, textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    margin: { left: 14, right: 14 },
  });

  // ---- One section per document kind ----
  for (const sheet of plan.sheets) {
    pdf.addPage();
    const startY = await drawLetterhead(pdf, sheet.name, `${sheet.rows.length} document(s) · ${sheet.columns.length} column(s)`);
    autoTable(pdf, {
      startY,
      head: [sheet.columns],
      body: sheet.rows.map((row) => sheet.columns.map((c) => String(row[c] ?? "—"))),
      theme: "striped",
      headStyles: { fillColor: green, textColor: 255, fontSize: 7.5 },
      styles: { fontSize: 7, cellPadding: 1.8, overflow: "linebreak" },
      margin: { left: 14, right: 14 },
    });
  }

  // ---- What could not be read, and why ----
  if (plan.unreadable.length) {
    pdf.addPage();
    const startY = await drawLetterhead(pdf, "Could not read", "Re-photograph these and run them again");
    autoTable(pdf, {
      startY,
      head: [["File", "Why"]],
      body: plan.unreadable.map((u) => [u.fileName, u.reason]),
      theme: "striped",
      headStyles: { fillColor: [190, 70, 70], textColor: 255, fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
  }

  drawFooter(pdf);
  pdf.save(fileName);
  return plan;
}
