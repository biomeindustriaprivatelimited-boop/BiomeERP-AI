import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadWork, visibleTasks } from "@/lib/work";
import { loadLeave, loadHolidays } from "@/lib/leave";

/** Everything with a date in a month: task due dates, leave, holidays, month-end. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const inMonth = (d: string) => String(d || "").startsWith(month);

  const items: { date: string; kind: string; label: string; tone: string; href: string; weight: number }[] = [];

  for (const t of visibleTasks(loadWork().tasks, { id: user.id, role: user.role, plant: auth.session.plant })) {
    if (t.status !== "open" || !inMonth(t.dueOn)) continue;
    const hot = t.priority === "critical" || t.priority === "urgent";
    items.push({
      date: t.dueOn, kind: "task", label: t.title, href: "/work",
      tone: hot ? "border-rose-500/40 bg-rose-500/10 text-rose-500" : "border-sky-400/40 bg-sky-400/10 text-sky-600",
      weight: hot ? 2 : 1,
    });
  }

  try {
    for (const r of loadLeave()) {
      if (r.status === "rejected") continue;
      const from = new Date(r.fromDate), to = new Date(r.toDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        if (!inMonth(ds)) continue;
        items.push({
          date: ds, kind: "leave", label: `${r.employeeName} — ${r.type}${r.status === "pending" ? " (pending)" : ""}`, href: "/leave",
          tone: "border-violet-400/40 bg-violet-400/10 text-violet-500", weight: 1,
        });
      }
    }
  } catch { /* leave file absent */ }

  try {
    for (const h of loadHolidays()) {
      if (inMonth((h as any).date)) {
        items.push({ date: (h as any).date, kind: "holiday", label: (h as any).name || "Holiday", href: "/leave", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", weight: 0 });
      }
    }
  } catch { /* none */ }

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  for (let d = Math.max(1, lastDay - 5); d <= lastDay; d++) {
    items.push({ date: `${month}-${String(d).padStart(2, "0")}`, kind: "monthend", label: "Month-end window", href: "/work?tab=monthend", tone: "border-amber-400/40 bg-amber-400/10 text-amber-600", weight: 0 });
  }

  return NextResponse.json({ month, items });
}
