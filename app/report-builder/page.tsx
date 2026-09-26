"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Loader2, Play, FileSpreadsheet, FileText, Save, Trash2, Filter, Layers, CalendarRange, AlertCircle, Search, X,
} from "lucide-react";
import AdvancedBuilder from "@/components/reports/AdvancedBuilder";

/**
 * REPORT BUILDER — one report per module, cut the way that module needs.
 *
 *   1. Pick the report (Imprest, Coordination trading / manufacturing,
 *      Transport, Biomass, Stock on hand, Stock movements, Registrations,
 *      Purchase orders, Leave).
 *   2. Period, plant, "Group by" and "then by" (category, person, place,
 *      plant, user, vendor, client, vehicle, machine, month… — only the
 *      ones that apply), filters.
 *   3. Run → summary with sub-totals + detail, then PDF (branded, landscape,
 *      page numbers) or Excel (Summary + Detail sheets, formatted).
 *
 * Every report reads only what this login may already see in the module.
 */

interface Col { key: string; label: string; type: "text" | "number" | "money" | "kg" | "date" | "pct"; sum?: boolean; width?: number }
interface Dim { key: string; label: string }
interface Group { key: string; count: number; sums: Record<string, number>; children?: Group[] }

const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";

const fmt = (v: any, t: Col["type"]) => {
  if (v === null || v === undefined || v === "") return "";
  if (t === "money") return "₹" + Math.round(Number(v)).toLocaleString("en-IN");
  if (t === "kg" || t === "number") return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (t === "pct") return `${Number(v).toFixed(1)}%`;
  return String(v);
};
/**
 * jsPDF's built-in fonts are Latin-1. One character outside it (an em dash,
 * an arrow, the rupee sign) switches the whole string to a UTF-16 encoding
 * that prints letter-spaced garbage — so PDF text is mapped down first.
 */
const pdfText = (v: unknown) => String(v ?? "")
  .replace(/₹\s?/g, "Rs ").replace(/[—–]/g, "-").replace(/→/g, ">").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[✓✔]/g, "OK").replace(/[✗✘]/g, "X").replace(/[^\x00-\xFF]/g, "?");
const pdfFmt = (v: any, t: Col["type"]) => pdfText(fmt(v, t));

const fileName = (t: string) => `${t.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)} ${new Date().toISOString().slice(0, 10)}`;

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  return [
    { id: "month", label: "This month", from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) },
    { id: "last", label: "Last month", from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) },
    { id: "quarter", label: "Last 3 months", from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(now) },
    { id: "fy", label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, from: `${fyStart}-04-01`, to: iso(now) },
    { id: "all", label: "All time", from: "", to: "" },
  ];
}

export default function ReportBuilderPage() {
  const [meta, setMeta] = useState<any>(null);
  const [tab, setTab] = useState<"modules" | "advanced">("modules");
  const [spec, setSpec] = useState<any>({ dataset: "", from: presets()[0].from, to: presets()[0].to, plant: "", groupBy: "", thenBy: "", filters: [], search: "", name: "" });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showRows, setShowRows] = useState(200);

  const load = useCallback(async () => {
    const r = await fetch("/api/reports-builder", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Could not load reports."); return; }
    setMeta(j);
    setSpec((s: any) => (s.dataset ? s : { ...s, dataset: j.catalogue?.[0]?.id || "", groupBy: j.catalogue?.[0]?.dimensions?.[0]?.key || "" }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ds = useMemo(() => meta?.catalogue?.find((d: any) => d.id === spec.dataset), [meta, spec.dataset]);
  const modules = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const d of meta?.catalogue || []) m.set(d.module, [...(m.get(d.module) || []), d]);
    return Array.from(m.entries());
  }, [meta]);

  async function run(s = spec) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/reports-builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "module", spec: s }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The report did not run.");
      setResult(j.result); setShowRows(200);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  function pick(id: string) {
    const d = meta.catalogue.find((x: any) => x.id === id);
    const next = { ...spec, dataset: id, groupBy: d?.dimensions?.[0]?.key || "", thenBy: "", filters: [], search: "" };
    setSpec(next); setResult(null);
  }

  async function saveSpec() {
    const name = window.prompt("Name this report", spec.name || `${ds?.label}${result?.groupBy ? ` by ${result.groupBy}` : ""}`);
    if (!name) return;
    await fetch("/api/reports-builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveModule", spec: { ...spec, name } }) });
    await load();
  }

  const title = result ? `${result.dataset.label}${result.groupBy ? ` — by ${result.groupBy}${result.thenBy ? ` → ${result.thenBy}` : ""}` : ""}` : "";
  const subtitle = result ? [
    spec.from || spec.to ? `Period: ${spec.from || "start"} to ${spec.to || "today"}` : "Period: all",
    spec.plant ? `Plant: ${meta.plants.find((p: any) => p.code === spec.plant)?.label || spec.plant}` : "",
    ...(spec.filters || []).filter((f: any) => f.value).map((f: any) => `${ds?.dimensions.find((d: Dim) => d.key === f.field)?.label}: ${f.value}`),
    spec.search ? `Search: "${spec.search}"` : "",
    `${result.count} record(s)`,
  ].filter(Boolean).join("  ·  ") : "";

  /* ---------------- Excel ---------------- */
  async function exportExcel() {
    if (!result) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Biome Industria — Enterprise Platform";
    const cols: Col[] = result.columns;
    const sumCols = cols.filter((c) => c.sum);
    const numFmt = (t: Col["type"]) => (t === "money" ? '"₹"#,##,##0' : t === "kg" || t === "number" ? "#,##,##0.##" : t === "pct" ? '0.0"%"' : undefined);
    const head = (ws: any, width: number) => {
      ws.mergeCells(1, 1, 1, width); ws.getCell(1, 1).value = "BIOME INDUSTRIA PRIVATE LIMITED";
      ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF163300" } };
      ws.mergeCells(2, 1, 2, width); ws.getCell(2, 1).value = title; ws.getCell(2, 1).font = { bold: true, size: 12 };
      ws.mergeCells(3, 1, 3, width); ws.getCell(3, 1).value = `${subtitle}  ·  Generated ${new Date().toLocaleString("en-IN")} by ${meta.me.name}`;
      ws.getCell(3, 1).font = { size: 9, color: { argb: "FF6E788C" } };
    };
    const styleHeader = (row: any) => {
      row.eachCell((c: any) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A9C4E" } };
        c.alignment = { vertical: "middle", wrapText: true };
        c.border = { bottom: { style: "thin", color: { argb: "FF3E7A34" } } };
      });
      row.height = 22;
    };

    // Summary
    if (result.groups.length) {
      const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 5 }] });
      const hdr = [result.groupBy, ...(result.thenBy ? [result.thenBy] : []), "Records", ...sumCols.map((c) => c.label)];
      head(ws, hdr.length);
      styleHeader(ws.addRow([]) && ws.addRow(hdr));
      const add = (vals: any[], bold = false, fill?: string) => {
        const r = ws.addRow(vals);
        sumCols.forEach((c, i) => { const cell = r.getCell((result.thenBy ? 3 : 2) + 1 + i); const f = numFmt(c.type); if (f) cell.numFmt = f; });
        if (bold) r.font = { bold: true };
        if (fill) r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }; });
      };
      for (const g of result.groups as Group[]) {
        if (result.thenBy && g.children) {
          for (const ch of g.children) add([g.key, ch.key, ch.count, ...sumCols.map((c) => ch.sums[c.key])]);
          add([`${g.key} — subtotal`, "", g.count, ...sumCols.map((c) => g.sums[c.key])], true, "FFEAF4E4");
        } else add([g.key, g.count, ...sumCols.map((c) => g.sums[c.key])]);
      }
      add(["GRAND TOTAL", ...(result.thenBy ? [""] : []), result.count, ...sumCols.map((c) => result.totals[c.key])], true, "FFD5E8CC");
      ws.columns.forEach((c: any, i: number) => { c.width = i < (result.thenBy ? 2 : 1) ? 32 : 16; });
    }

    // Detail
    const wd = wb.addWorksheet("Detail", { views: [{ state: "frozen", ySplit: 5 }] });
    head(wd, cols.length);
    wd.addRow([]);
    styleHeader(wd.addRow(cols.map((c) => c.label)));
    for (const r of result.rows) {
      const row = wd.addRow(cols.map((c) => (c.type === "text" || c.type === "date" ? r[c.key] ?? "" : Number(r[c.key]) || 0)));
      cols.forEach((c, i) => { const f = numFmt(c.type); if (f) row.getCell(i + 1).numFmt = f; });
    }
    const tot = wd.addRow(cols.map((c, i) => (i === 0 ? "TOTAL" : c.sum ? result.totals[c.key] : "")));
    tot.font = { bold: true };
    cols.forEach((c, i) => { const f = numFmt(c.type); if (f && c.sum) tot.getCell(i + 1).numFmt = f; });
    wd.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + result.rows.length, column: cols.length } };
    wd.columns.forEach((c: any, i: number) => { const col = cols[i]; c.width = col?.width ? Math.min(60, col.width) : col?.type === "text" ? 22 : 14; });

    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `${fileName(title)}.xlsx`;
    a.click();
  }

  /* ---------------- PDF ---------------- */
  async function exportPdf() {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const { drawLetterhead, drawFooter } = await import("@/lib/pdfBranding");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const cols: Col[] = result.columns;
    const sumCols = cols.filter((c) => c.sum);
    let y = await drawLetterhead(doc, pdfText(title), pdfText(subtitle).slice(0, 190));
    const green: [number, number, number] = [90, 156, 78];

    // Totals strip
    doc.setFontSize(9); doc.setTextColor(22, 30, 45);
    const strip = pdfText([`Records: ${result.count}`, ...sumCols.map((c) => `${c.label}: ${pdfFmt(result.totals[c.key], c.type)}`)].join("     "));
    doc.text(strip, 14, y); y += 5;

    if (result.groups.length) {
      const body: any[] = [];
      for (const g of result.groups as Group[]) {
        if (result.thenBy && g.children) {
          for (const ch of g.children) body.push([pdfText(g.key), pdfText(ch.key), ch.count, ...sumCols.map((c) => pdfFmt(ch.sums[c.key], c.type))]);
          body.push([{ content: pdfText(`${g.key} - subtotal`), colSpan: 2, styles: { fontStyle: "bold", fillColor: [234, 244, 228] } }, { content: g.count, styles: { fontStyle: "bold", fillColor: [234, 244, 228] } }, ...sumCols.map((c) => ({ content: pdfFmt(g.sums[c.key], c.type), styles: { fontStyle: "bold", fillColor: [234, 244, 228] } }))]);
        } else body.push([pdfText(g.key), g.count, ...sumCols.map((c) => pdfFmt(g.sums[c.key], c.type))]);
      }
      body.push([{ content: "GRAND TOTAL", colSpan: result.thenBy ? 2 : 1, styles: { fontStyle: "bold", fillColor: [213, 232, 204] } }, { content: result.count, styles: { fontStyle: "bold", fillColor: [213, 232, 204] } }, ...sumCols.map((c) => ({ content: pdfFmt(result.totals[c.key], c.type), styles: { fontStyle: "bold", fillColor: [213, 232, 204] } }))]);
      const numStart = result.thenBy ? 2 : 1;
      autoTable(doc, {
        startY: y,
        head: [[pdfText(result.groupBy), ...(result.thenBy ? [pdfText(result.thenBy)] : []), "Records", ...sumCols.map((c) => pdfText(c.label))]],
        body,
        styles: { fontSize: 8, cellPadding: 1.6 },
        headStyles: { fillColor: green, textColor: 255 },
        columnStyles: Object.fromEntries(Array.from({ length: sumCols.length + 1 }, (_, i) => [numStart + i, { halign: "right" }])),
        margin: { left: 14, right: 14, top: 14, bottom: 16 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
      doc.setFontSize(11); doc.setTextColor(22, 30, 45); doc.text("Detail", 14, y); y += 2;
    }

    autoTable(doc, {
      startY: y + 1,
      head: [cols.map((c) => pdfText(c.label))],
      body: result.rows.slice(0, 3000).map((r: any) => cols.map((c) => pdfFmt(r[c.key], c.type))),
      foot: [cols.map((c, i) => (i === 0 ? "TOTAL" : c.sum ? pdfFmt(result.totals[c.key], c.type) : ""))],
      styles: { fontSize: cols.length > 12 ? 6.5 : 7.5, cellPadding: 1.3, overflow: "linebreak" },
      headStyles: { fillColor: green, textColor: 255 },
      footStyles: { fillColor: [213, 232, 204], textColor: [22, 30, 45], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 249, 246] },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.type !== "text" && c.type !== "date" ? { halign: "right" } : {}])),
      margin: { left: 10, right: 10, top: 14, bottom: 16 },
    });
    if (result.rows.length > 3000) { doc.setFontSize(8); doc.text(`Only the first 3,000 of ${result.count} rows are printed — use Excel for all of them.`, 14, (doc as any).lastAutoTable.finalY + 6); }
    drawFooter(doc);
    doc.save(`${fileName(title)}.pdf`);
  }

  if (!meta) return <div className="flex items-center gap-2 text-[12px] text-biome-muted">{err ? <><AlertCircle size={14} /> {err}</> : <><Loader2 size={14} className="bmx-spin" /> Loading reports…</>}</div>;

  const cols: Col[] = result?.columns || [];
  const sumCols = cols.filter((c) => c.sum);
  const maxBar = result?.groups?.length ? Math.max(1, ...result.groups.map((g: Group) => Math.abs(sumCols[0] ? g.sums[sumCols[0].key] : g.count))) : 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text"><BarChart3 size={19} className="text-biome-leaf" /> Report builder</h1>
          <p className="mt-1 max-w-[760px] text-[11.5px] leading-relaxed text-biome-muted">
            Choose a module report, cut it by category, person, place, plant, user (and more), and download it as a PDF or an Excel file.
            You only ever get the data your login can already see.
          </p>
        </div>
        {meta.advanced && (
          <div className="flex gap-1.5">
            {(["modules", "advanced"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`bmx-chip rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${tab === t ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
                {t === "modules" ? "Module reports" : "Custom (advanced)"}
              </button>
            ))}
          </div>
        )}
      </header>

      {tab === "advanced" ? <AdvancedBuilder /> : (
        <>
          {/* Report picker */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {modules.map(([mod, list]) => (
              <div key={mod} className="rounded-2xl border border-biome-line bg-biome-bgSoft p-3">
                <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">{mod}</p>
                <div className="mt-1.5 space-y-1">
                  {list.map((d: any) => (
                    <button key={d.id} onClick={() => pick(d.id)} title={d.description}
                      className={`block w-full rounded-xl border px-3 py-2 text-left text-[11.5px] font-semibold ${spec.dataset === d.id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-transparent text-biome-text hover:border-biome-line"}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {ds && (
            <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
              <p className="text-[12.5px] font-semibold text-biome-text">{ds.label}</p>
              <p className="text-[10.5px] text-biome-muted">{ds.description}</p>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {ds.dateField && (
                  <div className="xl:col-span-2">
                    <span className={`${lbl} flex items-center gap-1`}><CalendarRange size={11} /> Period</span>
                    <div className="flex flex-wrap gap-1.5">
                      {presets().map((p) => (
                        <button key={p.id} onClick={() => setSpec({ ...spec, from: p.from, to: p.to })}
                          className={`bmx-chip rounded-lg border px-2.5 py-1 text-[10.5px] font-semibold ${spec.from === p.from && spec.to === p.to ? "border-biome-leaf/50 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>{p.label}</button>
                      ))}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <input type="date" value={spec.from} onChange={(e) => setSpec({ ...spec, from: e.target.value })} className={input} />
                      <input type="date" value={spec.to} onChange={(e) => setSpec({ ...spec, to: e.target.value })} className={input} />
                    </div>
                  </div>
                )}
                <label><span className={lbl}>Plant</span>
                  <select value={spec.plant} onChange={(e) => setSpec({ ...spec, plant: e.target.value })} className={input}>
                    {meta.plants.length > 1 && <option value="">All plants</option>}
                    {meta.plants.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select></label>
                <label><span className={`${lbl} flex items-center gap-1`}><Search size={11} /> Search</span>
                  <input value={spec.search} onChange={(e) => setSpec({ ...spec, search: e.target.value })} placeholder="Any text in the rows" className={input} /></label>
                <label><span className={`${lbl} flex items-center gap-1`}><Layers size={11} /> Group by</span>
                  <select value={spec.groupBy} onChange={(e) => setSpec({ ...spec, groupBy: e.target.value, thenBy: e.target.value ? spec.thenBy : "" })} className={input}>
                    <option value="">No grouping (detail only)</option>
                    {ds.dimensions.map((d: Dim) => <option key={d.key} value={d.key}>by {d.label}</option>)}
                  </select></label>
                <label><span className={lbl}>Then by</span>
                  <select value={spec.thenBy} disabled={!spec.groupBy} onChange={(e) => setSpec({ ...spec, thenBy: e.target.value })} className={`${input} disabled:opacity-50`}>
                    <option value="">—</option>
                    {ds.dimensions.filter((d: Dim) => d.key !== spec.groupBy).map((d: Dim) => <option key={d.key} value={d.key}>then by {d.label}</option>)}
                  </select></label>
              </div>

              <div className="mt-3 space-y-1.5">
                {(spec.filters || []).map((f: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5 md:max-w-[640px]">
                    <select value={f.field} onChange={(e) => setSpec({ ...spec, filters: spec.filters.map((x: any, j: number) => (j === i ? { field: e.target.value, value: "" } : x)) })} className={input}>
                      {ds.dimensions.filter((d: Dim) => d.key !== "__month").map((d: Dim) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                    {result?.values?.[f.field]?.length ? (
                      <select value={f.value} onChange={(e) => setSpec({ ...spec, filters: spec.filters.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)) })} className={input}>
                        <option value="">Any</option>{result.values[f.field].map((v: string) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input value={f.value} placeholder="Exact value (run once to get a list)" onChange={(e) => setSpec({ ...spec, filters: spec.filters.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)) })} className={input} />
                    )}
                    <button onClick={() => setSpec({ ...spec, filters: spec.filters.filter((_: any, j: number) => j !== i) })} className="rounded-lg border border-biome-line px-2 text-rose-500"><X size={12} /></button>
                  </div>
                ))}
                <button onClick={() => setSpec({ ...spec, filters: [...(spec.filters || []), { field: ds.dimensions[0].key, value: "" }] })}
                  className="flex items-center gap-1 text-[10.5px] font-semibold text-biome-leaf"><Filter size={11} /> Add filter</button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => run()} disabled={busy} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={13} className="bmx-spin" /> : <Play size={13} />} Run report
                </button>
                <button onClick={exportPdf} disabled={!result} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-text disabled:opacity-50"><FileText size={13} /> PDF</button>
                <button onClick={exportExcel} disabled={!result} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-text disabled:opacity-50"><FileSpreadsheet size={13} /> Excel</button>
                <button onClick={saveSpec} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted"><Save size={13} /> Save</button>
              </div>
              {err && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-500"><AlertCircle size={12} /> {err}</p>}

              {meta.saved.filter((s: any) => s.module).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-biome-line pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Saved:</span>
                  {meta.saved.filter((s: any) => s.module).map((s: any) => (
                    <span key={s.id} className="flex items-center gap-1 rounded-full border border-biome-line px-2.5 py-0.5 text-[10.5px]">
                      <button onClick={() => { setSpec({ ...spec, ...s }); run({ ...spec, ...s }); }} className="font-semibold text-biome-text hover:text-biome-leaf">{s.name}</button>
                      <button onClick={async () => { await fetch("/api/reports-builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: s.id }) }); load(); }} className="text-rose-500"><Trash2 size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {result && (
            <section className="space-y-3 rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
              <div>
                <p className="text-[13px] font-semibold text-biome-text">{title}</p>
                <p className="text-[10.5px] text-biome-muted">{subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Kpi label="Records" value={result.count.toLocaleString("en-IN")} />
                {sumCols.map((c) => <Kpi key={c.key} label={c.label} value={fmt(result.totals[c.key], c.type)} />)}
              </div>

              {result.groups.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[11.5px]">
                    <thead><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-[.12em] text-biome-muted">
                      <th className="py-2">{result.groupBy}</th>{result.thenBy && <th>{result.thenBy}</th>}
                      <th className="text-right">Records</th>{sumCols.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
                      <th className="w-[160px]"></th>
                    </tr></thead>
                    <tbody>
                      {(result.groups as Group[]).map((g) => {
                        const barVal = Math.abs(sumCols[0] ? g.sums[sumCols[0].key] : g.count);
                        return (
                          <Fragment key={g.key}>
                            {result.thenBy && g.children?.map((ch) => (
                              <tr key={`${g.key}/${ch.key}`} className="border-b border-biome-line/40">
                                <td className="py-1 text-biome-muted">{g.key}</td><td>{ch.key}</td>
                                <td className="text-right font-mono">{ch.count}</td>
                                {sumCols.map((c) => <td key={c.key} className="text-right font-mono">{fmt(ch.sums[c.key], c.type)}</td>)}
                                <td />
                              </tr>
                            ))}
                            <tr className={`border-b border-biome-line/60 ${result.thenBy ? "bg-biome-leaf/[.07] font-semibold" : ""}`}>
                              <td className="py-1.5 font-semibold text-biome-text" colSpan={result.thenBy ? 2 : 1}>{g.key}{result.thenBy ? " — subtotal" : ""}</td>
                              <td className="text-right font-mono">{g.count}</td>
                              {sumCols.map((c) => <td key={c.key} className="text-right font-mono">{fmt(g.sums[c.key], c.type)}</td>)}
                              <td><div className="h-2 rounded-full bg-biome-leaf/70" style={{ width: `${Math.max(2, (barVal / maxBar) * 100)}%` }} /></td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      <tr className="bg-biome-leaf/[.14] font-bold">
                        <td className="py-2" colSpan={result.thenBy ? 2 : 1}>GRAND TOTAL</td>
                        <td className="text-right font-mono">{result.count}</td>
                        {sumCols.map((c) => <td key={c.key} className="text-right font-mono">{fmt(result.totals[c.key], c.type)}</td>)}
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <details open={!result.groups.length}>
                <summary className="cursor-pointer text-[11.5px] font-semibold text-biome-text">Detail ({result.count} rows{result.truncated ? ", first 5,000" : ""})</summary>
                <div className="mt-2 max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[900px] text-left text-[11px]">
                    <thead className="sticky top-0 bg-biome-bgSoft"><tr className="border-b border-biome-line text-[9.5px] uppercase tracking-[.1em] text-biome-muted">
                      {cols.map((c) => <th key={c.key} className={`py-1.5 pr-2 ${c.type !== "text" && c.type !== "date" ? "text-right" : ""}`}>{c.label}</th>)}
                    </tr></thead>
                    <tbody>
                      {result.rows.slice(0, showRows).map((r: any, i: number) => (
                        <tr key={i} className="border-b border-biome-line/40">
                          {cols.map((c) => <td key={c.key} className={`py-1 pr-2 ${c.type !== "text" && c.type !== "date" ? "text-right font-mono" : ""}`}>{fmt(r[c.key], c.type)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > showRows && (
                    <button onClick={() => setShowRows(showRows + 500)} className="mt-2 text-[11px] font-semibold text-biome-leaf">Show more ({result.rows.length - showRows} left) — or download Excel</button>
                  )}
                </div>
              </details>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</p>
      <p className="font-mono text-[14px] font-semibold text-biome-text">{value}</p>
    </div>
  );
}
