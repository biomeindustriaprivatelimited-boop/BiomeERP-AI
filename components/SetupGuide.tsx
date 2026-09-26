"use client";

import { ReactNode } from "react";
import { Check, ArrowRight, Circle } from "lucide-react";

/**
 * First-run guide.
 *
 * A module with no data is not "working but empty" — to the person looking
 * at it, it is broken. Imprest and payroll both shipped with a blank screen
 * on a fresh install and were reported as not working, which was fair.
 * This replaces that blank with the shortest path to a working module.
 *
 * It disappears on its own once the first step is done, so it never becomes
 * furniture.
 */

export interface SetupStep {
  title: string;
  detail: string;
  done: boolean;
  action?: { label: string; onClick: () => void };
  /** Shown greyed with a note instead of an action. */
  blockedBy?: string;
}

export default function SetupGuide({
  title,
  intro,
  steps,
  footnote,
}: {
  title: string;
  intro: string;
  steps: SetupStep[];
  footnote?: ReactNode;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  // The first step that isn't finished is the only one worth acting on.
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <section className="bmx-rise overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft">
      <div className="relative overflow-hidden border-b border-biome-line bg-biome-leaf/[.07] px-5 py-4">
        <span
          className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
          style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent)" }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-biome-text">{title}</h2>
            <p className="mt-0.5 text-[11.5px] text-biome-muted">{intro}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-biome-line">
              <div
                className="h-full rounded-full bg-biome-leaf transition-[width] duration-500"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[11px] font-semibold text-biome-muted">
              {doneCount}/{steps.length}
            </span>
          </div>
        </div>
      </div>

      <ol className="divide-y divide-biome-line">
        {steps.map((step, i) => {
          const current = i === currentIndex;
          return (
            <li
              key={step.title}
              className={`bmx-rise flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors ${
                current ? "bg-biome-bg/50" : ""
              }`}
              style={{ animationDelay: `${0.06 + i * 0.06}s` }}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  step.done
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-600"
                    : current
                    ? "border-biome-leaf/50 text-biome-leaf"
                    : "border-biome-line text-biome-muted/40"
                }`}
              >
                {step.done ? <Check size={12} strokeWidth={3.5} /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              </span>

              <div className="min-w-[180px] flex-1">
                <p className={`text-[12.5px] font-semibold ${step.done ? "text-biome-muted line-through" : "text-biome-text"}`}>
                  {step.title}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">{step.detail}</p>
              </div>

              {step.done ? (
                <span className="text-[10px] font-bold uppercase tracking-[.12em] text-emerald-600">Done</span>
              ) : step.blockedBy ? (
                <span className="flex items-center gap-1.5 text-[10.5px] text-biome-muted">
                  <Circle size={9} /> {step.blockedBy}
                </span>
              ) : step.action ? (
                <button
                  onClick={step.action.onClick}
                  className={`bmx-btn flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold transition ${
                    current
                      ? "bg-biome-leaf text-white"
                      : "border border-biome-line text-biome-muted"
                  }`}
                >
                  {step.action.label} <ArrowRight size={12} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>

      {footnote && (
        <div className="border-t border-biome-line px-5 py-3">
          <p className="text-[10.5px] leading-relaxed text-biome-muted">{footnote}</p>
        </div>
      )}
    </section>
  );
}

/**
 * The other half of the same problem: a module that is set up but has
 * nothing in it yet, for a person who cannot set it up themselves.
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="bmx-rise rounded-2xl border border-dashed border-biome-line px-6 py-12 text-center">
      <p className="text-[13px] font-semibold text-biome-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[420px] text-[11.5px] leading-relaxed text-biome-muted">{detail}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="bmx-btn mt-4 inline-flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white"
        >
          {action.label} <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
