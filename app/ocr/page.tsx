"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ScanLine,
  Settings2,
  FileSpreadsheet,
  FileText,
  Download,
  Sparkles,
  Table2,
  X,
  Info,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import MultiDropzone from "@/components/ocr/MultiDropzone";
import DocumentQueue from "@/components/ocr/DocumentQueue";
import DocumentDetail from "@/components/ocr/DocumentDetail";
import type { QueuedDoc, Engine } from "@/components/ocr/types";
import {
  runOcrThorough,
  extractDocumentFields,
  detectTableInResult,
  slugifyLabel,
  type OcrLanguage,
  type OcrResult,
  type ExtractedField,
  buildOcrExportRows,
  downloadOcrExcelReport,
  downloadOcrPdfReport,
  type OcrDocSummary,
} from "@/lib/ocr";
import { extractDocumentWithAI, fileToDataUrl, type AiExtractionResult, type LabReportData } from "@/lib/aiExtract";
import type { PdfTable } from "@/lib/pdf";
import { downloadCsv } from "@/lib/reconciliation";
import { downloadLabReportPdf, downloadLabReportExcel } from "@/lib/labReport";
import { useNotifications } from "@/lib/notifications";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `doc-${Date.now()}-${idCounter}`;
}

/** Maps whatever labelled fields the AI actually found on THIS document
 *  (no fixed invoice-shaped schema) into the same keyed field map the
 *  offline extractor produces, so the rest of the UI/export pipeline
 *  doesn't need to know or care which engine read the document. */
function mapAiFields(ai: AiExtractionResult): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  const usedKeys = new Set<string>();
  for (const f of ai.fields ?? []) {
    if (!f.label || f.value === null || f.value === "") continue;
    let key = slugifyLabel(f.label);
    let n = 2;
    while (usedKeys.has(key)) key = `${slugifyLabel(f.label)}_${n++}`;
    usedKeys.add(key);
    out[key] = { label: f.label, value: f.value, confidence: f.confidence };
  }
  return out;
}


/** Server-side offline read (app/api/ocr-read). Returns null when the
 *  server reader is unavailable, so the browser pipeline can take over. */
async function readOnServer(file: File): Promise<{ result: OcrResult; fields: Record<string, ExtractedField> } | null> {
  try {
    const dataUrl = await fileToDataUrl(file);
    const res = await fetch("/api/ocr-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBase64: String(dataUrl).split(",")[1] || "", fileName: file.name, mimeType: file.type || undefined }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text: string = j.text || "";
    if (!text.replace(/\s/g, "")) return null;
    const conf = Number(j.confidence) || 0;
    const rawLines = text.split(/\r?\n/).map((t) => t.trim()).filter((t) => t && t !== "----");
    const result: OcrResult = {
      text,
      confidence: conf,
      lines: rawLines.map((t, i) => ({ text: t, confidence: conf, y: i * 20, height: 18 })),
      wordCount: text.split(/\s+/).filter(Boolean).length,
      lowConfidenceWordCount: 0,
    };
    // Biome's own fields first (type, reference, invoice no., vehicle,
    // GSTIN, weights…), then any other "Label: value" pairs on the page.
    const fields: Record<string, ExtractedField> = {};
    for (const f of j.fields || []) {
      let key = slugifyLabel(f.label);
      let n = 2;
      while (fields[key]) key = `${slugifyLabel(f.label)}_${n++}`;
      fields[key] = { label: f.label, value: String(f.value), confidence: Number(f.confidence) || conf };
    }
    const generic = extractDocumentFields(result);
    for (const [k, f] of Object.entries(generic)) {
      if (Object.values(fields).some((x) => x.value === f.value)) continue;
      if (Object.keys(fields).length >= 40) break;
      fields[fields[k] ? `${k}_2` : k] = f;
    }
    return { result, fields };
  } catch {
    return null;
  }
}

export default function OcrScannerPage() {
  const [docs, setDocs] = useState<QueuedDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lang, setLang] = useState<OcrLanguage>("eng");
  const [mode, setMode] = useState<"best" | "offline">("best");
  const [exportingPdf, setExportingPdf] = useState(false);
  const { notify } = useNotifications();
  const [exportingExcel, setExportingExcel] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null); // null = untried yet
  const [banner, setBanner] = useState<string | null>(null);
  const processingRef = useRef(false);

  function addFiles(files: File[]) {
    const newDocs: QueuedDoc[] = files.map((file) => {
      const isPdf = /\.pdf$/i.test(file.name);
      return {
        id: nextId(),
        file,
        isPdf,
        previewUrl: isPdf ? null : URL.createObjectURL(file),
        status: "queued",
      };
    });
    setDocs((prev) => [...prev, ...newDocs]);
    if (!activeId && newDocs[0]) setActiveId(newDocs[0].id);
  }

  function removeDoc(id: string) {
    setDocs((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc?.previewUrl) URL.revokeObjectURL(doc.previewUrl);
      return prev.filter((d) => d.id !== id);
    });
    if (activeId === id) setActiveId(null);
  }

  function updateField(docId: string, key: string, value: string) {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === docId && d.fields
          ? { ...d, fields: { ...d.fields, [key]: { ...d.fields[key], value } } }
          : d
      )
    );
  }

  function setProgress(docId: string, label: string) {
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, progressLabel: label } : d)));
  }

  function patchDoc(docId: string, patch: Partial<QueuedDoc>) {
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, ...patch } : d)));
  }

  // Sequential queue processor — one document at a time. AI-powered
  // reading (Claude vision) is tried first for the best possible
  // accuracy, especially on stamped, rotated, or low-quality scans; if
  // no API key is configured (or a call fails), it falls back to the
  // offline multi-pass Tesseract pipeline automatically.
  useEffect(() => {
    if (processingRef.current) return;
    const next = docs.find((d) => d.status === "queued");
    if (!next) return;

    processingRef.current = true;
    processDoc(next).finally(() => {
      processingRef.current = false;
    });

    async function processDoc(doc: QueuedDoc) {
      patchDoc(doc.id, { status: "processing" });

      try {
        let previewUrl = doc.previewUrl;
        let images: string[] = [];

        if (doc.isPdf) {
          const { renderPdfPagesToImages } = await import("@/lib/pdf");
          images = await renderPdfPagesToImages(doc.file);
          previewUrl = images[0] ?? null;
          patchDoc(doc.id, { previewUrl });
        } else {
          images = [await fileToDataUrl(doc.file)];
        }

        let engine: Engine = "tesseract";
        let result: OcrResult | null = null;
        let fields: Record<string, ExtractedField> = {};
        let table: PdfTable | null = null;
        let labReport: LabReportData | null = null;

        if (mode === "best" && aiAvailable !== false) {
          setProgress(doc.id, "Reading with AI (Claude vision)…");
          try {
            const ai = await extractDocumentWithAI(images.slice(0, 6));
            fields = mapAiFields(ai);
            table =
              ai.documentType === "ledger_table" && ai.table && ai.table.headers.length >= 2
                ? ai.table
                : null;
            labReport = ai.documentType === "lab_report" ? ai.labReport ?? null : null;
            // Lab reports get their own rich per-document view/export (see
            // `labReport` above), but the batch Summary/PDF export only
            // looks at `fields`/`table` — without this, a correctly
            // AI-classified lab report would silently vanish from the
            // batch export entirely. Mirror its metadata + results table
            // into the generic shape too so it shows up there as well.
            if (labReport) {
              if (labReport.table && labReport.table.headers.length >= 2) {
                table = labReport.table;
              }
              const metaEntries: [string, string | null | undefined][] = [
                ["Organization", labReport.organizationName],
                ["Department", labReport.department],
                ["Address", labReport.address],
                ["Date", labReport.metadata?.date],
                ["Test Report No", labReport.metadata?.testReportNo],
                ["Vendor Name", labReport.metadata?.vendorName],
                ["PO No", labReport.metadata?.poNo],
                ["Material Supplied", labReport.metadata?.materialSupplied],
                ["Sample Drawn by Lab", labReport.metadata?.sampleDrawnBy],
              ];
              for (const [label, value] of metaEntries) {
                if (value && value.trim()) {
                  fields[slugifyLabel(label)] = { label, value, confidence: 90 };
                }
              }
            }
            const confVals = Object.values(fields).map((f) => f.confidence);
            const avgConf = confVals.length
              ? confVals.reduce((a, b) => a + b, 0) / confVals.length
              : 50;
            result = {
              text: ai.transcription || "",
              confidence: avgConf,
              lines: [],
              wordCount: (ai.transcription || "").split(/\s+/).filter(Boolean).length,
              lowConfidenceWordCount: confVals.filter((c) => c < 60).length,
            };
            engine = "ai";
            if (aiAvailable === null) setAiAvailable(true);
          } catch (aiErr: any) {
            if (aiErr?.code === "NO_API_KEY") {
              setAiAvailable(false);
              setBanner(
                "Reading with the free offline OCR. For difficult scans, add the free Gemini key once in Settings → AI OCR Engine (aistudio.google.com/apikey) — no restart needed."
              );
            } else {
              setBanner(
                `AI reading failed for "${doc.file.name}" (${aiErr?.message || "unknown error"}) — used offline OCR instead for this document.`
              );
            }
          }
        }

        // The offline reader on the server — the same one WhatsApp uses
        // (photo clean-up, orientation, table-line removal, OCR-slip repair,
        // Biome field rules). The in-browser pass below is only a fallback.
        if (!result) {
          setProgress(doc.id, "Reading offline (straightening, cleaning, reading every cell)…");
          const server = await readOnServer(doc.file);
          if (server) {
            engine = "tesseract";
            result = server.result;
            fields = server.fields;
            const detected = detectTableInResult(result);
            table = detected.headers.length >= 2 && detected.rows.length >= 1 ? detected : null;
          }
        }

        if (!result) {
          engine = "tesseract";
          if (doc.isPdf) {
            const merged = {
              text: [] as string[],
              confidence: 0,
              lines: [] as OcrResult["lines"],
              wordCount: 0,
              lowConfidenceWordCount: 0,
            };
            for (let i = 0; i < images.length; i++) {
              const r = await runOcrThorough(images[i], lang, (p) =>
                setProgress(
                  doc.id,
                  images.length > 1
                    ? `Page ${i + 1}/${images.length} · pass ${p.pass}/${p.totalPasses} (${p.label})`
                    : `Pass ${p.pass}/${p.totalPasses} · ${p.label}`
                )
              );
              merged.text.push(r.text);
              merged.lines.push(...r.lines);
              merged.confidence += r.confidence * Math.max(1, r.wordCount);
              merged.wordCount += r.wordCount;
              merged.lowConfidenceWordCount += r.lowConfidenceWordCount;
            }
            result = {
              text: merged.text.join("\n\n"),
              confidence: merged.wordCount ? merged.confidence / merged.wordCount : 0,
              lines: merged.lines,
              wordCount: merged.wordCount,
              lowConfidenceWordCount: merged.lowConfidenceWordCount,
            };
          } else {
            result = await runOcrThorough(doc.file, lang, (p) =>
              setProgress(doc.id, `Pass ${p.pass}/${p.totalPasses} · ${p.label}`)
            );
          }
          fields = extractDocumentFields(result);
          const detected = detectTableInResult(result);
          table = detected.headers.length >= 2 && detected.rows.length >= 1 ? detected : null;
        }

        patchDoc(doc.id, {
          status: "done",
          result: result!,
          fields,
          table,
          labReport,
          previewUrl,
          progressLabel: undefined,
          engine,
        });
      } catch (err: any) {
        patchDoc(doc.id, {
          status: "error",
          error: err?.message || "Could not read this document.",
          progressLabel: undefined,
        });
      }
    }
  }, [docs, lang, aiAvailable, mode]);

  const activeDoc = docs.find((d) => d.id === activeId) ?? null;
  const doneDocs = docs.filter((d) => d.status === "done");

  function summaries(): OcrDocSummary[] {
    return doneDocs.map((d) => ({
      fileName: d.file.name,
      fields: d.fields ?? {},
      confidence: d.result?.confidence ?? 0,
      lowConfidenceWordCount: d.result?.lowConfidenceWordCount ?? 0,
      table: d.table ?? null,
      rawText: d.result?.text ?? "",
    }));
  }

  /**
   * The classified export.
   *
   * The old one put every field found anywhere in the batch as a column on
   * every row, and the whole recognised text in a cell — so a hundred mixed
   * documents produced a sheet that was mostly empty and impossible to
   * read. This sorts the batch by document type first and gives each type
   * its own sheet with only its own columns.
   */
  async function exportClassifiedExcel() {
    setExportingExcel(true);
    try {
      const { downloadClassifiedExcel } = await import("@/lib/ocrExport");
      // Processed results, not the raw upload queue — the queue has no
      // fileName/rawText, so the sorter found nothing and the export died.
      const plan = await downloadClassifiedExcel(summaries() as any, "biome-documents-sorted.xlsx");
      const summary = Object.entries(plan.counts)
        .map(([name, n]) => `${n} ${name.toLowerCase()}`)
        .join(", ");
      notify({
        kind: "success",
        title: "Sorted export ready",
        detail: summary
          ? `${summary}${plan.unreadable.length ? ` · ${plan.unreadable.length} could not be read` : ""}`
          : "biome-documents-sorted.xlsx",
      });
    } catch (err) {
      notify({ kind: "error", title: "Export failed", detail: (err as Error).message });
    } finally {
      setExportingExcel(false);
    }
  }

  async function exportExcel() {
    setExportingExcel(true);
    try {
      const docs = summaries();
      await downloadOcrExcelReport(docs, "biome-ocr-results.xlsx");
      notify({
        kind: "success",
        title: "Excel report ready",
        detail: `${docs.length} document${docs.length === 1 ? "" : "s"} exported to biome-ocr-results.xlsx`,
      });
    } finally {
      setExportingExcel(false);
    }
  }

  function exportCsv() {
    const rows = buildOcrExportRows(summaries());
    downloadCsv(rows, "biome-ocr-results.csv");
    notify({ kind: "success", title: "CSV export ready", detail: "biome-ocr-results.csv" });
  }

  /**
   * The PDF now follows the same plan as the Excel export: a contents
   * page, then one section per document type, then whatever could not be
   * read. A mixed batch of a hundred files comes back sorted rather than
   * as one flat table nobody can use.
   */
  async function exportPdf() {
    setExportingPdf(true);
    try {
      const docs = summaries();
      const { downloadClassifiedPdf } = await import("@/lib/ocrExport");
      const plan = await downloadClassifiedPdf(docs as any, "biome-documents-sorted.pdf");
      notify({
        kind: "success",
        title: "PDF report ready",
        detail:
          `${plan.sheets.length} document type${plan.sheets.length === 1 ? "" : "s"} across ${docs.length} file${docs.length === 1 ? "" : "s"}` +
          (plan.unreadable.length ? ` · ${plan.unreadable.length} could not be read` : ""),
      });
    } catch (err) {
      notify({ kind: "error", title: "Export failed", detail: (err as Error).message });
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pt-6">
      <GlassCard activeBorder className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-biome-leaf/12 p-3">
            <ScanLine size={24} className="text-biome-leafBright" />
          </div>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold text-biome-text md:text-2xl">
              OCR Scanner
              <span className="flex items-center gap-1 rounded-full bg-biome-leaf/12 px-2.5 py-1 text-xs font-medium text-biome-leafBright">
                <Sparkles size={12} /> AI-Powered Reading
              </span>
              <Link href="/ocr/sheets"
                className="bmx-chip flex items-center gap-1 rounded-full border border-biome-leaf/30 bg-biome-leaf/[.06] px-2.5 py-1 text-xs font-semibold text-biome-leaf transition-colors hover:bg-biome-leaf/12">
                <Table2 size={12} /> Smart Sheets — batch to Excel
              </Link>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-biome-muted">
              Upload any document or photo — invoices, receipts, ID cards, certificates, forms,
              or scanned ledger pages — image or PDF. Every document is read by a vision-capable
              AI first, which actually understands context (stamps, rotated text, poor scans,
              mixed Hindi/English) far better than pattern-matching OCR, and pulls out whatever
              fields that specific document actually contains rather than assuming it&apos;s an
              invoice. If AI reading isn&apos;t available, it automatically falls back to an
              offline multi-pass OCR engine. No reading system is ever perfectly error-free, so
              every field carries its own confidence score — please check anything flagged before
              it goes into your books. Every export — Excel or PDF — is laid out and coloured
              automatically to fit whatever was found, whether that&apos;s a single document, a
              table, or a mixed batch of both.
            </p>
          </div>
        </div>
      </GlassCard>

      {banner && (
        <div className="flex items-start gap-2 rounded-xl border border-biome-bolt/30 bg-biome-bolt/10 px-4 py-3 text-sm text-biome-bolt">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p className="flex-1">{banner}</p>
          <button onClick={() => setBanner(null)} className="shrink-0 text-biome-bolt/70 hover:text-biome-bolt">
            <X size={15} />
          </button>
        </div>
      )}

      <GlassCard delay={0.05} className="p-5">
        <MultiDropzone onFiles={addFiles} />

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-biome-line pt-4">
          <label className="flex items-center gap-2 text-xs text-biome-muted">
            <Settings2 size={14} />
            Offline OCR language (fallback only)
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as OcrLanguage)}
              className="rounded-lg border border-biome-line bg-biome-hover px-2 py-1 text-xs text-biome-text outline-none focus:border-biome-leaf"
            >
              <option value="eng" className="bg-biome-bgSoft">
                English
              </option>
              <option value="eng+hin" className="bg-biome-bgSoft">
                English + Hindi
              </option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-biome-muted">
            <Sparkles size={14} />
            Processing mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "best" | "offline")}
              className="rounded-lg border border-biome-line bg-biome-hover px-2 py-1 text-xs text-biome-text outline-none focus:border-biome-leaf"
            >
              <option value="best" className="bg-biome-bgSoft">Best accuracy (AI + offline fallback)</option>
              <option value="offline" className="bg-biome-bgSoft">Offline only (no cloud reading)</option>
            </select>
          </label>
          <p className="text-[11px] text-biome-muted/70">
            {mode === "offline"
              ? "Offline-only mode: documents stay on this machine and use the multi-pass local OCR engine."
              : aiAvailable === false
                ? "AI is unavailable, so the scanner is using the local multi-pass OCR engine."
                : "Best-accuracy mode tries vision AI first and automatically falls back to local OCR."}
          </p>
        </div>
      </GlassCard>

      {docs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]"
        >
          <GlassCard delay={0.05} className="max-h-[600px] overflow-auto p-3">
            <DocumentQueue
              docs={docs}
              activeId={activeId}
              onSelect={setActiveId}
              onRemove={removeDoc}
            />
          </GlassCard>

          <GlassCard delay={0.1} className="p-5 md:p-6">
            <DocumentDetail doc={activeDoc} onFieldChange={updateField} />
          </GlassCard>
        </motion.div>
      )}

      {doneDocs.length > 0 && (
        <GlassCard delay={0.1} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-xs text-biome-muted">
            {doneDocs.length} document{doneDocs.length === 1 ? "" : "s"} processed — export the
            batch below.
          </p>
          <div className="flex items-center gap-2">
            <PremiumButton onClick={exportCsv} variant="ghost">
              <Download size={14} /> CSV
            </PremiumButton>
            {/* The primary export: sorted by document type, one sheet each.
                The old flat "Excel Report" is kept as a secondary because a
                single-type batch reads fine that way. */}
            <PremiumButton onClick={exportClassifiedExcel} disabled={exportingExcel} variant="primary">
              <FileSpreadsheet size={14} /> {exportingExcel ? "Sorting…" : "Excel — sorted by type"}
            </PremiumButton>
            <PremiumButton onClick={exportExcel} disabled={exportingExcel} variant="ghost">
              <FileSpreadsheet size={14} /> Flat sheet
            </PremiumButton>
            <PremiumButton onClick={exportPdf} disabled={exportingPdf} variant="secondary">
              <FileText size={14} /> {exportingPdf ? "Building PDF…" : "PDF Report"}
            </PremiumButton>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
