"use client";

import { useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { motion } from "framer-motion";
import { X, CheckCircle2, Loader2, Hand, ExternalLink } from "lucide-react";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";
import { DOC_TYPE_LABEL, type DocumentType, type WhatsappDocument } from "@/lib/whatsapp";

/**
 * When the AI can't read a document, the person can just say what it is.
 * Their answer is treated as authoritative — no confidence score, no
 * second-guessing — and the file is moved into the right supply folder
 * immediately.
 */
export default function ManualClassify({
  doc,
  onClose,
  onSaved,
}: {
  doc: WhatsappDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useNotifications();
  const [documentType, setDocumentType] = useState<DocumentType>(
    doc.extracted?.documentType && doc.extracted.documentType !== "other"
      ? doc.extracted.documentType
      : "vendor_tax_invoice"
  );
  const [referenceNo, setReferenceNo] = useState(doc.reference?.canonical ?? "");
  const [clientName, setClientName] = useState(doc.extracted?.clientName ?? "");
  const [documentDate, setDocumentDate] = useState(doc.extracted?.documentDate ?? "");
  const [vehicleNo, setVehicleNo] = useState(doc.extracted?.vehicleNo ?? "");
  const [biomeDocNo, setBiomeDocNo] = useState(doc.extracted?.biomeDocNo ?? "");
  const [vendorDocNo, setVendorDocNo] = useState(doc.extracted?.vendorDocNo ?? "");
  const [clients, setClients] = useState<string[]>([]);
  // Which supply the app thinks this belongs to, worked out from the
  // invoices already filed. Shown with its reasons so it can be checked
  // rather than taken on trust.
  const [suggestion, setSuggestion] = useState<{
    reference: string;
    confidence: number;
    reasons: string[];
    clientName?: string | null;
    date?: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Only worth asking when the reference is actually missing — which is
    // every vendor document, since their paperwork never carries one.
    if (doc.reference?.canonical) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/whatsapp/suggest-reference?id=${encodeURIComponent(doc.id)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.suggestion) return;
        setSuggestion(json.suggestion);
        setReferenceNo((current) => current || json.suggestion.reference);
        if (json.suggestion.clientName) {
          setClientName((current: string) => current || json.suggestion.clientName);
        }
        if (json.suggestion.date) {
          setDocumentDate((current: string) => current || json.suggestion.date);
        }
      } catch {
        /* the field simply stays blank, as before */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.reference?.canonical]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setClients((j.clients || []).map((c: any) => c.name)))
      .catch(() => {});
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isOurs =
    documentType === "biome_tax_invoice" || documentType === "biome_delivery_challan";

  // A reference is what puts the file in a supply folder; without one it
  // stays in review however much else is filled in.
  const refLooksRight = /^[A-Za-z]{2,6}[\/\-][A-Za-z0-9\-]+[\/\-][A-Za-z]{2,8}[\/\-][A-Za-z0-9\-]+$/.test(
    referenceNo.trim()
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.id,
          documentType,
          referenceNo: referenceNo.trim() || null,
          clientName: clientName.trim() || null,
          documentDate: documentDate || null,
          vehicleNo: vehicleNo.trim() || null,
          biomeDocNo: biomeDocNo.trim() || null,
          vendorDocNo: vendorDocNo.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      notify({
        kind: "success",
        title: "Filed",
        detail: json.movedWithIt
          ? `Also moved ${json.movedWithIt} other document(s) into this supply's folder.`
          : json.document?.relativePath || "Saved to the supply folder.",
      });
      onSaved();
    } catch (err) {
      notify({ kind: "warning", title: "Could not file it", detail: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-xl border border-biome-line bg-white/[0.03] px-3 py-2 text-[11.5px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/50 focus:border-biome-leaf/40";

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
        className="glass max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-biome-line p-5"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-biome-text">
            <Hand size={15} className="text-biome-leafBright" />
            Tell me what this is
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-biome-muted" title={doc.originalName}>
            {doc.originalName}
          </p>
          <a
            href={`/api/whatsapp/file?id=${encodeURIComponent(doc.id)}`}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-[11px] text-biome-leafBright hover:text-biome-leaf"
          >
            Open <ExternalLink size={11} />
          </a>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">What kind of document?</span>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              className={input}
            >
              {(Object.keys(DOC_TYPE_LABEL) as DocumentType[]).map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">
              Which supply? (reference on our invoice)
            </span>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value.toUpperCase())}
              placeholder="BDC/786/MHI/44"
              className={`${input} font-mono`}
            />
            <span className="mt-1 block text-[10px] leading-relaxed text-biome-muted/70">
              {referenceNo.trim() === ""
                ? "Leave this blank and the document stays in review — a reference is what puts it in a supply folder."
                : refLooksRight
                  ? "Looks right."
                  : "Expected four parts, like BDC/786/MHI/44."}
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-biome-muted">Client</span>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                list="known-clients"
                placeholder="Jhajjar Power Limited"
                className={input}
              />
              <datalist id="known-clients">
                {clients.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10.5px] text-biome-muted">
                Date {isOurs && <span className="text-biome-bolt">(sets the folder)</span>}
              </span>
              <input
                type="date"
                value={documentDate?.slice(0, 10) ?? ""}
                onChange={(e) => setDocumentDate(e.target.value)}
                className={input}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10.5px] text-biome-muted">Vehicle number</span>
              <input
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                placeholder="UP22AT1505"
                className={`${input} font-mono`}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10.5px] text-biome-muted">
                {isOurs ? "Our document no" : "Vendor document no"}
              </span>
              <input
                value={isOurs ? biomeDocNo : vendorDocNo}
                onChange={(e) =>
                  isOurs ? setBiomeDocNo(e.target.value) : setVendorDocNo(e.target.value)
                }
                placeholder={isOurs ? "BI26-27-HR0786" : "46"}
                className={`${input} font-mono`}
              />
            </label>
          </div>

          {isOurs && documentDate && (
            <p className="rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-3 py-2 text-[11px] leading-relaxed text-biome-bolt/90">
              This is one of our documents, so its date decides the folder for the whole supply. Any
              vendor papers already filed under a different date will be moved in behind it.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <PremiumButton variant="ghost" onClick={onClose}>
            Cancel
          </PremiumButton>
          <PremiumButton onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            File it
          </PremiumButton>
        </div>
      </motion.div>
    </motion.div></Portal>
  );
}
