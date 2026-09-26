"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  CheckCircle2,
  CircleDashed,
  ShieldAlert,
  Phone,
  HelpCircle,
  Truck,
  Building2,
  Factory,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  RefreshCw,
  Loader2,
  Hand,
  Trash2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_SIDE,
  type SupplySet,
  type WhatsappDocument,
} from "@/lib/whatsapp";

const SIDE_STYLE: Record<string, string> = {
  biome: "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright",
  vendor: "border-biome-sky/30 bg-biome-sky/10 text-biome-skyBright",
  shared: "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  other: "border-biome-line bg-white/5 text-biome-muted",
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DocumentRow({
  doc,
  onRescan,
  rescanningId,
  onIdentify,
  onDelete,
}: {
  doc: WhatsappDocument;
  onRescan: (id: string) => void;
  rescanningId: string | null;
  onIdentify?: (doc: WhatsappDocument) => void;
  onDelete?: (doc: WhatsappDocument) => void;
}) {
  const type = doc.extracted?.documentType;
  const side = type ? DOC_TYPE_SIDE[type] : "other";
  const isImage = doc.mimeType?.startsWith("image/");
  const busy = rescanningId === doc.id;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-biome-line/60 bg-biome-hover px-3 py-2.5">
      {isImage ? (
        <ImageIcon size={14} className="shrink-0 text-biome-muted" />
      ) : (
        <FileText size={14} className="shrink-0 text-biome-muted" />
      )}

      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${SIDE_STYLE[side]}`}
      >
        {type ? DOC_TYPE_LABEL[type] : "Unclassified"}
      </span>

      <span className="min-w-0 flex-1 truncate text-[11.5px] text-biome-text" title={doc.originalName}>
        {doc.originalName}
      </span>

      {doc.extracted?.confidence != null && doc.extracted.confidence < 70 && (
        <span
          className="shrink-0 rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-1.5 py-0.5 font-mono text-[9.5px] text-biome-bolt"
          title="The AI wasn't certain about this one — worth opening to check."
        >
          {Math.round(doc.extracted.confidence)}% sure
        </span>
      )}

      <span className="shrink-0 font-mono text-[10px] text-biome-muted/70">
        {formatWhen(doc.receivedAt)}
      </span>

      {onIdentify && (
        <button
          onClick={() => onIdentify(doc)}
          title="Tell the app what this document is"
          className="shrink-0 rounded-lg p-1 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-leafBright"
        >
          <Hand size={13} />
        </button>
      )}

      <button
        onClick={() => onRescan(doc.id)}
        disabled={busy}
        title="Read this document again — useful after adding an API key or registering a vendor code"
        className="shrink-0 rounded-lg p-1 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      </button>

      {onDelete && (
        <button
          onClick={() => onDelete(doc)}
          title="Remove this document's record"
          className="shrink-0 rounded-lg p-1 text-biome-muted transition-colors hover:bg-biome-hover hover:text-rose-400"
        >
          <Trash2 size={13} />
        </button>
      )}

      <a
        href={`/api/whatsapp/file?id=${encodeURIComponent(doc.id)}`}
        target="_blank"
        rel="noreferrer"
        title="Open the file"
        className="shrink-0 rounded-lg p-1 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
      >
        <ExternalLink size={13} />
      </a>
    </div>
  );
}

export default function SupplySetCard({
  set,
  onRescan,
  rescanningId,
  defaultOpen = false,
}: {
  set: SupplySet;
  onRescan: (id: string) => void;
  rescanningId: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-biome-hover"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }} className="mt-1">
          <ChevronDown size={15} className="text-biome-muted" />
        </motion.span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold tracking-tight text-biome-leafBright">
              {set.reference}
            </span>
            {!set.clientMatched ? (
              <span
                className="flex items-center gap-1 rounded-full border border-biome-sky/30 bg-biome-sky/10 px-2 py-0.5 text-[10px] font-medium text-biome-skyBright"
                title="This consignee isn't in the client list, so there's no document checklist to measure against. Add it under Clients."
              >
                <HelpCircle size={10} /> Client not in list
              </span>
            ) : set.complete ? (
              <span className="flex items-center gap-1 rounded-full border border-biome-leaf/30 bg-biome-leaf/10 px-2 py-0.5 text-[10px] font-medium text-biome-leafBright">
                <CheckCircle2 size={10} /> Complete
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-2 py-0.5 text-[10px] font-medium text-biome-bolt">
                <CircleDashed size={10} /> {set.satisfiedCount}/{set.requiredCount} collected
              </span>
            )}
            {set.dscMissing.length > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
                <ShieldAlert size={10} /> DSC missing
              </span>
            )}
            <span className="rounded-full border border-biome-line bg-biome-hover px-2 py-0.5 text-[10px] text-biome-muted">
              {set.documents.length} {set.documents.length === 1 ? "document" : "documents"}
            </span>
            {/* Said plainly rather than hidden: the count changed because
                copies were folded, and someone comparing it against the
                group chat needs to know why. */}
            {(set.duplicateCount || 0) > 0 && (
              <span
                title="The same document was shared into the group more than once. Only one copy is counted."
                className="rounded-full border border-biome-line bg-biome-hover px-2 py-0.5 text-[10px] text-biome-muted"
              >
                {set.duplicateCount} re-share{set.duplicateCount === 1 ? "" : "s"} folded
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-biome-muted">
            {set.clientName && (
              <span className="flex items-center gap-1.5">
                <Building2 size={11} /> {set.clientName}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Factory size={11} /> Vendor {set.vendorCode}
              {set.vendorName ? ` · ${set.vendorName}` : ""}
              {(() => { const amb = (set.documents || []).map((d: any) => d.extracted?.vendorAmbiguous).find((x: any) => Array.isArray(x) && x.length); return amb ? (
                <span className="normal-case ml-1 rounded-full border border-amber-500/50 bg-amber-500/12 px-2 py-0.5 text-[9px] font-bold text-amber-600" title={`Code ${set.vendorCode} is shared by: ${amb.join(", ")}. None is named on the document — confirm the vendor.`}>⚠ Shared code — confirm vendor</span>
              ) : null; })()}
            </span>
            {set.vehicleNo && (
              <span className="flex items-center gap-1.5 font-mono">
                <Truck size={11} /> {set.vehicleNo}
              </span>
            )}
            <span className={`flex items-center gap-1.5 ${set.receivingWeightKg ? "text-biome-leafBright" : "text-biome-bolt"}`}>
              <FileText size={11} /> Receiving: {set.receivingWeightKg ? `${set.receivingWeightKg.toLocaleString("en-IN")} kg` : "Pending"}
            </span>
          </div>
        </div>

        <span className="shrink-0 font-mono text-[10px] text-biome-muted/70">
          {formatWhen(set.lastSeen)}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-biome-line px-4 py-3.5">
              {set.missing.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-biome-muted/60">
                    {set.clientCanonicalName} still needs
                  </span>
                  {set.missing.map((m) => (
                    <span
                      key={m.key}
                      className="rounded-full border border-biome-bolt/25 bg-biome-bolt/10 px-2 py-0.5 text-[10px] text-biome-bolt"
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
              )}

              {set.dscMissing.length > 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0 text-red-300" />
                  <p className="text-[11px] leading-relaxed text-red-200">
                    No Digital Signature Certificate found on{" "}
                    <span className="font-medium">
                      {set.dscMissing.map((m) => m.label).join(" and ")}
                    </span>
                    . {set.clientNotes || "This client requires a DSC on it."}
                  </p>
                </div>
              )}

              {!set.clientMatched && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-biome-sky/25 bg-biome-sky/5 px-3 py-2">
                  <HelpCircle size={13} className="mt-0.5 shrink-0 text-biome-skyBright" />
                  <p className="text-[11px] leading-relaxed text-biome-skyBright/90">
                    &ldquo;{set.clientName || "This consignee"}&rdquo; isn&apos;t in the client list, so
                    there&apos;s no checklist to measure this supply against. Add it under Clients to see
                    what&apos;s missing.
                  </p>
                </div>
              )}

              {set.documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} onRescan={onRescan} rescanningId={rescanningId} />
              ))}

              {(set.duplicates || []).length > 0 && (
                <details className="rounded-xl border border-biome-line/60 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-biome-muted">
                    {set.duplicates!.length} copy of the same document{set.duplicates!.length === 1 ? "" : "s"} shared
                    again — folded out of the count
                  </summary>
                  <div className="mt-2 space-y-1.5 opacity-70">
                    {set.duplicates!.map((doc) => (
                      <DocumentRow key={doc.id} doc={doc} onRescan={onRescan} rescanningId={rescanningId} />
                    ))}
                  </div>
                </details>
              )}

              <div className="grid gap-x-6 gap-y-1.5 pt-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Our document no" value={set.biomeDocNo} />
                <Detail label="Vendor code" value={set.vendorCode} />
                <Detail label="Vendor document no" value={set.vendorDocNo} />
                <Detail label="Driver mobile" value={set.driverMobile} />
                <Detail label="First received" value={formatWhen(set.firstSeen)} />
                <Detail label="Receiving date" value={set.receivingDate || null} />
                <Detail label="Actual receiving weight" value={set.receivingWeightKg != null ? `${set.receivingWeightKg.toLocaleString("en-IN")} kg` : null} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/50">{label}</p>
      <p className="truncate font-mono text-[11px] text-biome-text">{value || "—"}</p>
    </div>
  );
}
