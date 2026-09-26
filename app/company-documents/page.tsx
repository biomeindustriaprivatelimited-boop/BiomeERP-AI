"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Portal from "@/components/Portal";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderLock,
  Upload,
  Search,
  Trash2,
  ExternalLink,
  Loader2,
  X,
  AlertTriangle,
  CalendarClock,
  FileText,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

interface Category {
  id: string;
  label: string;
  hint: string;
}
interface Doc {
  id: string;
  category: string;
  fileName: string;
  label: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresOn: string | null;
  notes: string;
  expired?: boolean;
}

export default function CompanyDocumentsPage() {
  const { notify } = useNotifications();
  const [categories, setCategories] = useState<Category[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [expiring, setExpiring] = useState<Doc[]>([]);
  const [vaultPath, setVaultPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");
  const [uploadFor, setUploadFor] = useState<Category | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/company-documents", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the vault.");
      setCategories(json.categories || []);
      setDocuments(json.documents || []);
      setExpiring(json.expiring || []);
      setVaultPath(json.vaultPath || "");
    } catch (err) {
      notify({ kind: "warning", title: "Company documents", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (activeCat !== "all" && d.category !== activeCat) return false;
      if (!q) return true;
      return [d.label, d.fileName, d.notes].filter(Boolean).some((v) => v.toLowerCase().includes(q));
    });
  }, [documents, query, activeCat]);

  const countFor = (id: string) => documents.filter((d) => d.category === id).length;

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/company-documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not delete.");
      load();
    } catch (err) {
      notify({ kind: "warning", title: "Could not delete", detail: (err as Error).message });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
            <FolderLock size={20} className="text-biome-leafBright" />
            Company Documents
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
            Biome&apos;s own certificates, licences and returns, filed by category — so &ldquo;send
            us your GST certificate and a cancelled cheque&rdquo; takes thirty seconds instead of
            twenty minutes.
          </p>
        </div>
      </div>

      {/* Expiry warnings — a lapsed licence is a real operational problem */}
      {expiring.length > 0 && (
        <GlassCard className="border-biome-bolt/30 p-4">
          <div className="flex items-start gap-2.5">
            <CalendarClock size={15} className="mt-0.5 shrink-0 text-biome-bolt" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-biome-text">
                {expiring.length} document{expiring.length > 1 ? "s" : ""} expiring or expired
              </p>
              <div className="mt-2 space-y-1">
                {expiring.map((d) => (
                  <p key={d.id} className="text-[11px] text-biome-muted">
                    <span className={d.expired ? "text-rose-500" : "text-biome-bolt"}>
                      {d.expired ? "Expired" : "Expires"} {d.expiresOn}
                    </span>{" "}
                    — {d.label}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Category tiles */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <button
          onClick={() => setActiveCat("all")}
          className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
            activeCat === "all" ? "border-biome-leaf/40 bg-biome-leaf/10" : "border-biome-line hover:bg-biome-hover"
          }`}
        >
          <p className={`text-[12px] font-medium ${activeCat === "all" ? "text-biome-leafBright" : "text-biome-text"}`}>
            All documents
          </p>
          <p className="mt-0.5 text-[10px] text-biome-muted">{documents.length} stored</p>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`group rounded-xl border px-3.5 py-3 text-left transition-colors ${
              activeCat === c.id ? "border-biome-leaf/40 bg-biome-leaf/10" : "border-biome-line hover:bg-biome-hover"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={`text-[12px] font-medium ${activeCat === c.id ? "text-biome-leafBright" : "text-biome-text"}`}>
                {c.label}
              </p>
              <span className="shrink-0 rounded-full bg-biome-line/70 px-1.5 py-0.5 text-[9.5px] text-biome-muted">
                {countFor(c.id)}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] leading-snug text-biome-muted">{c.hint}</p>
            <span
              onClick={(e) => {
                e.stopPropagation();
                setUploadFor(c);
              }}
              className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[10.5px] text-biome-leafBright opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Upload size={10} /> Upload here
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or note…"
            className="w-full rounded-xl border border-biome-line bg-biome-hover py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
          />
        </div>
        <PremiumButton onClick={() => setUploadFor(categories[0] ?? null)} disabled={!categories.length}>
          <Upload size={13} /> Upload document
        </PremiumButton>
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center gap-2 py-14 text-xs text-biome-muted">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="px-6 py-14 text-center">
          <p className="font-display text-sm font-medium text-biome-text">
            {query || activeCat !== "all" ? "Nothing here yet" : "No documents stored yet"}
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-biome-muted">
            Start with the ones you get asked for most: GST certificate, PAN, cancelled cheque and
            the certificate of incorporation.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <table className="w-full text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-biome-line text-[9.5px] uppercase tracking-wider text-biome-muted/60">
                <th className="px-4 py-2.5 font-medium">Document</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Expires</th>
                <th className="px-4 py-2.5 font-medium">Size</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-b border-biome-line/50 last:border-0 hover:bg-biome-hover">
                  <td className="max-w-[280px] px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <FileText size={14} className="shrink-0 text-biome-muted" />
                      <div className="min-w-0">
                        <p className="truncate text-biome-text" title={d.label}>{d.label}</p>
                        <p className="truncate text-[10px] text-biome-muted">{d.fileName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-biome-muted">
                    {categories.find((c) => c.id === d.category)?.label ?? d.category}
                  </td>
                  <td className="px-4 py-2.5">
                    {d.expiresOn ? (
                      <span className={d.expiresOn < new Date().toISOString().slice(0, 10) ? "text-rose-500" : "text-biome-muted"}>
                        {d.expiresOn}
                      </span>
                    ) : (
                      <span className="text-biome-muted/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10.5px] text-biome-muted">
                    {(d.sizeBytes / 1024).toFixed(0)} KB
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`/api/company-documents?id=${encodeURIComponent(d.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
                      >
                        <ExternalLink size={13} />
                      </a>
                      <button
                        onClick={() => remove(d.id)}
                        className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-rose-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}

      {vaultPath && (
        <p className="px-1 font-mono text-[10px] text-biome-muted" title={vaultPath}>
          Stored at {vaultPath}
        </p>
      )}

      <AnimatePresence>
        {uploadFor && (
          <UploadDialog
            categories={categories}
            initial={uploadFor}
            onClose={() => setUploadFor(null)}
            onDone={() => {
              setUploadFor(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function UploadDialog({
  categories,
  initial,
  onClose,
  onDone,
}: {
  categories: Category[];
  initial: Category;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useNotifications();
  const [category, setCategory] = useState(initial.id);
  const [label, setLabel] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload() {
    const files = fileRef.current?.files;
    if (!files?.length) {
      notify({ kind: "warning", title: "Pick a file first", detail: "Choose at least one document to upload." });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("category", category);
      if (label.trim()) form.append("label", label.trim());
      if (expiresOn) form.append("expiresOn", expiresOn);
      if (notes.trim()) form.append("notes", notes.trim());
      Array.from(files).forEach((f) => form.append("file", f));

      const res = await fetch("/api/company-documents", { method: "POST", body: form });
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
        notify({ kind: "success", title: `${json.added.length} document(s) stored` });
        onDone();
      }
    } catch (err) {
      notify({ kind: "warning", title: "Upload failed", detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-biome-line bg-white/[0.03] px-3 py-2 text-[11.5px] text-biome-text outline-none focus:border-biome-leaf/40";

  return (
    <Portal><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e: any) => e.stopPropagation()}
        className="glass w-full max-w-md rounded-2xl border border-biome-line p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-display text-sm font-semibold text-biome-text">Upload a document</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-biome-muted hover:bg-biome-hover hover:text-biome-text">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Name it (optional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GST Certificate 2026" className={input} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">
              Expires on (optional) <span className="text-biome-muted/60">— you&apos;ll be warned 60 days ahead</span>
            </span>
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={input} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${input} resize-none`} />
          </label>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-biome-line bg-biome-hover px-4 py-6 text-center transition-colors hover:border-biome-leaf/40">
            <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.zip" />
            <Upload size={17} className="text-biome-muted" />
            <span className="text-[11.5px] text-biome-text">Choose file(s)</span>
            <span className="text-[10px] text-biome-muted">PDF, image, Office or ZIP · up to 50 MB each</span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <PremiumButton variant="ghost" onClick={onClose}>Cancel</PremiumButton>
          <PremiumButton onClick={upload} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Upload
          </PremiumButton>
        </div>
      </motion.div>
    </motion.div></Portal>
  );
}
