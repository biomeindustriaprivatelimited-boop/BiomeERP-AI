import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadRuns, saveRuns, loadEmployees } from "@/lib/payroll";
import { sendMail, payslipEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email payslips for an approved month.
 *
 * The PDF is built in the browser and posted here, because jsPDF is a
 * client library and running a second PDF stack on the server just to
 * produce the same document would risk the emailed slip differing from the
 * one on screen.
 *
 * Only an APPROVED or PAID run can be mailed. Sending a draft would put a
 * figure in someone's inbox that accounts is still editing.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.approve");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.runId) return NextResponse.json({ error: "Which month?" }, { status: 400 });

  const run = loadRuns().find((r) => r.id === body.runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (run.status === "draft") {
    return NextResponse.json(
      { error: "Approve the month before emailing payslips — a draft can still change." },
      { status: 409 }
    );
  }

  const employees = loadEmployees();
  const monthLabel = new Date(run.month + "-01").toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

  const items: { employeeId: string; pdfBase64: string }[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "No payslips were sent to be mailed." }, { status: 400 });

  const results: { name: string; email: string; ok: boolean; error?: string }[] = [];

  for (const item of items) {
    const employee = employees.find((e) => e.id === item.employeeId);
    const slip = run.payslips.find((p) => p.employeeId === item.employeeId);
    if (!employee || !slip) continue;

    if (!employee.email) {
      results.push({ name: employee.name, email: "", ok: false, error: "No work email on file." });
      continue;
    }

    const mail = payslipEmail(employee.name, monthLabel, slip.netPay);
    const sent = await sendMail({
      to: employee.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        {
          filename: `Payslip-${employee.code}-${run.month}.pdf`,
          content: Buffer.from(item.pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });

    results.push({ name: employee.name, email: employee.email, ok: sent.ok, error: sent.error });

    // A short gap between messages: Gmail throttles a burst and starts
    // refusing, which would look like a broken feature rather than a limit.
    if (sent.ok) await new Promise((r) => setTimeout(r, 400));
  }

  const sentCount = results.filter((r) => r.ok).length;

  // Stamp the run so the "due to be emailed" list stops offering it, and so
  // a second click doesn't quietly send everybody a duplicate.
  if (sentCount > 0) {
    const runs = loadRuns();
    saveRuns(
      runs.map((r) =>
        r.id === run.id
          ? ({ ...r, payslipsMailedAt: new Date().toISOString(), payslipsMailedCount: sentCount } as any)
          : r
      )
    );
  }

  return NextResponse.json({
    sent: sentCount,
    failed: results.filter((r) => !r.ok),
    // Which addresses actually received one — the single-slip Email
    // button shows this back to the person as confirmation.
    sentTo: results.filter((r) => r.ok).map((r) => r.email),
    results,
  });
}
