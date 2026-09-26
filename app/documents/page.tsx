"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Portal from "@/components/Portal";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Upload,
  ScanLine,
  RefreshCw,
  Search,
  Filter,
  X,
  ExternalLink,
  Loader2,
  FileCheck2,
  Clock,
  HardDrive,
  Copy,
  CalendarDays,
  Sparkles,
  Image as ImageIcon,
  FileSpreadsheet,
  Building2,
  Truck,
  Hash,
  Star,
  Inbox,
} from "lucide-react";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { DOC_TYPE_LABEL, type WhatsappDocument, type DocumentType } from "@/lib/whatsapp";

/**
 * The Documents module.
 *
 * This is a real library over documents the app already holds — the
 * WhatsApp supply inbox and the company vault — not a new silo. Anything
 * filed by the WhatsApp agent appears here the moment it lands, with the
 * fields the reader extracted, so this page and that pipeline can never
 * disagree about what exists.
 */

type SourceKind = "whatsapp" | "company" | "partner";

interface UnifiedDoc {
  id: string;
  source: SourceKind;
  name: string;
  category: string;
  categoryLabel: string;
  receivedAt: string;
  sizeBytes: number;
  mimeType: string;
  href: string;
  /** Everything the reader pulled off the page, when there is any. */
  reference?: string | null;
  client?: string | null;
  vendor?: string | null;
  vehicle?: string | null;
  amount?: string | null;
  confidence?: number | null;
  ocrText?: string;
  status: "filed" | "needs-review" | "not-a-document" | "stored";
  sender?: string | null;
}

const FILTER_GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: "Library",
    items: [
      { id: "all", label: "All Documents" },
      { id: "whatsapp", label: "WhatsApp" },
      { id: "company", label: "Company Vault" },
      // Everything registration put on file — agreements, POs, GST papers.
      // A plant manager sees what their own site uploaded plus anything
      // held centrally for a partner they work with.
      { id: "partner", label: "Vendor & transporter papers" },
      { id: "needs-review", label: "Needs Review" },
    ],
  },
  {
    title: "Supply documents",
    items: [
      { id: "biome_tax_invoice", label: "Biome Tax Invoice" },
      { id: "biome_delivery_challan", label: "Delivery Challan" },
      { id: "biome_eway_bill", label: "Biome E-way Bill" },
      { id: "vendor_tax_invoice", label: "Vendor Tax Invoice" },
      { id: "vendor_eway_bill", label: "Vendor E-way Bill" },
      { id: "bilty_lr", label: "Bilty / LR Copy" },
      { id: "weight_slip", label: "Weight Slips" },
      { id: "consignment_tag", label: "Consignment Tags" },
      { id: "fast_tag", label: "Fast Tag" },
      { id: "coa", label: "COA / Lab Reports" },
    ],
  },
  {
    title: "File type",
    items: [
      { id: "type:pdf", label: "PDF" },
      { id: "type:image", label: "Images" },
      { id: "type:sheet", label: "Excel" },
    ],
  },
];

function fileIcon(mime: string) {
  if (mime?.startsWith("image/")) return ImageIcon;
  if (mime?.includes("sheet") || mime?.includes("excel")) return FileSpreadsheet;
  return FileText;
}

function formatBytes(n: number) {
  if (!n) return "—";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<UnifiedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UnifiedDoc | null>(null);
  const [agentDown, setAgentDown] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const merged: UnifiedDoc[] = [];

    // --- WhatsApp supply documents ---
    try {
      const res = await fetch("/api/whatsapp/documents?limit=1000", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        for (const d of (json.documents ?? []) as WhatsappDocument[]) {
          const type = d.extracted?.documentType as DocumentType | undefined;
          merged.push({
            id: d.id,
            source: "whatsapp",
            name: d.originalName,
            category: type ?? "unclassified",
            categoryLabel: type ? DOC_TYPE_LABEL[type] : "Unclassified",
            receivedAt: d.receivedAt,
            sizeBytes: d.sizeBytes ?? 0,
            mimeType: d.mimeType,
            href: `/api/whatsapp/file?id=${encodeURIComponent(d.id)}`,
            reference: d.reference?.canonical ?? null,
            client: d.extracted?.clientName ?? null,
            vendor: d.extracted?.vendorName ?? null,
            vehicle: d.extracted?.vehicleNo ?? null,
            amount: d.extracted?.totalAmount ?? null,
            confidence: d.extracted?.confidence ?? null,
            ocrText: d.extracted?.transcription ?? "",
            status:
              d.bucket === "filed"
                ? "filed"
                : d.bucket === "_Not A Document"
                  ? "not-a-document"
                  : "needs-review",
            sender: d.sender?.name ?? null,
          });
        }
      } else {
        const body = await res.json().catch(() => ({}));
        setAgentDown(body.error || "The WhatsApp agent isn't running.");
      }
    } catch {
      setAgentDown("The WhatsApp agent isn't reachable.");
    }

    // --- Company vault ---
    try {
      const res = await fetch("/api/company-documents", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const cats: { id: string; label: string }[] = json.categories ?? [];
        for (const d of json.documents ?? []) {
          merged.push({
            id: d.id,
            source: "company",
            name: d.label || d.fileName,
            category: d.category,
            categoryLabel: cats.find((c) => c.id === d.category)?.label ?? d.category,
            receivedAt: d.uploadedAt,
            sizeBytes: d.sizeBytes ?? 0,
            mimeType: d.fileName?.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
            href: `/api/company-documents?id=${encodeURIComponent(d.id)}`,
            status: "stored",
          });
        }
      }
    } catch {
      /* the vault is optional; WhatsApp documents still list */
    }

    // --- Vendor and transporter registration papers ---
    //
    // Optional in exactly the same way: a coordinator has no access to
    // this endpoint and gets a 404, which must not empty the rest of the
    // screen. So a failure here is silence, not an error.
    try {
      const res = await fetch("/api/partners/document", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        for (const d of json.documents ?? []) {
          merged.push({
            id: `partner-${d.partnerId}-${d.id}`,
            source: "partner",
            name: d.label || d.fileName,
            category: d.type,
            categoryLabel: `${d.partnerKindLabel} · ${d.label}`,
            receivedAt: d.uploadedAt,
            sizeBytes: d.sizeBytes ?? 0,
            mimeType: d.mimeType || "application/octet-stream",
            href: `/api/partners/document?partnerId=${encodeURIComponent(d.partnerId)}&id=${encodeURIComponent(d.id)}`,
            vendor: d.partnerName,
            reference: d.reference || null,
            sender: d.uploadedByName + (d.plant ? ` · ${d.plant}` : ""),
            status: "stored",
          });
        }
      }
    } catch {
      /* registration papers are optional for roles that cannot see them */
    }

    merged.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    setDocs(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter === "whatsapp" && d.source !== "whatsapp") return false;
      else if (filter === "company" && d.source !== "company") return false;
      else if (filter === "partner" && d.source !== "partner") return false;
      else if (filter === "needs-review" && d.status !== "needs-review") return false;
      else if (filter.startsWith("type:")) {
        const kind = filter.slice(5);
        if (kind === "pdf" && !d.mimeType.includes("pdf")) return false;
        if (kind === "image" && !d.mimeType.startsWith("image/")) return false;
        if (kind === "sheet" && !/sheet|excel/.test(d.mimeType)) return false;
      } else if (!["all", "whatsapp", "company", "needs-review"].includes(filter)) {
        if (d.category !== filter) return false;
      }

      if (!q) return true;
      return [d.name, d.reference, d.client, d.vendor, d.vehicle, d.categoryLabel, d.sender, d.ocrText]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [docs, filter, query]);

  const stats = useMemo(() => {
    const wa = docs.filter((d) => d.source === "whatsapp");
    const read = wa.filter((d) => d.confidence != null && d.confidence > 0).length;
    const bytes = docs.reduce((s, d) => s + (d.sizeBytes || 0), 0);
    const names = new Map<string, number>();
    for (const d of docs) names.set(d.name, (names.get(d.name) ?? 0) + 1);
    return {
      total: docs.length,
      read,
      pending: wa.length - read,
      storage: bytes,
      duplicates: [...names.values()].filter((n) => n > 1).length,
      today: docs.filter((d) => d.receivedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    };
  }, [docs]);

  const countFor = (id: string) =>
    docs.filter((d) => {
      if (id === "all") return true;
      if (id === "whatsapp") return d.source === "whatsapp";
      if (id === "company") return d.source === "company";
      if (id === "partner") return d.source === "partner";
      if (id === "needs-review") return d.status === "needs-review";
      if (id.startsWith("type:")) {
        const k = id.slice(5);
        if (k === "pdf") return d.mimeType.includes("pdf");
        if (k === "image") return d.mimeType.startsWith("image/");
        if (k === "sheet") return /sheet|excel/.test(d.mimeType);
      }
      return d.category === id;
    }).length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[26px] font-bold tracking-tight text-biome-text">
            <FileText size={24} className="text-biome-leafBright" />
            Documents
          </h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-biome-leafBright">
            Document intelligence, running on this machine
          </p>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-biome-muted">
            Every invoice, challan, weight slip and WhatsApp attachment in one place — read,
            classified and searchable by what&apos;s written inside them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/company-documents">
            <PremiumButton variant="ghost">
              <Upload size={13} /> Upload
            </PremiumButton>
          </Link>
          <Link href="/ocr">
            <PremiumButton variant="ghost">
              <ScanLine size={13} /> Scan
            </PremiumButton>
          </Link>
          <Link href="/whatsapp">
            <PremiumButton variant="ghost">
              <RefreshCw size={13} /> Sync WhatsApp
            </PremiumButton>
          </Link>
          <PremiumButton onClick={load} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </PremiumButton>
        </div>
      </div>

      {/* ---- Summary cards ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={FileText} label="Total Documents" value={stats.total} tint="text-blue-600 bg-blue-100" />
        <StatCard icon={FileCheck2} label="Read by AI" value={stats.read} tint="text-emerald-600 bg-emerald-100"
          sub={stats.total ? `${Math.round((stats.read / Math.max(stats.total, 1)) * 100)}%` : undefined} />
        <StatCard icon={Clock} label="Pending read" value={stats.pending} tint="text-amber-600 bg-amber-100" />
        <StatCard icon={HardDrive} label="Storage used" value={formatBytes(stats.storage)} tint="text-violet-600 bg-violet-100" />
        <StatCard icon={Copy} label="Possible duplicates" value={stats.duplicates} tint="text-rose-600 bg-rose-100" />
        <StatCard icon={CalendarDays} label="Added today" value={stats.today} tint="text-teal-600 bg-teal-100" />
      </div>

      {agentDown && (
        <GlassCard className="flex flex-wrap items-center gap-x-3 gap-y-1 border-biome-bolt/25 px-4 py-2.5">
          <Inbox size={14} className="shrink-0 text-biome-bolt" />
          <p className="min-w-0 flex-1 text-[11.5px] text-biome-muted">{agentDown}</p>
          <Link href="/whatsapp" className="text-[11.5px] font-medium text-biome-leafBright hover:underline">
            Open WhatsApp →
          </Link>
        </GlassCard>
      )}

      {/* ---- Search ---- */}
      <GlassCard className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Sparkles size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-biome-leafBright" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by invoice no, vendor, vehicle, GSTIN, reference — or anything inside the document"
            className="w-full rounded-xl border border-biome-line bg-biome-hover py-2.5 pl-10 pr-3 text-[12px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
          />
        </div>
        <span className="flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1.5 text-[11px] text-biome-muted">
          <Filter size={12} /> {filtered.length} of {docs.length}
        </span>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* ---- Sidebar filters ---- */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {FILTER_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 px-1 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
                {g.title}
              </p>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  const n = countFor(it.id);
                  return (
                    <button
                      key={it.id}
                      onClick={() => setFilter(it.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                        filter === it.id
                          ? "bg-biome-leaf/12 font-medium text-biome-leafBright"
                          : "text-biome-muted hover:bg-biome-hover hover:text-biome-text"
                      }`}
                    >
                      <span className="min-w-0 truncate">{it.label}</span>
                      {n > 0 && (
                        <span className="shrink-0 rounded-full bg-biome-line/70 px-1.5 text-[9.5px] text-biome-muted">
                          {n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* ---- Grid ---- */}
        <div>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-biome-line/40" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <GlassCard className="flex flex-col items-center gap-3 px-6 py-20 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-biome-leaf/10">
                <FileText size={26} className="text-biome-leafBright" />
              </span>
              <p className="font-display text-base font-semibold text-biome-text">
                {query || filter !== "all" ? "Nothing matches that" : "No documents yet"}
              </p>
              <p className="max-w-md text-[12px] leading-relaxed text-biome-muted">
                {query || filter !== "all"
                  ? "Try a different filter, or search for a vendor, vehicle or invoice number."
                  : "Link WhatsApp so supply documents file themselves, scan something with the OCR reader, or upload company papers to the vault."}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Link href="/whatsapp"><PremiumButton><RefreshCw size={13} /> Sync WhatsApp</PremiumButton></Link>
                <Link href="/ocr"><PremiumButton variant="ghost"><ScanLine size={13} /> Scan a document</PremiumButton></Link>
                <Link href="/company-documents"><PremiumButton variant="ghost"><Upload size={13} /> Upload</PremiumButton></Link>
              </div>
            </GlassCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.slice(0, 120).map((d, i) => {
                const Icon = fileIcon(d.mimeType);
                return (
                  <motion.button
                    key={d.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    onClick={() => setSelected(d)}
                    className="glass group rounded-2xl p-3.5 text-left transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          d.status === "needs-review"
                            ? "bg-amber-100 text-amber-600"
                            : d.status === "not-a-document"
                              ? "bg-slate-100 text-slate-500"
                              : "bg-emerald-100 text-emerald-600"
                        }`}
                      >
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-biome-text" title={d.name}>
                          {d.name}
                        </p>
                        <p className="truncate text-[10.5px] text-biome-muted">{d.categoryLabel}</p>
                      </div>
                      {d.confidence != null && d.confidence > 0 && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            d.confidence >= 70 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {Math.round(d.confidence)}%
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 space-y-1">
                      {d.reference && (
                        <p className="flex items-center gap-1.5 truncate font-mono text-[10.5px] text-biome-leafBright">
                          <Hash size={10} /> {d.reference}
                        </p>
                      )}
                      {d.client && (
                        <p className="flex items-center gap-1.5 truncate text-[10.5px] text-biome-muted">
                          <Building2 size={10} /> {d.client}
                        </p>
                      )}
                      {d.vehicle && (
                        <p className="flex items-center gap-1.5 truncate font-mono text-[10.5px] text-biome-muted">
                          <Truck size={10} /> {d.vehicle}
                        </p>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-biome-line/70 pt-2 text-[9.5px] text-biome-muted">
                      <span>{new Date(d.receivedAt).toLocaleDateString("en-IN")}</span>
                      <span>{formatBytes(d.sizeBytes)}</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
          {filtered.length > 120 && (
            <p className="mt-3 text-center text-[10.5px] text-biome-muted">
              Showing the first 120 of {filtered.length}. Narrow it with a filter or search.
            </p>
          )}
        </div>
      </div>

      {/* ---- Preview panel ---- */}
      <AnimatePresence>
        {selected && <PreviewPanel doc={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tint,
  sub,
}: {
  icon: any;
  label: string;
  value: number | string;
  tint: string;
  sub?: string;
}) {
  return (
    <GlassCard className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10.5px] text-biome-muted">{label}</p>
          <p className="font-display text-[19px] font-bold tabular-nums leading-tight text-biome-text">
            {value}
            {sub && <span className="ml-1 text-[11px] font-normal text-biome-muted">{sub}</span>}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

function PreviewPanel({ doc, onClose }: { doc: UnifiedDoc; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isImage = doc.mimeType?.startsWith("image/");
  const isPdf = doc.mimeType?.includes("pdf");

  return (
    <Portal><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        onClick={(e: any) => e.stopPropagation()}
        className="glass flex h-full w-full max-w-xl flex-col border-l border-biome-line"
      >
        <div className="flex items-start justify-between gap-3 border-b border-biome-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-biome-text" title={doc.name}>
              {doc.name}
            </h3>
            <p className="mt-0.5 text-[11px] text-biome-muted">{doc.categoryLabel}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <a
              href={doc.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
              title="Open"
            >
              <ExternalLink size={15} />
            </a>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Preview */}
          <div className="overflow-hidden rounded-xl border border-biome-line bg-white">
            {isImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={doc.href} alt={doc.name} className="max-h-[300px] w-full object-contain" />
            ) : isPdf ? (
              <iframe src={doc.href} title={doc.name} className="h-[340px] w-full" />
            ) : (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <FileText size={24} className="text-biome-muted" />
                <p className="text-[11.5px] text-biome-muted">No inline preview for this file type.</p>
                <a href={doc.href} target="_blank" rel="noreferrer" className="text-[11.5px] text-biome-leafBright hover:underline">
                  Open it instead
                </a>
              </div>
            )}
          </div>

          {/* Extracted fields */}
          <div>
            <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
              What the reader found
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Reference" value={doc.reference} mono />
              <Field label="Client" value={doc.client} />
              <Field label="Vendor" value={doc.vendor} />
              <Field label="Vehicle" value={doc.vehicle} mono />
              <Field label="Amount" value={doc.amount} mono />
              <Field label="Confidence" value={doc.confidence != null ? `${Math.round(doc.confidence)}%` : null} />
              <Field
                label="Source"
                value={
                  doc.source === "whatsapp" ? `WhatsApp${doc.sender ? ` · ${doc.sender}` : ""}`
                  : doc.source === "partner" ? `Registration${doc.sender ? ` · uploaded by ${doc.sender}` : ""}`
                  : "Company vault"
                }
              />
              <Field label="Received" value={new Date(doc.receivedAt).toLocaleString("en-IN")} />
            </div>
          </div>

          {/* OCR text */}
          {doc.ocrText && doc.ocrText.trim().length > 0 && (
            <div>
              <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
                Text read from the page
              </p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-biome-line bg-biome-hover p-3 font-mono text-[10.5px] leading-relaxed text-biome-muted">
                {doc.ocrText}
              </pre>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div></Portal>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/50">{label}</p>
      <p className={`truncate text-[11.5px] text-biome-text ${mono ? "font-mono" : ""}`} title={value ?? ""}>
        {value || "—"}
      </p>
    </div>
  );
}
