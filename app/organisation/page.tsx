"use client";

import { useCallback, useEffect, useState } from "react";
import { Building, Plus, Loader2, AlertCircle, MapPin, Users, Briefcase } from "lucide-react";

/**
 * Organisation masters.
 *
 * Departments, designations and work locations, kept as lists so the
 * employee form offers choices instead of free text. A work location also
 * carries its state, which is what decides professional tax and the
 * minimum-wage floor for anyone posted there.
 */

interface Item { id: string; name: string; active: boolean; department?: string; stateKey?: string; state?: string; plantCode?: string; address?: string; }
interface Org { departments: Item[]; designations: Item[]; workLocations: Item[]; }

const STATES = [
  { key: "HR", name: "Haryana" },
  { key: "MH", name: "Maharashtra" },
  { key: "DL", name: "Delhi" },
  { key: "UP", name: "Uttar Pradesh" },
  { key: "PB", name: "Punjab" },
  { key: "RJ", name: "Rajasthan" },
];

export default function OrganisationPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ departments: "", designations: "", workLocations: "" });
  const [designationDept, setDesignationDept] = useState("");
  const [locState, setLocState] = useState("HR");
  const [locPlant, setLocPlant] = useState("");
  /** How many employees and app accounts use each entry. */
  const [usage, setUsage] = useState<Record<string, Record<string, { employees: number; users: number }>>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/org", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) { setOrg(json.org); setCanEdit(json.canEdit); setUsage(json.usage || {}); }
    else setError(json.error || `Failed (${res.status}).`);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(kind: keyof Org, extra: Record<string, unknown> = {}) {
    const name = draft[kind].trim();
    if (!name) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/org", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setDraft({ ...draft, [kind]: "" });
      setOrg(json.org);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function toggle(kind: keyof Org, id: string, active: boolean) {
    const res = await fetch("/api/org", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, active }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setOrg(json.org); else setError(json.error || `Failed (${res.status}).`);
  }

  if (!org) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
          <Building size={19} className="text-biome-leaf" /> Organisation
        </h1>
        <p className="mt-1 text-[11.5px] text-biome-muted">
          Departments, designations and work locations. Everything on the employee form comes from
          these lists, so a report grouped by department actually groups.
        </p>
      </header>

      {!canEdit && (
        <div className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
          <p className="text-[11.5px] text-biome-muted">
            You can see these lists but not change them. Renaming a department after salaries have
            been grouped by it rewrites past reports, so it is kept to the admin.
          </p>
        </div>
      )}

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard
          icon={<Users size={15} className="text-biome-leaf" />}
          title="Departments"
          items={org.departments}
          usage={usage.departments || {}}
          canEdit={canEdit}
          busy={busy}
          value={draft.departments}
          onValue={(v) => setDraft({ ...draft, departments: v })}
          onAdd={() => add("departments")}
          onToggle={(id, a) => toggle("departments", id, a)}
          placeholder="Quality & Lab"
        />

        <ListCard
          icon={<Briefcase size={15} className="text-biome-leaf" />}
          title="Designations"
          items={org.designations}
          usage={usage.designations || {}}
          canEdit={canEdit}
          busy={busy}
          value={draft.designations}
          onValue={(v) => setDraft({ ...draft, designations: v })}
          onAdd={() => add("designations", { department: designationDept })}
          onToggle={(id, a) => toggle("designations", id, a)}
          placeholder="Shift Incharge"
          detail={(i) => i.department || ""}
          extra={
            canEdit ? (
              <select value={designationDept} onChange={(e) => setDesignationDept(e.target.value)} className={inputCls}>
                <option value="">No department</option>
                {org.departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            ) : null
          }
        />
      </div>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <MapPin size={15} className="text-biome-leaf" /> Work locations
        </h2>
        <p className="mt-1 text-[11px] text-biome-muted">
          The state matters: professional tax and the minimum-wage floor both follow it. Rewari is
          in Haryana, Gangakhed in Maharashtra, and the two are not interchangeable.
        </p>

        {canEdit && (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input value={draft.workLocations} onChange={(e) => setDraft({ ...draft, workLocations: e.target.value })}
              placeholder="Location name" className={inputCls} />
            <select value={locState} onChange={(e) => setLocState(e.target.value)} className={inputCls}>
              {STATES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <input value={locPlant} onChange={(e) => setLocPlant(e.target.value)}
              placeholder="Plant code (REW / GKD), or blank" className={inputCls} />
            <button
              onClick={() => add("workLocations", {
                stateKey: locState,
                state: STATES.find((s) => s.key === locState)?.name || "",
                plantCode: locPlant,
              })}
              disabled={busy}
              className="bmx-btn flex items-center justify-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="bmx-spin" /> : <Plus size={14} />} Add
            </button>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {org.workLocations.map((l) => (
            <div key={l.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-3 ${l.active ? "" : "opacity-55"}`}>
              <div className="min-w-[160px] flex-1">
                <p className="text-[12.5px] font-semibold text-biome-text">{l.name}</p>
                <p className="text-[10.5px] text-biome-muted">
                  {l.state || l.stateKey}{l.plantCode && ` · plant ${l.plantCode}`}{l.address && ` · ${l.address}`}
                </p>
              </div>
              <span className="normal-case rounded-full border border-biome-line px-2 py-0.5 text-[9.5px] font-semibold text-biome-muted">
                {usage.workLocations?.[l.name]?.employees
                  ? `${usage.workLocations[l.name].employees} employee${usage.workLocations[l.name].employees === 1 ? "" : "s"} · PT/ESI by ${l.state || l.stateKey}`
                  : "unused"}
              </span>
              {canEdit && (
                <button onClick={() => toggle("workLocations", l.id, !l.active)}
                  className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted">
                  {l.active ? "Retire" : "Restore"}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ListCard({
  icon, title, items, canEdit, busy, value, onValue, onAdd, onToggle, placeholder, detail, extra, usage = {},
}: {
  icon: React.ReactNode; title: string; items: Item[]; canEdit: boolean; busy: boolean;
  usage?: Record<string, { employees: number; users: number }>;
  value: string; onValue: (v: string) => void; onAdd: () => void;
  onToggle: (id: string, active: boolean) => void; placeholder: string;
  detail?: (i: Item) => string; extra?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">{icon} {title}</h2>

      {canEdit && (
        <div className="mt-3 space-y-2">
          {extra}
          <div className="flex gap-2">
            <input value={value} onChange={(e) => onValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onAdd()}
              placeholder={placeholder} className={inputCls} />
            <button onClick={onAdd} disabled={busy}
              className="bmx-btn flex shrink-0 items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {items.map((i) => (
          <div key={i.id} className={`flex items-center gap-3 rounded-xl border border-biome-line px-3 py-2 ${i.active ? "" : "opacity-55"}`}>
            <div className="flex-1">
              <p className="text-[12px] text-biome-text">{i.name}</p>
              {detail && detail(i) && <p className="text-[10px] text-biome-muted">{detail(i)}</p>}
            </div>
            {/* Where this entry is used: payroll employees and app accounts. */}
            {(usage[i.name]?.employees || 0) + (usage[i.name]?.users || 0) > 0 ? (
              <span className="normal-case rounded-full border border-biome-leaf/30 bg-biome-leaf/10 px-2 py-0.5 text-[9.5px] font-semibold text-biome-leafBright"
                title="Employees on payroll and app accounts that carry this">
                {usage[i.name]?.employees ? `${usage[i.name].employees} employee${usage[i.name].employees === 1 ? "" : "s"}` : ""}
                {usage[i.name]?.employees && usage[i.name]?.users ? " · " : ""}
                {usage[i.name]?.users ? `${usage[i.name].users} login${usage[i.name].users === 1 ? "" : "s"}` : ""}
              </span>
            ) : (
              <span className="normal-case text-[9.5px] text-biome-muted">unused</span>
            )}
            {canEdit && (
              <button onClick={() => onToggle(i.id, !i.active)}
                className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-[10px] font-semibold text-biome-muted">
                {i.active ? "Retire" : "Restore"}
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-[11.5px] text-biome-muted">Nothing on this list yet.</p>}
      </div>
    </section>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
