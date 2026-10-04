"use client";

import { useEffect, useState } from "react";
import Portal from "@/components/Portal";
import { UserPlus, Loader2, AlertCircle, ShieldCheck, KeyRound, Factory, Pencil, Trash2, X } from "lucide-react";
import { ROLES, Role } from "@/lib/permissions";
import { usePlants } from "@/lib/usePlants";
import { useSession } from "@/lib/session";

interface ListedUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  plants: string[];
  active: boolean;
  mustChangePassword: boolean;
  designation?: string;
  department?: string;
}

const BLANK = {
  username: "",
  name: "",
  role: "plant_manager" as Role,
  password: "",
  plants: [] as string[],
  // The job title and team this account belongs to. Both come from
  // Organisation, so "Accounts Manager" means the same thing on a payslip,
  // in a report grouped by department, and on this screen.
  designation: "",
  department: "",
};

export default function UsersPage() {
  const PLANTS = usePlants();
  const { user: me } = useSession();
  const isDeveloper = me?.role === "developer";
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  /** The account currently being edited, held separately from the list. */
  const [editing, setEditing] = useState<{ id: string; username: string; name: string } | null>(null);
  /** Designations and departments as Organisation defines them. */
  const [org, setOrg] = useState<{ designations: { id: string; name: string; active: boolean }[]; departments: { id: string; name: string; active: boolean }[] }>({ designations: [], departments: [] });

  useEffect(() => {
    fetch("/api/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const o = j?.org || j; if (o) setOrg({ designations: o.designations || [], departments: o.departments || [] }); })
      .catch(() => { /* the lists are a convenience; typing still works */ });
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setUsers(json.users || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setForm({ ...BLANK });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Permanent deletion.
   *
   * Two guards on purpose: the username has to be typed back, and the
   * server refuses outright if the account has left any trail. Disabling
   * remains the button people should reach for, so it stays the primary.
   */
  async function removeUser(u: ListedUser) {
    const typed = window.prompt(
      `Delete ${u.name} permanently?\n\nThis cannot be undone. Disabling keeps their history intact and is almost always the better choice.\n\nType "${u.username}" to confirm.`,
      ""
    );
    if (!typed) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/users?id=${u.id}&purge=1&confirm=${encodeURIComponent(typed)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server refuses to delete an account that left history behind.
        // The developer can override: the account becomes a tombstone, so
        // the history still resolves to a name while the login is destroyed.
        if (res.status === 409 && json.trail && isDeveloper) {
          const ok = window.confirm(
            `${u.name} has ${json.trail.total} record(s) against this account.\n\n` +
            `Delete anyway? The login is destroyed and the account disappears from this list. ` +
            `Their past entries and approvals keep showing their name.`
          );
          if (!ok) return;
          const forced = await fetch(
            `/api/users?id=${u.id}&purge=1&force=1&confirm=${encodeURIComponent(typed)}`,
            { method: "DELETE" }
          );
          const fj = await forced.json().catch(() => ({}));
          if (!forced.ok) throw new Error(fj.error || `Failed (${forced.status}).`);
          await load();
          return;
        }
        throw new Error(json.error || `Failed (${res.status}).`);
      }
      await load();
    } catch (err) { setError((err as Error).message); }
  }

  async function resetPassword(u: ListedUser) {
    const pw = window.prompt(
      `Set a temporary password for ${u.name}. They'll be asked to change it when they sign in.`,
      ""
    );
    if (!pw) return;
    await patch(u.id, { newPassword: pw });
  }

  const needsPlants = form.role === "plant_manager";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-.03em] text-biome-text">Users &amp; Access</h1>
        <p className="mt-1 text-[11.5px] text-biome-muted">
          Roles decide what each person can open. Plant managers see only plant work — no Tally, no
          WhatsApp.
        </p>
        {isDeveloper && (
          <a href="/developer" className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-biome-leaf/35 bg-biome-leaf/10 px-3 py-1.5 text-[11px] font-semibold text-biome-leaf">
            <ShieldCheck size={12} /> Feature access per person — see Active / Inactive, Activate or Deactivate
          </a>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {/* ---- Add a person ---- */}
      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <UserPlus size={15} className="text-biome-leaf" /> Add a person
        </h2>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Full name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ramesh Kumar"
              className={inputClass}
            />
          </Field>
          <Field label="Username">
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="ramesh"
              className={inputClass}
            />
          </Field>
          <Field label="Role">
            <select
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as Role, plants: [] })
              }
              className={inputClass}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <select
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
              className={inputClass}
            >
              <option value="">— none —</option>
              {org.designations.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className={inputClass}
            >
              <option value="">— none —</option>
              {org.departments.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Temporary password">
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
              className={inputClass}
            />
          </Field>
        </div>

        {/* Plants matter for field roles. An office role left without a
            plant simply isn't restricted to one. */}
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
            <Factory size={12} /> Plants {needsPlants && <span className="text-rose-500">required</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {PLANTS.map((p) => {
              const on = form.plants.includes(p.code);
              return (
                <button
                  key={p.code}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      plants: on
                        ? form.plants.filter((c) => c !== p.code)
                        : [...form.plants, p.code],
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-[11.5px] font-semibold transition ${
                    on
                      ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf"
                      : "border-biome-line text-biome-muted hover:text-biome-text"
                  }`}
                >
                  {p.label} ({p.code})
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={createUser}
          disabled={saving}
          className="mt-4 flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white transition hover:opacity-95 disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          Create account
        </button>
      </section>

      {editing && (
        <Portal><div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="bmx-panel-in w-full max-w-[420px] rounded-2xl border border-biome-line bg-biome-bgSoft p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-biome-text">Edit account</h3>
                <p className="mt-0.5 text-[11px] text-biome-muted">
                  Changing the username changes what this person signs in with — tell them.
                </p>
              </div>
              <button onClick={() => setEditing(null)} className="bmx-toggle rounded-lg p-1.5 text-biome-muted hover:text-biome-text">
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <Field label="Full name">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Username">
                <input value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} className={inputClass} />
              </Field>
            </div>

            <button
              onClick={async () => {
                await patch(editing.id, { name: editing.name, username: editing.username });
                setEditing(null);
              }}
              className="bmx-btn mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white"
            >
              <ShieldCheck size={14} /> Save
            </button>
          </div>
        </div></Portal>
      )}

      {/* ---- Existing people ---- */}
      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="text-[13px] font-semibold text-biome-text">People</h2>

        {loading ? (
          <p className="mt-3 text-[11.5px] text-biome-muted">Loading…</p>
        ) : (
          <div className="mt-3 space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-3 ${
                  u.active ? "" : "opacity-55"
                }`}
              >
                <div className="min-w-[160px] flex-1">
                  <p className="text-[12.5px] font-semibold text-biome-text">
                    {u.name}{" "}
                    {u.id === me?.id && (
                      <span className="text-[10px] font-normal text-biome-muted">(you)</span>
                    )}
                  </p>
                  <p className="text-[10.5px] text-biome-muted">
                    @{u.username}
                    {u.designation && ` · ${u.designation}`}
                    {u.department && ` · ${u.department}`}
                    {u.plants.length > 0 && ` · ${u.plants.join(", ")}`}
                    {u.mustChangePassword && " · password not set yet"}
                  </p>
                </div>

                <select
                  value={u.role}
                  onChange={(e) => patch(u.id, { role: e.target.value })}
                  className="rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text"
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>

                <div className="flex gap-1.5">
                  {PLANTS.map((p) => {
                    const on = u.plants.includes(p.code);
                    return (
                      <button
                        key={p.code}
                        onClick={() =>
                          patch(u.id, {
                            plants: on
                              ? u.plants.filter((c) => c !== p.code)
                              : [...u.plants, p.code],
                          })
                        }
                        className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                          on
                            ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf"
                            : "border-biome-line text-biome-muted"
                        }`}
                      >
                        {p.code}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setEditing({ id: u.id, username: u.username, name: u.name })}
                  className="flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted transition hover:text-biome-text"
                >
                  <Pencil size={12} /> Edit
                </button>

                <button
                  onClick={() => resetPassword(u)}
                  className="flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted transition hover:text-biome-text"
                >
                  <KeyRound size={12} /> Reset
                </button>

                <button
                  onClick={() => patch(u.id, { active: !u.active })}
                  className="rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted transition hover:text-biome-text"
                >
                  {u.active ? "Disable" : "Enable"}
                </button>

                {u.id !== me?.id && (
                  <button
                    onClick={() => removeUser(u)}
                    title="Delete permanently — disabling is usually the right choice"
                    className="rounded-lg p-1.5 text-biome-muted transition hover:text-rose-500"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none transition focus:border-biome-leaf/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
