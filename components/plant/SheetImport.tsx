"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload, X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

/**
 * Import previous data into this plant's biomass / transport sheet.
 *
 *   1. Download the template (this plant's columns and registered list).
 *   2. Upload → every row is checked on the server and shown here.
 *   3. "Import valid rows" adds only the rows without errors, to THIS
 *      plant's sheet; "Cancel" leaves the sheet untouched.
 */

interface Check {
  rowNumber: number;
  label: string;
  verdict: "ok" | "error";
  errors: string[];
  warnings: string[];
  values?: Record<string, any>;
}

interface Preview {
  plant: string;
  plantName: string;
  kind: "biomass" | "transport";
  fileName: string;
  sheet: string;
  ignoredColumns: string[];
  exampleRowsSkipped: number;
  summary: { total: number; ok: number; errors: number; warnings: number };
  checks: Check[];
}

export default function SheetImport({
  kind, plant, plantName, freezeDays, beforeImport, onImported, onClose,
}: {
  kind: "biomass" | "transport";
  plant: string;
  plantName: string;
  freezeDays: number;
  /** Save what is on screen first, so a pending edit is not overwritten. */
  beforeImport: () => Promise<void>;
  onImported: (rows: Record<string, any>[]) => void;
  onClose: () => void;
}) {
  const { notify } = useNotifications();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "import">("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"all" | "error" | "ok">("all");
  const label = kind === "transport" ? "transport" : "biomass";

  async function check(f: File) {
    setBusy("check");
    setError("");
    setPreview(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("kind", kind);
      fd.set("plant", plant);
      const res = await fetch("/api/plant-data/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Check failed (${res.status}).`);
      setPreview(json);
      setShow(json.summary.errors ? "error" : "all");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    if (!preview) return;
    const valid = preview.checks.filter((c) => c.verdict === "ok" && c.values);
    if (!valid.length) return;
    setBusy("import");
    setError("");
    try {
      await beforeImport();
      const res = await fetch("/api/plant-data/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, plant: preview.plant, fileName: preview.fileName,
          rows: valid.map((c) => ({ rowNumber: c.rowNumber, values: c.values })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Import failed (${res.status}).`);
      onImported(json.rows || []);
      notify({
        kind: json.imported ? "success" : "warning",
        title: `${json.imported} row${json.imported === 1 ? "" : "s"} imported into ${preview.plantName}`,
        detail: json.skipped?.length
          ? `${json.skipped.length} skipped — the sheet changed since the check (e.g. ${json.skipped[0].why}).`
          : `Imported as Submitted — editable for ${freezeDays} days, then frozen.`,
      });
      setPreview(null);
      setFile(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const rows = preview ? preview.checks.filter((c) => show === "all" || c.verdict === show) : [];

  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-biome-text">
            <FileSpreadsheet size={14} className="text-biome-leaf" /> Import previous {label} data — {plantName}
          </p>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-biome-muted">
            Download the template, fill one row per consignment (dates DD-MM-YYYY, weights in kg), and upload it.
            Every row is checked first — required fields, dates, numbers, the {kind === "transport" ? "transporter" : "vendor"} against
            this plant&apos;s registered list, and duplicates. Nothing is saved until you press Import. Rows go into{" "}
            <span className="font-semibold text-biome-text">{plantName}</span> only, as Submitted (they freeze after {freezeDays} days).
          </p>
        </div>
        <button onClick={onClose} title="Close" className="rounded-lg p-1 text-biome-muted hover:bg-biome-hover hover:text-biome-text">
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/api/plant-data/import/template?kind=${kind}&plant=${encodeURIComponent(plant)}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-biome-leaf/35 bg-biome-leaf/10 px-3 py-1.5 text-[11.5px] font-medium text-biome-leafBright hover:bg-biome-leaf/15"
        >
          <Download size={13} /> Download template
        </a>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-biome-line px-3 py-1.5 text-[11.5px] text-biome-text hover:border-biome-leaf/40">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              e.target.value = "";
              setFile(f);
              if (f) check(f);
            }}
          />
          {busy === "check" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {file ? file.name : "Choose filled file…"}
        </label>
        {file && !busy && (
          <button onClick={() => check(file)} className="text-[11px] text-biome-leaf hover:underline">Check again</button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/[.07] px-3 py-2 text-[11px] text-rose-500">{error}</p>
      )}

      {preview && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-biome-muted">
              Sheet <span className="font-medium text-biome-text">{preview.sheet}</span> · {preview.summary.total} row{preview.summary.total === 1 ? "" : "s"}
              {preview.exampleRowsSkipped ? ` · example row skipped` : ""}
            </span>
            {(["all", "ok", "error"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setShow(k)}
                className={`rounded-full border px-2.5 py-0.5 font-medium ${
                  show === k ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leafBright" : "border-biome-line text-biome-muted hover:text-biome-text"
                }`}
              >
                {k === "all" ? `All ${preview.summary.total}` : k === "ok" ? `✓ ${preview.summary.ok} valid` : `✗ ${preview.summary.errors} with errors`}
              </button>
            ))}
            {preview.summary.warnings > 0 && <span className="text-amber-600">⚠ {preview.summary.warnings} with warnings</span>}
          </div>
          {preview.ignoredColumns.length > 0 && (
            <p className="mt-1.5 text-[10.5px] text-biome-muted">Ignored columns (not in this sheet): {preview.ignoredColumns.join(", ")}</p>
          )}

          <div className="mt-2 max-h-[340px] overflow-auto rounded-xl border border-biome-line">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-biome-surface">
                <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted">
                  <th className="px-2 py-2">Excel row</th>
                  <th className="px-2 py-2">Consignment</th>
                  <th className="px-2 py-2">Result</th>
                  <th className="px-2 py-2">Problems</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.rowNumber} className={`border-b border-biome-line/40 align-top ${c.verdict === "error" ? "bg-rose-500/[.04]" : ""}`}>
                    <td className="px-2 py-1.5 font-mono text-biome-muted">{c.rowNumber}</td>
                    <td className="px-2 py-1.5 text-biome-text">{c.label}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {c.verdict === "ok" ? (
                        c.warnings.length ? (
                          <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle size={12} /> Valid, check</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> Valid</span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-500"><XCircle size={12} /> Not imported</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.errors.map((e, i) => <p key={`e${i}`} className="text-rose-500">✗ {e}</p>)}
                      {c.warnings.map((w, i) => <p key={`w${i}`} className="text-amber-600">⚠ {w}</p>)}
                      {!c.errors.length && !c.warnings.length && <span className="text-biome-muted">—</span>}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-biome-muted">Nothing in this view.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PremiumButton onClick={commit} disabled={!preview.summary.ok || !!busy}>
              {busy === "import" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Import {preview.summary.ok} valid row{preview.summary.ok === 1 ? "" : "s"}
            </PremiumButton>
            <PremiumButton variant="ghost" onClick={() => { setPreview(null); setFile(null); onClose(); }} disabled={!!busy}>
              Cancel
            </PremiumButton>
            {preview.summary.errors > 0 && (
              <span className="text-[10.5px] text-biome-muted">
                {preview.summary.errors} row{preview.summary.errors === 1 ? "" : "s"} with errors will be left out — correct them in the file and import again later.
              </span>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
