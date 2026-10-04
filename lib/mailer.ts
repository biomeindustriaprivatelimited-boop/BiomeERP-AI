import fs from "fs";
/**
 * Biome Platform — outgoing mail (server only)
 * -------------------------------------------------------------------
 * Every email the app sends — vendor registration letters, payslips,
 * HR letters, notices, support updates, follow-ups — goes through
 * sendMail() below, on the SERVER, using the one set of SMTP settings
 * saved under Settings → Email (SMTP) (config/mail.json in the data
 * folder). Client PCs never send mail themselves.
 *
 *   Gmail          — smtp.gmail.com:465 SSL, and the password must be a
 *                    Google APP PASSWORD. An ordinary account password is
 *                    refused with an error that looks like a bug.
 *   Outlook / M365 — smtp.office365.com:587 STARTTLS.
 *   Zoho           — smtp.zoho.in (India) / smtp.zoho.com :465 SSL.
 *   anything else  — host, port, security and credentials by hand.
 *
 * Failures are never swallowed: sendMail resolves to { ok:false, error }
 * with a plain-English reason, plus the server's own words in `detail`.
 */

import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

// createRequire() is special-cased by webpack and cannot load files by
// absolute path from a server bundle; the runtime require can.
const nodeRequire: NodeRequire = eval("require");

/**
 * Which mail service. "smtp" is the custom / company-server choice and keeps
 * that id so settings saved by older versions still load.
 */
export type MailProvider = "gmail" | "outlook" | "zoho" | "smtp";

/**
 * How the connection is secured. The two that work on the public internet
 * are fixed to their ports, and mixing them up is the single most common
 * "email doesn't work" cause after a wrong password:
 *   ssl      — encrypted from the first byte. Port 465.
 *   starttls — starts plain, upgrades before the password is sent. Port 587.
 *   none     — no encryption. Only for a relay inside the office network.
 */
export type MailSecurity = "ssl" | "starttls" | "none";

export interface MailSettings {
  enabled: boolean;
  provider: MailProvider;
  host: string;
  port: number;
  security: MailSecurity;
  /** Kept in step with `security` for anything that still reads it. */
  secure: boolean;
  user: string;
  /** Encrypted at rest — see the note on encrypt(). */
  passwordEnc: string;
  fromName: string;
  /**
   * Reply-to address. Also the sender when the sign-in name above is not
   * an email address (some company servers sign in with a plain user name).
   */
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

/** Ready-made server settings, so nobody has to know a port number. */
export const MAIL_PRESETS: Record<MailProvider, { label: string; host: string; port: number; security: MailSecurity; help: string }> = {
  gmail: {
    label: "Gmail",
    host: "smtp.gmail.com", port: 465, security: "ssl",
    help: "Gmail needs a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords). Your normal Google password will be refused.",
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com", port: 587, security: "starttls",
    help: "Works for outlook.com and Microsoft 365 mailboxes. Microsoft 365 admins must allow \"Authenticated SMTP\" for the mailbox; with 2-step verification on, use an App Password.",
  },
  zoho: {
    label: "Zoho Mail",
    host: "smtp.zoho.in", port: 465, security: "ssl",
    help: "Indian Zoho accounts use smtp.zoho.in; others use smtp.zoho.com. With 2-factor sign-in on, create an Application-Specific Password in Zoho.",
  },
  smtp: {
    label: "Other / company server",
    host: "", port: 587, security: "starttls",
    help: "Enter the details your mail provider or IT person gives you. Port 465 = SSL/TLS, port 587 = STARTTLS.",
  },
};

export const DEFAULT_MAIL: MailSettings = {
  enabled: false,
  provider: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  security: "ssl",
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
    // A changed auth secret makes the stored password unreadable. sendMail
    // turns that into a plain "enter the password again" message.
    return "";
  }
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

function providerOf(v: unknown): MailProvider {
  return v === "gmail" || v === "outlook" || v === "zoho" || v === "smtp" ? v : "smtp";
}

function securityOf(v: unknown, legacySecure?: unknown, port?: number): MailSecurity {
  if (v === "ssl" || v === "starttls" || v === "none") return v;
  // Settings from before the security choice existed carried only `secure`.
  if (legacySecure === true) return "ssl";
  return port === 465 ? "ssl" : "starttls";
}

/**
 * Make the port and the security agree.
 *
 * "SSL on 587" or "STARTTLS on 465" never works — the two ends wait for
 * different first messages and the send fails with a cryptic TLS error
 * ("wrong version number"). Rather than let that reach a user, the obvious
 * pairing is applied and the change is reported.
 */
export function normaliseSecurity(port: number, security: MailSecurity): { security: MailSecurity; note: string | null } {
  if (port === 465 && security !== "ssl") {
    return { security: "ssl", note: "Port 465 always uses SSL/TLS, so the security setting was changed to SSL/TLS." };
  }
  if (port === 587 && security === "ssl") {
    return { security: "starttls", note: "Port 587 uses STARTTLS, not SSL/TLS, so the security setting was changed to STARTTLS." };
  }
  return { security, note: null };
}

export function loadMail(): MailSettings {
  const stored = readJson<Partial<MailSettings>>(file(), {});
  const merged = { ...DEFAULT_MAIL, ...stored };
  const provider = providerOf(merged.provider);
  const port = Number(merged.port) || MAIL_PRESETS[provider].port || 587;
  const security = securityOf((stored as any).security, (stored as any).secure, port);
  return { ...merged, provider, port, security, secure: security === "ssl" };
}

export function saveMail(settings: MailSettings): void {
  ensureDir(paths.configDir);
  writeJsonAtomic(file(), { ...settings, secure: settings.security === "ssl", updatedAt: new Date().toISOString() });
  lastFailure = null;
}

/** Never send the password back to the browser, even encrypted. */
export function publicMail(settings: MailSettings) {
  const { passwordEnc, ...rest } = settings;
  return { ...rest, passwordSet: Boolean(passwordEnc) };
}

/**
 * The password a user typed, cleaned the way the provider expects.
 * Google shows App Passwords as "abcd efgh ijkl mnop"; the spaces are
 * display only and are removed here so a straight copy-paste works.
 */
export function cleanPassword(provider: MailProvider, typed: string): string {
  const raw = String(typed ?? "");
  if (provider === "gmail") return raw.replace(/\s+/g, "");
  return raw.trim();
}

/** Warnings worth showing at save time — never blocking. */
export function settingsWarnings(s: MailSettings, typedPassword?: string): string[] {
  const out: string[] = [];
  if (s.provider === "gmail") {
    if (s.user && !/@(gmail\.com|googlemail\.com)$/i.test(s.user) && !isEmail(s.user)) {
      out.push("For Gmail, the sign-in must be the full email address.");
    }
    if (typedPassword) {
      const p = cleanPassword("gmail", typedPassword);
      if (!/^[a-z]{16}$/i.test(p)) {
        out.push("That doesn't look like a Gmail App Password (16 letters). Gmail refuses a normal Google password — create an App Password at myaccount.google.com/apppasswords.");
      }
    }
  }
  if (!isEmail(s.user) && !isEmail(s.fromEmail)) {
    out.push("Enter a sender address: either sign in with a full email address, or fill in the Reply-to / From address.");
  }
  return out;
}

export interface MailAttachment { filename: string; content: Buffer; contentType: string; }

/** What kind of failure, so callers can stop a bulk send early. */
export type MailFailureKind =
  | "disabled" | "not_configured" | "no_recipient" | "missing_package"
  | "auth" | "connect" | "dns" | "timeout" | "tls" | "certificate"
  | "recipient" | "sender" | "limit" | "unknown";

export interface SendResult {
  ok: boolean;
  /** Plain-English reason, safe to show to anyone. */
  error?: string;
  /** What the mail server actually said, for whoever sets the mail up. */
  detail?: string;
  kind?: MailFailureKind;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
}

/** Failures that will happen identically for every recipient. */
export function isSetupFailure(r: SendResult): boolean {
  return !r.ok && ["disabled", "not_configured", "missing_package", "auth", "connect", "dns", "timeout", "tls", "certificate"].includes(r.kind || "");
}

/**
 * The previous connection-level failure. A bulk send to forty people over
 * a blocked port would otherwise wait 15 seconds forty times; with this the
 * first failure answers for the rest of a short window. Cleared on save.
 */
let lastFailure: { sig: string; at: number; result: SendResult } | null = null;
const FAIL_FAST_MS = 30_000;

function signature(s: MailSettings, pass: string): string {
  return crypto.createHash("sha256").update([s.host, s.port, s.security, s.user, pass].join("|")).digest("hex");
}

/** Turn whatever nodemailer threw into something a person can act on. */
export function explainMailError(err: any, s: Pick<MailSettings, "provider" | "host" | "port" | "security">, to = ""): SendResult {
  const code = String(err?.code || "");
  const response = String(err?.response || "").trim();
  const message = String(err?.message || "Sending failed.");
  const all = `${code} ${response} ${message}`;
  const where = `${s.host}:${s.port}`;
  const detail = (response || message).slice(0, 400);

  // The server's own words are added to the message only when an SMTP
  // server actually replied — a socket or OpenSSL error is noise to a user,
  // and stays in `detail` for whoever sets the mail up.
  const said = response ? ` (Server said: ${response.replace(/\s+/g, " ").slice(0, 200)})` : "";
  const out = (kind: MailFailureKind, text: string): SendResult => ({ ok: false, kind, error: kind === "unknown" ? text : text + said, detail });

  if (code === "EAUTH" || /\b535\b|\b534\b|invalid login|authentication (failed|unsuccessful)|username and password not accepted|badcredentials/i.test(all)) {
    if (s.provider === "gmail" || /gmail|google/i.test(s.host)) {
      return out("auth",
        "Gmail refused the password — use a 16-character App Password. Your normal Google password does not work here: turn on 2-Step Verification for the account, create an App Password at myaccount.google.com/apppasswords, paste it in Settings → Email (SMTP) and press Save.");
    }
    if (/5\.7\.139|basic authentication is disabled|smtpclientauthentication|SmtpClientAuthentication/i.test(all)) {
      return out("auth",
        "Microsoft has switched off password sign-in (SMTP AUTH) for this mailbox. A Microsoft 365 admin must enable \"Authenticated SMTP\" for it (Admin centre → Users → the mailbox → Mail → Manage email apps), then try again.");
    }
    if (s.provider === "outlook" || /office365|outlook|hotmail|live\.com/i.test(s.host)) {
      return out("auth",
        "Outlook refused the sign-in. Check the email address and password; if the account has 2-step verification, create an App Password and use that instead.");
    }
    if (s.provider === "zoho" || /zoho/i.test(s.host)) {
      return out("auth",
        "Zoho refused the sign-in. Use an Application-Specific Password from Zoho (My Account → Security → App Passwords), and the right server: smtp.zoho.in for Indian accounts, smtp.zoho.com for others.");
    }
    return out("auth", "The mail server refused the user name or password. Check both in Settings → Email (SMTP).");
  }

  if (/wrong version number|ssl3_get_record|tls_validate_record_header|packet length too long|unknown protocol/i.test(all) || (/Greeting never received/i.test(all) && s.port === 465 && s.security !== "ssl")) {
    return out("tls",
      `The security setting doesn't match port ${s.port}. Use SSL/TLS with port 465, or STARTTLS with port 587.`);
  }
  if (/self[- ]signed|unable to (get local issuer|verify the first)|certificate has expired|CERT_|Hostname\/IP does not match|altnames/i.test(all)) {
    return out("certificate",
      `The mail server's security certificate could not be verified (${where}). This is usually antivirus "email scanning" intercepting the connection, or a server name that doesn't match its certificate — use the exact server name from your provider, or switch off email scanning in the antivirus.`);
  }
  if (code === "ETLS" || /STARTTLS/i.test(message)) {
    return out("tls",
      `${where} did not offer an encrypted connection (STARTTLS). Check the port and security setting: SSL/TLS on 465 or STARTTLS on 587.`);
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|EDNS/i.test(all)) {
    return out("dns",
      `The server name "${s.host}" could not be found. Check the spelling, and that the computer running the Biome server is connected to the internet.`);
  }
  if (/ECONNREFUSED/i.test(all)) {
    return out("connect",
      `${where} refused the connection. Check the server name and port (Gmail: smtp.gmail.com, 465, SSL/TLS).`);
  }
  if (code === "ETIMEDOUT" || /timed? ?out|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(all) || code === "ECONNECTION") {
    return out("timeout",
      `No answer from ${where}. The internet may be down on the computer running the Biome server, or a firewall / antivirus / the office network is blocking outgoing mail. Try port 587 with STARTTLS (or 465 with SSL/TLS), or ask whoever manages the network to allow it.`);
  }
  if (/daily (user )?sending (quota|limit)|5\.4\.5|too many (messages|recipients)|rate limit/i.test(all)) {
    return out("limit", "The mail account has hit its sending limit for now (Gmail allows about 500 a day). Try again later.");
  }
  if (/SendAsDenied|5\.7\.60|not (allowed|authori[sz]ed) to send (as|on behalf)|sender address rejected|553[ -]5\.7\.1/i.test(all)) {
    return out("sender",
      "The mail server would not let this account send under that address. Leave Reply-to / From empty, or use the same address you sign in with.");
  }
  if (code === "EENVELOPE" || /recipient|mailbox (unavailable|not found)|user unknown|no such user|5\.1\.1|550[ -]/i.test(all)) {
    return out("recipient",
      `The mail server would not accept the address${to ? ` "${to}"` : ""}. Check it is typed correctly.`);
  }
  return out("unknown", `Sending failed: ${message}`);
}

/**
 * Build the nodemailer transport options from settings. Exported for the
 * tests; nothing else should need it.
 */
export function transportOptions(s: MailSettings, pass: string) {
  const security = s.security || (s.secure ? "ssl" : "starttls");
  return {
    host: s.host,
    port: s.port,
    secure: security === "ssl",
    requireTLS: security === "starttls",
    ignoreTLS: security === "none",
    ...(s.user && pass ? { auth: { user: s.user, pass } } : {}),
    // nodemailer waits two minutes by default. A blocked port then looks
    // like a frozen button, which is how "email doesn't work" gets reported.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
    tls: { servername: s.host },
  };
}

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
  cc?: string;
}

/**
 * THE way mail leaves this app. Every feature calls this, on the server,
 * with the settings saved under Settings → Email (SMTP) — so there is one
 * place to configure and one place that can be wrong.
 *
 * Never throws: always resolves to { ok } or { ok:false, error, detail }.
 *
 * `override` is only for the Settings test button, which tries what is
 * typed on screen before it is saved.
 */
export async function sendMail(
  opts: SendOptions,
  override?: { settings: MailSettings; password?: string; force?: boolean }
): Promise<SendResult> {
  const settings = override?.settings || loadMail();
  const isTest = Boolean(override);
  const to = String(opts.to || "").trim();

  if (!isTest && !settings.enabled) {
    return { ok: false, kind: "disabled", error: "Email is switched off in Settings → Email (SMTP). Turn it on and save, then try again." };
  }
  if (!settings.host) {
    return { ok: false, kind: "not_configured", error: "Email isn't set up yet — enter the mail server in Settings → Email (SMTP)." };
  }

  const pass = override?.password !== undefined && override.password !== ""
    ? cleanPassword(settings.provider, override.password)
    : decrypt(settings.passwordEnc);

  if (settings.passwordEnc && !pass && !(override?.password)) {
    return {
      ok: false, kind: "not_configured",
      error: "Email isn't set up on this server any more — the saved mail password can't be read here (it was saved on another computer or under a different app key). Type the password again in Settings → Email (SMTP) and press Save.",
    };
  }
  if (settings.provider !== "smtp" && (!settings.user || !pass)) {
    return { ok: false, kind: "not_configured", error: "Email isn't set up yet — add the email address and app password in Settings → Email (SMTP)." };
  }

  const fromAddress = isEmail(settings.user) ? settings.user.trim() : settings.fromEmail.trim();
  if (!isEmail(fromAddress)) {
    return { ok: false, kind: "not_configured", error: "Email isn't set up yet — there is no sender address. Sign in with a full email address, or fill in Reply-to / From in Settings → Email (SMTP)." };
  }
  if (!to || !to.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every(isEmail)) {
    return { ok: false, kind: "no_recipient", error: to ? `"${to}" is not a valid email address.` : "No address to send to." };
  }

  const sig = signature(settings, pass);
  if (!override?.force && lastFailure && lastFailure.sig === sig && Date.now() - lastFailure.at < FAIL_FAST_MS) {
    return lastFailure.result;
  }

  let nodemailer: any;
  try {
    nodemailer = nodeRequire("nodemailer");
  } catch {
    return {
      ok: false, kind: "missing_package",
      error: "The mail component (nodemailer) is missing from this installation. Reinstall the Biome app, or run `npm install` in the project folder and restart.",
    };
  }

  const replyTo = (opts.replyTo || (isEmail(settings.fromEmail) && settings.fromEmail.trim().toLowerCase() !== fromAddress.toLowerCase() ? settings.fromEmail.trim() : "")) || undefined;

  try {
    const transport = nodemailer.createTransport(transportOptions(settings, pass));
    const info = await transport.sendMail({
      from: { name: settings.fromName || "Biome Industria", address: fromAddress },
      to,
      cc: opts.cc || undefined,
      bcc: settings.bcc && isEmail(settings.bcc) ? settings.bcc : undefined,
      replyTo,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    try { transport.close?.(); } catch { /* nothing to close */ }

    const accepted = (info?.accepted || []).map(String);
    const rejected = (info?.rejected || []).map(String);
    if (!accepted.length && rejected.length) {
      const r: SendResult = { ok: false, kind: "recipient", error: `The mail server would not accept "${rejected.join(", ")}". Check the address.`, detail: String(info?.response || "") };
      logMail({ to, subject: opts.subject, ok: false, at: new Date().toISOString(), error: r.error || null });
      return r;
    }
    lastFailure = null;
    logMail({ to, subject: opts.subject, ok: true, at: new Date().toISOString(), error: null });
    return { ok: true, messageId: info?.messageId, accepted, rejected };
  } catch (err) {
    const r = explainMailError(err, settings, to);
    if (isSetupFailure(r)) lastFailure = { sig, at: Date.now(), result: r };
    logMail({ to, subject: opts.subject, ok: false, at: new Date().toISOString(), error: r.error || "failed" });
    return r;
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
