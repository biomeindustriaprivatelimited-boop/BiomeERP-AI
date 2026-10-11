"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/** Shared look for the spare parts & machinery screens (theme tokens only, so all five themes read). */
export const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
export const inr2 = (n: number) => "₹" + (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
export const inline = "bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
export const label = "mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted";
export const card = "rounded-2xl border border-biome-line bg-biome-bgSoft p-4";
export const th = "border-b border-biome-line text-[9.5px] uppercase tracking-[.12em] text-biome-muted";
export const btn = "bmx-btn inline-flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-60";
export const chip = "bmx-chip inline-flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted";
export const today = () => new Date().toISOString().slice(0, 10);

export type Post = (url: string, body: any) => Promise<any | null>;

export function Tile({ label: l, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: string; tone?: "warn" | "bad" | "good"; onClick?: () => void }) {
  const ring = tone === "bad" ? "border-rose-500/35 bg-rose-500/[.06]" : tone === "warn" ? "border-amber-500/35 bg-amber-500/[.06]" : "border-biome-line bg-biome-bgSoft";
  const val = tone === "bad" ? "text-rose-500" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-biome-text";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`bmx-card rounded-2xl border p-4 text-left transition ${ring} ${onClick ? "cursor-pointer hover:border-biome-leaf/50" : "cursor-default"}`}>
      <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{l}</p>
      <p className={`mt-1 font-mono text-[19px] font-semibold ${val}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10.5px] text-biome-muted">{sub}</p>}
    </button>
  );
}

const BADGE: Record<string, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  amber: "border-amber-500/35 bg-amber-500/10 text-amber-600",
  red: "border-rose-500/35 bg-rose-500/10 text-rose-500",
  blue: "border-sky-500/35 bg-sky-500/10 text-sky-600",
  grey: "border-biome-line bg-biome-bg text-biome-muted",
  violet: "border-violet-500/35 bg-violet-500/10 text-violet-500",
};

export function Badge({ tone = "grey", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.08em] ${BADGE[tone]}`}>{children}</span>;
}

export const PO_TONE: Record<string, keyof typeof BADGE> = { draft: "grey", issued: "blue", partial: "amber", received: "green", closed: "violet", cancelled: "red" };
export const INDENT_TONE: Record<string, keyof typeof BADGE> = { open: "amber", approved: "blue", ordered: "blue", partial: "amber", received: "green", rejected: "red", withdrawn: "grey" };
export const URGENCY_TONE: Record<string, keyof typeof BADGE> = { normal: "grey", urgent: "amber", breakdown: "red" };
export const FLAG_TONE: Record<string, keyof typeof BADGE> = { ok: "green", short: "amber", excess: "violet", rate: "blue", damaged: "red" };
export const FLAG_LABEL: Record<string, string> = { ok: "Matches", short: "Short", excess: "Excess", rate: "Rate differs", damaged: "Damaged" };

export function Msg({ err, ok }: { err: string | null; ok: string | null }) {
  return (
    <>
      {err && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[.08] px-3 py-2 text-[11.5px] text-biome-text"><AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />{err}</p>}
      {ok && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[.08] px-3 py-2 text-[11.5px] font-semibold text-emerald-600"><CheckCircle2 size={14} className="mt-px shrink-0" />{ok}</p>}
    </>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-biome-line px-3 py-4 text-center text-[11.5px] text-biome-muted">{children}</p>;
}

export function SectionTitle({ icon: Icon, title, sub, right }: { icon?: any; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-biome-text">{Icon && <Icon size={14} className="text-biome-leaf" />}{title}</h2>
        {sub && <p className="mt-0.5 text-[11px] text-biome-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export async function toExcel(name: string, rows: Record<string, any>[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, `${name}-${today()}.xlsx`);
}

/** Add a bill / parchi / photo to an existing stock document or GRN. */
export function AttachButton({ no, onDone, text = "+" }: { no: string; onDone: () => void; text?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <label title="Attach invoice / challan / photo" className="cursor-pointer text-[10.5px] font-semibold text-biome-leaf">
      {busy ? "…" : text}
      <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={async (e) => {
        const files = Array.from(e.target.files || []); if (!files.length) return;
        setBusy(true);
        const fd = new FormData(); fd.append("no", no); files.forEach((f) => fd.append("file", f));
        const r = await fetch("/api/stock/attachment", { method: "POST", body: fd }).catch(() => null);
        setBusy(false); e.target.value = "";
        if (r?.ok) onDone(); else alert((await r?.json().catch(() => ({})))?.error || "Could not attach.");
      }} />
    </label>
  );
}

export function Attachments({ list, no }: { list: any[] | undefined; no: string }) {
  if (!list?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((a) => (
        <a key={a.id} href={`/api/stock/attachment?no=${encodeURIComponent(no)}&id=${a.id}`} target="_blank" rel="noreferrer" title={a.name}
          className="rounded-md border border-biome-line px-1.5 py-0.5 text-[10px] text-biome-leaf hover:underline">📎 {a.name.slice(0, 18)}</a>
      ))}
    </span>
  );
}
