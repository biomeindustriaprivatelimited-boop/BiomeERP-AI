"use client";

import { useCallback, useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { motion } from "framer-motion";
import { X, Loader2, RefreshCw, Hand, HelpCircle, ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import PremiumButton from "@/components/ui/PremiumButton";
import type { WhatsappDocument } from "@/lib/whatsapp";

interface Why {
  id: string;
  originalName: string;
  receivedAt: string;
  sender: { name: string | null; chatJid: string } | null;
  caption: string | null;
  bucket: string;
  status: string;
  waitingFor: string | null;
  side: string | null;
  read: string[];
  reasons: string[];
  fields: Record<string, string | number | null>;
  candidates: { reference: string; score: number; reasons: string[]; vehicleNo: string | null; date: string | null }[];
  transcription: string;
}

/**
 * "Why?" — everything the agent decided about one document, in plain words:
 * what it read (OCR text, corrections, AI result), what type it decided and
 * why, whose paper it is, the fields it found, which supply sets it could
 * belong to, and why it is still waiting. With Re-process and the manual
 * "Assign / set type" (which the agent learns from).
 */
export default function WhyPanel({
  doc,
  onClose,
  onAssign,
  onChanged,
}: {
  doc: WhatsappDocument;
  onClose: () => void;
  onAssign?: (doc: WhatsappDocument) => void;
  onChanged?: () => void;
}) {
  const [why, setWhy] = useState<Why | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/why?id=${encodeURIComponent(doc.id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Could not load (${res.status}).`);
      setWhy(json);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [doc.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function reprocess() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Re-process failed (${res.status}).`);
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fields = why ? Object.entries(why.fields).filter(([, v]) => v != null && v !== "") : [];
  const missing = why ? Object.entries(why.fields).filter(([, v]) => v == null || v === "").map(([k]) => k) : [];

  return (
    <Portal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.97, y: 8 }}
          animate={{ scale: 1, y: 0 }}
          onClick={(e: any) => e.stopPropagation()}
          data-testid="why-panel"
          className="glass flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft"
        >
          <div className="flex items-start gap-3 border-b border-biome-line px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-biome-hover text-biome-leafBright">
              <HelpCircle size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[15px] font-semibold text-biome-text">Why? — what happened to this document</h3>
              <p className="truncate text-[11px] text-biome-muted" title={doc.originalName}>
                {doc.originalName}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-biome-muted hover:text-biome-text">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[12px] text-biome-text">
            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-600 dark:text-rose-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
            {!why && !error && (
              <p className="flex items-center gap-2 text-biome-muted">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            )}
            {why && (
              <>
                <section className="rounded-xl border border-biome-line bg-biome-hover px-4 py-3" data-testid="why-status">
                  <p className="font-semibold">{why.status || "No decision recorded."}</p>
                  {why.waitingFor && <p className="mt-1 text-[11.5px] text-biome-muted">Waiting for: {why.waitingFor}</p>}
                  <p className="mt-1 text-[11px] text-biome-muted">
                    From {why.sender?.name || why.sender?.chatJid || "unknown"} · {new Date(why.receivedAt).toLocaleString("en-IN")}
                    {why.caption ? ` · caption: “${why.caption}”` : ""}
                  </p>
                </section>

                <Block title="1. Reading">
                  {why.read.length ? why.read.map((r, i) => <Line key={i} text={r} />) : <Line text="No reading details were recorded." />}
                </Block>

                <Block title="2. Decision">
                  {why.reasons.length ? why.reasons.map((r, i) => <Line key={i} text={r} />) : <Line text="No reasons were recorded." />}
                </Block>

                <Block title="3. What was found on the page">
                  {fields.length ? (
                    <table className="w-full text-[11.5px]">
                      <tbody>
                        {fields.map(([k, v]) => (
                          <tr key={k} className="border-b border-biome-line/50 last:border-0">
                            <td className="py-1 pr-3 align-top text-biome-muted">{k}</td>
                            <td className="py-1 font-mono">{String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Line text="Nothing usable was found." />
                  )}
                  {missing.length > 0 && <p className="mt-2 text-[11px] text-biome-muted">Not found: {missing.join(", ")}.</p>}
                </Block>

                <Block title="4. Supply sets it could belong to">
                  {why.candidates.length ? (
                    <ul className="space-y-1.5">
                      {why.candidates.map((c) => (
                        <li key={c.reference} className="rounded-lg border border-biome-line/60 px-3 py-2">
                          <span className="font-mono font-semibold">{c.reference}</span>
                          <span className={`ml-2 rounded-full px-1.5 text-[10px] ${c.score >= 45 ? "bg-[#9fe870]/30" : "bg-biome-hover"}`}>score {c.score}</span>
                          <p className="mt-0.5 text-[11px] text-biome-muted">{c.reasons.join(" · ") || "—"}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Line text="No filed supply set shares a vehicle, our invoice no., e-way bill no., LR no. or weight with this paper. Score 45 or more is needed to join a set automatically." />
                  )}
                </Block>

                <div>
                  <button type="button" onClick={() => setShowText((v) => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-biome-muted hover:text-biome-text">
                    <ChevronDown size={13} className={showText ? "rotate-180" : ""} /> Text read from the document ({why.transcription.length} characters)
                  </button>
                  {showText && (
                    <pre data-testid="why-text" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-biome-line bg-biome-hover p-3 font-mono text-[10.5px] leading-relaxed text-biome-text">
                      {why.transcription || "(no text)"}
                    </pre>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-biome-line px-5 py-3">
            <PremiumButton variant="ghost" onClick={reprocess} disabled={busy} data-testid="why-reprocess">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {busy ? "Reading again…" : "Re-process"}
            </PremiumButton>
            {onAssign && (
              <PremiumButton onClick={() => onAssign(doc)}>
                <Hand size={13} /> Assign to supply set / set type
              </PremiumButton>
            )}
          </div>
        </motion.div>
      </motion.div>
    </Portal>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.12em] text-biome-muted">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Line({ text }: { text: string }) {
  const bad = /FAILED|failed|rejected|could not|Almost no text|used up/i.test(text);
  return (
    <p className="flex items-start gap-2 text-[11.5px] leading-relaxed">
      {bad ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-biome-leafBright" />}
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}
