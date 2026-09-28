"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Truck, Plus, Loader2, AlertCircle, Check, Download, Search, Filter,
  TrendingDown, PackageCheck, Clock, ShieldAlert, Building2, Users,
  Lock, Unlock, FileText, Receipt, Upload, Hash, ChevronRight, X,
  CircleDollarSign, Factory, Handshake, KeyRound, Link2, Paperclip, RefreshCw, Mail,
} from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";
import DevEditedChip from "@/components/DevEditedChip";
import { EmptyState } from "@/components/SetupGuide";
import MismatchFlag from "@/components/plant/MismatchFlag";
import { toKg, conversionNote } from "@/lib/units";

/**
 * Supply coordination.
 *
 * Two registers, not one. Trading rows carry a vendor; manufacturing rows
 * are our own material and have no vendor at all — putting them in one
 * list made the per-supplier shortfall table read as if BIOME were losing
 * weight to itself.
 *
 * The document number is the other change. Every supply now moves on
 * either a tax invoice or a delivery challan, and the number comes from a
 * book seeded out of their own workbook rather than being typed.
 */

const kg = (n: number) => `${Math.round(n).toLocaleString("en-IN")} kg`;
const money = (n: number) =>
  n >= 10000000 ? `₹${(n / 10000000).toFixed(2)} Cr`
  : n >= 100000 ? `₹${(n / 100000).toFixed(2)} L`
  : `₹${Math.round(n).toLocaleString("en-IN")}`;

type Business = "trading" | "manufacturing";
type DocType = "tax_invoice" | "delivery_challan";

interface Shortage {
  dispatched: number; received: number; differenceKg: number; differencePct: number;
  allowanceKg: number; excessKg: number;
  verdict: "ok" | "excess" | "shortage" | "pending"; message: string;
}
interface LockState {
  locked: boolean; freezesAt: string; daysLeft: number; grantedUntil: string; reason: string;
}
interface Billing {
  invoiceDate: string; invoiceWeightKg: number; taxableAmount: number;
  taxAmount: number; totalAmount: number; source: string; importedAt: string; importedBy: string;
}
interface Trip {
  id: string; serial: number; business: Business;
  docType: DocType; seriesId: string; ourDocNo: string; ourDocDate: string; ourDocManual: boolean;
  client: string; location: string; poNumber: string; poDate: string; vendorPoId?: string | null; clientPoId?: string | null;
  supplier: string; supplierCode: string; vendorDocType: DocType | "";
  vehicleNumber: string; vehicleEntryDate: string;
  vendorChallanNo: string; vendorChallanDate: string; vendorInvoiceNo: string;
  referenceNo?: string;
  vendorChallanWeight: number; vendorChallanAmount: number;
  receivingDate: string; receivingQty: number; ccWeight: number;
  debitNoteNo: string; creditNoteNo: string; billing: Billing;
  status: string; cancellationReason: string; remarks: string; checklistRemarks: string;
  shortage: Shortage; derived: string; gaps: string[]; lock: LockState;
  pendingRequest: { id: string; by: string; at: string } | null;
}
interface PoNumber {
  id: string; number: string; date: string; validTill: string;
  quantityMt: number; location: string; notes: string; active: boolean;
}
interface ClientOption {
  name: string; shortName: string; needsSetup: boolean; poNumbers: PoNumber[];
}
interface SeriesOption {
  id: string; name: string; docType: DocType; business: string;
  pattern: string; clientHints: string[]; next: string; method?: "automatic" | "auto_manual_override" | "manual";
}

const VERDICT: Record<string, [string, string]> = {
  ok: ["Within tolerance", "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"],
  shortage: ["Short", "border-rose-500/35 bg-rose-500/10 text-rose-500"],
  excess: ["Over", "border-amber-500/35 bg-amber-500/10 text-amber-600"],
  pending: ["Awaiting receiving", "border-biome-line text-biome-muted"],
};

const blank = {
  docType: "delivery_challan" as DocType, seriesId: "", ourDocNo: "", ourDocDate: "",
  client: "", location: "", poNumber: "", poDate: "", vendorPoId: "", clientPoId: "",
  supplier: "", supplierCode: "", vendorDocType: "" as DocType | "",
  vehicleNumber: "", vehicleEntryDate: new Date().toISOString().slice(0, 10),
  vendorChallanNo: "", vendorChallanDate: "", vendorInvoiceNo: "", referenceNo: "",
  vendorChallanWeight: "", vendorChallanAmount: "",
  receivingDate: "", receivingQty: "", ccWeight: "",
  debitNoteNo: "", creditNoteNo: "",
  status: "planned", cancellationReason: "", remarks: "", checklistRemarks: "",
};

export default function CoordinationPage() {
  const [business, setBusiness] = useState<Business>("trading");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [form, setForm] = useState<any>({ ...blank });
  const [issueOnSave, setIssueOnSave] = useState(false);
  // Re-number an entry whose document type / series changed after its
  // number was taken (old number is voided, never reused).
  const [reissue, setReissue] = useState(false);
  const [filters, setFilters] = useState({ month: "", client: "", supplier: "", status: "all", docType: "all", search: "" });
  const [requestFor, setRequestFor] = useState<Trip | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const [showSeries, setShowSeries] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ business });
      Object.entries(filters).forEach(([k, v]) => { if (v && v !== "all") p.set(k, String(v)); });
      const res = await fetch(`/api/coordination?${p}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      setError(null);
    } catch (err) { setError((err as Error).message); }
  }, [filters, business]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => { load(); loadMatch(); });
  useEffect(() => { load(); }, [load]);

  // Plant dispatch match: for the manufacturing register, whether each
  // trip's vehicle also appears in the plant's own dispatch sheet. Only the
  // verdict comes back — never the plant's figures.
  const [match, setMatch] = useState<{ statuses: Record<string, string>; flags?: Record<string, any>; flagged?: number; summary: any } | null>(null);
  const loadMatch = useCallback(async () => {
    if (business !== "manufacturing") { setMatch(null); return; }
    try {
      const res = await fetch("/api/plant-match?side=coordination", { cache: "no-store" });
      if (res.ok) setMatch(await res.json());
    } catch { /* the badge is a hint; the register works without it */ }
  }, [business]);
  useEffect(() => { loadMatch(); }, [loadMatch]);

  // WhatsApp paperwork linked to each trip (by reference, doc numbers or
  // vehicle + date) — counts for the register's badges.
  const [docSummary, setDocSummary] = useState<Record<string, { docs: number; warnings: number; missing: number }>>({});
  const loadDocSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/coordination/documents?summary=1&business=${business}`, { cache: "no-store" });
      if (res.ok) setDocSummary((await res.json()).summary || {});
    } catch { /* badges are a hint */ }
  }, [business]);
  useEffect(() => { loadDocSummary(); }, [loadDocSummary, data]);

  const clients: ClientOption[] = data?.options?.clients || [];
  const series: SeriesOption[] = data?.series || [];

  const selectedClient = useMemo(
    () => clients.find((c) => c.name === form.client),
    [clients, form.client]
  );

  /** Series that fit the document type, with the client's own book first. */
  const seriesChoices = useMemo(() => {
    const fit = series.filter(
      (s) => s.docType === form.docType && (s.business === "both" || s.business === business)
    );
    const name = (form.client || "").trim().toLowerCase();
    if (!name) return fit;
    return [...fit].sort((a, b) => {
      const hit = (s: SeriesOption) =>
        s.clientHints.some((h) => {
          const hint = h.trim().toLowerCase();
          return hint && (hint === name || name.includes(hint) || hint.includes(name));
        }) ? 0 : 1;
      return hit(a) - hit(b);
    });
  }, [series, form.docType, form.client, business]);

  // Pre-select the book the client normally uses, but never overwrite a
  // choice already made — a picker that keeps resetting is worse than one
  // that never helps.
  useEffect(() => {
    if (editing?.ourDocNo) return;
    if (form.seriesId && seriesChoices.some((s) => s.id === form.seriesId)) return;
    if (seriesChoices.length) setForm((f: any) => ({ ...f, seriesId: seriesChoices[0].id }));
  }, [seriesChoices, form.seriesId, editing]);

  function startAdd() {
    setReissue(false);
    setEditing(null);
    setForm({ ...blank });
    setIssueOnSave(false);
    setOpen(true);
  }

  function edit(t: Trip) {
    setReissue(false);
    if (t.lock.locked && !data?.canApprove) { setRequestFor(t); return; }
    setEditing(t);
    setIssueOnSave(false);
    setForm({
      ...blank, ...t,
      vendorChallanWeight: String(t.vendorChallanWeight || ""),
      vendorPoId: (t as any).vendorPoId || "", clientPoId: (t as any).clientPoId || "",
      vendorChallanAmount: String(t.vendorChallanAmount || ""),
      receivingQty: String(t.receivingQty || ""),
      ccWeight: String(t.ccWeight || ""),
    });
    setOpen(true);
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/coordination", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          business,
          issueNumber: issueOnSave && !form.ourDocNo, reissue,
          ...(editing ? { id: editing.id } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.poWarning && res.status === 409 && window.confirm(`${json.error}\n\nOverride with manager approval and save anyway?`)) {
          const again = await fetch(editing ? "/api/coordination" : "/api/coordination", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, business, issueNumber: issueOnSave && !form.ourDocNo, reissue, ...(editing ? { id: editing.id } : {}), poOverride: true }) });
          const j2 = await again.json().catch(() => ({}));
          if (!again.ok) throw new Error(j2.error || `Failed (${again.status}).`);
        } else throw new Error(json.error || `Failed (${res.status}).`);
      }
      setOpen(false); setEditing(null); setForm({ ...blank }); setIssueOnSave(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const trips: Trip[] = data?.trips || [];
  const s = data?.summary;
  const manufacturing = business === "manufacturing";

  // Live preview while typing, so the difference is visible before saving.
  const preview = (() => {
    const d = Number(form.vendorChallanWeight) || 0;
    const r = Number(form.receivingQty) || 0;
    if (!d || !r) return null;
    const gkd = /gangakhed|gkd/i.test(form.location || "");
    const allowance = Math.round(d * 0.005) + 50 + (gkd ? 500 : 0);
    const diff = d - r;
    return { diff, allowance, over: diff > allowance, gkd };
  })();

  const chosenSeries = seriesChoices.find((x) => x.id === form.seriesId);
  const chosenMethod = chosenSeries?.method || "auto_manual_override";
  // Tally-style: an automatic series takes its number on save by default;
  // a manual one never does. Follows every change of type or series.
  useEffect(() => {
    if (form.ourDocNo && editing?.ourDocNo) return;
    setIssueOnSave(chosenMethod !== "manual");
  }, [form.seriesId, chosenMethod]); // eslint-disable-line react-hooks/exhaustive-deps
  const seriesChanged = Boolean(editing?.ourDocNo && (form.seriesId !== editing.seriesId || form.docType !== editing.docType));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Truck size={19} className="text-biome-leaf" /> Coordination
          </h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
            {manufacturing
              ? "Our own material out to the client, on our invoice or our challan."
              : "Every trip from vendor to client, and the weight that went missing on the way."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.canApprove && data?.pendingRequests > 0 && (
            <button onClick={() => setShowApprovals(true)}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[11.5px] font-semibold text-amber-600">
              <KeyRound size={13} /> {data.pendingRequests} edit request{data.pendingRequests === 1 ? "" : "s"}
            </button>
          )}
          {data?.canEdit && (
            <button onClick={() => setShowImport(true)}
              className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted">
              <Upload size={13} /> Import from Tally
            </button>
          )}
          <a href={`/api/coordination/export?business=${business}${filters.month ? `&month=${filters.month}` : ""}`}
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted">
            <Download size={13} /> Excel
          </a>
          {data?.canEdit && (
            <button onClick={startAdd}
              className="bmx-btn relative flex items-center gap-2 overflow-hidden rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
              <span className="bmx-btn-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
                style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)" }} />
              <Plus size={14} /> Add a trip
            </button>
          )}
        </div>
      </header>

      <RegisterTabs value={business} onChange={(v) => { setBusiness(v); setData(null); }} />

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {/* ---- The next numbers, always visible ---- */}
      {series.length > 0 && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
              <Hash size={14} className="text-biome-leaf" /> Next document numbers
            </h2>
            <div className="flex items-center gap-3">
              <p className="text-[10px] text-biome-muted">
                Taken from the coordination workbook. A number, once issued, is never reused.
              </p>
              {data?.canManageSeries && (
                <button onClick={() => setShowSeries(true)}
                  className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1 text-[10px] font-semibold text-biome-muted">
                  Manage
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {series.map((x) => (
              <div key={x.id} className="bmx-card rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">
                  {x.docType === "tax_invoice" ? <Receipt size={11} /> : <FileText size={11} />} {x.name}
                </p>
                <p className="bmx-next mt-1 font-mono text-[13px] font-semibold text-biome-text">{x.next}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- The numbers ---- */}
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={<Truck size={15} />} label="Trips" value={String(s.trips)}
            hint={`${s.pendingReceiving} awaiting receiving`} tone="text-sky-600 bg-sky-500/12" />
          <Tile icon={<PackageCheck size={15} />} label="Dispatched" value={kg(s.dispatchedKg)}
            hint={`received ${kg(s.receivedKg)}`} tone="text-emerald-600 bg-emerald-500/12" />
          <Tile icon={<TrendingDown size={15} />} label="Shortfall" value={kg(s.shortfallKg)}
            hint={`${s.shortageTrips} trip${s.shortageTrips === 1 ? "" : "s"} beyond tolerance`}
            tone={s.shortfallKg > 0 ? "text-rose-500 bg-rose-500/12" : "text-emerald-600 bg-emerald-500/12"}
            accent={s.shortfallKg > 0} />
          <Tile icon={<CircleDollarSign size={15} />} label="Billed" value={money(s.billedTotal)}
            hint={s.awaitingBilling ? `${s.awaitingBilling} not billed yet` : `${s.billedTrips} invoiced`}
            tone="text-violet-600 bg-violet-500/12" />
        </div>
      )}

      {/* ---- Who is losing the weight ---- */}
      {(() => {
        const bad = (data?.trips || []).filter((t: Trip) => docSummary[t.id]?.warnings);
        if (!bad.length) return null;
        return (
          <div className="rounded-2xl border border-amber-500/35 bg-amber-500/[.06] px-4 py-3">
            <p className="text-[12px] font-semibold text-amber-600">⚠ WhatsApp documents disagree with the register ({bad.length} supply{bad.length === 1 ? "" : "s"})</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {bad.slice(0, 20).map((t: Trip) => (
                <button key={t.id} onClick={() => edit(t)} className="rounded-full border border-amber-500/40 px-2.5 py-0.5 text-[10.5px] font-semibold text-amber-700">
                  #{t.serial} {t.vehicleNumber || t.ourDocNo || t.client} · {docSummary[t.id].warnings} difference(s)
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {manufacturing && match?.summary && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3 text-[11.5px]">
          <span className="font-semibold text-biome-text">Plant dispatch match</span>
          <span className="text-emerald-600">✓ {match.summary.matched} matched</span>
          <span className="text-amber-600">⚠ {match.summary.weightDiffers} weight differs</span>
          <span className="text-rose-500">✗ {match.summary.unmatched} not in plant sheet</span>
          <span className="text-[10.5px] text-biome-muted">Same plant (from Location), same vehicle, date ±1 day. Only the verdict is shared — not the plant&rsquo;s data.</span>
        </div>
      )}
      {(data?.bySupplier || []).some((p: any) => p.shortfallKg > 0) && !manufacturing && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PartyCard title="Shortfall by supplier" icon={<Users size={15} />} rows={data.bySupplier} />
          <PartyCard title="Shortfall by client" icon={<Building2 size={15} />} rows={data.byClient} />
        </div>
      )}

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-biome-muted" />
        <select value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} className={selectCls}>
          <option value="">All months</option>
          {(data?.options?.months || []).map((m: string) => (
            <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</option>
          ))}
        </select>
        <select value={filters.docType} onChange={(e) => setFilters({ ...filters, docType: e.target.value })} className={selectCls}>
          <option value="all">Invoice and challan</option>
          <option value="tax_invoice">Tax invoice only</option>
          <option value="delivery_challan">Delivery challan only</option>
        </select>
        {!manufacturing && (
          <select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })} className={selectCls}>
            <option value="">All suppliers</option>
            {(data?.options?.vendors || []).map((v: any) => <option key={v.code} value={v.name}>{v.name}</option>)}
            {(data?.options?.unlistedSuppliers || []).map((x: string) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })} className={selectCls}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          {(data?.options?.unlistedClients || []).map((x: string) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={selectCls}>
          <option value="all">Every status</option>
          {(data?.statuses || []).map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Vehicle, challan, invoice or PO"
            className="bmx-input w-[240px] rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none" />
        </div>
      </div>

      {/* ---- The register ---- */}
      {data && trips.length === 0 ? (
        <EmptyState
          title={Object.values(filters).some((f) => f && f !== "all") ? "Nothing matches those filters" : `No ${business} trips recorded yet`}
          detail={manufacturing
            ? "Manufacturing rows are our own material — no vendor, no vendor challan. Add a trip when the vehicle is loaded, then fill the receiving weight when the client confirms."
            : "Add a trip as the vehicle is loaded, then fill the receiving weight when the client confirms. The difference between the two is what this register exists to catch."}
          action={data.canEdit ? { label: "Add the first trip", onClick: startAdd } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {trips.map((t, i) => {
            const [vLabel, vCls] = VERDICT[t.shortage.verdict] || VERDICT.pending;
            return (
              <article key={t.id}
                onClick={() => data.canEdit && edit(t)}
                className={`bmx-row-in bmx-card cursor-pointer overflow-hidden rounded-2xl border bg-biome-bgSoft ${
                  t.shortage.verdict === "shortage" ? "border-rose-500/35" : "border-biome-line"
                } ${t.lock.locked ? "bmx-frozen" : ""}`}
                style={{ animationDelay: `${Math.min(i, 12) * 0.025}s` }}>
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <span className="font-mono text-[10px] text-biome-muted">#{t.serial}</span>
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-semibold text-biome-text">
                        {manufacturing ? "BIOME" : (t.supplier || "—")} <span className="text-biome-muted">→</span> {t.client || "—"}
                      </p>
                      <DocBadge type={t.docType} number={t.ourDocNo} />
                      {docSummary[t.id] && (
                        <span title={`${docSummary[t.id].docs} WhatsApp document(s) linked · ${docSummary[t.id].missing} paper(s) missing · ${docSummary[t.id].warnings} difference(s)`}
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${docSummary[t.id].warnings ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : docSummary[t.id].docs ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600" : "border-biome-line text-biome-muted"}`}>
                          📎 {docSummary[t.id].docs}{docSummary[t.id].warnings ? ` · ⚠ ${docSummary[t.id].warnings}` : ""}{docSummary[t.id].missing ? ` · ${docSummary[t.id].missing} missing` : ""}
                        </span>
                      )}
                      {manufacturing && match && <PlantMatchBadge status={match.statuses[t.id]} />}
                      {manufacturing && match?.flags?.[t.id] && <MismatchFlag flag={match.flags[t.id]} onNoted={loadMatch} />}
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${vCls}`}>
                        {vLabel}
                      </span>
                      {t.lock.locked && (
                        <span title={t.lock.reason}
                          className="flex items-center gap-1 rounded-full border border-biome-line bg-biome-bg px-1.5 py-0.5 text-[9px] font-bold text-biome-muted">
                          <Lock size={9} /> Frozen
                        </span>
                      )}
                      {t.lock.grantedUntil && (
                        <span title={t.lock.reason}
                          className="flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600">
                          <Unlock size={9} /> Open
                        </span>
                      )}
                      {t.pendingRequest && (
                        <span title={`Requested by ${t.pendingRequest.by}`}
                          className="flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          <KeyRound size={9} /> Awaiting admin
                        </span>
                      )}
                      {t.gaps.length > 0 && (
                        <span title={t.gaps.join("\n")}
                          className="flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          <ShieldAlert size={9} /> {t.gaps.length}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10.5px] text-biome-muted">
                      {t.vehicleNumber || "no vehicle"}
                      {t.vehicleEntryDate && ` · ${t.vehicleEntryDate}`}
                      {t.location && ` · ${t.location}`}
                      {t.poNumber && ` · PO ${t.poNumber}`} <DevEditedChip mark={(t as any).devEdited} compact />
                      {t.vendorChallanNo && ` · vendor challan ${t.vendorChallanNo}`}
                    </p>
                    {t.shortage.verdict !== "ok" && t.shortage.verdict !== "pending" && (
                      <p className={`mt-1.5 text-[10.5px] leading-relaxed ${
                        t.shortage.verdict === "shortage" ? "text-rose-500" : "text-amber-600"
                      }`}>
                        {t.shortage.message}
                      </p>
                    )}
                    {t.billing?.totalAmount > 0 && (
                      <p className="mt-1 text-[10px] text-biome-muted">
                        Billed {money(t.billing.totalAmount)} ({money(t.billing.taxableAmount)} + {money(t.billing.taxAmount)} tax)
                        {t.billing.invoiceWeightKg ? ` on ${kg(t.billing.invoiceWeightKg)}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-right">
                    <Fig label="Dispatched" value={t.vendorChallanWeight ? kg(t.vendorChallanWeight) : "—"} />
                    <Fig label="Received" value={t.receivingQty ? kg(t.receivingQty) : "—"} />
                    <Fig
                      label="Difference"
                      value={t.shortage.verdict === "pending" ? "—" : kg(Math.abs(t.shortage.differenceKg))}
                      tone={t.shortage.verdict === "shortage" ? "text-rose-500" : t.shortage.verdict === "excess" ? "text-amber-600" : undefined}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ---- Add / edit ---- */}
      <FormPanel
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        icon={manufacturing ? <Factory size={20} /> : <Truck size={20} />}
        eyebrow={editing ? `${manufacturing ? "Manufacturing" : "Trading"} · trip #${editing.serial}` : `${manufacturing ? "Manufacturing" : "Trading"} · new trip`}
        title={editing ? `${editing.supplier || "BIOME"} → ${editing.client || ""}` : "Add a trip"}
        subtitle="Fill the dispatch side when the vehicle leaves, the receiving side when the client confirms."
        headerRight={
          preview ? (
            <span className={`hidden items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold sm:flex ${
              preview.over ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
            }`}>
              <TrendingDown size={13} />
              {preview.diff >= 0 ? `${kg(preview.diff)} short` : `${kg(-preview.diff)} over`}
              {preview.over && " — beyond allowance"}
            </span>
          ) : null
        }
        footer={
          <>
            <button onClick={() => { setOpen(false); setEditing(null); }}
              className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={save} disabled={busy}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} {editing ? "Save changes" : "Add trip"}
            </button>
          </>
        }
      >
        {editing?.lock?.grantedUntil && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-4 py-3">
            <p className="flex items-center gap-2 text-[11.5px] font-semibold text-emerald-600">
              <Unlock size={13} /> Opened by an admin
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
              {editing.lock.reason} Saving once uses the approval up — anything further needs a fresh one.
            </p>
          </div>
        )}

        <FormSection
          title="The document we raise"
          sectionIcon={<Receipt size={14} />}
          hint="A tax invoice and a delivery challan run separate books. The number is taken when you ask for it, and never handed out twice."
          columns={3}
        >
          <F label="Document type">
            <div className="flex gap-1.5">
              {(["delivery_challan", "tax_invoice"] as DocType[]).map((d) => (
                <button key={d} type="button"
                  onClick={() => setForm({ ...form, docType: d, seriesId: "" })}
                  className={`bmx-chip flex-1 rounded-xl border px-3 py-2.5 text-[11px] font-semibold ${
                    form.docType === d
                      ? "border-biome-leaf/50 bg-biome-leaf/10 text-biome-leaf"
                      : "border-biome-line text-biome-muted"
                  }`}>
                  {d === "tax_invoice" ? "Tax Invoice" : "Delivery Challan"}
                </button>
              ))}
            </div>
          </F>
          <F label="Number series">
            <select value={form.seriesId} onChange={(e) => setForm({ ...form, seriesId: e.target.value })} className={inputCls}>
              <option value="">Select a book…</option>
              {seriesChoices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F label="Document date">
            <input type="date" value={form.ourDocDate} onChange={(e) => setForm({ ...form, ourDocDate: e.target.value })} className={inputCls} />
          </F>

          <div className="md:col-span-2 lg:col-span-3">
            {/* An issued number shows as a badge; while typing one, the input stays. */}
            {editing?.ourDocNo ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-biome-line bg-biome-bg px-4 py-3">
                <Hash size={14} className="text-biome-leaf" />
                <span className="font-mono text-[13px] font-semibold text-biome-text">{form.ourDocNo}</span>
                <span className="text-[10px] text-biome-muted">
                  {editing?.ourDocManual ? "entered by hand" : "issued from the series"}
                </span>
                {seriesChanged && chosenSeries && (
                  <label className="ml-auto flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[.07] px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-700">
                    <input type="checkbox" checked={reissue} onChange={(e) => setReissue(e.target.checked)} />
                    Re-number from &ldquo;{chosenSeries.name}&rdquo; → {chosenSeries.next} (the old number is voided)
                  </label>
                )}
              </div>
            ) : chosenMethod === "manual" ? (
              <div className="rounded-xl border border-biome-line bg-biome-bg px-4 py-3">
                <F label={`Document number (manual series${chosenSeries ? ` — ${chosenSeries.name}` : ""})`}>
                  <input value={form.ourDocNo} onChange={(e) => setForm({ ...form, ourDocNo: e.target.value })}
                    placeholder={chosenSeries?.next || "Type the number"} className={`${inputCls} font-mono`} />
                </F>
                <p className="mt-1 text-[10px] text-biome-muted">Manual numbering: type the number printed on the document. A number already used is refused.</p>
              </div>
            ) : chosenMethod === "automatic" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-biome-leaf/35 bg-biome-leaf/[.06] px-4 py-3">
                <Hash size={14} className="text-biome-leaf" />
                <span className="font-mono text-[13px] font-semibold text-biome-text">{chosenSeries ? chosenSeries.next : "Select a series"}</span>
                <span className="text-[10.5px] text-biome-muted">Automatic numbering — taken when you save.</span>
                <label className="ml-auto flex items-center gap-1.5 text-[10.5px] text-biome-muted">
                  <input type="checkbox" checked={!issueOnSave} onChange={(e) => setIssueOnSave(!e.target.checked)} /> Save as draft without a number
                </label>
              </div>
            ) : (
              <div className="grid gap-3 rounded-xl border border-biome-line bg-biome-bg px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input type="checkbox" checked={issueOnSave} onChange={(e) => setIssueOnSave(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-leaf))]" />
                  <span>
                    <span className="block text-[11.5px] font-semibold text-biome-text">
                      Take the next number{chosenSeries ? ` — ${chosenSeries.next}` : ""}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-biome-muted">
                      Only tick this when the document is actually being raised. A number taken for a draft is a number gone.
                    </span>
                  </span>
                </label>
                <span className="hidden text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted sm:block">or</span>
                <F label="Type an existing number">
                  <input value={form.ourDocNo} onChange={(e) => setForm({ ...form, ourDocNo: e.target.value })}
                    placeholder="For rows already in the workbook" className={inputCls} />
                </F>
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Who and where" sectionIcon={<Building2 size={14} />} columns={3}>
          <F label="Client">
            <ClientPicker
              clients={clients}
              value={form.client}
              unlisted={data?.options?.unlistedClients || []}
              onChange={(name) => {
                const c = clients.find((x) => x.name === name);
                const po = c?.poNumbers?.[0];
                // One PO on the client: fill it. Several: leave the choice
                // alone rather than picking one and hoping.
                setForm((f: any) => ({
                  ...f, client: name,
                  poNumber: c && c.poNumbers.length === 1 ? po!.number : "",
                  poDate: c && c.poNumbers.length === 1 ? po!.date : "",
                  location: c && c.poNumbers.length === 1 && po!.location ? po!.location : f.location,
                }));
              }}
              onAdded={load}
            />
          </F>
          <F label="PO number">
            <PoPicker
              client={selectedClient}
              value={form.poNumber}
              onChange={(po) => setForm({ ...form, poNumber: po?.number || "", poDate: po?.date || "", location: po?.location || form.location })}
              onAdded={load}
            />
          </F>
          <F label="Vendor PO (quantity tracking)">
            <PoQuantityPicker type="vendor" party={form.supplierCode || form.supplier} value={form.vendorPoId || ""} qtyKg={Number(form.vendorChallanWeight) || 0} onChange={(id) => setForm({ ...form, vendorPoId: id })} />
          </F>
          <F label="Client PO (quantity tracking)">
            <PoQuantityPicker type="client" party={form.client} value={form.clientPoId || ""} qtyKg={Number(form.vendorChallanWeight) || 0} onChange={(id) => setForm({ ...form, clientPoId: id })} />
          </F>
          <F label="Location / site">
            <input list="locations" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Jhajjar / NPL / NTPC Mouda…" className={inputCls} />
          </F>
          <F label="Vehicle number">
            <input value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
              placeholder="RJ32GD6535" className={inputCls} />
          </F>
          <F label="Vehicle entry date">
            <input type="date" value={form.vehicleEntryDate} onChange={(e) => setForm({ ...form, vehicleEntryDate: e.target.value })} className={inputCls} />
          </F>
          {selectedClient?.needsSetup && (
            <div className="md:col-span-2 lg:col-span-1 self-end">
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-3 py-2 text-[10px] leading-relaxed text-amber-600">
                {selectedClient.name} has no document requirements set. Add them on the Clients page or its supply can never be marked complete.
              </p>
            </div>
          )}
        </FormSection>

        <datalist id="locations">{(data?.options?.locations || []).map((x: string) => <option key={x} value={x} />)}</datalist>

        {!manufacturing && (
          <FormSection
            title="The vendor's side"
            sectionIcon={<Handshake size={14} />}
            hint="A vendor supplies on their own tax invoice or on a delivery challan — say which, because it decides what we are matching their weight against."
            columns={3}
          >
            <F label="Supplier">
              <select value={form.supplier} onChange={(e) => {
                const v = (data?.options?.vendors || []).find((x: any) => x.name === e.target.value);
                setForm({ ...form, supplier: e.target.value, supplierCode: v?.code || "" });
              }} className={inputCls}>
                <option value="">Select a vendor…</option>
                {(data?.options?.vendors || []).map((v: any) => (
                  <option key={v.code} value={v.name}>{v.name} ({v.code})</option>
                ))}
                {(data?.options?.unlistedSuppliers || []).length > 0 && (
                  <optgroup label="In old rows, not in the vendor master">
                    {(data?.options?.unlistedSuppliers || []).map((x: string) => <option key={x} value={x}>{x}</option>)}
                  </optgroup>
                )}
              </select>
            </F>
            <F label="Vendor document type">
              <select value={form.vendorDocType} onChange={(e) => setForm({ ...form, vendorDocType: e.target.value })} className={inputCls}>
                <option value="">Not stated</option>
                <option value="delivery_challan">Delivery challan</option>
                <option value="tax_invoice">Tax invoice</option>
              </select>
            </F>
            <F label="Vendor code"><input value={form.supplierCode} readOnly className={`${inputCls} opacity-70`} /></F>
            <F label="Vendor challan no">
              <input value={form.vendorChallanNo} onChange={(e) => setForm({ ...form, vendorChallanNo: e.target.value })} className={inputCls} />
            </F>
            <F label="Challan date">
              <input type="date" value={form.vendorChallanDate} onChange={(e) => setForm({ ...form, vendorChallanDate: e.target.value })} className={inputCls} />
            </F>
            <F label="Vendor invoice no">
              <input value={form.vendorInvoiceNo} onChange={(e) => setForm({ ...form, vendorInvoiceNo: e.target.value })} className={inputCls} />
            </F>
          </FormSection>
        )}
        <FormSection title="Coordination reference" sectionIcon={<Link2 size={14} />} columns={2}
          hint="COMPANY / OUR DOC NO / VENDOR (or PLANT) CODE / VENDOR DOC NO — e.g. BDC/45/JSR/15. Leave empty to build it from this trip. Every WhatsApp document quoting it links here automatically, whenever it arrives.">
          <F label="Reference no">
            <input value={form.referenceNo || ""} onChange={(e) => setForm({ ...form, referenceNo: e.target.value.toUpperCase() })}
              placeholder={`${(form.ourDocNo || "").match(/(\d+)\s*$/)?.[1]?.replace(/^0+/, "") ? `BDC/${(form.ourDocNo || "").match(/(\d+)\s*$/)![1].replace(/^0+/, "")}/${manufacturing ? "REW" : (form.supplierCode || "VEN")}/${(form.vendorInvoiceNo || form.vendorChallanNo || "").match(/(\d+)\s*$/)?.[1]?.replace(/^0+/, "") || "?"}` : "BDC/45/JSR/15"}`}
              className={`${inputCls} font-mono`} />
          </F>
        </FormSection>


        <FormSection title="Dispatch — what left" sectionIcon={<PackageCheck size={14} />} columns={3}>
          <F label="Dispatch weight (KG)">
            <input type="text" inputMode="decimal" title="Kg — or type 284 qtl / 28.4 MT" value={form.vendorChallanWeight} onChange={(e) => setForm({ ...form, vendorChallanWeight: e.target.value })} onBlur={(e) => { const kg = toKg(e.target.value, { vehicle: true }); if (kg !== null && conversionNote(e.target.value, kg)) setForm((f: any) => ({ ...f, vendorChallanWeight: String(kg) })); }} className={inputCls} />
          </F>
          <F label={manufacturing ? "Value (₹)" : "Challan amount (₹)"}>
            <input type="number" value={form.vendorChallanAmount} onChange={(e) => setForm({ ...form, vendorChallanAmount: e.target.value })} className={inputCls} />
          </F>
          <F label="Debit note no">
            <input value={form.debitNoteNo} onChange={(e) => setForm({ ...form, debitNoteNo: e.target.value })} placeholder="If raised" className={inputCls} />
          </F>
        </FormSection>

        <FormSection
          title="Receiving — what arrived"
          sectionIcon={<TrendingDown size={14} />}
          hint={preview?.gkd
            ? "Gangakhed's paperwork is known to run 400–500 kg above its weighbridge, so trips from there carry an extra 500 kg allowance before anything is flagged."
            : "Tolerance is 0.5% of the dispatch weight plus 50 kg for weighbridge drift. The one-week freeze starts from this date."}
          columns={3}
        >
          <F label="Receiving date"><input type="date" value={form.receivingDate} onChange={(e) => setForm({ ...form, receivingDate: e.target.value })} className={inputCls} /></F>
          <F label="Receiving qty (KG)"><input type="text" inputMode="decimal" title="Kg — or type 284 qtl / 28.4 MT" value={form.receivingQty} onChange={(e) => setForm({ ...form, receivingQty: e.target.value })} onBlur={(e) => { const kg = toKg(e.target.value, { vehicle: true }); if (kg !== null && conversionNote(e.target.value, kg)) setForm((f: any) => ({ ...f, receivingQty: String(kg) })); }} className={inputCls} /></F>
          <F label="CC weight (KG)"><input type="text" inputMode="decimal" title="Kg — or type 284 qtl / 28.4 MT" value={form.ccWeight} onChange={(e) => setForm({ ...form, ccWeight: e.target.value })} onBlur={(e) => { const kg = toKg(e.target.value, { vehicle: true }); if (kg !== null && conversionNote(e.target.value, kg)) setForm((f: any) => ({ ...f, ccWeight: String(kg) })); }} placeholder="Client's own weighbridge" className={inputCls} /></F>
          {preview && (
            <div className="md:col-span-2 lg:col-span-3">
              <div className={`rounded-xl border px-4 py-3 ${
                preview.over ? "border-rose-500/35 bg-rose-500/[.07]" : "border-emerald-500/30 bg-emerald-500/[.07]"
              }`}>
                <p className="text-[11.5px] font-semibold text-biome-text">
                  {preview.diff >= 0
                    ? `${kg(preview.diff)} short against an allowance of ${kg(preview.allowance)}`
                    : `${kg(-preview.diff)} MORE received than dispatched — check both figures`}
                </p>
                {preview.over && (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                    This will be flagged as a shortage and appear on the &ldquo;Needs attention&rdquo; sheet
                    in the export. Record what happened in the remarks below.
                  </p>
                )}
              </div>
            </div>
          )}
        </FormSection>

        {editing?.billing?.totalAmount ? (
          <FormSection title="What we billed" sectionIcon={<CircleDollarSign size={14} />} columns={4}
            hint={`Imported from Tally by ${editing.billing.importedBy} on ${editing.billing.importedAt.slice(0, 10)}. Change it in Tally and import again rather than editing it here.`}>
            <Read label="Invoice date" value={editing.billing.invoiceDate || "—"} />
            <Read label="Invoice weight" value={editing.billing.invoiceWeightKg ? kg(editing.billing.invoiceWeightKg) : "—"} />
            <Read label="Taxable" value={money(editing.billing.taxableAmount)} />
            <Read label="Tax" value={money(editing.billing.taxAmount)} />
          </FormSection>
        ) : null}

        {editing && <TripDocuments tripId={editing.id} />}

        <FormSection title="Status and notes" columns={2}>
          <F label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {(data?.statuses || []).map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </F>
          {(form.status === "cancelled" || form.status === "rejected") && (
            <F label={form.status === "rejected" ? "Reason for rejection" : "Reason for cancellation"}>
              <input value={form.cancellationReason} onChange={(e) => setForm({ ...form, cancellationReason: e.target.value })}
                placeholder="Required" className={inputCls} />
            </F>
          )}
          <F label="Credit note no">
            <input value={form.creditNoteNo} onChange={(e) => setForm({ ...form, creditNoteNo: e.target.value })} placeholder="If raised" className={inputCls} />
          </F>
          <div className="md:col-span-2">
            <F label="Remarks">
              <textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={`${inputCls} resize-y`} />
            </F>
          </div>
          <div className="md:col-span-2">
            <F label="Checklist remarks">
              <textarea rows={2} value={form.checklistRemarks} onChange={(e) => setForm({ ...form, checklistRemarks: e.target.value })}
                placeholder="Papers pending, client observations…" className={`${inputCls} resize-y`} />
            </F>
          </div>
        </FormSection>
      </FormPanel>

      {requestFor && (
        <RequestEditDialog trip={requestFor} onClose={() => setRequestFor(null)} onDone={() => { setRequestFor(null); load(); }} />
      )}
      {showImport && (
        <ImportPanel business={business} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load(); }} />
      )}
      {showApprovals && (
        <ApprovalsPanel onClose={() => setShowApprovals(false)} onDone={load} />
      )}
      {showSeries && (
        <SeriesPanel onClose={() => setShowSeries(false)} onDone={load} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Register tabs                                                       */
/* ------------------------------------------------------------------ */

function RegisterTabs({ value, onChange }: { value: Business; onChange: (v: Business) => void }) {
  const tabs: { id: Business; label: string; icon: React.ReactNode; help: string }[] = [
    { id: "trading", label: "Trading", icon: <Handshake size={14} />, help: "Bought from a vendor, supplied straight on" },
    { id: "manufacturing", label: "Manufacturing", icon: <Factory size={14} />, help: "Our own produced material" },
  ];
  const index = tabs.findIndex((t) => t.id === value);
  return (
    <div className="bmx-seg relative grid grid-cols-2 gap-0 rounded-2xl border border-biome-line bg-biome-bgSoft p-1">
      <span className="bmx-seg-pill"
        style={{ width: "calc(50% - 4px)", transform: `translateX(${index * 100}%)` }} />
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`bmx-seg-btn relative z-10 flex flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 ${
            value === t.id ? "text-biome-text" : "text-biome-muted hover:text-biome-text"
          }`}>
          <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[-.01em]">{t.icon} {t.label}</span>
          <span className={`text-[9.5px] ${value === t.id ? "text-biome-text/80" : "text-biome-muted"}`}>{t.help}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Client and PO pickers                                               */
/* ------------------------------------------------------------------ */

function ClientPicker({
  clients, value, unlisted, onChange, onAdded,
}: {
  clients: ClientOption[]; value: string; unlisted: string[];
  onChange: (name: string) => void; onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/clients/quick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add that client.");
      onChange(json.client.name);
      setAdding(false); setName("");
      onAdded();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (adding) {
    return (
      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Client name" className={inputCls} />
          <button type="button" onClick={add} disabled={busy}
            className="bmx-btn rounded-xl bg-biome-leaf px-3 text-[11px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />}
          </button>
          <button type="button" onClick={() => { setAdding(false); setErr(null); }}
            className="bmx-chip rounded-xl border border-biome-line px-3 text-biome-muted"><X size={13} /></button>
        </div>
        {err && <p className="text-[10px] text-rose-500">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">Select a client…</option>
        {clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        {unlisted.length > 0 && (
          <optgroup label="In old rows, not in the client master">
            {unlisted.map((x) => <option key={x} value={x}>{x}</option>)}
          </optgroup>
        )}
      </select>
      <button type="button" onClick={() => setAdding(true)} title="Add a client"
        className="bmx-chip shrink-0 rounded-xl border border-biome-line px-3 text-biome-muted">
        <Plus size={13} />
      </button>
    </div>
  );
}

function PoPicker({
  client, value, onChange, onAdded,
}: {
  client?: ClientOption; value: string;
  onChange: (po: PoNumber | null) => void; onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ number: "", date: "", location: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!client || !draft.number.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/clients/po", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client.name, ...draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add that PO.");
      onChange(json.po);
      setAdding(false); setDraft({ number: "", date: "", location: "" });
      onAdded();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!client) {
    return <input value={value} readOnly placeholder="Pick a client first" className={`${inputCls} opacity-60`} />;
  }

  if (adding) {
    return (
      <div className="space-y-1.5">
        <input autoFocus value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })}
          placeholder="PO number" className={inputCls} />
        <div className="flex gap-1.5">
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputCls} />
          <button type="button" onClick={add} disabled={busy}
            className="bmx-btn rounded-xl bg-biome-leaf px-3 text-[11px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Check size={13} />}
          </button>
          <button type="button" onClick={() => { setAdding(false); setErr(null); }}
            className="bmx-chip rounded-xl border border-biome-line px-3 text-biome-muted"><X size={13} /></button>
        </div>
        {err && <p className="text-[10px] text-rose-500">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <select value={value}
        onChange={(e) => onChange(client.poNumbers.find((p) => p.number === e.target.value) || null)}
        className={inputCls}>
        <option value="">{client.poNumbers.length ? "Select a PO…" : "No PO on this client yet"}</option>
        {client.poNumbers.map((p) => (
          <option key={p.id} value={p.number}>
            {p.number}{p.date ? ` · ${p.date}` : ""}{p.location ? ` · ${p.location}` : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setAdding(true)} title="Add a PO to this client"
        className="bmx-chip shrink-0 rounded-xl border border-biome-line px-3 text-biome-muted">
        <Plus size={13} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Asking an admin to open a frozen row                                */
/* ------------------------------------------------------------------ */

function RequestEditDialog({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const [fields, setFields] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/coordination/edit-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: trip.id, fields, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not send the request.");
      setSent(true);
      setTimeout(onDone, 900);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <FormPanel
      open
      onClose={onClose}
      icon={<Lock size={20} />}
      eyebrow={`Trip #${trip.serial}`}
      title="This entry is frozen"
      subtitle={trip.lock.reason}
      footer={
        <>
          <button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>
          {!trip.pendingRequest && (
            <button onClick={send} disabled={busy || sent}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <KeyRound size={14} />} Ask an admin to open it
            </button>
          )}
        </>
      }
    >
      <FormSection
        title="What needs changing"
        sectionIcon={<KeyRound size={14} />}
        hint="An admin decides on what you write here, so write it as though they cannot see the row — because from the approvals list, they cannot."
        columns={1}
      >
        {trip.pendingRequest ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-4 py-3 text-[11.5px] leading-relaxed text-amber-600">
            {trip.pendingRequest.by} already asked for this row on {trip.pendingRequest.at.slice(0, 10)}. It is with an admin.
          </p>
        ) : sent ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-4 py-3 text-[11.5px] font-semibold text-emerald-600">
            Sent. You will be able to edit this row once an admin approves it.
          </p>
        ) : (
          <>
            <F label="Which fields">
              <input value={fields} onChange={(e) => setFields(e.target.value)}
                placeholder="Receiving qty, receiving date…" className={inputCls} />
            </F>
            <F label="Why">
              <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="The plant sent a revised weighment slip on 12 Aug — 34,020 kg, not 34,200."
                className={`${inputCls} resize-y`} />
            </F>
            {err && <p className="text-[11px] text-rose-500">{err}</p>}
          </>
        )}
      </FormSection>
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Admin approvals                                                     */
/* ------------------------------------------------------------------ */

function ApprovalsPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/coordination/edit-request", { cache: "no-store" });
    setData(await res.json().catch(() => ({ requests: [] })));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id); setErr(null);
    try {
      const res = await fetch("/api/coordination/edit-request", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approve, note: notes[id] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record that decision.");
      await load();
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusyId(""); }
  }

  const requests = (data?.requests || []) as any[];
  const pending = requests.filter((r) => r.status === "pending");

  return (
    <FormPanel
      open onClose={onClose}
      icon={<KeyRound size={20} />}
      eyebrow="Coordination"
      title="Requests to edit a frozen entry"
      subtitle={`Approving opens that one row for ${data?.windowHours || 24} hours. Nobody may decide their own request.`}
      footer={<button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>}
    >
      <FormSection title={`Pending (${pending.length})`} sectionIcon={<Clock size={14} />} columns={1}>
        {err && <p className="text-[11px] text-rose-500">{err}</p>}
        {pending.length === 0 && <p className="text-[11.5px] text-biome-muted">Nothing waiting.</p>}
        {pending.map((r) => (
          <div key={r.id} className="bmx-card rounded-2xl border border-biome-line bg-biome-bg p-4">
            <p className="text-[12.5px] font-semibold text-biome-text">#{r.tripSerial} · {r.tripLabel}</p>
            <p className="mt-0.5 text-[10px] text-biome-muted">
              {r.requestedByName} · {new Date(r.requestedAt).toLocaleString("en-IN")}
            </p>
            {r.fields && <p className="mt-2 text-[11px] font-semibold text-biome-text">Fields: {r.fields}</p>}
            <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">{r.reason}</p>
            <input value={notes[r.id] || ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              placeholder="Note — required when refusing" className={`${inputCls} mt-3`} />
            <div className="mt-2 flex gap-2">
              <button onClick={() => decide(r.id, true)} disabled={busyId === r.id}
                className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11px] font-bold text-white disabled:opacity-60">
                {busyId === r.id ? <Loader2 size={12} className="bmx-spin" /> : <Unlock size={12} />} Approve
              </button>
              <button onClick={() => decide(r.id, false)} disabled={busyId === r.id}
                className="bmx-chip rounded-xl border border-rose-500/35 px-4 py-2 text-[11px] font-semibold text-rose-500">
                Refuse
              </button>
            </div>
          </div>
        ))}
      </FormSection>

      <FormSection title="Decided" columns={1}>
        {requests.filter((r) => r.status !== "pending").slice(0, 20).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line px-3 py-2">
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${
              r.status === "approved" ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600" : "border-rose-500/35 bg-rose-500/10 text-rose-500"
            }`}>{r.status}</span>
            <span className="text-[11px] font-semibold text-biome-text">#{r.tripSerial}</span>
            <span className="flex-1 truncate text-[10.5px] text-biome-muted">{r.reason}</span>
            <span className="text-[10px] text-biome-muted">{r.decidedByName} · {(r.decidedAt || "").slice(0, 10)}</span>
          </div>
        ))}
      </FormSection>
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */
/* The number books — admin only                                       */
/* ------------------------------------------------------------------ */

function SeriesPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<any>(null);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState<any>({ name: "", docType: "tax_invoice", business: "both", pattern: "BI/{FY}/{SEQ}", minDigits: "3", nextSeq: "1", resetOn: "financial_year", method: "auto_manual_override", clientHints: "" });
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/coordination/series", { cache: "no-store" });
    const json = await res.json().catch(() => ({ series: [] }));
    setData(json);
    const d: Record<string, any> = {};
    (json.series || []).forEach((s: any) => {
      d[s.id] = { nextSeq: String(s.nextSeq), pattern: s.pattern, minDigits: String(s.minDigits), name: s.name, method: s.method, resetOn: s.resetOn, active: s.active, business: s.business };
    });
    setDrafts(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(id: string) {
    setBusyId(id); setErr(null); setSaved("");
    try {
      const d = drafts[id];
      const res = await fetch("/api/coordination/series", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, nextSeq: Number(d.nextSeq), pattern: d.pattern, minDigits: Number(d.minDigits), name: d.name, method: d.method, resetOn: d.resetOn, active: d.active, business: d.business }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save that.");
      setSaved(id);
      await load();
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusyId(""); }
  }

  async function create() {
    setBusyId("new"); setErr(null);
    try {
      const res = await fetch("/api/coordination/series", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...nw, minDigits: Number(nw.minDigits), nextSeq: Number(nw.nextSeq), clientHints: String(nw.clientHints || "").split(",").map((x: string) => x.trim()).filter(Boolean) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add that series.");
      setAdding(false); await load(); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusyId(""); }
  }

  /** What the number would look like, worked out in the browser as they type. */
  function preview(id: string): string {
    const d = drafts[id];
    if (!d) return "";
    const seq = String(Math.max(0, Math.trunc(Number(d.nextSeq) || 0)))
      .padStart(Math.max(1, Number(d.minDigits) || 1), "0");
    return fill(d.pattern, seq);
  }
  const fill = (pattern: string, seq: string) => {
    const now = new Date(); const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return String(pattern || "").replace(/\{SEQ\}/g, seq).replace(/\{FY\}/g, `${y}-${String((y + 1) % 100).padStart(2, "0")}`)
      .replace(/\{YY\}/g, String(now.getFullYear() % 100).padStart(2, "0")).replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, "0"));
  };
  const methods = (data?.methods || []) as any[];

  const series = (data?.series || []) as any[];

  return (
    <FormPanel
      open onClose={onClose}
      icon={<Hash size={20} />}
      eyebrow="Coordination"
      title="Document number books"
      subtitle="These were seeded from the coordination workbook. Change them only to correct a mistake — every number already issued is remembered, and one that has been used cannot be handed out again."
      footer={<button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>}
    >
      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{err}</p>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-biome-line bg-biome-bg p-3">
        <p className="text-[11px] leading-relaxed text-biome-muted">
          Pattern tokens: <b className="font-mono">{"{SEQ}"}</b> running number · <b className="font-mono">{"{FY}"}</b> 2026-27 · <b className="font-mono">{"{YY}"}</b> 26 · <b className="font-mono">{"{MM}"}</b> 09.
          Everything else is printed as typed (prefix / suffix). Choosing a document type and series on a trip shows its next number at once.
        </p>
        {!adding ? (
          <button onClick={() => setAdding(true)} className="bmx-btn mt-2 flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white"><Plus size={13} /> Add a number series</button>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <F label="Name"><input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="Maharashtra tax invoices" className={inputCls} /></F>
            <F label="Document type">
              <select value={nw.docType} onChange={(e) => setNw({ ...nw, docType: e.target.value })} className={inputCls}>
                <option value="tax_invoice">Tax invoice</option><option value="delivery_challan">Delivery challan</option>
              </select>
            </F>
            <F label="Numbering method">
              <select value={nw.method} onChange={(e) => setNw({ ...nw, method: e.target.value })} className={inputCls}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </F>
            <F label="Used in">
              <select value={nw.business} onChange={(e) => setNw({ ...nw, business: e.target.value })} className={inputCls}>
                <option value="both">Trading + manufacturing</option><option value="trading">Trading only</option><option value="manufacturing">Manufacturing only</option>
              </select>
            </F>
            <F label="Pattern"><input value={nw.pattern} onChange={(e) => setNw({ ...nw, pattern: e.target.value })} className={`${inputCls} font-mono`} /></F>
            <F label="Pad count to"><input type="number" min={1} value={nw.minDigits} onChange={(e) => setNw({ ...nw, minDigits: e.target.value })} className={inputCls} /></F>
            <F label="Start at"><input type="number" min={1} value={nw.nextSeq} onChange={(e) => setNw({ ...nw, nextSeq: e.target.value })} className={inputCls} /></F>
            <F label="Restart">
              <select value={nw.resetOn} onChange={(e) => setNw({ ...nw, resetOn: e.target.value })} className={inputCls}>
                <option value="financial_year">Every financial year</option><option value="never">Never</option>
              </select>
            </F>
            <div className="md:col-span-3"><F label="Clients that use it (comma separated, optional)"><input value={nw.clientHints} onChange={(e) => setNw({ ...nw, clientHints: e.target.value })} className={inputCls} /></F></div>
            <div className="flex items-end gap-2">
              <span className="flex-1 truncate rounded-xl border border-biome-line px-3 py-2.5 font-mono text-[12px]">{fill(nw.pattern, String(Number(nw.nextSeq) || 1).padStart(Number(nw.minDigits) || 1, "0"))}</span>
              <button onClick={create} disabled={busyId === "new"} className="bmx-btn rounded-xl bg-biome-leaf px-3 py-2.5 text-[11px] font-bold text-white">{busyId === "new" ? <Loader2 size={13} className="bmx-spin" /> : "Add"}</button>
            </div>
          </div>
        )}
      </div>

      {series.map((s) => (
        <FormSection
          key={s.id}
          title={s.name}
          sectionIcon={s.docType === "tax_invoice" ? <Receipt size={14} /> : <FileText size={14} />}
          hint={s.note}
          columns={4}
        >
          <F label="Name">
            <input value={drafts[s.id]?.name ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], name: e.target.value } })} className={inputCls} />
          </F>
          <F label="Numbering method">
            <select value={drafts[s.id]?.method ?? "auto_manual_override"}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], method: e.target.value } })} className={inputCls}>
              {methods.map((m) => <option key={m.id} value={m.id} title={m.help}>{m.label}</option>)}
            </select>
          </F>
          <F label="Restart numbering">
            <select value={drafts[s.id]?.resetOn ?? "never"}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], resetOn: e.target.value } })} className={inputCls}>
              <option value="never">Never</option><option value="financial_year">Every financial year (1 April)</option>
            </select>
          </F>
          <F label="Used in">
            <select value={drafts[s.id]?.business ?? "both"}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], business: e.target.value } })} className={inputCls}>
              <option value="both">Trading + manufacturing</option><option value="trading">Trading only</option><option value="manufacturing">Manufacturing only</option>
            </select>
          </F>
          <F label="Pattern">
            <input value={drafts[s.id]?.pattern ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], pattern: e.target.value } })}
              className={`${inputCls} font-mono`} />
          </F>
          <F label="Pad the count to">
            <input type="number" min={1} value={drafts[s.id]?.minDigits ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], minDigits: e.target.value } })}
              className={inputCls} />
          </F>
          <F label="Next count">
            <input type="number" min={1} value={drafts[s.id]?.nextSeq ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], nextSeq: e.target.value } })}
              className={inputCls} />
          </F>
          <div className="self-end">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Next number out</p>
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 font-mono text-[12px] font-semibold text-biome-text">
                {preview(s.id)}
              </span>
              <button onClick={() => save(s.id)} disabled={busyId === s.id}
                className="bmx-btn shrink-0 rounded-xl bg-biome-leaf px-3 py-2.5 text-[11px] font-bold text-white disabled:opacity-60">
                {busyId === s.id ? <Loader2 size={13} className="bmx-spin" /> : saved === s.id ? <Check size={13} /> : "Save"}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-biome-muted md:col-span-2 lg:col-span-4">
            <input type="checkbox" checked={drafts[s.id]?.active !== false}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], active: e.target.checked } })} /> Series in use (untick to retire it — its numbers stay on record)
          </label>
          {s.lastIssued && (
            <p className="text-[10px] text-biome-muted md:col-span-2 lg:col-span-4">
              Last issued {s.lastIssued.number} by {s.lastIssued.by} on {s.lastIssued.at.slice(0, 10)}.
            </p>
          )}
        </FormSection>
      ))}

      <FormSection title="Recently issued" sectionIcon={<Clock size={14} />} columns={1}
        hint="Kept so a gap in the book can be explained rather than argued about. A cancelled trip keeps its number and shows here as void.">
        {(data?.issued || []).length === 0 && (
          <p className="text-[11.5px] text-biome-muted">Nothing issued from the app yet — the register is still carrying numbers typed in by hand.</p>
        )}
        {(data?.issued || []).slice(0, 25).map((i: any) => (
          <div key={`${i.number}-${i.at}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line px-3 py-2">
            <span className="font-mono text-[11.5px] font-semibold text-biome-text">{i.number}</span>
            {i.voidedAt && (
              <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-rose-500">
                void
              </span>
            )}
            <span className="flex-1 truncate text-[10.5px] text-biome-muted">{i.voidReason || ""}</span>
            <span className="text-[10px] text-biome-muted">{i.byName} · {(i.at || "").slice(0, 10)}</span>
          </div>
        ))}
      </FormSection>
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Import from Tally                                                   */
/* ------------------------------------------------------------------ */

const MAP_FIELDS: { key: string; label: string }[] = [
  { key: "invoiceDate", label: "Date of our invoice / challan" },
  { key: "docNo", label: "Our document number" },
  { key: "client", label: "Client name" },
  { key: "vehicle", label: "Vehicle number" },
  { key: "weight", label: "Invoice weight" },
  { key: "taxable", label: "Taxable amount" },
  { key: "tax", label: "Tax amount" },
  { key: "total", label: "Total amount" },
];

function ImportPanel({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [done, setDone] = useState<{ written: number; skipped: any[] } | null>(null);

  async function parse(withMapping?: Record<string, string>) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("business", business);
      if (withMapping) fd.append("mapping", JSON.stringify(withMapping));
      const res = await fetch("/api/coordination/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read that file.");
      setResult(json);
      setMapping(json.mapping);
      setPicked({});
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setErr(null);
    try {
      const rows = (result?.matches || []) as any[];
      const payload = rows
        .map((m) => {
          const tripId = m.tripId || picked[m.row.rowNumber] || "";
          if (!tripId) return null;
          if (m.verdict === "empty" || m.verdict === "unmatched") return null;
          return {
            tripId,
            invoiceDate: m.row.invoiceDate, docNo: m.row.docNo,
            weightKg: m.row.weightKg, taxable: m.row.taxable, tax: m.row.tax, total: m.row.total,
          };
        })
        .filter(Boolean);
      if (!payload.length) throw new Error("Nothing is matched yet, so there is nothing to write.");
      const res = await fetch("/api/coordination/import", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not write those rows.");
      setDone(json);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const summary = result?.summary;
  const matches = (result?.matches || []) as any[];
  const readyCount = matches.filter(
    (m) => (m.verdict === "matched" || m.verdict === "already") || picked[m.row.rowNumber]
  ).length;

  return (
    <FormPanel
      open onClose={onClose}
      icon={<Upload size={20} />}
      eyebrow={business === "manufacturing" ? "Manufacturing register" : "Trading register"}
      title="Import billed figures from Tally"
      subtitle="Nothing is written until you press Apply, and a row that cannot be tied to a trip is never turned into a new one."
      footer={
        <>
          <button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && result && (
            <button onClick={apply} disabled={busy || readyCount === 0}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Apply {readyCount} row{readyCount === 1 ? "" : "s"}
            </button>
          )}
          {done && (
            <button onClick={onDone} className="bmx-btn rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white">
              Back to the register
            </button>
          )}
        </>
      }
    >
      {done ? (
        <FormSection title="Done" sectionIcon={<Check size={14} />} columns={1}>
          <p className="text-[12.5px] font-semibold text-biome-text">
            {done.written} row{done.written === 1 ? "" : "s"} updated.
          </p>
          {done.skipped.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-4 py-3">
              <p className="text-[11.5px] font-semibold text-amber-600">{done.skipped.length} skipped</p>
              <ul className="mt-1 space-y-0.5">
                {done.skipped.map((s: any, i: number) => (
                  <li key={i} className="text-[10.5px] text-biome-muted">#{s.tripSerial}: {s.why}</li>
                ))}
              </ul>
            </div>
          )}
        </FormSection>
      ) : (
        <>
          <FormSection title="The file" sectionIcon={<Upload size={14} />} columns={2}
            hint="Export from Tally as Excel or CSV. Any column order works — the mapping below is a guess you can correct.">
            <F label="Spreadsheet">
              <input type="file" accept=".xlsx,.xls,.csv"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setDone(null); }}
                className="block w-full text-[11.5px] text-biome-muted file:mr-3 file:rounded-xl file:border-0 file:bg-biome-leaf file:px-4 file:py-2 file:text-[11px] file:font-bold file:text-white" />
            </F>
            <div className="self-end">
              <button onClick={() => parse()} disabled={!file || busy}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                {busy ? <Loader2 size={14} className="bmx-spin" /> : <ChevronRight size={14} />} Read the file
              </button>
            </div>
            {err && <p className="text-[11px] text-rose-500 md:col-span-2">{err}</p>}
            {busy && (
              <div className="relative h-[3px] overflow-hidden rounded-full bg-biome-line md:col-span-2">
                <span className="bmx-sweep-x absolute inset-y-0 w-1/3 rounded-full bg-biome-leaf" />
              </div>
            )}
          </FormSection>

          {result && (
            <>
              <FormSection title="Which column is which" sectionIcon={<Filter size={14} />} columns={4}
                hint="Check the tax and total columns especially — mixing those two puts a wrong figure everywhere and it still looks plausible.">
                {MAP_FIELDS.map((f) => (
                  <F key={f.key} label={f.label}>
                    <select value={mapping[f.key] || ""}
                      onChange={(e) => {
                        const next = { ...mapping, [f.key]: e.target.value };
                        setMapping(next); parse(next);
                      }}
                      className={inputCls}>
                      <option value="">— not in this sheet —</option>
                      {(result.headers || []).map((h: string) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </F>
                ))}
              </FormSection>

              <FormSection title="What will happen" sectionIcon={<PackageCheck size={14} />} columns={1}>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Stat label="Will fill" value={summary?.matched || 0} tone="text-emerald-600" />
                  <Stat label="Already billed" value={summary?.already || 0} tone="text-sky-600" />
                  <Stat label="Need a choice" value={summary?.ambiguous || 0} tone="text-amber-600" />
                  <Stat label="No match" value={summary?.unmatched || 0} tone="text-rose-500" />
                </div>

                <div className="mt-2 space-y-1.5">
                  {matches.filter((m) => m.verdict !== "empty").slice(0, 200).map((m) => (
                    <div key={m.row.rowNumber}
                      className={`rounded-xl border px-3 py-2 ${
                        m.verdict === "matched" ? "border-emerald-500/25 bg-emerald-500/[.05]"
                        : m.verdict === "already" ? "border-sky-500/25 bg-sky-500/[.05]"
                        : m.verdict === "ambiguous" ? "border-amber-500/30 bg-amber-500/[.06]"
                        : "border-rose-500/25 bg-rose-500/[.05]"
                      }`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-biome-muted">row {m.row.rowNumber}</span>
                        <span className="text-[11.5px] font-semibold text-biome-text">
                          {m.row.vehicle || m.row.docNo || "—"}
                        </span>
                        <span className="text-[10.5px] text-biome-muted">
                          {m.row.invoiceDate || "no date"} · {money(m.row.total)}
                        </span>
                        {m.tripSerial > 0 && (
                          <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold text-biome-muted">
                            trip #{m.tripSerial}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-biome-muted">{m.how}</p>
                      {m.warnings.map((w: string, i: number) => (
                        <p key={i} className="mt-0.5 text-[10px] font-semibold text-amber-600">{w}</p>
                      ))}
                      {m.verdict === "ambiguous" && m.candidates.length > 1 && (
                        <select value={picked[m.row.rowNumber] || ""}
                          onChange={(e) => setPicked({ ...picked, [m.row.rowNumber]: e.target.value })}
                          className={`${inputCls} mt-2`}>
                          <option value="">Leave this row alone</option>
                          {m.candidates.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </FormSection>
            </>
          )}
        </>
      )}
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function DocBadge({ type, number }: { type: DocType; number: string }) {
  const invoice = type === "tax_invoice";
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${
      invoice ? "border-violet-500/35 bg-violet-500/10 text-violet-600" : "border-sky-500/35 bg-sky-500/10 text-sky-600"
    }`}>
      {invoice ? <Receipt size={9} /> : <FileText size={9} />}
      {number || (invoice ? "invoice pending" : "challan pending")}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
      <p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-[16px] font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function Read({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
      <p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[12.5px] font-semibold text-biome-text">{value}</p>
    </div>
  );
}

function Tile({ icon, label, value, hint, tone, accent }: any) {
  return (
    <div className={`bmx-card relative overflow-hidden rounded-2xl border p-4 ${accent ? "border-rose-500/30 bg-rose-500/[.06]" : "border-biome-line bg-biome-bgSoft"}`}>
      <span className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
        style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)" }} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
          <p className="mt-1 font-mono text-[20px] font-semibold tracking-tight text-biome-text">{value}</p>
          {hint && <p className="mt-0.5 text-[9.5px] text-biome-muted">{hint}</p>}
        </div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </div>
  );
}

function PartyCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: any[] }) {
  const worst = rows.filter((r) => r.shortfallKg > 0).slice(0, 6);
  if (!worst.length) return null;
  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">{icon} {title}</h2>
      <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
        Sorted by kilos lost. The percentage matters more — a supplier who sends twice as much will
        show twice the shortfall while being no worse.
      </p>
      <div className="mt-3 space-y-1.5">
        {worst.map((r) => (
          <div key={r.name} className="bmx-card flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3 py-2">
            <div className="min-w-[120px] flex-1">
              <p className="truncate text-[12px] font-semibold text-biome-text">{r.name}</p>
              <p className="text-[9.5px] text-biome-muted">{r.trips} trips · {r.shortageTrips} short</p>
            </div>
            <p className="font-mono text-[12px] font-semibold text-rose-500">{kg(r.shortfallKg)}</p>
            <p className="w-[52px] text-right font-mono text-[11px] text-biome-muted">{r.shortfallPct}%</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[.12em] text-biome-muted">{label}</p>
      <p className={`mt-0.5 whitespace-nowrap font-mono text-[12.5px] font-semibold ${tone || "text-biome-text"}`}>{value}</p>
    </div>
  );
}

const inputCls = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
const selectCls = "rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text outline-none";

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bmx-field block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</span>
      <div className="relative">{children}</div>
    </label>
  );
}


/**
 * PO quantity picker — shows the live balance of each PO for the party
 * and warns, before saving, when this supply would exceed it. The server
 * enforces the same rule (block / approval / exception per Admin setting).
 */
function PoQuantityPicker({ type, party, value, qtyKg, onChange }: { type: "vendor" | "client"; party: string; value: string; qtyKg: number; onChange: (id: string) => void }) {
  const [pos, setPos] = useState<any[]>([]);
  useEffect(() => { fetch(`/api/po?type=${type}`).then((r) => r.json()).then((j) => setPos(j.pos || [])).catch(() => setPos([])); }, [type]);
  const mine = pos.filter((p) => !party || p.partyName.toLowerCase().includes(String(party).toLowerCase()) || String(p.partyKey).toLowerCase() === String(party).toLowerCase());
  const sel = pos.find((p) => p.id === value);
  const mt = (kg: number) => `${(kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} MT`;
  const exceeds = sel && qtyKg > sel.remainingKg;
  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">— not linked —</option>
        {(mine.length ? mine : pos).map((p) => <option key={p.id} value={p.id}>{p.partyName} · {p.poNumber} · {mt(p.remainingKg)} left ({p.effectiveStatus.replace("_", " ")})</option>)}
      </select>
      {sel && <p className="mt-1 text-[9.5px] text-biome-muted">Total {mt(sel.unit === "MT" ? sel.totalQuantity * 1000 : sel.totalQuantity)} · consumed {mt(sel.consumedKg)} · remaining {mt(sel.remainingKg)} · {sel.utilisationPct}%</p>}
      {exceeds && <p className="mt-1 rounded-lg border border-rose-500/40 bg-rose-500/[.08] px-2 py-1 text-[10px] font-semibold text-rose-500">⚠ PO BALANCE WARNING — this supply exceeds the remaining quantity by {mt(qtyKg - sel.remainingKg)}. Saving needs approval per PO settings.</p>}
    </div>
  );
}


/** Matched / not matched with the plant's own dispatch sheet — a verdict only. */
function PlantMatchBadge({ status }: { status?: string }) {
  if (status === "matched") {
    return <span title="Same vehicle, plant and date found in the plant's dispatch sheet" className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-emerald-600">✓ Plant matched</span>;
  }
  if (status === "weight_differs") {
    return <span title="Vehicle and date match the plant's dispatch sheet, but the weight is different — check with the plant" className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-amber-600">⚠ Plant weight differs</span>;
  }
  return <span title="This vehicle is not in the plant's dispatch sheet for that date (±1 day) — or the location does not name the plant" className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-rose-500">✗ Not in plant dispatch</span>;
}


/**
 * WhatsApp paperwork for one supply: linked by reference, document
 * numbers, or vehicle + date; grouped by category; each paper checked
 * against what the register says. Opening a file goes through the
 * server, which only serves papers linked to this trip.
 */
function TripDocuments({ tripId }: { tripId: string }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/coordination/documents?tripId=${tripId}`, { cache: "no-store" });
    if (res.ok) setD(await res.json());
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  async function sweep() {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/coordination/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sweep" }) });
      const j = await res.json().catch(() => ({}));
      setNote(j.note || `Filed ${j.promoted ?? 0} waiting document(s); ${j.stillWaiting ?? 0} still waiting.`);
      await load();
    } finally { setBusy(false); }
  }

  if (!d) return null;
  const cats = Object.entries(d.byCategory || {}) as [string, any[]][];
  return (
    <FormSection title={`WhatsApp documents (${d.docs.length})`} sectionIcon={<Paperclip size={14} />} columns={1}
      hint={`Reference ${d.reference.canonical} (${d.reference.source === "typed" ? "typed" : d.reference.source === "composed" ? "built from this trip" : "incomplete"}). Papers already read, and any that arrive later, link here automatically.`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={sweep} disabled={busy}
          className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted disabled:opacity-50">
          <RefreshCw size={12} className={busy ? "bmx-spin" : ""} /> File waiting papers now
        </button>
        {note && <span className="text-[10.5px] text-biome-muted">{note}</span>}
      </div>

      {d.notices.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/[.07] px-3 py-2">
          <p className="text-[11px] font-bold text-amber-600">Differences to check</p>
          <ul className="mt-1 space-y-0.5">
            {d.notices.map((n: any, i: number) => (
              <li key={i} className={`text-[10.5px] ${n.level === "warning" ? "text-amber-700" : "text-biome-muted"}`}>{n.level === "warning" ? "⚠" : "ℹ"} {n.text}</li>
            ))}
          </ul>
        </div>
      )}

      {d.missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.06] px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-rose-500">Not received yet:</span>
          {d.missing.map((m: string) => <span key={m} className="rounded-full border border-rose-500/35 px-2 py-0.5 text-[10px] font-semibold text-rose-600">{m}</span>)}
          <a href={`/followups?tripId=${tripId}`} className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold text-biome-leaf"><Mail size={11} /> Ask the vendor</a>
        </div>
      )}

      {cats.length === 0 ? (
        <p className="text-[11px] text-biome-muted">No WhatsApp document found for this supply yet.</p>
      ) : cats.map(([cat, list]) => (
        <div key={cat}>
          <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{cat}</p>
          <div className="space-y-1">
            {list.map((doc: any) => {
              const bad = doc.checks.filter((c: any) => !c.ok);
              return (
                <div key={doc.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${bad.length ? "border-amber-500/40 bg-amber-500/[.05]" : "border-biome-line"}`}>
                  <FileText size={12} className="text-biome-leaf" />
                  <a href={`/api/coordination/documents?tripId=${tripId}&docId=${encodeURIComponent(doc.id)}`} target="_blank" rel="noreferrer"
                    className="text-[11.5px] font-semibold text-biome-text underline-offset-2 hover:underline">{doc.label}</a>
                  <span className="text-[10px] text-biome-muted">{doc.fileName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${doc.source === "staged" ? "bg-sky-500/15 text-sky-600" : "bg-emerald-500/15 text-emerald-600"}`}>{doc.source === "staged" ? "waiting in staging" : "filed in supply set"}</span>
                  <span className="text-[9.5px] text-biome-muted">linked by {doc.how}</span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    {doc.checks.map((c: any, i: number) => (
                      <span key={i} title={`Document: ${c.doc} · Trip: ${c.trip}`} className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${c.ok ? "text-emerald-600" : "bg-amber-500/15 text-amber-700"}`}>{c.ok ? "✓" : "⚠"} {c.field}</span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </FormSection>
  );
}
