"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Bot,
  Bell,
  Trash2,
  RotateCcw,
  ScanLine,
  CheckCircle2,
  XCircle,
  Sparkles,
  Database,
  Loader2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { getLoadedAssistantModelId, unloadAssistantEngine, ASSISTANT_MODELS } from "@/lib/aiAssistant";
import { useNotifications } from "@/lib/notifications";
import { getReduceMotion, setReduceMotion } from "@/lib/preferences";

interface AiStatus {
  hasGemini: boolean;
  hasAnthropic: boolean;
  configured: boolean;
  activeProvider: string | null;
}

export default function SettingsPage() {
  const [loadedModel, setLoadedModel] = useState<string | null>(
    typeof window !== "undefined" ? getLoadedAssistantModelId() : null
  );
  const { notifications, clear } = useNotifications();
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(true);

  useEffect(() => {
    setReduceMotionState(getReduceMotion());
    fetch("/api/ai-status")
      .then((r) => r.json())
      .then((data) => setAiStatus(data))
      .catch(() => setAiStatus(null))
      .finally(() => setAiStatusLoading(false));
  }, []);

  function toggleReduceMotion(next: boolean) {
    setReduceMotionState(next);
    setReduceMotion(next);
  }

  async function handleUnload() {
    await unloadAssistantEngine();
    setLoadedModel(null);
  }

  const modelLabel = ASSISTANT_MODELS.find((m) => m.id === loadedModel)?.label;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="rounded-xl bg-biome-leaf/10 p-2.5">
          <SettingsIcon size={20} className="text-biome-leafBright" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-biome-text">Settings</h1>
          <p className="text-xs text-biome-muted">Manage the local AI assistant and notifications.</p>
        </div>
      </motion.div>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <ScanLine size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">AI OCR Engine</h2>
        </div>

        {aiStatusLoading ? (
          <p className="flex items-center gap-2 text-xs text-biome-muted">
            <Loader2 size={13} className="animate-spin" /> Checking configuration…
          </p>
        ) : aiStatus?.configured ? (
          <div className="flex items-center justify-between rounded-xl border border-biome-leaf/20 bg-biome-leaf/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-biome-leafBright" />
              <div>
                <p className="text-xs font-medium text-biome-text">
                  {aiStatus.activeProvider} key configured
                </p>
                <p className="mt-0.5 text-[11px] text-biome-muted">
                  The OCR Scanner's AI-Powered Reading mode is active — uploads are read by{" "}
                  {aiStatus.activeProvider}'s vision model instead of falling back to offline
                  Tesseract OCR.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-biome-bolt/25 bg-biome-bolt/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-biome-bolt" />
              <p className="text-xs font-medium text-biome-text">No AI key configured</p>
            </div>
            <p className="text-[11px] text-biome-muted">
              This is almost certainly why OCR results look wrong or low-accuracy — the app is
              silently falling back to offline Tesseract OCR, which is far less accurate on
              stamped, rotated, or messy scans.
            </p>
            <ol className="list-decimal space-y-1 pl-4 text-[11px] text-biome-muted">
              <li>
                Get a free key at{" "}
                <span className="font-mono text-biome-text">aistudio.google.com/apikey</span> (no
                credit card needed).
              </li>
              <li>
                In the project folder, copy <span className="font-mono text-biome-text">.env.local.example</span> to{" "}
                <span className="font-mono text-biome-text">.env.local</span>.
              </li>
              <li>
                Paste the key after <span className="font-mono text-biome-text">GEMINI_API_KEY=</span>.
              </li>
              <li>
                Restart the app (<span className="font-mono text-biome-text">npm run dev</span>, or
                relaunch the desktop build).
              </li>
            </ol>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Bot size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">Local AI Assistant</h2>
        </div>
        {loadedModel ? (
          <div className="flex items-center justify-between rounded-xl border border-biome-leaf/20 bg-biome-leaf/5 px-4 py-3">
            <div>
              <p className="text-xs font-medium text-biome-text">{modelLabel ?? loadedModel}</p>
              <p className="mt-0.5 text-[11px] text-biome-muted">
                Loaded and running locally in this browser — offline-ready.
              </p>
            </div>
            <PremiumButton variant="ghost" onClick={handleUnload}>
              <RotateCcw size={13} /> Unload
            </PremiumButton>
          </div>
        ) : (
          <p className="text-xs text-biome-muted">
            No local model loaded yet in this session. Open the assistant (bottom-right) to enable it.
          </p>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-biome-leafBright" />
            <h2 className="font-display text-sm font-medium text-biome-text">Notifications</h2>
          </div>
          <span className="text-[11px] text-biome-muted">{notifications.length} stored</span>
        </div>
        <p className="mb-3 text-xs text-biome-muted">
          Notifications are generated by real app events (exports finishing, AI model ready, reconciliation
          runs) — nothing here is simulated.
        </p>
        <PremiumButton variant="ghost" onClick={clear} disabled={notifications.length === 0}>
          <Trash2 size={13} /> Clear all notifications
        </PremiumButton>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">Appearance</h2>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-biome-line bg-white/5 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-biome-text">Reduce motion</p>
            <p className="mt-0.5 text-[11px] text-biome-muted">
              Turns off card/hover animations app-wide — useful on slower machines or if motion is
              distracting.
            </p>
          </div>
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => toggleReduceMotion(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-biome-leaf"
          />
        </label>
        <p className="mt-3 text-[11px] text-biome-muted">
          A full light/dark theme switch isn't available yet — this build is dark-themed only.
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Database size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">Tally Integration</h2>
        </div>
        <p className="mb-3 text-xs text-biome-muted">
          There's no live/direct connection to Tally yet (that needs Tally's ODBC or XML-server
          gateway running on the same machine, which is a separate piece of work). The reliable
          path today is exporting from Tally and importing here:
        </p>
        <ol className="list-decimal space-y-1.5 pl-4 text-[11px] text-biome-muted">
          <li>
            In Tally: open the ledger or Day Book you want, press{" "}
            <span className="font-mono text-biome-text">Alt+E</span> (Export).
          </li>
          <li>
            Set format to <span className="font-mono text-biome-text">Excel (Spreadsheet)</span> or{" "}
            <span className="font-mono text-biome-text">CSV</span> and export.
          </li>
          <li>
            Upload that file directly in{" "}
            <span className="text-biome-text">Reconciliation → Ledger A / Ledger B</span> — columns
            auto-detect.
          </li>
        </ol>
      </GlassCard>
    </div>
  );
}
