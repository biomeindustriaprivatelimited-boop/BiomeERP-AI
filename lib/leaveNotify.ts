/**
 * Leave & holiday emails (server only)
 * -------------------------------------------------------------------
 * When the developer or admin announces a holiday, every employee it
 * applies to gets an email; when a leave request is decided, the person
 * gets one too. All through lib/mailer.sendMail, and never in the way of
 * the action itself: the calendar is saved first, the mail goes out in
 * the background, and the outcome is recorded in
 * attendance/holiday-notices.json so the leave page can say
 * "5 of 7 emailed — 2 have no work email".
 */
import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { sendMail } from "@/lib/mailer";
import { loadEmployees } from "@/lib/payroll";
import { regionForEmployee, regionLabel, leaveSpec, type LeaveRequest } from "@/lib/leave";

export interface HolidayNotice {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
  regions: string[];
  note: string;
  by: string;
  at: string;
  /** Employees it applies to (active). */
  total: number;
  /** Of those, with a work email. */
  withEmail: number;
  sent: number;
  failed: { name: string; error: string }[];
  noEmail: string[];
  status: "sending" | "done" | "skipped";
  /** Plain reason when nothing was sent (mail switched off, not set up…). */
  mailNote?: string;
}

function file() { return path.join(paths.root, "attendance", "holiday-notices.json"); }

export function loadNotices(): HolidayNotice[] {
  const f = readJson<{ notices?: HolidayNotice[] }>(file(), { notices: [] });
  return Array.isArray(f.notices) ? f.notices : [];
}

function saveNotice(n: HolidayNotice) {
  ensureDir(path.join(paths.root, "attendance"));
  const rest = loadNotices().filter((x) => x.id !== n.id);
  writeJsonAtomic(file(), { notices: [n, ...rest].slice(0, 200) });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const nice = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

function card(title: string, rows: [string, string][], body: string) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #d5dad0;border-radius:12px;overflow:hidden">
      <div style="background:#163300;color:#9fe870;padding:18px 24px">
        <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase">Biome Industria Private Limited</div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:4px">${esc(title)}</div>
      </div>
      <div style="padding:22px 24px;color:#202420;font-size:14px;line-height:1.6">
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          ${rows.map(([k, v]) => `<tr><td style="padding:4px 0;color:#6a6c6a;width:130px">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}
        </table>
        ${body}
      </div>
      <div style="background:#f0f3ee;padding:12px 24px;font-size:11px;color:#6a6c6a">Sent from the Biome Industria Platform. Open Leave in the app to see your calendar.</div>
    </div>`;
}

/**
 * Email a newly announced holiday to everyone it applies to. Returns at
 * once with who will be written to; the sending happens afterwards.
 */
export function notifyHolidayAnnounced(input: {
  name: string; fromDate: string; toDate: string; regions: string[]; note?: string; by: string;
}): HolidayNotice {
  const staff = loadEmployees().filter((e) => e.active && input.regions.includes(regionForEmployee(e.plant)));
  const withEmail = staff.filter((e) => e.email);
  const notice: HolidayNotice = {
    id: crypto.randomUUID(),
    name: input.name, fromDate: input.fromDate, toDate: input.toDate,
    regions: input.regions, note: input.note || "", by: input.by, at: new Date().toISOString(),
    total: staff.length, withEmail: withEmail.length, sent: 0, failed: [],
    noEmail: staff.filter((e) => !e.email).map((e) => e.name),
    status: withEmail.length ? "sending" : "skipped",
    mailNote: withEmail.length ? undefined : staff.length ? "Nobody it applies to has a work email." : "No employees in these locations yet.",
  };
  saveNotice(notice);
  if (!withEmail.length) return notice;

  const dates = input.fromDate === input.toDate ? nice(input.fromDate) : `${nice(input.fromDate)} to ${nice(input.toDate)}`;
  const where = input.regions.map(regionLabel).join(", ");
  const subject = `Holiday notice: ${input.name} — ${dates}`;
  const text =
    `HOLIDAY NOTICE\n\n${input.name}\nDate(s): ${dates}\nApplies to: ${where}\n` +
    (input.note ? `\n${input.note}\n` : "") +
    `\nThe day(s) are marked as Holiday in attendance and appear on the Leave page of the app.\n\n— Biome Industria Private Limited`;
  const html = card("Holiday notice", [["Holiday", input.name], ["Date(s)", dates], ["Applies to", where]],
    `${input.note ? `<p style="margin-top:14px">${esc(input.note)}</p>` : ""}<p style="margin-top:14px">The day(s) are marked as Holiday in attendance and appear on the Leave page of the app.</p>`);

  // Background: the person who announced it is not kept waiting, and a
  // mail problem never undoes the holiday.
  void (async () => {
    for (const e of withEmail) {
      const r = await sendMail({ to: e.email, subject, text, html }).catch((err) => ({ ok: false, error: String(err?.message || err) } as any));
      if (r.ok) notice.sent += 1;
      else {
        notice.failed.push({ name: e.name, error: r.error || "send failed" });
        if (/switched off|isn't set up|not set up/i.test(r.error || "")) {
          notice.mailNote = r.error;
          for (const rest of withEmail.slice(withEmail.indexOf(e) + 1)) notice.failed.push({ name: rest.name, error: "not sent (email not set up)" });
          break;
        }
      }
    }
    notice.status = "done";
    try { saveNotice(notice); } catch { /* the record is a convenience */ }
  })();
  return notice;
}

/** Tell the person their leave was approved or not. Fire and forget. */
export function notifyLeaveDecision(r: LeaveRequest): void {
  const emp = loadEmployees().find((e) => e.id === r.employeeId);
  if (!emp?.email || (r.status !== "approved" && r.status !== "rejected")) return;
  const label = leaveSpec(r.type)?.label || r.type;
  const dates = r.fromDate === r.toDate ? nice(r.fromDate) : `${nice(r.fromDate)} to ${nice(r.toDate)}`;
  const verdict = r.status === "approved" ? "approved" : "not approved";
  const subject = `Your ${label.toLowerCase()} (${dates}) was ${verdict}`;
  const text = `Dear ${emp.name},\n\nYour ${label.toLowerCase()} for ${dates} (${r.days} working day(s)) was ${verdict}` +
    `${r.decidedByName ? ` by ${r.decidedByName}` : ""}.${r.decisionNote ? `\nNote: ${r.decisionNote}` : ""}\n\n— Biome Industria Private Limited`;
  const html = card(`Leave ${verdict}`, [["Leave", label], ["Date(s)", dates], ["Working days", String(r.days)], ["Decided by", r.decidedByName || "—"]],
    r.decisionNote ? `<p style="margin-top:14px">Note: ${esc(r.decisionNote)}</p>` : "");
  void sendMail({ to: emp.email, subject, text, html }).catch(() => { /* logged by the mailer */ });
}
