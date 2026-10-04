import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import {
  loadMail, saveMail, publicMail, encrypt, sendMail, readMailLog,
  normaliseSecurity, cleanPassword, settingsWarnings,
  MAIL_PRESETS, MailSettings, MailProvider, MailSecurity,
} from "@/lib/mailer";
import { recordAudit } from "@/lib/audit";

/**
 * Settings → Email (SMTP).
 *
 *   GET  — the saved settings (never the password), the presets and the
 *          last few sends, so "did it go?" can be answered on the screen.
 *   PUT  — save.
 *   POST — send a test message using what is ON THE SCREEN (saved or not),
 *          so a wrong password is found before saving, not on payday.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: MailProvider[] = ["gmail", "outlook", "zoho", "smtp"];

/** Settings as typed on the form, cleaned and made consistent. */
function fromBody(body: any, current: MailSettings): { next: MailSettings; notes: string[] } {
  const provider: MailProvider = PROVIDERS.includes(body?.provider) ? body.provider : "smtp";
  const preset = MAIL_PRESETS[provider];
  const host = String(body?.host ?? "").trim() || preset.host;
  const port = Math.max(1, Math.min(65535, Number(body?.port) || preset.port || 587));
  const wanted: MailSecurity =
    body?.security === "ssl" || body?.security === "starttls" || body?.security === "none"
      ? body.security
      : body?.secure === true ? "ssl" : preset.security;
  const { security, note } = normaliseSecurity(port, wanted);
  const typed = body?.password ? cleanPassword(provider, String(body.password)) : "";

  const delay = Number(body?.autoSendDelayDays);
  const next: MailSettings = {
    enabled: Boolean(body?.enabled),
    provider,
    host,
    port,
    security,
    secure: security === "ssl",
    user: String(body?.user || "").trim(),
    // An empty password field means "leave it as it is" — otherwise saving
    // any other setting would wipe the credential.
    passwordEnc: typed ? encrypt(typed) : current.passwordEnc,
    fromName: String(body?.fromName || "Biome Industria").trim(),
    fromEmail: String(body?.fromEmail || "").trim(),
    bcc: String(body?.bcc || "").trim(),
    autoSendPayslips: Boolean(body?.autoSendPayslips),
    autoSendDelayDays: Math.max(0, Math.min(30, Number.isFinite(delay) ? delay : current.autoSendDelayDays)),
  };
  return { next, notes: note ? [note] : [] };
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;
  return NextResponse.json({
    mail: publicMail(loadMail()),
    presets: MAIL_PRESETS,
    recent: readMailLog(8),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const current = loadMail();
  const { next, notes } = fromBody(body, current);

  // Filling in the address and password for the first time and forgetting
  // the On switch is the commonest reason nothing is ever sent. Turn it on
  // and say so — anyone who wants it off can switch it off again.
  if (!next.enabled && !current.passwordEnc && body.password && next.user) {
    next.enabled = true;
    notes.push("Email has been switched On, since this is the first time a password was saved.");
  }

  if (next.enabled && next.provider !== "smtp" && !next.user) {
    return NextResponse.json({ error: "Enter the email address mail will be sent from." }, { status: 400 });
  }
  if (next.enabled && next.provider !== "smtp" && !next.passwordEnc) {
    return NextResponse.json(
      { error: next.provider === "gmail" ? "Enter the Gmail App Password (16 letters)." : "Enter the password (or app password)." },
      { status: 400 }
    );
  }
  if (next.enabled && !next.host) {
    return NextResponse.json({ error: "Enter the mail server (SMTP host)." }, { status: 400 });
  }
  if (next.bcc && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.bcc)) {
    return NextResponse.json({ error: "The \"copy every payslip to\" address is not a valid email address." }, { status: 400 });
  }

  saveMail(next);
  const user = findById(auth.session.uid);
  recordAudit({
    action: "MAIL_SETTINGS_SAVED",
    userId: auth.session.uid, userName: user?.name || "", role: user?.role || "",
    targetType: "settings", targetId: "mail", targetLabel: "Email (SMTP)",
    detail: `${next.provider} · ${next.host}:${next.port} ${next.security} · ${next.user || "no sign-in"} · ${next.enabled ? "on" : "off"}${body.password ? " · password changed" : ""}`,
  });
  const warnings = settingsWarnings(next, body.password ? String(body.password) : undefined);
  return NextResponse.json({ mail: publicMail(next), notes, warnings });
}

/** Send a test message with the settings on the screen. */
export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "settings");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  if (!to) return NextResponse.json({ error: "Enter an address to send the test to." }, { status: 400 });

  const current = loadMail();
  // The form as typed; fall back to what is saved when no form was sent.
  const { next: settings, notes } = body?.settings ? fromBody(body.settings, current) : { next: current, notes: [] as string[] };
  const typedPassword = body?.settings?.password ? String(body.settings.password) : undefined;

  const started = Date.now();
  const result = await sendMail(
    {
      to,
      subject: "Biome ERP — test email",
      text:
        "This is a test from the Biome app.\n\n" +
        `If you are reading it, email is working: sent through ${settings.host}:${settings.port} (${settings.security.toUpperCase()}) as ${settings.user || settings.fromEmail}.\n\n` +
        "Vendor registration letters, payslips, letters, notices and support updates will go out the same way.",
    },
    { settings, password: typedPassword, force: true }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, kind: result.kind, notes, savedEnabled: current.enabled },
      { status: 502 }
    );
  }
  return NextResponse.json({
    ok: true, to, messageId: result.messageId, accepted: result.accepted,
    ms: Date.now() - started, notes, savedEnabled: current.enabled,
  });
}
