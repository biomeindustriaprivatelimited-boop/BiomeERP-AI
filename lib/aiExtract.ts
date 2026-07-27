/** A single labelled key/value pair as read off the document itself —
 *  the label comes from the document, not from a fixed invoice-shaped
 *  schema, so it works for any document type (invoice, certificate, ID
 *  card, form, letter, etc). */
export interface AiField {
  label: string;
  value: string | null;
  confidence: number;
}

export interface LabReportMetadata {
  date: string | null;
  testReportNo: string | null;
  vendorName: string | null;
  poNo: string | null;
  materialSupplied: string | null;
  sampleDrawnBy: string | null;
}

export interface LabReportSignatory {
  name: string | null;
  designation: string | null;
}

/** Structured data for coal/combustion-lab-style test reports (e.g. NTPC
 *  Coal and Combustion Laboratory reports): letterhead + metadata grid +
 *  results table + remarks/signatories, as opposed to a generic table. */
export interface LabReportData {
  organizationName: string | null;
  department: string | null;
  address: string | null;
  metadata: LabReportMetadata;
  table: { headers: string[]; rows: Record<string, any>[] } | null;
  remarks: string[];
  signatories: LabReportSignatory[];
}

export interface AiExtractionResult {
  documentType: "document" | "lab_report" | "ledger_table" | "other";
  transcription: string;
  /** Whatever labelled fields this specific document actually contains —
   *  no fixed invoice-shaped schema, so an ID card, certificate, letter,
   *  or invoice each come back with only the fields that genuinely
   *  exist on them. */
  fields: AiField[];
  table: { headers: string[]; rows: Record<string, any>[] } | null;
  labReport: LabReportData | null;
}

export class AiExtractionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Sends one or more page images (data URLs) of a single document to the
 *  server-side /api/extract-document route, which forwards them to
 *  Claude's vision API for context-aware reading. */
export async function extractDocumentWithAI(images: string[]): Promise<AiExtractionResult> {
  const res = await fetch("/api/extract-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new AiExtractionError(data.error || `Request failed (${res.status})`, data.code);
  }

  return data.result as AiExtractionResult;
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
