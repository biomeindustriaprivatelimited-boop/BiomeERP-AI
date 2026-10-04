"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserCog, Plus, Loader2, AlertCircle, Check, Paperclip, FileText, ShieldAlert,
  Search, Snowflake, Contact, Landmark, Phone, ScrollText, Trash2, Hourglass, X, Undo2,
} from "lucide-react";
import { usePlants } from "@/lib/usePlants";
import FormPanel, { FormSection } from "@/components/FormPanel";
import { EmptyState } from "@/components/SetupGuide";

/**
 * The employee master.
 *
 * Its own screen rather than a tab inside payroll, because the people who
 * put someone on the rolls are not the people who run salaries: a plant
 * manager adds their own staff and uploads the paperwork, and never sees a
 * salary sheet. Payroll reads this master; it does not own it.
 *
 * The permission split the business set out is enforced by the server and
 * mirrored here so nothing is offered that would then be refused:
 *   add + documents — everyone except a coordinator
 *   edit + freeze + letters — admin only
 */

const money = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const SKILLS = [
  { id: "unskilled", label: "Unskilled" },
  { id: "semiskilled", label: "Semi-skilled" },
  { id: "skilled", label: "Skilled" },
  { id: "highlyskilled", label: "Highly skilled" },
];

interface Employee {
  id: string; code: string; name: string; designation: string; department: string;
  plant: string; workLocation: string; type: "staff" | "labour"; dateOfJoining: string;
  active: boolean; email: string; uan: string; esicNumber: string;
  pfApplicable: boolean; esicApplicable: boolean; dailyWage: number;
  structure: any; kyc: any; documents: any[]; letters: any[];
  compliance?: { level: string; message: string }[];
}

export default function EmployeesPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll/employees", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
    } catch (err) { setError((err as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const employees: Employee[] = data?.employees || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.code, e.designation, e.department, e.plant].join(" ").toLowerCase().includes(q)
    );
  }, [employees, query]);

  const open = employees.find((e) => e.id === openId) || null;
  const flagged = employees.filter((e) => (e.compliance || []).length > 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <UserCog size={19} className="text-biome-leaf" /> Employees
          </h1>
          <p className="mt-1 text-[11.5px] text-biome-muted">
            {data?.myPlant
              ? `Your plant's staff and labour. You can add people and upload their papers; changing or freezing a record is the admin's.`
              : "Everyone on the rolls, their papers and their letters."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or code"
              className="bmx-input w-[200px] rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[12px] text-biome-text outline-none"
            />
          </div>
          {(data?.pendingCount || 0) > 0 && (
            <a href="#pending-approval" data-testid="pending-badge"
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-600">
              <Hourglass size={13} /> {data.pendingCount} pending approval
            </a>
          )}
          {data?.canAdd && (
            <button onClick={() => setAddOpen(true)}
              className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
              <Plus size={14} /> Add employee
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {notice && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/[.07] px-4 py-3" data-testid="employees-notice">
          <Check size={15} className="mt-px shrink-0 text-emerald-600" />
          <p className="text-[11.5px] text-biome-text">{notice}</p>
        </div>
      )}

      {(data?.requests || []).length > 0 && (
        <RequestsPanel data={data} onChanged={load} setError={setError} />
      )}

      {flagged.length > 0 && (
        <div className="bmx-msg-in rounded-2xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-3">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
            <ShieldAlert size={14} className="text-amber-600" />
            {flagged.length} record{flagged.length > 1 ? "s need" : " needs"} attention
          </p>
          <ul className="mt-2 space-y-1">
            {flagged.slice(0, 5).flatMap((e) =>
              (e.compliance || []).map((c, i) => (
                <li key={`${e.id}-${i}`} className="text-[10.5px] leading-relaxed text-biome-muted">
                  <span className="font-semibold text-biome-text">{e.name}</span> — {c.message}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {!data ? (
        <p className="text-[11.5px] text-biome-muted">Loading…</p>
      ) : employees.length === 0 ? (
        <EmptyState
          title="Nobody on the rolls yet"
          detail={
            data.canAdd
              ? "Add your first person. Staff carry a monthly structure, labour a daily wage — payroll and attendance both read from here."
              : "Employees are added by accounts, the admin, or a plant manager."
          }
          action={data.canAdd ? { label: "Add employee", onClick: () => setAddOpen(true) } : undefined}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e, i) => (
            <button
              key={e.id}
              onClick={() => setOpenId(e.id)}
              className={`bmx-rise bmx-chip relative overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft p-4 text-left ${e.active ? "" : "opacity-60"}`}
              style={{ animationDelay: `${Math.min(i, 10) * 0.025}s` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-biome-text">{e.name}</p>
                  <p className="mt-0.5 truncate text-[10.5px] text-biome-muted">
                    {e.code} · {e.designation || (e.type === "labour" ? "Labour" : "Staff")}
                    {e.plant && ` · ${e.plant}`}
                  </p>
                </div>
                {(e.compliance || []).length > 0 && (
                  <span className={`shrink-0 rounded-lg border px-1.5 py-1 ${
                    e.compliance!.some((c) => c.level === "error")
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
                      : "border-amber-500/35 bg-amber-500/10 text-amber-600"
                  }`}>
                    <ShieldAlert size={11} />
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-biome-muted">
                <span className="font-mono text-biome-text">
                  {e.type === "labour" ? `${money(e.dailyWage)}/day` : money(
                    (e.structure?.basic || 0) + (e.structure?.hra || 0) + (e.structure?.conveyance || 0) +
                    (e.structure?.medical || 0) + (e.structure?.special || 0)
                  )}
                </span>
                <span className="inline-flex items-center gap-1"><Paperclip size={9} /> {e.documents?.length || 0}</span>
                <span className="inline-flex items-center gap-1"><ScrollText size={9} /> {e.letters?.length || 0}</span>
                {!e.active && <span className="text-rose-500">Frozen</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {data?.canAdd && (
        <AddEmployee
          open={addOpen}
          onClose={() => setAddOpen(false)}
          org={data.org}
          myPlant={data.myPlant}
          onSaved={(pending) => {
            setAddOpen(false);
            setNotice(pending
              ? "Sent for approval. The person becomes active — for attendance, leave and imprest — once the admin or developer approves."
              : "Employee added.");
            load();
          }}
        />
      )}

      {open && (
        <EmployeeDetail
          employee={open}
          data={data}
          onClose={() => setOpenId(null)}
          onChanged={load}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* New-employee requests (plant manager → admin / developer)           */
/* ------------------------------------------------------------------ */

const REQ_STATUS: Record<string, [string, string]> = {
  pending_approval: ["Pending approval", "border-amber-500/35 bg-amber-500/10 text-amber-600"],
  approved: ["Approved", "border-emerald-500/35 bg-emerald-500/10 text-emerald-600"],
  rejected: ["Rejected", "border-rose-500/35 bg-rose-500/10 text-rose-500"],
  withdrawn: ["Withdrawn", "border-biome-line text-biome-muted"],
};

function RequestsPanel({ data, onChanged, setError }: { data: any; onChanged: () => void; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const requests: any[] = data.requests || [];
  const office = !data.myPlant;

  async function act(id: string, action: "approve" | "reject" | "withdraw") {
    setBusy(id + action); setError(null);
    try {
      const res = await fetch("/api/payroll/employees", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason: reason[id] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section id="pending-approval" data-testid="pending-approval"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/[.04] p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
        <Hourglass size={14} className="text-amber-600" />
        {office ? "Pending approval" : "Your requests"}
        {data.pendingCount > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{data.pendingCount}</span>
        )}
      </h2>
      <p className="mt-0.5 text-[10.5px] text-biome-muted">
        {office
          ? data.canApprove
            ? "Plant managers asked to add these people. Nobody is active — in attendance, leave, imprest or payroll — until approved."
            : "Waiting for the admin or the developer. Accounts can see the queue but not decide it."
          : "People you asked to add. They appear in attendance, leave and imprest once approved."}
      </p>
      <div className="mt-3 space-y-2">
        {requests.map((r) => {
          const st = r.approval?.status || "pending_approval";
          const [label, cls] = REQ_STATUS[st] || REQ_STATUS.pending_approval;
          const pending = st === "pending_approval";
          const own = r.approval?.requestedBy?.uid === data.me;
          return (
            <div key={r.id} data-testid="employee-request" className="rounded-xl border border-biome-line bg-biome-bgSoft px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-semibold text-biome-text">{r.name}</p>
                <span className="text-[10.5px] text-biome-muted">
                  {r.code} · {r.designation || (r.type === "labour" ? "Labour" : "Staff")} · {r.plant}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>
              </div>
              <p className="mt-1 text-[10px] text-biome-muted">
                Asked by {r.approval?.requestedBy?.name} · {r.approval?.requestedAt ? new Date(r.approval.requestedAt).toLocaleString("en-IN") : ""}
                {r.approval?.decidedByName && !pending && ` · ${label.toLowerCase()} by ${r.approval.decidedByName}`}
              </p>
              {r.approval?.reason && !pending && (
                <p className="mt-1.5 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[10.5px] text-biome-text">
                  Reason: {r.approval.reason}
                </p>
              )}
              {pending && data.canApprove && office && (
                own ? (
                  <p className="mt-2 text-[10.5px] text-biome-muted">Your own request — another approver must decide it.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={reason[r.id] || ""} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })}
                      placeholder="Reason (required to reject)"
                      className="bmx-input min-w-[200px] flex-1 rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text outline-none" />
                    <button onClick={() => act(r.id, "approve")} disabled={Boolean(busy)}
                      className="bmx-btn flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
                      {busy === r.id + "approve" ? <Loader2 size={12} className="bmx-spin" /> : <Check size={12} />} Approve
                    </button>
                    <button onClick={() => act(r.id, "reject")} disabled={Boolean(busy) || !(reason[r.id] || "").trim()}
                      className="bmx-btn flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-bold text-rose-500 disabled:opacity-50">
                      <X size={12} /> Reject
                    </button>
                  </div>
                )
              )}
              {pending && !office && (
                <button onClick={() => act(r.id, "withdraw")} disabled={Boolean(busy)}
                  className="bmx-chip mt-2 flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted">
                  <Undo2 size={12} /> Withdraw
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function AddEmployee({
  open, onClose, org, myPlant, onSaved,
}: { open: boolean; onClose: () => void; org: any; myPlant: string | null; onSaved: (pending: boolean) => void }) {
  const PLANTS = usePlants();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    code: "", name: "", designation: "", department: "", plant: myPlant || "",
    workLocation: "", email: "", type: "staff",
    dateOfJoining: new Date().toISOString().slice(0, 10),
    basic: "", hra: "", conveyance: "", medical: "", special: "", dailyWage: "",
    pfApplicable: true, esicApplicable: true, uan: "", esicNumber: "",
    kyc: { skillCategory: "unskilled", fatherOrSpouse: "", dateOfBirth: "", gender: "",
      personalPhone: "", emergencyName: "", emergencyPhone: "", address: "",
      aadhaar: "", pan: "", bankName: "", bankAccount: "", bankIfsc: "" },
  });

  const setKyc = (k: string, v: string) => setForm({ ...form, kyc: { ...form.kyc, [k]: v } });

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          dailyWage: Number(form.dailyWage) || 0,
          structure: {
            basic: Number(form.basic) || 0, hra: Number(form.hra) || 0,
            conveyance: Number(form.conveyance) || 0, medical: Number(form.medical) || 0,
            special: Number(form.special) || 0, otherAllowances: [],
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onSaved(Boolean(json.pending));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <FormPanel
      open={open} onClose={onClose}
      title="Add an employee"
      subtitle="Papers can be uploaded once the record exists."
      footer={
        <>
          <button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
          <button onClick={save} disabled={busy}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Add employee
          </button>
        </>
      }
    >
      {myPlant && (
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/[.06] px-4 py-3 text-[11px] leading-relaxed text-biome-text">
          Adding to <b>your plant ({myPlant})</b>. This creates an employee <b>record</b> — not an app login —
          and goes to the admin for <b>approval</b>. Once approved you keep their attendance, leave and imprest
          here; pay can be left blank for accounts to fill in.
        </div>
      )}
      <FormSection title="Who they are" columns={3}>
        <Field label="Employee code"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="EMP001" className={inputCls} /></Field>
        <Field label="Full name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" className={inputCls} /></Field>
        <Field label="Father / spouse name"><input value={form.kyc.fatherOrSpouse} onChange={(e) => setKyc("fatherOrSpouse", e.target.value)} className={inputCls} /></Field>
        <Field label="Designation">
          <select value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={inputCls}>
            <option value="">Choose…</option>
            {(org?.designations || []).filter((d: any) => d.active).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls}>
            <option value="">Choose…</option>
            {(org?.departments || []).filter((d: any) => d.active).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Work location">
          <select value={form.workLocation} onChange={(e) => setForm({ ...form, workLocation: e.target.value })} className={inputCls}>
            <option value="">Choose…</option>
            {(org?.workLocations || []).filter((l: any) => l.active).map((l: any) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </Field>
        {!myPlant && (
          <Field label="Plant">
            <select value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} className={inputCls}>
              <option value="">Head office</option>
              {PLANTS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Date of joining"><input type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} className={inputCls} /></Field>
        <Field label="Work email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="For the payslip" className={inputCls} /></Field>
      </FormSection>

      <FormSection title="How they are paid" hint={myPlant ? "Optional for a plant manager — accounts sets the pay. Skill category decides the state minimum wage." : "Skill category decides which state minimum wage applies to this person."} columns={3}>
        <Field label="Paid as">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
            <option value="staff">Staff — monthly salary</option>
            <option value="labour">Labour — daily wage</option>
          </select>
        </Field>
        <Field label="Skill category">
          <select value={form.kyc.skillCategory} onChange={(e) => setKyc("skillCategory", e.target.value)} className={inputCls}>
            {SKILLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </FormSection>

      {form.type === "staff" ? (
        <FormSection title="Monthly structure" columns={3}>
          <Field label="Basic"><input type="number" value={form.basic} onChange={(e) => setForm({ ...form, basic: e.target.value })} className={inputCls} /></Field>
          <Field label="HRA"><input type="number" value={form.hra} onChange={(e) => setForm({ ...form, hra: e.target.value })} className={inputCls} /></Field>
          <Field label="Conveyance"><input type="number" value={form.conveyance} onChange={(e) => setForm({ ...form, conveyance: e.target.value })} className={inputCls} /></Field>
          <Field label="Medical"><input type="number" value={form.medical} onChange={(e) => setForm({ ...form, medical: e.target.value })} className={inputCls} /></Field>
          <Field label="Special allowance"><input type="number" value={form.special} onChange={(e) => setForm({ ...form, special: e.target.value })} className={inputCls} /></Field>
        </FormSection>
      ) : (
        <FormSection title="Daily wage" columns={3}>
          <Field label="Daily wage (₹)"><input type="number" value={form.dailyWage} onChange={(e) => setForm({ ...form, dailyWage: e.target.value })} className={inputCls} /></Field>
        </FormSection>
      )}

      <FormSection title="Personal" columns={3}>
        <Field label="Date of birth"><input type="date" value={form.kyc.dateOfBirth} onChange={(e) => setKyc("dateOfBirth", e.target.value)} className={inputCls} /></Field>
        <Field label="Gender">
          <select value={form.kyc.gender} onChange={(e) => setKyc("gender", e.target.value)} className={inputCls}>
            <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </Field>
        <Field label="Mobile"><input value={form.kyc.personalPhone} onChange={(e) => setKyc("personalPhone", e.target.value)} className={inputCls} /></Field>
        <Field label="Emergency contact name"><input value={form.kyc.emergencyName} onChange={(e) => setKyc("emergencyName", e.target.value)} className={inputCls} /></Field>
        <Field label="Emergency contact number"><input value={form.kyc.emergencyPhone} onChange={(e) => setKyc("emergencyPhone", e.target.value)} className={inputCls} /></Field>
        <div className="md:col-span-2 lg:col-span-3">
          <Field label="Address"><textarea rows={2} value={form.kyc.address} onChange={(e) => setKyc("address", e.target.value)} className={`${inputCls} resize-y`} /></Field>
        </div>
      </FormSection>

      <FormSection title="Identity, bank and statutory" columns={4}>
        <Field label="Aadhaar"><input value={form.kyc.aadhaar} onChange={(e) => setKyc("aadhaar", e.target.value)} className={inputCls} /></Field>
        <Field label="PAN"><input value={form.kyc.pan} onChange={(e) => setKyc("pan", e.target.value)} className={inputCls} /></Field>
        <Field label="UAN (PF)"><input value={form.uan} onChange={(e) => setForm({ ...form, uan: e.target.value })} className={inputCls} /></Field>
        <Field label="ESIC number"><input value={form.esicNumber} onChange={(e) => setForm({ ...form, esicNumber: e.target.value })} className={inputCls} /></Field>
        <Field label="Bank name"><input value={form.kyc.bankName} onChange={(e) => setKyc("bankName", e.target.value)} className={inputCls} /></Field>
        <Field label="Account number"><input value={form.kyc.bankAccount} onChange={(e) => setKyc("bankAccount", e.target.value)} className={inputCls} /></Field>
        <Field label="IFSC"><input value={form.kyc.bankIfsc} onChange={(e) => setKyc("bankIfsc", e.target.value)} className={inputCls} /></Field>
        <div className="flex items-end gap-2">
          <Toggle label="PF" on={form.pfApplicable} onChange={(v) => setForm({ ...form, pfApplicable: v })} />
          <Toggle label="ESIC" on={form.esicApplicable} onChange={(v) => setForm({ ...form, esicApplicable: v })} />
        </div>
      </FormSection>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */

function EmployeeDetail({
  employee, data, onClose, onChanged, busy, setBusy,
}: { employee: Employee; data: any; onClose: () => void; onChanged: () => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [tab, setTab] = useState<"record" | "documents" | "letters">("record");
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [docCategory, setDocCategory] = useState(data.documentCategories?.[0] || "Other");
  const [letter, setLetter] = useState({ kind: "", title: "", body: "" });
  const [templates, setTemplates] = useState<any[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [emailIt, setEmailIt] = useState(false);
  const [holes, setHoles] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/letters", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTemplates(j.templates || []))
      .catch(() => setTemplates([]));
  }, []);

  /** Pull a ready draft for this person and template. */
  async function loadDraft(kind: string) {
    setDrafting(true); setError(null); setHoles([]);
    try {
      const res = await fetch(`/api/letters?employeeId=${employee.id}&template=${kind}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.draft) {
        setLetter({ kind, title: json.draft.subject, body: json.draft.body });
        setHoles(json.draft.missing || []);
      }
    } catch (err) { setError((err as Error).message); }
    finally { setDrafting(false); }
  }

  const canEdit = data.canEditRecord;
  const canFreeze = data.canFreeze;
  const canDocs = data.canUploadDocs;

  async function saveEdit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/employees", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: employee.id, ...edit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setEdit(null); onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function freeze(active: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/employees", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: employee.id, active }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("employeeId", employee.id);
      fd.set("category", docCategory);
      fd.set("file", file);
      const res = await fetch("/api/payroll/documents", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function issueLetter(force = false) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/letters", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employee.id, subject: letter.title, body: letter.body, kind: letter.kind, email: emailIt, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.missing) setHoles(json.missing);
        throw new Error(json.error || `Failed (${res.status}).`);
      }
      if (json.mail?.attempted && !json.mail.ok) {
        setError(`Letter saved, but the email didn't go: ${json.mail.error}`);
      } else {
        setLetter({ kind: "", title: "", body: "" });
        setHoles([]); setEmailIt(false);
      }
      onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const k = employee.kyc || {};

  return (
    <FormPanel
      open
      onClose={onClose}
      icon={<Contact size={20} />}
      eyebrow={employee.active ? "Employee record" : "Frozen record"}
      title={employee.name}
      subtitle={`${employee.code} · ${employee.designation || (employee.type === "labour" ? "Labour" : "Staff")}${employee.plant ? ` · ${employee.plant}` : ""}`}
      headerRight={
        (employee.compliance || []).length > 0 ? (
          <span className={`hidden items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold sm:flex ${
            employee.compliance!.some((c) => c.level === "error")
              ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
              : "border-amber-500/35 bg-amber-500/10 text-amber-600"
          }`}>
            <ShieldAlert size={13} /> {employee.compliance!.length} to check
          </span>
        ) : null
      }
      footerLeft={
        canFreeze ? (
          <button onClick={() => freeze(!employee.active)} disabled={busy}
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">
            <Snowflake size={13} /> {employee.active ? "Freeze this record" : "Unfreeze"}
          </button>
        ) : null
      }
      footer={
        <>
          {canEdit && tab === "record" && (
            edit ? (
              <>
                <button onClick={() => setEdit(null)} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
                <button onClick={saveEdit} disabled={busy}
                  className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save changes
                </button>
              </>
            ) : (
              <button onClick={() => setEdit({
                name: employee.name, designation: employee.designation, department: employee.department,
                workLocation: employee.workLocation, email: employee.email,
                uan: employee.uan, esicNumber: employee.esicNumber,
                dailyWage: employee.dailyWage, structure: employee.structure, kyc: k,
              })} className="bmx-btn rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white">
                Edit record
              </button>
            )
          )}
        </>
      }
    >
      <div className="mb-5 flex gap-2">
        {([["record", "Record", Contact], ["documents", "Documents", Paperclip], ["letters", "Letters", ScrollText]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold ${
              tab === id ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
            }`}>
            <Icon size={13} /> {label}
            {id === "documents" && ` (${employee.documents?.length || 0})`}
            {id === "letters" && ` (${employee.letters?.length || 0})`}
          </button>
        ))}
      </div>

      {error && (
        <div className="bmx-msg-in mb-4 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {!canEdit && tab === "record" && (
        <div className="mb-4 rounded-xl border border-biome-line bg-biome-bgSoft px-4 py-3">
          <p className="text-[11.5px] leading-relaxed text-biome-muted">
            You can read this record but not change it. If something needs correcting, raise it
            under Help &amp; Support — the admin will make the change and you will see the outcome
            on the ticket.
          </p>
        </div>
      )}

      {tab === "record" && (edit ? (
        <>
          <FormSection title="Who they are" columns={3}>
            <Field label="Full name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Designation">
              <select value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {(data.org?.designations || []).filter((d: any) => d.active).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {(data.org?.departments || []).filter((d: any) => d.active).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Work email"><input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={inputCls} /></Field>
            <Field label="UAN"><input value={edit.uan} onChange={(e) => setEdit({ ...edit, uan: e.target.value })} className={inputCls} /></Field>
            <Field label="ESIC number"><input value={edit.esicNumber} onChange={(e) => setEdit({ ...edit, esicNumber: e.target.value })} className={inputCls} /></Field>
          </FormSection>

          <FormSection title="Pay" columns={3}>
            {employee.type === "labour" ? (
              <Field label="Daily wage (₹)"><input type="number" value={edit.dailyWage} onChange={(e) => setEdit({ ...edit, dailyWage: Number(e.target.value) || 0 })} className={inputCls} /></Field>
            ) : (
              (["basic", "hra", "conveyance", "medical", "special"] as const).map((f) => (
                <Field key={f} label={f === "hra" ? "HRA" : f[0].toUpperCase() + f.slice(1)}>
                  <input type="number" value={edit.structure?.[f] ?? 0}
                    onChange={(e) => setEdit({ ...edit, structure: { ...edit.structure, [f]: Number(e.target.value) || 0 } })}
                    className={inputCls} />
                </Field>
              ))
            )}
            <Field label="Skill category">
              <select value={edit.kyc?.skillCategory || "unskilled"}
                onChange={(e) => setEdit({ ...edit, kyc: { ...edit.kyc, skillCategory: e.target.value } })} className={inputCls}>
                {SKILLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </FormSection>

          <FormSection title="Identity and bank" columns={4}>
            {([["aadhaar", "Aadhaar"], ["pan", "PAN"], ["bankName", "Bank name"], ["bankAccount", "Account number"], ["bankIfsc", "IFSC"], ["personalPhone", "Mobile"], ["emergencyName", "Emergency name"], ["emergencyPhone", "Emergency number"]] as const).map(([f, label]) => (
              <Field key={f} label={label}>
                <input value={edit.kyc?.[f] || ""} onChange={(e) => setEdit({ ...edit, kyc: { ...edit.kyc, [f]: e.target.value } })} className={inputCls} />
              </Field>
            ))}
          </FormSection>
        </>
      ) : (
        <>
          <Detail icon={<Contact size={13} />} title="Record">
            <Row label="Employee code" value={employee.code} />
            <Row label="Designation" value={employee.designation} />
            <Row label="Department" value={employee.department} />
            <Row label="Work location" value={employee.workLocation || employee.plant || "Head office"} />
            <Row label="Joined" value={employee.dateOfJoining} />
            <Row label="Paid as" value={employee.type === "labour" ? "Labour — daily wage" : "Staff — monthly"} />
            <Row label="Skill category" value={SKILLS.find((s) => s.id === k.skillCategory)?.label || "—"} />
            <Row label="Work email" value={employee.email} />
          </Detail>

          <Detail icon={<Phone size={13} />} title="Personal">
            <Row label="Father / spouse" value={k.fatherOrSpouse} />
            <Row label="Date of birth" value={k.dateOfBirth} />
            <Row label="Gender" value={k.gender} />
            <Row label="Mobile" value={k.personalPhone} />
            <Row label="Emergency" value={[k.emergencyName, k.emergencyPhone].filter(Boolean).join(" · ")} />
            <Row label="Address" value={k.address} />
          </Detail>

          <Detail icon={<Landmark size={13} />} title="Identity, bank and statutory">
            <Row label="Aadhaar" value={k.aadhaar} />
            <Row label="PAN" value={k.pan} />
            <Row label="UAN" value={employee.uan} />
            <Row label="ESIC number" value={employee.esicNumber} />
            <Row label="Bank" value={[k.bankName, k.bankAccount, k.bankIfsc].filter(Boolean).join(" · ")} />
            <Row label="PF / ESIC" value={`${employee.pfApplicable ? "PF on" : "PF off"} · ${employee.esicApplicable ? "ESIC on" : "ESIC off"}`} />
          </Detail>
        </>
      ))}

      {tab === "documents" && (
        <>
          {canDocs && (
            <FormSection title="Upload a document" hint="Photos or PDF, up to 12 MB. Photograph the paper — a phone photo is enough." columns={2}>
              <Field label="What is it?">
                <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className={inputCls}>
                  {(data.documentCategories || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div className="flex items-end">
                <label className="bmx-chip inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-biome-line px-4 py-3 text-[11.5px] text-biome-muted hover:text-biome-text">
                  {busy ? <Loader2 size={14} className="bmx-spin" /> : <Paperclip size={14} />}
                  {busy ? "Uploading…" : "Choose a file"}
                  <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                </label>
              </div>
            </FormSection>
          )}

          <div className="space-y-2">
            {(employee.documents || []).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-3">
                <FileText size={15} className="shrink-0 text-biome-muted" />
                <div className="min-w-[160px] flex-1">
                  <p className="text-[12px] font-semibold text-biome-text">{d.category}</p>
                  <p className="truncate text-[10.5px] text-biome-muted">
                    {d.name} · {(d.size / 1024).toFixed(0)} KB · {d.uploadedByName} ·{" "}
                    {new Date(d.uploadedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <a href={`/api/payroll/documents?employeeId=${employee.id}&documentId=${d.id}`} target="_blank" rel="noreferrer"
                  className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted">
                  Open
                </a>
                {canEdit && (
                  <button
                    onClick={async () => {
                      await fetch(`/api/payroll/documents?employeeId=${employee.id}&documentId=${d.id}`, { method: "DELETE" });
                      onChanged();
                    }}
                    className="rounded-lg p-1.5 text-biome-muted hover:text-rose-500">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {(employee.documents || []).length === 0 && (
              <p className="text-[11.5px] text-biome-muted">No documents on file yet.</p>
            )}
          </div>
        </>
      )}

      {tab === "letters" && (
        <>
          {canEdit ? (
            <FormSection
              title="Issue a letter"
              sectionIcon={<ScrollText size={14} />}
              hint="Pick a template to get a draft filled from this record, then edit it. Whatever you send is stored word for word — a template changed later can never rewrite a letter already handed over."
              columns={1}
            >
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">Templates</p>
                <div className="space-y-3">
                  {["Joining", "Performance", "Discipline", "Exit", "Other"].map((group) => {
                    const inGroup = templates.filter((t) => t.group === group);
                    if (!inGroup.length) return null;
                    return (
                      <div key={group}>
                        <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[.12em] text-biome-muted/70">{group}</p>
                        <div className="flex flex-wrap gap-2">
                          {inGroup.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => loadDraft(t.id)}
                              title={t.guidance}
                              className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                                letter.kind === t.id
                                  ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf"
                                  : t.sensitive
                                  ? "border-rose-400/30 text-rose-500"
                                  : "border-biome-line text-biome-muted"
                              }`}
                            >
                              {t.sensitive && <AlertCircle size={11} />} {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {letter.kind && (() => {
                const t = templates.find((x) => x.id === letter.kind);
                return t?.guidance ? (
                  <div className={`rounded-xl border px-3.5 py-2.5 ${
                    t.sensitive ? "border-rose-400/30 bg-rose-400/[.06]" : "border-biome-line bg-biome-bg/50"
                  }`}>
                    <p className="text-[10.5px] leading-relaxed text-biome-muted">
                      {t.sensitive && <span className="font-semibold text-rose-500">Take care · </span>}
                      {t.guidance}
                    </p>
                  </div>
                ) : null;
              })()}

              <Field label="Subject">
                <input value={letter.title} onChange={(e) => setLetter({ ...letter, title: e.target.value })}
                  placeholder="Pick a template above, or write your own" className={inputCls} />
              </Field>

              <Field label="Letter">
                <textarea
                  rows={20}
                  value={letter.body}
                  onChange={(e) => { setLetter({ ...letter, body: e.target.value }); setHoles([]); }}
                  placeholder={drafting ? "Preparing the draft…" : `Dear ${employee.name},\n\n…`}
                  className={`${inputCls} resize-y font-serif leading-relaxed`}
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "12.5px" }}
                />
              </Field>

              {holes.length > 0 && (
                <div className="bmx-msg-in rounded-xl border border-amber-500/30 bg-amber-500/[.08] px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold text-biome-text">
                    {holes.length} blank{holes.length > 1 ? "s" : ""} still in this letter
                  </p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                    {holes.join(", ")} — fill these in. A letter that goes out reading
                    &ldquo;Rs. {"{{new_salary}}"} per month&rdquo; is worse than no letter.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setEmailIt(!emailIt)}
                  disabled={!employee.email}
                  title={employee.email ? `Send to ${employee.email}` : "No work email on this record"}
                  className={`bmx-chip flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[11.5px] font-semibold transition disabled:opacity-50 ${
                    emailIt ? "border-biome-leaf/45 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
                  }`}
                >
                  <span className={`relative h-4 w-7 rounded-full transition-colors ${emailIt ? "bg-biome-leaf" : "bg-biome-line"}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${emailIt ? "left-3.5" : "left-0.5"}`} />
                  </span>
                  Email it to {employee.email || "— no address"}
                </button>

                <button onClick={() => issueLetter(false)} disabled={busy || letter.body.trim().length < 40}
                  className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />}
                  {emailIt ? "Issue and email" : "Issue letter"}
                </button>
              </div>
            </FormSection>
          ) : (
            <p className="mb-4 text-[11.5px] text-biome-muted">Only the admin can issue a letter.</p>
          )}

          <div className="space-y-2">
            {(employee.letters || []).map((l) => (
              <div key={l.id} className="rounded-xl border border-biome-line px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-biome-muted">{l.kind}</span>
                  <p className="text-[12px] font-semibold text-biome-text">{l.title}</p>
                  <span className="text-[10.5px] text-biome-muted">
                    {l.issuedOn} · {l.issuedByName}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-biome-muted">{l.body}</p>
              </div>
            ))}
            {(employee.letters || []).length === 0 && (
              <p className="text-[11.5px] text-biome-muted">No letters issued yet.</p>
            )}
          </div>
        </>
      )}
    </FormPanel>
  );
}

/* ------------------------------------------------------------------ */

function Detail({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.13em] text-biome-muted">{icon} {title}</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-biome-line/50 py-1 last:border-0">
      <dt className="shrink-0 text-[10.5px] text-biome-muted">{label}</dt>
      <dd className="truncate text-right text-[11.5px] text-biome-text">{value || "—"}</dd>
    </div>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bmx-field block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</span>
      <div className="relative">{children}</div>
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className="bmx-chip flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2.5 text-[11px] font-semibold text-biome-muted">
      <span className={`relative h-4 w-7 rounded-full transition-colors duration-300 ${on ? "bg-biome-leaf" : "bg-biome-line"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}
