"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderCog, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";

/**
 * Where documents are saved.
 *
 * Only the ROOT changes. Everything underneath — the month, the client,
 * the reference folder — is still built the same way, because that
 * structure is the point of the whole system. Pointing the root at a
 * synced Drive folder or a network share is a legitimate thing to want;
 * rearranging what sits inside it is not.
 */
export default function SaveLocationSetting() {
  const { notify } = useNotifications();
  const [current, setCurrent] = useState<string>("");
  const [defaultRoot, setDefaultRoot] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp-settings", { cache: "no-store" });
      const json = await res.json();
      // The API already reports both: what is in use, and what it would
      // fall back to.
      setCurrent(json.effectiveRoot || "");
      setDefaultRoot(json.defaultRoot || "");
      setDraft(json.settings?.saveRoot || "");
    } catch {
      /* the panel simply shows nothing rather than blocking the page */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(value: string | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveRoot: value }),
      });
      // A failing route can answer with HTML, not JSON. Parsing first and
      // asking questions later turned a clear server message into
      // "Unexpected token <".
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      notify({
        kind: "success",
        title: value ? "Save location changed" : "Back to the default location",
        detail: "Restart the app so the WhatsApp agent picks it up.",
      });
      load();
    } catch (err) {
      notify({ kind: "warning", title: "Couldn't change it", detail: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const changed = draft.trim() !== "" && draft.trim() !== current;

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-start gap-2.5">
        <FolderCog size={16} className="mt-0.5 shrink-0 text-biome-leafBright" />
        <div>
          <h2 className="font-display text-[15px] font-semibold text-biome-text">
            Where documents are saved
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-biome-muted">
            Only this top folder changes. Inside it, every completed supply is filed as
            Month → Client → Document Date → Reference, exactly matching the company filing rule.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[11.5px] text-biome-muted">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5">
            <p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">Currently</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-biome-text">{current || "—"}</p>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">
              New location — a full path to a folder that already exists
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={defaultRoot || "D:\\\\Biome Documents"}
              spellCheck={false}
              className="w-full rounded-xl border border-biome-line bg-biome-hover px-3 py-2 font-mono text-[11.5px] text-biome-text outline-none placeholder:text-biome-muted/50 focus:border-biome-leaf/40"
            />
          </label>

          <p className="mt-2 text-[10.5px] leading-relaxed text-biome-muted">
            The folder is checked for write access before anything is changed. Documents already
            filed stay where they are — only new ones go to the new place, so move the old folder
            across yourself if you want everything together.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PremiumButton onClick={() => save(draft.trim())} disabled={!changed || saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Use this folder
            </PremiumButton>
            {draft.trim() && (
              <PremiumButton
                variant="ghost"
                onClick={() => {
                  setDraft("");
                  save(null);
                }}
                disabled={saving}
              >
                <RotateCcw size={13} /> Back to default
              </PremiumButton>
            )}
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-biome-bolt">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            Restart the app after changing this — the WhatsApp agent reads the location when it
            starts.
          </p>
        </>
      )}
    </GlassCard>
  );
}
