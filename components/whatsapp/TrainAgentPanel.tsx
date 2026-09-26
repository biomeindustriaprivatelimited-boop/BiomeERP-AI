"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, Upload, Loader2, Trash2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * "Agent ko documents dikha kar samjhao" — literally.
 *
 * Upload a real supply document, say what it is, and the agent stores
 * its text fingerprint as an exemplar. From then on, every arriving
 * document is compared against these labelled samples — a strong match
 * to something a person labelled beats keyword guessing.
 *
 * This sits on top of two other layers that decide first when they can:
 * the deterministic header rules (built from the company's own document
 * formats) and the coordinator's filename. Exemplars carry the cases
 * those can't: unusual layouts, new vendors' paper, bad scans that
 * still share their wording with a labelled sample.
 */

const TYPES: { id: string; label: string }[] = [
  { id: "biome_tax_invoice", label: "Biome Tax Invoice" },
  { id: "biome_delivery_challan", label: "Biome Delivery Challan / Note" },
  { id: "biome_eway_bill", label: "Biome E-way Bill" },
  { id: "vendor_tax_invoice", label: "Vendor Tax Invoice" },
  { id: "vendor_delivery_challan", label: "Vendor Delivery Challan" },
  { id: "vendor_eway_bill", label: "Vendor E-way Bill" },
  { id: "bilty_lr", label: "Bilty / Bill T / LR" },
  { id: "weight_slip", label: "Weight Slip" },
  { id: "consignment_tag", label: "Consignment Tag" },
  { id: "receiving", label: "Receiving (client weight slip)" },
  { id: "lab_report", label: "Lab Report" },
  { id: "coa", label: "COA (Certificate of Analysis)" },
];

interface Sample {
  id: string;
  documentType: string;
  label: string;
  fileName: string;
  addedAt: string;
  tokenCount: number;
}

export default function TrainAgentPanel() {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [docType, setDocType] = useState(TYPES[0].id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/samples", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setSamples(Array.isArray(json.samples) ? json.samples : []);
    } catch {
      setSamples([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    let added = 0;
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const fileBase64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.onerror = () => reject(new Error("read failed"));
          r.readAsDataURL(file);
        });
        const res = await fetch("/api/whatsapp/samples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileBase64, fileName: file.name, mimeType: file.type, documentType: docType }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Could not learn "${file.name}".`);
        added += 1;
      }
      setMsg({ kind: "ok", text: `Learned ${added} sample${added === 1 ? "" : "s"} as "${TYPES.find((t) => t.id === docType)?.label}".` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/whatsapp/samples?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      /* the list refresh will tell the truth */
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <GraduationCap size={16} className="text-biome-leafBright" />
        <h2 className="font-display text-sm font-medium text-biome-text">Train the agent with real documents</h2>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-biome-muted">
        Upload a real supply document and tell the agent what it is. It remembers the document&rsquo;s
        wording as a labelled sample, and every future arrival is checked against these before it is
        guessed at. Two or three samples per type — especially for each vendor&rsquo;s invoice format —
        make a visible difference.
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[11.5px] text-biome-text outline-none"
        >
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="bmx-spin" /> : <Upload size={13} />}
          Upload &amp; teach
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] ${
          msg.kind === "ok"
            ? "border-emerald-500/30 bg-emerald-500/[.07] text-emerald-600"
            : "border-rose-500/30 bg-rose-500/[.07] text-rose-500"
        }`}>
          {msg.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />} {msg.text}
        </p>
      )}

      {samples && samples.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">
            {samples.length} labelled sample{samples.length === 1 ? "" : "s"}
          </p>
          {samples.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
              <FileText size={13} className="shrink-0 text-biome-muted" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-biome-text">{s.fileName}</span>
              <span className="shrink-0 rounded-full border border-biome-leaf/30 bg-biome-leaf/[.08] px-2 py-0.5 text-[9.5px] font-semibold text-biome-leafBright">
                {TYPES.find((t) => t.id === s.documentType)?.label || s.documentType}
              </span>
              <button onClick={() => remove(s.id)} className="bmx-chip shrink-0 rounded-lg border border-biome-line p-1.5 text-rose-500" aria-label="Remove sample">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
