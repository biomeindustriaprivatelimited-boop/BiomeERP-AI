"use client";

import { AlertTriangle, FileText, Image as ImageIcon } from "lucide-react";
import { DOC_TYPE_LABEL, type SupplySet, type WhatsappDocument } from "@/lib/whatsapp";
import { NeedsCheckActions } from "./SetVerify";

/**
 * Every paper a person should look at, in one place: placed in a set
 * without a printed match, or held because it names a set that is final.
 * Each row has the quick actions (belongs here / move / assign).
 */
export default function NeedsCheckPanel({
  docs,
  sets,
  onChanged,
  onOpenSet,
}: {
  docs: WhatsappDocument[];
  sets: SupplySet[];
  onChanged?: () => void;
  onOpenSet?: (reference: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[.06] p-4" data-testid="needs-check-panel">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-800 dark:text-amber-200">
        <AlertTriangle size={14} /> Needs check — {docs.length} paper{docs.length === 1 ? "" : "s"}
      </p>
      <p className="mt-0.5 text-[11px] text-biome-muted">
        Placed without a printed match, or naming a set that is already final. Confirm where each belongs.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {docs.map((d) => {
          const type = d.extracted?.documentType;
          const ref = d.bucket === "filed" ? d.reference?.canonical || null : null;
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-biome-line bg-biome-bgSoft px-3 py-2" data-testid="needs-check-row">
              {d.mimeType?.startsWith("image/") ? <ImageIcon size={13} className="text-biome-muted" /> : <FileText size={13} className="text-biome-muted" />}
              <span className="text-[11px] font-semibold text-biome-text">{type ? DOC_TYPE_LABEL[type] || type : "Unclassified"}</span>
              <span className="max-w-[200px] truncate text-[11px] text-biome-muted" title={d.originalName}>
                {d.originalName}
              </span>
              {ref ? (
                <button type="button" onClick={() => onOpenSet?.(ref)} className="font-mono text-[11px] text-biome-leafBright hover:underline">
                  in {ref}
                </button>
              ) : (
                <span className="text-[11px] text-biome-muted">{d.heldForFinal ? `held — ${d.heldForFinal} is final` : "not in a set"}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-amber-700 dark:text-amber-300" title={d.needsCheckReason || ""}>
                {d.needsCheckReason}
              </span>
              <NeedsCheckActions doc={d} sets={sets} currentRef={ref} onChanged={onChanged} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
