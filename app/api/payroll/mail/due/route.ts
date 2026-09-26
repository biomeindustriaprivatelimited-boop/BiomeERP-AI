import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadRuns, loadEmployees } from "@/lib/payroll";
import { loadMail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which approved months are due to have their payslips emailed.
 *
 * This does NOT send. It reports, and the payroll screen offers the send —
 * because the PDFs are built in the browser so that the emailed slip is
 * identical to the downloadable one, and because a background job that
 * mails salaries with nobody watching is a bad idea in a small office.
 *
 * The two-day wait the business asked for is the point: it is the window in
 * which somebody notices a mistake before it reaches forty inboxes.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;

  const mail = loadMail();
  const employees = loadEmployees();
  const now = Date.now();
  const delayMs = (mail.autoSendDelayDays ?? 2) * 24 * 60 * 60 * 1000;

  const due = loadRuns()
    .filter((r) => (r.status === "approved" || r.status === "paid") && r.approvedAt && !(r as any).payslipsMailedAt)
    .map((r) => {
      const approvedAt = new Date(r.approvedAt!).getTime();
      const readyAt = approvedAt + delayMs;
      const withEmail = r.payslips.filter((p) =>
        employees.find((e) => e.id === p.employeeId && e.email)
      ).length;
      return {
        id: r.id,
        month: r.month,
        plant: r.plant,
        approvedAt: r.approvedAt,
        readyAt: new Date(readyAt).toISOString(),
        due: now >= readyAt,
        headcount: r.payslips.length,
        withEmail,
        withoutEmail: r.payslips.length - withEmail,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month));

  return NextResponse.json({
    enabled: mail.enabled,
    autoSendPayslips: mail.autoSendPayslips,
    delayDays: mail.autoSendDelayDays ?? 2,
    runs: due,
    dueNow: due.filter((r) => r.due).length,
  });
}
