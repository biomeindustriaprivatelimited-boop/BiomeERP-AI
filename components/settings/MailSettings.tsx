"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Loader2, AlertCircle, Check, Send, ShieldCheck, Power, History } from "lucide-react";

/**
 * Settings → Email (SMTP).
 *
 * The ONE place outgoing mail is configured. Every email the app sends —
 * vendor registration letters, payslips, HR letters, notices, support
 * updates, follow-ups — goes out from the server with these settings.
 *
 * Presets fill the server, port and security for Gmail, Outlook and Zoho,
 * because a mismatched port and security setting is the commonest reason
 * mail "doesn't work" after a wrong password. The test button tries what
 * is on the screen (saved or not) and shows the reason in plain English.
 */

type Provider = "gmail" | "outlook" | "zoho" | "smtp";
type Security = "ssl" | "starttls" | "none";

interface MailSettings {
  enabled: boolean;
  provider: Provider;
  host: string;
  port: number;
  security: Security;
  user: string;
  fromName: string;
  fromEmail: string;
  bcc: string;
  autoSendPayslips: boolean;
  autoSendDelayDays: number;
  passwordSet?: boolean;
  updatedAt?: string;
}

interface Preset { label: string; host: string; port: number; security: Security; help: string }
interface LogRow { to: string; subject: string; ok: boolean; at: string; error: string | null }

const PROVIDERS: Provider[] = ["gmail", "outlook", "zoho", "smtp"];
const SECURITY_LABEL: Record<Security, string> = {
  ssl: "SSL/TLS (port 465)",
  starttls: "STARTTLS (port 587)",
  none: "None (office relay only)",
};

type Note = { kind: "ok" | "bad" | "info"; text: string; detail?: string; extra?: string[] };

export default function MailSettings() {
  const [mail, setMail] = useState<MailSettings | null>(null);
  const [presets, setPresets] = useState<Record<Provider, Preset> | null>(null);
  const [recent, setRecent] = useState<LogRow[]>([]);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [dirty, setDirty] = useState(false);

  /** `logOnly` refreshes the "last emails" list without touching the form. */
  const load = useCallback(async (logOnly = false) => {
    try {
      const res = await fetch("/api/mail", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!logOnly) setMail(json.mail);
      setPresets(json.presets || null);
      setRecent(json.recent || []);
    } catch { /* the card simply stays hidden */ }
  }, []);
  useEffect(() => { load(); }, [load]);


  if (!mail) return null;
  const set = (patch: Partial<MailSettings>) => { setNote(null); setDirty(true); setMail({ ...mail, ...patch }); };

  function choose(p: Provider) {
    const pre = presets?.[p];
    if (!pre) return set({ provider: p });
    set({
      provider: p,
      // Keep a custom host the person already typed when switching to "Other".
      host: p === "smtp" ? (mail!.provider === "smtp" ? mail!.host : "") : pre.host,
      port: pre.port,
      security: pre.security,
    });
  }

  function setPort(port: number) {
    // Keep the pair consistent as it is typed: 465 ↔ SSL, 587 ↔ STARTTLS.
    const security: Security = port === 465 ? "ssl" : port === 587 && mail!.security === "ssl" ? "starttls" : mail!.security;
    set({ port, security });
  }

  function setSecurity(security: Security) {
    const port = security === "ssl" && mail!.port === 587 ? 465 : security === "starttls" && mail!.port === 465 ? 587 : mail!.port;
    set({ security, port });
  }

  async function save() {
    setBusy("save"); setNote(null);
    try {
      const res = await fetch("/api/mail", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        // An empty password means "leave the stored one alone" — otherwise
        // changing the BCC address would wipe the credential.
        body: JSON.stringify({ ...mail, password: password || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setMail(json.mail); setPassword(""); setDirty(false);
      const extra = [...(json.notes || []), ...(json.warnings || [])];
      setNote({
        kind: json.warnings?.length ? "info" : "ok",
        text: json.mail.enabled
          ? "Saved. Email is ON — every feature now sends with these settings. Send a test to be sure."
          : "Saved. Email is OFF — nothing will be sent until you switch it on.",
        extra,
      });
      load(true);
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
    } finally { setBusy(null); }
  }

  async function test() {
    setBusy("test"); setNote(null);
    try {
      const res = await fetch("/api/mail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo, settings: { ...mail, password: password || undefined } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ kind: "bad", text: json.error || `Failed (${res.status}).`, detail: json.detail, extra: json.notes });
        load(true);
        return;
      }
      const after: string[] = [...(json.notes || [])];
      if (dirty || password) after.push("These settings are not saved yet — press Save so the app uses them.");
      else if (!mail!.enabled) after.push("Email is still switched OFF — turn it on and press Save, or nothing else will be sent.");
      setNote({
        kind: "ok",
        text: `Test email sent to ${json.to} (${Math.round((json.ms || 0) / 100) / 10}s). If it doesn't arrive in a minute, check the spam folder.`,
        extra: after,
      });
      load(true);
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
    } finally { setBusy(null); }
  }

  const preset = presets?.[mail.provider];
  const isGmail = mail.provider === "gmail";

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5" data-testid="mail-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Mail size={15} className="text-biome-leaf" /> Email (SMTP)
        </h2>
        <button
          onClick={() => set({ enabled: !mail.enabled })}
          data-testid="mail-enabled"
          className="bmx-chip flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"
        >
          <span className={`relative h-4 w-7 rounded-full transition-colors duration-300 ${mail.enabled ? "bg-biome-leaf" : "bg-biome-line"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${mail.enabled ? "left-3.5" : "left-0.5"}`} />
          </span>
          {mail.enabled ? "On" : "Off"}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-biome-muted">
        Every email the app sends — vendor registration letters, payslips, HR letters, notices, support
        updates and follow-ups — goes out from the Biome server with these settings. Other PCs don&apos;t
        need anything set up.
      </p>

      {!mail.enabled && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[.07] px-3.5 py-2.5">
          <Power size={13} className="mt-px shrink-0 text-rose-500" />
          <p className="text-[11px] leading-relaxed text-biome-text">
            Email is <b>switched off</b> — nothing will be sent. Fill in the details, switch it <b>On</b> and press <b>Save</b>.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <button key={p} onClick={() => choose(p)} data-testid={`mail-provider-${p}`}
            className={`bmx-chip rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold ${
              mail.provider === p ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
            }`}>
            {presets?.[p]?.label || p}
          </button>
        ))}
      </div>

      {preset && (
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[.07] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-biome-text">
            <ShieldCheck size={13} className="text-amber-600" /> {isGmail ? "Gmail needs an App Password" : preset.label}
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
            {preset.help}
            {isGmail && (
              <> Create one at <span className="font-mono text-biome-text">myaccount.google.com/apppasswords</span> and paste the 16 letters below (spaces are fine).</>
            )}
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label={mail.provider === "smtp" ? "User name / email" : "Email address (sign-in)"}>
          <input value={mail.user} onChange={(e) => set({ user: e.target.value })} data-testid="mail-user"
            placeholder="accounts@biomeindustria.com" className={inputCls} autoComplete="off" />
        </Field>
        <Field label={isGmail ? "App password (16 letters)" : "Password / app password"}>
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setDirty(true); setNote(null); }}
            data-testid="mail-password" autoComplete="new-password"
            placeholder={mail.passwordSet ? "Saved — type a new one to replace it" : "Required"} className={inputCls} />
        </Field>

        <Field label="SMTP server (host)">
          <input value={mail.host} onChange={(e) => set({ host: e.target.value.trim() })} data-testid="mail-host"
            placeholder="smtp.yourcompany.com" className={inputCls} />
        </Field>
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Port">
            <input type="number" value={mail.port} onChange={(e) => setPort(Number(e.target.value) || 587)} data-testid="mail-port" className={inputCls} />
          </Field>
          <Field label="Security">
            <select value={mail.security} onChange={(e) => setSecurity(e.target.value as Security)} data-testid="mail-security" className={inputCls}>
              {(Object.keys(SECURITY_LABEL) as Security[]).map((s) => <option key={s} value={s}>{SECURITY_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Sender name"><input value={mail.fromName} onChange={(e) => set({ fromName: e.target.value })} className={inputCls} /></Field>
        <Field label="Reply-to / From address (optional)">
          <input value={mail.fromEmail} onChange={(e) => set({ fromEmail: e.target.value.trim() })} data-testid="mail-from"
            placeholder="Replies go here — blank = the sign-in address" className={inputCls} />
        </Field>
        <Field label="Copy every payslip to"><input value={mail.bcc} onChange={(e) => set({ bcc: e.target.value.trim() })} placeholder="Optional — keeps an office record" className={inputCls} /></Field>
      </div>

      {/* ---- The schedule the business asked for ---- */}
      <div className="mt-5 rounded-xl border border-biome-line px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-biome-text">Send payslips after a month is approved</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">
              The wait exists on purpose — it is the window in which somebody spots a mistake
              before it reaches everyone&apos;s inbox.
            </p>
          </div>
          <button onClick={() => set({ autoSendPayslips: !mail.autoSendPayslips })}
            className="bmx-chip flex shrink-0 items-center gap-2 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted">
            <span className={`relative h-4 w-7 rounded-full transition-colors ${mail.autoSendPayslips ? "bg-biome-leaf" : "bg-biome-line"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${mail.autoSendPayslips ? "left-3.5" : "left-0.5"}`} />
            </span>
            {mail.autoSendPayslips ? "Remind me" : "Off"}
          </button>
        </div>

        {mail.autoSendPayslips && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Wait this many days">
              <input type="number" min={0} max={30} value={mail.autoSendDelayDays}
                onChange={(e) => set({ autoSendDelayDays: Number(e.target.value) || 0 })}
                className={`${inputCls} w-[110px]`} />
            </Field>
            <p className="max-w-[420px] pb-2 text-[10.5px] leading-relaxed text-biome-muted">
              Payroll will show a &quot;due to be emailed&quot; prompt once the wait is up. It is a
              prompt rather than a silent send: mailing forty salary slips with nobody watching is
              not something this app will do on its own.
            </p>
          </div>
        )}
      </div>

      {note && (
        <div data-testid="mail-note" data-kind={note.kind} className={`bmx-msg-in mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${
          note.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/[.07]"
          : note.kind === "info" ? "border-amber-500/30 bg-amber-500/[.07]"
          : "border-rose-400/25 bg-rose-400/[.07]"
        }`}>
          {note.kind === "bad" ? <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" /> : <Check size={14} className={`mt-px shrink-0 ${note.kind === "ok" ? "text-emerald-600" : "text-amber-600"}`} />}
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold leading-relaxed text-biome-text">{note.text}</p>
            {note.extra?.map((x, i) => <p key={i} className="mt-1 text-[10.5px] leading-relaxed text-biome-text/80">{x}</p>)}
            {note.detail && (
              <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-biome-muted">Server said: {note.detail}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button onClick={save} disabled={busy !== null} data-testid="mail-save"
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy === "save" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save
        </button>

        <div className="flex items-end gap-2">
          <Field label="Send a test email to">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="your@email.com" data-testid="mail-test-to" className={`${inputCls} w-[220px]`} />
          </Field>
          <button onClick={test} disabled={busy !== null || !testTo.trim()} data-testid="mail-test"
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-text disabled:opacity-50">
            {busy === "test" ? <Loader2 size={13} className="bmx-spin" /> : <Send size={13} />} Send test email
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-4 rounded-xl border border-biome-line px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted"><History size={11} /> Last emails sent by the app</p>
          <ul className="mt-2 space-y-1">
            {recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-relaxed">
                <span className={`font-bold ${r.ok ? "text-emerald-600" : "text-rose-500"}`}>{r.ok ? "Sent" : "Failed"}</span>
                <span className="text-biome-muted">{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-biome-text">{r.to}</span>
                <span className="truncate text-biome-muted">· {r.subject}</span>
                {!r.ok && r.error && <span className="w-full text-rose-500/90">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bmx-field block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</span>
      <div className="relative">{children}</div>
    </label>
  );
}
