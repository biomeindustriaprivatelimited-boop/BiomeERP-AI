"use client";

import { useState } from "react";
import {
  X,
  Building2,
  Factory,
  Truck,
  Scale,
  CheckCircle2,
  CircleDashed,
  ShieldAlert,
  FileText,
  Maximize2,
  FolderOpen,
  Image as ImageIcon,
} from "lucide-react";
import { DOC_TYPE_LABEL, DOC_TYPE_SIDE, type SupplySet, type WhatsappDocument } from "@/lib/whatsapp";
import DocumentViewer from "./DocumentViewer";

const SIDE_STYLE: Record<string, string> = {
  biome: "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright",
  vendor: "border-biome-sky/30 bg-biome-sky/10 text-biome-skyBright",
  shared: "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  client: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
  other: "border-biome-line bg-biome-hover text-biome-muted",
};

/** Kilograms from whatever the page said, for the weights summary. */
function kg(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 200 ? n * 1000 : n; // a bare 28.45 is tonnes
}

function fmtKg(n: number | null) {
  return n == null ? "—" : `${Math.round(n).toLocaleString("en-IN")} kg`;
}

function weightsOf(set: SupplySet) {
  const by = (pred: (t: string) => boolean) =>
    set.documents.filter((d) => pred(String(d.extracted?.documentType || "")));
  const first = (docs: WhatsappDocument[], pick: (d: WhatsappDocument) => unknown) => {
    for (const d of docs) {
      const v = kg(pick(d));
      if (v) return v;
    }
    return null;
  };
  const ours = by((t) => t === "biome_tax_invoice" || t === "biome_delivery_challan");
  const slips = by((t) => t === "weight_slip");
  const vendor = by((t) => t === "vendor_tax_invoice" || t === "vendor_delivery_challan");
  const ex = (d: WhatsappDocument) => (d.extracted || {}) as any;
  return {
    ourQty: first(ours, (d) => ex(d).quantityKg ?? ex(d).netWeight),
    slipNet: first(slips, (d) => ex(d).netWeight ?? ex(d).quantityKg),
    slipGross: first(slips, (d) => ex(d).grossWeight),
    slipTare: first(slips, (d) => ex(d).tareWeight),
    vendorQty: first(vendor, (d) => ex(d).quantityKg),
    receiving: set.receivingWeightKg ?? null,
  };
}

/**
 * The side panel for one supply set: what it is, what is in it (with a
 * small picture of every paper), and what the client still needs.
 * Clicking a picture opens the full-page viewer.
 */
export default function SupplySetPanel({ set, onClose }: { set: SupplySet; onClose?: () => void }) {
  const [viewing, setViewing] = useState<WhatsappDocument | null>(null);
  const w = weightsOf(set);
  const provisional = !set.vendorCode;
  const folder = set.documents.find((d) => d.relativePath)?.relativePath?.split(/[\\/]/).slice(0, -1).join(" / ");

  return (
    <aside
      className="bmx-card flex max-h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
      data-testid="set-panel"
      aria-label={`Supply set ${set.reference}`}
    >
      <div className="flex items-start gap-2 border-b border-biome-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Supply set</p>
          <p className="truncate font-mono text-[15px] font-semibold text-biome-leafBright" title={set.reference}>
            {set.reference}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {set.complete ? (
              <span className="flex items-center gap-1 rounded-full border border-biome-leaf/30 bg-biome-leaf/10 px-2 py-0.5 text-[10px] font-medium text-biome-leafBright">
                <CheckCircle2 size={10} /> Complete
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-2 py-0.5 text-[10px] font-medium text-biome-bolt">
                <CircleDashed size={10} /> {set.satisfiedCount}/{set.requiredCount} collected
              </span>
            )}
            {provisional && (
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                title="The Other References box on our invoice could not be read. The set is kept under our document number and gets its full reference when it is read."
              >
                Reference not read yet
              </span>
            )}
            <span className="rounded-full border border-biome-line bg-biome-hover px-2 py-0.5 text-[10px] text-biome-muted">
              {set.documents.length} {set.documents.length === 1 ? "document" : "documents"}
            </span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the supply set panel"
            className="rounded-lg p-1 text-biome-muted hover:bg-biome-hover hover:text-biome-text"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Who, what, which truck */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <Fact icon={Building2} label="Client" value={set.clientCanonicalName || set.clientName} />
          <Fact icon={Factory} label="Vendor" value={provisional ? "Not named yet" : `${set.vendorCode}${set.vendorName ? ` · ${set.vendorName}` : ""}`} />
          <Fact icon={Truck} label="Vehicle" value={set.vehicleNo} mono />
          <Fact icon={FileText} label="Our doc / vendor doc" value={`${set.biomeDocNo || "—"} / ${set.vendorDocNo || "—"}`} mono />
        </dl>

        {/* Weights side by side, the comparison people actually make */}
        <div className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-biome-muted">
            <Scale size={11} /> Weights
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <Weight label="Our invoice / challan" value={fmtKg(w.ourQty)} />
            <Weight label="Weighbridge net" value={fmtKg(w.slipNet)} />
            <Weight label="Gross / tare" value={w.slipGross || w.slipTare ? `${fmtKg(w.slipGross)} / ${fmtKg(w.slipTare)}` : "—"} />
            <Weight label="Vendor invoice" value={fmtKg(w.vendorQty)} />
            <Weight label="Client receiving" value={w.receiving ? fmtKg(w.receiving) : "Pending"} />
          </div>
        </div>

        {/* What the client still needs */}
        {set.missing.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-biome-muted">
              {set.clientCanonicalName || "Client"} still needs
            </p>
            <div className="flex flex-wrap gap-1.5" data-testid="set-missing">
              {set.missing.map((m) => (
                <span key={m.key} className="rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-2 py-0.5 text-[10.5px] text-biome-bolt">
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        ) : set.clientMatched ? (
          <p className="flex items-center gap-1.5 text-[11px] text-biome-leafBright">
            <CheckCircle2 size={12} /> Every document {set.clientCanonicalName} asks for is here.
          </p>
        ) : null}
        {set.dscMissing.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-200">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
            No digital signature found on {set.dscMissing.map((m) => m.label).join(" and ")}.
          </p>
        )}

        {/* The papers, with pictures */}
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-biome-muted">Documents</p>
          <div className="grid grid-cols-2 gap-2.5" data-testid="set-docs">
            {set.documents.map((d) => (
              <DocTile key={d.id} doc={d} onOpen={() => setViewing(d)} />
            ))}
          </div>
        </div>

        {folder && (
          <p className="flex items-start gap-1.5 break-all text-[10.5px] text-biome-muted">
            <FolderOpen size={12} className="mt-0.5 shrink-0" /> {folder}
          </p>
        )}
      </div>

      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </aside>
  );
}

function DocTile({ doc, onOpen }: { doc: WhatsappDocument; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const type = doc.extracted?.documentType;
  const side = type ? DOC_TYPE_SIDE[type] : "other";
  const isImage = doc.mimeType?.startsWith("image/");
  return (
    <div className="group overflow-hidden rounded-xl border border-biome-line bg-biome-hover">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[3/4] w-full overflow-hidden bg-white"
        title="View full page"
        data-testid="doc-thumb"
      >
        {broken ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-biome-bgSoft text-[10px] text-biome-muted">
            {isImage ? <ImageIcon size={18} /> : <FileText size={18} />}
            No preview
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/whatsapp/preview?id=${encodeURIComponent(doc.id)}&page=1&width=360`}
            alt={doc.originalName}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.03]"
          />
        )}
        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9.5px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 size={10} /> View full page
        </span>
      </button>
      <div className="space-y-1 px-2 py-1.5">
        <span className={`inline-block max-w-full truncate rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium ${SIDE_STYLE[side] || SIDE_STYLE.other}`}>
          {type ? DOC_TYPE_LABEL[type] : "Unclassified"}
        </span>
        <p className="truncate text-[10.5px] text-biome-text" title={`Saved as: ${doc.relativePath || "—"}\nReceived as: ${doc.originalName}`}>
          {(doc.relativePath || "").split(/[\\/]/).pop() || doc.originalName}
        </p>
        {doc.autoFiledReasons && doc.autoFiledReasons.length > 0 && (
          <p className="line-clamp-2 text-[9.5px] leading-snug text-biome-muted" title={doc.autoFiledReasons.join("; ")}>
            Matched: {doc.autoFiledReasons.slice(0, 2).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value, mono }: { icon: typeof Truck; label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-biome-muted">
        <Icon size={10} /> {label}
      </dt>
      <dd className={`truncate text-[11.5px] text-biome-text ${mono ? "font-mono" : ""}`} title={value || ""}>
        {value || "—"}
      </dd>
    </div>
  );
}

function Weight({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9.5px] text-biome-muted">{label}</p>
      <p className="font-mono text-[11.5px] tabular-nums text-biome-text">{value}</p>
    </div>
  );
}
