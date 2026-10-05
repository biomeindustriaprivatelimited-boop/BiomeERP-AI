"use client";

import { useState } from "react";
import { Check, Loader2, Lock, LockOpen, X, MessageSquareWarning } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import Portal from "@/components/Portal";

/**
 * Frozen plant-sheet rows: asking to edit one, and deciding.
 *
 * The API (/api/plant-data/edit-request) is the rule; these are its two
 * screens — a small dialog for the plant manager, and a list of requests
 * for whoever holds plant.unlock (accounts / admin / developer).
 */

export interface SheetEditRequest {
  id: string;
  plant: string;
  plantName?: string;
  kind: "biomass" | "transport";
  rowId: string;
  rowLabel: string;
  reason: string;
  requestedByName: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  expiresAt?: string;
}

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function RequestEditDialog({
  rowLabel, unlockHours, onCancel, onSend,
}: {
  rowLabel: string;
  unlockHours: number;
  onCancel: () => void;
  onSend: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={onCancel}>
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
          <GlassCard className="p-5">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
              <Lock size={14} className="text-indigo-500" /> Request to edit a frozen row
            </p>
            <p className="mt-1 text-[11px] text-biome-muted">{rowLabel}</p>
            <p className="mt-3 text-[11px] leading-relaxed text-biome-muted">
              Say what needs changing and why. Accounts, admin or the developer will approve or reject it.
              If approved, the row opens for {unlockHours} hours — edit it, then press Submit on the row again.
            </p>
            <textarea
              autoFocus
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Tare weight typed as 9,200 — the slip says 9,020."
              className="mt-2 w-full rounded-xl border border-biome-line bg-biome-hover px-3 py-2 text-[12px] text-biome-text outline-none focus:border-biome-leaf/40"
            />
            {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <PremiumButton variant="ghost" onClick={onCancel} disabled={busy}>Cancel</PremiumButton>
              <PremiumButton
                disabled={busy || reason.trim().length < 10}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try { await onSend(reason.trim()); } catch (e) { setError((e as Error).message); setBusy(false); }
                }}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareWarning size={13} />} Send request
              </PremiumButton>
            </div>
          </GlassCard>
        </div>
      </div>
    </Portal>
  );
}

export function EditRequestsPanel({
  requests, canDecide, unlockHours, meId, onDecide,
}: {
  requests: SheetEditRequest[];
  canDecide: boolean;
  unlockHours: number;
  meId: string;
  onDecide: (id: string, approve: boolean, note: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(true);
  const pending = requests.filter((r) => r.status === "pending");
  const recent = requests.filter((r) => r.status !== "pending").slice(0, 6);
  if (!pending.length && !recent.length) return null;

  return (
    <GlassCard className={`p-4 ${pending.length && canDecide ? "border border-amber-500/35" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
          <Lock size={13} className="text-indigo-500" />
          Edit requests for frozen rows
          {pending.length > 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600">{pending.length} pending</span>
          )}
        </span>
        <span className="text-[10.5px] text-biome-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="rounded-xl border border-biome-line bg-biome-hover/40 p-3">
              <p className="text-[11.5px] font-medium text-biome-text">{r.rowLabel}</p>
              <p className="mt-0.5 text-[10.5px] text-biome-muted">
                {r.requestedByName} · {when(r.requestedAt)}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-biome-text">“{r.reason}”</p>
              {canDecide && r.requestedBy !== meId ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={notes[r.id] || ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Note (required to reject)"
                    className="min-w-[200px] flex-1 rounded-lg border border-biome-line bg-biome-hover px-2 py-1 text-[11px] text-biome-text outline-none focus:border-biome-leaf/40"
                  />
                  <PremiumButton
                    disabled={!!busy}
                    onClick={async () => { setBusy(r.id + "a"); try { await onDecide(r.id, true, notes[r.id] || ""); } finally { setBusy(""); } }}
                  >
                    {busy === r.id + "a" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve ({unlockHours}h)
                  </PremiumButton>
                  <PremiumButton
                    variant="ghost"
                    disabled={!!busy || !(notes[r.id] || "").trim()}
                    onClick={async () => { setBusy(r.id + "r"); try { await onDecide(r.id, false, notes[r.id] || ""); } finally { setBusy(""); } }}
                  >
                    {busy === r.id + "r" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Reject
                  </PremiumButton>
                </div>
              ) : (
                <p className="mt-1.5 text-[10.5px] text-amber-600">Waiting for accounts / admin / developer.</p>
              )}
            </div>
          ))}
          {recent.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-biome-muted">Recently decided</p>
              <ul className="mt-1 space-y-1">
                {recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-[10.5px] text-biome-muted">
                    {r.status === "approved" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600"><LockOpen size={11} /> Approved</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-500"><X size={11} /> Rejected</span>
                    )}
                    <span className="text-biome-text">{r.rowLabel}</span>
                    <span>by {r.decidedByName} · {when(r.decidedAt)}</span>
                    {r.status === "approved" && r.expiresAt && <span>· open until {when(r.expiresAt)}</span>}
                    {r.decisionNote && <span>· “{r.decisionNote}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
