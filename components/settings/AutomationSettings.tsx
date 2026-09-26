"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, MessageSquare, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { useNotifications } from "@/lib/notifications";

interface Settings {
  companyCodes: string[];
  allowedChats: string[];
  watchAllChats: boolean;
  ignoreOwnMessages: boolean;
  autoProcess: boolean;
}

export default function AutomationSettings() {
  const { notify } = useNotifications();
  const [settings, setSettings] = useState<Settings>({ companyCodes: ["BDC", "BIPL"], allowedChats: [], watchAllChats: false, ignoreOwnMessages: false, autoProcess: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp-settings", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load automation settings.");
      setSettings(json.settings);
    } catch (err) {
      notify({ kind: "warning", title: "Automation settings", detail: (err as Error).message });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next); setSaving(true);
    try {
      const res = await fetch("/api/whatsapp-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save automation settings.");
      notify({ kind: "success", title: "Automation setting saved", detail: "Restart the app/agent if WhatsApp is already running." });
    } catch (err) {
      setSettings(previous);
      notify({ kind: "warning", title: "Could not save", detail: (err as Error).message });
    } finally { setSaving(false); }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-biome-leaf/10 p-2.5"><SlidersHorizontal size={17} className="text-biome-leafBright" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold text-biome-text">Automation &amp; WhatsApp controls</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-biome-muted">Production controls for automatic document processing. The agent should only watch the sales/document chats you explicitly select.</p>
        </div>
        <button onClick={load} disabled={loading} title="Refresh" className="rounded-lg p-2 text-biome-muted hover:bg-biome-hover hover:text-biome-text"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle icon={Bot} title="Automatic processing" detail="Download, read, match and file incoming documents automatically." checked={settings.autoProcess} disabled={saving || loading} onChange={(v) => save({ autoProcess: v })} />
        <Toggle icon={MessageSquare} title="Ignore my non-document messages" detail="Do not process ordinary text messages sent from the linked phone." checked={settings.ignoreOwnMessages} disabled={saving || loading} onChange={(v) => save({ ignoreOwnMessages: v })} />
      </div>
      <div className="mt-3 rounded-xl border border-biome-sky/20 bg-biome-sky/5 p-3">
        <div className="flex items-start gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-biome-skyBright" /><div className="min-w-0">
          <p className="text-[11.5px] font-medium text-biome-text">Chat scope</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">{settings.watchAllChats ? "All WhatsApp chats are enabled by explicit choice." : settings.allowedChats.length ? `Restricted to ${settings.allowedChats.length} selected chat${settings.allowedChats.length === 1 ? "" : "s"}.` : "No chat is selected. Automatic processing is paused until the Sales group(s) are chosen."}</p>
          <Link href="/whatsapp" className="mt-2 inline-flex text-[10.5px] font-medium text-biome-skyBright hover:underline">Open WhatsApp group controls →</Link>
        </div></div>
      </div>
    </GlassCard>
  );
}

function Toggle({ icon: Icon, title, detail, checked, disabled, onChange }: { icon: typeof Bot; title: string; detail: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="flex items-start gap-3 rounded-xl border border-biome-line bg-biome-hover p-3 text-left transition-colors hover:bg-biome-hover disabled:opacity-60">
    <span className="mt-0.5 rounded-lg bg-biome-leaf/10 p-2 text-biome-leafBright"><Icon size={14} /></span>
    <span className="min-w-0 flex-1"><span className="block text-[11.5px] font-medium text-biome-text">{title}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-biome-muted">{detail}</span></span>
    <span className={`relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-biome-leaf" : "bg-biome-line"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} /></span>
  </button>;
}
