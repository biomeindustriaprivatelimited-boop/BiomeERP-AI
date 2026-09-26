"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Table2,
  Sparkles,
  ScanLine,
  FlaskConical,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import type { QueuedDoc } from "./types";
import { tableCell } from "@/lib/ocr";
import { downloadLabReportPdf, downloadLabReportExcel } from "@/lib/labReport";

export default function DocumentDetail({
  doc,
  onFieldChange,
}: {
  doc: QueuedDoc | null;
  onFieldChange: (docId: string, key: string, value: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [exportingLabPdf, setExportingLabPdf] = useState(false);

  if (!doc) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-biome-muted">
        Select a document to see its extracted details.
      </div>
    );
  }

  if (doc.status === "processing" || doc.status === "queued") {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-biome-muted">
        <Loader2 size={22} className="animate-spin text-biome-skyBright" />
        {doc.status === "processing" ? (
          <>
            <span>Reading document…</span>
            {doc.progressLabel && (
              <span className="text-xs text-biome-muted/70">{doc.progressLabel}</span>
            )}
          </>
        ) : (
          "Waiting in queue…"
        )}
      </div>
    );
  }

  if (doc.status === "error") {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-sm text-biome-bolt">
        <AlertTriangle size={22} />
        {doc.error || "Something went wrong reading this document."}
      </div>
    );
  }

  const fields = doc.fields ?? {};
  const lowConf = doc.result?.lowConfidenceWordCount ?? 0;
  const passesRun = doc.result?.passesRun;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row">
        {doc.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.previewUrl}
            alt={doc.file.name}
            className="h-40 w-full rounded-xl border border-biome-line object-cover sm:w-40"
          />
        )}
        <div className="flex-1 space-y-1">
          <p className="flex items-center gap-2 font-display text-sm font-medium text-biome-text">
            {doc.file.name}
            {doc.engine === "ai" ? (
              <span className="flex items-center gap-1 rounded-full bg-biome-leaf/12 px-2 py-0.5 text-[10px] font-medium text-biome-leafBright">
                <Sparkles size={10} /> AI-read
              </span>
            ) : doc.engine === "tesseract" ? (
              <span className="flex items-center gap-1 rounded-full bg-biome-hover px-2 py-0.5 text-[10px] font-medium text-biome-muted">
                <ScanLine size={10} /> Offline OCR
              </span>
            ) : null}
          </p>
          <p className="text-xs text-biome-muted">
            {doc.engine === "ai" ? "AI confidence (self-assessed)" : "Overall OCR confidence"}:{" "}
            <span className="text-biome-leafBright">{doc.result?.confidence.toFixed(1)}%</span>
            {passesRun ? (
              <span className="text-biome-muted"> · best of {passesRun} passes</span>
            ) : null}
          </p>
          {lowConf > 0 && (
            <p className="flex items-center gap-1 text-xs text-biome-bolt">
              <AlertTriangle size={12} /> {lowConf} low-confidence word{lowConf === 1 ? "" : "s"} —
              worth a quick check
            </p>
          )}
        </div>
      </div>

      {doc.labReport && (
        <div className="rounded-xl border border-biome-leaf/25 bg-biome-leaf/[0.06] p-3.5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-biome-leafBright">
              <FlaskConical size={13} /> Lab / test report detected — structured extract below
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setExportingLabPdf(true);
                  try {
                    const base = doc.file.name.replace(/\.[^.]+$/, "");
                    await downloadLabReportPdf(doc.labReport!, `${base} - Lab Report.pdf`);
                  } finally {
                    setExportingLabPdf(false);
                  }
                }}
                disabled={exportingLabPdf}
                className="flex items-center gap-1.5 rounded-lg border border-biome-sky/30 bg-biome-sky/10 px-2.5 py-1.5 text-[11px] font-medium text-biome-skyBright transition-colors hover:bg-biome-sky/20 disabled:opacity-50"
              >
                <FileText size={12} /> {exportingLabPdf ? "Building…" : "PDF"}
              </button>
              <button
                onClick={() => {
                  const base = doc.file.name.replace(/\.[^.]+$/, "");
                  downloadLabReportExcel(doc.labReport!, `${base} - Lab Report.xlsx`);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-biome-leaf/30 bg-biome-leaf/10 px-2.5 py-1.5 text-[11px] font-medium text-biome-leafBright transition-colors hover:bg-biome-leaf/20"
              >
                <FileSpreadsheet size={12} /> Excel
              </button>
            </div>
          </div>

          <div className="mb-3 space-y-0.5">
            <p className="font-display text-sm font-semibold text-biome-text">
              {doc.labReport.organizationName || "—"}
            </p>
            <p className="text-xs text-biome-muted">{doc.labReport.department || "—"}</p>
            <p className="text-xs text-biome-muted">{doc.labReport.address || "—"}</p>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-biome-line/50 bg-black/10 p-2.5 sm:grid-cols-2">
            {[
              ["Date", doc.labReport.metadata?.date],
              ["Test Report No", doc.labReport.metadata?.testReportNo],
              ["Vendor Name", doc.labReport.metadata?.vendorName],
              ["PO No", doc.labReport.metadata?.poNo],
              ["Material Supplied", doc.labReport.metadata?.materialSupplied],
              ["Sample Drawn by Lab", doc.labReport.metadata?.sampleDrawnBy],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 text-[11px]">
                <span className="text-biome-muted">{label}</span>
                <span className="text-biome-text">{value || "—"}</span>
              </div>
            ))}
          </div>

          {doc.labReport.table && doc.labReport.table.headers.length > 0 && (
            <div className="mb-3 max-h-40 overflow-auto rounded-lg border border-biome-line/60">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-biome-hover text-biome-muted">
                  <tr>
                    {doc.labReport.table.headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.labReport.table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-biome-line/40">
                      {doc.labReport!.table!.headers.map((h, hi) => (
                        <td key={h} className="whitespace-nowrap px-2 py-1.5 text-biome-text">
                          {tableCell(row, h, hi)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {doc.labReport.remarks?.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-biome-muted">
                Remarks
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-[11px] text-biome-text">
                {doc.labReport.remarks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {doc.labReport.signatories?.length > 0 && (
            <div className="flex flex-wrap gap-4 border-t border-biome-line/40 pt-2">
              {doc.labReport.signatories.map((s, i) => (
                <div key={i} className="text-[11px]">
                  <p className="font-medium text-biome-text">{s.name || "—"}</p>
                  <p className="text-biome-muted">{s.designation || "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {doc.table && (
        <div className="rounded-xl border border-biome-sky/25 bg-biome-sky/[0.06] p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-biome-skyBright">
              <Table2 size={13} /> This looks like a table / ledger page, not a single document
            </p>
          </div>
          <div className="max-h-40 overflow-auto rounded-lg border border-biome-line/60">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-biome-hover text-biome-muted">
                <tr>
                  {doc.table.headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.table.rows.slice(0, 6).map((row, i) => (
                  <tr key={i} className="border-t border-biome-line/40">
                    {doc.table!.headers.map((h, hi) => (
                      <td key={h} className="whitespace-nowrap px-2 py-1.5 text-biome-text">
                        {tableCell(row, h, hi)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {doc.table.rows.length > 6 && (
            <p className="mt-1.5 text-[10px] text-biome-muted">
              +{doc.table.rows.length - 6} more rows — export CSV to see all of them.
            </p>
          )}
        </div>
      )}

      {!doc.labReport && (
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-biome-muted">
          Extracted fields
        </p>
        {Object.keys(fields).length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {Object.entries(fields).map(([key, field]) => (
              <div key={key}>
                <label className="mb-1 flex items-center justify-between text-[11px] text-biome-muted">
                  <span>{field.label}</span>
                  <ConfidenceBadge value={field.confidence} />
                </label>
                <input
                  value={field.value}
                  onChange={(e) => onFieldChange(doc.id, key, e.target.value)}
                  className="w-full rounded-lg border border-biome-line bg-biome-hover px-2.5 py-1.5 text-xs text-biome-text outline-none placeholder:text-biome-muted/50 focus:border-biome-leaf"
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-biome-muted">
            No labelled fields detected on this document — see the raw text below.
          </p>
        )}
      </div>
      )}

      <div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="flex items-center gap-1 text-xs text-biome-muted transition-colors hover:text-biome-text"
        >
          {showRaw ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showRaw ? "Hide" : "Show"} raw {doc.engine === "ai" ? "transcription" : "OCR text"}
        </button>
        {showRaw && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-biome-line bg-black/20 p-3 text-[11px] leading-relaxed text-biome-muted">
            {doc.result?.text || "—"}
          </pre>
        )}
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const color =
    value >= 80
      ? "bg-biome-leaf/15 text-biome-leafBright"
      : value >= 60
      ? "bg-biome-bolt/15 text-biome-bolt"
      : "bg-red-500/15 text-red-400";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${color}`}>
      {value.toFixed(0)}%
    </span>
  );
}
