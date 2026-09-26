"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Search, Download, Filter, ChevronUp, ChevronDown } from "lucide-react";

export interface PremiumTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => string | number;
}

interface PremiumTableProps<T> {
  columns: PremiumTableColumn<T>[];
  rows: T[];
  /** Called with the filtered/sorted CSV text when the user clicks Export. */
  onExport?: (csv: string) => void;
  emptyLabel?: string;
  maxHeight?: string;
}

function toCell<T>(col: PremiumTableColumn<T>, row: T): string {
  if (col.accessor) return String(col.accessor(row));
  const v = (row as any)[col.key];
  return v === null || v === undefined ? "" : String(v);
}

/**
 * A generic, styled data table used across the app wherever we render
 * tabular results (reconciliation matches, GST mismatches, OCR batch
 * summaries): sticky header, rounded/hover rows, free-text search
 * across all columns, single-column filter, sortable headers, animated
 * row entrance, and a one-click CSV export of whatever's currently
 * visible (respecting search/filter/sort).
 */
export default function PremiumTable<T>({
  columns,
  rows,
  onExport,
  emptyLabel = "No rows to show.",
  maxHeight = "28rem",
}: PremiumTableProps<T>) {
  const [query, setQuery] = useState("");
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterValue, setFilterValue] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    let out = rows;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((row) => columns.some((c) => toCell(c, row).toLowerCase().includes(q)));
    }
    if (filterCol && filterValue.trim()) {
      const col = columns.find((c) => c.key === filterCol);
      if (col) {
        const q = filterValue.trim().toLowerCase();
        out = out.filter((row) => toCell(col, row).toLowerCase().includes(q));
      }
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = toCell(col, a);
          const bv = toCell(col, b);
          const an = Number(av);
          const bn = Number(bv);
          const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
          return cmp * sort.dir;
        });
      }
    }
    return out;
  }, [rows, query, filterCol, filterValue, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  function exportCsv() {
    const header = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(",");
    const body = filtered
      .map((row) => columns.map((c) => `"${toCell(c, row).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const csv = `${header}\n${body}`;
    if (onExport) {
      onExport(csv);
    } else {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "table-export.csv";
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => a.remove(), 4000);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-biome-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-biome-line bg-biome-hover px-3 py-2.5">
        <div className="flex min-w-[160px] flex-1 items-center gap-1.5 rounded-lg border border-biome-line bg-biome-hover px-2.5 py-1.5 text-xs text-biome-muted">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rows…"
            className="w-full bg-transparent text-biome-text outline-none placeholder:text-biome-muted"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-biome-line bg-biome-hover px-2 py-1.5 text-xs text-biome-muted">
          <Filter size={12} />
          <select
            value={filterCol}
            onChange={(e) => setFilterCol(e.target.value)}
            className="bg-transparent text-biome-text outline-none"
          >
            <option value="" className="bg-biome-surface">
              Filter column…
            </option>
            {columns.map((c) => (
              <option key={c.key} value={c.key} className="bg-biome-surface">
                {c.header}
              </option>
            ))}
          </select>
          {filterCol && (
            <input
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder="value…"
              className="w-20 bg-transparent text-biome-text outline-none placeholder:text-biome-muted"
            />
          )}
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 rounded-lg border border-biome-leaf/30 bg-biome-leaf/10 px-2.5 py-1.5 text-[11px] font-medium text-biome-leafBright transition-colors hover:bg-biome-leaf/20"
        >
          <Download size={12} /> Export
        </button>
      </div>

      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-biome-surface/95 backdrop-blur">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="cursor-pointer select-none whitespace-nowrap border-b border-biome-line px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-biome-muted transition-colors hover:text-biome-text"
                >
                  <span className="flex items-center gap-1">
                    {c.header}
                    {sort?.key === c.key &&
                      (sort.dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3.5 py-8 text-center text-biome-muted">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 20) * 0.015 }}
                  className="border-b border-biome-line/50 transition-colors last:border-0 hover:bg-biome-leaf/[0.05]"
                >
                  {columns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3.5 py-2.5 text-biome-text">
                      {c.render ? c.render(row) : toCell(c, row)}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
