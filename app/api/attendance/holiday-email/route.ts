import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadEmployees } from "@/lib/payroll";
import { sendMail } from "@/lib/mailer";

/**
 * "Announce a holiday / shutdown" — plant-wise, sent BY HAND.
 *
 * Deliberately manual: a wrong automated holiday email is a plant that
 * doesn't show up for work. A person writes it, picks the plant, sees
 * exactly who will receive it, and presses send.
 *
 * Goes to every ACTIVE employee of the chosen plant who has a work
 * email on file; the response lists who could not be reached so the
 * notice can be passed to them another way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "attendance.entry");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const plant = String(body?.plant || "").trim();
  const kind = body?.kind === "shutdown" ? "Shutdown" : "Holiday";
  const dates = String(body?.dates || "").trim();
  const reason = String(body?.reason || "").trim();
  const note = String(body?.note || "").trim();

  if (!plant) return NextResponse.json({ error: "Which plant is this for?" }, { status: 400 });
  if (!dates) return NextResponse.json({ error: "Which date(s)? e.g. 26 Aug 2026, or 26–28 Aug 2026." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "Say why — the reason goes into the notice." }, { status: 400 });

  const everyone = loadEmployees().filter((e) => e.active);
  const target = plant === "ALL" ? everyone : everyone.filter((e) => (e.plant || "Head office") === plant);
  if (!target.length) {
    return NextResponse.json({ error: `No active employees found for ${plant}.` }, { status: 404 });
  }

  const withEmail = target.filter((e) => e.email);
  const withoutEmail = target.filter((e) => !e.email).map((e) => e.name);

  const where = plant === "ALL" ? "all plants and offices" : plant;
  const subject = `${kind} notice — ${where}: ${dates}`;
  const text =
    `${kind.toUpperCase()} NOTICE\n\n` +
    `Applies to: ${where}\nDate(s): ${dates}\nReason: ${reason}\n` +
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
          <tr><td style="padding:4px 0;color:#6a6c6a;width:120px">Applies to</td><td style="padding:4px 0"><b>${where}</b></td></tr>
          <tr><td style="padding:4px 0;color:#6a6c6a">Date(s)</td><td style="padding:4px 0"><b>${dates}</b></td></tr>
          <tr><td style="padding:4px 0;color:#6a6c6a">Reason</td><td style="padding:4px 0">${reason}</td></tr>
        </table>
        ${note ? `<p style="margin-top:14px">${note}</p>` : ""}
        <p style="margin-top:14px">Please plan your work accordingly. If your duties require presence on these dates, your plant manager will contact you directly.</p>
      </div>
      <div style="background:#f0f3ee;padding:12px 24px;font-size:11px;color:#6a6c6a">This notice was sent from the Biome Industria Platform.</div>
    </div>`;

  let sent = 0;
  const failed: { name: string; error: string }[] = [];
  for (const e of withEmail) {
    const r = await sendMail({ to: e.email, subject, text, html });
    if (r.ok) sent += 1;
    else failed.push({ name: e.name, error: r.error || "send failed" });
    if (r.ok) await new Promise((res) => setTimeout(res, 350));
  }

  return NextResponse.json({
    sent,
    total: target.length,
    failed,
    // Reached another way: pinboard, phone, plant manager.
    noEmail: withoutEmail,
  });
}
