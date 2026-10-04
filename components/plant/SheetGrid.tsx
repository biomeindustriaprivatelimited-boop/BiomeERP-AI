"use client";

import MismatchFlag from "@/components/plant/MismatchFlag";
import PartnerCombo, { type ComboOption } from "@/components/plant/PartnerCombo";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { toKg, conversionNote } from "@/lib/units";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Download, Trash2, Loader2, Upload, Calculator, Filter, ShieldCheck, ShieldAlert, ScanLine } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

/**
 * The sheet grid.
 *
 * Built from the schema the API reports rather than from a hard-coded
 * column list, so Rewari and Gangakhed — which genuinely keep different
 * books — share one grid without either being bent to fit the other.
 *
 * Derived columns are read-only and recalculate as you type, exactly as
 * they would in the workbook. That is the whole point: the manager
 * should not be able to type a Net Weight that disagrees with Gross
 * minus Tare.
 */

interface Column {
  cell: string;
  key: string;
  label: string;
  kind: "entry" | "derived" | "upload";
  type: "text" | "number" | "date" | "yesno";
  width?: number;
  hint?: string;
  /** Registered-name typeahead (lib/plantSheets.ts). */
  suggest?: SuggestKind | SuggestKind[];
  suggestField?: "name" | "code";
  pairKey?: string;
}

type SuggestKind = "vendor" | "transporter" | "client";
const kindsOf = (c: Column): SuggestKind[] => (!c.suggest ? [] : Array.isArray(c.suggest) ? c.suggest : [c.suggest]);
const KIND_PLURAL: Record<SuggestKind, string> = { vendor: "vendors", transporter: "transporters", client: "clients" };

interface Plant {
  id: string;
  name: string;
  state: string;
  code: string;
}

/**
 * An upload cell that actually uploads.
 *
 * The old version wrote the filename into the sheet and threw the file away,
 * so a weight slip could be "attached" and never opened again. This sends
 * the bytes to /api/plant-upload and stores `<id>::<name>`, which the same
 * route can serve back. A value with no `::` is a legacy name-only entry —
 * shown as plain text rather than a dead link, because pretending it opens
 * would repeat the original problem.
 */
function UploadCell({
  value, plant, onChange,
}: { value: string; plant: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sep = value.indexOf("::");
  const id = sep > 0 ? value.slice(0, sep) : "";
  const name = sep > 0 ? value.slice(sep + 2) : value;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("plant", plant);
      const res = await fetch("/api/plant-upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status}).`);
      onChange(json.ref);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1 px-1">
      {id ? (
        <a
          href={`/api/plant-upload?id=${id}&plant=${plant}`}
          target="_blank"
          rel="noreferrer"
          title={name}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-biome-leaf/35 bg-biome-leaf/10 px-2 py-1 text-[10.5px] text-biome-leaf hover:bg-biome-leaf/15"
        >
          <Upload size={10} className="shrink-0" />
          <span className="truncate">{name || "Open"}</span>
        </a>
      ) : (
        <label
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[10.5px] hover:border-biome-leaf/40 ${
            error ? "border-rose-400/50 text-rose-500" : "border-biome-line text-biome-muted"
          }`}
          title={error || (name ? `${name} — uploaded before attachments worked; re-attach it to open it` : "Attach the weight slip")}
        >
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <Upload size={10} className={`shrink-0 ${busy ? "bmx-spin" : ""}`} />
          <span className="truncate">{busy ? "Uploading…" : error ? "Retry" : name || "Upload"}</span>
        </label>
      )}
      {id && (
        <button
          onClick={() => onChange("")}
          title="Remove"
          className="shrink-0 rounded px-1 text-[10px] text-biome-muted hover:text-rose-500"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Fields the weight-slip check compares, across both sheet shapes.
 * Changing any of them invalidates a verdict that was about the row as it
 * was, so the check is dropped rather than left showing a stale tick.
 */
const COMPARED = [
  "vehicleNo", "name", "partyName", "grossWeight", "tareWeight",
  "weightSlipNo", "rWeight", "kantaParchi", "weightSlipCopy",
];

export default function SheetGrid({
  kind,
  title,
  subtitle,
  storageKey,
}: {
  kind: "biomass" | "transport";
  title: string;
  subtitle: string;
  storageKey: string;
}) {
  const { notify } = useNotifications();
  /**
   * Slip checks, keyed by row index.
   *
   * Held outside the row data on purpose: a check is about the row as it
   * stands right now, so editing a figure must invalidate it rather than
   * leave a stale green tick sitting next to a changed number.
   */
  const [checks, setChecks] = useState<Record<number, any>>({});
  const [checking, setChecking] = useState<number | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plant, setPlant] = useState("rewari");
  // Office roles read the plant's book; only the plant manager enters rows.
  const [readOnly, setReadOnly] = useState(false);
  const [columns, setColumns] = useState<Column[]>([]);

  /**
   * Read the attached slip and compare it with the row.
   *
   * Shifting columns are deliberately untouched — the business was explicit
   * that shifting is the plant manager's own figure and has nothing to do
   * with the weighbridge ticket.
   */
  const verifyRow = useCallback(async (index: number, row: any) => {
    const uploadKey = columns.find((c) => c.kind === "upload")?.key;
    if (!uploadKey) {
      setChecks((c) => ({ ...c, [index]: { error: "This sheet has no weight-slip column." } }));
      return;
    }
    const cell = String(row[uploadKey] || "");
    const sep = cell.indexOf("::");
    if (sep <= 0) {
      setChecks((c) => ({ ...c, [index]: { error: "No weight slip attached to this row yet." } }));
      return;
    }
    setChecking(index);
    try {
      const res = await fetch("/api/plant-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentId: cell.slice(0, sep),
          plant,
          // Transport is checked on its own terms: the slip's net weight is
          // what the client actually received, so it is compared with
          // R. Weight rather than with a gross/tare pair the sheet
          // doesn't carry.
          row: kind === "transport"
            ? {
                vehicleNo: row.vehicleNo,
                name: row.partyName,
                netWeight: row.rWeight,
              }
            : {
                vehicleNo: row.vehicleNo, weightSlipNo: row.weightSlipNo, name: row.name,
                grossWeight: row.grossWeight, tareWeight: row.tareWeight,
                netWeight: (Number(row.grossWeight) || 0) - (Number(row.tareWeight) || 0),
              },
        }),
      });
      const json = await res.json().catch(() => ({}));
      // A 200 can still carry a "couldn't read it" answer — that is not a
      // failure of the request, and treating it as one loses the diagnosis.
      if (!res.ok && !json.diagnostics) throw new Error(json.error || `Check failed (${res.status}).`);
      setChecks((c) => ({ ...c, [index]: json }));
    } catch (err) {
      setChecks((c) => ({ ...c, [index]: { error: (err as Error).message } }));
    } finally {
      setChecking(null);
    }
  }, [plant, columns, kind]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("");
  const [vendors, setVendors] = useState<{ code: string; name: string }[]>([]);
  /**
   * Registered partners of THIS plant, for the name/code typeahead. The
   * server decides the plant from the session (a plant manager only ever
   * gets their own site's registrations, never trading or another plant's),
   * so the grid does no filtering of its own here.
   */
  const [registered, setRegistered] = useState<ComboOption[]>([]);
  const registeredAt = useRef(0);
  const registeredFor = useRef("");
  const loadRegistered = useCallback(async () => {
    registeredAt.current = Date.now();
    const wantPlant = plant;
    try {
      const res = await fetch(`/api/partners/suggest?kind=vendor,transporter,client&plant=${encodeURIComponent(wantPlant)}`, { cache: "no-store" });
      if (!res.ok) { if (registeredFor.current !== wantPlant) setRegistered([]); registeredFor.current = wantPlant; return; }
      const json = await res.json();
      registeredFor.current = wantPlant;
      setRegistered(
        (json.partners || []).map((p: any) => ({
          key: `r:${p.id}`, kind: p.kind, code: String(p.code || ""), name: String(p.name || ""),
          legalName: String(p.legalName || ""), city: String(p.city || ""), status: String(p.status || ""),
          source: "registered" as const,
        }))
      );
    } catch { /* suggestions are a convenience; typing still works */ }
  }, [plant]);
  useEffect(() => { setRegistered([]); loadRegistered(); }, [loadRegistered]);
  // A partner registered in another tab or on another PC shows up without a
  // reload: on window focus, on the app-wide change signal, and whenever a
  // cell's list opens on a list more than a few seconds old.
  useLiveRefresh(loadRegistered, 15000);
  const refreshIfStale = useCallback(() => {
    if (Date.now() - registeredAt.current > 5000) loadRegistered();
  }, [loadRegistered]);

  const optionsFor = useCallback((c: Column): ComboOption[] => {
    const kinds = kindsOf(c);
    const reg = registered.filter((o) => kinds.includes(o.kind));
    // The plant's own imported code list ("Import vendors") is offered too,
    // after the registered names — it is this plant's list and nobody else's.
    if (kind !== "biomass" || !kinds.includes("vendor") || (c.key !== "vendorCode" && c.key !== "name" && c.key !== "vendorName")) return reg;
    const known = new Set(reg.map((o) => `${o.code.toUpperCase()}|${o.name.toLowerCase()}`));
    const extra = vendors
      .filter((v) => !known.has(`${String(v.code).toUpperCase()}|${String(v.name).toLowerCase()}`))
      .map((v) => ({
        key: `p:${v.code}`, kind: "vendor" as const, code: String(v.code || ""), name: String(v.name || ""),
        legalName: "", city: "", status: "", source: "plant_list" as const,
      }));
    return [...reg, ...extra];
  }, [registered, vendors, kind]);
  const [importOpen, setImportOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // ---- Schema ----
  const loadSchema = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plant-sheet?kind=${kind}&plant=${plant}`, { cache: "no-store" });
      const json = await res.json();
      setPlants(json.plants || []);
      // A field role is offered one plant and it is theirs — the API decides
      // this, not the browser, so a stale selection can't survive a reload.
      if (json.lockedToPlant && json.plant?.id) setPlant(json.plant.id);
      setColumns(json.columns || []);
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't load the sheet layout", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [kind, plant, notify]);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  // Rows live in the browser until exported. Kept per plant so switching
  // between Rewari and Gangakhed doesn't mix two plants' entries.
  // Rows and vendors are stored on disk, so a closed tab no longer costs
  // a morning's data entry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rowsRes, vendorRes] = await Promise.all([
          fetch(`/api/plant-data?kind=${kind}&plant=${plant}`, { cache: "no-store" }),
          fetch(`/api/plant-data?what=vendors&plant=${plant}`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (rowsRes.ok) { const j = await rowsRes.json(); setRows(j.rows || []); setReadOnly(Boolean(j.readOnly)); }
        if (vendorRes.ok) setVendors((await vendorRes.json()).vendors || []);
      } catch {
        /* an empty sheet is better than a broken page */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, plant]);

  // Coordination match (transport only): for each of THIS plant's
  // dispatches, whether the coordination team's manufacturing register has
  // the same vehicle on that date. Only a verdict — never their data.
  const [match, setMatch] = useState<{ statuses: Record<string, string>; flags?: Record<string, any>; summary: any } | null>(null);
  const loadMatch = useCallback(async () => {
    if (kind !== "transport") return;
    try {
      const res = await fetch(`/api/plant-match?side=plant&plant=${plant}`, { cache: "no-store" });
      if (res.ok) setMatch(await res.json());
    } catch { /* a hint, not a blocker */ }
  }, [kind, plant]);
  useEffect(() => { loadMatch(); }, [loadMatch]);

  const save = useCallback(
    async (next: Record<string, any>[]) => {
      setSaving(true);
      try {
        const res = await fetch("/api/plant-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, plant, rows: next }),
        });
        if (res.ok) { setSavedAt(new Date()); loadMatch(); }
      } catch {
        /* the next edit tries again */
      } finally {
        setSaving(false);
      }
    },
    [kind, plant, loadMatch]
  );

  // Saved shortly after typing stops, rather than on every keystroke.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => save(rows), 900);
    return () => clearTimeout(timer);
  }, [rows, save, loading]);

  // ---- The same arithmetic the workbook does ----
  const num = (v: any) => {
    const n = Number(String(v ?? "").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const compute = useCallback(
    (r: Record<string, any>) => {
      const o = { ...r };
      if (kind === "transport") {
        const a = num(o.weight);
        const b = num(o.rWeight);
        o.actualWeight = !a ? b : !b ? a : Math.min(a, b);
        o.amount = num(o.rate) * num(o.actualWeight) - num(o.daala);
        return o;
      }
      // Every plant except Mayan uses the standard (single-deduction) book.
      if ((plants.find((p) => p.id === plant) as any)?.layout !== "rewari" && plant !== "rewari") {
        o.netWeight = num(o.grossWeight) - num(o.tareWeight);
        o.payableWeight = num(o.netWeight) - num(o.anyDeduction);
        o.amount = num(o.finalWeight) * num(o.rate);
        o.finalAmount = num(o.amount) - num(o.weighbridgeCharge);
        return o;
      }
      // Mayan (folder "rewari"): dust + moisture against allowances
      o.netWeight = num(o.grossWeight) - num(o.tareWeight);
      o.actualDust =
        num(o.dustPct) > num(o.dustAllowance)
          ? (num(o.netWeight) * (num(o.dustPct) - num(o.dustAllowance))) / 100
          : 0;
      o.actualMoisture =
        num(o.moisturePct) > num(o.moistureAllowance)
          ? (num(o.netWeight) * (num(o.moisturePct) - num(o.moistureAllowance))) / 100
          : 0;
      o.payableWeight = num(o.netWeight) - num(o.actualDust) - num(o.actualMoisture);
      o.amount = num(o.payableWeight) * num(o.rate);
      o.netPayableAmount = num(o.amount) - num(o.weighbridgeCharges);
      o.shiftPayableWeight =
        String(o.shiftingApplicable || "").toUpperCase() === "YES" ? num(o.netWeight) : 0;
      o.shiftAmount = num(o.shiftPayableWeight) * num(o.shiftRate);
      o.shiftFinalPayment = num(o.shiftAmount) - num(o.shiftWeighbridge);
      o.finalBiomassValue = num(o.netPayableAmount) + num(o.shiftFinalPayment);
      return o;
    },
    [kind, plant, plants]
  );

  // `__ri` is the row's index in `rows`: the vendor filter shows a subset,
  // and an edit must land on the row being edited, not on whatever row
  // happens to sit at the same position in the full list.
  const computed = useMemo(() => rows.map((r, idx): Record<string, any> => ({ ...compute(r), __ri: idx })), [rows, compute]);

  const visible = useMemo(() => {
    const q = vendorFilter.trim().toUpperCase();
    if (!q) return computed;
    return computed.filter((r) => String(r.vendorCode ?? "").toUpperCase().includes(q));
  }, [computed, vendorFilter]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) {
      if (c.type !== "number") continue;
      t[c.key] = visible.reduce((s, r) => s + num(r[c.key]), 0);
    }
    return t;
  }, [columns, visible]);

  function addRow() {
    setRows((r) => [...r, { srNo: r.length + 1, date: new Date().toISOString().slice(0, 10) }]);
  }

  function setCell(index: number, key: string, value: any) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

    // A check describes the row as it was when it ran. Change one of the
    // compared fields and the old verdict is no longer about this row, so
    // it is dropped rather than left showing a stale tick.
    if (COMPARED.includes(key)) {
      setChecks((c) => {
        if (!(index in c)) return c;
        const next = { ...c };
        delete next[index];
        return next;
      });
      // A newly attached slip is checked immediately — that is the whole
      // point of the automation; nobody should have to remember to ask.
      const uploadKey = columns.find((c) => c.kind === "upload")?.key;
      if (key === uploadKey && String(value).includes("::")) {
        const row = { ...rows[index], kantaParchi: value };
        window.setTimeout(() => verifyRow(index, row), 60);
      }
    }
  }

  async function exportSheet() {
    if (!rows.length) {
      notify({ kind: "warning", title: "Nothing to export", detail: "Add at least one row first." });
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/plant-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, plant, rows, vendorCode: vendorFilter.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}${vendorFilter ? " - " + vendorFilter : ""}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => a.remove(), 4000);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      notify({
        kind: "success",
        title: "Exported",
        detail: "The formulas are live in the file — change a weight and the totals follow.",
      });
    } catch (err) {
      notify({ kind: "warning", title: "Export failed", detail: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-biome-line bg-white/[0.03] px-2 py-1 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/40";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-biome-text">{title}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">{subtitle}</p>
          {readOnly && (
            <p className="mt-1.5 inline-block rounded-lg border border-sky-500/30 bg-sky-500/[.07] px-2.5 py-1 text-[11px] text-sky-700">
              Read-only — the plant manager enters this sheet. You can write in the Accounts remarks column.
            </p>
          )}
          {kind === "transport" && match?.summary && (
            <p className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
              <span className="font-semibold text-biome-text">Coordination match:</span>
              <span className="text-emerald-600">✓ {match.summary.matched} matched</span>
              <span className="text-amber-600">⚠ {match.summary.weightDiffers} weight differs</span>
              <span className="text-rose-500">✗ {match.summary.unmatched} not in coordination</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {kind === "biomass" && !readOnly && (
            <PremiumButton variant="ghost" onClick={() => setImportOpen((o) => !o)}>
              <Upload size={13} /> Import vendors
            </PremiumButton>
          )}
          {!readOnly && (
          <PremiumButton variant="ghost" onClick={addRow}>
            <Plus size={13} /> Add row
          </PremiumButton>
          )}
          <PremiumButton onClick={exportSheet} disabled={exporting}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Export to Excel
          </PremiumButton>
        </div>
      </div>

      {importOpen && (
        <GlassCard className="p-4">
          <p className="text-[12px] font-medium text-biome-text">
            Vendor list for {plants.find((p) => p.id === plant)?.name || plant}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-biome-muted">
            Copy the two columns straight out of Excel and paste them here — code first, then name.
            Each plant keeps its own list, so a Rewari code can never be picked on a Gangakhed row.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={"BIO01\tAMAN MAYAN\nBIO02\tAMAN KHALETA\nBIO03\tANIL KHALETA"}
            className="mt-2 w-full rounded-xl border border-biome-line bg-biome-hover px-3 py-2 font-mono text-[11px] text-biome-text outline-none focus:border-biome-leaf/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <PremiumButton
              onClick={async () => {
                try {
                  const res = await fetch("/api/plant-data", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ what: "vendors", plant, paste }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json.error || "Import failed.");
                  setVendors(
                    (await (await fetch(`/api/plant-data?what=vendors&plant=${plant}`)).json()).vendors || []
                  );
                  notify({
                    kind: "success",
                    title: `${json.total} vendor(s) on file`,
                    detail: `${json.added} added, ${json.updated} updated.`,
                  });
                  setPaste("");
                  setImportOpen(false);
                } catch (err) {
                  notify({ kind: "warning", title: "Couldn't import", detail: (err as Error).message });
                }
              }}
              disabled={!paste.trim()}
            >
              <Upload size={13} /> Import
            </PremiumButton>
            <span className="text-[11px] text-biome-muted">
              {vendors.length} vendor(s) already on file
            </span>
          </div>
        </GlassCard>
      )}

      <GlassCard className="flex flex-wrap items-center gap-3 p-3">
        {/* Transport is per-plant exactly as biomass is — the switcher was
            hidden here, which made one plant's trips look like the only
            trips there were. The server already scopes both. */}
        {plants.length > 0 && (
          <div className="flex gap-1.5">
            {plants.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlant(p.id)}
                className={`rounded-xl border px-3 py-1.5 text-[11.5px] transition-colors ${
                  plant === p.id
                    ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leafBright"
                    : "border-biome-line text-biome-muted hover:text-biome-text"
                }`}
              >
                {p.name}
                <span className="ml-1 text-[10px] text-biome-muted">{p.state}</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Filter size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            placeholder="Filter by vendor code — exports just that vendor"
            className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
          />
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-biome-muted">
          <Calculator size={12} /> {visible.length} row{visible.length === 1 ? "" : "s"}
        </span>
        <span className="text-[10.5px] text-biome-muted">
          {saving ? "Saving…" : savedAt ? `Saved ${savedAt.toLocaleTimeString("en-IN")}` : "Saved automatically"}
        </span>
      </GlassCard>

      {/* One place to see every slip problem, so a manager does not have to
          scroll the sheet hunting for red cells. */}
      {(() => {
        const problems = Object.entries(checks).filter(
          ([, c]: any) => c?.error || (c?.verification && !c.verification.ok)
        );
        if (problems.length === 0) return null;
        const wrongSlips = problems.filter(([, c]: any) => c?.verification?.wrongSlipSuspected).length;
        return (
          <GlassCard className="border border-rose-500/30 bg-rose-500/[.06] p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
              <ShieldAlert size={14} className="text-rose-500" />
              {problems.length} row{problems.length > 1 ? "s don't" : " doesn't"} match the weight slip
              {wrongSlips > 0 && ` · ${wrongSlips} may have the wrong slip attached`}
            </p>
            <ul className="mt-2 space-y-2">
              {problems.slice(0, 8).map(([idx, c]: any) => (
                <li key={idx} className="text-[10.5px] leading-relaxed text-biome-muted">
                  <span className="font-semibold text-biome-text">Row {Number(idx) + 1}</span> —{" "}
                  {c.error || c.verification?.summary}
                  {/* Why, not just what. Without this the message reads as
                      "scanning failed" and nobody can act on it. */}
                  {Array.isArray(c.diagnostics) && c.diagnostics.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {c.diagnostics.map((d: string, k: number) => (
                        <li key={k} className="list-disc text-[10px] text-biome-muted/85">{d}</li>
                      ))}
                    </ul>
                  )}
                  {c.scan && (
                    <p className="mt-1 pl-3 text-[9.5px] text-biome-muted/70">
                      Scanned {c.scan.words} words in {c.scan.seconds}s · read{" "}
                      {[
                        c.scan.found.vehicleNo && `vehicle ${c.scan.found.vehicleNo}`,
                        c.scan.found.grossWeight !== null && `gross ${c.scan.found.grossWeight}`,
                        c.scan.found.tareWeight !== null && `tare ${c.scan.found.tareWeight}`,
                        c.scan.found.netWeight !== null && `net ${c.scan.found.netWeight}`,
                      ].filter(Boolean).join(", ") || "nothing"}
                    </p>
                  )}
                  {c.readableText && (
                    <details className="mt-1 pl-3">
                      <summary className="cursor-pointer text-[9.5px] text-biome-leaf">
                        Show what the scan actually read
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-biome-line bg-biome-bg p-2 text-[9px] leading-relaxed text-biome-muted">
                        {c.readableText}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-biome-muted">
              Correct the entry, or attach the right slip. Shifting figures are not checked against
              the weighbridge — those are yours to enter.
            </p>
          </GlassCard>
        );
      })()}

      {loading ? (
        <GlassCard className="flex items-center justify-center gap-2 py-16 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Loading the sheet layout…
        </GlassCard>
      ) : visible.length === 0 ? (
        <GlassCard className="px-6 py-16 text-center">
          <p className="font-display text-sm font-medium text-biome-text">Nothing entered yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-biome-muted">
            Add a row and fill in the white cells. The shaded ones work themselves out — net weight,
            deductions, amounts — the same way they do in the workbook.
          </p>
          <div className="mt-3">
            <PremiumButton onClick={addRow}>
              <Plus size={13} /> Add the first row
            </PremiumButton>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-biome-surface">
                <tr className="border-b border-biome-line">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      title={c.hint}
                      className={`whitespace-nowrap px-2 py-2 text-[9.5px] font-medium uppercase tracking-wider ${
                        c.kind === "derived" ? "text-biome-leafBright" : "text-biome-muted/70"
                      }`}
                      style={{ minWidth: c.width || 110 }}
                    >
                      {c.label}
                      {c.kind === "derived" && <span className="ml-1 normal-case">ƒ</span>}
                    </th>
                  ))}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const i: number = row.__ri;
                  const check = checks[i];
                  const bad = new Map<string, any>(
                    (check?.verification?.checks || [])
                      .filter((x: any) => x.status === "mismatch")
                      .map((x: any) => [x.field, x])
                  );
                  return (
                  <tr key={i} className="border-b border-biome-line/40 hover:bg-biome-hover">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        title={bad.get(c.key)?.message}
                        className={`px-2 py-1 ${
                          bad.has(c.key) ? "bg-rose-500/12 ring-1 ring-inset ring-rose-500/40" : ""
                        }`}
                      >
                        {readOnly && c.kind === "entry" && c.key !== "accountsRemarks" ? (
                          <span className={`block px-2 py-1 ${c.type === "number" ? "text-right font-mono tabular-nums" : ""} text-biome-text`}>
                            {c.type === "number" && row[c.key] !== "" && row[c.key] != null ? Number(row[c.key]).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(row[c.key] ?? "")}
                          </span>
                        ) : c.kind === "derived" ? (
                          <span className="block px-2 py-1 text-right font-mono tabular-nums text-biome-leafBright">
                            {Number(row[c.key] || 0).toLocaleString("en-IN", {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        ) : c.kind === "upload" ? (
                          <UploadCell
                            value={String(row[c.key] ?? "")}
                            plant={plant}
                            onChange={(v) => setCell(i, c.key, v)}
                          />
                        ) : c.type === "yesno" ? (
                          <select
                            value={row[c.key] ?? ""}
                            onChange={(e) => setCell(i, c.key, e.target.value)}
                            className={inputCls}
                          >
                            <option value="">—</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        ) : c.suggest ? (
                          <PartnerCombo
                            value={String(row[c.key] ?? "")}
                            field={c.suggestField || "name"}
                            options={optionsFor(c)}
                            kindsLabel={kindsOf(c).map((k) => KIND_PLURAL[k]).join(" / ")}
                            onOpen={refreshIfStale}
                            onChange={(v) => {
                              setCell(i, c.key, v);
                              // An exact registered code (or name) fills the other
                              // half by itself — no need to open the list.
                              if (!c.pairKey || !columns.some((c2) => c2.key === c.pairKey)) return;
                              const isCode = (c.suggestField || "name") === "code";
                              const opts = optionsFor(c);
                              const resolve = (val: string): ComboOption | null => {
                                const s = val.trim().toLowerCase();
                                if (!s) return null;
                                const hits = opts.filter((o) => (isCode ? o.code.toLowerCase() === s : o.name.toLowerCase() === s));
                                const distinct = new Set(hits.map((o) => `${o.code.toUpperCase()}|${o.name.toLowerCase()}`));
                                return distinct.size === 1 ? hits[0] : null;
                              };
                              const otherOf = (o: ComboOption) => (isCode ? o.name : o.code);
                              const before = resolve(String(row[c.key] ?? ""));
                              const now = resolve(v);
                              const pairVal = String(row[c.pairKey] ?? "");
                              const pairWasAuto = !pairVal || (before !== null && otherOf(before) === pairVal);
                              if (now && otherOf(now)) {
                                // A code names one vendor, so it always sets the name;
                                // a name only fills a code nobody typed by hand.
                                if (isCode || pairWasAuto) setCell(i, c.pairKey, otherOf(now));
                                if (isCode && now.code !== v) setCell(i, c.key, now.code);
                              } else if (before && pairVal && pairVal === otherOf(before)) {
                                // The code no longer matches — don't leave the old
                                // vendor's name sitting next to it.
                                setCell(i, c.pairKey, "");
                              }
                            }}
                            onPick={(o) => {
                              const isCode = (c.suggestField || "name") === "code";
                              setCell(i, c.key, isCode ? o.code : o.name);
                              // Fill the other half too — it is the same fact,
                              // and typing it twice invites the two to differ.
                              if (c.pairKey && columns.some((c2) => c2.key === c.pairKey)) {
                                const other = isCode ? o.name : o.code;
                                if (other) setCell(i, c.pairKey, other);
                              }
                            }}
                            className={inputCls}
                          />
                        ) : (c as any).unit === "kg" ? (
                          // Weight: type kg, "284 qtl" or "28.4 MT" — stored in kg on leaving the cell.
                          <input
                            type="text"
                            inputMode="decimal"
                            title="Kg. You can also type 284 qtl or 28.4 MT — it is converted to kg."
                            value={row[c.key] ?? ""}
                            onChange={(e) => setCell(i, c.key, e.target.value)}
                            onBlur={(e) => {
                              const raw = e.target.value;
                              const kg = toKg(raw, { vehicle: true });
                              const note = conversionNote(raw, kg);
                              if (kg !== null && note) {
                                setCell(i, c.key, kg);
                                notify({ kind: "success", title: "Converted to kg", detail: `${c.label}: ${note}` });
                              }
                            }}
                            className={`${inputCls} text-right font-mono`}
                          />
                        ) : (
                          <input
                            type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
                            value={row[c.key] ?? ""}
                            onChange={(e) => setCell(i, c.key, e.target.value)}
                            className={`${inputCls} ${c.type === "number" ? "text-right font-mono" : ""}`}
                          />
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1">
                      {kind === "transport" && match && <CoordMatch row={row} statuses={match.statuses} flags={match.flags || {}} onNoted={loadMatch} />}
                      {columns.some((c) => c.kind === "upload") && (
                        <button
                          onClick={() => verifyRow(i, row)}
                          disabled={checking === i}
                          title={
                            check?.error
                              ? check.error
                              : check?.verification
                              ? check.verification.summary
                              : "Read the attached weight slip and check it against this row"
                          }
                          className={`mr-1 rounded-lg p-1 transition-colors ${
                            check?.verification?.ok
                              ? "text-emerald-500 hover:bg-emerald-500/10"
                              : check?.verification || check?.error
                              ? "text-rose-500 hover:bg-rose-500/10"
                              : "text-biome-muted hover:bg-biome-hover hover:text-biome-text"
                          }`}
                        >
                          {checking === i ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : check?.verification?.ok ? (
                            <ShieldCheck size={12} />
                          ) : check?.verification || check?.error ? (
                            <ShieldAlert size={12} />
                          ) : (
                            <ScanLine size={12} />
                          )}
                        </button>
                      )}
                      {!readOnly && <button
                        onClick={() => setRows((r) => r.filter((_, x) => x !== i))}
                        className="rounded-lg p-1 text-biome-muted transition-colors hover:bg-biome-hover hover:text-rose-400"
                      >
                        <Trash2 size={12} />
                      </button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-biome-surface">
                <tr className="border-t-2 border-biome-line">
                  {columns.map((c, idx) => (
                    <td key={c.key} className="px-2 py-2">
                      {idx === 0 ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-biome-muted">
                          Total
                        </span>
                      ) : c.type === "number" ? (
                        <span className="block text-right font-mono text-[11px] font-semibold tabular-nums text-biome-text">
                          {totals[c.key]?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </span>
                      ) : null}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </GlassCard>
      )}

      <p className="px-1 text-[10.5px] leading-relaxed text-biome-muted">
        Columns marked <span className="text-biome-leafBright">ƒ</span> are worked out from the
        others and can&apos;t be typed into. The exported file carries those as real Excel formulas,
        so correcting a weight there updates everything that depends on it.
      </p>
    </div>
  );
}


/** ✓ / ⚠ / ✗ against the coordination manufacturing register, for one dispatch row. */
function CoordMatch({ row, statuses, flags, onNoted }: { row: Record<string, any>; statuses: Record<string, string>; flags: Record<string, any>; onNoted: () => void }) {
  const purpose = String(row.tripPurpose || "").trim();
  const vehicle = String(row.vehicleNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const date = String(row.date || "").slice(0, 10);
  if ((purpose && !/^supply$/i.test(purpose)) || !vehicle || !date) return null;
  const st = statuses[`${date}|${vehicle}`];
  const [txt, cls, tip] =
    st === "matched" ? ["✓ Coord.", "text-emerald-600 border-emerald-500/35 bg-emerald-500/10", "Found in the coordination manufacturing register"]
    : st === "weight_differs" ? ["⚠ Wt", "text-amber-600 border-amber-500/35 bg-amber-500/10", "Vehicle and date match coordination, but the weight differs"]
    : ["✗ Coord.", "text-rose-500 border-rose-500/35 bg-rose-500/10", "Not in the coordination manufacturing register yet (same vehicle, date ±1 day)"];
  const flag = flags[`${date}|${vehicle}`];
  return (
    <>
      <span title={tip} className={`mr-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${cls}`}>{txt}</span>
      {flag && <MismatchFlag flag={flag} onNoted={onNoted} />}
    </>
  );
}

