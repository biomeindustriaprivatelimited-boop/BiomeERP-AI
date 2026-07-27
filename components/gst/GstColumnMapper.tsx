"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { GST_FIELDS, GstColumnMapping, GstFieldKey } from "@/lib/gst";

export default function GstColumnMapper({
  title,
  headers,
  mapping,
  onChange,
}: {
  title: string;
  headers: string[];
  mapping: GstColumnMapping;
  onChange: (next: GstColumnMapping) => void;
}) {
  return (
    <div>
      <p className="mb-3 font-display text-sm font-medium text-biome-text">{title}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {GST_FIELDS.map((field) => {
          const value = mapping[field.key] ?? "";
          const detected = Boolean(value);
          return (
            <div key={field.key} className="flex items-center gap-2">
              <div className="flex w-[110px] shrink-0 items-center gap-1.5 text-xs text-biome-muted">
                {detected ? (
                  <CheckCircle2 size={13} className="shrink-0 text-biome-leafBright" />
                ) : (
                  <Circle size={13} className="shrink-0 opacity-30" />
                )}
                <span className="truncate">{field.label}</span>
              </div>
              <select
                value={value ?? ""}
                onChange={(e) =>
                  onChange({ ...mapping, [field.key as GstFieldKey]: e.target.value || null })
                }
                className="w-full flex-1 rounded-lg border border-biome-line bg-white/5 px-2.5 py-1.5 text-xs text-biome-text outline-none focus:border-biome-leaf"
              >
                <option value="" className="bg-biome-bgSoft">
                  — Not mapped —
                </option>
                {headers.map((h) => (
                  <option key={h} value={h} className="bg-biome-bgSoft">
                    {h}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
