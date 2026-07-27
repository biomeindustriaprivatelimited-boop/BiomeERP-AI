import type { ExtractedField, OcrResult } from "@/lib/ocr";
import type { PdfTable } from "@/lib/pdf";
import type { LabReportData } from "@/lib/aiExtract";

export type DocStatus = "queued" | "processing" | "done" | "error";
export type Engine = "ai" | "tesseract";

export interface QueuedDoc {
  id: string;
  file: File;
  isPdf: boolean;
  previewUrl: string | null;
  status: DocStatus;
  error?: string;
  result?: OcrResult;
  fields?: Record<string, ExtractedField>;
  table?: PdfTable | null;
  /** Populated when the AI classifies this document as a structured lab
   *  report (e.g. NTPC Coal and Combustion Laboratory report) — header,
   *  metadata grid, results table, and footer/signatories. */
  labReport?: LabReportData | null;
  progressLabel?: string;
  engine?: Engine;
}
