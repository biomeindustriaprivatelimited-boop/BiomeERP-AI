"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScrollText, Search, Filter, Loader2, AlertCircle, User, Activity, CheckCircle2, XCircle,
} from "lucide-react";

/**
 * Audit log.
 *
 * Admin only, and read-only by design — there is no way to edit or delete
 * an entry from anywhere in the app, because a trail that can be tidied is
 * not a trail. Deleting a document removes the document; the record that
 * it existed and who removed it stays here for good.
 */

interface Event {
  id: string; at: string; action: string; category: string;
  userId: string; userName: string; role: string;
  targetType?: string; targetId?: string; targetLabel?: string;
  detail?: string; plant?: string | null;
  outcome: "ok" | "failed"; errorMessage?: string;
}

const CATEGORY_TONE: Record<string, string> = {
  auth: "text-sky-600 bg-sky-500/12",
  users: "text-rose-600 bg-rose-500/12",
  imprest: "text-teal-600 bg-teal-500/12",
  payroll: "text-fuchsia-600 bg-fuchsia-500/12",
  employees: "text-emerald-600 bg-emerald-500/12",
  attendance: "text-indigo-600 bg-indigo-500/12",
  plant: "text-amber-600 bg-amber-500/12",
  documents: "text-cyan-600 bg-cyan-500/12",
  cloud: "text-violet-600 bg-violet-500/12",
  support: "text-orange-600 bg-orange-500/12",
  settings: "text-slate-500 bg-slate-500/12", // 600 vanished on the dark themes
  tally: "text-lime-600 bg-lime-500/12",
};

export default function AuditPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>("");
  const [category, setCategory] = useState("all");
  const [userId, setUserId] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (month) p.set("month", month);
      if (category !== "all") p.set("category", category);
      if (userId) p.set("userId", userId);
      if (outcome !== "all") p.set("outcome", outcome);
      if (search.trim()) p.set("search", search.trim());
      const res = await fetch(`/api/audit?${p}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setData(json);
      setError(null);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [month, category, userId, outcome, search]);

  useEffect(() => { load(); }, [load]);

  const events: Event[] = data?.events || [];
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
          <ScrollText size={19} className="text-biome-leaf" /> Audit log
        </h1>
        <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
          Every action, by every person, kept permanently. Nothing here can be edited or removed —
          not by accounts, not by an admin, not by deleting the document it refers to.
        </p>
      </header>

      {error && (
        <div className="bmx-msg-in flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3">
          <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11.5px] text-biome-text">{error}</p>
        </div>
      )}

      {/* ---- Who has been active ---- */}
      {summary?.people?.length > 0 && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
            <Activity size={15} className="text-biome-leaf" /> Activity this month · {summary.total} events
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {summary.people.map((p: any) => (
              <button
                key={p.userId}
                onClick={() => setUserId(userId === p.userId ? "" : p.userId)}
                className={`bmx-chip flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                  userId === p.userId ? "border-biome-leaf/40 bg-biome-leaf/10" : "border-biome-line"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-biome-bg text-biome-muted">
                  <User size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-biome-text">{p.userName}</p>
                  <p className="text-[10px] text-biome-muted">
                    {p.role} · last active {new Date(p.last).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[14px] font-semibold text-biome-text">{p.count}</p>
                  {p.failed > 0 && <p className="text-[9.5px] text-rose-500">{p.failed} failed</p>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-biome-muted" />
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
          {(data?.months || []).map((m: string) => (
            <option key={m} value={m}>
              {new Date(m + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </option>
          ))}
          {(data?.months || []).length === 0 && <option value="">This month</option>}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          <option value="all">Everything</option>
          {Object.keys(CATEGORY_TONE).map((c) => (
            <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectCls}>
          <option value="all">Successes and failures</option>
          <option value="ok">Successes only</option>
          <option value="failed">Failures only</option>
        </select>
        {userId && (
          <button onClick={() => setUserId("")} className="bmx-chip rounded-lg border border-biome-line px-2.5 py-1.5 text-[10.5px] font-semibold text-biome-muted">
            Clear person filter
          </button>
        )}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, person or detail"
            className="bmx-input w-[240px] rounded-xl border border-biome-line bg-biome-bg py-2 pl-8 pr-3 text-[11.5px] text-biome-text outline-none" />
        </div>
      </div>

      {/* ---- The log ---- */}
      <section className="overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
        {loading ? (
          <p className="px-5 py-10 text-center text-[11.5px] text-biome-muted">
            <Loader2 size={14} className="mr-2 inline animate-spin" /> Reading the log…
          </p>
        ) : events.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[13px] font-semibold text-biome-text">Nothing recorded yet</p>
            <p className="mx-auto mt-1.5 max-w-[440px] text-[11.5px] leading-relaxed text-biome-muted">
              Events appear here as people use the app — sign-ins, imprest decisions, payroll
              approvals, document changes and cloud syncs.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-biome-line/60">
            {events.map((e, i) => (
              <div key={e.id} className="bmx-rise flex flex-wrap items-start gap-3 px-4 py-3"
                style={{ animationDelay: `${Math.min(i, 12) * 0.015}s` }}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CATEGORY_TONE[e.category] || CATEGORY_TONE.settings}`}>
                  {e.outcome === "failed" ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                </span>
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[11px] font-semibold text-biome-text">{e.action}</p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] ${CATEGORY_TONE[e.category] || CATEGORY_TONE.settings}`}>
                      {e.category}
                    </span>
                    {e.outcome === "failed" && (
                      <span className="rounded-full border border-rose-500/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-rose-500">
                        failed
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                    <span className="font-semibold text-biome-text">{e.userName}</span> ({e.role})
                    {e.targetLabel && <> · {e.targetLabel}</>}
                    {e.plant && <> · {e.plant}</>}
                    {e.detail && <> — {e.detail}</>}
                  </p>
                  {e.errorMessage && <p className="mt-1 text-[10.5px] text-rose-500">{e.errorMessage}</p>}
                </div>
                <p className="whitespace-nowrap font-mono text-[10px] text-biome-muted">
                  {new Date(e.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const selectCls =
  "rounded-lg border border-biome-line bg-biome-bg px-2.5 py-1.5 text-[11px] text-biome-text outline-none";
