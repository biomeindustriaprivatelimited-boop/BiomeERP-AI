import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { sendMail } from "@/lib/mailer";
import { plantOptions } from "@/lib/plants";
import { loadHolidays, saveHolidays, datesBetween, regionForEmployee, Holiday } from "@/lib/leave";
import { applyHolidayToRegisters } from "@/lib/attendance";
import { recordAudit } from "@/lib/audit";

/**
 * "Announce a holiday / shutdown" — developer and admin only.
 *
 * Three things happen, in this order, and the first two never depend on
 * the third:
 *   1. the date(s) go on the holiday calendar for the chosen plant's state
 *      (or every state, for "ALL"),
 *   2. the attendance register gets H on those days for everyone it
 *      applies to (blank days only; a locked month is left alone),
 *   3. if asked, the notice is emailed to every active employee of the
 *      plant with a work email.
 *
 * The old version took the dates as free text and only sent email, so it
 * changed nothing in the app; and its plant picker rendered plant OBJECTS
 * as option labels, which crashed the dialog the moment it opened.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  if (user.role !== "developer" && user.role !== "admin") {
    return NextResponse.json(
      { error: "Only the developer or the admin can announce a holiday." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const plant = String(body?.plant || "ALL").trim().toUpperCase();
  const kind = body?.kind === "shutdown" ? "Shutdown" : "Holiday";
  const fromDate = String(body?.fromDate || "").slice(0, 10);
  const toDate = String(body?.toDate || fromDate).slice(0, 10);
  const reason = String(body?.reason || "").trim().slice(0, 80);
  const note = String(body?.note || "").trim().slice(0, 600);
  const email = body?.email !== false;

  const plants = plantOptions();
  if (plant !== "ALL" && !plants.some((p) => p.code === plant)) {
    return NextResponse.json({ error: "Which plant is this for?" }, { status: 400 });
  }
  if (!DAY.test(fromDate) || !DAY.test(toDate)) {
    return NextResponse.json({ error: "Choose the date (and the end date for a shutdown period)." }, { status: 400 });
  }
  if (toDate < fromDate) return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "Name the holiday or give the reason." }, { status: 400 });
  const dates = datesBetween(fromDate, toDate);
  if (dates.length > 60) {
    return NextResponse.json({ error: "That range is longer than 60 days. Announce it in shorter blocks." }, { status: 400 });
  }

  // Which states' calendars this goes on.
  const regions = plant === "ALL"
    ? [...new Set(["HR", "MH", "DL", ...plants.map((p) => p.state).filter(Boolean)])]
    : [regionForEmployee(plant)];

  // 1. calendar
  const holidays = loadHolidays();
  let added = 0;
  for (const date of dates) {
    const clash = holidays.find((h) => h.date === date && h.name.toLowerCase() === reason.toLowerCase());
    if (clash) { clash.regions = [...new Set([...clash.regions, ...regions])]; continue; }
    const entry: Holiday = {
      date, name: reason, regions, confirm: false,
      announcedAt: new Date().toISOString(), announcedBy: user.name,
      kind: kind === "Shutdown" ? "shutdown" : "holiday", ...(note ? { note } : {}),
    };
    holidays.push(entry);
    added += 1;
  }
  saveHolidays(holidays.sort((a, b) => a.date.localeCompare(b.date)));

  // 2. register
  const everyone = loadEmployees();
  const attendanceMarked = applyHolidayToRegisters(dates, regions, everyone, user.name);

  // 3. email (optional; failures are reported, never fatal)
  const active = everyone.filter((e) => e.active);
  const target = plant === "ALL" ? active : active.filter((e) => e.plant === plant);
  const where = plant === "ALL" ? "all plants and offices" : (plants.find((p) => p.code === plant)?.label || plant);
  const datesLabel = fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;

  let sent = 0;
  const failed: { name: string; error: string }[] = [];
  const noEmail = target.filter((e) => !e.email).map((e) => e.name);
  if (email) {
    const subject = `${kind} notice — ${where}: ${datesLabel}`;
    const text =
      `${kind.toUpperCase()} NOTICE\n\nApplies to: ${where}\nDate(s): ${datesLabel}\nReason: ${reason}\n` +
      (note ? `\n${note}\n` : "") +
      `\nPlease plan your work accordingly. If your duties require presence on these dates, ` +
      `your plant manager will contact you directly.\n\n— Biome Industria Private Limited`;
    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #d5dad0;border-radius:12px;overflow:hidden">
        <div style="background:#163300;color:#9fe870;padding:18px 24px">
          <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase">Biome Industria Private Limited</div>
          <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:4px">${kind} Notice</div>
        </div>
        <div style="padding:22px 24px;color:#202420;font-size:14px;line-height:1.6">
          <table style="width:100%;font-size:14px;border-collapse:collapse">
            <tr><td style="padding:4px 0;color:#6a6c6a;width:120px">Applies to</td><td style="padding:4px 0"><b>${esc(where)}</b></td></tr>
            <tr><td style="padding:4px 0;color:#6a6c6a">Date(s)</td><td style="padding:4px 0"><b>${esc(datesLabel)}</b></td></tr>
            <tr><td style="padding:4px 0;color:#6a6c6a">Reason</td><td style="padding:4px 0">${esc(reason)}</td></tr>
          </table>
          ${note ? `<p style="margin-top:14px">${esc(note)}</p>` : ""}
          <p style="margin-top:14px">Please plan your work accordingly.</p>
        </div>
        <div style="background:#f0f3ee;padding:12px 24px;font-size:11px;color:#6a6c6a">This notice was sent from the Biome Industria Platform.</div>
      </div>`;
    for (const e of target.filter((x) => x.email)) {
      const r = await sendMail({ to: e.email, subject, text, html });
      if (r.ok) { sent += 1; await new Promise((res) => setTimeout(res, 350)); }
      else {
        failed.push({ name: e.name, error: r.error || "send failed" });
        // Mail switched off / not set up fails identically for everyone —
        // stop after the first instead of trying forty times.
        if (/switched off|isn't set up/i.test(r.error || "")) break;
      }
    }
  }

  recordAudit({
    action: "HOLIDAY_ANNOUNCED",
    userId: user.id, userName: user.name, role: user.role,
    targetType: "holiday", targetLabel: reason,
    detail: `${datesLabel} · ${where} · ${attendanceMarked} attendance day(s) marked H${email ? ` · ${sent} emailed` : ""}`,
  });

  return NextResponse.json({
    ok: true,
    added,
    regions,
    attendanceMarked,
    sent,
    total: target.length,
    failed,
    noEmail,
  });
}
