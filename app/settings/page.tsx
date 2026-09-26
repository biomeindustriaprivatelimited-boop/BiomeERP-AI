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
  Palette,
  Sun,
  Moon,
  Factory,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import SaveLocationSetting from "@/components/settings/SaveLocationSetting";
import AutomationSettings from "@/components/settings/AutomationSettings";
import MailSettings from "@/components/settings/MailSettings";
import OverrideSetting from "@/components/settings/OverrideSetting";
import BackupSetting from "@/components/settings/BackupSetting";
import SyncSetting from "@/components/settings/SyncSetting";
import DriveSyncSetting from "@/components/settings/DriveSyncSetting";
import MemorySetting from "@/components/settings/MemorySetting";
import PremiumButton from "@/components/ui/PremiumButton";
import { getLoadedAssistantModelId, unloadAssistantEngine, ASSISTANT_MODELS } from "@/lib/aiAssistant";
import { useNotifications } from "@/lib/notifications";
import {
  getReduceMotion,
  setReduceMotion,
  getTallySettings,
  setTallySettings,
  TallyStoredSettings,
  getAccent,
  setAccent,
  getColorMode,
  setColorMode,
  getFont,
  setFont,
  FONT_CHOICES,
  type FontChoice,
  ACCENT_OPTIONS,
  type AccentTheme,
  type ColorMode,
} from "@/lib/preferences";

interface AiStatus {
  hasGemini: boolean;
  hasAnthropic: boolean;
  configured: boolean;
  activeProvider: string | null;
  problem: string | null;
  geminiUsable?: boolean;
  anthropicUsable?: boolean;
}

interface MasterHealth {
  loading: boolean;
  vendors: number;
  clients: number;
  duplicates: { code: string; names: string[] }[];
  error: string | null;
}

function SettingLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return <a href={href} className="rounded-xl border border-biome-line bg-biome-hover px-3 py-3 transition-colors hover:border-biome-leaf/30 hover:bg-biome-leaf/[0.03]"><p className="text-xs font-medium text-biome-text">{title}</p><p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">{desc}</p></a>;
}

function HealthTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5"><p className="text-[9.5px] uppercase tracking-wider text-biome-muted/60">{label}</p><p className="mt-1 font-display text-lg font-semibold tabular-nums text-biome-text">{value}</p><p className="text-[10px] text-biome-muted">{detail}</p></div>;
}

export default function SettingsPage() {
  const [loadedModel, setLoadedModel] = useState<string | null>(
    typeof window !== "undefined" ? getLoadedAssistantModelId() : null
  );
  const { notifications, clear } = useNotifications();
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [accent, setAccentState] = useState<AccentTheme>("leaf");
  const [colorMode, setColorModeState] = useState<ColorMode>("light");
  const [font, setFontState] = useState<FontChoice>("inter");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(true);
  const [master, setMaster] = useState<MasterHealth>({
    loading: true,
    vendors: 0,
    clients: 0,
    duplicates: [],
    error: null,
  });

  const [tally, setTally] = useState<TallyStoredSettings>({
    mode: "direct",
    host: "localhost",
    port: 9000,
    companyName: "",
    agentUrl: "",
    agentApiKey: "",
  });
  const [tallyTesting, setTallyTesting] = useState(false);
  const [tallyTestResult, setTallyTestResult] = useState<{ reachable: boolean; message: string } | null>(
    null
  );

  useEffect(() => {
    setReduceMotionState(getReduceMotion());
    setAccentState(getAccent());
    setColorModeState(getColorMode());
    setFontState(getFont());
    setTally(getTallySettings());
    fetch("/api/ai-status")
      .then((r) => r.json())
      .then((data) => setAiStatus(data))
      .catch(() => setAiStatus(null))
      .finally(() => setAiStatusLoading(false));

    // These counts used to be typed into the page by hand, so they stayed
    // at 53 / 27 no matter what was actually in the master files.
    (async () => {
      try {
        const [vRes, cRes] = await Promise.all([
          fetch("/api/vendors/registry", { cache: "no-store" }),
          fetch("/api/clients", { cache: "no-store" }),
        ]);
        const vJson = await vRes.json();
        const cJson = await cRes.json();
        const vendors: { code?: string; name?: string }[] = Array.isArray(vJson.vendors)
          ? vJson.vendors
          : [];
        const clients: unknown[] = Array.isArray(cJson.clients) ? cJson.clients : [];

        const byCode = new Map<string, string[]>();
        for (const v of vendors) {
          const code = String(v.code || "").trim().toUpperCase();
          if (!code) continue;
          byCode.set(code, [...(byCode.get(code) || []), String(v.name || code)]);
        }
        const duplicates = [...byCode.entries()]
          .filter(([, names]) => names.length > 1)
          .map(([code, names]) => ({ code, names }))
          .sort((a, b) => a.code.localeCompare(b.code));

        setMaster({
          loading: false,
          vendors: vendors.length,
          clients: clients.length,
          duplicates,
          error: null,
        });
      } catch (err) {
        setMaster({
          loading: false,
          vendors: 0,
          clients: 0,
          duplicates: [],
          error: `Couldn't read the master files: ${(err as Error).message}`,
        });
      }
    })();
  }, []);

  function toggleReduceMotion(next: boolean) {
    setReduceMotionState(next);
    setReduceMotion(next);
  }

  function saveTally(next: TallyStoredSettings) {
    setTally(next);
    setTallySettings(next);
    setTallyTestResult(null);
  }

  async function testTallyConnection() {
    setTallyTesting(true);
    setTallyTestResult(null);
    try {
      const res = await fetch("/api/tally/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tally),
      });
      const data = await res.json();
      setTallyTestResult(data);
    } catch (err: any) {
      setTallyTestResult({ reachable: false, message: err?.message || "Test failed." });
    } finally {
      setTallyTesting(false);
    }
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
          <p className="text-xs text-biome-muted">Control automation, document storage, AI, Tally, appearance and local app behaviour.</p>
        </div>
      </motion.div>

      <section id="automation" className="scroll-mt-24"><AutomationSettings /></section>

      <section id="mail" className="scroll-mt-24"><MailSettings /></section>

      {/* Its own section. It used to render inside the AI OCR card, which
          put a card inside a card under a heading it has nothing to do with. */}
      <section id="storage" className="scroll-mt-24"><SaveLocationSetting /></section>

      {/* Admin only — the component asks the API and draws nothing when the
          answer is 403, so it simply does not appear for anyone else. */}
      <section id="override" className="scroll-mt-24"><OverrideSetting /></section>

      {/* Below Override on purpose: restoring needs Override switched on,
          so the two are read in the order they are used. */}
      <section id="backup" className="scroll-mt-24"><BackupSetting /></section>

      {/* Backups into the company's own Google Drive. */}
      <section id="drive" className="scroll-mt-24"><DriveSyncSetting /></section>

      {/* What the AI may remember — reviewable and editable. */}
      <section id="memory" className="scroll-mt-24"><MemorySetting /></section>

      {/* Developer only — which PC is the server, which are clients. */}
      <section id="server" className="scroll-mt-24"><SyncSetting /></section>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2"><Database size={16} className="text-biome-leafBright" /><h2 className="font-display text-sm font-medium text-biome-text">Production Controls</h2></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <SettingLink href="/review-queue" title="Review Queue" desc="Verify low-confidence WhatsApp documents before final filing." />
          <SettingLink href="/assistant" title="AI Business Assistant" desc="Ask live questions about finance, supplies and documents." />
          <SettingLink href="/delivery-challan" title="Challan Templates" desc="Use the supplied Mouda and Solapur template references." />
          <SettingLink href="/gst-compliance" title="GST Workspace" desc="Import, reconcile and review GST return data." />
        </div>
      </GlassCard>

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
          <div className="space-y-2 rounded-xl border border-red-400/25 bg-red-400/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-red-300" />
              <p className="text-xs font-medium text-biome-text">AI reading is not working</p>
            </div>
            {/* The exact, specific reason — e.g. "your key is an OAuth token,
                not an API key" — instead of a vague "no key" message. */}
            {aiStatus?.problem && (
              <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] leading-relaxed text-red-200">
                {aiStatus.problem}
              </p>
            )}
            <p className="text-[11px] text-biome-muted">
              Until this is fixed, uploaded documents can&apos;t be read and WhatsApp documents stay
              in “Needs review”. Add one working key:
            </p>
            <ol className="list-decimal space-y-1 pl-4 text-[11px] text-biome-muted">
              <li>
                Open <span className="font-mono text-biome-text">.env.local</span> in the project
                folder.
              </li>
              <li>
                Set <span className="font-mono text-biome-text">ANTHROPIC_API_KEY=sk-ant-…</span>{" "}
                (from console.anthropic.com) — or a Gemini key that starts with{" "}
                <span className="font-mono text-biome-text">AIza</span> (from
                aistudio.google.com/apikey).
              </li>
              <li>
                Restart (<span className="font-mono text-biome-text">npm run dev</span>, or relaunch
                the desktop build).
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
          <Database size={16} className="text-biome-leafBright" />
          <h2 className="font-display text-sm font-medium text-biome-text">Tally Integration</h2>
        </div>

        <p className="mb-3 text-xs text-biome-muted">
          Two one-time steps in Tally: load the bridge file below, and turn on Tally&apos;s HTTP
          server (F1 → Advanced Configuration → Client/Server = Both, port 9000).
        </p>

        <a
          href="/tally/BiomeBridge.tdl"
          download
          className="mb-2 inline-flex items-center gap-1.5 rounded-xl border border-biome-leaf/30 bg-biome-leaf/10 px-3 py-2 text-xs font-medium text-biome-leafBright transition-colors hover:bg-biome-leaf/20"
        >
          <Database size={13} /> Download BiomeBridge.tdl
        </a>

        <div className="mb-4 rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5">
          <p className="text-[11px] font-medium text-biome-text">Installing it</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[10.5px] leading-relaxed text-biome-muted">
            <li>Save the file somewhere permanent, e.g. C:\Tally\BiomeBridge.tdl</li>
            <li>In Tally: F1 (Help) → TDL &amp; Add-On → F4 (Manage Local TDL)</li>
            <li>Set &ldquo;Loading TDLs on startup&rdquo; to Yes</li>
            <li>Put the full file path under the list of TDL files to preload</li>
            <li>Accept, then restart Tally</li>
          </ol>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-biome-muted">
            This replaces the older BiomePlatformExport.tdl — remove that one from Tally&apos;s
            preload list if it&apos;s still there. The bridge is read-only and can&apos;t change
            your books.
          </p>
        </div>

        <div className="mb-4 flex gap-2 rounded-xl border border-biome-line bg-biome-hover p-1">
          <button
            onClick={() => saveTally({ ...tally, mode: "direct" })}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tally.mode === "direct"
                ? "bg-biome-leaf/15 text-biome-leafBright"
                : "text-biome-muted hover:text-biome-text"
            }`}
          >
            Same PC / LAN (direct)
          </button>
          <button
            onClick={() => saveTally({ ...tally, mode: "agent" })}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tally.mode === "agent"
                ? "bg-biome-leaf/15 text-biome-leafBright"
                : "text-biome-muted hover:text-biome-text"
            }`}
          >
            Different network (via Agent)
          </button>
        </div>

        {tally.mode === "direct" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-biome-muted">
              Tally host
              <input
                value={tally.host}
                onChange={(e) => saveTally({ ...tally, host: e.target.value })}
                placeholder="localhost"
                className="mt-1 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
              />
              <span className="mt-1 block text-[10px] text-biome-muted/70">
                Same PC as Tally → "localhost". Different PC on same network → Tally PC's LAN IP
                (e.g. 192.168.1.20).
              </span>
            </label>
            <label className="text-xs text-biome-muted">
              Port
              <input
                type="number"
                value={tally.port}
                onChange={(e) => saveTally({ ...tally, port: Number(e.target.value) || 9000 })}
                className="mt-1 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl border border-biome-sky/20 bg-biome-sky/5 px-3 py-2 text-[11px] text-biome-muted">
              Needs the Biome Tally Agent running on the Tally PC (see{" "}
              <span className="font-mono text-biome-text">tally-agent/README.md</span> in the
              project — it walks through installing the agent and setting up a free tunnel for a
              public URL).
            </p>
            <label className="block text-xs text-biome-muted">
              Agent URL
              <input
                value={tally.agentUrl}
                onChange={(e) => saveTally({ ...tally, agentUrl: e.target.value })}
                placeholder="https://your-tunnel-url.trycloudflare.com"
                className="mt-1 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
              />
            </label>
            <label className="block text-xs text-biome-muted">
              Agent API Key
              <input
                type="password"
                value={tally.agentApiKey}
                onChange={(e) => saveTally({ ...tally, agentApiKey: e.target.value })}
                placeholder="the apiKey set in config.json on the Tally PC"
                className="mt-1 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
              />
            </label>
          </div>
        )}

        <label className="mt-3 block text-xs text-biome-muted">
          Tally company name (exact, optional)
          <input
            value={tally.companyName}
            onChange={(e) => saveTally({ ...tally, companyName: e.target.value })}
            placeholder="Biome Industria Private Limited"
            className="mt-1 w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf/40"
          />
        </label>

        <div className="mt-3 flex items-center gap-2">
          <PremiumButton variant="ghost" onClick={testTallyConnection} disabled={tallyTesting}>
            {tallyTesting ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
            Test Connection
          </PremiumButton>
        </div>

        {tallyTestResult && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${
              tallyTestResult.reachable
                ? "border-biome-leaf/25 bg-biome-leaf/5 text-biome-text"
                : "border-biome-bolt/25 bg-biome-bolt/5 text-biome-text"
            }`}
          >
            {tallyTestResult.reachable ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-biome-leafBright" />
            ) : (
              <XCircle size={14} className="mt-0.5 shrink-0 text-biome-bolt" />
            )}
            <span>{tallyTestResult.message}</span>
          </div>
        )}

        <p className="mt-3 text-[11px] text-biome-muted">
          Once connected, use the "Fetch from Tally" button on the Reconciliation page to pull
          vouchers directly instead of uploading an Excel file. There's also a manual fetch there
          for whenever automatic sync isn't wanted.
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2"><Database size={16} className="text-biome-leafBright" /><h2 className="font-display text-sm font-medium text-biome-text">Master data integrity</h2></div>
        <div className="grid gap-2 sm:grid-cols-3">
          <HealthTile
            label="Vendor master"
            value={master.loading ? "…" : String(master.vendors)}
            detail={master.loading ? "Reading vendors.json" : "Registered vendor codes"}
          />
          <HealthTile
            label="Client master"
            value={master.loading ? "…" : String(master.clients)}
            detail={master.loading ? "Reading clients.json" : "Clients with requirement lists"}
          />
          <HealthTile label="Plant codes" value="2" detail="REW + GKD" />
        </div>

        {/* Duplicates are worked out from the vendor file as it stands now.
            A reference like BDC/841/SGE/37 has to name exactly one vendor,
            so a repeated code silently routes a supply to the wrong party. */}
        {!master.loading && master.duplicates.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2.5">
            <p className="text-[11px] font-medium text-biome-text">
              {master.duplicates.length === 1
                ? "One vendor code is used by more than one vendor"
                : `${master.duplicates.length} vendor codes are used by more than one vendor`}
            </p>
            <ul className="mt-1.5 space-y-1">
              {master.duplicates.map((d) => (
                <li key={d.code} className="text-[10.5px] leading-relaxed text-biome-muted">
                  <span className="font-mono text-biome-text">{d.code}</span> — {d.names.join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-biome-muted">
              A reference can only point at one vendor. Give each of these its own code in Vendors
              before relying on automatic matching.
            </p>
          </div>
        )}

        {!master.loading && master.error && (
          <p className="mt-3 text-[10.5px] text-biome-muted">{master.error}</p>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-biome-leafBright" />
          <span id="appearance" className="scroll-mt-24" /><h2 className="font-display text-sm font-medium text-biome-text">Appearance</h2>
        </div>
        {/* Colour mode */}
        <div className="mb-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-biome-text">
            <Palette size={13} /> Colour mode
          </p>
          <div className="flex gap-2">
            {(
              [
                ["light", "Light · Paper", Sun],
                ["dark", "Dark · Moss", Moon],
                ["command", "Command · Teal", Factory],
                ["midnight", "Midnight · Neon", Moon],
                ["sunrise", "Sunrise · Ember", Sun],
              ] as [ColorMode, string, typeof Sun][]
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                onClick={() => {
                  setColorMode(mode);
                  setColorModeState(mode);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors ${
                  colorMode === mode
                    ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leafBright"
                    : "border-biome-line bg-biome-hover text-biome-muted hover:text-biome-text"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-biome-muted/70">
            Light and Dark remain unchanged. <span className="text-biome-leafBright">BIOME Command</span> adds the new Splash/Login visual language across dashboard surfaces — glass panels, industrial telemetry accents, cyan/emerald energy cues and subtle motion.
          </p>
        </div>

        {/* Font family */}
        <div className="mb-3">
          <p className="mb-2 text-[11px] font-medium text-biome-text">Font</p>
          <div className="flex flex-wrap gap-2">
            {FONT_CHOICES.map((f) => (
              <button key={f.id} onClick={() => { setFont(f.id); setFontState(f.id); }} title={f.note}
                className={`rounded-xl border px-3 py-2 text-[11px] transition-all ${font === f.id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                <span className="block font-semibold">{f.label}</span>
                <span className="block text-[9.5px] opacity-70">{f.note}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Accent colour */}
        <div className="mb-3">
          <p className="mb-2 text-[11px] font-medium text-biome-text">Accent colour</p>
          <div className="flex flex-wrap gap-2">
            {ACCENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setAccent(opt.id);
                  setAccentState(opt.id);
                }}
                title={opt.label}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition-all ${
                  accent === opt.id
                    ? "border-biome-line bg-biome-hover text-biome-text"
                    : "border-biome-line bg-biome-hover text-biome-muted hover:text-biome-text"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-biome-line"
                  style={{ backgroundColor: opt.swatch }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-xl border border-biome-line bg-biome-hover px-4 py-3">
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
      </GlassCard>
    </div>
  );
}
