"use client";

import { useEffect, useMemo, useState } from "react";
import { UserRound, Users, X, Loader2, Check, History, AlertTriangle, Download, UserCog } from "lucide-react";
import Portal from "@/components/Portal";

/**
 * Responsible person / team for vendors and clients, and the one-time
 * imports of the owner's vendor code list and client list.
 *
 * Shared by Vendor registration and Client registration. Every dialog
 * here scrolls inside itself with a fixed header and footer and closes
 * with the X, Escape, a click on the backdrop or Cancel.
 */

export interface Person { id: string; name: string; role: string; team: string }
export interface Team { id: string; label: string }
export interface ResponsibleFields {
  responsibleUserId?: string; responsibleName?: string;
  backupUserId?: string; backupName?: string; team?: string;
  responsibilityUpdatedAt?: string; responsibilityUpdatedBy?: string;
  responsibilityHistory?: { at: string; byName: string; from: string; to: string }[];
}

const ROLE_LABEL: Record<string, string> = {
  developer: "Developer", admin: "Admin", accounts: "Accounts", coordinator: "Coordinator",
  plant_manager: "Plant manager", procurement: "Procurement",
};

const TEAM_TONE: Record<string, string> = {
  coordination: "border-cyan-500/40 bg-cyan-500/10 text-cyan-600",
  management: "border-violet-500/40 bg-violet-500/10 text-violet-600",
  plant: "border-lime-500/40 bg-lime-500/10 text-lime-600",
  procurement: "border-orange-500/40 bg-orange-500/10 text-orange-600",
  accounts: "border-sky-500/40 bg-sky-500/10 text-sky-600",
};

export function teamLabel(teams: Team[], id?: string) {
  return teams.find((t) => t.id === id)?.label || "";
}

/** "Handled by" chip — name, team colour; "Unassigned" when nobody is. */
export function ResponsibleChip({ p, teams, me, compact }: { p: ResponsibleFields; teams: Team[]; me?: string; compact?: boolean }) {
  if (!p.responsibleName) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-biome-line px-1.5 py-0.5 text-[9px] font-semibold text-biome-muted" data-testid="responsible-chip" data-name="">
        <UserRound size={9} /> Unassigned
      </span>
    );
  }
  const mine = me && (p.responsibleUserId === me || p.backupUserId === me);
  const tone = TEAM_TONE[p.team || ""] || "border-biome-line bg-biome-hover text-biome-text";
  return (
    <span title={`Responsible: ${p.responsibleName}${p.team ? ` · ${teamLabel(teams, p.team)}` : ""}${p.backupName ? ` · backup ${p.backupName}` : ""}${p.responsibleUserId ? "" : " (no app login)"}`}
      className={`inline-flex max-w-[180px] items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone} ${mine ? "ring-1 ring-biome-leaf/60" : ""}`}
      data-testid="responsible-chip" data-name={p.responsibleName}>
      <UserRound size={9} className="shrink-0" />
      <span className="truncate">{mine ? `${p.responsibleUserId === me ? "You" : `${p.responsibleName} (you: backup)`}` : p.responsibleName}</span>
      {!compact && p.team && <span className="shrink-0 opacity-75">· {teamLabel(teams, p.team)}</span>}
    </span>
  );
}

/** Esc + no page scroll while a dialog is up. */
function useDialog(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose, busy]);
}

function Shell({ title, icon, onClose, busy, children, footer, wide, testid }: {
  title: string; icon: React.ReactNode; onClose: () => void; busy: boolean; children: React.ReactNode; footer: React.ReactNode; wide?: boolean; testid?: string;
}) {
  useDialog(onClose, busy);
  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} data-testid={testid ? `${testid}-backdrop` : undefined}>
        <div role="dialog" aria-modal="true" data-testid={testid}
          className={`flex max-h-[88vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} flex-col overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft shadow-2xl`}>
          <div className="flex shrink-0 items-center gap-2 border-b border-biome-line px-5 py-3.5">
            {icon}
            <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-biome-text">{title}</h3>
            <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded-lg border border-biome-line p-1.5 text-biome-muted hover:bg-biome-hover"><X size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-biome-line px-5 py-3">{footer}</div>
        </div>
      </div>
    </Portal>
  );
}

const inputCls = "w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none focus:border-biome-leaf/50";
const NO_LOGIN = "__name__";

/** Person picker: an active user, or a typed name for someone without a login. */
function PersonPicker({ label, people, userId, name, onChange, exclude, testid }: {
  label: string; people: Person[]; userId: string; name: string; exclude?: string; testid: string;
  onChange: (v: { userId: string; name: string }) => void;
}) {
  // "Someone without a login" stays chosen while the name is still empty.
  const [typing, setTyping] = useState(!userId && Boolean(name));
  const mode = userId ? userId : typing || name ? NO_LOGIN : "";
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">{label}</span>
      <select value={mode} data-testid={`${testid}-select`} className={inputCls}
        onChange={(e) => {
          const v = e.target.value;
          setTyping(v === NO_LOGIN);
          if (!v) onChange({ userId: "", name: "" });
          else if (v === NO_LOGIN) onChange({ userId: "", name: userId ? "" : name || "" });
          else onChange({ userId: v, name: people.find((p) => p.id === v)?.name || "" });
        }}>
        <option value="">— Nobody —</option>
        {people.filter((p) => p.id !== exclude).map((p) => (
          <option key={p.id} value={p.id}>{p.name} · {ROLE_LABEL[p.role] || p.role}</option>
        ))}
        <option value={NO_LOGIN}>Someone without a login (type the name)…</option>
      </select>
      {mode === NO_LOGIN && (
        <input value={name} onChange={(e) => onChange({ userId: "", name: e.target.value })} autoFocus data-testid={`${testid}-name`}
          placeholder="e.g. Director — Tanesh Singh Dod" className={`${inputCls} mt-1.5`} />
      )}
    </label>
  );
}

/** Assign the responsible person / backup / team to one record or many (bulk). */
export function AssignModal({ count, label, initial, people, teams, onClose, onDone }: {
  count: number; label: string; initial?: ResponsibleFields; people: Person[]; teams: Team[];
  onClose: () => void; onDone: (body: Record<string, string>) => Promise<string | void>;
}) {
  const [main, setMain] = useState({ userId: initial?.responsibleUserId || "", name: initial?.responsibleName || "" });
  const [backup, setBackup] = useState({ userId: initial?.backupUserId || "", name: initial?.backupName || "" });
  const [team, setTeam] = useState(initial?.team || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!main.userId && main.name.trim() === "" && (backup.userId || backup.name.trim())) { setErr("Choose the responsible person first — a backup alone is not enough."); return; }
    setBusy(true); setErr(null);
    try {
      await onDone({
        responsibleUserId: main.userId, responsibleName: main.userId ? "" : main.name.trim(),
        backupUserId: backup.userId, backupName: backup.userId ? "" : backup.name.trim(), team,
      });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Shell title={count > 1 ? `Assign responsible — ${count} selected` : `Responsible person — ${label}`} icon={<UserCog size={15} className="text-biome-leaf" />}
      onClose={onClose} busy={busy} testid="assign-modal"
      footer={<>
        {err && <p className="mr-auto text-[11px] font-semibold text-rose-500" data-testid="assign-error">{err}</p>}
        <button onClick={onClose} disabled={busy} className="rounded-xl border border-biome-line px-4 py-2 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="assign-save" className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
      </>}>
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-biome-muted">
          Who handles {count > 1 ? "these vendors / clients" : "this vendor / client"} — a coordinator, the plant manager, a procurement person,
          or the director himself (pick &ldquo;Someone without a login&rdquo; if he does not use the app). The person gets a notice in the app.
        </p>
        <PersonPicker label="Responsible person" people={people} userId={main.userId} name={main.name} testid="assign-main"
          onChange={(v) => {
            setMain(v);
            // Fill the team from the person's role when no team was chosen yet.
            if (!team && v.userId) { const t = people.find((p) => p.id === v.userId)?.team; if (t) setTeam(t); }
          }} />
        <PersonPicker label="Backup person (optional)" people={people} userId={backup.userId} name={backup.name} exclude={main.userId} testid="assign-backup" onChange={setBackup} />
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Team</span>
          <div className="flex flex-wrap gap-1.5" data-testid="assign-team">
            {[{ id: "", label: "None" }, ...teams].map((t) => (
              <button type="button" key={t.id || "none"} onClick={() => setTeam(t.id)}
                className={`rounded-full border px-3 py-1 text-[10.5px] font-semibold ${team === t.id ? "border-biome-leaf/60 bg-biome-leaf/15 text-biome-text" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </label>
      </div>
    </Shell>
  );
}

/** "Responsibility" block on the record: who, team, backup, history, Change. */
export function ResponsibilitySection({ p, teams, me, canManage, onChange }: {
  p: ResponsibleFields; teams: Team[]; me: string; canManage: boolean; onChange: () => void;
}) {
  const history = (p.responsibilityHistory || []).slice().reverse();
  return (
    <div className="rounded-2xl border border-biome-line bg-biome-bg p-4" data-testid="responsibility-section">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-biome-leaf/12 text-biome-leaf"><Users size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Responsible person</p>
          <p className="mt-0.5 text-[13px] font-semibold text-biome-text" data-testid="responsible-name">
            {p.responsibleName || "Nobody assigned yet"}
            {p.responsibleName && !p.responsibleUserId && <span className="ml-1.5 text-[10px] font-normal text-biome-muted">(no app login)</span>}
            {me && p.responsibleUserId === me && <span className="ml-1.5 rounded-full bg-biome-leaf/15 px-1.5 text-[10px] font-semibold text-biome-leaf">you</span>}
          </p>
          <p className="mt-0.5 text-[11px] text-biome-muted">
            {p.team ? `Team: ${teamLabel(teams, p.team)}` : "No team"}{p.backupName ? ` · Backup: ${p.backupName}` : ""}
            {p.responsibilityUpdatedAt ? ` · set ${p.responsibilityUpdatedAt.slice(0, 10)}${p.responsibilityUpdatedBy ? ` by ${p.responsibilityUpdatedBy}` : ""}` : ""}
          </p>
        </div>
        {canManage ? (
          <button onClick={onChange} data-testid="responsible-change"
            className="flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-text hover:bg-biome-hover">
            <UserCog size={12} /> Change
          </button>
        ) : (
          <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9.5px] text-biome-muted">Accounts / admin assign this</span>
        )}
      </div>
      {history.length > 0 && (
        <details className="mt-2">
          <summary className="flex cursor-pointer items-center gap-1 text-[10.5px] font-semibold text-biome-muted"><History size={11} /> Changes ({history.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((h, i) => (
              <li key={i} className="text-[10px] text-biome-muted">· {new Date(h.at).toLocaleString("en-IN")} — {h.from} → <span className="text-biome-text">{h.to}</span> by {h.byName}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Banner listing codes held by more than one vendor. */
export function DuplicateCodesBanner({ dups, onOpen }: { dups: { code: string; category: string; holders: { id: string; name: string }[] }[]; onOpen: (id: string) => void }) {
  if (!dups?.length) return null;
  return (
    <div className="rounded-2xl border-2 border-rose-500/50 bg-rose-500/[.08] px-4 py-3" data-testid="duplicate-codes-banner">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-rose-500">
        <AlertTriangle size={14} /> {dups.length === 1 ? "One code is" : `${dups.length} codes are`} given to more than one vendor — fix before relying on references
      </p>
      <p className="mt-0.5 text-[10.5px] text-biome-muted">A reference like BDC/841/<b>CODE</b>/37 cannot tell these apart, so WhatsApp documents may be filed against the wrong vendor. Open each one and give it its own code.</p>
      <ul className="mt-2 space-y-1">
        {dups.map((d) => (
          <li key={`${d.category}:${d.code}`} className="flex flex-wrap items-center gap-1.5 text-[11px] text-biome-text">
            <span className="rounded-md border border-rose-500/50 bg-rose-500/15 px-1.5 font-mono font-bold text-rose-600">{d.code}</span>
            <span className="text-[10px] text-biome-muted">{d.category === "trading" ? "Trading" : "Manufacturing"}:</span>
            {d.holders.map((h) => (
              <button key={h.id} onClick={() => onOpen(h.id)} className="rounded-full border border-biome-line bg-biome-bg px-2 py-0.5 text-[10.5px] font-semibold text-biome-text hover:border-rose-500/50">{h.name}</button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTION_TONE: Record<string, string> = {
  create: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  set_code: "border-sky-500/40 bg-sky-500/10 text-sky-600",
  exists: "border-biome-line text-biome-muted",
  unchanged: "border-biome-line text-biome-muted",
  conflict: "border-rose-500/40 bg-rose-500/10 text-rose-500",
};
const ACTION_LABEL: Record<string, string> = {
  create: "New", set_code: "Add code", exists: "Already registered", unchanged: "No change", conflict: "Conflict",
};

/** Preview + apply the owner's vendor code list or client list. */
export function ImportModal({ what, onClose, onImported }: { what: "vendors" | "clients"; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [dups, setDups] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyConflicts, setApplyConflicts] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [show, setShow] = useState("all");

  useEffect(() => {
    fetch(`/api/partners/import?what=${what}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Could not load the preview."); return j; })
      .then((j) => { setRows(j.rows || []); setDups(j.duplicates || []); })
      .catch((e) => setErr(e.message));
  }, [what]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows || []) c[r.action] = (c[r.action] || 0) + 1;
    return c;
  }, [rows]);
  const dupInList = (rows || []).filter((r) => r.dupInList);
  const listDupCodes = Array.from(new Set(dupInList.map((r) => r.code)));
  const willChange = (counts.create || 0) + (counts.set_code || 0) + (applyConflicts ? counts.conflict || 0 : 0) + (rows || []).filter((r) => r.action === "exists" && r.addAlias).length;

  async function apply() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/partners/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what, applyConflicts }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Import failed.");
      setResult(j);
      onImported();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const visible = (rows || []).filter((r) => show === "all" || r.action === show || (show === "dup" && r.dupInList));

  return (
    <Shell wide testid="import-modal" busy={busy} onClose={onClose}
      title={what === "vendors" ? "Import vendor code list" : "Import client list"} icon={<Download size={15} className="text-biome-leaf" />}
      footer={<>
        {err && <p className="mr-auto text-[11px] font-semibold text-rose-500">{err}</p>}
        {result ? (
          <button onClick={onClose} data-testid="import-close" className="rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white">Done</button>
        ) : (
          <>
            {what === "vendors" && (counts.conflict || 0) > 0 && (
              <label className="mr-auto flex items-center gap-1.5 text-[11px] text-biome-text">
                <input type="checkbox" checked={applyConflicts} onChange={(e) => setApplyConflicts(e.target.checked)} data-testid="import-apply-conflicts" />
                Apply the {counts.conflict} conflict(s) too (replace codes / create anyway)
              </label>
            )}
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-biome-line px-4 py-2 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={apply} disabled={busy || !rows || willChange === 0} data-testid="import-apply"
              className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {willChange ? `Import (${willChange} change${willChange === 1 ? "" : "s"})` : "Nothing to import"}
            </button>
          </>
        )}
      </>}>
      {result ? (
        <div className="space-y-2 text-[11.5px] text-biome-text" data-testid="import-result">
          <p className="font-semibold text-emerald-600">Imported.</p>
          {result.created?.length > 0 && <p><b>{result.created.length} created</b> (as draft, trading): {result.created.join(", ")}</p>}
          {result.coded?.length > 0 && <p><b>{result.coded.length} code(s) set</b>: {result.coded.join(", ")}</p>}
          {result.aliased?.length > 0 && <p><b>{result.aliased.length} spelling(s) added as alias</b>: {result.aliased.join("; ")}</p>}
          {result.skipped?.length > 0 && <p className="text-amber-600"><b>{result.skipped.length} left for you to check</b>: {result.skipped.join("; ")}</p>}
          {!result.created?.length && !result.coded?.length && !result.aliased?.length && <p className="text-biome-muted">Nothing needed changing.</p>}
          {(result.duplicates || []).length > 0 && (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/[.08] px-3 py-2 font-semibold text-rose-500">
              Duplicate codes now in the register: {(result.duplicates || []).map((d: any) => `${d.code} (${d.holders.map((h: any) => h.name).join(", ")})`).join("; ")} — give each vendor its own code.
            </p>
          )}
        </div>
      ) : !rows ? (
        <p className="flex items-center gap-2 py-8 text-[12px] text-biome-muted">{err ? err : <><Loader2 size={14} className="animate-spin" /> Checking the list against the register…</>}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-biome-muted">
            {what === "vendors"
              ? "The vendor codes you gave (used in references like BDC/841/AA/37) are matched by name to the TRADING vendors. Nothing is saved until you press Import. New vendors are created as drafts — add their GST, PAN, bank and KYC afterwards."
              : "Your client list is matched by name (and short name / aliases) to the TRADING clients, so nobody is registered twice. New clients are created as drafts; accounts then set their document requirements."}
          </p>
          {listDupCodes.length > 0 && (
            <div className="rounded-xl border-2 border-rose-500/50 bg-rose-500/[.08] px-3 py-2" data-testid="import-dup-warning">
              <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-rose-500"><AlertTriangle size={13} /> Your list gives the same code to more than one vendor</p>
              {listDupCodes.map((c) => (
                <p key={c} className="mt-0.5 text-[11px] text-biome-text"><span className="font-mono font-bold">{c}</span>: {dupInList.filter((r) => r.code === c).map((r) => r.name).join(", ")}</p>
              ))}
              <p className="mt-1 text-[10.5px] text-biome-muted">They are imported exactly as given and stay flagged in red on the register until each gets its own code.</p>
            </div>
          )}
          {dups.length > 0 && (
            <p className="text-[10.5px] text-rose-500">Already duplicated in the register: {dups.map((d: any) => `${d.code} (${d.holders.length})`).join(", ")}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {[["all", `All ${rows.length}`], ...Object.keys(ACTION_LABEL).filter((k) => counts[k]).map((k) => [k, `${ACTION_LABEL[k]} ${counts[k]}`]), ...(dupInList.length ? [["dup", `Duplicate code ${dupInList.length}`]] : [])].map(([id, l]) => (
              <button key={id} onClick={() => setShow(id)} className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${show === id ? "border-biome-leaf/60 bg-biome-leaf/15 text-biome-text" : "border-biome-line text-biome-muted"}`}>{l}</button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-biome-line">
            <table className="w-full text-left text-[11px]" data-testid="import-table">
              <thead className="bg-biome-hover text-[9.5px] uppercase tracking-[.1em] text-biome-muted">
                <tr><th className="px-3 py-2">Name in your list</th>{what === "vendors" && <th className="px-2 py-2">Code</th>}<th className="px-2 py-2">What happens</th></tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={i} className="border-t border-biome-line align-top" data-testid="import-row" data-action={r.action}>
                    <td className="px-3 py-1.5 text-biome-text">{r.name}</td>
                    {what === "vendors" && (
                      <td className="px-2 py-1.5"><span className={`rounded-md border px-1.5 font-mono font-semibold ${r.dupInList ? "border-rose-500/50 bg-rose-500/15 text-rose-600" : "border-biome-line text-biome-text"}`}>{r.code}</span></td>
                    )}
                    <td className="px-2 py-1.5">
                      <span className={`mr-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] ${ACTION_TONE[r.action] || ""}`}>{ACTION_LABEL[r.action] || r.action}</span>
                      <span className="text-biome-muted">{r.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
