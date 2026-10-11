"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X, Loader2, CheckCircle2, Eye, FileCheck2 } from "lucide-react";
import Portal from "@/components/Portal";
import { REQUIREMENTS, REQUIREMENT_KEYS } from "@/lib/whatsapp";

/**
 * "Edit requirement documents" — which papers a client wants with every
 * supply, and which of them must carry a Digital Signature Certificate.
 *
 * Built to always open, whatever the stored record looks like: a legacy
 * client with no `requires` / `dscOn` arrays (or none at all) opens with
 * nothing ticked instead of crashing the button. The dialog scrolls inside
 * itself with a header and footer that stay put, and closes with the X,
 * the Escape key, a click on the backdrop, or Cancel.
 *
 * `readOnly` is the coordinator's view — the server refuses their edits
 * anyway (permission "customers.requirements"); the screen only mirrors it.
 */
export interface RequirementsValue {
  requires: string[];
  dscOn: string[];
  requirementNotes: string;
}

export function requirementsOf(p: any): RequirementsValue {
  const list = (v: any): string[] => (Array.isArray(v) ? v.map(String).filter((k) => REQUIREMENT_KEYS.includes(k)) : []);
  const requires = Array.from(new Set(list(p?.requires)));
  return {
    requires,
    dscOn: Array.from(new Set(list(p?.dscOn))).filter((k) => requires.includes(k)),
    requirementNotes: String(p?.requirementNotes ?? p?.notes ?? ""),
  };
}

export default function RequirementsModal({
  clientName,
  value,
  readOnly,
  onClose,
  onSave,
}: {
  clientName: string;
  value: RequirementsValue;
  readOnly: boolean;
  onClose: () => void;
  onSave?: (v: RequirementsValue) => Promise<void>;
}) {
  const [form, setForm] = useState<RequirementsValue>(() => requirementsOf(value));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Escape closes; the page behind does not scroll while the dialog is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  function toggle(list: "requires" | "dscOn", key: string) {
    if (readOnly) return;
    setForm((f) => {
      const has = f[list].includes(key);
      const next = has ? f[list].filter((k) => k !== key) : [...f[list], key];
      // Unticking a required document also drops its DSC rule.
      if (list === "requires" && has) return { ...f, requires: next, dscOn: f.dscOn.filter((k) => k !== key) };
      return { ...f, [list]: next };
    });
  }

  async function save() {
    if (!onSave) return;
    setSaving(true); setErr(null);
    try { await onSave(form); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Portal>
      <div
        data-testid="req-modal-backdrop"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Document requirements — ${clientName}`}
          data-testid="req-modal"
          className="flex max-h-[min(88vh,820px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft shadow-2xl"
        >
          {/* Sticky header */}
          <div className="flex shrink-0 items-start gap-3 border-b border-biome-line bg-biome-bgSoft px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-biome-leaf/12 text-biome-leaf">
              <FileCheck2 size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">
                {readOnly ? "Document requirements · view only" : "Edit requirement documents"}
              </p>
              <h3 className="truncate text-[14px] font-semibold text-biome-text">{clientName || "New client"}</h3>
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              data-testid="req-modal-close"
              className="rounded-lg border border-biome-line p-1.5 text-biome-muted hover:bg-biome-hover hover:text-biome-text"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrolling body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="req-modal-body">
            {readOnly ? (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/[.07] px-3 py-2 text-[11px] leading-relaxed text-biome-text">
                <Eye size={13} className="mt-px shrink-0 text-sky-500" />
                Only accounts, the admin or the developer can change these. Ask them if this client&apos;s papers have changed.
              </p>
            ) : (
              <p className="mb-3 text-[11px] leading-relaxed text-biome-muted">
                Tick every document this client requires with a supply. Tick DSC as well where that document must carry a
                Digital Signature Certificate. The WhatsApp agent checks each supply set against this list.
              </p>
            )}
            <div className="space-y-1.5">
              {REQUIREMENT_KEYS.map((key) => {
                const required = form.requires.includes(key);
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                      required ? "border-biome-leaf/35 bg-biome-leaf/[0.08]" : "border-biome-line bg-biome-bg"
                    }`}
                  >
                    <label className={`flex flex-1 items-center gap-2.5 ${readOnly ? "" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        checked={required}
                        disabled={readOnly}
                        onChange={() => toggle("requires", key)}
                        data-testid={`req-${key}`}
                        className="h-3.5 w-3.5 accent-[#4c9a2a]"
                      />
                      <span className={`text-[11.5px] ${required ? "font-semibold text-biome-text" : "text-biome-muted"}`}>
                        {REQUIREMENTS[key]}
                      </span>
                    </label>
                    {/* Driver mobile is a phone number, not a document — no signature. */}
                    {required && key !== "driver_mobile" && (
                      <label className={`flex items-center gap-1.5 ${readOnly ? "" : "cursor-pointer"}`} title="Must carry a Digital Signature Certificate">
                        <input
                          type="checkbox"
                          checked={form.dscOn.includes(key)}
                          disabled={readOnly}
                          onChange={() => toggle("dscOn", key)}
                          className="h-3.5 w-3.5 accent-[#d4a017]"
                        />
                        <ShieldCheck size={12} className={form.dscOn.includes(key) ? "text-amber-500" : "text-biome-muted"} />
                        <span className="text-[10px] font-semibold text-biome-muted">DSC</span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Note shown to coordinators</span>
              <textarea
                value={form.requirementNotes}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, requirementNotes: e.target.value }))}
                rows={3}
                placeholder="DSC must be attached to both documents."
                className="w-full resize-y rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none disabled:opacity-80"
              />
            </label>
          </div>

          {/* Sticky footer */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-biome-line bg-biome-bgSoft px-5 py-3">
            {err && <p className="mr-auto text-[11px] font-semibold text-rose-500">{err}</p>}
            {!readOnly && !err && (
              <p className="mr-auto text-[10.5px] text-biome-muted">
                {form.requires.length} required{form.dscOn.length ? ` · ${form.dscOn.length} with DSC` : ""}
              </p>
            )}
            <button
              onClick={onClose}
              disabled={saving}
              data-testid="req-modal-cancel"
              className="rounded-xl border border-biome-line px-4 py-2 text-[11.5px] font-semibold text-biome-muted hover:bg-biome-hover"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button
                onClick={save}
                disabled={saving || form.requires.length === 0}
                title={form.requires.length === 0 ? "Tick at least one document" : undefined}
                data-testid="req-modal-save"
                className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save requirements
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
