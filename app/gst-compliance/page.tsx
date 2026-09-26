"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Upload,
  FileJson,
  Download,
  Search,
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  Scale,
  Loader2,
  X,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";
import {
  parseGstReturn,
  detectReturnKind,
  reconcileGstWithBooks,
  gstRowsToExportTable,
  gstReconToExportTable,
  type ParsedGstReturn,
  type GstReturnKind,
  type GstReconRow,
  type GstMatchStatus,
  type BooksInvoice,
} from "@/lib/gstReturns";
import { autoDetectGstColumns, reconcileSummaryLevel, type GstColumnMapping, type Gstr3bSummaryRow } from "@/lib/gst";
import { downloadExcelWorkbook, downloadCsv, formatINR, parseFile } from "@/lib/reconciliation";

type Tab = "returns" | "reconcile" | "gstr3b" | "howto";

const STATUS_TONE: Record<GstMatchStatus, string> = {
  Matched: "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright",
  "Tax Amount Mismatch": "border-red-400/30 bg-red-400/10 text-red-300",
  "Taxable Value Mismatch": "border-red-400/30 bg-red-400/10 text-red-300",
  "Date Mismatch": "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  "Only in GST Portal": "border-biome-sky/30 bg-biome-sky/10 text-biome-skyBright",
  "Only in Books": "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  "Probable Match (different invoice no)": "border-biome-sky/30 bg-biome-sky/10 text-biome-skyBright",
};

export default function GstCompliancePage() {
  const { notify } = useNotifications();
  const [tab, setTab] = useState<Tab>("returns");
  const [parsed, setParsed] = useState<ParsedGstReturn | null>(null);
  const [forcedKind, setForcedKind] = useState<GstReturnKind | "auto">("auto");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [recon, setRecon] = useState<{ rows: GstReconRow[]; counts: Record<string, number> } | null>(null);
  const [booksName, setBooksName] = useState<string | null>(null);
  const [gstr3bReturn, setGstr3bReturn] = useState<{ name: string; file: any; mapping: GstColumnMapping } | null>(null);
  const [gstr3bBooks, setGstr3bBooks] = useState<{ name: string; file: any; mapping: GstColumnMapping } | null>(null);
  const [gstr3bRows, setGstr3bRows] = useState<Gstr3bSummaryRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadGstr3bFile(file: File, side: "return" | "books") {
    setBusy(true);
    try {
      const parsedFile = await parseFile(file);
      const mapping = autoDetectGstColumns(parsedFile.headers);
      const entry = { name: file.name, file: parsedFile, mapping };
      if (side === "return") setGstr3bReturn(entry);
      else setGstr3bBooks(entry);
      if (side === "return" && gstr3bBooks) {
        setGstr3bRows(reconcileSummaryLevel(parsedFile, gstr3bBooks.file, mapping, gstr3bBooks.mapping));
      }
      if (side === "books" && gstr3bReturn) {
        setGstr3bRows(reconcileSummaryLevel(gstr3bReturn.file, parsedFile, gstr3bReturn.mapping, mapping));
      }
      notify({ kind: "success", title: "GSTR-3B file loaded", detail: `${parsedFile.rows.length} rows detected and columns mapped automatically.` });
    } catch (err) {
      notify({ kind: "warning", title: "Could not read GSTR-3B file", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function loadReturn(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const result = parseGstReturn(text, forcedKind);
      setParsed(result);
      setRecon(null);
      notify({
        kind: "success",
        title: `${result.summary.kind === "GSTR2A" ? "GSTR-2A" : result.summary.kind === "GSTR2B" ? "GSTR-2B" : "GSTR-1"} loaded`,
        detail: `${result.summary.rowCount} invoice lines for ${result.summary.period ?? "the period"}.`,
      });
      result.summary.warnings.forEach((w) => notify({ kind: "info", title: "Note", detail: w }));
    } catch (err) {
      notify({ kind: "warning", title: "Could not read that file", detail: (err as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * Books side: any CSV/Excel with invoice no, GSTIN, taxable value and tax.
   * Column names are detected loosely so a Tally or billing-software export
   * works without reshaping it first.
   */
  async function loadBooks(file: File) {
    setBusy(true);
    try {
      const { headers, rows } = await parseFile(file);
      const find = (...needles: string[]) =>
        headers.find((h) => {
          const n = h.toLowerCase().replace(/[^a-z0-9]/g, "");
          return needles.some((x) => n.includes(x));
        }) || null;

      const cInv = find("invoiceno", "invno", "billno", "voucherno", "docno");
      const cGstin = find("gstin", "gstno", "gst");
      const cName = find("party", "name", "supplier", "customer", "ledger");
      const cTaxable = find("taxable", "basic", "netamount", "assessable");
      const cTax = find("totaltax", "taxamount", "gstamount", "tax");
      const cDate = find("invoicedate", "date", "billdate");

      if (!cInv || !cTaxable) {
        throw new Error(
          `Need at least an invoice-number column and a taxable-value column. Found: ${headers.join(", ")}`
        );
      }

      const num = (v: any) => {
        const n = Number(String(v ?? "").replace(/[₹,\s]/g, ""));
        return Number.isFinite(n) ? n : 0;
      };

      const books: BooksInvoice[] = rows
        .map((r) => ({
          invoiceNo: cInv ? String(r[cInv] ?? "").trim() || null : null,
          invoiceDate: cDate ? String(r[cDate] ?? "").trim() || null : null,
          counterpartyGstin: cGstin ? String(r[cGstin] ?? "").trim().toUpperCase() || null : null,
          counterpartyName: cName ? String(r[cName] ?? "").trim() || null : null,
          taxableValue: num(cTaxable ? r[cTaxable] : 0),
          totalTax: num(cTax ? r[cTax] : 0),
        }))
        .filter((b) => b.invoiceNo || b.taxableValue);

      if (!parsed) throw new Error("Load a GST return first, then the books file.");

      const result = reconcileGstWithBooks(parsed.rows, books);
      setRecon(result as any);
      setBooksName(file.name);
      setTab("reconcile");
      notify({
        kind: "success",
        title: "Reconciled",
        detail: `${books.length} book entries against ${parsed.rows.length} portal lines.`,
      });
    } catch (err) {
      notify({ kind: "warning", title: "Reconciliation failed", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!parsed) return [];
    const q = query.trim().toLowerCase();
    if (!q) return parsed.rows;
    return parsed.rows.filter((r) =>
      [r.invoiceNo, r.counterpartyGstin, r.counterpartyName, r.section, r.placeOfSupply]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [parsed, query]);

  const s = parsed?.summary;
  const blockedItc = parsed?.rows.filter((r) => r.itcAvailable === false) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="pt-1">
        <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
          <ShieldCheck size={20} className="text-biome-leafBright" />
          GST Compliance
        </h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-biome-muted">
          Load the GSTR-1, GSTR-2A or GSTR-2B JSON straight from the portal, read it invoice by invoice,
          export it to Excel, and match it against your books to see exactly which ITC is at risk.
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-biome-line bg-biome-hover p-1 sm:w-fit">
        {(
          [
            ["returns", "Invoice-wise returns"],
            ["reconcile", `GST vs Books${recon ? ` (${recon.rows.length})` : ""}`],
            ["gstr3b", `GSTR-3B Summary${gstr3bRows ? " ✓" : ""}`],
            ["howto", "How to download"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative rounded-lg px-3.5 py-1.5 text-[11.5px] font-medium transition-colors ${
              tab === key ? "text-biome-leafBright" : "text-biome-muted hover:text-biome-text"
            }`}
          >
            {tab === key && (
              <motion.span
                layoutId="gst-tab"
                className="absolute inset-0 rounded-lg bg-biome-leaf/12"
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      {tab === "howto" ? (
        <HowTo />
      ) : tab === "reconcile" ? (
        <ReconcileView
          recon={recon}
          parsed={parsed}
          booksName={booksName}
          busy={busy}
          onBooks={loadBooks}
        />
      ) : tab === "gstr3b" ? (
        <Gstr3bSummaryView
          busy={busy}
          returnName={gstr3bReturn?.name ?? null}
          booksName={gstr3bBooks?.name ?? null}
          rows={gstr3bRows}
          onReturn={(f) => loadGstr3bFile(f, "return")}
          onBooks={(f) => loadGstr3bFile(f, "books")}
        />
      ) : (
        <>
          {/* Upload */}
          <GlassCard className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileJson size={15} className="text-biome-leafBright" />
                <h2 className="font-display text-sm font-medium text-biome-text">
                  Load a return file
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-biome-muted">Return type</span>
                <select
                  value={forcedKind}
                  onChange={(e) => setForcedKind(e.target.value as any)}
                  className="rounded-lg border border-biome-line bg-biome-hover px-2.5 py-1.5 text-[11px] text-biome-text outline-none focus:border-biome-leaf/40"
                >
                  <option value="auto">Detect automatically</option>
                  <option value="GSTR2A">GSTR-2A (legacy purchases)</option>
                  <option value="GSTR2B">GSTR-2B (static ITC)</option>
                  <option value="GSTR1">GSTR-1 (sales)</option>
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-8 text-center transition-colors hover:border-biome-leaf/40 hover:bg-biome-leaf/[0.04]">
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadReturn(f);
                }}
              />
              {busy ? (
                <Loader2 size={18} className="animate-spin text-biome-leafBright" />
              ) : (
                <Upload size={18} className="text-biome-muted" />
              )}
              <span className="text-[11.5px] text-biome-text">
                {busy ? "Reading…" : "Choose a GSTR-1, GSTR-2A or GSTR-2B JSON file"}
              </span>
              <span className="text-[10.5px] text-biome-muted">
                Everything is read on this computer — the file never leaves your machine
              </span>
            </label>
          </GlassCard>

          {s && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Invoice lines" value={String(s.rowCount)} />
                <Tile label="Counterparties" value={String(s.counterpartyCount)} />
                <Tile label="Taxable value" value={formatINR(s.totalTaxableValue)} />
                <Tile label="Total tax" value={formatINR(s.totalTax)} tone="good" />
              </div>

              <GlassCard className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-biome-muted">
                    <span>
                      <span className="text-biome-muted/60">Return: </span>
                      <span className="font-medium text-biome-text">
                        {s.kind === "GSTR2A" ? "GSTR-2A" : s.kind === "GSTR2B" ? "GSTR-2B" : "GSTR-1"}
                      </span>
                    </span>
                    <span>
                      <span className="text-biome-muted/60">Period: </span>
                      <span className="font-mono text-biome-text">{s.period ?? "—"}</span>
                    </span>
                    <span>
                      <span className="text-biome-muted/60">GSTIN: </span>
                      <span className="font-mono text-biome-text">{s.gstin ?? "—"}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-biome-muted/60">IGST</span>
                      <span className="font-mono text-biome-text">{formatINR(s.totalIgst)}</span>
                      <span className="text-biome-muted/60">CGST</span>
                      <span className="font-mono text-biome-text">{formatINR(s.totalCgst)}</span>
                      <span className="text-biome-muted/60">SGST</span>
                      <span className="font-mono text-biome-text">{formatINR(s.totalSgst)}</span>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <PremiumButton
                      variant="ghost"
                      onClick={() =>
                        downloadCsv(
                          gstRowsToExportTable(parsed!.rows),
                          `${s.kind}-${s.period ?? "export"}-invoice-wise.csv`
                        )
                      }
                    >
                      <Download size={13} /> CSV
                    </PremiumButton>
                    <PremiumButton
                      onClick={() => {
                        // One sheet per section, plus a blocked-ITC sheet —
                        // already sorted the way an accountant works.
                        const sheets: Record<string, Record<string, any>[]> = {
                          "All Invoices": gstRowsToExportTable(parsed!.rows),
                        };
                        for (const sec of Object.keys(s.sections)) {
                          sheets[sec.slice(0, 31)] = gstRowsToExportTable(
                            parsed!.rows.filter((r) => r.section === sec)
                          );
                        }
                        if (blockedItc.length) {
                          sheets["ITC Blocked"] = gstRowsToExportTable(blockedItc);
                        }
                        downloadExcelWorkbook(sheets, `${s.kind}-${s.period ?? "export"}-invoice-wise.xlsx`);
                      }}
                    >
                      <Download size={13} /> Excel
                    </PremiumButton>
                  </div>
                </div>
              </GlassCard>

              {blockedItc.length > 0 && (
                <GlassCard className="border-red-400/25 p-4">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-300" />
                    <div>
                      <p className="text-xs font-medium text-biome-text">
                        {blockedItc.length} invoice{blockedItc.length > 1 ? "s" : ""} with ITC not
                        available
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
                        The portal has marked these as ineligible, so claiming them will create a
                        mismatch. They&apos;re on their own sheet in the Excel export.
                      </p>
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Invoice table */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Invoice no, GSTIN, party…"
                    className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
                  />
                </div>
                <PremiumButton variant="ghost" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> Load books to reconcile
                </PremiumButton>
              </div>

              <GlassCard className="overflow-hidden">
                <div className="max-h-[540px] overflow-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 z-10 bg-biome-surface">
                      <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                        {["Section", "Party", "Doc No", "Date", "Rate", "Taxable", "Tax", "ITC"].map((h) => (
                          <th key={h} className="px-3 py-2.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r, i) => (
                        <tr
                          key={`${r.section}-${r.invoiceNo}-${i}`}
                          className="border-b border-biome-line/40 last:border-0 hover:bg-biome-hover"
                        >
                          <td className="px-3 py-2 text-biome-muted">{r.section}</td>
                          <td className="max-w-[200px] px-3 py-2">
                            <p className="truncate text-biome-text">{r.counterpartyName ?? "—"}</p>
                            <p className="truncate font-mono text-[9.5px] text-biome-muted">
                              {r.counterpartyGstin ?? ""}
                            </p>
                          </td>
                          <td className="px-3 py-2 font-mono text-biome-text">{r.invoiceNo ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-biome-muted">{r.invoiceDate ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-biome-muted">
                            {r.rates.length ? r.rates.join(", ") + "%" : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-biome-text">
                            {formatINR(r.taxableValue)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-biome-text">
                            {formatINR(r.totalTax)}
                          </td>
                          <td className="px-3 py-2">
                            {r.itcAvailable === null ? (
                              <span className="text-biome-muted/50">—</span>
                            ) : r.itcAvailable ? (
                              <CheckCircle2 size={13} className="text-biome-leafBright" />
                            ) : (
                              <span title={r.itcReason ?? "ITC not available"}>
                                <AlertTriangle size={13} className="text-red-300" />
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <GlassCard className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-biome-muted/60">{label}</p>
      <p
        className={`mt-1 font-display text-lg font-semibold tabular-nums ${
          tone === "good" ? "text-biome-leafBright" : "text-biome-text"
        }`}
      >
        {value}
      </p>
    </GlassCard>
  );
}

function ReconcileView({
  recon,
  parsed,
  booksName,
  busy,
  onBooks,
}: {
  recon: { rows: GstReconRow[]; counts: Record<string, number> } | null;
  parsed: ParsedGstReturn | null;
  booksName: string | null;
  busy: boolean;
  onBooks: (f: File) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const rows = useMemo(() => {
    if (!recon) return [];
    return statusFilter === "all" ? recon.rows : recon.rows.filter((r) => r.status === statusFilter);
  }, [recon, statusFilter]);

  if (!parsed) {
    return (
      <GlassCard className="px-6 py-14 text-center">
        <p className="font-display text-sm font-medium text-biome-text">Load a GST return first</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-biome-muted">
          Go to “Invoice-wise returns”, load the GSTR-2B or GSTR-1 JSON, then come back here and add
          your books export to compare them.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Scale size={15} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">
            Compare against your books
          </h2>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-7 text-center transition-colors hover:border-biome-leaf/40 hover:bg-biome-leaf/[0.04]">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.tsv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onBooks(f);
            }}
          />
          {busy ? (
            <Loader2 size={18} className="animate-spin text-biome-leafBright" />
          ) : (
            <Upload size={18} className="text-biome-muted" />
          )}
          <span className="text-[11.5px] text-biome-text">
            {booksName || "Choose your books export (CSV or Excel)"}
          </span>
          <span className="text-[10.5px] text-biome-muted">
            Needs an invoice-number column and a taxable-value column. A GSTIN, party, tax and date
            column each improve the matching.
          </span>
        </label>
      </GlassCard>

      {recon && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={`rounded-full border px-3 py-1 text-[10.5px] transition-colors ${
                statusFilter === "all"
                  ? "border-biome-line bg-biome-hover text-biome-text"
                  : "border-biome-line bg-biome-hover text-biome-muted hover:text-biome-text"
              }`}
            >
              All {recon.rows.length}
            </button>
            {Object.entries(recon.counts).map(([status, count]) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`rounded-full border px-3 py-1 text-[10.5px] transition-colors ${
                  statusFilter === status
                    ? STATUS_TONE[status as GstMatchStatus]
                    : "border-biome-line bg-biome-hover text-biome-muted hover:text-biome-text"
                }`}
              >
                {status} {count}
              </button>
            ))}
            <div className="ml-auto">
              <PremiumButton
                onClick={() => {
                  const sheets: Record<string, Record<string, any>[]> = {
                    "All Differences": gstReconToExportTable(recon.rows),
                  };
                  for (const status of Object.keys(recon.counts)) {
                    sheets[status.slice(0, 31)] = gstReconToExportTable(
                      recon.rows.filter((r) => r.status === status)
                    );
                  }
                  downloadExcelWorkbook(sheets, "gst-vs-books-reconciliation.xlsx");
                }}
              >
                <Download size={13} /> Export by category
              </PremiumButton>
            </div>
          </div>

          <GlassCard className="overflow-hidden">
            <div className="max-h-[540px] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-biome-surface">
                  <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                    {["Status", "Invoice", "Party", "Portal", "Books", "Difference", "What to do"].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.invoiceNo}-${i}`}
                      className="border-b border-biome-line/40 last:border-0 hover:bg-biome-hover"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] ${STATUS_TONE[r.status]}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-biome-text">{r.invoiceNo ?? "—"}</td>
                      <td className="max-w-[170px] px-3 py-2">
                        <p className="truncate text-biome-text">{r.counterpartyName ?? "—"}</p>
                        <p className="truncate font-mono text-[9.5px] text-biome-muted">
                          {r.counterpartyGstin ?? ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-biome-muted">
                        {r.portalTaxableValue === null ? "—" : formatINR(r.portalTaxableValue)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-biome-muted">
                        {r.booksTaxableValue === null ? "—" : formatINR(r.booksTaxableValue)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          r.taxDifference && Math.abs(r.taxDifference) > 1
                            ? "text-red-300"
                            : "text-biome-muted"
                        }`}
                      >
                        {r.taxDifference === null ? "—" : formatINR(r.taxDifference)}
                      </td>
                      <td className="max-w-[280px] px-3 py-2 text-[10.5px] leading-relaxed text-biome-muted">
                        {r.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}

function Gstr3bSummaryView({
  busy, returnName, booksName, rows, onReturn, onBooks,
}: {
  busy: boolean; returnName: string | null; booksName: string | null; rows: Gstr3bSummaryRow[] | null;
  onReturn: (f: File) => void; onBooks: (f: File) => void;
}) {
  const mismatch = rows?.filter((r) => r.status === "mismatch").length ?? 0;
  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <div className="mb-4">
          <h2 className="font-display text-sm font-medium text-biome-text">GSTR-3B vs Books — Summary Reconciliation</h2>
          <p className="mt-1 text-[11px] text-biome-muted">Upload the GSTR-3B export and your books summary. Columns are detected automatically; no reshaping is required.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-biome-line p-4 hover:border-biome-leaf/40">
            <span className="text-[11px] font-medium text-biome-text">GSTR-3B file</span>
            <span className="text-[10px] text-biome-muted">{returnName ?? "CSV / Excel"}</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="mt-2 text-[10px]" disabled={busy} onChange={(e) => { const f=e.target.files?.[0]; if(f) onReturn(f); }} />
          </label>
          <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-biome-line p-4 hover:border-biome-leaf/40">
            <span className="text-[11px] font-medium text-biome-text">Books summary</span>
            <span className="text-[10px] text-biome-muted">{booksName ?? "CSV / Excel"}</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="mt-2 text-[10px]" disabled={busy} onChange={(e) => { const f=e.target.files?.[0]; if(f) onBooks(f); }} />
          </label>
        </div>
      </GlassCard>
      {rows && (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-biome-line px-4 py-3">
            <div><p className="text-xs font-medium text-biome-text">Summary result</p><p className="text-[10px] text-biome-muted">{mismatch ? `${mismatch} mismatch${mismatch > 1 ? "es" : ""}` : "All mapped totals within tolerance"}</p></div>
            <PremiumButton variant="ghost" onClick={() => downloadExcelWorkbook({ "GSTR-3B vs Books": rows.map(r => ({ Field:r.label, "GSTR-3B":r.returnValue, "Books":r.booksValue, Difference:r.diff, Status:r.status })) }, `GSTR3B-vs-Books-${new Date().toISOString().slice(0,10)}.xlsx`)}><Download size={13}/> Excel</PremiumButton>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[11.5px]"><thead><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60"><th className="px-4 py-2">Field</th><th className="px-4 py-2 text-right">GSTR-3B</th><th className="px-4 py-2 text-right">Books</th><th className="px-4 py-2 text-right">Difference</th><th className="px-4 py-2">Status</th></tr></thead><tbody>{rows.map(r => <tr key={r.field} className="border-b border-biome-line/40"><td className="px-4 py-2 text-biome-text">{r.label}</td><td className="px-4 py-2 text-right font-mono">{formatINR(r.returnValue)}</td><td className="px-4 py-2 text-right font-mono">{formatINR(r.booksValue)}</td><td className="px-4 py-2 text-right font-mono">{formatINR(r.diff)}</td><td className={`px-4 py-2 ${r.status === "matched" ? "text-biome-leafBright" : "text-red-300"}`}>{r.status === "matched" ? "Matched" : "Mismatch"}</td></tr>)}</tbody></table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function HowTo() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Info size={15} className="text-biome-skyBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">
            Why this asks for a file instead of your GST password
          </h2>
        </div>
        <p className="text-[11.5px] leading-relaxed text-biome-muted">
          gst.gov.in protects sign-in with a captcha and an OTP, and its terms don&apos;t permit
          automated logins. Storing your GST username and password here to click through those
          checks for you would mean working around security controls that exist for good reason — so
          this app deliberately doesn&apos;t do it.
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">
          The official JSON download gives exactly the same invoice-level detail, takes two clicks,
          and works for every taxpayer. If you want fully hands-off syncing, that&apos;s what a
          licensed GSP (GST Suvidha Provider) is for — ClearTax, Masters India, Cygnet and others
          sell authorised API access, and their key can be wired in here later.
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="mb-3 font-display text-sm font-medium text-biome-text">
          Downloading GSTR-2B (purchases — what suppliers reported against you)
        </h3>
        <ol className="space-y-2 text-[11.5px] text-biome-muted">
          {[
            "Sign in at gst.gov.in.",
            "Returns Dashboard → pick the financial year and month.",
            "On the GSTR-2B tile, click Download.",
            "Choose “Generate JSON file to download”, wait for it, then download.",
            "Unzip it if it arrives as a ZIP, and load the .json here.",
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-biome-leaf/30 bg-biome-leaf/10 font-mono text-[9.5px] text-biome-leafBright">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <a
          href="https://www.gst.gov.in"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-biome-leafBright hover:text-biome-leaf"
        >
          Open the GST portal <ExternalLink size={11} />
        </a>
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="mb-3 font-display text-sm font-medium text-biome-text">
          Downloading GSTR-1 (sales — what you reported)
        </h3>
        <ol className="space-y-2 text-[11.5px] text-biome-muted">
          {[
            "Returns Dashboard → the same period → GSTR-1.",
            "Use “Download details from e-invoices (JSON)” or the filed-return JSON.",
            "Load the .json here to see it invoice by invoice.",
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-biome-leaf/30 bg-biome-leaf/10 font-mono text-[9.5px] text-biome-leafBright">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-[10.5px] leading-relaxed text-biome-muted">
          Note: B2C Small is filed rate-wise rather than invoice-wise, so those lines legitimately
          have no invoice number. Every other section comes through invoice by invoice.
        </p>
      </GlassCard>
    </div>
  );
}
