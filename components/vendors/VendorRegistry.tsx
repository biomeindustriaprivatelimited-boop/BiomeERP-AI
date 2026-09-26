"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Portal from "@/components/Portal";
import type { ChangeEvent, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Upload,
  Search,
  Pencil,
  Trash2,
  ShieldCheck,
  FileUp,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  ExternalLink,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";
import {
  type Vendor,
  type VendorKycFile,
  isValidVendorCode,
  isValidGstin,
  isValidPan,
  normaliseVendorCode,
} from "@/lib/whatsapp";

interface ImportRow {
  row: number;
  code: string;
  name: string;
  action: "create" | "update" | "skip";
  errors: string[];
}
interface ImportSummary {
  sheetName: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  mappedColumns: string[];
  unmappedColumns: string[];
}

const BLANK: Vendor = {
  code: "",
  name: "",
  legalName: "",
  gstin: "",
  pan: "",
  supplyType: "",
  material: "",
  contactPerson: "",
  phone: "",
  email: "",
  addressLine: "",
  city: "",
  state: "",
  stateCode: "",
  pincode: "",
  bankName: "",
  bankAccountNo: "",
  bankIfsc: "",
  paymentTerms: "",
  notes: "",
  active: true,
  kyc: [],
};

export default function VendorRegistry() {
  const { notify } = useNotifications();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  /** Codes shared by more than one vendor — shown apart, highlighted. */
  const [duplicateGroups, setDuplicateGroups] = useState<{ code: string; vendors: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [originalCode, setOriginalCode] = useState<string | null>(null);
  const [kycFor, setKycFor] = useState<Vendor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors/registry", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the vendor registry.");
      setVendors(json.vendors || []);
      setDuplicateGroups(Array.isArray((json as any)?.duplicateGroups) ? (json as any).duplicateGroups : []);
    } catch (err) {
      notify({ kind: "warning", title: "Vendor registry", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) =>
      [v.code, v.name, v.legalName, v.gstin, v.city, v.state, v.material, v.contactPerson, v.phone]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [vendors, query]);

  async function remove(code: string) {
    try {
      const res = await fetch(`/api/vendors/registry?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not remove that vendor.");
      notify({ kind: "info", title: `Vendor ${code} removed`, detail: "Its KYC files were kept on disk." });
      setConfirmDelete(null);
      load();
    } catch (err) {
      notify({ kind: "warning", title: "Could not remove vendor", detail: (err as Error).message });
    }
  }

  const sharedCodes = new Set(duplicateGroups.map((g) => g.code));
  return (
    <div className="space-y-4">
      {/* ---- Shared codes — a category of its own, highlighted ---- */}
      {duplicateGroups.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[.07] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-600">Shared vendor codes · needs attention</p>
          <p className="mt-1 text-[11px] text-biome-text">These vendors carry the same code, exactly as issued. A reference like BDC/841/{duplicateGroups[0].code}/37 cannot say which one on its own — the agent picks the vendor named on the document and flags the set for review when none is. New vendors with a duplicate code are refused.</p>
          <div className="mt-2 space-y-1">
            {duplicateGroups.map((g) => (
              <div key={g.code} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-biome-bg px-3 py-2">
                <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-600">{g.code}</span>
                <span className="text-[11px] text-biome-text">{g.vendors.join("  ·  ")}</span>
                <span className="ml-auto text-[10px] text-biome-muted">{g.vendors.length} vendors share this code</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ---- Toolbar ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code, name, GSTIN, city…"
            className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <PremiumButton variant="ghost" onClick={() => setImportOpen(true)}>
            <Upload size={13} /> Upload vendor list
          </PremiumButton>
          <PremiumButton
            onClick={() => {
              setOriginalCode(null);
              setEditing({ ...BLANK });
            }}
          >
            <Plus size={13} /> Add vendor
          </PremiumButton>
        </div>
      </div>

      {/* ---- Table ---- */}
      {loading ? (
        <GlassCard className="flex items-center justify-center gap-2 py-14 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Loading vendors…
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="px-6 py-14 text-center">
          <p className="font-display text-sm font-medium text-biome-text">
            {query ? "No vendor matches that search" : "No vendors registered yet"}
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-biome-muted">
            {query
              ? "Try the vendor code on its own, or part of the firm name."
              : "Register the vendor codes that appear in your coordination references — the “MHI” in BDC/786/MHI/44. Once a code is here, documents from that vendor get matched to the right supply automatically. Add them one at a time, or upload your existing list."}
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11.5px]">
              <thead>
                <tr className="border-b border-biome-line text-[10px] uppercase tracking-wider text-biome-muted/60">
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">GSTIN</th>
                  <th className="px-4 py-2.5 font-medium">Supply</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">KYC</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, vi) => (
                  <tr
                    key={`${v.code}-${vi}`}
                    className={`border-b border-biome-line/50 transition-colors last:border-0 hover:bg-biome-hover ${sharedCodes.has(v.code.toUpperCase()) ? "bg-amber-500/[.06]" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${sharedCodes.has(v.code.toUpperCase()) ? "border-amber-500/50 bg-amber-500/15 text-amber-600" : "border-biome-leaf/25 bg-biome-leaf/10 text-biome-leafBright"}`}
                        title={sharedCodes.has(v.code.toUpperCase()) ? "This code is shared by more than one vendor" : undefined}>
                        {v.code}{sharedCodes.has(v.code.toUpperCase()) ? " ⚠" : ""}
                      </span>
                    </td>
                    <td className="max-w-[240px] px-4 py-2.5">
                      <p className="truncate text-biome-text" title={v.name}>
                        {v.name}
                      </p>
                      {v.contactPerson || v.phone ? (
                        <p className="truncate text-[10.5px] text-biome-muted">
                          {[v.contactPerson, v.phone].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10.5px] text-biome-muted">
                      {v.gstin || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-biome-muted">
                      {v.supplyType ? (
                        <span className="rounded-full border border-biome-line bg-biome-hover px-2 py-0.5 text-[10px] capitalize">
                          {v.supplyType}
                        </span>
                      ) : (
                        "—"
                      )}
                      {v.material ? (
                        <p className="mt-0.5 truncate text-[10.5px] text-biome-muted/70">{v.material}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-biome-muted">
                      {[v.city, v.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setKycFor(v)}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                          v.kyc?.length
                            ? "border-biome-leaf/25 bg-biome-leaf/10 text-biome-leafBright"
                            : "border-biome-line bg-biome-hover text-biome-muted hover:text-biome-text"
                        }`}
                      >
                        <ShieldCheck size={10} />
                        {v.kyc?.length ? `${v.kyc.length} file${v.kyc.length > 1 ? "s" : ""}` : "Add"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setOriginalCode(v.code);
                            setEditing({ ...BLANK, ...v });
                          }}
                          title="Edit vendor"
                          className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => (confirmDelete === v.code ? remove(v.code) : setConfirmDelete(v.code))}
                          title={confirmDelete === v.code ? "Click again to remove" : "Remove vendor"}
                          className={`rounded-lg p-1.5 transition-colors hover:bg-biome-hover ${
                            confirmDelete === v.code
                              ? "text-red-300"
                              : "text-biome-muted hover:text-red-300"
                          }`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <AnimatePresence>
        {editing && (
          <VendorForm
            vendor={editing}
            originalCode={originalCode}
            existingCodes={vendors.map((v) => normaliseVendorCode(v.code))}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
        {kycFor && (
          <KycDrawer
            vendor={kycFor}
            onClose={() => setKycFor(null)}
            onChanged={(kyc) => {
              setKycFor({ ...kycFor, kyc });
              load();
            }}
          />
        )}
        {importOpen && (
          <ImportDrawer
            onClose={() => setImportOpen(false)}
            onImported={() => {
              setImportOpen(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ==================== Add / edit vendor ==================== */

function VendorForm({
  vendor,
  originalCode,
  existingCodes,
  onClose,
  onSaved,
}: {
  vendor: Vendor;
  originalCode: string | null;
  existingCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useNotifications();
  const [form, setForm] = useState<Vendor>(vendor);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Vendor) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }) as Vendor);

  // Live validation so problems surface while typing, not on save.
  const codeNorm = normaliseVendorCode(form.code);
  const codeTaken =
    codeNorm && codeNorm !== originalCode && existingCodes.includes(codeNorm);
  const problems: string[] = [];
  if (form.code && !isValidVendorCode(form.code))
    problems.push("Vendor code must be 2–8 letters or digits, starting with a letter.");
  if (codeTaken) problems.push(`Vendor code ${codeNorm} is already registered.`);
  if (form.gstin && !isValidGstin(form.gstin)) problems.push("That GSTIN isn't 15 valid characters.");
  if (form.pan && !isValidPan(form.pan)) problems.push("That PAN isn't 10 valid characters.");

  const canSave = Boolean(form.code && form.name) && problems.length === 0 && !saving;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/vendors/registry", {
        method: originalCode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(originalCode ? { ...form, originalCode } : form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save the vendor.");
      notify({
        kind: "success",
        title: originalCode ? `Vendor ${json.vendor.code} updated` : `Vendor ${json.vendor.code} registered`,
        detail: "Documents from this vendor will now be matched automatically.",
      });
      onSaved();
    } catch (err) {
      notify({ kind: "warning", title: "Could not save vendor", detail: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={originalCode ? `Edit vendor ${originalCode}` : "Register a vendor"}
      subtitle="The code is what ties this vendor's paperwork to a supply. Everything else is optional and can be filled in later."
      onClose={onClose}
      footer={
        <>
          <PremiumButton variant="ghost" onClick={onClose}>
            Cancel
          </PremiumButton>
          <PremiumButton onClick={save} disabled={!canSave}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {originalCode ? "Save changes" : "Register vendor"}
          </PremiumButton>
        </>
      }
    >
      {problems.length > 0 && (
        <div className="mb-4 space-y-1 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2.5">
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-2 text-[11px] text-red-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {p}
            </p>
          ))}
        </div>
      )}

      <Section title="Identity">
        <Field label="Vendor code" required hint="As printed in the reference, e.g. MHI">
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="MHI"
            className={inputClass}
            maxLength={8}
          />
        </Field>
        <Field label="Vendor name" required>
          <input value={form.name} onChange={set("name")} placeholder="Innovative Biomass Solution" className={inputClass} />
        </Field>
        <Field label="Registered legal name">
          <input value={form.legalName ?? ""} onChange={set("legalName")} className={inputClass} />
        </Field>
        <Field label="Supply type">
          <select value={form.supplyType ?? ""} onChange={set("supplyType")} className={inputClass}>
            <option value="">Not set</option>
            <option value="trading">Trading</option>
            <option value="manufacturing">Manufacturing</option>
            <option value="both">Both</option>
          </select>
        </Field>
        <Field label="Material supplied">
          <input value={form.material ?? ""} onChange={set("material")} placeholder="Biomass pellets" className={inputClass} />
        </Field>
      </Section>

      <Section title="Tax">
        <Field label="GSTIN">
          <input
            value={form.gstin ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
            placeholder="06AALFI7569R1ZA"
            className={`${inputClass} font-mono`}
            maxLength={15}
          />
        </Field>
        <Field label="PAN">
          <input
            value={form.pan ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))}
            placeholder="AALFI7569R"
            className={`${inputClass} font-mono`}
            maxLength={10}
          />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="Contact person">
          <input value={form.contactPerson ?? ""} onChange={set("contactPerson")} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input value={form.phone ?? ""} onChange={set("phone")} placeholder="+91 99994 72489" className={inputClass} />
        </Field>
        <Field label="Email">
          <input value={form.email ?? ""} onChange={set("email")} type="email" className={inputClass} />
        </Field>
      </Section>

      <Section title="Address">
        <Field label="Address" span>
          <input value={form.addressLine ?? ""} onChange={set("addressLine")} className={inputClass} />
        </Field>
        <Field label="City">
          <input value={form.city ?? ""} onChange={set("city")} className={inputClass} />
        </Field>
        <Field label="State">
          <input value={form.state ?? ""} onChange={set("state")} placeholder="Haryana" className={inputClass} />
        </Field>
        <Field label="State code">
          <input value={form.stateCode ?? ""} onChange={set("stateCode")} placeholder="06" className={inputClass} maxLength={2} />
        </Field>
        <Field label="PIN code">
          <input value={form.pincode ?? ""} onChange={set("pincode")} placeholder="132145" className={inputClass} maxLength={6} />
        </Field>
      </Section>

      <Section title="Banking and terms">
        <Field label="Bank name">
          <input value={form.bankName ?? ""} onChange={set("bankName")} className={inputClass} />
        </Field>
        <Field label="Account number">
          <input value={form.bankAccountNo ?? ""} onChange={set("bankAccountNo")} className={`${inputClass} font-mono`} />
        </Field>
        <Field label="IFSC">
          <input
            value={form.bankIfsc ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, bankIfsc: e.target.value.toUpperCase() }))}
            className={`${inputClass} font-mono`}
            maxLength={11}
          />
        </Field>
        <Field label="Payment terms">
          <input value={form.paymentTerms ?? ""} onChange={set("paymentTerms")} placeholder="Net 30 days from invoice" className={inputClass} />
        </Field>
        <Field label="Notes" span>
          <textarea value={form.notes ?? ""} onChange={set("notes")} rows={2} className={`${inputClass} resize-none`} />
        </Field>
      </Section>
    </Drawer>
  );
}

/* ==================== KYC ==================== */

function KycDrawer({
  vendor,
  onClose,
  onChanged,
}: {
  vendor: Vendor;
  onClose: () => void;
  onChanged: (kyc: VendorKycFile[]) => void;
}) {
  const { notify } = useNotifications();
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const kyc = vendor.kyc ?? [];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("code", vendor.code);
      if (label.trim()) form.append("label", label.trim());
      Array.from(files).forEach((f) => form.append("file", f));

      const res = await fetch("/api/vendors/kyc", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok && !json.added?.length) throw new Error(json.error || "Upload failed.");

      if (json.rejected?.length) {
        notify({
          kind: "warning",
          title: `${json.rejected.length} file(s) not accepted`,
          detail: json.rejected.map((r: any) => `${r.name}: ${r.reason}`).join(" "),
        });
      }
      if (json.added?.length) {
        notify({
          kind: "success",
          title: `${json.added.length} KYC file(s) stored`,
          detail: `Saved under vendor ${vendor.code}.`,
        });
      }
      onChanged(json.kyc || []);
      setLabel("");
    } catch (err) {
      notify({ kind: "warning", title: "Upload failed", detail: (err as Error).message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(name: string) {
    try {
      const res = await fetch(
        `/api/vendors/kyc?code=${encodeURIComponent(vendor.code)}&file=${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not delete that file.");
      onChanged(json.kyc || []);
    } catch (err) {
      notify({ kind: "warning", title: "Could not delete file", detail: (err as Error).message });
    }
  }

  return (
    <Drawer
      title={`KYC documents — ${vendor.code}`}
      subtitle={`${vendor.name}. GST certificate, PAN, cancelled cheque, MSME certificate, signed agreements — anything you need on file.`}
      onClose={onClose}
      footer={
        <PremiumButton variant="ghost" onClick={onClose}>
          Done
        </PremiumButton>
      }
    >
      <div className="mb-4 space-y-2.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label for the next upload (optional) — e.g. GST Certificate"
          className={inputClass}
        />
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-8 text-center transition-colors hover:border-biome-leaf/40 hover:bg-biome-leaf/[0.04]">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
            onChange={(e) => upload(e.target.files)}
            className="hidden"
            disabled={uploading}
          />
          {uploading ? (
            <Loader2 size={18} className="animate-spin text-biome-leafBright" />
          ) : (
            <FileUp size={18} className="text-biome-muted" />
          )}
          <span className="text-[11.5px] text-biome-text">
            {uploading ? "Uploading…" : "Choose files to store"}
          </span>
          <span className="text-[10.5px] text-biome-muted">
            PDF, images, Word or Excel · up to 25 MB each
          </span>
        </label>
      </div>

      {kyc.length === 0 ? (
        <p className="rounded-xl border border-biome-line bg-biome-hover px-4 py-6 text-center text-[11.5px] text-biome-muted">
          Nothing stored for this vendor yet.
        </p>
      ) : (
        <div className="space-y-2">
          {kyc.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5"
            >
              <ShieldCheck size={14} className="shrink-0 text-biome-leafBright" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] text-biome-text">{f.label || f.name}</p>
                <p className="truncate text-[10px] text-biome-muted">
                  {f.name} · {(f.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                  {new Date(f.uploadedAt).toLocaleDateString("en-IN")}
                </p>
              </div>
              <a
                href={`/api/vendors/kyc?code=${encodeURIComponent(vendor.code)}&file=${encodeURIComponent(f.name)}`}
                target="_blank"
                rel="noreferrer"
                title="Open"
                className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
              >
                <ExternalLink size={13} />
              </a>
              <button
                onClick={() => remove(f.name)}
                title="Delete"
                className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-red-300"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

/* ==================== Bulk import ==================== */

function ImportDrawer({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { notify } = useNotifications();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit", chosen?: File) {
    const target = chosen || file;
    if (!target) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", target);
      form.append("mode", mode);
      form.append("overwrite", String(overwrite));

      const res = await fetch("/api/vendors/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "The file could not be read.");

      setRows(json.rows || []);
      setSummary(json.summary || null);

      if (mode === "commit") {
        notify({
          kind: "success",
          title: "Vendor list imported",
          detail: `${json.summary.toCreate} added, ${json.summary.toUpdate} updated, ${json.summary.skipped} skipped.`,
        });
        onImported();
      }
    } catch (err) {
      notify({ kind: "warning", title: "Import failed", detail: (err as Error).message });
      setRows(null);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const headers =
      "code,name,legalName,gstin,pan,supplyType,material,contactPerson,phone,email,addressLine,city,state,stateCode,pincode,bankName,bankAccountNo,bankIfsc,paymentTerms,notes";
    const example =
      "MHI,MHI Traders,MHI Traders LLP,05HWCPK5451C1ZS,HWCPK5451C,trading,Biomass,Rajesh Kumar,+91 98765 43210,mhi@example.com,Surjan Nagar Road,Jaspur,Uttarakhand,05,244712,HDFC Bank,50100123456789,HDFC0001234,Net 30 days,";
    const blob = new Blob([`${headers}\n${example}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "biome-vendor-template.csv";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => a.remove(), 4000);
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return (
    <Drawer
      title="Upload vendor list"
      subtitle="Bring in your existing vendor codes from Excel or CSV. You'll see exactly what will change before anything is saved."
      onClose={onClose}
      footer={
        <>
          <PremiumButton variant="ghost" onClick={onClose}>
            Cancel
          </PremiumButton>
          <PremiumButton onClick={() => send("commit")} disabled={!summary || busy || summary.totalRows === 0}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Import {summary ? `${summary.toCreate + summary.toUpdate} vendors` : ""}
          </PremiumButton>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11.5px] text-biome-muted">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#9CCC65]"
          />
          Update vendors that already exist
        </label>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 text-[11px] text-biome-leafBright transition-colors hover:text-biome-leaf"
        >
          <Download size={12} /> Download a template
        </button>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-8 text-center transition-colors hover:border-biome-leaf/40 hover:bg-biome-leaf/[0.04]">
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.tsv"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setRows(null);
            setSummary(null);
            if (f) send("preview", f);
          }}
          className="hidden"
          disabled={busy}
        />
        {busy ? (
          <Loader2 size={18} className="animate-spin text-biome-leafBright" />
        ) : (
          <Upload size={18} className="text-biome-muted" />
        )}
        <span className="text-[11.5px] text-biome-text">{file ? file.name : "Choose a CSV or Excel file"}</span>
        <span className="text-[10.5px] text-biome-muted">
          Needs at least a vendor code column and a vendor name column
        </span>
      </label>

      {summary && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="To add" value={summary.toCreate} tone="good" />
            <MiniStat label="To update" value={summary.toUpdate} />
            <MiniStat label="Skipped" value={summary.skipped} tone={summary.skipped ? "warn" : undefined} />
          </div>

          {summary.unmappedColumns.length > 0 && (
            <p className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-[10.5px] leading-relaxed text-biome-muted">
              These columns weren&apos;t recognised and will be ignored:{" "}
              <span className="text-biome-text">{summary.unmappedColumns.join(", ")}</span>
            </p>
          )}

          {rows && rows.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-xl border border-biome-line">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-biome-surface">
                  <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row} className="border-b border-biome-line/40 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-biome-muted">{r.row}</td>
                      <td className="px-3 py-1.5 font-mono text-biome-text">{r.code || "—"}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-biome-muted">{r.name || "—"}</td>
                      <td className="px-3 py-1.5">
                        {r.action === "skip" ? (
                          <span className="text-red-300" title={r.errors.join(" ")}>
                            Skip — {r.errors[0] || "already registered"}
                          </span>
                        ) : (
                          <span className="capitalize text-biome-leafBright">{r.action}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ==================== shared bits ==================== */

const inputClass =
  "w-full rounded-xl border border-biome-line bg-white/[0.03] px-3 py-2 text-[11.5px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/50 focus:border-biome-leaf/40";

function Drawer({
  title,
  subtitle,
  children,
  footer,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Portal><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex h-full w-full max-w-xl flex-col border-l border-biome-line"
      >
        <div className="flex items-start justify-between gap-3 border-b border-biome-line px-5 py-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-biome-text">{title}</h3>
            {subtitle && <p className="mt-1 max-w-md text-[11px] leading-relaxed text-biome-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-biome-line px-5 py-3.5">{footer}</div>
      </motion.div>
    </motion.div></Portal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2.5 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
        <span className="h-1 w-1 rounded-full bg-biome-leafBright" />
        {title}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
  span,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  span?: boolean;
}) {
  return (
    <label className={`block ${span ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-[10.5px] text-biome-muted">
        {label}
        {required && <span className="ml-0.5 text-biome-bolt">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-biome-muted/60">{hint}</span>}
    </label>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color =
    tone === "good" ? "text-biome-leafBright" : tone === "warn" ? "text-biome-bolt" : "text-biome-text";
  return (
    <div className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2">
      <p className={`font-display text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">{label}</p>
    </div>
  );
}
