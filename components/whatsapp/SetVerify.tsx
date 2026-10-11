"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Lock,
  LockOpen,
  ShieldCheck,
  XCircle,
  MinusCircle,
  Loader2,
  AlertTriangle,
  ArrowRightLeft,
  Check,
} from "lucide-react";
import Portal from "@/components/Portal";
import { useSession } from "@/lib/session";
import type { SetCheck, SetStatus, SupplySet, WhatsappDocument } from "@/lib/whatsapp";

/**
 * Supply-set verification: Collecting → Ready to verify → Final.
 *
 * The coordinator (or accounts / admin / developer) opens the checklist,
 * double-checks and presses OK — the set becomes FINAL and frozen. Only
 * an admin or the developer can reopen it, with a reason. The server
 * enforces all of this; the buttons only hide what would be refused.
 */

const STATUS_STYLE: Record<SetStatus, string> = {
  collecting: "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt",
  ready: "border-biome-sky/40 bg-biome-sky/12 text-biome-skyBright",
  final: "border-biome-leaf/40 bg-biome-leaf/15 text-biome-leafBright",
};
const STATUS_LABEL: Record<SetStatus, string> = { collecting: "Collecting", ready: "Ready to verify", final: "Final" };

export function StatusChip({ status }: { status?: SetStatus }) {
  const s: SetStatus = status || "collecting";
  const Icon = s === "final" ? Lock : s === "ready" ? ShieldCheck : CircleDashed;
  return (
    <span
      data-testid="set-status"
      data-status={s}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[s]}`}
      title={
        s === "final"
          ? "Verified and frozen — nothing is added, moved or re-read automatically."
          : s === "ready"
            ? "Every paper the client needs is here and the numbers agree — open it and press Verify & finalise."
            : "Still collecting papers, or something on the checklist does not agree yet."
      }
    >
      <Icon size={10} /> {STATUS_LABEL[s]}
    </span>
  );
}

export function NeedsCheckChip({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      data-testid="needs-check-chip"
      className="flex items-center gap-1 rounded-full border border-amber-500/45 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
      title="Papers placed without a printed match — confirm or move them"
    >
      <AlertTriangle size={10} /> Needs check {count}
    </span>
  );
}

function CheckLine({ c }: { c: SetCheck }) {
  const Icon = c.ok === true ? CheckCircle2 : c.ok === false ? XCircle : MinusCircle;
  const tone = c.ok === true ? "text-biome-leafBright" : c.ok === false ? "text-red-600 dark:text-red-300" : "text-biome-muted";
  return (
    <li className="flex items-start gap-2 text-[11px]" data-testid="check-line" data-ok={String(c.ok)}>
      <Icon size={13} className={`mt-0.5 shrink-0 ${tone}`} />
      <span className="min-w-0">
        <span className="font-medium text-biome-text">{c.label}</span>
        <span className="block break-words text-[10.5px] leading-snug text-biome-muted">{c.detail}</span>
      </span>
    </li>
  );
}

/** Required papers + consistency checks, as one list. */
export function Checklist({ set }: { set: SupplySet }) {
  const required: SetCheck[] = set.clientMatched
    ? [
        {
          key: "required",
          label: `Papers ${set.clientCanonicalName || "the client"} requires (${set.satisfiedCount}/${set.requiredCount})`,
          ok: set.missing.length === 0,
          detail: set.missing.length ? `Missing: ${set.missing.map((m) => m.label).join(", ")}` : "All here",
        },
      ]
    : [{ key: "client", label: "Client in the client list", ok: false, detail: `"${set.clientName || "?"}" is not in the client list` }];
  if (set.dscMissing.length) {
    required.push({ key: "dsc", label: "Digital signature (DSC)", ok: false, detail: `Not found on ${set.dscMissing.map((m) => m.label).join(", ")}` });
  }
  const all = [...required, ...(set.checks || [])];
  return (
    <ul className="space-y-1.5" data-testid="set-checklist">
      {all.map((c) => (
        <CheckLine key={c.key} c={c} />
      ))}
    </ul>
  );
}

async function postJson(route: string, body: unknown) {
  const res = await fetch(`/api/whatsapp/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

function fmt(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The verification block in the set panel. */
export function VerifySection({ set, onChanged }: { set: SupplySet; onChanged?: () => void }) {
  const { can } = useSession();
  const mayFinalise = can("whatsapp") && can("coordination");
  const mayReopen = can("whatsapp") && can("settings");
  const [open, setOpen] = useState<null | "finalise" | "reopen">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status: SetStatus = set.status || "collecting";
  const isFinal = status === "final";
  const fs = set.finalState;
  const problems = (set.checks || []).filter((c) => c.ok === false).length + set.missing.length + set.dscMissing.length + (set.clientMatched ? 0 : 1);
  const noteNeeded = open === "reopen" || status !== "ready";

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (open === "finalise") await postJson("sets/finalise", { reference: set.reference, note: note.trim() || undefined });
      else await postJson("sets/reopen", { reference: set.reference, reason: note.trim() });
      setOpen(null);
      setNote("");
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5" data-testid="verify-section">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-biome-muted">Checklist</p>
        <StatusChip status={status} />
      </div>
      <Checklist set={set} />

      {isFinal && fs && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-biome-leaf/30 bg-biome-leaf/10 px-2.5 py-2 text-[11px] text-biome-text" data-testid="final-note">
          <Lock size={12} className="mt-0.5 shrink-0 text-biome-leafBright" />
          <span>
            Verified and made final by <b>{fs.finalisedBy?.name || "—"}</b> on {fmt(fs.finalisedAt)}.
            {fs.note ? <> Note: “{fs.note}”.</> : null} Locked — nothing is added, moved or re-read automatically.
          </span>
        </p>
      )}
      {!isFinal && fs?.reopenedAt && (
        <p className="mt-2.5 text-[10.5px] text-biome-muted">
          Reopened by {fs.reopenedBy?.name || "—"} on {fmt(fs.reopenedAt)}: “{fs.reopenReason}”
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {!isFinal && mayFinalise && (
          <button
            type="button"
            data-testid="verify-finalise"
            disabled={!set.ourDocumentId}
            title={set.ourDocumentId ? "Double-check the set and make it final" : "Our tax invoice / delivery challan must be in the set first"}
            onClick={() => { setOpen("finalise"); setNote(""); setError(null); }}
            className="flex items-center gap-1.5 rounded-lg bg-[#9fe870] px-3 py-1.5 text-[11.5px] font-semibold text-[#163300] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck size={13} /> Verify &amp; finalise
          </button>
        )}
        {isFinal && mayReopen && (
          <button
            type="button"
            data-testid="reopen-set"
            onClick={() => { setOpen("reopen"); setNote(""); setError(null); }}
            className="flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11.5px] font-semibold text-biome-text hover:bg-biome-bgSoft"
          >
            <LockOpen size={13} /> Reopen…
          </button>
        )}
      </div>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" data-testid="verify-dialog">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-biome-line bg-biome-bgSoft p-5 shadow-2xl">
              <h3 className="font-display text-[15px] font-semibold text-biome-text">
                {open === "finalise" ? "Verify & finalise supply set" : "Reopen final supply set"}
              </h3>
              <p className="mt-0.5 font-mono text-[12.5px] text-biome-leafBright">{set.reference}</p>
              {open === "finalise" ? (
                <>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">
                    Check every line below against the papers ({set.documents.length} in this set). When you press OK the set
                    becomes <b className="text-biome-text">Final</b>: it is locked, nothing is added or moved automatically and its
                    papers cannot be moved out. Only an admin or the developer can reopen it.
                  </p>
                  <div className="mt-3 rounded-xl border border-biome-line bg-biome-hover p-3">
                    <Checklist set={set} />
                  </div>
                  {problems > 0 && (
                    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {problems} item{problems === 1 ? "" : "s"} above {problems === 1 ? "is" : "are"} not right yet. Finalise only if you
                      have checked the papers yourself — write why in the note.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">
                  The set goes back to collecting: the agent may add and move papers again. The reason is kept in the audit log.
                </p>
              )}
              <label className="mt-3 block text-[10.5px] font-semibold uppercase tracking-wider text-biome-muted">
                {open === "reopen" ? "Reason (required)" : noteNeeded ? "Note (required — why it is correct anyway)" : "Note (optional)"}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                data-testid="verify-note"
                className="mt-1 w-full rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[12px] text-biome-text outline-none focus:border-biome-leaf/50"
              />
              {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(null)} className="rounded-lg border border-biome-line px-3 py-1.5 text-[12px] text-biome-text hover:bg-biome-hover">
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="verify-ok"
                  disabled={busy || (noteNeeded && !note.trim())}
                  onClick={submit}
                  className="flex items-center gap-1.5 rounded-lg bg-[#9fe870] px-4 py-1.5 text-[12px] font-semibold text-[#163300] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {open === "finalise" ? "OK — make final" : "Reopen"}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

/**
 * Quick actions on a "Needs check" paper: confirm it belongs here, or move
 * it to another supply set. Hidden on a final set (it is locked).
 */
export function NeedsCheckActions({
  doc,
  sets,
  currentRef,
  onChanged,
}: {
  doc: WhatsappDocument;
  sets: SupplySet[];
  currentRef?: string | null;
  onChanged?: () => void;
}) {
  const { can } = useSession();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!(can("whatsapp") && can("coordination"))) return null;
  const options = sets.filter((s) => s.reference !== currentRef && s.status !== "final");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="needs-check-actions">
      <div className="flex flex-wrap items-center gap-1">
        {currentRef && (
          <button
            type="button"
            disabled={busy}
            data-testid="nc-confirm"
            onClick={() => run(() => postJson("documents/confirm", { id: doc.id }))}
            className="flex items-center gap-1 rounded-md border border-biome-leaf/40 bg-biome-leaf/10 px-1.5 py-0.5 text-[10px] font-semibold text-biome-leafBright hover:bg-biome-leaf/20"
            title={`Yes, this paper belongs to ${currentRef}`}
          >
            <Check size={10} /> Belongs here
          </button>
        )}
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="nc-move-select"
          className="max-w-[150px] rounded-md border border-biome-line bg-biome-bg px-1 py-0.5 text-[10px] text-biome-text"
          aria-label="Move to supply set"
        >
          <option value="">{currentRef ? "Move to…" : "Assign to…"}</option>
          {options.map((s) => (
            <option key={s.reference} value={s.reference}>
              {s.reference}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !target}
          data-testid="nc-move"
          onClick={() => run(() => postJson("classify", { id: doc.id, referenceNo: target }))}
          className="flex items-center gap-1 rounded-md border border-biome-line px-1.5 py-0.5 text-[10px] font-semibold text-biome-text hover:bg-biome-hover disabled:opacity-40"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <ArrowRightLeft size={10} />} {currentRef ? "Move" : "Assign"}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
