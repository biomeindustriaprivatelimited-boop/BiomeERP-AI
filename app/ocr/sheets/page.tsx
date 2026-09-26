"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Table2, Upload, Loader2, X, Play, FileSpreadsheet, FileText, Download,
  AlertCircle, ArrowLeft, Plus, Trash2, Info, CheckCircle2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { runOcrThorough, type OcrLanguage, type OcrResult } from "@/lib/ocr";
import {
  SHEET_PRESETS, SHEET_MAX_FILES, SHEET_MAX_COLUMNS,
  fillRow, sheetToCsv, downloadSheetExcel, downloadSheetPdf, triggerDownload,
  type SheetColumn, type SheetRow, type SheetPreset,
} from "@/lib/ocrSheets";
import { slugifyLabel } from "@/lib/ocr";
import { useNotifications } from "@/lib/notifications";

/**
 * Smart Sheets.
 *
 * Drop a batch of same-shaped documents — 50 receivings, 100 lab reports,
 * a month of sales invoices — choose (or build) the columns, press run,
 * and get one clean table with every cell editable and every doubtful
 * cell flagged. Export lands as Excel, CSV or PDF.
 *
 * Fully offline: the OCR engine runs in this window. The honest trade is
 * printed above the run button — clean print reads well, faint carbon and
 * handwriting will need the flagged cells checked by a person.
 */

type Stage = "setup" | "running" | "done";

interface QueuedFile {
  file: File;
  name: string;
  status: "waiting" | "reading" | "done" | "failed";
}

export default function SmartSheetsPage() {
  const { notify } = useNotifications();
  const [preset, setPreset] = useState<SheetPreset>(SHEET_PRESETS[0]);
  const [columns, setColumns] = useState<SheetColumn[]>(SHEET_PRESETS[0].columns);
  const [customising, setCustomising] = useState(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [lang, setLang] = useState<OcrLanguage>("eng");
  const [stage, setStage] = useState<Stage>("setup");
  const [progress, setProgress] = useState({ index: 0, note: "" });
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const flagged = useMemo(
    () => rows.reduce((n, r) => n + columns.filter((c) => !r.cells[c.id]?.value || r.cells[c.id].confidence < 65).length, 0),
    [rows, columns]
  );

  function choosePreset(p: SheetPreset) {
    setPreset(p);
    setColumns(p.columns);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = Array.from(list).filter((f) => /image\/|pdf$/.test(f.type) || /\.(png|jpe?g|webp|pdf)$/i.test(f.name));
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of accepted) {
        if (merged.length >= SHEET_MAX_FILES) break;
        if (!merged.some((m) => m.name === f.name && m.file.size === f.size)) {
          merged.push({ file: f, name: f.name, status: "waiting" });
        }
      }
      return merged;
    });
  }

  async function run() {
    setStage("running");
    setError(null);
    setRows([]);
    cancelled.current = false;

    const out: SheetRow[] = [];
    for (let i = 0; i < files.length; i++) {
      if (cancelled.current) break;
      const qf = files[i];
      setProgress({ index: i, note: qf.name });
      setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "reading" } : f)));
      try {
        let sources: (File | Blob | string)[] = [qf.file];
        if (/\.pdf$/i.test(qf.name) || qf.file.type === "application/pdf") {
          const { renderPdfPagesToImages } = await import("@/lib/pdf");
          sources = await renderPdfPagesToImages(qf.file);
        }
        // One document = one row. Multi-page PDFs are read page by page
        // and the pages' text is merged before the columns are filled.
        let merged: OcrResult | null = null;
        for (const src of sources) {
          const res = await runOcrThorough(src, lang, (p) =>
            setProgress({ index: i, note: `${qf.name} — ${p.label} (${p.pass}/${p.totalPasses})` })
          );
          if (merged === null) {
            merged = res;
          } else {
            const prevText: string = merged.text;
            const prevConf: number = merged.confidence;
            merged = { ...res, text: `${prevText}\n${res.text}`, confidence: Math.min(prevConf, res.confidence) };
          }
        }
        if (merged) out.push(fillRow(columns, merged, qf.name));
        setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "done" } : f)));
      } catch {
        setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "failed" } : f)));
        out.push({
          fileName: qf.name,
          cells: Object.fromEntries(columns.map((c) => [c.id, { value: "", confidence: 0 }])),
          pageConfidence: 0,
        });
      }
      setRows([...out]);
    }
    setStage("done");
    notify({
      kind: "success",
      title: "Smart Sheet ready",
      detail: `${out.length} document${out.length === 1 ? "" : "s"} extracted. ${flaggedText(out, columns)}`,
    });
  }

  function edit(rowIdx: number, colId: string, value: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx ? { ...r, cells: { ...r.cells, [colId]: { value, confidence: 100 } } } : r
      )
    );
  }

  const ready = files.length > 0 && columns.length > 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/ocr" className="mb-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-biome-muted hover:text-biome-text">
            <ArrowLeft size={11} /> AI OCR Scanner
          </Link>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Table2 size={19} className="text-biome-leaf" /> Smart Sheets
          </h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
            A batch of same-shaped documents in, one clean spreadsheet out — up to {SHEET_MAX_FILES} files,
            up to {SHEET_MAX_COLUMNS} columns, fully offline.
          </p>
        </div>
        {stage === "done" && rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => downloadSheetExcel(columns, rows, `smart-sheet-${preset.id}.xlsx`)}
              className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button onClick={() => triggerDownload(new Blob([sheetToCsv(columns, rows)], { type: "text/csv" }), `smart-sheet-${preset.id}.csv`)}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
              <Download size={13} /> CSV
            </button>
            <button onClick={() => downloadSheetPdf(columns, rows, `smart-sheet-${preset.id}.pdf`, preset.label)}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
              <FileText size={13} /> PDF
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {stage === "setup" && (
        <>
          {/* ---- 1. Columns ---- */}
          <GlassCard className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-biome-muted">1 · What are these documents?</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {SHEET_PRESETS.map((p) => (
                <button key={p.id} onClick={() => { choosePreset(p); setCustomising(false); }}
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    preset.id === p.id && !customising
                      ? "border-biome-leaf/50 bg-biome-leaf/[.08]"
                      : "border-biome-line hover:border-biome-leaf/25"
                  }`}>
                  <p className="text-[12px] font-bold text-biome-text">{p.label}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-biome-muted">{p.help}</p>
                </button>
              ))}
            </div>
            <button onClick={() => setCustomising((v) => !v)}
              className="bmx-chip mt-3 flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[10.5px] font-semibold text-biome-muted">
              <Plus size={12} /> {customising ? "Hide column editor" : "Edit columns / build my own"}
            </button>

            {customising && (
              <div className="mt-3 space-y-2 rounded-2xl border border-biome-line bg-biome-bg p-3">
                {columns.map((c, i) => (
                  <div key={c.id + i} className="flex flex-wrap items-center gap-2">
                    <input value={c.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setColumns((prev) => prev.map((x, j) => j === i
                          ? { ...x, label, id: slugifyLabel(label) || x.id, hints: [label.toLowerCase(), ...x.hints] }
                          : x));
                      }}
                      className="bmx-input w-44 rounded-lg border border-biome-line bg-biome-bgSoft px-2.5 py-1.5 text-[11px] text-biome-text outline-none" />
                    <select value={c.type}
                      onChange={(e) => setColumns((prev) => prev.map((x, j) => j === i ? { ...x, type: e.target.value as SheetColumn["type"] } : x))}
                      className="rounded-lg border border-biome-line bg-biome-bgSoft px-2 py-1.5 text-[10.5px] text-biome-text outline-none">
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="amount">Amount ₹</option>
                      <option value="date">Date</option>
                      <option value="gstin">GSTIN</option>
                      <option value="vehicle">Vehicle no</option>
                    </select>
                    <button onClick={() => setColumns((prev) => prev.filter((_, j) => j !== i))}
                      className="bmx-chip rounded-lg border border-biome-line p-1.5 text-rose-500">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {columns.length < SHEET_MAX_COLUMNS && (
                  <button onClick={() => setColumns((prev) => [...prev, col(`Column ${prev.length + 1}`)])}
                    className="bmx-chip flex items-center gap-1 rounded-lg border border-dashed border-biome-line px-3 py-1.5 text-[10.5px] font-semibold text-biome-muted">
                    <Plus size={11} /> Add a column
                  </button>
                )}
              </div>
            )}
          </GlassCard>

          {/* ---- 2. Files ---- */}
          <GlassCard className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-biome-muted">2 · The documents</p>
            <button onClick={() => inputRef.current?.click()}
              className="mt-3 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-biome-line px-4 py-9 text-biome-muted transition-colors hover:border-biome-leaf/40 hover:text-biome-text"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <Upload size={22} />
              <span className="text-[12px] font-semibold">Drop images or PDFs — or click to choose</span>
              <span className="text-[10px]">{files.length}/{SHEET_MAX_FILES} queued · JPG, PNG, WEBP, PDF</span>
            </button>
            <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={f.name + i} className="flex items-center gap-1.5 rounded-full border border-biome-line bg-biome-bg px-2.5 py-1 text-[10px] text-biome-muted">
                    {f.name}
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-rose-500"><X size={10} /></button>
                  </span>
                ))}
                <button onClick={() => setFiles([])} className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-rose-500">
                  Clear all
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[10.5px] font-semibold text-biome-muted">
                Language
                <select value={lang} onChange={(e) => setLang(e.target.value as OcrLanguage)}
                  className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text outline-none">
                  <option value="eng">English</option>
                  <option value="eng+hin">English + Hindi</option>
                </select>
              </label>
              <button onClick={run} disabled={!ready}
                className="bmx-btn ml-auto flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                <Play size={13} /> Read {files.length || ""} document{files.length === 1 ? "" : "s"}
              </button>
            </div>

            <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[10px] leading-relaxed text-biome-muted">
              <Info size={11} className="mt-px shrink-0" />
              Runs entirely on this computer — no internet needed. Clean printed documents read well;
              faint carbon copies and handwriting will not, and every doubtful cell is flagged in the
              grid and shaded in the export so a person checks those instead of everything.
            </p>
          </GlassCard>
        </>
      )}

      {stage === "running" && (
        <GlassCard className="p-6 text-center">
          <Loader2 size={26} className="bmx-spin mx-auto text-biome-leaf" />
          <p className="mt-3 text-[13px] font-bold text-biome-text">
            Reading {progress.index + 1} of {files.length}
          </p>
          <p className="mt-1 truncate text-[11px] text-biome-muted">{progress.note}</p>
          <div className="mx-auto mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-biome-line">
            <div className="h-full rounded-full bg-biome-leaf transition-all duration-500"
              style={{ width: `${Math.round(((progress.index + 1) / Math.max(1, files.length)) * 100)}%` }} />
          </div>
          <button onClick={() => { cancelled.current = true; }}
            className="bmx-chip mx-auto mt-5 rounded-xl border border-biome-line px-4 py-2 text-[11px] font-semibold text-biome-muted">
            Stop after this one
          </button>
          {rows.length > 0 && <ResultGrid columns={columns} rows={rows} onEdit={edit} compact />}
        </GlassCard>
      )}

      {stage === "done" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10.5px] font-bold text-emerald-600">
              <CheckCircle2 size={12} /> {rows.length} row{rows.length === 1 ? "" : "s"} extracted
            </span>
            {flagged > 0 && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10.5px] font-bold text-amber-600">
                {flagged} cell{flagged === 1 ? "" : "s"} to check — shaded below, editable in place
              </span>
            )}
            <button onClick={() => { setStage("setup"); setRows([]); setFiles([]); }}
              className="bmx-chip ml-auto rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted">
              New batch
            </button>
          </div>
          <ResultGrid columns={columns} rows={rows} onEdit={edit} />
        </>
      )}
    </div>
  );

  function col(label: string): SheetColumn {
    return { id: slugifyLabel(label), label, type: "text", hints: [label.toLowerCase()] };
  }
}

function flaggedText(rows: SheetRow[], columns: SheetColumn[]) {
  const n = rows.reduce((s, r) => s + columns.filter((c) => !r.cells[c.id]?.value || r.cells[c.id].confidence < 65).length, 0);
  return n ? `${n} cells flagged for checking.` : "Nothing flagged.";
}

function ResultGrid({
  columns, rows, onEdit, compact,
}: { columns: SheetColumn[]; rows: SheetRow[]; onEdit: (row: number, col: string, v: string) => void; compact?: boolean }) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-biome-line ${compact ? "mt-5 max-h-64 overflow-y-auto" : ""}`}>
      <table className="w-full min-w-max border-collapse text-left">
        <thead className="sticky top-0 bg-biome-bgSoft">
          <tr>
            <th className="border-b border-biome-line px-3 py-2 text-[9.5px] font-bold uppercase tracking-[.1em] text-biome-muted">File</th>
            {columns.map((c) => (
              <th key={c.id} className="border-b border-biome-line px-3 py-2 text-[9.5px] font-bold uppercase tracking-[.1em] text-biome-muted">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.fileName + ri} className="odd:bg-biome-bg/40">
              <td className="max-w-[180px] truncate border-b border-biome-line/60 px-3 py-1.5 text-[10.5px] text-biome-muted">{r.fileName}</td>
              {columns.map((c) => {
                const cell = r.cells[c.id];
                const empty = !cell?.value;
                const low = !empty && cell.confidence < 65;
                return (
                  <td key={c.id} className={`border-b border-biome-line/60 px-1 py-0.5 ${
                    empty ? "bg-rose-500/[.08]" : low ? "bg-amber-500/[.08]" : ""
                  }`}>
                    <input value={cell?.value || ""} onChange={(e) => onEdit(ri, c.id, e.target.value)}
                      placeholder="—"
                      className="w-full min-w-[90px] bg-transparent px-2 py-1 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/40" />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
