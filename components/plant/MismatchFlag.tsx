"use client";

/**
 * The 3-day red flag. Fix the row (vehicle / date / weight) and it goes by
 * itself; if the difference is genuine, a note explains it and stops the
 * flag. Accounts / admin / developer see every open one on /mismatches.
 */
export default function MismatchFlag({ flag, onNoted }: { flag: { key: string; flagged: boolean; ageDays: number; explained: boolean }; onNoted: () => void }) {
  async function explain() {
    const note = window.prompt(
      flag.flagged
        ? `Not fixed for ${flag.ageDays} days — accounts can see this. Correct the entry, or write why it is different:`
        : "Why is this different? (e.g. second trip, vehicle went elsewhere)"
    );
    if (!note || !note.trim()) return;
    const r = await fetch("/api/plant-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: flag.key, note }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); window.alert(j.error || "Not saved."); }
    onNoted();
  }
  if (flag.explained) return <span title="Explained with a note" className="mr-1 rounded-full border border-sky-500/35 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-600">✎ Noted</span>;
  return (
    <button type="button" onClick={explain}
      title={flag.flagged ? `Red flag: open ${flag.ageDays} days — fix the entry or click to explain` : `Open ${flag.ageDays} day(s) — becomes a red flag after 3 days. Click to explain.`}
      className={`mr-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${flag.flagged ? "border-rose-600 bg-rose-600 text-white" : "border-biome-line text-biome-muted"}`}>
      {flag.flagged ? `⚑ ${flag.ageDays}d` : `${flag.ageDays}d · note`}
    </button>
  );
}
