"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Portal from "@/components/Portal";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Loader2, RefreshCcw, CheckCircle2, Clock, AlertTriangle, Flame, ArrowRight,
  UserPlus, MoonStar, X, Plus, Gavel, Bot, ListChecks, ChevronRight, ShieldCheck,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

/**
 * WORK — the AI Work Planner, Business Autopilot and Management
 * Decision Center on one screen (Phase 1 of the Business OS roadmap).
 *
 * Nothing here is typed in by hand. Detectors read every module, tasks
 * appear with a WHY and a NEXT ACTION, conditions that clear resolve
 * themselves, overdue work climbs the escalation ladder, and only what
 * needs a human choice is surfaced as a decision.
 */

type Priority = "critical" | "urgent" | "followup" | "normal";
interface Task {
  id: string; kind: string; module: string; title: string; why: string; nextAction: string; href: string;
  priority: Priority; status: string; source: string; ownerRoles: string[];
  assigneeId: string | null; assigneeName: string | null; plant: string | null; dueOn: string;
  createdAt: string; escalation: number; followupStep: number; amount: number | null; evidence: string[];
}
interface Decision { task: Task; risk: "LOW" | "MEDIUM" | "HIGH"; overdueDays: number; recommendation: string }
interface Run {
  at: string; created: number; autoResolved: number; escalated: number; followupsDue: number;
  byModule: Record<string, number>;
  agentStats: { documentsProcessed: number; setsComplete: number; setsIncomplete: number } | null;
  notes: string[];
}

const PRIO: Record<Priority, { label: string; dot: string; chip: string; icon: React.ReactNode }> = {
  critical: { label: "Critical", dot: "bg-rose-500", chip: "border-rose-500/35 bg-rose-500/10 text-rose-500", icon: <Flame size={12} /> },
  urgent: { label: "Urgent", dot: "bg-orange-500", chip: "border-orange-500/35 bg-orange-500/10 text-orange-500", icon: <AlertTriangle size={12} /> },
  followup: { label: "Follow-up", dot: "bg-amber-400", chip: "border-amber-400/40 bg-amber-400/10 text-amber-600", icon: <Clock size={12} /> },
  normal: { label: "Normal", dot: "bg-sky-400", chip: "border-sky-400/35 bg-sky-400/10 text-sky-600", icon: <ListChecks size={12} /> },
};

const FOLLOWUP_LABEL = ["", "Day 1 · initial request", "Day 3 · reminder 1", "Day 5 · reminder 2", "Day 7 · escalate to manager"];

function inr(n: number) { return `₹${Math.round(n).toLocaleString("en-IN")}`; }

export default function WorkPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"planner" | "mine" | "decisions" | "autopilot" | "monthend" | "automations">("planner");
  const [filter, setFilter] = useState<Priority | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "monthend" || t === "decisions" || t === "autopilot" || t === "mine" || t === "automations") setTab(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/work", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, any>) {
    const res = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || "Action failed."); return null; }
    await load();
    return json;
  }

  async function runNow() {
    setRunning(true);
    try { await act({ action: "run" }); } finally { setRunning(false); }
  }

  const counts = data?.planner?.counts;
  const tasks: Task[] = useMemo(
    () => (data?.planner?.tasks || []).filter((t: Task) => filter === "all" || t.priority === filter),
    [data, filter]
  );
  const decisions: Decision[] = data?.decisions || [];
  const lastRun: Run | null = data?.lastRun || null;

  return (
    <div className="space-y-5">
      {/* ---- Editorial header (Squarespace-style: big type, lots of air) ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-biome-muted">Biome AI OS</p>
          <h1 className="biome-shout mt-1 text-[30px] leading-[1.05] text-biome-text">
            Work<span className="text-biome-leafBright">.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-biome-muted">
            Every module is read automatically. What needs doing appears here with the reason and the next
            step; what clears on its own closes on its own; what needs a human choice becomes a decision.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreating(true)}
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11px] font-semibold text-biome-muted">
            <Plus size={13} /> Add a task
          </button>
          <button onClick={runNow} disabled={running}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
            {running ? <Loader2 size={13} className="bmx-spin" /> : <Bot size={13} />} Run autopilot now
          </button>
        </div>
      </header>

      {error && (
        <p className="bmx-msg-in rounded-2xl border border-rose-500/30 bg-rose-500/[.07] px-4 py-3 text-[11.5px] text-rose-500">{error}</p>
      )}

      {/* ---- Today's priorities ---- */}
      {counts && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Critical" value={counts.critical} tone="rose" onClick={() => { setTab("planner"); setFilter("critical"); }} active={filter === "critical"} />
          <Stat label="Urgent" value={counts.urgent} tone="orange" onClick={() => { setTab("planner"); setFilter("urgent"); }} active={filter === "urgent"} />
          <Stat label="Follow-ups" value={counts.followup} tone="amber" onClick={() => { setTab("planner"); setFilter("followup"); }} active={filter === "followup"} />
          <Stat label="Automated successfully" value={counts.autoResolvedRecently} tone="emerald" hint="closed by themselves, last 7 days" />
        </div>
      )}

      {/* ---- Tabs ---- */}
      <div className="flex flex-wrap gap-1.5">
        {([
          ["planner", "Work planner", <Sparkles size={12} key="a" />],
          ["mine", "My work", <ListChecks size={12} key="m" />],
          ["decisions", `Decisions${decisions.length ? ` · ${decisions.length}` : ""}`, <Gavel size={12} key="b" />],
          ["autopilot", "Autopilot", <Bot size={12} key="c" />],
          ["monthend", "Month-end", <ListChecks size={12} key="d" />],
          ["automations", "Automations", <Bot size={12} key="e" />],
        ] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`bmx-chip flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-semibold transition-colors ${
              tab === id ? "border-biome-leaf/50 bg-biome-leaf/12 text-biome-leafBright" : "border-biome-line text-biome-muted hover:text-biome-text"
            }`}>{icon} {label}</button>
        ))}
        {tab === "planner" && filter !== "all" && (
          <button onClick={() => setFilter("all")} className="ml-1 flex items-center gap-1 text-[10.5px] text-biome-muted hover:text-biome-text">
            <X size={11} /> clear filter
          </button>
        )}
      </div>

      {!data && !error && (
        <div className="flex items-center justify-center py-20"><Loader2 size={22} className="bmx-spin text-biome-muted" /></div>
      )}

      {/* ================= PLANNER ================= */}
      {data && tab === "planner" && (
        <div className="space-y-2">
          {tasks.length === 0 && (
            <GlassCard className="p-8 text-center">
              <ShieldCheck size={26} className="mx-auto text-emerald-500" />
              <p className="mt-2 text-[13px] font-bold text-biome-text">Nothing needs you right now</p>
              <p className="mt-1 text-[11px] text-biome-muted">The autopilot keeps looking; new work appears here the moment a module produces it.</p>
            </GlassCard>
          )}
          <AnimatePresence initial={false}>
            {tasks.map((t, i) => {
              const p = PRIO[t.priority]; const open = expanded === t.id;
              const overdue = t.dueOn < data.today;
              return (
                <motion.div key={t.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ delay: Math.min(i * 0.025, 0.3), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={`bmx-card rounded-2xl border bg-biome-bgSoft ${open ? "border-biome-leaf/40" : "border-biome-line"}`}>
                  <button onClick={() => setExpanded(open ? null : t.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${p.dot} ${t.priority === "critical" ? "animate-pulse" : ""}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-biome-text">{t.title}</span>
                        <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] ${p.chip}`}>{p.icon} {p.label}</span>
                        <span className="rounded-full border border-biome-line px-2 py-0.5 text-[9px] font-semibold text-biome-muted">{t.module}</span>
                        {t.escalation >= 2 && <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] font-bold text-rose-500">Escalated L{t.escalation}</span>}
                        {t.source === "auto" && <span className="rounded-full border border-biome-leaf/30 bg-biome-leaf/[.08] px-2 py-0.5 text-[9px] font-semibold text-biome-leafBright">auto</span>}
                      </span>
                      <span className="mt-1 block text-[11px] text-biome-muted">
                        <span className={overdue ? "font-semibold text-rose-500" : ""}>{overdue ? `Overdue since ${t.dueOn}` : t.dueOn === data.today ? "Due today" : `Due ${t.dueOn}`}</span>
                        {t.assigneeName ? ` · ${t.assigneeName}` : ` · ${t.ownerRoles.join(" / ")}`}
                        {t.amount ? ` · ${inr(t.amount)}` : ""}
                      </span>
                    </span>
                    <ChevronRight size={15} className={`mt-1 shrink-0 text-biome-muted transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="grid gap-3 border-t border-biome-line px-4 py-3 md:grid-cols-2">
                          <div>
                            <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Why it matters</p>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-biome-text">{t.why}</p>
                            {t.evidence.length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {t.evidence.map((e, j) => <li key={j} className="text-[10.5px] text-biome-muted">· {e}</li>)}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">Next action</p>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-biome-text">{t.nextAction}</p>
                            {t.followupStep > 0 && (
                              <p className="mt-1 text-[10.5px] text-amber-600">Follow-up cadence: {FOLLOWUP_LABEL[t.followupStep]}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Link href={t.href} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white">
                                Open {t.module} <ArrowRight size={12} />
                              </Link>
                              <button onClick={() => act({ action: "done", id: t.id })} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><CheckCircle2 size={12} /> Done</button>
                              <button onClick={() => { const d = window.prompt("Snooze until (YYYY-MM-DD):"); if (d) act({ action: "snooze", id: t.id, until: d }); }}
                                className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><MoonStar size={12} /> Snooze</button>
                              <DelegateButton task={t} onAssign={(who) => act({ action: "assign", id: t.id, assigneeId: who })} />
                              <button onClick={() => act({ action: "dismiss", id: t.id })} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Dismiss</button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ================= DECISIONS ================= */}
      {data && tab === "decisions" && (
        <div className="space-y-2">
          <p className="text-[11px] text-biome-muted">Only what needs a human to choose. Background, risk and a recommendation — then the buttons.</p>
          {decisions.length === 0 && (
            <GlassCard className="p-8 text-center"><p className="text-[12.5px] font-bold text-biome-text">No decisions waiting</p></GlassCard>
          )}
          {decisions.map(({ task: t, risk, overdueDays, recommendation }, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-biome-text">{i + 1}. {t.title}</p>
                  <p className="mt-0.5 text-[10.5px] text-biome-muted">{t.module}{t.amount ? ` · ${inr(t.amount)}` : ""}{overdueDays ? ` · ${overdueDays}d overdue` : ""}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[.1em] ${
                  risk === "HIGH" ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : risk === "MEDIUM" ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                }`}>Risk {risk}</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Background" text={t.why} />
                <Field label="Evidence" text={t.evidence.join(" · ") || "—"} />
                <Field label="AI recommendation" text={recommendation} strong />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Link href={t.href} className="bmx-btn flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11px] font-bold text-white">Decide in {t.module} <ArrowRight size={12} /></Link>
                <button onClick={() => act({ action: "done", id: t.id })} className="bmx-chip rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">Mark decided</button>
                <DelegateButton task={t} onAssign={(who) => act({ action: "assign", id: t.id, assigneeId: who })} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ================= AUTOPILOT ================= */}
      {data && tab === "autopilot" && (
        <div className="grid gap-3 lg:grid-cols-[1.2fr,1fr]">
          <GlassCard className="p-5">
            <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Business summary · last run</p>
            {lastRun ? (
              <>
                <p className="mt-1 text-[11px] text-biome-muted">{new Date(lastRun.at).toLocaleString("en-IN")}</p>
                <ul className="mt-3 space-y-1.5 text-[12px] text-biome-text">
                  {lastRun.agentStats && (
                    <>
                      <li>✓ {lastRun.agentStats.documentsProcessed} WhatsApp documents in filed supply sets</li>
                      <li>✓ {lastRun.agentStats.setsComplete} supply sets complete · ⚠ {lastRun.agentStats.setsIncomplete} incomplete</li>
                    </>
                  )}
                  <li>✓ {lastRun.autoResolved} task{lastRun.autoResolved === 1 ? "" : "s"} closed automatically (condition cleared)</li>
                  <li>✓ {lastRun.created} new task{lastRun.created === 1 ? "" : "s"} detected</li>
                  <li>{lastRun.followupsDue ? "⚠" : "✓"} {lastRun.followupsDue} follow-up{lastRun.followupsDue === 1 ? "" : "s"} due on the 1·3·5·7 cadence</li>
                  <li>{lastRun.escalated ? "⚠" : "✓"} {lastRun.escalated} escalation{lastRun.escalated === 1 ? "" : "s"} raised</li>
                  <li>{decisions.length ? "⚠" : "✓"} {decisions.length} decision{decisions.length === 1 ? "" : "s"} require approval</li>
                </ul>
                {lastRun.notes.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[.06] px-3 py-2 text-[10.5px] text-amber-600">
                    {lastRun.notes.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                )}
              </>
            ) : <p className="mt-2 text-[11px] text-biome-muted">No run yet — press "Run autopilot now".</p>}
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">What it watches</p>
            <ul className="mt-2 space-y-1 text-[11px] text-biome-text">
              {Object.entries(lastRun?.byModule || {}).map(([m, n]) => <li key={m} className="flex justify-between"><span>{m}</span><span className="font-mono text-biome-muted">{n}</span></li>)}
              {!lastRun && <li className="text-biome-muted">Registration · Imprest · Leave · Coordination · Company documents · Employees · Month-end · WhatsApp supply sets</li>}
            </ul>
            <p className="mt-3 text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Runs</p>
            <ul className="mt-1 space-y-0.5">
              {(data.runs || []).map((r: Run) => (
                <li key={r.at} className="flex justify-between text-[10.5px] text-biome-muted">
                  <span>{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>+{r.created} · ✓{r.autoResolved} · ⚠{r.escalated}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] leading-relaxed text-biome-muted">
              Runs by itself whenever this screen is opened after 30 minutes of quiet. Reads only — every send stays a button a person presses.
            </p>
          </GlassCard>
        </div>
      )}

      {/* ================= MY WORK (personal workload) ================= */}
      {data && tab === "mine" && <MyWork tasks={data.planner.tasks} me={data.me} today={data.today} onAct={act} />}

      {/* ================= AUTOMATIONS (no-code workflows) ================= */}
      {data && tab === "automations" && <Automations />}

      {/* ================= MONTH-END ================= */}
      {data && tab === "monthend" && <MonthEnd tasks={data.planner.tasks} decisions={decisions} />}

      {creating && <CreateTask onClose={() => setCreating(false)} onCreate={async (b) => { await act({ action: "create", ...b }); setCreating(false); }} />}
    </div>
  );
}

/** Squarespace-style count-up: the number rolls to its value on load and
 *  whenever it changes, so the day's totals feel alive instead of static. */
function useCountUp(target: number, ms = 700) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now(); const from = n;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return n;
}

function Stat({ label, value, tone, hint, onClick, active }: { label: string; value: number; tone: "rose" | "orange" | "amber" | "emerald"; hint?: string; onClick?: () => void; active?: boolean }) {
  const cls = { rose: "text-rose-500", orange: "text-orange-500", amber: "text-amber-500", emerald: "text-emerald-500" }[tone];
  const shown = useCountUp(value);
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`bmx-card rounded-2xl border bg-biome-bgSoft p-4 text-left transition-colors ${active ? "border-biome-leaf/50" : "border-biome-line"}`}>
      <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
      <p className={`mt-1 font-mono text-[34px] font-semibold leading-none tracking-tight ${cls}`}>{shown}</p>
      {hint && <p className="mt-1 text-[9.5px] text-biome-muted">{hint}</p>}
    </button>
  );
}

function Field({ label, text, strong }: { label: string; text: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[9.5px] font-bold uppercase tracking-[.14em] text-biome-muted">{label}</p>
      <p className={`mt-1 text-[11.5px] leading-relaxed ${strong ? "font-semibold text-biome-leafBright" : "text-biome-text"}`}>{text}</p>
    </div>
  );
}

function DelegateButton({ task, onAssign }: { task: Task; onAssign: (userId: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; role: string }[] | null>(null);
  async function openList() {
    const res = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delegates", id: task.id }) });
    const json = await res.json().catch(() => ({}));
    setList(json.delegates || []);
  }
  return (
    <span className="relative">
      <button onClick={openList} className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"><UserPlus size={12} /> Delegate</button>
      {list && (
        <div className="absolute z-20 mt-1 w-56 rounded-xl border border-biome-line bg-biome-bgSoft p-1 shadow-xl" onMouseLeave={() => setList(null)}>
          {list.length === 0 && <p className="px-2.5 py-1.5 text-[10.5px] text-biome-muted">Nobody eligible.</p>}
          {list.map((u) => (
            <button key={u.id} onClick={() => { onAssign(u.id); setList(null); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] text-biome-text hover:bg-biome-leaf/12">
              <span>{u.name}</span><span className="text-[9.5px] text-biome-muted">{u.role}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function MonthEnd({ tasks, decisions }: { tasks: Task[]; decisions: Decision[] }) {
  const has = (module: string) => tasks.some((t) => t.module === module && t.status === "open");
  const items = [
    { label: "Attendance marked & locked for the month", done: !has("Attendance"), href: "/attendance" },
    { label: "Leave requests decided", done: !tasks.some((t) => t.module === "Leave" && t.status === "open"), href: "/leave" },
    { label: "Imprest entries approved / settled", done: !tasks.some((t) => t.module === "Imprest" && t.status === "open"), href: "/imprest" },
    { label: "Supply sets complete — no missing papers", done: !tasks.some((t) => t.module === "WhatsApp Documents" && t.status === "open"), href: "/whatsapp" },
    { label: "Receivings in for every dispatch", done: !tasks.some((t) => t.module === "Coordination" && t.status === "open"), href: "/coordination" },
    { label: "Vendor KYC & expiries clear", done: !tasks.some((t) => t.module === "Registration" && t.status === "open"), href: "/partners" },
    { label: "Payroll run approved & locked", done: false, href: "/payroll", manual: true },
    { label: "GST returns loaded & matched", done: false, href: "/gst-compliance", manual: true },
    { label: "Bank reconciliation done", done: false, href: "/reconciliation", manual: true },
    { label: "Local backup / Drive backup taken", done: false, href: "/settings", manual: true },
  ];
  const doneCount = items.filter((i) => i.done).length;
  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Month-end status</p>
          <p className="mt-1 font-mono text-[26px] font-semibold text-biome-text">{doneCount}/{items.length} <span className="text-[12px] font-sans text-biome-muted">auto-verified</span></p>
        </div>
        <p className="text-[10.5px] text-biome-muted">{decisions.length} approval{decisions.length === 1 ? "" : "s"} pending</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-biome-line"><div className="h-full rounded-full bg-biome-leaf transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>
      <ul className="mt-4 space-y-1.5">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bg px-3 py-2">
            {i.done ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Clock size={15} className={i.manual ? "text-biome-muted" : "text-amber-500"} />}
            <span className={`flex-1 text-[11.5px] ${i.done ? "text-biome-muted line-through" : "text-biome-text"}`}>{i.label}</span>
            {i.manual && !i.done && <span className="text-[9px] uppercase tracking-[.1em] text-biome-muted">confirm in module</span>}
            <Link href={i.href} className="text-[10.5px] font-semibold text-biome-leafBright">Open</Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-relaxed text-biome-muted">Items marked automatically flip green the moment the autopilot sees no open work in that module; the rest are confirmed inside their module.</p>
    </GlassCard>
  );
}

function CreateTask({ onClose, onCreate }: { onClose: () => void; onCreate: (b: Record<string, any>) => Promise<void> }) {
  const [f, setF] = useState({ title: "", module: "General", priority: "normal", dueOn: new Date().toISOString().slice(0, 10), nextAction: "", why: "" });
  const [busy, setBusy] = useState(false);
  const input = "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
  return (
    <Portal><div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bmx-card w-full max-w-md rounded-3xl border border-biome-line bg-biome-bgSoft p-6">
        <h3 className="text-[15px] font-bold text-biome-text">Add a task</h3>
        <p className="mb-4 mt-1 text-[10.5px] text-biome-muted">For the things no detector can see yet.</p>
        <div className="space-y-3">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs doing" className={input} />
          <div className="grid grid-cols-2 gap-2">
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={input}>
              <option value="critical">Critical</option><option value="urgent">Urgent</option><option value="followup">Follow-up</option><option value="normal">Normal</option>
            </select>
            <input type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} className={input} />
          </div>
          <input value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} placeholder="Next action (optional)" className={input} />
          <input value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Why it matters (optional)" className={input} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="bmx-chip rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
          <button disabled={busy || !f.title} onClick={async () => { setBusy(true); await onCreate(f); setBusy(false); }}
            className="bmx-btn rounded-xl bg-biome-leaf px-5 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div></Portal>
  );
}


/** Personal workload: DO NOW / TODAY / THIS WEEK / OVERDUE / CAN DELEGATE — the roadmap's exact shape. */
function MyWork({ tasks, me, today, onAct }: { tasks: Task[]; me: any; today: string; onAct: (b: Record<string, any>) => Promise<any> }) {
  const mine = tasks.filter((t) => t.assigneeId === me.id || (!t.assigneeId && t.ownerRoles.includes(me.role)));
  const week = new Date(new Date(today).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const buckets = [
    { label: "DO NOW", list: mine.filter((t) => t.priority === "critical" || (t.priority === "urgent" && t.dueOn <= today)), tone: "text-rose-500" },
    { label: "TODAY", list: mine.filter((t) => t.dueOn === today && t.priority !== "critical"), tone: "text-orange-500" },
    { label: "THIS WEEK", list: mine.filter((t) => t.dueOn > today && t.dueOn <= week), tone: "text-amber-500" },
    { label: "OVERDUE", list: mine.filter((t) => t.dueOn < today), tone: "text-rose-500" },
    { label: "CAN DELEGATE", list: mine.filter((t) => !t.assigneeId && t.ownerRoles.length > 1), tone: "text-sky-500" },
  ];
  const first = buckets[0].list[0] || buckets[3].list[0] || buckets[1].list[0] || null;
  const slow = mine.filter((t) => t.status === "open" && Math.floor((new Date(today).getTime() - new Date(t.createdAt).getTime()) / 86400000) >= 7);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.label} className="bmx-card rounded-2xl border border-biome-line bg-biome-bgSoft p-3 text-center">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-biome-muted">{b.label}</p>
            <p className={`mt-1 font-mono text-[26px] font-semibold ${b.tone}`}>{b.list.length}</p>
          </div>
        ))}
      </div>
      <GlassCard className="p-4">
        <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Recommendation</p>
        {first ? (
          <p className="mt-1 text-[12px] text-biome-text">Start with <b>{first.title}</b> — {first.why}</p>
        ) : <p className="mt-1 text-[12px] text-biome-muted">Nothing is assigned to you right now.</p>}
        {slow.length > 0 && <p className="mt-1.5 text-[11px] text-amber-600">⚠ {slow.length} task{slow.length === 1 ? " has" : "s have"} been open 7+ days — blocked? Delegate or ask for help.</p>}
        {buckets[4].list.length > 0 && <p className="mt-1 text-[11px] text-sky-600">{buckets[4].list.length} task{buckets[4].list.length === 1 ? "" : "s"} could be delegated — use Delegate on the planner.</p>}
      </GlassCard>
      <div className="space-y-1.5">
        {mine.slice(0, 30).map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-biome-line bg-biome-bgSoft px-4 py-2.5">
            <span className={`h-2 w-2 rounded-full ${PRIO[t.priority].dot}`} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-biome-text">{t.title}</span>
            <span className="text-[10px] text-biome-muted">{t.dueOn}</span>
            <Link href={t.href} className="text-[10.5px] font-semibold text-biome-leafBright">Open</Link>
            <button onClick={() => onAct({ action: "done", id: t.id })} className="text-[10.5px] font-semibold text-biome-muted hover:text-biome-text">Done</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** No-code automations: WHEN → IF → THEN. */
function Automations() {
  const [rules, setRules] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", when: "task_open", field: "amount", op: "gt", value: "", action: "set_priority", actionValue: "urgent" });
  const load = useCallback(async () => {
    const res = await fetch("/api/workflows", { cache: "no-store" }); const json = await res.json().catch(() => ({}));
    setRules(json.rules || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function post(body: Record<string, any>) {
    const res = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Failed."); return; }
    setErr(null); await load();
  }
  const input = "bmx-input rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[11.5px] text-biome-text outline-none";
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr,1.2fr]">
      <GlassCard className="p-5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">New rule</p>
        <p className="mt-1 text-[10.5px] text-biome-muted">Runs on every autopilot pass. Actions are limited to safe ones — nothing is sent automatically.</p>
        <div className="mt-3 space-y-2">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rule name — e.g. Big imprest needs director" className={`${input} w-full`} />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
            <span className="font-bold text-biome-text">WHEN</span>
            <select value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} className={input}><option value="task_created">a task is created</option><option value="task_open">a task is open</option><option value="task_overdue">a task is overdue</option></select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
            <span className="font-bold text-biome-text">IF</span>
            <select value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })} className={input}><option value="amount">amount</option><option value="module">module</option><option value="priority">priority</option><option value="kind">kind</option><option value="plant">plant</option><option value="overdueDays">overdue days</option></select>
            <select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })} className={input}><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="is">is</option><option value="is_not">is not</option><option value="contains">contains</option></select>
            <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="value (e.g. 500000 / Imprest)" className={`${input} w-40`} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-biome-muted">
            <span className="font-bold text-biome-text">THEN</span>
            <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className={input}><option value="set_priority">set priority</option><option value="assign_role">hand to role</option><option value="mark_decision">send for approval (Decision Center)</option><option value="escalate">escalate to level</option><option value="add_note">add note</option></select>
            <input value={f.actionValue} onChange={(e) => setF({ ...f, actionValue: e.target.value })} placeholder="critical / admin / 2 / note" className={`${input} w-40`} />
          </div>
          {err && <p className="text-[10.5px] text-rose-500">{err}</p>}
          <button onClick={() => post({ action: "create", name: f.name, when: f.when, if: f.value ? [{ field: f.field, op: f.op, value: f.value }] : [], then: [{ kind: f.action, value: f.actionValue }] })}
            disabled={!f.name} className="bmx-btn rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">Save rule</button>
        </div>
      </GlassCard>
      <GlassCard className="p-5">
        <p className="text-[9.5px] font-bold uppercase tracking-[.16em] text-biome-muted">Rules</p>
        {rules === null && <Loader2 size={16} className="bmx-spin mt-3 text-biome-muted" />}
        {rules && rules.length === 0 && <p className="mt-2 text-[11px] text-biome-muted">No rules yet. Example: WHEN a task is open · IF amount &gt; 500000 · THEN send for approval.</p>}
        <div className="mt-2 space-y-1.5">
          {(rules || []).map((r) => (
            <div key={r.id} className={`rounded-xl border px-3 py-2 ${r.enabled ? "border-biome-line bg-biome-bg" : "border-biome-line/50 opacity-60"}`}>
              <div className="flex items-center gap-2"><p className="flex-1 text-[12px] font-semibold text-biome-text">{r.name}</p><span className="text-[9.5px] text-biome-muted">fired {r.fired}×</span>
                <button onClick={() => post({ action: "toggle", id: r.id })} className="text-[10px] font-semibold text-biome-leafBright">{r.enabled ? "Disable" : "Enable"}</button>
                <button onClick={() => post({ action: "delete", id: r.id })} className="text-[10px] font-semibold text-rose-500">Delete</button></div>
              <p className="mt-0.5 text-[10.5px] text-biome-muted">WHEN {r.when.replace("_", " ")} · IF {r.if.map((c: any) => `${c.field} ${c.op} ${c.value}`).join(" & ") || "always"} · THEN {r.then.map((a: any) => `${a.kind.replace("_", " ")} ${a.value}`).join(", ")}</p>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
