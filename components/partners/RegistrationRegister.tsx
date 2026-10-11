"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import {
  Handshake, Truck, Plus, Loader2, AlertCircle, Check, Search, FileText, Upload, ShieldAlert, Clock,
  Building2, Landmark, X, Trash2, Mail, Lock, Unlock, Users, Phone, FileCheck2, ShieldCheck, Eye,
  ClipboardList, BadgeCheck, CircleDot, Package, ArrowRight, UserCog, Download, AlertTriangle,
} from "lucide-react";
import { FormSection } from "@/components/FormPanel";
import DevEditedChip from "@/components/DevEditedChip";
import RequirementsModal, { requirementsOf, type RequirementsValue } from "@/components/partners/RequirementsModal";
import {
  ResponsibleChip, AssignModal, ResponsibilitySection, DuplicateCodesBanner, ImportModal,
  type ResponsibleFields,
} from "@/components/partners/ResponsibilityParts";

/**
 * Vendor registration and Client registration — two pages, one engine.
 *
 * Left: the register (search, status / freeze chips, filters) with a
 * completeness bar on every row. Right: the selected record as a tidy,
 * sectioned form — Basic, Tax & Bank, Contacts, Documents, Requirements
 * (clients), Terms, Status & freeze — with a completeness meter and a
 * plain freeze / approval stepper at the top.
 *
 * Every field and action of the old combined screen is still here (codes
 * with suggest + duplicate warning, KYC upload on the new form, Submit &
 * freeze, unlock, status, registration email, follow-ups). Clients also
 * carry what used to live in the separate client master: short name,
 * aliases the WhatsApp agent matches on, document requirements with DSC
 * rules (editable only with "customers.requirements") and the client POs.
 */

export type RegisterMode = "vendors" | "clients";

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
interface PO { id: string; number: string; date: string; validTill: string; quantityMt: number; location: string; notes: string; active: boolean }
interface Partner extends ResponsibleFields {
  id: string; kind: string; code: string; name: string; legalName: string;
  gstin: string; pan: string; plants: string[]; material: string;
  contactPerson: string; phone: string; email: string;
  addressLine: string; city: string; state: string; pincode: string;
  bankName: string; accountNumber: string; ifsc: string;
  rateTerms: string; paymentTerms: string; agreementFrom: string; agreementTo: string;
  status: string; statusReason: string; documents: PartnerDoc[]; notes: string;
  registeredByName: string; createdAt: string; updatedAt?: string;
  category: string;
  supplies?: string[];
  lockState?: "open" | "submitted";
  lockedAt?: string;
  lockedByName?: string;
  lockHistory?: { at: string; byName: string; action: string; reason: string }[];
  gaps: Gaps;
  freeze?: { frozen: boolean; daysLeft: number; freezesOn: string };
  locked?: boolean;
  // client-only
  shortName?: string; aliases?: string[]; requires?: string[]; dscOn?: string[];
  requirementNotes?: string; poNumbers?: PO[]; requirementsUpdatedAt?: string; requirementsUpdatedBy?: string;
}

const blankVendor = {
  kind: "biomass_vendor", category: "raw_material", supplies: ["biomass"] as string[],
  code: "", name: "", legalName: "", gstin: "", pan: "",
  plants: [] as string[], material: "", contactPerson: "", phone: "", email: "",
  addressLine: "", city: "", state: "", pincode: "",
  bankName: "", accountNumber: "", ifsc: "",
  rateTerms: "", paymentTerms: "", agreementFrom: "", agreementTo: "", notes: "",
};
const blankClient = {
  ...blankVendor, kind: "client", supplies: [] as string[],
  shortName: "", aliasesText: "", requires: [] as string[], dscOn: [] as string[], requirementNotes: "",
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** What the code is called for this kind of partner. */
const codeLabel = (kind: string) =>
  kind === "transporter" ? "Transporter code" : kind === "client" ? "Client code" : kind === "other" ? "Partner code" : "Vendor code";

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  draft: "border-biome-line bg-biome-hover text-biome-muted",
  on_hold: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  blocked: "border-rose-500/40 bg-rose-500/10 text-rose-500",
};
const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500", draft: "bg-slate-400", on_hold: "bg-amber-500", blocked: "bg-rose-500",
};

/**
 * How complete a record is — one list of checks, used for the meter on
 * the form and the bar on every row. Required papers count; for a client
 * so do its document requirements (no requirements = no supply can ever
 * be marked complete).
 */
function completeness(p: any, docTypes: any[], queuedTypes?: string[]): { pct: number; missing: string[] } {
  const isClient = p.kind === "client";
  const checks: [string, boolean][] = [
    ["Name", Boolean(String(p.name || "").trim())],
    [codeLabel(p.kind), Boolean(String(p.code || "").trim())],
    ["Legal name", Boolean(String(p.legalName || "").trim())],
    ["GSTIN", GSTIN_RE.test(String(p.gstin || "").toUpperCase())],
    ["PAN", PAN_RE.test(String(p.pan || "").toUpperCase())],
    ["Contact person", Boolean(String(p.contactPerson || "").trim())],
    ["Phone", Boolean(String(p.phone || "").trim())],
    ["Email", Boolean(String(p.email || "").trim())],
    ["Address, city, state, PIN", Boolean(String(p.addressLine || "").trim() && String(p.city || "").trim() && String(p.state || "").trim() && String(p.pincode || "").trim())],
  ];
  if (!isClient) checks.push(["Bank account and IFSC", Boolean(String(p.accountNumber || "").trim()) && IFSC_RE.test(String(p.ifsc || "").toUpperCase())]);
  if (isClient) checks.push(["Document requirements", (p.requires || []).length > 0]);
  const have = new Set<string>(queuedTypes || (p.documents || []).map((d: PartnerDoc) => d.type));
  for (const t of docTypes.filter((t) => t.required && (t.kinds.length === 0 || t.kinds.includes(p.kind)))) {
    checks.push([t.label, have.has(t.id)]);
  }
  const done = checks.filter(([, ok]) => ok).length;
  return { pct: checks.length ? Math.round((done / checks.length) * 100) : 0, missing: checks.filter(([, ok]) => !ok).map(([l]) => l) };
}

function tone(pct: number) {
  return pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-lime-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
}

export default function RegistrationRegister({ mode }: { mode: RegisterMode }) {
  const isClientsPage = mode === "clients";
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(isClientsPage ? { ...blankClient } : { ...blankVendor });
  const [filters, setFilters] = useState({ kind: "all", status: "all", category: "all", lock: "all", attention: "all", owner: "all", search: "" });
  // Bulk selection (responsible-person assignment) and the dialogs.
  const [picked, setPicked] = useState<string[]>([]);
  const [assign, setAssign] = useState<null | { ids: string[]; label: string; initial?: ResponsibleFields }>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Papers chosen on the NEW registration form — uploaded right after the
  // record is created, so KYC goes in on the same screen.
  const [queued, setQueued] = useState<{ type: string; file: File; reference: string; validTill: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reqModal, setReqModal] = useState<null | { readOnly: boolean }>(null);
  const [activeSection, setActiveSection] = useState("basic");
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/partners?tab=${mode}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load.");
      setData(json);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [mode]);
  // Reload when anything is saved on any device — phone, other PC, other tab.
  useLiveRefresh(() => load());
  useEffect(() => { load(); }, [load]);

  // Open a record named in the link (?id= / ?partnerId=), e.g. from Work.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get("id") || q.get("partnerId");
      if (id) setSelectedId(id);
      if (q.get("new") === "1") startAdd();
    } catch { /* no window */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all: Partner[] = useMemo(() => data?.partners || [], [data]);
  const editing: Partner | null = useMemo(() => (selectedId ? all.find((p) => p.id === selectedId) || null : null), [all, selectedId]);
  const open = creating || Boolean(editing);

  // Keep the form filled from the record the first time it is opened.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (editing && loadedFor.current !== editing.id) {
      loadedFor.current = editing.id;
      setForm(formFrom(editing));
    }
  }, [editing]);

  const s = data?.summary;
  const myRole: string = data?.myRole || "";
  const isCoordinator = myRole === "coordinator";
  // Procurement registers manufacturing-side vendors too (spare parts, stores).
  const isPlantManager = myRole === "plant_manager" || myRole === "procurement";
  const canEditReq = Boolean(data?.canEditRequirements);
  const canManage = Boolean(data?.canManage);
  const me: string = data?.me || "";
  const teams: { id: string; label: string }[] = data?.teams || [];
  const people: { id: string; name: string; role: string; team: string }[] = data?.people || [];
  const dupCodes: { code: string; category: string; holders: { id: string; name: string }[] }[] = data?.duplicateCodes || [];
  const dupIds = new Set(dupCodes.flatMap((d) => d.holders.map((h) => h.id)));
  const allDocTypes: any[] = data?.documentTypes || [];
  const docTypes = allDocTypes.filter((t: any) => t.kinds.length === 0 || t.kinds.includes(form.kind));
  const editingLocked = Boolean(editing?.locked);
  const kinds: any[] = (data?.kinds || []).filter((k: any) => (isClientsPage ? k.id === "client" : k.id !== "client"));
  const statusLabel = (id: string) => (data?.statuses || []).find((x: any) => x.id === id)?.label || id;

  function formFrom(p: Partner) {
    const base = isClientsPage ? blankClient : blankVendor;
    return { ...base, ...p, aliasesText: (p.aliases || []).join(", "), ...(p.kind === "client" ? requirementsOf(p) : {}) };
  }

  function startAdd() {
    setSelectedId(null);
    loadedFor.current = null;
    const base = isClientsPage ? blankClient : blankVendor;
    setForm({
      ...base,
      category: data?.myRole === "coordinator" ? "trading" : "raw_material",
      plants: data?.myRole === "plant_manager" && data?.myPlant ? [data.myPlant] : [],
      supplies: isClientsPage ? [] : data?.myRole === "procurement" ? ["spare_parts"] : blankVendor.supplies,
    });
    setQueued([]);
    setNotice(null);
    setError(null);
    setCreating(true);
    setActiveSection("basic");
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function select(p: Partner) {
    setNotice(null);
    setError(null);
    setCreating(false);
    loadedFor.current = null;
    setSelectedId(p.id);
    setActiveSection("basic");
    if (window.innerWidth < 1024) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function closeDetail() {
    setCreating(false);
    setSelectedId(null);
    loadedFor.current = null;
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const body: any = { ...form, aliases: String(form.aliasesText || "").split(",").map((a: string) => a.trim()).filter(Boolean) };
      delete body.aliasesText;
      delete body.gaps; delete body.freeze; delete body.locked; delete body.documents; delete body.poNumbers;
      if (editing) {
        // Requirements on an existing client change only through the
        // "Edit requirement documents" dialog — never through this save,
        // so an older copy in this form cannot overwrite a newer one.
        delete body.requires; delete body.dscOn; delete body.requirementNotes;
        body.id = editing.id;
      } else if (!isClientsPage || !canEditReq) {
        delete body.requires; delete body.dscOn; delete body.requirementNotes;
      }
      const res = await fetch("/api/partners", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      if (editing) {
        setNotice("Saved.");
      } else {
        // Upload the papers chosen on the form, then open the new record
        // so it can be checked and submitted.
        const failed: string[] = [];
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
        }
        setQueued([]);
        setCreating(false);
        loadedFor.current = null;
        setSelectedId(json.partner.id);
        setNotice(
          failed.length
            ? `Registered. ${failed.length} document(s) did not upload: ${failed.join("; ")}`
            : "Registered with its documents. Check every detail and paper below, then press Submit & freeze."
        );
      }
      await load();
      if (editing) { loadedFor.current = null; }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function putAction(body: Record<string, unknown>, okText: string) {
    if (!editing) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/partners", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not do that.");
      setNotice(okText);
      await load();
      loadedFor.current = null;
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const lockAction = (action: "submit" | "unlock", extra: Record<string, unknown>) =>
    putAction({ action, ...extra }, action === "submit" ? "Submitted and frozen. Only accounts, admin or the developer can change it now." : "Unlocked — the owner can correct it and submit again.");
  const setStatus = (status: string, reason: string) => putAction({ status, statusReason: reason }, `Status set to ${statusLabel(status)}.`);

  async function saveRequirements(v: RequirementsValue) {
    if (!editing) {
      // New client: the requirements go in with the registration.
      setForm((f: any) => ({ ...f, ...v }));
      setReqModal(null);
      return;
    }
    const res = await fetch("/api/partners", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, action: "requirements", ...v }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not save the requirements.");
    setReqModal(null);
    setNotice(`Document requirements saved — ${v.requires.length} required.`);
    await load();
    setForm((f: any) => ({ ...f, ...requirementsOf(json.partner) }));
  }

  async function removeClient() {
    if (!editing) return;
    if (!window.confirm(`Remove ${editing.name} from the client register? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/clients?id=${encodeURIComponent(editing.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not remove.");
      closeDetail();
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  /** Save the responsible person / team for one record or the bulk selection. */
  async function saveAssignment(ids: string[], body: Record<string, string>) {
    const res = await fetch("/api/partners/responsible", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not save who is responsible.");
    setAssign(null);
    setPicked([]);
    setNotice(
      json.changed
        ? `Responsible person saved for ${json.changed} record${json.changed === 1 ? "" : "s"}.${json.notified?.length ? ` Notice sent to ${json.notified.join(", ")}.` : ""}`
        : json.note || "Nothing changed."
    );
    await load();
  }

  /**
   * Instant duplicate check over the records this person can see — the
   * server repeats it (per plant / trading register) on save, so this is
   * only the early warning, never the rule.
   */
  const codeTaken: Partner | null = (() => {
    const c = String(form.code || "").trim().toUpperCase();
    if (!c) return null;
    const cat = isCoordinator ? "trading" : isPlantManager ? "raw_material" : form.category;
    const plants: string[] = (form.plants || []).map((x: string) => x.toUpperCase());
    return all.find((p) => {
      if (editing && p.id === editing.id) return false;
      if (String(p.code || "").toUpperCase() !== c) return false;
      if ((p.category === "trading") !== (cat === "trading")) return false;
      if (cat === "trading") return true;
      if (!plants.length || !p.plants.length) return true;
      return p.plants.some((x) => plants.includes(String(x).toUpperCase()));
    }) || null;
  })();

  async function suggestCode() {
    try {
      const qs = new URLSearchParams({ nextCode: "1", kind: form.kind, category: form.category || "", plants: (form.plants || []).join(",") });
      const res = await fetch(`/api/partners?${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.code) setForm((f: any) => ({ ...f, code: json.code }));
    } catch { /* typing one by hand still works */ }
  }

  /* ---------------- the list, filtered here ---------------- */
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return all.filter((p) => {
      if (filters.kind !== "all" && p.kind !== filters.kind) return false;
      if (filters.category !== "all" && p.category !== filters.category) return false;
      if (filters.status !== "all" && p.status !== filters.status) return false;
      if (filters.lock === "submitted" && p.lockState !== "submitted") return false;
      if (filters.lock === "open" && p.lockState === "submitted") return false;
      if (filters.attention === "gaps" && !(p.gaps.missing.length || p.gaps.missingFields.length)) return false;
      if (filters.attention === "expiry" && !(p.gaps.expired.length || p.gaps.expiringSoon.length)) return false;
      if (filters.attention === "noreq" && (p.requires || []).length > 0) return false;
      if (filters.attention === "nocode" && p.code) return false;
      if (filters.attention === "dupcode" && !dupIds.has(p.id)) return false;
      if (filters.owner === "mine" && !(me && (p.responsibleUserId === me || p.backupUserId === me))) return false;
      if (filters.owner === "none" && p.responsibleName) return false;
      if (filters.owner.startsWith("team:") && p.team !== filters.owner.slice(5)) return false;
      if (filters.owner.startsWith("user:") && p.responsibleUserId !== filters.owner.slice(5) && p.backupUserId !== filters.owner.slice(5)) return false;
      if (filters.owner.startsWith("name:") && (p.responsibleUserId || p.responsibleName !== filters.owner.slice(5))) return false;
      if (q && ![p.name, p.legalName, p.code, p.gstin, p.pan, p.city, p.contactPerson, p.phone, p.shortName || "", ...(p.aliases || []), p.responsibleName || "", p.backupName || ""].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filters, me, data]);
  const countBy = (pred: (p: Partner) => boolean) => all.filter(pred).length;

  const comp = completeness(form, allDocTypes, creating ? queued.map((q) => q.type) : undefined);
  const req = requirementsOf(form);
  const reqForView = editing ? requirementsOf(editing) : req;
  const pageTitle = isClientsPage ? "Client registration" : "Vendor registration";
  const scopeLabel = isCoordinator ? "Trading" : isPlantManager ? "Manufacturing · my plant" : "All registers";

  const sections = [
    ...(editing ? [{ id: "responsible", label: "Responsible" }] : []),
    { id: "basic", label: "Basic" },
    { id: "tax", label: "Tax & Bank" },
    { id: "contacts", label: "Contacts" },
    { id: "documents", label: "Documents" },
    ...(isClientsPage ? [{ id: "requirements", label: "Requirements" }] : []),
    { id: "terms", label: "Terms" },
    ...(editing ? [{ id: "status", label: "Status & freeze" }] : []),
  ];
  function goTo(id: string) {
    setActiveSection(id);
    document.getElementById(`reg-sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-4" data-testid={`register-${mode}`}>
      {/* ---------- Header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 inline-flex rounded-xl border border-biome-line bg-biome-bgSoft p-1" role="tablist">
            <Link href="/partners/vendors" role="tab" aria-selected={!isClientsPage} data-testid="tab-vendors"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${!isClientsPage ? "bg-biome-leaf text-white" : "text-biome-muted hover:text-biome-text"}`}>
              <Truck size={13} /> Vendors{data?.tabCounts ? <span className="opacity-80">· {data.tabCounts.vendors}</span> : null}
            </Link>
            <Link href="/partners/clients" role="tab" aria-selected={isClientsPage} data-testid="tab-clients"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${isClientsPage ? "bg-biome-leaf text-white" : "text-biome-muted hover:text-biome-text"}`}>
              <Users size={13} /> Clients{data?.tabCounts ? <span className="opacity-80">· {data.tabCounts.clients}</span> : null}
            </Link>
          </div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            {isClientsPage ? <Users size={19} className="text-biome-leaf" /> : <Handshake size={19} className="text-biome-leaf" />}
            {pageTitle}
            <span className="rounded-full border border-biome-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-biome-muted">{scopeLabel}</span>
          </h1>
          <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-biome-muted">
            {isClientsPage
              ? "Every client in one register — GST, PAN, contacts, KYC papers, and the documents each client requires with a supply (used by the WhatsApp agent, coordination and billing)."
              : isCoordinator
                ? "Trading vendors and transporters. Manufacturing vendors are registered by each site's plant manager. Upload KYC, check everything, then Submit & freeze."
                : isPlantManager
                  ? "Manufacturing vendors and transporters for your site. Upload KYC, check everything, then Submit & freeze — after that only accounts, admin or the developer can change it."
                  : "Vendors, transporters and other partners — trading (coordinator) and manufacturing (plant manager). Frozen records can be corrected or unlocked here."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button onClick={() => setImportOpen(true)} data-testid="import-open"
              title={isClientsPage ? "Bring the owner's client list into the trading clients (preview first)" : "Bring the owner's vendor code list into the trading vendors (preview first)"}
              className="flex items-center gap-2 rounded-xl border border-biome-line bg-biome-bgSoft px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-text hover:bg-biome-hover">
              <Download size={14} /> {isClientsPage ? "Import client list" : "Import vendor code list"}
            </button>
          )}
          <button onClick={startAdd} data-testid="register-new"
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
            <Plus size={14} /> {isClientsPage ? "Register a client" : "Register a vendor"}
          </button>
        </div>
      </header>

      <DuplicateCodesBanner dups={dupCodes} onOpen={(id) => { const p = all.find((x) => x.id === id); if (p) select(p); }} />

      {error && !open && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {/* ---------- Summary ---------- */}
      {s && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Registered" value={s.total} hint={`${s.active} active`} tone="text-sky-600 bg-sky-500/12" icon={<Building2 size={14} />}
            onClick={() => setFilters({ ...filters, status: "all", lock: "all", attention: "all" })} />
          <Tile label="Still draft" value={s.draft} hint="not activated" tone="text-biome-muted bg-biome-line/40" icon={<Clock size={14} />}
            onClick={() => setFilters({ ...filters, status: "draft" })} />
          <Tile label="Submitted & frozen" value={s.frozen ?? 0} hint="locked for owner" tone="text-slate-500 bg-slate-400/15" icon={<Lock size={14} />}
            onClick={() => setFilters({ ...filters, lock: "submitted" })} />
          <Tile label="Expired papers" value={s.expired} hint="stop until renewed" accent={s.expired > 0}
            tone={s.expired ? "text-rose-500 bg-rose-500/12" : "text-emerald-600 bg-emerald-500/12"} icon={<ShieldAlert size={14} />}
            onClick={() => setFilters({ ...filters, attention: "expiry" })} />
          <Tile label="Expiring in 30 days" value={s.expiringSoon} hint="chase these now"
            tone={s.expiringSoon ? "text-amber-600 bg-amber-500/12" : "text-emerald-600 bg-emerald-500/12"} icon={<Clock size={14} />}
            onClick={() => setFilters({ ...filters, attention: "expiry" })} />
          {isClientsPage ? (
            <Tile label="Requirements not set" value={s.requirementsMissing ?? 0} hint="no supply can complete" accent={(s.requirementsMissing ?? 0) > 0}
              tone={(s.requirementsMissing ?? 0) ? "text-amber-600 bg-amber-500/12" : "text-emerald-600 bg-emerald-500/12"} icon={<FileCheck2 size={14} />}
              onClick={() => setFilters({ ...filters, attention: "noreq" })} />
          ) : (
            <Tile label="Papers missing" value={countBy((p) => p.gaps.missing.length > 0 || p.gaps.missingFields.length > 0)} hint="fields or KYC"
              tone="text-amber-600 bg-amber-500/12" icon={<ClipboardList size={14} />}
              onClick={() => setFilters({ ...filters, attention: "gaps" })} />
          )}
        </div>
      )}

      {/* ---------- List + detail ---------- */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        {/* List */}
        <aside className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft lg:sticky lg:top-3">
          <div className="space-y-2.5 border-b border-biome-line p-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
              <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                data-testid="register-search"
                placeholder={isClientsPage ? "Name, short name, alias, code, GSTIN" : "Name, code, GSTIN, PAN, city"}
                className="w-full rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/50" />
            </div>
            <div className="flex flex-wrap gap-1">
              {[{ id: "all", label: "All" }, ...(data?.statuses || [])].map((x: any) => {
                const n = x.id === "all" ? all.length : countBy((p) => p.status === x.id);
                const on = filters.status === x.id;
                return (
                  <button key={x.id} onClick={() => setFilters({ ...filters, status: x.id })} data-testid={`chip-status-${x.id}`}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${on ? "border-biome-leaf/60 bg-biome-leaf/15 text-biome-text" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                    {x.id !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[x.id] || "bg-slate-400"}`} />}
                    {x.label} <span className="font-mono opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "all", label: "Any stage" },
                { id: "open", label: "Not submitted" },
                { id: "submitted", label: "Frozen" },
              ].map((x) => (
                <button key={x.id} onClick={() => setFilters({ ...filters, lock: x.id })}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${filters.lock === x.id ? "border-sky-500/60 bg-sky-500/12 text-biome-text" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                  {x.id === "submitted" && <Lock size={9} />}{x.label}
                </button>
              ))}
              <select value={filters.attention} onChange={(e) => setFilters({ ...filters, attention: e.target.value })} className={selectCls} aria-label="Needs attention">
                <option value="all">Any condition</option>
                <option value="gaps">Missing fields / papers</option>
                <option value="expiry">Expired / expiring papers</option>
                {isClientsPage && <option value="noreq">Requirements not set</option>}
                <option value="nocode">No code yet</option>
                {dupCodes.length > 0 && <option value="dupcode">Duplicate code</option>}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => setFilters({ ...filters, owner: filters.owner === "mine" ? "all" : "mine" })} data-testid="filter-mine"
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${filters.owner === "mine" ? "border-biome-leaf/60 bg-biome-leaf/15 text-biome-text" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                <UserCog size={10} /> {isClientsPage ? "My clients" : "My vendors"} <span className="font-mono opacity-70">{countBy((p) => Boolean(me) && (p.responsibleUserId === me || p.backupUserId === me))}</span>
              </button>
              <select value={filters.owner} onChange={(e) => setFilters({ ...filters, owner: e.target.value })} className={selectCls} aria-label="Responsible" data-testid="filter-owner">
                <option value="all">Anyone responsible</option>
                <option value="mine">Mine (responsible or backup)</option>
                <option value="none">Unassigned</option>
                {teams.length > 0 && <optgroup label="Team">{teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.label}</option>)}</optgroup>}
                <optgroup label="Person">
                  {people.filter((u) => all.some((p) => p.responsibleUserId === u.id || p.backupUserId === u.id)).map((u) => <option key={u.id} value={`user:${u.id}`}>{u.name}</option>)}
                  {Array.from(new Set(all.filter((p) => !p.responsibleUserId && p.responsibleName).map((p) => p.responsibleName!))).map((n) => <option key={n} value={`name:${n}`}>{n} (no login)</option>)}
                </optgroup>
              </select>
            </div>
            {(!isClientsPage || (!isCoordinator && !isPlantManager)) && (
              <div className="flex flex-wrap gap-1.5">
                {!isClientsPage && (
                  <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })} className={selectCls} aria-label="Kind">
                    <option value="all">Vendors, transporters, others</option>
                    {kinds.map((k: any) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                )}
                {!isCoordinator && !isPlantManager && (
                  <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={selectCls} aria-label="Business side">
                    <option value="all">Trading + manufacturing</option>
                    {(data?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          {canManage && filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-biome-line bg-biome-bg/60 px-3 py-2" data-testid="bulk-bar">
              <label className="flex items-center gap-1.5 text-[10.5px] font-semibold text-biome-muted">
                <input type="checkbox" data-testid="bulk-all"
                  checked={filtered.length > 0 && filtered.every((p) => picked.includes(p.id))}
                  onChange={(e) => setPicked(e.target.checked ? Array.from(new Set([...picked, ...filtered.map((p) => p.id)])) : picked.filter((id) => !filtered.some((p) => p.id === id)))} />
                {picked.length ? `${picked.length} selected` : "Select"}
              </label>
              {picked.length > 0 && (
                <>
                  <button onClick={() => setAssign({ ids: picked, label: `${picked.length} selected` })} data-testid="bulk-assign"
                    className="ml-auto flex items-center gap-1 rounded-lg bg-biome-leaf px-2.5 py-1 text-[10.5px] font-bold text-white">
                    <UserCog size={11} /> Assign responsible
                  </button>
                  <button onClick={() => setPicked([])} className="rounded-lg border border-biome-line px-2 py-1 text-[10.5px] text-biome-muted">Clear</button>
                </>
              )}
            </div>
          )}
          <div className="max-h-[calc(100vh-260px)] min-h-[200px] overflow-y-auto p-2" data-testid="register-list">
            {!data ? (
              <p className="flex items-center justify-center gap-2 py-10 text-[11.5px] text-biome-muted"><Loader2 size={14} className="animate-spin" /> Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-[12px] font-semibold text-biome-text">{all.length ? "Nothing matches these filters" : isClientsPage ? "No client registered yet" : "Nobody registered yet"}</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                  {all.length ? "Clear a chip or the search." : isClientsPage
                    ? "Register a client with GST, PAN and its document requirements."
                    : "Register a vendor or transporter, then attach the agreement, GST certificate, PAN and a cancelled cheque."}
                </p>
                {!all.length && (
                  <button onClick={startAdd} className="mt-3 rounded-xl bg-biome-leaf px-3 py-1.5 text-[11px] font-bold text-white">Register the first one</button>
                )}
              </div>
            ) : (
              <ul className="space-y-1">
                {filtered.map((p) => {
                  const c = completeness(p, allDocTypes);
                  const sel = editing?.id === p.id;
                  const issues = p.gaps.expired.length + p.gaps.missing.length + p.gaps.missingFields.length;
                  return (
                    <li key={p.id} className="flex items-start gap-1.5">
                      {canManage && (
                        <input type="checkbox" aria-label={`Select ${p.name}`} data-testid="bulk-pick" className="mt-3.5 shrink-0"
                          checked={picked.includes(p.id)}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                      )}
                      <button onClick={() => select(p)} data-testid="register-row" data-name={p.name}
                        className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          sel ? "border-biome-leaf/60 bg-biome-leaf/[.10]" : (p as any).devEdited ? "border-amber-500/40 hover:bg-biome-hover" : "border-transparent hover:border-biome-line hover:bg-biome-hover"
                        }`}>
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            p.kind === "transporter" ? "bg-orange-500/12 text-orange-500" : p.kind === "client" ? "bg-sky-500/12 text-sky-600" : "bg-lime-500/12 text-lime-600"}`}>
                            {p.kind === "transporter" ? <Truck size={13} /> : p.kind === "client" ? <Users size={13} /> : <Handshake size={13} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-semibold text-biome-text">{p.name}</p>
                            <p className="truncate text-[10px] text-biome-muted">
                              {p.code
                                ? <span className={`font-mono font-semibold ${dupIds.has(p.id) ? "rounded bg-rose-500/15 px-1 text-rose-600" : "text-biome-text/80"}`} title={dupIds.has(p.id) ? "Another vendor has the same code — fix it" : undefined}>{p.code}{dupIds.has(p.id) ? " ⚠ duplicate" : ""}</span>
                                : <span className="text-amber-600">no code</span>}
                              {` · ${p.gstin || "no GSTIN"}`}{p.city ? ` · ${p.city}` : ""}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[.08em] ${STATUS_TONE[p.status] || STATUS_TONE.draft}`}>
                            {statusLabel(p.status)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-biome-line/60" title={`${c.pct}% complete`}>
                            <div className={`h-full rounded-full ${tone(c.pct)}`} style={{ width: `${c.pct}%` }} />
                          </div>
                          <span className="font-mono text-[9.5px] text-biome-muted">{c.pct}%</span>
                          {p.lockState === "submitted" && <Lock size={10} className="text-biome-muted" aria-label="Submitted & frozen" />}
                          {p.category === "trading"
                            ? <span className="text-[8.5px] font-bold uppercase tracking-[.06em] text-cyan-600">Trading</span>
                            : <span className="text-[8.5px] font-bold uppercase tracking-[.06em] text-lime-600">Mfg</span>}
                          {issues > 0 && <span className="rounded-full bg-rose-500/12 px-1.5 text-[9px] font-bold text-rose-500" title="Missing or expired">{issues}!</span>}
                          {p.gaps.expiringSoon.length > 0 && <span className="rounded-full bg-amber-500/12 px-1.5 text-[9px] font-bold text-amber-600" title="Expiring soon">{p.gaps.expiringSoon.length}⏳</span>}
                          {p.kind === "client" && !(p.requires || []).length && <span className="rounded-full bg-amber-500/12 px-1.5 text-[9px] font-bold text-amber-600" title="Document requirements not set">req?</span>}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1">
                          <ResponsibleChip p={p} teams={teams} me={me} />
                          {p.backupName && <span className="truncate text-[9px] text-biome-muted">backup {p.backupName}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Detail */}
        <div ref={detailRef} className="min-w-0 scroll-mt-4">
          {!open ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-biome-line bg-biome-bgSoft/60 px-6 py-12 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-biome-leaf/12 text-biome-leaf">
                {isClientsPage ? <Users size={22} /> : <Handshake size={22} />}
              </span>
              <p className="text-[14px] font-semibold text-biome-text">Pick a {isClientsPage ? "client" : "vendor"} from the list</p>
              <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-biome-muted">
                The record opens here, section by section, with what is still missing at the top. Or register a new one.
              </p>
              <button onClick={startAdd} className="mt-4 flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">
                <Plus size={13} /> {isClientsPage ? "Register a client" : "Register a vendor"}
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft" data-testid="register-detail">
              {/* Detail header */}
              <div className="border-b border-biome-line px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isClientsPage ? "bg-sky-500/12 text-sky-600" : form.kind === "transporter" ? "bg-orange-500/12 text-orange-500" : "bg-lime-500/12 text-lime-600"}`}>
                    {isClientsPage ? <Users size={20} /> : form.kind === "transporter" ? <Truck size={20} /> : <Handshake size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">
                      {editing ? (editing.lockState === "submitted" ? "Submitted & frozen" : "Registered — not yet submitted") : isClientsPage ? "New client registration" : "New vendor registration"}
                    </p>
                    <h2 className="truncate text-[17px] font-semibold tracking-[-.02em] text-biome-text" data-testid="detail-title">
                      {editing ? editing.name : form.name || (isClientsPage ? "Register a client" : "Register a vendor")}
                    </h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {editing && (
                        <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.08em] ${STATUS_TONE[editing.status] || STATUS_TONE.draft}`}>{statusLabel(editing.status)}</span>
                      )}
                      {editing?.code && <span className="rounded-md border border-biome-line bg-biome-bg px-1.5 py-0.5 font-mono text-[10px] font-semibold text-biome-text" data-testid="partner-code-badge">{editing.code}</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] ${(editing?.category || form.category) === "trading" || isCoordinator ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-600" : "border-lime-500/40 bg-lime-500/10 text-lime-600"}`}>
                        {(editing?.category || form.category) === "trading" || isCoordinator ? "Trading" : "Manufacturing"}
                      </span>
                      <DevEditedChip mark={(editing as any)?.devEdited} />
                      {editing && <ResponsibleChip p={editing} teams={teams} me={me} />}
                      {editing && dupIds.has(editing.id) && (
                        <span className="flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 text-[9.5px] font-bold text-rose-600" data-testid="detail-dup-code">
                          <AlertTriangle size={10} /> Code {editing.code} is also used by {dupCodes.find((d) => d.holders.some((h) => h.id === editing.id))?.holders.filter((h) => h.id !== editing.id).map((h) => h.name).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={closeDetail} aria-label="Close" className="rounded-lg border border-biome-line p-1.5 text-biome-muted hover:bg-biome-hover hover:text-biome-text">
                    <X size={15} />
                  </button>
                </div>

                {/* Completeness + freeze stepper */}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-biome-line bg-biome-bg px-3.5 py-3" data-testid="completeness">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Completeness</p>
                      <p className="font-mono text-[13px] font-semibold text-biome-text">{comp.pct}%</p>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-biome-line/60">
                      <div className={`h-full rounded-full transition-all ${tone(comp.pct)}`} style={{ width: `${comp.pct}%` }} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-biome-muted">
                      {comp.missing.length ? `Still missing: ${comp.missing.join(", ")}` : "Everything is filled in and on file."}
                    </p>
                  </div>
                  <Stepper partner={editing} />
                </div>

                {/* Section nav */}
                <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-0.5" aria-label="Sections">
                  {sections.map((x) => (
                    <button key={x.id} onClick={() => goTo(x.id)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold ${activeSection === x.id ? "bg-biome-leaf/15 text-biome-text" : "text-biome-muted hover:bg-biome-hover hover:text-biome-text"}`}>
                      {x.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="space-y-0 p-4 sm:p-5">
                {notice && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[.07] px-4 py-2.5 text-[11.5px] font-semibold text-emerald-600" data-testid="register-notice">{notice}</p>}
                {error && <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/[.07] px-4 py-2.5 text-[11.5px] text-biome-text" data-testid="register-error">{error}</p>}
                {editing && editing.lockState === "submitted" && (
                  <div className="mb-4 rounded-xl border border-slate-400/40 bg-slate-400/[.08] px-4 py-3">
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

                {/* ---- Responsible person ---- */}
                {editing && (
                  <div id="reg-sec-responsible" className="mb-4 scroll-mt-4">
                    <ResponsibilitySection p={editing} teams={teams} me={me} canManage={canManage}
                      onChange={() => setAssign({ ids: [editing.id], label: editing.name, initial: editing })} />
                  </div>
                )}

                {/* ---- Basic ---- */}
                <div id="reg-sec-basic" className="scroll-mt-4">
                  <FormSection title="Basic" sectionIcon={<Building2 size={14} />} columns={3}>
                    <F label="They are a">
                      <select value={form.kind} onChange={(e) => {
                        const kind = e.target.value;
                        setForm({ ...form, kind, supplies: kind === "transporter" ? ["transport"] : kind === "client" ? [] : form.supplies });
                      }} className={inputCls} disabled={Boolean(editing) || isClientsPage}>
                        {kinds.map((k: any) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                    </F>
                    <F label="Business side">
                      <select
                        value={isCoordinator ? "trading" : isPlantManager ? "raw_material" : form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className={inputCls}
                        disabled={isCoordinator || isPlantManager || (Boolean(editing) && !data?.canUnlock) || editingLocked}
                      >
                        {(data?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <p className="mt-1 text-[9.5px] text-biome-muted">
                        {isCoordinator
                          ? "Trading is your register. Manufacturing belongs to the plant manager."
                          : isPlantManager
                            ? "Manufacturing only — trading is the coordinator's register."
                            : "Trading → coordinator. Manufacturing → plant manager of the site."}
                      </p>
                    </F>
                    <F label={isClientsPage ? "Client name" : "Trading name"}>
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} disabled={editingLocked} data-testid="field-name"
                        placeholder={isClientsPage ? "NTPC Limited – Tanda" : ""} />
                    </F>
                    <F label={`${codeLabel(form.kind)} (recommended)`}>
                      <div className="flex gap-1.5">
                        <input value={form.code} data-testid="partner-code"
                          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 12) })}
                          disabled={editingLocked}
                          placeholder={form.kind === "transporter" ? "e.g. REW-T001" : form.kind === "client" ? "e.g. REW-C001" : "e.g. REW-V001"}
                          className={`${inputCls} font-mono ${codeTaken ? "border-rose-500/60" : ""}`} />
                        {!editingLocked && (
                          <button type="button" onClick={suggestCode} data-testid="partner-code-suggest" title="Fill the next free code for this plant"
                            className="shrink-0 rounded-xl border border-biome-line px-2.5 text-[10.5px] font-semibold text-biome-muted hover:bg-biome-hover">
                            Suggest
                          </button>
                        )}
                      </div>
                      <p className={`mt-1 text-[9.5px] ${codeTaken ? "font-semibold text-rose-500" : form.code ? "text-biome-muted" : "text-amber-600"}`}>
                        {codeTaken
                          ? `Already used by ${codeTaken.name} — choose a different code.`
                          : form.code
                            ? "Typing this code in the biomass / transport sheet fills the name automatically."
                            : "Not filled — the plant sheets can only fill the name from a code if one is set here."}
                      </p>
                    </F>
                    <div className="md:col-span-2">
                      <F label="Legal name, as on the GST certificate">
                        <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} className={inputCls} disabled={editingLocked} />
                      </F>
                    </div>
                    {isClientsPage && (
                      <>
                        <F label="Short name (sheets & folders)">
                          <input value={form.shortName || ""} onChange={(e) => setForm({ ...form, shortName: e.target.value })} className={inputCls} placeholder="NTPC Tanda" disabled={editingLocked} data-testid="field-shortName" />
                        </F>
                        <div className="md:col-span-2">
                          <F label="Also matches on paperwork (comma separated)">
                            <input value={form.aliasesText || ""} onChange={(e) => setForm({ ...form, aliasesText: e.target.value })} className={inputCls} placeholder="tanda, ntpc tanda" disabled={editingLocked} data-testid="field-aliases" />
                          </F>
                          <p className="mt-1 text-[9.5px] text-biome-muted">The WhatsApp agent recognises this client on documents by its name, short name and these spellings.</p>
                        </div>
                      </>
                    )}
                    <F label="Material / service">
                      <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} disabled={editingLocked}
                        placeholder={form.kind === "transporter" ? "Trailer, tipper…" : form.kind === "client" ? "What they buy (pellets, briquettes)" : "Mustard husk, pellet, bearings…"} className={inputCls} />
                    </F>
                    <F label="Serves which plants">
                      <select multiple value={form.plants} disabled={myRole === "plant_manager" || editingLocked}
                        onChange={(e) => setForm({ ...form, plants: Array.from(e.target.selectedOptions).map((o) => o.value) })}
                        className={`${inputCls} h-[76px]`}>
                        {(data?.plants || []).map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}
                      </select>
                      <p className="mt-1 text-[9.5px] text-biome-muted">Pick none for a company that serves everywhere.</p>
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
                                className={`rounded-full border px-3 py-1 text-[10.5px] font-semibold ${on ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-text" : "border-biome-line text-biome-muted"}`}>
                                {on ? "✓ " : ""}{c.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[9.5px] text-biome-muted">Decides where this vendor can be picked — e.g. only &ldquo;Machine spare parts&rdquo; vendors appear in Plant Stock receipts.</p>
                      </div>
                    )}
                  </FormSection>
                </div>

                {/* ---- Tax & Bank ---- */}
                <div id="reg-sec-tax" className="scroll-mt-4">
                  <FormSection title="Tax & Bank" sectionIcon={<Landmark size={14} />} columns={3}
                    hint={`GSTIN, PAN and IFSC are checked for SHAPE only — a typo is caught, the registration itself is not verified.${isClientsPage ? " Bank details are optional for a client (we never pay them)." : " A payment released to an account nobody checked against a cancelled cheque is the most expensive mistake this register can prevent."}`}>
                    <F label="GSTIN">
                      <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} className={inputCls} placeholder="06AABCU9603R1ZM" disabled={editingLocked} />
                      <Shape value={form.gstin} ok={GSTIN_RE.test(form.gstin || "")} what="GSTIN" />
                    </F>
                    <F label="PAN">
                      <input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} className={inputCls} placeholder="AABCU9603R" disabled={editingLocked} />
                      <Shape value={form.pan} ok={PAN_RE.test(form.pan || "")} what="PAN" />
                    </F>
                    <F label="Bank"><input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="Account number"><input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="IFSC">
                      <input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} className={inputCls} disabled={editingLocked} />
                      <Shape value={form.ifsc} ok={IFSC_RE.test(form.ifsc || "")} what="IFSC" />
                    </F>
                  </FormSection>
                </div>

                {/* ---- Contacts ---- */}
                <div id="reg-sec-contacts" className="scroll-mt-4">
                  <FormSection title="Contacts & address" sectionIcon={<Phone size={14} />} columns={3}>
                    <F label="Contact person"><input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <div className="md:col-span-2">
                      <F label="Address"><input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    </div>
                    <F label="City"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="State"><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="PIN"><input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                  </FormSection>
                </div>

                {/* ---- Documents ---- */}
                <div id="reg-sec-documents" className="scroll-mt-4">
                  {editing
                    ? <DocumentsSection partner={editing} types={docTypes} onChanged={load} locked={editingLocked} />
                    : <NewDocsSection types={docTypes} queued={queued} setQueued={setQueued} />}
                </div>

                {/* ---- Requirements (clients) ---- */}
                {isClientsPage && (
                  <div id="reg-sec-requirements" className="scroll-mt-4">
                    <FormSection title="Document requirements" sectionIcon={<FileCheck2 size={14} />} columns={1} tone={reqForView.requires.length ? "default" : "warning"}
                      hint="The papers this client wants with every supply. The WhatsApp agent marks a supply set complete only when all of them are filed.">
                      <div className="flex flex-wrap items-center gap-2">
                        {canEditReq ? (
                          <button type="button" onClick={() => setReqModal({ readOnly: false })} data-testid="edit-requirements"
                            className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11.5px] font-bold text-white">
                            <FileCheck2 size={13} /> Edit requirement documents
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={() => setReqModal({ readOnly: true })} data-testid="view-requirements"
                              className="flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11.5px] font-semibold text-biome-text hover:bg-biome-hover">
                              <Eye size={13} /> View requirement documents
                            </button>
                            <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-600" data-testid="requirements-view-only">
                              View only — accounts, admin or developer can edit
                            </span>
                          </>
                        )}
                        {editing?.requirementsUpdatedAt && (
                          <span className="text-[10px] text-biome-muted">Last changed {editing.requirementsUpdatedAt.slice(0, 10)}{editing.requirementsUpdatedBy ? ` by ${editing.requirementsUpdatedBy}` : ""}</span>
                        )}
                      </div>
                      {reqForView.requires.length ? (
                        <div className="flex flex-wrap gap-1.5" data-testid="requirements-chips">
                          {reqForView.requires.map((r) => (
                            <span key={r} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${
                              reqForView.dscOn.includes(r) ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-biome-line bg-biome-bgSoft text-biome-text"}`}>
                              {reqForView.dscOn.includes(r) && <ShieldCheck size={10} />}
                              {(data?.requirementTypes || []).find((t: any) => t.id === r)?.label || r}
                              {reqForView.dscOn.includes(r) && <span className="text-[9px] font-bold">DSC</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-3 py-2 text-[11px] text-amber-600">
                          Not set yet — no supply to this client can be marked complete until the required documents are ticked.
                        </p>
                      )}
                      {reqForView.requirementNotes && (
                        <p className="flex items-start gap-2 rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2 text-[11px] leading-relaxed text-biome-text">
                          <ShieldCheck size={12} className="mt-0.5 shrink-0 text-amber-500" /> {reqForView.requirementNotes}
                        </p>
                      )}

                      {/* Client purchase orders (added from coordination) */}
                      <div className="rounded-xl border border-biome-line bg-biome-bgSoft p-3">
                        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">
                          <Package size={12} /> Purchase orders
                          <Link href="/coordination" className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-sky-600 hover:underline">
                            Add / edit in Coordination <ArrowRight size={10} />
                          </Link>
                        </p>
                        {(editing?.poNumbers || []).length ? (
                          <ul className="mt-2 space-y-1">
                            {(editing?.poNumbers || []).map((po) => (
                              <li key={po.id} className="flex flex-wrap items-center gap-2 text-[11px] text-biome-text">
                                <span className="font-mono font-semibold">{po.number}</span>
                                {po.date && <span className="text-biome-muted">dated {po.date}</span>}
                                {po.validTill && <span className="text-biome-muted">· valid till {po.validTill}</span>}
                                {po.quantityMt > 0 && <span className="text-biome-muted">· {po.quantityMt} MT</span>}
                                {po.location && <span className="text-biome-muted">· {po.location}</span>}
                                {!po.active && <span className="rounded-full border border-biome-line px-1.5 text-[9px] text-biome-muted">closed</span>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-[10.5px] text-biome-muted">No PO on this client yet.</p>
                        )}
                      </div>
                    </FormSection>
                  </div>
                )}

                {/* ---- Terms ---- */}
                <div id="reg-sec-terms" className="scroll-mt-4">
                  <FormSection title="Terms & notes" sectionIcon={<ClipboardList size={14} />} columns={2}
                    hint="Written as words rather than a number, because terms vary too much to force into one field — rate per MT, freight per trip, a slab, a season.">
                    <F label="Agreement runs from"><input type="date" value={form.agreementFrom} onChange={(e) => setForm({ ...form, agreementFrom: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <F label="Until"><input type="date" value={form.agreementTo} onChange={(e) => setForm({ ...form, agreementTo: e.target.value })} className={inputCls} disabled={editingLocked} /></F>
                    <div className="md:col-span-2">
                      <F label="Rate and terms">
                        <textarea rows={2} value={form.rateTerms} onChange={(e) => setForm({ ...form, rateTerms: e.target.value })} disabled={editingLocked}
                          placeholder="₹5,450 per MT delivered at Jhajjar, moisture up to 12%" className={`${inputCls} resize-y`} />
                      </F>
                    </div>
                    <div className="md:col-span-2">
                      <F label="Payment terms">
                        <input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} disabled={editingLocked}
                          placeholder="30 days from receipt of material and complete papers" className={inputCls} />
                      </F>
                    </div>
                    <div className="md:col-span-2">
                      <F label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} resize-y`} disabled={editingLocked} /></F>
                    </div>
                  </FormSection>
                </div>

                {/* ---- Status & freeze ---- */}
                {editing && (
                  <div id="reg-sec-status" className="scroll-mt-4">
                    <SubmitSection partner={editing} canUnlock={Boolean(data?.canUnlock)} busy={busy} onAction={lockAction} />
                    <StatusSection key={editing.id + editing.status} partner={editing} statuses={data?.statuses || []} canActivate={data?.canActivate} busy={busy} onSet={setStatus} />
                    {isClientsPage && canEditReq && (
                      <div className="mt-2 flex justify-end">
                        <button onClick={removeClient} disabled={busy} data-testid="remove-client"
                          title="Only for a client registered by mistake — one with KYC papers or a submitted registration is kept; set it Blocked instead."
                          className="flex items-center gap-1.5 rounded-xl border border-rose-500/35 px-3 py-2 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">
                          <Trash2 size={12} /> Remove client
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sticky action bar */}
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-biome-line bg-biome-bgSoft/95 px-4 py-3 backdrop-blur">
                {editing && <RegistrationEmailButton partner={editing} />}
                {editing && (editing.gaps.missing.length > 0 || editing.gaps.expired.length > 0 || editing.gaps.expiringSoon.length > 0) && (
                  <a href={`/followups?partnerId=${editing.id}`}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 px-3.5 py-2 text-[11.5px] font-semibold text-amber-600">
                    <Mail size={13} /> Ask for missing papers
                  </a>
                )}
                {!editing && isClientsPage && canEditReq && (
                  <button type="button" onClick={() => setReqModal({ readOnly: false })} className="mr-auto flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11.5px] font-semibold text-biome-text">
                    <FileCheck2 size={13} /> Requirements ({req.requires.length})
                  </button>
                )}
                <span className="ml-auto" />
                <button onClick={closeDetail} className="rounded-xl border border-biome-line px-4 py-2 text-[11.5px] font-semibold text-biome-muted hover:bg-biome-hover">Close</button>
                <button onClick={save} disabled={busy || editingLocked} data-testid="register-save"
                  title={editingLocked ? "Submitted & frozen — ask accounts, admin or the developer to unlock it." : undefined}
                  className="flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2 text-[11.5px] font-bold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editing ? "Save changes" : "Register"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {assign && (
        <AssignModal count={assign.ids.length} label={assign.label} initial={assign.initial} people={people} teams={teams}
          onClose={() => setAssign(null)} onDone={(body) => saveAssignment(assign.ids, body)} />
      )}
      {importOpen && (
        <ImportModal what={isClientsPage ? "clients" : "vendors"} onClose={() => setImportOpen(false)} onImported={() => load()} />
      )}

      {reqModal && (
        <RequirementsModal
          clientName={editing?.name || form.name}
          value={editing ? requirementsOf(editing) : req}
          readOnly={reqModal.readOnly || !canEditReq}
          onClose={() => setReqModal(null)}
          onSave={saveRequirements}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Registered → Submitted & frozen → Active: where this record stands. */
function Stepper({ partner }: { partner: Partner | null }) {
  const steps = [
    { id: "reg", label: "Registered", done: Boolean(partner) },
    { id: "sub", label: "Submitted & frozen", done: partner?.lockState === "submitted" },
    { id: "act", label: "Approved · Active", done: partner?.status === "active" },
  ];
  const blocked = partner?.status === "blocked" || partner?.status === "on_hold";
  return (
    <div className="rounded-xl border border-biome-line bg-biome-bg px-3.5 py-3" data-testid="freeze-stepper">
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Freeze &amp; approval</p>
      <ol className="mt-2 flex items-center gap-1">
        {steps.map((st, i) => (
          <li key={st.id} className="flex min-w-0 flex-1 items-center gap-1">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${st.done ? "bg-emerald-500 text-white" : "border border-biome-line text-biome-muted"}`}>
              {st.done ? <Check size={11} /> : <CircleDot size={10} />}
            </span>
            <span className={`truncate text-[10px] font-semibold ${st.done ? "text-biome-text" : "text-biome-muted"}`}>{st.label}</span>
            {i < steps.length - 1 && <span className={`mx-0.5 h-px min-w-[8px] flex-1 ${st.done ? "bg-emerald-500/60" : "bg-biome-line"}`} />}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[10px] leading-snug text-biome-muted">
        {!partner ? "Not registered yet — fill the form and press Register."
          : blocked ? `${partner.status === "blocked" ? "Blocked" : "On hold"}${partner.statusReason ? ` — ${partner.statusReason}` : ""}.`
          : partner.status === "active" ? "Cleared to deal with."
          : partner.lockState === "submitted" ? "Waiting for accounts / admin to mark it Active."
          : "Check everything, then Submit & freeze below."}
      </p>
    </div>
  );
}

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
  const have = new Set(partner.documents.map((d) => d.type));
  const missingReq = types.filter((t) => t.required && !have.has(t.id));

  return (
    <FormSection title="Documents (KYC)" sectionIcon={<FileText size={14} />} columns={1}
      hint={partner.kind === "client" ? "GST certificate, PAN and the client's PO / agreement papers." : "The signed agreement, GST certificate, PAN and a cancelled cheque are what a company must have before it can be marked Active."}>
      {err && <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>}

      {/* Checklist of every type: on file / missing */}
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const on = have.has(t.id);
          return (
            <span key={t.id} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : t.required ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : "border-biome-line text-biome-muted"}`}>
              {on ? <BadgeCheck size={10} /> : t.required ? <ShieldAlert size={10} /> : null}{t.label}{t.required ? " *" : ""}
            </span>
          );
        })}
      </div>

      {partner.documents.length > 0 && (
        <div className="space-y-1.5">
          {partner.documents.map((d) => {
            const expired = d.validTill && d.validTill < new Date().toISOString().slice(0, 10);
            return (
              <div key={d.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${expired ? "border-rose-500/35 bg-rose-500/[.06]" : "border-biome-line bg-biome-bgSoft"}`}>
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
                  className="rounded-lg border border-biome-line px-2 py-1 text-rose-500 disabled:opacity-60">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {missingReq.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-3 py-2">
          <ShieldAlert size={12} className="text-rose-500" />
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-rose-500">Required, not on file:</span>
          {missingReq.map((t) => (
            <span key={t.id} className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600">{t.label}</span>
          ))}
        </div>
      )}

      {locked ? (
        <p className="rounded-xl border border-slate-400/40 bg-slate-400/[.08] px-3 py-2.5 text-[11px] leading-relaxed text-biome-muted">
          Submitted &amp; frozen — documents can no longer be attached or removed. Ask accounts, the admin or the developer to unlock it.
        </p>
      ) : (
        <div className="grid gap-2 rounded-xl border border-biome-line bg-biome-bgSoft p-3 sm:grid-cols-2 lg:grid-cols-4">
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
            className="flex items-center justify-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Attach
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
    <FormSection title="Status (approval)" sectionIcon={<Check size={14} />} columns={1}>
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
              <button key={s.id} title={s.help} disabled={busy || s.id === partner.status} onClick={() => onSet(s.id, reason)}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-semibold disabled:opacity-50 ${
                  s.id === partner.status ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-text" : "border-biome-line text-biome-muted hover:bg-biome-hover"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.id] || "bg-slate-400"}`} />{s.label}
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
    <FormSection title="Documents (KYC)" sectionIcon={<FileText size={14} />} columns={1}
      hint="Attach them here — they upload the moment you press Register. Required papers are marked *. After registering, check everything and press Submit & freeze.">
      {err && <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-3 py-2 text-[11px] text-biome-text">{err}</p>}
      {queued.length > 0 && (
        <div className="space-y-1.5">
          {queued.map((q, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2">
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
      <div className="grid gap-2 rounded-xl border border-biome-line bg-biome-bgSoft p-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/[.07] px-3 py-2 text-[11px] text-amber-600">Before submitting: {blockers.join(", ")}.</p>
          )}
          <label className="flex items-center gap-2 text-[11.5px] text-biome-text">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            I have checked every detail and every document.
          </label>
          <button onClick={() => onAction("submit", { confirmChecked: checked })} disabled={busy || !checked || blockers.length > 0}
            className="flex w-fit items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Submit &amp; freeze
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
            className="flex items-center gap-2 rounded-xl border border-amber-500/40 px-4 py-2.5 text-[11.5px] font-semibold text-amber-600 disabled:opacity-50">
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

function Tile({ label, value, hint, tone, accent, icon, onClick }: any) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-2xl border p-3 text-left transition-colors hover:border-biome-leaf/40 ${accent ? "border-rose-500/30 bg-rose-500/[.06]" : "border-biome-line bg-biome-bgSoft"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</p>
          <p className="mt-0.5 font-mono text-[18px] font-semibold tracking-tight text-biome-text">{value}</p>
          {hint && <p className="truncate text-[9.5px] text-biome-muted">{hint}</p>}
        </div>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      </div>
    </button>
  );
}

const inputCls = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none disabled:opacity-70";
const selectCls = "rounded-lg border border-biome-line bg-biome-bg px-2 py-1 text-[10.5px] text-biome-text outline-none";

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
 * meant to give. The address is asked for in a small inline box, NOT
 * window.prompt() (Electron does not support prompt()).
 */
function RegistrationEmailButton({ partner }: { partner: Partner }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function start() { setTo(partner.email || ""); setNote(null); setOpen(true); }

  async function send() {
    const addr = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setNote({ ok: false, text: "Type a valid email address first." }); return; }
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/partners/registration-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: partner.id, to: addr }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote({ ok: false, text: json.error || `Not sent (${res.status}).` }); return; }
      setNote({ ok: true, text: `Registration email sent to ${json.to}.` });
      setOpen(false);
    } catch (e) {
      setNote({ ok: false, text: `Not sent — the Biome server could not be reached (${(e as Error).message}).` });
    } finally { setBusy(false); }
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {!open ? (
        <button onClick={start} disabled={busy} data-testid="reg-email-open"
          className="flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11.5px] font-semibold text-biome-muted hover:bg-biome-hover disabled:opacity-60">
          <Mail size={13} /> Send registration email
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} data-testid="reg-email-to"
            onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") setOpen(false); }}
            placeholder="vendor@example.com"
            className="w-[200px] rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none" />
          <button onClick={send} disabled={busy} data-testid="reg-email-send"
            className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11.5px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} {busy ? "Sending…" : "Send"}
          </button>
          <button onClick={() => { setOpen(false); setNote(null); }} disabled={busy}
            className="rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Cancel</button>
        </span>
      )}
      {note && (
        <span data-testid="reg-email-note" data-ok={note.ok ? "1" : "0"}
          className={`flex max-w-[460px] items-start gap-1.5 rounded-xl border px-3 py-1.5 text-[10.5px] leading-snug ${
            note.ok ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-600" : "border-rose-400/30 bg-rose-400/[.07] text-biome-text"}`}>
          {note.ok ? <Check size={12} className="mt-px shrink-0" /> : <AlertCircle size={12} className="mt-px shrink-0 text-rose-500" />}
          <span>{note.text}{!note.ok && /Settings → Email/.test(note.text) && " If you can't open Settings, ask the admin."}</span>
        </span>
      )}
    </span>
  );
}
