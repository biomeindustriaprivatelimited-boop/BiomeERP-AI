"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Portal from "@/components/Portal";
import {
  IndianRupee, SlidersHorizontal, Plus, Loader2, AlertCircle, Check,
  FileText, Lock, Unlock, Download, Mail, BadgeCheck, Wallet,
} from "lucide-react";
import { PLANTS } from "@/lib/permissions";
import SetupGuide, { EmptyState } from "@/components/SetupGuide";
import FormPanel, { FormSection } from "@/components/FormPanel";
import { buildPayslipPdf, payslipFileName, SlipData } from "@/lib/payslipPdf";

/**
 * Payroll.
 *
 * The month is a document, not a live view: a draft recomputes from the
 * masters every time it is opened, and approving it freezes both the
 * payslips and the statutory rates that produced them. That is what lets a
 * slip reprinted next year still show what was actually deducted.
 */

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

interface Line { label: string; amount: number; }
interface Payslip {
  employeeId: string; code: string; name: string; designation: string; plant: string;
  type: "staff" | "labour"; month: string; monthDays: number; paidDays: number;
  daysWorked: number; overtimeHours: number;
  earnings: Line[]; grossEarnings: number;
  deductions: Line[]; totalDeductions: number;
  employerContributions: Line[]; employerCost: number;
  netPay: number; warnings: string[];
}
interface Attendance {
  employeeId: string; paidDays: number; daysWorked: number; overtimeHours: number;
  bonus: number; incentive: number; advanceDeduction: number; tds: number;
  otherDeduction: number; otherDeductionLabel: string; remark: string;
}
interface Run {
  id: string; month: string; plant: string; status: "draft" | "approved" | "paid";
  attendance: Attendance[]; payslips: Payslip[];
  createdByName: string; approvedByName: string | null; approvedAt: string | null;
  paidAt: string | null; note: string;
}

export default function PayrollPage() {
  const [tab, setTab] = useState<"sheet" | "rules">("sheet");
  const [headcount, setHeadcount] = useState<number | null>(null);

  // Payroll with no employees computes an empty sheet, which reads as a
  // broken module rather than an unconfigured one.
  useEffect(() => {
    fetch("/api/payroll/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setHeadcount((j.employees || []).filter((e: any) => e.active).length))
      .catch(() => setHeadcount(null));
  }, [tab]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
            <IndianRupee size={19} className="text-biome-leaf" /> Payroll
          </h1>
          <p className="mt-1 text-[11.5px] text-biome-muted">
            Salary sheets, payslips, PF and ESIC. Open to accounts and admin only.
          </p>
        </div>
        <div className="flex gap-2">
          {([
            ["sheet", "Salary sheet", FileText],
            ["rules", "Statutory rules", SlidersHorizontal],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`bmx-chip flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold transition ${
                tab === id
                  ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf"
                  : "border-biome-line text-biome-muted hover:text-biome-text"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </header>

      {headcount === 0 && (
        <SetupGuide
          title="Set payroll up before the first run"
          intro="No employees are on the rolls, so a salary sheet would come out empty."
          steps={[
            {
              title: "Check the statutory rules",
              detail: "PF, ESIC and professional tax are seeded with the rates in force today. Turn off anything you aren't registered for — that matters more than the rates themselves.",
              done: false,
              action: { label: "Open rules", onClick: () => setTab("rules") },
            },
            {
              title: "Add your employees",
              detail: "Staff on a monthly structure, labour on a daily wage. Mark PF and ESIC per person — not everyone is covered.",
              done: false,
              action: { label: "Add employees", onClick: () => { window.location.href = "/employees"; } },
            },
            {
              title: "Open a month and fill attendance",
              detail: "Paid days, days worked, overtime, bonus and any recovery. The sheet recalculates as you save.",
              done: false,
              blockedBy: "After the first employee",
            },
            {
              title: "Approve and lock",
              detail: "Approval freezes the payslips and the rates that produced them, so a slip reprinted later still shows what was actually deducted.",
              done: false,
              blockedBy: "After the first sheet",
            },
          ]}
          footnote="Nothing is calculated from a rate that is built into the app — every figure comes from the Statutory rules tab, so when a notification changes one, you change it there."
        />
      )}

      {tab === "sheet" && <SheetTab />}
      {tab === "rules" && <RulesTab />}
    </div>
  );
}

/* ================= Salary sheet ================= */

function SheetTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [plant, setPlant] = useState("");
  const [slip, setSlip] = useState<Payslip | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/payroll/runs", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) { setRuns(json.runs || []); setCanApprove(json.canApprove); }
    else setError(json.error || `Failed (${res.status}).`);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function open(id: string) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/payroll/runs?id=${id}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setRun(json.run); else setError(json.error || `Failed (${res.status}).`);
    setBusy(false);
  }

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, plant }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setRun(json.run); await loadList();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function saveAttendance(next: Attendance[]) {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: run.id, attendance: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setRun(json.run);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function act(action: string, force = false) {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: run.id, action, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json.employees
            ? `${json.error} — ${json.employees.map((e: any) => `${e.name} (${money(e.netPay)})`).join(", ")}`
            : json.error || `Failed (${res.status}).`
        );
      }
      setRun(json.run); await loadList();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  /**
   * Builds every payslip in the browser and posts them for sending.
   *
   * The PDF is made here rather than on the server so the emailed slip is
   * byte-for-byte the one the employee can download from this screen — two
   * generators would eventually disagree, and a payslip that differs from
   * itself is an argument waiting to happen.
   */
  async function mailAll() {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const logo = await loadLogo();
      const items = run.payslips.map((p) => ({
        employeeId: p.employeeId,
        pdfBase64: buildPayslipPdf(toSlipData(p), logo).output("datauristring").split(",")[1],
      }));
      const res = await fetch("/api/payroll/mail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, items }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      const failed = (json.failed || []).map((f: any) => `${f.name}: ${f.error}`).join(" · ");
      setError(
        failed
          ? `${json.sent} sent. Not sent — ${failed}`
          : `${json.sent} payslip(s) emailed.`
      );
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const totals = useMemo(() => {
    if (!run) return null;
    return run.payslips.reduce(
      (t, p) => ({
        gross: t.gross + p.grossEarnings,
        deductions: t.deductions + p.totalDeductions,
        net: t.net + p.netPay,
        cost: t.cost + p.employerCost,
      }),
      { gross: 0, deductions: 0, net: 0, cost: 0 }
    );
  }, [run]);

  const warningCount = run?.payslips.reduce((n, p) => n + p.warnings.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] leading-relaxed text-biome-text">{error}</p>
        </div>
      )}

      {!run ? (
        <>
          <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
            <h2 className="text-[13px] font-semibold text-biome-text">Open a month</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Month">
                <input type="month" max={new Date().toISOString().slice(0, 7)} value={month}
                  onChange={(e) => setMonth(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Plant">
                <select value={plant} onChange={(e) => setPlant(e.target.value)} className={inputCls}>
                  <option value="">All plants together</option>
                  {PLANTS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                </select>
              </Field>
              <button onClick={create} disabled={busy}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                {busy ? <Loader2 size={14} className="bmx-spin" /> : <Plus size={14} />} Start sheet
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
            <h2 className="text-[13px] font-semibold text-biome-text">Previous months</h2>
            {runs.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-biome-muted">No salary sheets yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {runs.map((r, i) => (
                  <button key={r.id} onClick={() => open(r.id)}
                    className="bmx-rise bmx-chip flex w-full flex-wrap items-center gap-3 rounded-xl border border-biome-line px-3.5 py-3 text-left"
                    style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
                    <div className="flex-1">
                      <p className="text-[12.5px] font-semibold text-biome-text">
                        {new Date(r.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                        {r.plant && ` · ${r.plant}`}
                      </p>
                      <p className="text-[10.5px] text-biome-muted">{r.headcount} employees</p>
                    </div>
                    <p className="font-mono text-[13px] font-semibold text-biome-text">{money(r.netTotal)}</p>
                    <RunStatus status={r.status} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button onClick={() => setRun(null)} className="bmx-link text-[11px] text-biome-muted">← All months</button>
              <h2 className="mt-1 flex items-center gap-2 text-[16px] font-semibold text-biome-text">
                {new Date(run.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                {run.plant && <span className="text-biome-muted">· {run.plant}</span>}
                <RunStatus status={run.status} />
              </h2>
              {run.approvedByName && (
                <p className="mt-0.5 text-[10.5px] text-biome-muted">
                  Approved by {run.approvedByName}
                  {run.paidAt && " · marked paid"}
                </p>
              )}
            </div>

            {canApprove && (
              <div className="flex gap-2">
                {run.status === "draft" && (
                  <button onClick={() => act("approve")} disabled={busy}
                    className="bmx-btn flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                    {busy ? <Loader2 size={14} className="bmx-spin" /> : <Lock size={14} />} Approve &amp; lock
                  </button>
                )}
                <a
                  href={`/api/payroll/export?id=${run.id}`}
                  className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted"
                >
                  <Download size={13} /> Excel
                </a>
                {run.status !== "draft" && (
                  <button onClick={() => mailAll()} disabled={busy}
                    className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-60">
                    {busy ? <Loader2 size={13} className="bmx-spin" /> : <Mail size={13} />} Email payslips
                  </button>
                )}
                {run.status === "approved" && (
                  <>
                    <button onClick={() => act("paid")} disabled={busy}
                      className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
                      <BadgeCheck size={14} /> Mark paid
                    </button>
                    <button onClick={() => act("reopen")} disabled={busy}
                      className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted">
                      <Unlock size={13} /> Reopen
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {totals && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Gross earnings" value={money(totals.gross)} />
              <Tile label="Total deductions" value={money(totals.deductions)} />
              <Tile label="Net payable" value={money(totals.net)} accent />
              <Tile label="Cost to company" value={money(totals.cost)} hint="Gross plus employer PF and ESIC" />
            </div>
          )}

          {warningCount > 0 && (
            <div className="bmx-msg-in rounded-2xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-3">
              <p className="flex items-center gap-2 text-[11.5px] font-semibold text-biome-text">
                <AlertCircle size={14} className="text-amber-600" />
                {warningCount} thing{warningCount > 1 ? "s" : ""} to check before releasing this month
              </p>
              <ul className="mt-2 space-y-1">
                {run.payslips.flatMap((p) =>
                  p.warnings.map((w, i) => (
                    <li key={`${p.employeeId}-${i}`} className="text-[10.5px] leading-relaxed text-biome-muted">
                      <span className="font-semibold text-biome-text">{p.name}</span> — {w}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}

          <SheetTable
            run={run}
            editable={run.status === "draft"}
            onSave={saveAttendance}
            onSlip={setSlip}
            busy={busy}
          />
        </>
      )}

      {slip && run && <SlipModal slip={slip} runId={run.id} onClose={() => setSlip(null)} />}
    </div>
  );
}

function SheetTable({
  run, editable, onSave, onSlip, busy,
}: { run: Run; editable: boolean; onSave: (a: Attendance[]) => void; onSlip: (p: Payslip) => void; busy: boolean }) {
  const [draft, setDraft] = useState<Attendance[]>(run.attendance);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setDraft(run.attendance); setDirty(false); }, [run.attendance]);

  const set = (employeeId: string, field: keyof Attendance, value: string) => {
    setDirty(true);
    setDraft((d) => d.map((a) => (a.employeeId === employeeId ? { ...a, [field]: Number(value) || 0 } : a)));
  };

  const slipFor = (id: string) => run.payslips.find((p) => p.employeeId === id);

  return (
    <section className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
      <div className="flex items-center justify-between border-b border-biome-line px-5 py-3">
        <h3 className="text-[13px] font-semibold text-biome-text">
          Salary sheet · {run.payslips.length} employees
        </h3>
        {editable && (
          <button
            onClick={() => onSave(draft)}
            disabled={busy || !dirty}
            className="bmx-btn flex items-center gap-1.5 rounded-lg bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="bmx-spin" /> : <Check size={12} />}
            {dirty ? "Save & recalculate" : "Saved"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-[11px]">
          <thead>
            <tr className="border-b border-biome-line text-left text-[9.5px] uppercase tracking-[.12em] text-biome-muted">
              <th className="px-4 py-2.5 font-semibold">Employee</th>
              <th className="px-2 py-2.5 font-semibold">Paid days</th>
              <th className="px-2 py-2.5 font-semibold">Worked</th>
              <th className="px-2 py-2.5 font-semibold">OT hrs</th>
              <th className="px-2 py-2.5 font-semibold">Bonus</th>
              <th className="px-2 py-2.5 font-semibold">Advance rec.</th>
              <th className="px-2 py-2.5 font-semibold">TDS</th>
              <th className="px-2 py-2.5 text-right font-semibold">Gross</th>
              <th className="px-2 py-2.5 text-right font-semibold">Deductions</th>
              <th className="px-2 py-2.5 text-right font-semibold">Net pay</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {draft.map((a, i) => {
              const slip = slipFor(a.employeeId);
              if (!slip) return null;
              return (
                <tr
                  key={a.employeeId}
                  className="bmx-rise border-b border-biome-line/60 last:border-0 hover:bg-biome-bg/40"
                  style={{ animationDelay: `${Math.min(i, 12) * 0.02}s` }}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-biome-text">{slip.name}</p>
                    <p className="text-[9.5px] text-biome-muted">
                      {slip.code} · {slip.type === "labour" ? "Labour" : "Staff"}{slip.plant && ` · ${slip.plant}`}
                    </p>
                  </td>
                  <NumCell value={a.paidDays} editable={editable} onChange={(v) => set(a.employeeId, "paidDays", v)} />
                  <NumCell value={a.daysWorked} editable={editable} onChange={(v) => set(a.employeeId, "daysWorked", v)} />
                  <NumCell value={a.overtimeHours} editable={editable} onChange={(v) => set(a.employeeId, "overtimeHours", v)} />
                  <NumCell value={a.bonus} editable={editable} onChange={(v) => set(a.employeeId, "bonus", v)} />
                  <NumCell value={a.advanceDeduction} editable={editable} onChange={(v) => set(a.employeeId, "advanceDeduction", v)} />
                  <NumCell value={a.tds} editable={editable} onChange={(v) => set(a.employeeId, "tds", v)} />
                  <td className="px-2 py-2.5 text-right font-mono text-biome-text">{money(slip.grossEarnings)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-biome-muted">{money(slip.totalDeductions)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono font-semibold ${slip.netPay < 0 ? "text-rose-500" : "text-biome-text"}`}>
                    {money(slip.netPay)}
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => onSlip(slip)} className="bmx-chip rounded-lg border border-biome-line px-2 py-1 text-[10px] text-biome-muted">
                      Slip
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {run.payslips.length === 0 && (
        <p className="px-5 py-8 text-center text-[11.5px] text-biome-muted">
          No active employees for this month. Add them under Employees first.
        </p>
      )}
    </section>
  );
}

function NumCell({ value, editable, onChange }: { value: number; editable: boolean; onChange: (v: string) => void }) {
  return (
    <td className="px-2 py-2.5">
      {editable ? (
        <input
          type="number" min="0" step="0.5" value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bmx-input w-[62px] rounded-lg border border-biome-line bg-biome-bg px-2 py-1 text-right font-mono text-[11px] text-biome-text outline-none"
        />
      ) : (
        <span className="font-mono text-biome-muted">{value}</span>
      )}
    </td>
  );
}

function RunStatus({ status }: { status: Run["status"] }) {
  const map = {
    draft: ["Draft", "border-amber-500/30 bg-amber-500/10 text-amber-600"],
    approved: ["Approved", "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"],
    paid: ["Paid", "border-sky-500/30 bg-sky-500/10 text-sky-600"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${cls}`}>{label}</span>;
}

/* ================= Payslip ================= */

function SlipModal({ slip, runId, onClose }: { slip: Payslip; runId: string; onClose: () => void }) {
  const [mailState, setMailState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [mailNote, setMailNote] = useState<string | null>(null);

  /** Email THIS payslip — the same PDF the Download button produces,
   *  through the same /api/payroll/mail route the bulk send uses, so a
   *  single slip can never differ from the batch version of itself. */
  async function emailOne() {
    setMailState("sending"); setMailNote(null);
    try {
      const doc = buildPayslipPdf(toSlipData(slip), await loadLogo());
      const pdfBase64 = doc.output("datauristring").split(",")[1];
      const res = await fetch("/api/payroll/mail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, items: [{ employeeId: slip.employeeId, pdfBase64 }] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      if (json.failed?.length) throw new Error(json.failed[0].error || "Could not send.");
      setMailState("sent");
      setMailNote(`Sent to ${json.sentTo?.[0] || "the employee's work email"}.`);
    } catch (e) {
      setMailState("failed");
      setMailNote((e as Error).message);
    }
  }
  return (
    <Portal><div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bmx-panel-in my-8 w-full max-w-[640px] rounded-2xl border border-biome-line bg-biome-bgSoft p-6 print:border-0 print:bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-biome-line pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.28em] text-biome-muted">Biome Industria</p>
            <h3 className="mt-1 text-[17px] font-semibold text-biome-text">Payslip</h3>
            <p className="mt-0.5 text-[11px] text-biome-muted">
              {new Date(slip.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={async () => {
                const doc = buildPayslipPdf(toSlipData(slip), await loadLogo());
                doc.save(payslipFileName(toSlipData(slip)));
              }}
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted"
            >
              <Download size={12} /> Download PDF
            </button>
            <button
              onClick={emailOne}
              disabled={mailState === "sending"}
              className="bmx-chip flex items-center gap-1.5 rounded-lg border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted disabled:opacity-60"
            >
              {mailState === "sending" ? <Loader2 size={12} className="bmx-spin" /> : <Mail size={12} />}
              {mailState === "sent" ? "Sent" : "Email payslip"}
            </button>
            <button onClick={onClose} className="bmx-chip rounded-lg border border-biome-line px-3 py-1.5 text-[11px] text-biome-muted">Close</button>
          </div>
        </div>
        {mailNote && (
          <p className={`mt-2 text-[10.5px] ${mailState === "failed" ? "text-rose-500" : "text-emerald-500"}`}>{mailNote}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-[11.5px]">
          <Detail label="Name" value={slip.name} />
          <Detail label="Employee code" value={slip.code} />
          <Detail label="Designation" value={slip.designation || "—"} />
          <Detail label="Plant" value={slip.plant || "Head office"} />
          <Detail label="Paid days" value={`${slip.paidDays} of ${slip.monthDays}`} />
          <Detail label="Overtime" value={slip.overtimeHours ? `${slip.overtimeHours} hrs` : "—"} />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <LineBlock title="Earnings" lines={slip.earnings} total={slip.grossEarnings} totalLabel="Gross earnings" />
          <LineBlock title="Deductions" lines={slip.deductions} total={slip.totalDeductions} totalLabel="Total deductions" />
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-biome-leaf/30 bg-biome-leaf/[.08] px-4 py-3">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-biome-text">
            <Wallet size={14} className="text-biome-leaf" /> Net pay
          </span>
          <span className="font-mono text-[19px] font-semibold text-biome-text">{money(slip.netPay)}</span>
        </div>

        {slip.employerContributions.length > 0 && (
          <div className="mt-4 rounded-xl border border-biome-line px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
              Employer contributions — not deducted from the employee
            </p>
            <div className="mt-2 space-y-1">
              {slip.employerContributions.map((c) => (
                <div key={c.label} className="flex justify-between text-[11px]">
                  <span className="text-biome-muted">{c.label}</span>
                  <span className="font-mono text-biome-text">{money(c.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-biome-line pt-1.5 text-[11px] font-semibold">
                <span className="text-biome-text">Cost to company</span>
                <span className="font-mono text-biome-text">{money(slip.employerCost)}</span>
              </div>
            </div>
          </div>
        )}

        <p className="mt-4 text-[9.5px] leading-relaxed text-biome-muted">
          Computer-generated payslip. No signature required.
        </p>
      </div>
    </div></Portal>
  );
}

function LineBlock({ title, lines, total, totalLabel }: { title: string; lines: Line[]; total: number; totalLabel: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{title}</p>
      <div className="mt-2 space-y-1.5">
        {lines.length === 0 ? (
          <p className="text-[11px] text-biome-muted">None</p>
        ) : (
          lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="flex justify-between gap-3 text-[11.5px]">
              <span className="text-biome-muted">{l.label}</span>
              <span className="font-mono text-biome-text">{money(l.amount)}</span>
            </div>
          ))
        )}
        <div className="flex justify-between border-t border-biome-line pt-1.5 text-[11.5px] font-semibold">
          <span className="text-biome-text">{totalLabel}</span>
          <span className="font-mono text-biome-text">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[9.5px] uppercase tracking-[.12em] text-biome-muted">{label}</span>
      <span className="text-biome-text">{value}</span>
    </div>
  );
}

/* ================= Statutory rules ================= */

function RulesTab() {
  const [settings, setSettings] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/payroll/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSettings(j.settings))
      .catch(() => setError("Couldn't load the statutory settings."));
  }, []);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/payroll/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setSettings(json.settings); setSaved(true);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (!settings) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;

  const upd = (path: string, value: any) => {
    const [group, key] = path.split(".");
    setSaved(false);
    setSettings({ ...settings, [group]: { ...settings[group], [key]: value } });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-3">
        <p className="text-[11.5px] leading-relaxed text-biome-muted">
          These are seeded with the rates in force today. They are stored, not built in, because
          statutory rates change by notification — when one does, change it here and every month
          computed afterwards follows it. Months already approved keep the rates they were
          approved with.
        </p>
      </div>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-biome-text">Provident Fund</h2>
          <Toggle label="Enabled" on={settings.pf.enabled} onChange={(v) => upd("pf.enabled", v)} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Field label="Employee share %"><input type="number" step="0.01" value={settings.pf.employeeRate} onChange={(e) => upd("pf.employeeRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Employer share %"><input type="number" step="0.01" value={settings.pf.employerRate} onChange={(e) => upd("pf.employerRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Of which pension %"><input type="number" step="0.01" value={settings.pf.pensionRate} onChange={(e) => upd("pf.pensionRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Wage ceiling (₹)"><input type="number" value={settings.pf.wageCeiling} onChange={(e) => upd("pf.wageCeiling", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Admin charges %"><input type="number" step="0.01" value={settings.pf.adminChargeRate} onChange={(e) => upd("pf.adminChargeRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="EDLI %"><input type="number" step="0.01" value={settings.pf.edliRate} onChange={(e) => upd("pf.edliRate", Number(e.target.value))} className={inputCls} /></Field>
          <div className="md:col-span-2 flex items-end">
            <Toggle label="Apply the wage ceiling" on={settings.pf.applyCeiling} onChange={(v) => upd("pf.applyCeiling", v)} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-biome-text">ESIC</h2>
          <Toggle label="Enabled" on={settings.esic.enabled} onChange={(v) => upd("esic.enabled", v)} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="Employee share %"><input type="number" step="0.01" value={settings.esic.employeeRate} onChange={(e) => upd("esic.employeeRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Employer share %"><input type="number" step="0.01" value={settings.esic.employerRate} onChange={(e) => upd("esic.employerRate", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Gross ceiling (₹)"><input type="number" value={settings.esic.grossCeiling} onChange={(e) => upd("esic.grossCeiling", Number(e.target.value))} className={inputCls} /></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="text-[13px] font-semibold text-biome-text">Days and overtime</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="A month's salary is divided by">
            <select value={settings.dayBasis} onChange={(e) => { setSaved(false); setSettings({ ...settings, dayBasis: e.target.value }); }} className={inputCls}>
              <option value="calendar">Calendar days (28–31)</option>
              <option value="fixed26">26 days</option>
              <option value="fixed30">30 days</option>
            </select>
          </Field>
          <Field label="Overtime multiplier"><input type="number" step="0.5" value={settings.overtime.multiplier} onChange={(e) => upd("overtime.multiplier", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Hours in a working day"><input type="number" value={settings.overtime.hoursPerDay} onChange={(e) => upd("overtime.hoursPerDay", Number(e.target.value))} className={inputCls} /></Field>
        </div>
        <p className="mt-2 text-[10.5px] text-biome-muted">
          Overtime is paid at {settings.overtime.multiplier}× the ordinary rate — the statutory
          minimum under the Factories Act is twice.
        </p>
      </section>

      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="text-[13px] font-semibold text-biome-text">Professional tax</h2>
        <p className="mt-1 text-[11px] text-biome-muted">
          A state levy, so it is held per plant. Haryana charges none; Maharashtra does, and
          collects the annual balance in February.
        </p>
        <div className="mt-3 space-y-2">
          {PLANTS.map((p) => {
            const rule = settings.professionalTax[p.code] || { enabled: false, slabs: [] };
            return (
              <div key={p.code} className="flex items-center justify-between rounded-xl border border-biome-line px-3.5 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-biome-text">{p.label} ({p.code})</p>
                  <p className="text-[10.5px] text-biome-muted">
                    {rule.enabled
                      ? rule.slabs.map((s: any) => `${s.upTo > 1e15 ? "above" : "up to ₹" + s.upTo}: ₹${s.amount}`).join(" · ")
                      : "Not levied"}
                  </p>
                </div>
                <Toggle
                  label=""
                  on={rule.enabled}
                  onChange={(v) => {
                    setSaved(false);
                    setSettings({
                      ...settings,
                      professionalTax: { ...settings.professionalTax, [p.code]: { ...rule, enabled: v } },
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      <button onClick={save} disabled={busy} className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
        {busy ? <Loader2 size={14} className="bmx-spin" /> : saved ? <BadgeCheck size={14} /> : <Check size={14} />}
        {busy ? "Saving…" : saved ? "Saved" : "Save statutory rules"}
      </button>
    </div>
  );
}

/* ================= shared ================= */

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
    <button
      onClick={() => onChange(!on)}
      className="bmx-chip flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors duration-300 ${on ? "bg-biome-leaf" : "bg-biome-line"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function Tile({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-4 ${accent ? "border-biome-leaf/30 bg-biome-leaf/[.07]" : "border-biome-line bg-biome-bgSoft"}`}>
      <span className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent)" }} />
      <p className="relative text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
      <p className="relative mt-1 font-mono text-[22px] font-semibold tracking-tight text-biome-text">{value}</p>
      {hint && <p className="relative mt-0.5 text-[9.5px] text-biome-muted">{hint}</p>}
    </div>
  );
}

/* ================= payslip helpers ================= */

/**
 * The logo, read once and cached, as a data URL for jsPDF.
 *
 * A failure here is deliberately swallowed: a payslip that will not print
 * because a logo is missing is a worse outcome than one printed without it.
 */
let logoCache: string | null | undefined;
async function loadLogo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const res = await fetch("/assets/logo.png");
    if (!res.ok) throw new Error("no logo");
    const blob = await res.blob();
    logoCache = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("unreadable"));
      reader.readAsDataURL(blob);
    });
  } catch {
    logoCache = null;
  }
  return logoCache;
}

function toSlipData(p: Payslip): SlipData {
  return {
    code: p.code,
    name: p.name,
    designation: p.designation,
    plant: p.plant,
    month: p.month,
    monthDays: p.monthDays,
    paidDays: p.paidDays,
    daysWorked: p.daysWorked,
    overtimeHours: p.overtimeHours,
    earnings: p.earnings,
    grossEarnings: p.grossEarnings,
    deductions: p.deductions,
    totalDeductions: p.totalDeductions,
    employerContributions: p.employerContributions,
    employerCost: p.employerCost,
    netPay: p.netPay,
  };
}
