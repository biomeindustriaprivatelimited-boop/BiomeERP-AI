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

      {/* ---- No AI key: documents still save, but stay unclassified ---- */}
      {state && !state.hasAiKey && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-3 py-2.5">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-biome-bolt" />
          <p className="text-[11.5px] leading-relaxed text-biome-bolt/90">
            No AI reader is configured, so documents will be downloaded and saved but not classified —
            they&apos;ll land in <span className="font-mono">_Needs Review</span>. Add a{" "}
            <span className="font-mono">GEMINI_API_KEY</span> to <span className="font-mono">.env.local</span>{" "}
            (free at aistudio.google.com/apikey) and restart, then use Re-scan on anything already
            received.
          </p>
        </div>
      )}

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
