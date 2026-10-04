"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Loader2, AlertCircle, Check, X, Search, Users, ToggleLeft,
  Megaphone, ScrollText, Lock, Unlock, Send, Pin, Mail, EyeOff, Factory,
} from "lucide-react";
import FormPanel, { FormSection } from "@/components/FormPanel";
import DataTab from "@/components/developer/DataTab";
import ServerTab from "@/components/developer/ServerTab";
import PlantsTab from "@/components/developer/PlantsTab";
import { PERMISSION_INFO, permissionsFor, type Role } from "@/lib/permissions";

/**
 * The developer console.
 *
 * Four things, in the order they are used: who may do what, which modules
 * are switched on, notices, and this account's own activity.
 *
 * The activity tab is the one worth explaining. The business asked for the
 * developer's movements to be invisible to everyone else, and they are —
 * `/audit` filters them out for every other role. They are still WRITTEN,
 * and they are shown here. A record nobody keeps cannot be produced later,
 * and if this account ever leaves the family the difference matters.
 */

type Tab = "access" | "features" | "plants" | "notices" | "activity" | "data" | "server";

interface DevUser {
  id: string; username: string; name: string; role: string;
  plants: string[]; active: boolean;
  access: { granted: string[]; revoked: string[]; note: string; updatedBy: string; updatedAt: string } | null;
  rolePermissions: string[];
  effective: string[];
}
interface FeatureRow {
  id: string; label: string; state: "live" | "readonly" | "off";
  message: string; changedBy: string; changedAt: string;
}

export default function DeveloperPage() {
  const [tab, setTab] = useState<Tab>("access");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/developer", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load.");
      setData(json);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "access", label: "Access", icon: <Users size={13} /> },
    { id: "features", label: "Features", icon: <ToggleLeft size={13} /> },
    { id: "plants", label: "Plants", icon: <Factory size={13} /> },
    { id: "notices", label: "Notices", icon: <Megaphone size={13} /> },
    { id: "activity", label: "My activity", icon: <ScrollText size={13} /> },
    { id: "server", label: "Server & devices", icon: <ShieldCheck size={13} /> },
    { id: "data", label: "Data (delete)", icon: <AlertCircle size={13} /> },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <ShieldCheck size={19} className="text-biome-leaf" /> Developer
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-biome-muted">
            <EyeOff size={12} /> This account and everything on this screen are invisible to every other role.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold transition ${
                tab === t.id ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {!data ? <p className="text-[11.5px] text-biome-muted">Loading…</p>
        : tab === "access" ? <AccessTab data={data} onChanged={load} />
        : tab === "features" ? <FeaturesTab data={data} onChanged={load} />
        : tab === "notices" ? <NoticesTab />
        : tab === "data" ? <DataTab />
        : tab === "server" ? <ServerTab />
        : tab === "plants" ? <PlantsTab />
        : <ActivityTab activity={data.activity || []} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

function AccessTab({ data, onChanged }: { data: any; onChanged: () => void }) {
  const [editing, setEditing] = useState<DevUser | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [granted, setGranted] = useState<string[]>([]);
  const [revoked, setRevoked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const users: DevUser[] = data.users || [];
  const permissions: string[] = data.permissions || [];
  const developerOnly: string[] = data.developerOnly || [];

  const shown = users.filter((u) =>
    !query.trim() || `${u.name} ${u.username} ${u.role}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  function open(u: DevUser) {
    setEditing(u);
    setRole(u.role);
    setGranted(u.access?.granted || []);
    setRevoked(u.access?.revoked || []);
    setNote(u.access?.note || "");
    setErr(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/developer", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        // Only real exceptions are stored: an "activated" feature the role
        // already gives, or a "deactivated" one it never gave, is dropped.
        body: JSON.stringify({ id: editing.id, role, access: {
          granted: granted.filter((p) => !roleGives.includes(p)),
          revoked: revoked.filter((p) => roleGives.includes(p)),
          note,
        } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      setEditing(null);
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  // What the role gives by default — read from the role table itself, so
  // it is right even when nobody else holds this role yet.
  const roleGives = useMemo(() => permissionsFor(role as Role) as string[], [role]);
  const [showOnly, setShowOnly] = useState<"all" | "active" | "inactive">("all");

  /** Active for this person = role default, plus activated, minus deactivated. */
  const isActive = (p: string) => !revoked.includes(p) && (granted.includes(p) || roleGives.includes(p));
  const activeCount = permissions.filter(isActive).length;
  const changedCount = granted.filter((p) => !roleGives.includes(p)).length + revoked.filter((p) => roleGives.includes(p)).length;

  /**
   * Activate or Deactivate one feature for this person. Only the
   * difference from the role is stored: deactivating a role default adds
   * an exception; turning an exception back clears it.
   */
  function flip(p: string) {
    const inRole = roleGives.includes(p);
    if (isActive(p)) {
      setGranted(granted.filter((x) => x !== p));
      setRevoked(inRole ? [...revoked.filter((x) => x !== p), p] : revoked.filter((x) => x !== p));
    } else {
      setRevoked(revoked.filter((x) => x !== p));
      setGranted(inRole ? granted.filter((x) => x !== p) : [...granted.filter((x) => x !== p), p]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-[320px]">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person"
          className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none" />
      </div>

      <div className="space-y-2">
        {shown.map((u) => {
          const exceptions = (u.access?.granted.length || 0) + (u.access?.revoked.length || 0);
          const activeNow = u.effective.length;
          return (
            <article key={u.id} onClick={() => open(u)}
              className="bmx-card cursor-pointer rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-semibold text-biome-text">{u.name}</p>
                <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
                  {u.role}
                </span>
                {!u.active && (
                  <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold text-rose-500">
                    disabled
                  </span>
                )}
                {exceptions > 0 && (
                  <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600">
                    {exceptions} changed from role
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10.5px] text-biome-muted">
                {u.username}
                {u.plants.length ? ` · ${u.plants.join(", ")}` : ""}
                {" · "}{activeNow} of {permissions.length} features active
                {u.access?.note ? ` · ${u.access.note}` : ""}
              </p>
            </article>
          );
        })}
      </div>

      <FormPanel
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        icon={<Users size={20} />}
        eyebrow="Access"
        title={editing?.name || ""}
        subtitle="The role is the rule. Anything below it is an exception to that rule, and it stays visible as one."
        footer={
          <>
            <button onClick={() => setEditing(null)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={save} disabled={busy}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save access
            </button>
          </>
        }
      >
        {err && <p className="mb-4 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3 text-[11.5px] text-biome-text">{err}</p>}

        <FormSection title="Role" sectionIcon={<ShieldCheck size={14} />} columns={2}
          hint="Changing the role changes everything the person can do. Saving forces them to sign in again — a deactivated feature that kept working until their cookie expired would not really be deactivated.">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text">
              {(data.roles || []).map((r: any) => <option key={r.id} value={r.id}>{r.label} — {r.description}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Why (kept on the record)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Covering for accounts until 30 Sep"
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
          </label>
        </FormSection>

        <FormSection title="Feature access" sectionIcon={<Unlock size={14} />} columns={1}
          hint="Every feature, and whether it is Active or Inactive for this person right now. The role decides the default; Activate or Deactivate makes an exception for this one person, and it stays marked as one. Inactive features are hidden from their menu, search and home tiles.">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-bold text-emerald-600">
              {activeCount} active
            </span>
            <span className="rounded-full border border-biome-line px-2.5 py-1 text-[10.5px] font-bold text-biome-muted">
              {permissions.length - activeCount} inactive
            </span>
            {changedCount > 0 && (
              <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[10.5px] font-bold text-amber-600">
                {changedCount} changed from the role
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setShowOnly(f)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${showOnly === f ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"}`}>
                  {f}
                </button>
              ))}
              {changedCount > 0 && (
                <button type="button" onClick={() => { setGranted([]); setRevoked([]); }}
                  className="rounded-full border border-biome-line px-2.5 py-1 text-[10px] font-bold text-biome-muted hover:text-biome-text">
                  Reset to role default
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {permissions.filter((p) => showOnly === "all" || (showOnly === "active") === isActive(p)).map((p) => {
              const isDevOnly = developerOnly.includes(p);
              const inRole = roleGives.includes(p);
              const active = isActive(p);
              const g = granted.includes(p);
              const r = revoked.includes(p);
              const locked = isDevOnly && role !== "developer";
              const source = locked ? "Developer only"
                : g ? "Activated for this person"
                : r ? "Deactivated for this person"
                : inRole ? "Role default" : "Not in the role";
              return (
                <div key={p} data-perm={p} data-state={active ? "active" : "inactive"}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    active ? "border-emerald-500/30 bg-emerald-500/[.05]" : "border-biome-line bg-biome-bg/40"
                  }`}>
                  <div className="min-w-[200px] flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-biome-text" title={p}>
                      {PERMISSION_INFO[p]?.label || p}
                      {PERMISSION_INFO[p]?.risk === "high" && <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 text-[8.5px] font-bold uppercase text-rose-500">High risk</span>}
                    </p>
                    <p className="text-[10.5px] leading-snug text-biome-muted">{PERMISSION_INFO[p]?.what || p}</p>
                    <p className={`mt-0.5 text-[9.5px] font-semibold ${g ? "text-emerald-600" : r ? "text-rose-500" : "text-biome-muted"}`}>{source}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    active ? "bg-emerald-500/15 text-emerald-600" : "bg-biome-line/60 text-biome-muted"
                  }`}>
                    {active ? "Active" : "Inactive"}
                  </span>
                  <button type="button" role="switch" aria-checked={active} disabled={locked}
                    aria-label={`${active ? "Deactivate" : "Activate"} ${PERMISSION_INFO[p]?.label || p}`}
                    onClick={() => flip(p)}
                    className={`flex min-w-[118px] items-center gap-2 rounded-full border px-2 py-1 text-[10.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? "border-rose-500/35 text-rose-500 hover:bg-rose-500/10" : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                    }`}>
                    <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${active ? "bg-emerald-500" : "bg-biome-line"}`}>
                      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${active ? "left-3.5" : "left-0.5"}`} />
                    </span>
                    {active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              );
            })}
          </div>
        </FormSection>
      </FormPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

function FeaturesTab({ data, onChanged }: { data: any; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function set(id: string, state: string, message: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch("/api/developer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, state, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not switch that.");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const features: FeatureRow[] = data.features || [];

  return (
    <div className="space-y-3">
      <p className="max-w-[720px] text-[11.5px] leading-relaxed text-biome-muted">
        <strong className="text-biome-text">Frozen</strong> and <strong className="text-biome-text">Off</strong> both
        disappear from everyone&apos;s menu, search and home tiles (you still see them, marked). Frozen still answers
        reads if someone opens a saved link — only saving is refused; Off is refused by the server outright. Login, the audit log and Help &amp; Support are not on this list on purpose: switching off the way
        people report a problem turns a small outage into one nobody can tell you about.
      </p>

      {err && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{err}</p>
        </div>
      )}

      <div className="space-y-2">
        {features.map((f) => (
          <article key={f.id} className={`bmx-card rounded-2xl border p-4 ${
            f.state === "off" ? "border-rose-500/30 bg-rose-500/[.05]"
            : f.state === "readonly" ? "border-amber-500/30 bg-amber-500/[.05]"
            : "border-biome-line bg-biome-bgSoft"
          }`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] font-semibold text-biome-text">{f.label}</p>
              {f.state !== "live" && (
                <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${
                  f.state === "off" ? "border-rose-500/35 text-rose-500" : "border-amber-500/35 text-amber-600"
                }`}>
                  <Lock size={9} /> {f.state === "off" ? "off" : "frozen"}
                </span>
              )}
              {f.changedBy && (
                <span className="text-[9.5px] text-biome-muted">
                  {f.changedBy} · {f.changedAt.slice(0, 10)}
                </span>
              )}
            </div>

            {f.state !== "live" && f.message && (
              <p className="mt-1 text-[11px] leading-relaxed text-biome-muted">People see: &ldquo;{f.message}&rdquo;</p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <input
                value={drafts[f.id] ?? f.message}
                onChange={(e) => setDrafts({ ...drafts, [f.id]: e.target.value })}
                placeholder="What should people see when they hit this?"
                className="bmx-input min-w-[220px] flex-1 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
              />
              {(data.featureStates || []).map((s: any) => (
                <button key={s.id} title={s.help} disabled={busy === f.id}
                  onClick={() => set(f.id, s.id, drafts[f.id] ?? f.message)}
                  className={`bmx-chip rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60 ${
                    f.state === s.id ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}>
                  {busy === f.id ? <Loader2 size={11} className="bmx-spin" /> : s.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

function NoticesTab() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: "info", title: "", body: "", pinned: false, expiresOn: "",
    roles: [] as string[], plants: [] as string[], userIds: [] as string[],
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/announcements", { cache: "no-store" });
    setData(await res.json().catch(() => ({})));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post() {
    setBusy("new"); setErr(null);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind, title: form.title, body: form.body,
          pinned: form.pinned, expiresOn: form.expiresOn,
          audience: {
            roles: form.roles.length ? form.roles : "all",
            plants: form.plants, userIds: form.userIds,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not post that.");
      setOpen(false);
      setForm({ kind: "info", title: "", body: "", pinned: false, expiresOn: "", roles: [], plants: [], userIds: [] });
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function act(id: string, action: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch("/api/announcements", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That did not go through.");
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  const list = (data?.all || []) as any[];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-[600px] text-[11.5px] leading-relaxed text-biome-muted">
          A notice appears in the app straight away. Emailing it is a separate button — sending is never automatic,
          because a rule applied wrongly by a timer mails forty people something they should not have received.
        </p>
        <button onClick={() => setOpen(true)}
          className="bmx-btn flex shrink-0 items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
          <Megaphone size={14} /> Write a notice
        </button>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{err}</p>
        </div>
      )}

      {list.length === 0 && <p className="text-[11.5px] text-biome-muted">Nothing posted yet.</p>}

      <div className="space-y-2">
        {list.map((a) => {
          const sent = (a.deliveries || []).filter((d: any) => d.emailed).length;
          const failed = (a.deliveries || []).filter((d: any) => !d.emailed).length;
          return (
            <article key={a.id} className={`bmx-card rounded-2xl border p-4 ${
              a.withdrawnAt ? "border-biome-line opacity-60"
              : a.kind === "warning" ? "border-rose-500/30 bg-rose-500/[.05]"
              : "border-biome-line bg-biome-bgSoft"
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned && <Pin size={11} className="text-amber-600" />}
                <p className="text-[12.5px] font-semibold text-biome-text">{a.title}</p>
                <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
                  {a.kind}
                </span>
                {a.withdrawnAt && <span className="text-[9.5px] text-biome-muted">withdrawn</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-biome-muted">{a.body}</p>
              <p className="mt-1.5 text-[10px] text-biome-muted">
                {a.createdByName} · {a.createdAt.slice(0, 10)} · read by {a.readBy?.length || 0}
                {(a.deliveries || []).length > 0 && ` · emailed ${sent}`}
                {failed > 0 && `, ${failed} failed`}
              </p>
              {failed > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[10.5px] text-rose-500">{failed} did not receive it</summary>
                  <ul className="mt-1 space-y-0.5">
                    {(a.deliveries || []).filter((d: any) => !d.emailed).map((d: any, i: number) => (
                      <li key={i} className="text-[10px] text-biome-muted">{d.userName}: {d.error}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!a.withdrawnAt && (
                <div className="mt-2.5 flex gap-1.5">
                  <button onClick={() => act(a.id, "email")} disabled={busy === a.id}
                    className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted disabled:opacity-60">
                    {busy === a.id ? <Loader2 size={11} className="bmx-spin" /> : <Mail size={11} />} Email it
                  </button>
                  <button onClick={() => act(a.id, "withdraw")} disabled={busy === a.id}
                    className="bmx-chip rounded-lg border border-rose-500/35 px-3 py-1.5 text-[11px] font-semibold text-rose-500 disabled:opacity-60">
                    Withdraw
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <FormPanel
        open={open} onClose={() => setOpen(false)}
        icon={<Megaphone size={20} />}
        eyebrow="Developer"
        title="Write a notice"
        subtitle="It appears in the app immediately. Email is a second, deliberate step."
        footer={
          <>
            <button onClick={() => setOpen(false)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={post} disabled={busy === "new"}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              {busy === "new" ? <Loader2 size={14} className="bmx-spin" /> : <Send size={14} />} Post it
            </button>
          </>
        }
      >
        <FormSection title="The notice" sectionIcon={<Megaphone size={14} />} columns={2}>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Kind</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text">
              {(data?.kinds || []).map((k: any) => <option key={k.id} value={k.id}>{k.label} — {k.help}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Stop showing after (optional)</span>
            <input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
              className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
          </label>
          <div className="md:col-span-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Message</span>
              <textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="bmx-input w-full resize-y rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text" />
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--c-leaf))]" />
            <span className="text-[11.5px] text-biome-text">Pin it to the top until withdrawn</span>
          </label>
        </FormSection>

        <FormSection title="Who sees it" sectionIcon={<Users size={14} />} columns={1}
          hint="Roles and plants together mean BOTH — 'plant managers' plus 'REW' is the Rewari plant manager, not every plant manager and separately everyone at Rewari. Naming people overrides both.">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Roles</p>
            <div className="flex flex-wrap gap-1.5">
              {(data?.roles || []).map((r: any) => (
                <button key={r.id} type="button"
                  onClick={() => setForm({ ...form, roles: form.roles.includes(r.id) ? form.roles.filter((x) => x !== r.id) : [...form.roles, r.id] })}
                  className={`bmx-chip rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${
                    form.roles.includes(r.id) ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[9.5px] text-biome-muted">Pick none for everyone.</p>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Plants</p>
            <div className="flex flex-wrap gap-1.5">
              {(data?.plants || []).map((p: any) => (
                <button key={p.code} type="button"
                  onClick={() => setForm({ ...form, plants: form.plants.includes(p.code) ? form.plants.filter((x) => x !== p.code) : [...form.plants, p.code] })}
                  className={`bmx-chip rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${
                    form.plants.includes(p.code) ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Or name people</p>
            <div className="flex flex-wrap gap-1.5">
              {(data?.recipients || []).map((u: any) => (
                <button key={u.id} type="button"
                  onClick={() => setForm({ ...form, userIds: form.userIds.includes(u.id) ? form.userIds.filter((x) => x !== u.id) : [...form.userIds, u.id] })}
                  className={`bmx-chip rounded-lg border px-3 py-1.5 text-[11px] ${
                    form.userIds.includes(u.id) ? "border-biome-leaf/40 bg-biome-leaf/10 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}>
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        </FormSection>
      </FormPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

function ActivityTab({ activity }: { activity: any[] }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
          <EyeOff size={14} className="text-biome-leaf" /> Only you can see this
        </p>
        <p className="mt-1.5 max-w-[720px] text-[11.5px] leading-relaxed text-biome-muted">
          Your movements are filtered out of the audit log for every other role. They are still written down, and
          they are written here. That difference matters: a record nobody keeps cannot be produced later, and if
          this account ever sits with someone outside the family, &ldquo;nobody can see what they did&rdquo; stops
          being convenient and becomes the problem. Changes you make to <em>someone else&rsquo;s</em> access also
          appear in the ordinary audit log — that person has a right to know their access changed.
        </p>
      </div>

      {activity.length === 0 && <p className="text-[11.5px] text-biome-muted">Nothing recorded yet.</p>}

      <div className="space-y-1.5">
        {activity.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-biome-line px-3 py-2">
            <span className="font-mono text-[10px] text-biome-muted">{new Date(e.at).toLocaleString("en-IN")}</span>
            <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">
              {e.action}
            </span>
            <span className="text-[11.5px] font-semibold text-biome-text">{e.target}</span>
            <span className="flex-1 truncate text-[10.5px] text-biome-muted">{e.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
