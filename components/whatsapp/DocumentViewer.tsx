"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import Portal from "@/components/Portal";
import { DOC_TYPE_LABEL, type WhatsappDocument } from "@/lib/whatsapp";

/**
 * Full-page viewer for one WhatsApp document.
 *
 * PDF pages are drawn by the agent (MuPDF) and shown as images, so every
 * PDF looks the same on every PC — no browser PDF plug-in needed. Photos
 * are shown as they are. Zoom, page-by-page navigation, download and
 * "open the original" are all here; Esc or the backdrop closes it.
 */
export default function DocumentViewer({
  doc,
  onClose,
  startPage = 1,
}: {
  doc: WhatsappDocument;
  onClose: () => void;
  startPage?: number;
}) {
  const [pages, setPages] = useState<number>(1);
  const [page, setPage] = useState(startPage);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [renderable, setRenderable] = useState(true);

  const id = encodeURIComponent(doc.id);
  const fileUrl = `/api/whatsapp/file?id=${id}`;
  const type = doc.extracted?.documentType;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/whatsapp/preview-info?id=${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setFailed(j.error || `The document could not be opened (${r.status}).`);
          setLoading(false);
          return;
        }
        setPages(Math.max(1, Number(j.pages) || 1));
        setRenderable(j.renderable !== false);
      })
      .catch(() => !cancelled && setFailed("The WhatsApp agent did not answer."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage((p) => Math.min(pages, p + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPage((p) => Math.max(1, p - 1));
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
      if (e.key === "-") setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pages]);

  useEffect(() => setLoading(true), [page, zoom]);

  // The agent draws the page at the size it will be shown (capped), so
  // zooming in stays sharp instead of blowing up a thumbnail.
  const drawWidth = Math.min(2600, Math.round(1400 * zoom));
  const src = renderable ? `/api/whatsapp/preview?id=${id}&page=${page}&width=${drawWidth}` : fileUrl;

  return (
    <Portal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={`Document: ${doc.originalName}`}
        data-testid="doc-viewer"
      >
        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-biome-bgSoft px-3 py-2 text-biome-text sm:px-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold" title={doc.originalName}>
              {type ? DOC_TYPE_LABEL[type] : "Document"}
              <span className="ml-2 font-normal text-biome-muted">{doc.originalName}</span>
            </p>
            {doc.reference?.canonical && (
              <p className="font-mono text-[10.5px] text-biome-leafBright">{doc.reference.canonical}</p>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-biome-line bg-biome-hover px-1 py-0.5">
            <ToolButton label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={15} />
            </ToolButton>
            <span className="min-w-[78px] text-center text-[11px] tabular-nums" data-testid="viewer-page">
              Page {page} of {pages}
            </span>
            <ToolButton label="Next page" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              <ChevronRight size={15} />
            </ToolButton>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-biome-line bg-biome-hover px-1 py-0.5">
            <ToolButton label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
              <ZoomOut size={15} />
            </ToolButton>
            <span className="min-w-[44px] text-center text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
            <ToolButton label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>
              <ZoomIn size={15} />
            </ToolButton>
            <ToolButton label="Fit to screen" onClick={() => setZoom(1)}>
              <Maximize2 size={14} />
            </ToolButton>
          </div>

          <a
            href={`${fileUrl}&download=1`}
            className="flex items-center gap-1.5 rounded-xl border border-biome-line bg-biome-hover px-2.5 py-1.5 text-[11px] font-medium hover:text-biome-leafBright"
            title="Save a copy of the original file"
          >
            <Download size={13} /> Download
          </a>
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-biome-line bg-biome-hover px-2.5 py-1.5 text-[11px] font-medium hover:text-biome-leafBright"
            title="Open the original file in a new window"
          >
            <ExternalLink size={13} /> Original
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="viewer-close"
            className="rounded-xl border border-biome-line bg-biome-hover p-1.5 hover:text-rose-400"
          >
            <X size={15} />
          </button>
        </div>

        {/* Page */}
        <div className="relative flex-1 overflow-auto p-3 sm:p-6" onClick={onClose}>
          {failed ? (
            <div className="mx-auto mt-16 flex max-w-md items-start gap-2 rounded-2xl border border-rose-400/30 bg-biome-bgSoft p-4 text-[12px] text-biome-text">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-400" />
              <span>{failed}</span>
            </div>
          ) : (
            <div className="mx-auto" style={{ width: `${Math.round(100 * zoom)}%`, maxWidth: zoom <= 1 ? 1000 : undefined }}>
              {loading && (
                <div className="pointer-events-none absolute left-1/2 top-10 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-biome-bgSoft px-3 py-1.5 text-[11px] text-biome-muted shadow">
                  <Loader2 size={13} className="animate-spin" /> Loading page…
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={src}
                src={src}
                alt={`${doc.originalName} — page ${page}`}
                data-testid="viewer-image"
                onClick={(e) => e.stopPropagation()}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setFailed("This page could not be drawn. Use Download or Original to open the file itself.");
                }}
                className="mx-auto block h-auto w-full rounded-md bg-white shadow-2xl"
              />
            </div>
          )}
        </div>
      </motion.div>
    </Portal>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1 text-biome-text transition-colors hover:bg-biome-bgSoft hover:text-biome-leafBright disabled:opacity-35"
    >
      {children}
    </button>
  );
}
