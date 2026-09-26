"use client";

import { Loader2, CheckCircle2, AlertCircle, Clock, FileText, X } from "lucide-react";
import type { QueuedDoc } from "./types";

export default function DocumentQueue({
  docs,
  activeId,
  onSelect,
  onRemove,
}: {
  docs: QueuedDoc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!docs.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-biome-muted">
        No documents yet — drop some above to get started.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {docs.map((doc) => {
        const active = doc.id === activeId;
        return (
          <button
            key={doc.id}
            onClick={() => onSelect(doc.id)}
            className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              active
                ? "border-biome-leaf/40 bg-biome-leaf/10"
                : "border-transparent hover:bg-biome-hover"
            }`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-biome-hover">
              {doc.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={doc.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-biome-muted">
                  <FileText size={16} />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-biome-text">{doc.file.name}</p>
              <StatusLine doc={doc} />
            </div>

            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(doc.id);
              }}
              className="shrink-0 rounded-full p-1 text-biome-muted opacity-0 transition-opacity hover:text-biome-text group-hover:opacity-100"
            >
              <X size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatusLine({ doc }: { doc: QueuedDoc }) {
  if (doc.status === "queued") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-biome-muted">
        <Clock size={11} /> Queued
      </p>
    );
  }
  if (doc.status === "processing") {
    return (
      <p className="flex items-center gap-1 truncate text-[11px] text-biome-skyBright">
        <Loader2 size={11} className="shrink-0 animate-spin" />
        <span className="truncate">{doc.progressLabel || "Reading…"}</span>
      </p>
    );
  }
  if (doc.status === "error") {
    return (
      <p className="flex items-center gap-1 text-[11px] text-biome-bolt">
        <AlertCircle size={11} /> {doc.error || "Failed"}
      </p>
    );
  }
  const conf = doc.result?.confidence ?? 0;
  const color =
    conf >= 80 ? "text-biome-leafBright" : conf >= 60 ? "text-biome-bolt" : "text-red-400";
  return (
    <p className={`flex items-center gap-1 text-[11px] ${color}`}>
      <CheckCircle2 size={11} /> {conf.toFixed(0)}% confidence
    </p>
  );
}
