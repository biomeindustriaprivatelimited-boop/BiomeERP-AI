"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  QrCode,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Unplug,
  Smartphone,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import type { AgentState } from "@/lib/whatsapp";

interface Props {
  state: AgentState | null;
  loadError: string | null;
  onConnect: () => void;
  onDisconnect: (forget: boolean) => void;
  busy: boolean;
}

const STATUS_META: Record<
  string,
  { label: string; tone: "good" | "warn" | "bad" | "idle"; detail: string }
> = {
  connected: {
    label: "Watching",
    tone: "good",
    detail: "Every document that arrives is being downloaded, read and filed.",
  },
  qr: {
    label: "Waiting for scan",
    tone: "warn",
    detail: "Scan the code below with the phone that holds the company WhatsApp account.",
  },
  connecting: { label: "Connecting", tone: "warn", detail: "Reaching WhatsApp…" },
  disconnected: { label: "Not connected", tone: "idle", detail: "No WhatsApp account is linked yet." },
  logged_out: {
    label: "Unlinked",
    tone: "bad",
    detail: "This device was removed from WhatsApp on the phone. Link it again to resume.",
  },
  error: { label: "Problem", tone: "bad", detail: "Something went wrong." },
  unavailable: { label: "Agent not running", tone: "bad", detail: "The background service isn't up." },
};

const TONE_CLASS = {
  good: "border-biome-leaf/30 bg-biome-leaf/10 text-biome-leafBright",
  warn: "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  bad: "border-red-400/30 bg-red-400/10 text-red-300",
  idle: "border-biome-line bg-white/5 text-biome-muted",
};

export default function ConnectionPanel({ state, loadError, onConnect, onDisconnect, busy }: Props) {
  const [confirmForget, setConfirmForget] = useState(false);
  const status = loadError ? "unavailable" : state?.status || "disconnected";
  const meta = STATUS_META[status] || STATUS_META.disconnected;
  const isLinked = status === "connected";

  return (
    <GlassCard activeBorder={isLinked} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-biome-leaf/12">
            {isLinked && (
              <motion.span
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-xl bg-biome-leaf/50 blur-md"
              />
            )}
            <Smartphone size={19} className="relative text-biome-leafBright" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-biome-text">WhatsApp account</h2>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-biome-muted">{meta.detail}</p>
            {state?.me?.name && (
              <p className="mt-1 font-mono text-[11px] text-biome-leafBright">
                {state.me.name} · {state.me.id.split(":")[0]}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium ${TONE_CLASS[meta.tone]}`}
          >
            {status === "connecting" || status === "qr" ? (
              <Loader2 size={11} className="animate-spin" />
            ) : meta.tone === "good" ? (
              <CheckCircle2 size={11} />
            ) : meta.tone === "bad" ? (
              <AlertTriangle size={11} />
            ) : (
              <Unplug size={11} />
            )}
            {meta.label}
          </span>

          {!isLinked && status !== "qr" && (
            <PremiumButton onClick={onConnect} disabled={busy || Boolean(loadError)}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
              Link WhatsApp
            </PremiumButton>
          )}

          {(isLinked || status === "qr") && (
            <>
              <PremiumButton variant="ghost" onClick={() => onDisconnect(false)} disabled={busy}>
                <Unplug size={13} /> Pause
              </PremiumButton>
              <PremiumButton
                variant="ghost"
                onClick={() => (confirmForget ? onDisconnect(true) : setConfirmForget(true))}
                disabled={busy}
                className={confirmForget ? "border-red-400/40 text-red-300" : ""}
              >
                {confirmForget ? "Confirm unlink" : "Unlink"}
              </PremiumButton>
            </>
          )}
        </div>
      </div>

      {confirmForget && (
        <p className="mt-3 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2 text-[11px] text-red-200">
          Unlinking signs this PC out of WhatsApp and deletes the saved session. Documents already filed
          stay on disk. You&apos;ll need to scan the QR code again to resume. Click &ldquo;Confirm
          unlink&rdquo; to go ahead.
        </p>
      )}

      {/* ---- QR code ---- */}
      <AnimatePresence>
        {status === "qr" && state?.qrDataUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-5 flex flex-col items-start gap-6 border-t border-biome-line pt-5 md:flex-row">
              <div className="rounded-2xl bg-white p-3 shadow-glow">
                {/* A freshly-generated base64 QR that changes every few seconds —
                    next/image's optimiser has nothing to contribute here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.qrDataUrl}
                  alt="WhatsApp pairing QR code"
                  width={220}
                  height={220}
                  className="h-[220px] w-[220px]"
                />
              </div>
              <ol className="flex-1 space-y-2.5 text-xs text-biome-muted">
                {[
                  "Open WhatsApp on the phone that holds the company account.",
                  "Tap the menu, then Linked devices.",
                  "Tap Link a device.",
                  "Point the phone at this code.",
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-biome-leaf/30 bg-biome-leaf/10 font-mono text-[9.5px] text-biome-leafBright">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
                <li className="pt-1 text-[11px] leading-relaxed text-biome-muted/70">
                  The code refreshes every few seconds on its own — you don&apos;t need to do anything
                  when it changes. The phone stays fully usable afterwards; this links a device rather
                  than moving the account.
                </li>
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Problems ---- */}
      {(loadError || state?.lastError) && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-300" />
          <p className="text-[11.5px] leading-relaxed text-red-200">{loadError || state?.lastError}</p>
        </div>
      )}

      {/* ---- No AI key: offline OCR still reads and files; a key only helps odd layouts ---- */}
      {state && !state.hasAiKey && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-3 py-2.5">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-biome-bolt" />
          <p className="text-[11.5px] leading-relaxed text-biome-bolt/90">
            Documents are read with the built-in offline OCR (free, no internet) and filed automatically.
            For better reading of unusual or handwritten layouts, add a free Gemini key in{" "}
            <a href="/settings" className="font-semibold underline">Settings → AI OCR Engine</a>{" "}
            (aistudio.google.com/apikey) — no restart needed.
          </p>
        </div>
      )}

      {/* ---- Diagnostics: where each message stopped ---- */}
      {state?.diag && <Diagnostics d={state.diag} build={state.build} engine={state.engine === "web" ? `WhatsApp Web (${(state.browser || "").split(/[\\/]/).pop() || "browser"})` : state.engine === "baileys" ? "Baileys" : undefined} notADocument={state.stats?.notADocument ?? 0} />}

      {/* ---- Where things are saved ---- */}
      {state?.inbox && (
        <div className="mt-4 flex items-start gap-2.5 border-t border-biome-line pt-3">
          <FolderOpen size={13} className="mt-0.5 shrink-0 text-biome-muted" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-biome-muted/60">Saving to</p>
            <p className="truncate font-mono text-[11px] text-biome-muted" title={state.inbox}>
              {state.inbox}
            </p>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

/**
 * "Watching, but nothing filed" — answered on the page.
 *
 * Every message WhatsApp delivers ends in one of these counters, so the
 * first non-zero box after "Messages received" is where documents stop.
 * The most likely cause is spelled out in plain words above the numbers.
 */
function Diagnostics({ d, build, engine, notADocument }: { d: NonNullable<AgentState["diag"]>; build?: string; engine?: string; notADocument: number }) {
  const [open, setOpen] = useState(false);
  let verdict: { tone: "ok" | "warn" | "bad"; text: string };
  if (!d.selectedChats.length) verdict = { tone: "bad", text: "No chat is selected. Open “Which chats to watch” below and select the supply group." };
  else if (d.messagesSeen === 0) verdict = { tone: "warn", text: "No message has arrived since the agent started. Send a test document in the selected group. If it still shows 0, press Unlink and link WhatsApp again." };
  else if (d.undecryptable > 0 && d.queued === 0) verdict = { tone: "bad", text: `${d.undecryptable} message(s) could not be decrypted on this PC. Press Unlink, then link WhatsApp again with the QR — this renews the encryption keys.` };
  else if (d.fromUnselectedChat > 0 && d.queued === 0) verdict = { tone: "bad", text: "Documents are arriving, but from a chat that is not selected. Select that group in “Which chats to watch”." };
  else if (d.failed > 0 && d.processed === 0) verdict = { tone: "bad", text: "Documents arrive but could not be downloaded or read — see the log below." };
  else if (d.processed > 0 && notADocument >= d.processed) verdict = { tone: "warn", text: "Documents were read but put under “Not a document” (no invoice / challan / reference found). Check the log below for what was read." };
  else if (d.queued > 0) verdict = { tone: "ok", text: `${d.processed} of ${d.queued} document(s) processed${d.lastDocumentAt ? ` — last at ${new Date(d.lastDocumentAt).toLocaleTimeString()}` : ""}.` };
  else verdict = { tone: "warn", text: "Messages arrive, but none of them is a document or photo yet." };

  const tone = verdict.tone === "ok" ? "border-emerald-500/30 bg-emerald-500/[.06] text-emerald-600" : verdict.tone === "warn" ? "border-amber-500/30 bg-amber-500/[.06] text-amber-600" : "border-rose-500/30 bg-rose-500/[.06] text-rose-500";
  const boxes: [string, number][] = [
    ["Messages received", d.messagesSeen],
    ["Could not decrypt", d.undecryptable],
    ["Not a document/photo", d.noMedia],
    ["From unselected chat", d.fromUnselectedChat],
    ["Queued for reading", d.queued],
    ["Processed", d.processed],
    ["Failed", d.failed],
  ];
  return (
    <div className="mt-4 rounded-xl border border-biome-line">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tone}`}>Diagnostics</span>
        <span className="flex-1 text-[11.5px] leading-relaxed text-biome-text">{verdict.text}</span>
        <span className="text-[10px] text-biome-muted">{open ? "Hide" : "Details"}</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-biome-line px-3 py-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
            {boxes.map(([label, n]) => (
              <div key={label} className="rounded-lg border border-biome-line px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-biome-muted">{label}</p>
                <p className="font-mono text-[14px] text-biome-text">{n}</p>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-biome-muted">
            Watching: <span className="text-biome-text">{d.selectedChats.length ? d.selectedChats.join(", ") : "nothing"}</span>
            {" · "}Automatic processing: <span className="text-biome-text">{d.autoProcess ? "on" : "off"}</span>
            {engine ? <> · Engine <span className="text-biome-text">{engine}</span></> : null}
            {build ? <> · Agent build <span className="font-mono">{build}</span></> : null}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-100/80">
            {d.log.length ? d.log.join("\n") : "No log lines yet."}
          </pre>
        </div>
      )}
    </div>
  );
}
