"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Handshake, Truck, Plus, Loader2, AlertCircle, Check, Search, Filter,
  FileText, Upload, ShieldAlert, Clock, Building2, Landmark, X, Trash2, Mail, Lock, Unlock } from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";
import DevEditedChip from "@/components/DevEditedChip";
import { EmptyState } from "@/components/SetupGuide";

/**
 * Biomass vendor and transporter registration.
 *
 * The commercial side of a supplier — who they are, what was agreed, and
 * the signed paper proving it. Separate from the operational vendor master
 * a coordinator uses, and not visible to them.
 *
 * The screen is built around one question: what is still missing. A
 * register full of half-finished records that all look complete is worse
 * than an empty one, so every card says what it lacks.
 */

interface PartnerDoc {
  id: string; type: string; label: string; reference: string;
  documentDate: string; validTill: string; fileName: string;
  sizeBytes: number; mimeType: string; uploadedAt: string;
  uploadedByName: string; plant: string; note: string;
}
interface Gaps {
  missing: { id: string; label: string }[];
  expired: { id: string; label: string; validTill: string }[];
  expiringSoon: { id: string; label: string; validTill: string; days: number }[];
  missingFields: string[];
  readyToActivate: boolean;
}
interface Partner {
  id: string; kind: string; code: string; name: string; legalName: string;
  gstin: string; pan: string; plants: string[]; material: string;
  contactPerson: string; phone: string; email: string;
  addressLine: string; city: string; state: string; pincode: string;
  bankName: string; accountNumber: string; ifsc: string;
  rateTerms: string; paymentTerms: string; agreementFrom: string; agreementTo: string;
  status: string; statusReason: string; documents: PartnerDoc[]; notes: string;
  registeredByName: string; createdAt: string;
  category: string;
  supplies?: string[];
  lockState?: "open" | "submitted";
  lockedAt?: string;
  lockedByName?: string;
  lockHistory?: { at: string; byName: string; action: string; reason: string }[];
  gaps: Gaps;
  freeze?: { frozen: boolean; daysLeft: number; freezesOn: string };
  locked?: boolean;
}

const blank = {
  kind: "biomass_vendor", category: "raw_material", supplies: ["biomass"] as string[],
  code: "", name: "", legalName: "", gstin: "", pan: "",
  plants: [] as string[], material: "", contactPerson: "", phone: "", email: "",
  addressLine: "", city: "", state: "", pincode: "",
  bankName: "", accountNumber: "", ifsc: "",
  rateTerms: "", paymentTerms: "", agreementFrom: "", agreementTo: "", notes: "",
};

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600",
  draft: "border-biome-line text-biome-muted",
  on_hold: "border-amber-500/35 bg-amber-500/10 text-amber-600",
  blocked: "border-rose-500/35 bg-rose-500/10 text-rose-500",
};

export default function PartnersPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState<any>({ ...blank });
  const [filters, setFilters] = useState({ kind: "all", status: "all", category: "all", lock: "all", search: "" });
  // Papers chosen on the NEW registration form — uploaded right after the
  // record is created, so KYC goes in on the same screen.
  const [queued, setQueued] = useState<{ type: string; file: File; reference: string; validTill: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v && v !== "all") p.set(k, String(v)); });
      const res = await fetch(`/api/partners?${p}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load.");
      setData(json);
      setError(null);
      // Keep the open panel in step with what the server now holds.
      if (editing) {
        const fresh = (json.partners || []).find((x: Partner) => x.id === editing.id);
        if (fresh) setEditing(fresh);
      }
    } catch (e) { setError((e as Error).message); }
    // `editing` is deliberately not a dependency — including it would
    // rebuild this on every keystroke in the panel and refetch the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());
  useEffect(() => { load(); }, [load]);

  function startAdd() {
    setEditing(null);
    setForm({
      ...blank,
      category: data?.myRole === "coordinator" ? "trading" : "raw_material",
      plants: data?.myRole === "plant_manager" && data?.myPlant ? [data.myPlant] : [],
    });
    setQueued([]);
    setNotice(null);
    setOpen(true);
  }

  function edit(p: Partner) {
    setNotice(null);
    setEditing(p);
    setForm({ ...blank, ...p });
    setOpen(true);
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/partners", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(editing ? { id: editing.id } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      if (editing) setEditing(json.partner);
      else {
        // Upload the papers chosen on the form, then keep the panel open on
        // the new record so it can be checked and submitted.
        const failed: string[] = [];
        let latest = json.partner;
        for (const q of queued) {
          const fd = new FormData();
          fd.append("partnerId", json.partner.id);
          fd.append("file", q.file);
          fd.append("type", q.type);
          fd.append("reference", q.reference);
          fd.append("validTill", q.validTill);
          const r = await fetch("/api/partners", { method: "PATCH", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) failed.push(`${q.file.name}: ${j.error || r.status}`);
          else latest = j.partner;
        }
        setQueued([]);
        setEditing(latest);
        setForm({ ...blank, ...latest });
        setNotice(
          failed.length
            ? `Registered. ${failed.length} document(s) did not upload: ${failed.join("; ")}`
            : "Registered with its documents. Check every detail and paper below, then press Submit & freeze."
        );
      }
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function lockAction(action: "submit" | "unlock", extra: Record<string, unknown>) {
    if (!editing) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/partners", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not do that.");
      setEditing(json.partner);
      setNotice(action === "submit" ? "Submitted and frozen. Only accounts, admin or the developer can change it now." : "Unlocked — the owner can correct it and submit again.");
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function setStatus(status: string, reason: string) {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/partners", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, status, statusReason: reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not change the status.");
      setEditing(json.partner);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const partners: Partner[] = data?.partners || [];
  const s = data?.summary;
  const myRole: string = data?.myRole || "";
  const isCoordinator = myRole === "coordinator";
  const isPlantManager = myRole === "plant_manager";
  const docTypes = (data?.documentTypes || []).filter(
    (t: any) => t.kinds.length === 0 || t.kinds.includes(form.kind)
  );
  const editingLocked = Boolean(editing?.locked);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <Handshake size={19} className="text-biome-leaf" />
            {isCoordinator ? "Vendor & client registration · Trading" : isPlantManager ? "Vendor & client registration · Manufacturing (my plant)" : "Vendor & client registration"}
          </h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
            {isCoordinator
              ? "Trading vendors and clients. Manufacturing vendors and clients are registered by each site's plant manager. Upload KYC, check everything, then Submit & freeze."
              : isPlantManager
                ? "Manufacturing vendors, clients and transporters for your site. Upload KYC, check everything, then Submit & freeze — after that only accounts, admin or the developer can change it."
                : "One register for every vendor and client — trading (coordinator) and manufacturing (plant manager). Frozen records can be corrected or unlocked here."}
          </p>
        </div>
        <button onClick={startAdd}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
          <Plus size={14} /> {isCoordinator ? "Register trading vendor / client" : isPlantManager ? "Register manufacturing vendor / client" : "Register vendor / client"}
        </button>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Registered" value={s.total} hint={`${s.active} active`} tone="text-sky-600 bg-sky-500/12" icon={<Building2 size={15} />} />
          <Tile label="Still draft" value={s.draft} hint="papers not complete" tone="text-biome-muted bg-biome-line/40" icon={<Clock size={15} />} />
          <Tile label="Expired papers" value={s.expired} hint="stop supplying until renewed"
            tone={s.expired ? "text-rose-500 bg-rose-500/12" : "text-emerald-600 bg-emerald-500/12"} accent={s.expired > 0} icon={<ShieldAlert size={15} />} />
          <Tile label="Expiring in 30 days" value={s.expiringSoon} hint="chase these now"
            tone={s.expiringSoon ? "text-amber-600 bg-amber-500/12" : "text-emerald-600 bg-emerald-500/12"} icon={<Clock size={15} />} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-biome-muted" />
        <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })} className={selectCls}>
          <option value="all">Vendors, clients, transporters</option>
          {(data?.kinds || []).map((k: any) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        {!isCoordinator && !isPlantManager && (
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={selectCls}>
            <option value="all">Trading + manufacturing</option>
            {(data?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <select value={filters.lock} onChange={(e) => setFilters({ ...filters, lock: e.target.value })} className={selectCls}>
          <option value="all">Submitted or not</option>
          <option value="open">Not submitted (editable)</option>
          <option value="submitted">Submitted &amp; frozen</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={selectCls}>
          <option value="all">Every status</option>
          {(data?.statuses || []).map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Name, GSTIN, PAN, city"
            className="bmx-input w-[240px] rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none" />
        </div>
      </div>

      {data && partners.length === 0 ? (
        <EmptyState
          title="Nobody registered yet"
          detail="Register a biomass vendor or a transporter, then attach the signed agreement, GST certificate, PAN and a cancelled cheque. A company cannot be marked Active until those are on file — which is the point: a payment made against an unverified account is the most expensive mistake this register exists to prevent."
          action={{ label: "Register the first one", onClick: startAdd }}
        />
      ) : (
        <div className="space-y-2">
          {partners.map((p) => (
            <article key={p.id} onClick={() => edit(p)}
              className={`bmx-card cursor-pointer rounded-2xl border bg-biome-bgSoft p-4 ${
                (p as any).devEdited ? "border-amber-500/50 ring-1 ring-amber-500/30" : p.gaps.expired.length || p.gaps.missing.length ? "border-rose-500/35" : "border-biome-line"
              }`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  p.kind === "transporter" ? "bg-orange-500/12 text-orange-500" : "bg-lime-500/12 text-lime-600"
                }`}>
                  {p.kind === "transporter" ? <Truck size={16} /> : <Handshake size={16} />}
                </span>
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-semibold text-biome-text">{p.name}</p>
                    {p.code && <span className="font-mono text-[10px] text-biome-muted">{p.code}</span>}
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${STATUS_TONE[p.status]}`}>
                      {(data?.statuses || []).find((x: any) => x.id === p.status)?.label || p.status}
                    </span>
                    <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-biome-muted">
                      {(data?.kinds || []).find((k: any) => k.id === p.kind)?.label || p.kind}
                    </span>
                    {p.category === "trading" ? (
                      <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-cyan-600">
                        Trading
                      </span>
                    ) : (
                      <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-lime-600">
                        Manufacturing
                      </span>
                    )}
                    <DevEditedChip mark={(p as any).devEdited} />
                    {p.lockState === "submitted" ? (
                      <span className="flex items-center gap-1 rounded-full border border-slate-400/40 bg-slate-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-biome-muted">
                        <Lock size={9} /> Submitted &amp; frozen
                      </span>
                    ) : (
                      <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[9px] font-semibold text-sky-600">
                        Not submitted
                      </span>
                    )}
                    {p.gaps.expired.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold text-rose-500">
                        <ShieldAlert size={9} /> {p.gaps.expired.length} expired
                      </span>
                    )}
                    {p.gaps.expiringSoon.length > 0 && (
                      <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600">
                        {p.gaps.expiringSoon.length} expiring
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10.5px] text-biome-muted">
                    {p.gstin || "no GSTIN"}
                    {p.city && ` · ${p.city}`}
                    {p.plants.length > 0 && ` · ${p.plants.join(", ")}`}
                    {p.material && ` · ${p.material}`}
                    {p.supplies && p.supplies.length > 0 && ` · handles: ${p.supplies.map((x) => (data?.supplyCategories || []).find((c: any) => c.id === x)?.label || x).join(", ")}`}
                    {` · ${p.documents.length} document${p.documents.length === 1 ? "" : "s"}`}
                  </p>
                  {(p.gaps.missing.length > 0 || p.gaps.missingFields.length > 0) && (
                    <div className="bmx-attn mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-2.5 py-1.5">
                      <ShieldAlert size={11} className="shrink-0 text-rose-500" />
                      <span className="text-[9.5px] font-bold uppercase tracking-[.1em] text-rose-500">Missing</span>
                      {p.gaps.missing.map((m) => (
                        <span key={m.id} className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[9.5px] font-semibold text-rose-600">
                          {m.label}
                        </span>
                      ))}
                      {p.gaps.missingFields.map((f) => (
                        <span key={f} className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-semibold text-amber-600">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <FormPanel
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        icon={form.kind === "transporter" ? <Truck size={20} /> : <Handshake size={20} />}
        eyebrow={editing ? (editing.lockState === "submitted" ? "Submitted & frozen" : "Registered — not yet submitted") : "New registration"}
        title={editing ? editing.name : "Register a company"}
        subtitle="The papers here are what a payment and an invoice claim rest on. Half a folder is worse than an empty one, because it looks finished."
        headerRight={
          editing ? (
            <span className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${STATUS_TONE[editing.status]}`}>
              {(data?.statuses || []).find((x: any) => x.id === editing.status)?.label}
            </span>
          ) : null
        }
        footer={
          <>
            {editing && (
              <RegistrationEmailButton partner={editing} />
            )}
            <button onClick={() => { setOpen(false); setEditing(null); }}
              className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Close</button>
            <button onClick={save} disabled={busy || editingLocked}
              title={editingLocked ? "Submitted & frozen — ask accounts, admin or the developer to unlock it." : undefined}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} {editing ? "Save changes" : "Register"}
            </button>
          </>
        }
      >
        {notice && (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-4 py-2.5 text-[11.5px] font-semibold text-emerald-600">{notice}</p>
        )}
        {error && open && (
          <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-2.5 text-[11.5px] text-biome-text">{error}</p>
        )}
        {editing && editing.lockState === "submitted" && (
          <div className="rounded-xl border border-slate-400/40 bg-slate-400/[.08] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-biome-text">
              <Lock size={13} /> Submitted &amp; frozen{editing.lockedAt ? ` on ${editing.lockedAt.slice(0, 10)}` : ""}{editing.lockedByName ? ` by ${editing.lockedByName}` : ""}
            </p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">
              {editingLocked
                ? "You can view it but not change it. Accounts, the admin or the developer can unlock it for correction."
                : "You can still correct it (every change is audited), or unlock it so the owner can correct and resubmit."}
            </p>
          </div>
        )}
        <FormSection title="The company" sectionIcon={<Building2 size={14} />} columns={3}>
          <F label="They are a">
            <select value={form.kind} onChange={(e) => {
              const kind = e.target.value;
              setForm({ ...form, kind, supplies: kind === "transporter" ? ["transport"] : kind === "client" ? [] : form.supplies });
            }} className={inputCls} disabled={Boolean(editing)}>
              {(data?.kinds || []).map((k: any) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </F>
          <F label="Business side">
            <select
              value={isCoordinator ? "trading" : isPlantManager ? "raw_material" : form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputCls}
              disabled={isCoordinator || isPlantManager || (Boolean(editing) && !data?.canUnlock)}
            >
              {(data?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <p className="mt-1 text-[9.5px] text-biome-muted">
              {isCoordinator
                ? "Trading is your register. Manufacturing vendors/clients belong to the plant manager."
                : isPlantManager
                  ? "Manufacturing only — trading vendors/clients are the coordinator's register."
                  : "Trading → coordinator. Manufacturing → plant manager of the site."}
            </p>
          </F>
          <F label="Trading name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></F>
          <F label="Short code (optional)">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="Matches the coordination reference" className={inputCls} />
          </F>
          <div className="md:col-span-2">
            <F label="Legal name, as on the GST certificate">
              <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className={inputCls} />
            </F>
          </div>
          <F label="Material / service">
            <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })}
              placeholder={form.kind === "transporter" ? "Trailer, tipper…" : form.kind === "client" ? "What they buy" : "Mustard husk, pellet, bearings…"} className={inputCls} />
          </F>
          {form.kind !== "client" && (
            <div className="md:col-span-3">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Handled for (choose all that apply)</span>
              <div className="flex flex-wrap gap-1.5">
                {(data?.supplyCategories || []).map((c: any) => {
                  const on = (form.supplies || []).includes(c.id);
                  return (
                    <button type="button" key={c.id} disabled={editingLocked}
                      onClick={() => setForm({ ...form, supplies: on ? form.supplies.filter((x: string) => x !== c.id) : [...(form.supplies || []), c.id] })}
                      className={`bmx-chip rounded-full border px-3 py-1 text-[10.5px] font-semibold ${on ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
                      {on ? "✓ " : ""}{c.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[9.5px] text-biome-muted">Decides where this vendor can be picked — e.g. only &ldquo;Machine spare parts&rdquo; vendors appear in Plant Stock receipts.</p>
            </div>
          )}
        </FormSection>

        <FormSection title="Statutory" sectionIcon={<ShieldAlert size={14} />} columns={3}
          hint="These are checked for SHAPE only — a typo is caught, the registration itself is not verified. Nothing here says a GSTIN is real, because this app cannot know that.">
          <F label="GSTIN">
            <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              className={inputCls} placeholder="06AABCU9603R1ZM" />
            <Shape value={form.gstin} ok={/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin || "")} what="GSTIN" />
          </F>
          <F label="PAN">
            <input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} className={inputCls} placeholder="AABCU9603R" />
            <Shape value={form.pan} ok={/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan || "")} what="PAN" />
          </F>
          <F label="Serves which plants">
            <select multiple value={form.plants} disabled={isPlantManager}
              onChange={(e) => setForm({ ...form, plants: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              className={`${inputCls} h-[76px]`}>
              {(data?.plants || []).map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
            <p className="mt-1 text-[9.5px] text-biome-muted">Pick none for a company that serves everywhere.</p>
          </F>
        </FormSection>

        <FormSection title="Contact and address" columns={3}>
          <F label="Contact person"><input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className={inputCls} /></F>
          <F label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} /></F>
          <F label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></F>
          <div className="md:col-span-2">
            <F label="Address"><input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} className={inputCls} /></F>
          </div>
          <F label="City"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} /></F>
          <F label="State"><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={inputCls} /></F>
          <F label="PIN"><input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className={inputCls} /></F>
        </FormSection>

        <FormSection title="Bank" sectionIcon={<Landmark size={14} />} columns={3}
          hint="A payment released to an account nobody checked against a cancelled cheque is the most expensive mistake this register can prevent.">
          <F label="Bank"><input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} /></F>
          <F label="Account number"><input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className={inputCls} /></F>
          <F label="IFSC">
            <input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} className={inputCls} />
            <Shape value={form.ifsc} ok={/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc || "")} what="IFSC" />
          </F>
        </FormSection>

        <FormSection title="What was agreed" columns={2}
          hint="Written as words rather than a number, because terms vary too much to force into one field — rate per MT, freight per trip, a slab, a season.">
          <F label="Agreement runs from"><input type="date" value={form.agreementFrom} onChange={(e) => setForm({ ...form, agreementFrom: e.target.value })} className={inputCls} /></F>
          <F label="Until"><input type="date" value={form.agreementTo} onChange={(e) => setForm({ ...form, agreementTo: e.target.value })} className={inputCls} /></F>
          <div className="md:col-span-2">
            <F label="Rate and terms">
              <textarea rows={2} value={form.rateTerms} onChange={(e) => setForm({ ...form, rateTerms: e.target.value })}
                placeholder="₹5,450 per MT delivered at Jhajjar, moisture up to 12%" className={`${inputCls} resize-y`} />
            </F>
          </div>
          <div className="md:col-span-2">
            <F label="Payment terms">
              <input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                placeholder="30 days from receipt of material and complete papers" className={inputCls} />
            </F>
          </div>
          <div className="md:col-span-2">
            <F label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} resize-y`} /></F>
          </div>
        </FormSection>

        {editing && (
          <>
            <DocumentsSection partner={editing} types={docTypes} onChanged={load} locked={editingLocked} />
            <SubmitSection partner={editing} canUnlock={Boolean(data?.canUnlock)} busy={busy} onAction={lockAction} />
            <StatusSection partner={editing} statuses={data?.statuses || []} canActivate={data?.canActivate} busy={busy} onSet={setStatus} />
          </>
        )}
        {!editing && (
          <NewDocsSection types={docTypes} queued={queued} setQueued={setQueued} />
        )}
      </FormPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DocumentsSection({ partner, types, onChanged, locked }: { partner: Partner; types: any[]; onChanged: () => void; locked?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ type: "", reference: "", documentDate: "", validTill: "", note: "" });
  const [file, setFile] = useState<File | null>(null);

  async function upload() {
    if (!file || !draft.type) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("partnerId", partner.id);
      fd.append("file", file);
      Object.entries(draft).forEach(([k, v]) => fd.append(k, v));
      const res = await fetch("/api/partners", { method: "PATCH", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not attach that.");
      setFile(null);
      setDraft({ type: "", reference: "", documentDate: "", validTill: "", note: "" });
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/partners/document?partnerId=${partner.id}&id=${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not remove it.");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const expiresChosen = types.find((t) => t.id === draft.type)?.expires;

  return (
    <FormSection title="Documents on file" sectionIcon={<FileText size={14} />} columns={1}
      hint="The signed agreement, GST certificate, PAN and a cancelled cheque are what a company must have before it can be marked Active.">
      {err && <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>}

      {partner.documents.length > 0 && (
        <div className="space-y-1.5">
          {partner.documents.map((d) => {
            const expired = d.validTill && d.validTill < new Date().toISOString().slice(0, 10);
            return (
              <div key={d.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                expired ? "border-rose-500/35 bg-rose-500/[.06]" : "border-biome-line"
              }`}>
                <FileText size={12} className="shrink-0 text-biome-leaf" />
                <a href={`/api/partners/document?partnerId=${partner.id}&id=${d.id}`} target="_blank" rel="noreferrer"
                  className="text-[11.5px] font-semibold text-biome-text underline-offset-2 hover:underline">
                  {d.label}
                </a>
                <span className="text-[10px] text-biome-muted">
                  {d.reference && `${d.reference} · `}
                  {d.documentDate && `dated ${d.documentDate}`}
                  {d.validTill && ` · valid till ${d.validTill}`}
                  {expired && " · EXPIRED"}
                </span>
                <span className="ml-auto text-[9.5px] text-biome-muted">
                  {d.uploadedByName}{d.plant ? ` · ${d.plant}` : ""} · {Math.round(d.sizeBytes / 1024)} KB
                </span>
                <button onClick={() => remove(d.id)} disabled={busy || locked} title="Remove from the register"
                  className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-rose-500 disabled:opacity-60">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Required papers with nothing on file — the loud version. */}
      {(() => {
        const have = new Set(partner.documents.map((d) => d.type));
        const missingReq = types.filter((t) => t.required && !have.has(t.id));
        if (!missingReq.length) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-3 py-2">
            <ShieldAlert size={12} className="text-rose-500" />
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-rose-500">Required, not on file:</span>
            {missingReq.map((t) => (
              <span key={t.id} className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                {t.label}
              </span>
            ))}
          </div>
        );
      })()}

      {locked ? (
        <p className="rounded-xl border border-slate-400/40 bg-slate-400/[.08] px-3 py-2.5 text-[11px] leading-relaxed text-biome-muted">
          Submitted &amp; frozen — documents can no longer be attached or removed. Ask accounts, the admin or the developer to unlock it.
        </p>
      ) : (
      <div className="grid gap-2 rounded-xl border border-biome-line bg-biome-bg p-3 sm:grid-cols-2 lg:grid-cols-4">
        <F label="Document">
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={inputCls}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.required ? " *" : ""}</option>)}
          </select>
        </F>
        <F label="Reference on it"><input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} className={inputCls} /></F>
        <F label="Dated"><input type="date" value={draft.documentDate} onChange={(e) => setDraft({ ...draft, documentDate: e.target.value })} className={inputCls} /></F>
        <F label={expiresChosen ? "Valid till" : "Valid till (n/a)"}>
          <input type="date" value={draft.validTill} disabled={!expiresChosen}
            onChange={(e) => setDraft({ ...draft, validTill: e.target.value })} className={`${inputCls} disabled:opacity-50`} />
        </F>
        <div className="sm:col-span-2 lg:col-span-3">
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-[11.5px] text-biome-muted file:mr-3 file:rounded-xl file:border-0 file:bg-biome-leaf file:px-4 file:py-2 file:text-[11px] file:font-bold file:text-white" />
        </div>
        <button onClick={upload} disabled={busy || !file || !draft.type}
          className="bmx-btn flex items-center justify-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={13} className="bmx-spin" /> : <Upload size={13} />} Attach
        </button>
      </div>
      )}
    </FormSection>
  );
}

function StatusSection({
  partner, statuses, canActivate, busy, onSet,
}: { partner: Partner; statuses: any[]; canActivate: boolean; busy: boolean; onSet: (s: string, r: string) => void }) {
  const [reason, setReason] = useState(partner.statusReason || "");
  const g = partner.gaps;

  return (
    <FormSection title="Status" sectionIcon={<Check size={14} />} columns={1}>
      {!g.readyToActivate && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-4 py-3">
          <p className="text-[11.5px] font-semibold text-amber-600">Not ready to be marked Active</p>
          <ul className="mt-1 space-y-0.5">
            {g.missing.map((m) => <li key={m.id} className="text-[10.5px] text-biome-muted">· {m.label} — not uploaded</li>)}
            {g.expired.map((e) => <li key={e.id} className="text-[10.5px] text-rose-500">· {e.label} expired on {e.validTill}</li>)}
            {g.missingFields.map((f) => <li key={f} className="text-[10.5px] text-biome-muted">· {f} — not filled in</li>)}
          </ul>
        </div>
      )}

      {g.expiringSoon.length > 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/[.05] px-3 py-2 text-[11px] text-amber-600">
          {g.expiringSoon.map((e) => `${e.label} expires in ${e.days} day${e.days === 1 ? "" : "s"}`).join(" · ")}
        </p>
      )}

      {canActivate ? (
        <>
          <F label="Reason (needed to hold or block)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </F>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s: any) => (
              <button key={s.id} title={s.help} disabled={busy || s.id === partner.status}
                onClick={() => onSet(s.id, reason)}
                className={`bmx-chip rounded-xl border px-3.5 py-2 text-[11px] font-semibold disabled:opacity-40 ${
                  s.id === partner.status ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leaf" : "border-biome-line text-biome-muted"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-biome-muted">
          You can register a company and put their papers on file. Marking one Active is accounts&rsquo; or the
          admin&rsquo;s call — the same separation the rest of the app runs on.
        </p>
      )}
    </FormSection>
  );
}

/** KYC and business papers picked on the NEW registration form. */
function NewDocsSection({ types, queued, setQueued }: {
  types: any[];
  queued: { type: string; file: File; reference: string; validTill: string }[];
  setQueued: (q: { type: string; file: File; reference: string; validTill: string }[]) => void;
}) {
  const [type, setType] = useState("");
  const [reference, setReference] = useState("");
  const [validTill, setValidTill] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const expires = types.find((t) => t.id === type)?.expires;
  const have = new Set(queued.map((q) => q.type));
  const missingReq = types.filter((t) => t.required && !have.has(t.id));

  function add(files: FileList | null) {
    if (!files || !files.length) return;
    if (!type) { setErr("Choose which document this is first."); return; }
    const next = [...queued];
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024) { setErr(`${f.name} is over 15 MB.`); continue; }
      next.push({ type, file: f, reference, validTill });
    }
    setQueued(next); setErr(null); setReference(""); setValidTill("");
  }

  return (
    <FormSection title="KYC & business documents" sectionIcon={<FileText size={14} />} columns={1}
      hint="Attach them here — they upload the moment you press Register. Required papers are marked *. After registering, check everything and press Submit & freeze.">
      {err && <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>}
      {queued.length > 0 && (
        <div className="space-y-1.5">
          {queued.map((q, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line px-3 py-2">
              <FileText size={12} className="text-biome-leaf" />
              <span className="text-[11.5px] font-semibold text-biome-text">{types.find((t) => t.id === q.type)?.label || q.type}</span>
              <span className="text-[10px] text-biome-muted">{q.file.name} · {Math.round(q.file.size / 1024)} KB{q.reference && ` · ${q.reference}`}{q.validTill && ` · valid till ${q.validTill}`}</span>
              <button type="button" onClick={() => setQueued(queued.filter((_, j) => j !== i))} className="ml-auto rounded-lg border border-biome-line px-2 py-1 text-rose-500"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      {missingReq.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-amber-600">Still to attach:</span>
          {missingReq.map((t) => <span key={t.id} className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{t.label}</span>)}
        </div>
      )}
      <div className="grid gap-2 rounded-xl border border-biome-line bg-biome-bg p-3 sm:grid-cols-2 lg:grid-cols-4">
        <F label="Document">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.required ? " *" : ""}</option>)}
          </select>
        </F>
        <F label="Number on it"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} /></F>
        <F label={expires ? "Valid till" : "Valid till (n/a)"}>
          <input type="date" value={validTill} disabled={!expires} onChange={(e) => setValidTill(e.target.value)} className={`${inputCls} disabled:opacity-50`} />
        </F>
        <F label="File (PDF / photo)">
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => { add(e.target.files); e.target.value = ""; }}
            className="block w-full text-[11px] text-biome-muted file:mr-2 file:rounded-lg file:border-0 file:bg-biome-leaf file:px-3 file:py-1.5 file:text-[10.5px] file:font-bold file:text-white" />
        </F>
      </div>
    </FormSection>
  );
}

/** Submit & freeze (owner) and Unlock (accounts / admin / developer). */
function SubmitSection({ partner, canUnlock, busy, onAction }: {
  partner: Partner; canUnlock: boolean; busy: boolean;
  onAction: (a: "submit" | "unlock", extra: Record<string, unknown>) => void;
}) {
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const g = partner.gaps;
  const blockers = [...g.missing.map((m) => m.label), ...g.expired.map((e) => `${e.label} (expired)`), ...g.missingFields];
  const submitted = partner.lockState === "submitted";

  return (
    <FormSection title="Submit & freeze" sectionIcon={<Lock size={14} />} columns={1}>
      {!submitted ? (
        <>
          <p className="text-[11px] leading-relaxed text-biome-muted">
            When every field and document has been checked, submit it. After that it is frozen: you can no longer edit it or its
            documents — accounts, the admin or the developer must unlock it.
          </p>
          {blockers.length > 0 && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-3 py-2 text-[11px] text-amber-600">
              Before submitting: {blockers.join(", ")}.
            </p>
          )}
          <label className="flex items-center gap-2 text-[11.5px] text-biome-text">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            I have checked every detail and every document.
          </label>
          <button onClick={() => onAction("submit", { confirmChecked: checked })} disabled={busy || !checked || blockers.length > 0}
            className="bmx-btn flex w-fit items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="bmx-spin" /> : <Lock size={13} />} Submit &amp; freeze
          </button>
        </>
      ) : canUnlock ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <F label="Reason for unlocking">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Bank account changed — new cancelled cheque" className={inputCls} />
            </F>
          </div>
          <button onClick={() => onAction("unlock", { reason })} disabled={busy || !reason.trim()}
            className="bmx-chip flex items-center gap-2 rounded-xl border border-amber-500/40 px-4 py-2.5 text-[11.5px] font-semibold text-amber-600 disabled:opacity-50">
            <Unlock size={13} /> Unlock for correction
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-biome-muted">Frozen. Ask accounts, the admin or the developer if something needs correcting.</p>
      )}
      {(partner.lockHistory || []).length > 0 && (
        <ul className="space-y-0.5">
          {(partner.lockHistory || []).slice().reverse().map((h, i) => (
            <li key={i} className="text-[10px] text-biome-muted">
              · {new Date(h.at).toLocaleString("en-IN")} — {h.action === "submitted" ? "Submitted & frozen" : "Unlocked"} by {h.byName}{h.reason ? ` · ${h.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}

function Shape({ value, ok, what }: { value: string; ok: boolean; what: string }) {
  if (!value) return null;
  return (
    <p className={`mt-1 text-[9.5px] ${ok ? "text-emerald-600" : "text-amber-600"}`}>
      {ok ? `Looks like a ${what} — the shape is right, not the registration.` : `That doesn't look like a ${what}.`}
    </p>
  );
}

function Tile({ label, value, hint, tone, accent, icon }: any) {
  return (
    <div className={`bmx-card rounded-2xl border p-4 ${accent ? "border-rose-500/30 bg-rose-500/[.06]" : "border-biome-line bg-biome-bgSoft"}`}>
      <div className="flex items-start justify-between">
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
 * "Send registration email" — manual, with the full letter.
 * Automation was refused on purpose: an automated letter fired at a
 * half-finished registration reads as a confirmation the business never
 * meant to give. The button proposes the partner's email and lets the
 * sender change it before anything leaves.
 */
function RegistrationEmailButton({ partner }: { partner: Partner }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    const to = window.prompt("Send the registration letter to:", (partner as any).email || "");
    if (to === null) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/partners/registration-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: partner.id, to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setNote({ ok: true, text: `Sent to ${json.to}.` });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="mr-auto flex items-center gap-2">
      <button onClick={send} disabled={busy}
        className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-60">
        {busy ? <Loader2 size={13} className="bmx-spin" /> : <Mail size={13} />} Send registration email
      </button>
      {note && (
        <span className={`text-[10.5px] ${note.ok ? "text-emerald-500" : "text-rose-500"}`}>{note.text}</span>
      )}
    </span>
  );
}
