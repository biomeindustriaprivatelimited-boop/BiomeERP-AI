import fs from "fs";
/**
 * Biome Platform — outgoing mail (server only)
 * -------------------------------------------------------------------
 * Payslips and notices go out over plain SMTP, configured once and stored
 * in the data folder.
 *
 * Both cases the business asked for are the same mechanism:
 *   Gmail today   — smtp.gmail.com:465, and the password must be a Google
 *                   APP PASSWORD. An ordinary account password will not
 *                   work once two-step verification is on, and Google
 *                   rejects it silently enough to look like a bug.
 *   company mail later — any host, port and credentials.
 * So there is one form with a Gmail preset rather than two integrations.
 *
 * Implemented against nodemailer, which has to be installed:
 *     npm install nodemailer
 * The route reports that plainly rather than failing with a module error.
 */

import { createRequire } from "module";
import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

const nodeRequire = createRequire(import.meta.url);

export interface MailSettings {
  enabled: boolean;
  provider: "gmail" | "smtp";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Encrypted at rest — see the note on encrypt(). */
  passwordEnc: string;
  fromName: string;
  fromEmail: string;
  /** Copy every payslip here, so the office keeps its own record. */
  bcc: string;
  /**
   * Send payslips automatically once a month has been approved.
   *
   * The delay is deliberate and configurable: the business asked for two
   * days, which is the window in which somebody usually spots a mistake.
   * Sending the instant a sheet is approved removes that window.
   */
  autoSendPayslips: boolean;
  autoSendDelayDays: number;
  updatedAt?: string;
}

export const DEFAULT_MAIL: MailSettings = {
  enabled: false,
  provider: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  user: "",
  passwordEnc: "",
  fromName: "Biome Industria",
  fromEmail: "",
  bcc: "",
  autoSendPayslips: false,
  autoSendDelayDays: 2,
};

function file() { return path.join(paths.configDir, "mail.json"); }

/**
 * The SMTP password has to be recoverable to be used, so this is
 * obfuscation against a casual look at the data folder, NOT protection
 * against someone who already has the machine. The key derives from the
 * app's own auth secret, so a copied data folder alone will not open it.
 * Said plainly here so nobody assumes more than it does.
 */
function key(): Buffer {
  const secret = process.env.BIOME_AUTH_SECRET || "biome-local-mail-key";
  return crypto.createHash("sha256").update(`mail:${secret}`).digest();
}

export function encrypt(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(stored: string): string {
  if (!stored) return "";
  try {
    const [ivB, tagB, dataB] = stored.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // A changed auth secret makes the stored password unreadable. Returning
    // blank surfaces as "sign-in failed" on the next send, which is the
    // honest outcome — the password has to be entered again.
    return "";
  }
}

export function loadMail(): MailSettings {
  const stored = readJson<Partial<MailSettings>>(file(), {});
  return { ...DEFAULT_MAIL, ...stored };
}

export function saveMail(settings: MailSettings): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { ...settings, updatedAt: new Date().toISOString() });
}

/** Never send the password back to the browser, even encrypted. */
export function publicMail(settings: MailSettings) {
  const { passwordEnc, ...rest } = settings;
  return { ...rest, passwordSet: Boolean(passwordEnc) };
}

export interface MailAttachment { filename: string; content: Buffer; contentType: string; }

export interface SendResult { ok: boolean; error?: string; messageId?: string; }

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}): Promise<SendResult> {
  const settings = loadMail();
  if (!settings.enabled) return { ok: false, error: "Email is switched off in Settings." };
  if (!settings.user || !settings.passwordEnc) {
    return { ok: false, error: "Email isn't set up yet — add the address and app password in Settings." };
  }
  if (!opts.to) return { ok: false, error: "No address to send to." };

  let nodemailer: any;
  try {
    nodemailer = nodeRequire("nodemailer");
  } catch {
    return {
      ok: false,
      error: "Sending mail needs nodemailer. Run `npm install nodemailer` in the project folder and restart the app.",
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: decrypt(settings.passwordEnc) },
    });

    const info = await transport.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail || settings.user}>`,
      to: opts.to,
      bcc: settings.bcc || undefined,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });

    logMail({ to: opts.to, subject: opts.subject, ok: true, at: new Date().toISOString(), error: null });
    return { ok: true, messageId: info?.messageId };
  } catch (err) {
    logMail({ to: opts.to, subject: opts.subject, ok: false, at: new Date().toISOString(), error: (err as Error)?.message || "failed" });
    const message = (err as Error).message || "Sending failed.";
    // Google's rejection is opaque unless you already know what it means.
    if (/invalid login|username and password not accepted|BadCredentials/i.test(message)) {
      return {
        ok: false,
        error:
          "Gmail refused the login. With two-step verification on, an ordinary password will not work — create an App Password at myaccount.google.com/apppasswords and use that instead.",
      };
    }
    return { ok: false, error: message };
  }
}

/** The covering note that goes with a payslip. */
export function payslipEmail(name: string, monthLabel: string, netPay: number) {
  const amount = `Rs. ${netPay.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  return {
    subject: `Payslip for ${monthLabel} — Biome Industria`,
    text:
      `Dear ${name},\n\n` +
      `Your payslip for ${monthLabel} is attached. The net amount credited is ${amount}.\n\n` +
      `If anything looks wrong, please raise it under Help & Support in the Biome app rather than replying to this message — that way it reaches accounts and is tracked until it is resolved.\n\n` +
      `Biome Industria Private Limited\n` +
      `This message was sent automatically. Please do not reply.`,
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1f27;line-height:1.6">` +
      `<p>Dear ${name},</p>` +
      `<p>Your payslip for <strong>${monthLabel}</strong> is attached. The net amount credited is <strong>${amount}</strong>.</p>` +
      `<p>If anything looks wrong, please raise it under <strong>Help &amp; Support</strong> in the Biome app rather than replying to this message — that way it reaches accounts and is tracked until it is resolved.</p>` +
      `<p style="color:#6e7d7a;font-size:13px;margin-top:24px">Biome Industria Private Limited<br>` +
      `This message was sent automatically. Please do not reply.</p></div>`,
  };
}


/* ------------------------------------------------------------------ */
/* Mail log — the outbound half of the Communication Center            */
/* ------------------------------------------------------------------ */
export interface MailLogEntry { to: string; subject: string; ok: boolean; at: string; error: string | null }

function mailLogFile(): string {
  return path.join(paths.root, "communications", "mail-log.jsonl");
}

export function logMail(e: MailLogEntry): void {
  try {
    fs.mkdirSync(path.dirname(mailLogFile()), { recursive: true });
    fs.appendFileSync(mailLogFile(), JSON.stringify(e) + "\n", "utf8");
  } catch { /* a missing log must never break a send */ }
}

export function readMailLog(limit = 2000): MailLogEntry[] {
  try {
    const lines = fs.readFileSync(mailLogFile(), "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) as MailLogEntry; } catch { return null; } }).filter((x): x is MailLogEntry => Boolean(x)).reverse();
  } catch { return []; }
}
