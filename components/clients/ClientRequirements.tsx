"use client";

import { useCallback, useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ShieldCheck,
  Plus,
  Loader2,
  CheckCircle2,
  Trash2,
  FileCheck2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PremiumButton from "@/components/ui/PremiumButton";
import { useNotifications } from "@/lib/notifications";
import { type Client, REQUIREMENTS, REQUIREMENT_KEYS } from "@/lib/whatsapp";

const BLANK: Client = { name: "", shortName: "", aliases: [], requires: [], dscOn: [], notes: "" };

/**
 * Every plant wants a different set of papers, and getting it wrong means
 * a truck turned away at the gate. This is the checklist the WhatsApp
 * module measures each supply against.
 */
export default function ClientRequirements() {
  const { notify } = useNotifications();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [openName, setOpenName] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ client: Client; originalName: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the client list.");
      setClients(json.clients || []);
    } catch (err) {
      notify({ kind: "warning", title: "Client list", detail: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(client: Client, originalName: string | null) {
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...client, originalName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save.");
      setClients(json.clients);
      setEditing(null);
      notify({
        kind: "success",
        title: `${client.name} saved`,
        detail: `${client.requires.length} documents required.`,
      });
    } catch (err) {
      notify({ kind: "warning", title: "Could not save client", detail: (err as Error).message });
    }
  }

  async function remove(name: string) {
    try {
      const res = await fetch(`/api/clients?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not remove.");
      setClients(json.clients);
    } catch (err) {
      notify({ kind: "warning", title: "Could not remove client", detail: (err as Error).message });
    }
  }

  if (loading) {
    return (
      <GlassCard className="flex items-center justify-center gap-2 py-14 text-xs text-biome-muted">
        <Loader2 size={14} className="animate-spin" /> Loading clients…
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[11.5px] leading-relaxed text-biome-muted">
          What each plant requires before a supply is considered documented. Started from the
          Coordinators&apos; SOP; edit it here whenever a client changes what they want.
        </p>
        <PremiumButton onClick={() => setEditing({ client: { ...BLANK }, originalName: null })}>
          <Plus size={13} /> Add client
        </PremiumButton>
      </div>

      {clients.map((c) => {
        const open = openName === c.name;
        return (
          <GlassCard key={c.name} className="overflow-hidden">
            <button
              onClick={() => setOpenName(open ? null : c.name)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-biome-hover"
            >
              <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }} className="mt-0.5">
                <ChevronDown size={15} className="text-biome-muted" />
              </motion.span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-biome-text">{c.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.requires.map((r) => (
                    <span
                      key={r}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                        c.dscOn.includes(r)
                          ? "border-biome-bolt/30 bg-biome-bolt/10 text-biome-bolt"
                          : "border-biome-line bg-biome-hover text-biome-muted"
                      }`}
                    >
                      {c.dscOn.includes(r) && <ShieldCheck size={9} />}
                      {REQUIREMENTS[r] || r}
                    </span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-biome-muted/70">
                {c.requires.length} required
              </span>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 border-t border-biome-line px-4 py-3">
                    {c.notes && (
                      <p className="flex items-start gap-2 rounded-xl border border-biome-bolt/20 bg-biome-bolt/5 px-3 py-2 text-[11px] leading-relaxed text-biome-bolt/90">
                        <ShieldCheck size={12} className="mt-0.5 shrink-0" /> {c.notes}
                      </p>
                    )}
                    {c.aliases.length > 0 && (
                      <p className="text-[10.5px] leading-relaxed text-biome-muted">
                        <span className="uppercase tracking-wider text-biome-muted/60">Also matches: </span>
                        {c.aliases.join(", ")}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <PremiumButton
                        variant="ghost"
                        onClick={() => setEditing({ client: { ...c }, originalName: c.name })}
                      >
                        Edit requirements
                      </PremiumButton>
                      <PremiumButton variant="ghost" onClick={() => remove(c.name)}>
                        <Trash2 size={13} /> Remove
                      </PremiumButton>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        );
      })}

      <AnimatePresence>
        {editing && (
          <ClientEditor
            client={editing.client}
            originalName={editing.originalName}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientEditor({
  client,
  originalName,
  onCancel,
  onSave,
}: {
  client: Client;
  originalName: string | null;
  onCancel: () => void;
  onSave: (c: Client, original: string | null) => void;
}) {
  const [form, setForm] = useState<Client>(client);
  const [saving, setSaving] = useState(false);

  function toggle(list: "requires" | "dscOn", key: string) {
    setForm((f) => {
      const has = f[list].includes(key);
      const next = has ? f[list].filter((k) => k !== key) : [...f[list], key];
      // Unticking a required document also drops its DSC rule, so the two
      // lists can never disagree.
      if (list === "requires" && has) return { ...f, requires: next, dscOn: f.dscOn.filter((k) => k !== key) };
      return { ...f, [list]: next };
    });
  }

  const input =
    "w-full rounded-xl border border-biome-line bg-white/[0.03] px-3 py-2 text-[11.5px] text-biome-text outline-none transition-colors placeholder:text-biome-muted/50 focus:border-biome-leaf/40";

  return (
    <Portal><motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e: any) => e.stopPropagation()}
        className="glass max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-biome-line p-5"
      >
        <h3 className="font-display text-sm font-semibold text-biome-text">
          {originalName ? `Requirements — ${originalName}` : "Add a client"}
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">
          Tick what this plant requires. Tick the shield as well where the document must carry a
          Digital Signature Certificate.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Client name</span>
            <input
              value={form.name}
              onChange={(e: any) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="NTPC Limited – Tanda"
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Short name</span>
            <input
              value={form.shortName}
              onChange={(e: any) => setForm((f) => ({ ...f, shortName: e.target.value }))}
              placeholder="NTPC Tanda"
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-biome-muted">Also matches (comma separated)</span>
            <input
              value={form.aliases.join(", ")}
              onChange={(e: any) =>
                setForm((f) => ({
                  ...f,
                  aliases: e.target.value.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean),
                }))
              }
              placeholder="tanda, ntpc tanda"
              className={input}
            />
          </label>
        </div>

        <p className="mb-2 mt-4 text-[9.5px] font-semibold uppercase tracking-wider text-biome-muted/60">
          Required documents
        </p>
        <div className="space-y-1.5">
          {REQUIREMENT_KEYS.map((key) => {
            const required = form.requires.includes(key);
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                  required ? "border-biome-leaf/25 bg-biome-leaf/[0.06]" : "border-biome-line bg-biome-hover"
                }`}
              >
                <label className="flex flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={() => toggle("requires", key)}
                    className="h-3.5 w-3.5 accent-[#9CCC65]"
                  />
                  <span className={`text-[11.5px] ${required ? "text-biome-text" : "text-biome-muted"}`}>
                    {REQUIREMENTS[key]}
                  </span>
                </label>
                {/* Driver mobile is a phone number, not a document, so it can't carry a signature. */}
                {required && key !== "driver_mobile" && (
                  <label
                    className="flex cursor-pointer items-center gap-1.5"
                    title="This document must carry a Digital Signature Certificate"
                  >
                    <input
                      type="checkbox"
                      checked={form.dscOn.includes(key)}
                      onChange={() => toggle("dscOn", key)}
                      className="h-3.5 w-3.5 accent-[#FDE047]"
                    />
                    <ShieldCheck
                      size={12}
                      className={form.dscOn.includes(key) ? "text-biome-bolt" : "text-biome-muted/50"}
                    />
                    <span className="text-[10px] text-biome-muted">DSC</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[10.5px] text-biome-muted">Note shown to coordinators</span>
          <textarea
            value={form.notes}
            onChange={(e: any) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="DSC must be attached to both documents."
            className={`${input} resize-none`}
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <PremiumButton variant="ghost" onClick={onCancel}>
            Cancel
          </PremiumButton>
          <PremiumButton
            onClick={() => {
              setSaving(true);
              onSave(form, originalName);
            }}
            disabled={!form.name || form.requires.length === 0 || saving}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Save requirements
          </PremiumButton>
        </div>
      </motion.div>
    </motion.div></Portal>
  );
}
