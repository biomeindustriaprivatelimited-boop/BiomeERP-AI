import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadMail, saveMail, publicMail, encrypt, sendMail, MailSettings } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ mail: publicMail(loadMail()) });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const current = loadMail();
  const provider = body.provider === "smtp" ? "smtp" : "gmail";

  const next: MailSettings = {
    enabled: Boolean(body.enabled),
    provider,
    // Gmail's host and port are fixed, so they are not left to be mistyped.
    host: provider === "gmail" ? "smtp.gmail.com" : String(body.host || "").trim(),
    port: provider === "gmail" ? 465 : Math.max(1, Math.min(65535, Number(body.port) || 587)),
    secure: provider === "gmail" ? true : Boolean(body.secure),
    user: String(body.user || "").trim(),
    // An empty password field means "leave it as it is" — otherwise saving
    // any other setting would wipe the credential.
    passwordEnc: body.password ? encrypt(String(body.password)) : current.passwordEnc,
    fromName: String(body.fromName || "Biome Industria").trim(),
    fromEmail: String(body.fromEmail || "").trim(),
    bcc: String(body.bcc || "").trim(),
    autoSendPayslips: Boolean(body.autoSendPayslips),
    autoSendDelayDays: Math.max(0, Math.min(30, Number(body.autoSendDelayDays) ?? current.autoSendDelayDays)),
  };

  if (next.enabled && !next.user) {
    return NextResponse.json({ error: "Enter the address mail will be sent from." }, { status: 400 });
  }
  if (next.enabled && !next.passwordEnc) {
    return NextResponse.json(
      { error: provider === "gmail" ? "Enter the Gmail App Password." : "Enter the SMTP password." },
      { status: 400 }
    );
  }
  if (provider === "smtp" && next.enabled && !next.host) {
    return NextResponse.json({ error: "Enter the SMTP server address." }, { status: 400 });
  }

  saveMail(next);
  return NextResponse.json({ mail: publicMail(next) });
}

/** Send a test message, so a wrong password is found now rather than on payday. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  if (!to) return NextResponse.json({ error: "Enter an address to test with." }, { status: 400 });

  const result = await sendMail({
    to,
    subject: "Biome ERP — test message",
    text:
      "This is a test from the Biome app.\n\n" +
      "If you are reading it, payslips can be sent from this account.",
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
