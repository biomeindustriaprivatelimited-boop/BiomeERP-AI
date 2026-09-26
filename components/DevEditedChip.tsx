import { Wrench } from "lucide-react";

/** The highlight the business asked for: a developer rewrote this entry. */
export default function DevEditedChip({ mark, compact = false }: { mark?: { by: string; at: string; fields: string[]; note?: string } | null; compact?: boolean }) {
  if (!mark) return null;
  return (
    <span title={`Edited by ${mark.by} on ${new Date(mark.at).toLocaleString("en-IN")} · ${mark.fields.join(", ")}${mark.note ? ` · ${mark.note}` : ""}`}
      className="normal-case inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-amber-600">
      <Wrench size={9} /> {compact ? "Dev" : "Developer edited"}
    </span>
  );
}
