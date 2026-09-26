"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Loader2, AlertCircle, Check, Send, ShieldCheck } from "lucide-react";

/**
 * Outgoing email.
 *
 * One form for both cases the business asked for. Gmail today, a company
 * mail server later — the only difference is the host, so a provider
 * toggle is honest where two separate integrations would not be.
 *
 * The Gmail App Password point is spelled out on the screen rather than
 * buried in help: an ordinary Google password fails with a message that
 * reads like a bug, and people spend an hour on it.
 */

interface MailSettings {
  enabled: boolean;
  provider: "gmail" | "smtp";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  bcc: string;
  autoSendPayslips: boolean;
  autoSendDelayDays: number;
  passwordSet?: boolean;
}

export default function MailSettings() {
  const [mail, setMail] = useState<MailSettings | null>(null);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mail", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setMail(json.mail);
    } catch { /* the card simply stays hidden */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!mail) return null;
  const set = (patch: Partial<MailSettings>) => { setNote(null); setMail({ ...mail, ...patch }); };

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
      setMail(json.mail); setPassword("");
      setNote({ kind: "ok", text: "Saved." });
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
    } finally { setBusy(null); }
  }

  async function test() {
    setBusy("test"); setNote(null);
    try {
      const res = await fetch("/api/mail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setNote({ kind: "ok", text: `Test message sent to ${testTo}. If it doesn't arrive, check the spam folder.` });
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <Mail size={15} className="text-biome-leaf" /> Email
        </h2>
        <button
          onClick={() => set({ enabled: !mail.enabled })}
          className="bmx-chip flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2 text-[11px] font-semibold text-biome-muted"
        >
          <span className={`relative h-4 w-7 rounded-full transition-colors duration-300 ${mail.enabled ? "bg-biome-leaf" : "bg-biome-line"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${mail.enabled ? "left-3.5" : "left-0.5"}`} />
          </span>
          {mail.enabled ? "On" : "Off"}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-biome-muted">
        Used to send payslips. Gmail now, your company mail server later — the form is the same,
        only the server changes.
      </p>

      <div className="mt-4 flex gap-2">
        {(["gmail", "smtp"] as const).map((p) => (
          <button key={p} onClick={() => set({ provider: p })}
            className={`bmx-chip rounded-xl border px-3.5 py-2 text-[11.5px] font-semibold ${
              mail.provider === p ? "border-biome-leaf/40 bg-biome-leaf/12 text-biome-leaf" : "border-biome-line text-biome-muted"
            }`}>
            {p === "gmail" ? "Gmail" : "Company mail (SMTP)"}
          </button>
        ))}
      </div>

      {mail.provider === "gmail" && (
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[.07] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-biome-text">
            <ShieldCheck size={13} className="text-amber-600" /> Gmail needs an App Password
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
            Your normal Google password will not work with two-step verification on, and Google
            rejects it in a way that looks like a bug in this app. Create one at{" "}
            <span className="font-mono text-biome-text">myaccount.google.com/apppasswords</span> and
            paste the 16 characters below.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label={mail.provider === "gmail" ? "Gmail address" : "Username"}>
          <input value={mail.user} onChange={(e) => set({ user: e.target.value })}
            placeholder="accounts@biomeindustria.com" className={inputCls} />
        </Field>
        <Field label={mail.provider === "gmail" ? "App password" : "Password"}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={mail.passwordSet ? "Saved — type a new one to replace it" : "Required"} className={inputCls} />
        </Field>

        {mail.provider === "smtp" && (
          <>
            <Field label="SMTP server"><input value={mail.host} onChange={(e) => set({ host: e.target.value })} placeholder="mail.yourcompany.com" className={inputCls} /></Field>
            <Field label="Port"><input type="number" value={mail.port} onChange={(e) => set({ port: Number(e.target.value) || 587 })} className={inputCls} /></Field>
            <div className="flex items-end">
              <button onClick={() => set({ secure: !mail.secure })}
                className="bmx-chip flex items-center gap-2 rounded-xl border border-biome-line px-3 py-2.5 text-[11px] font-semibold text-biome-muted">
                <span className={`relative h-4 w-7 rounded-full transition-colors ${mail.secure ? "bg-biome-leaf" : "bg-biome-line"}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${mail.secure ? "left-3.5" : "left-0.5"}`} />
                </span>
                SSL (port 465)
              </button>
            </div>
          </>
        )}

        <Field label="Sender name"><input value={mail.fromName} onChange={(e) => set({ fromName: e.target.value })} className={inputCls} /></Field>
        <Field label="Reply-to address"><input value={mail.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder="Same as above if left blank" className={inputCls} /></Field>
        <Field label="Copy every payslip to"><input value={mail.bcc} onChange={(e) => set({ bcc: e.target.value })} placeholder="Optional — keeps an office record" className={inputCls} /></Field>
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
        <div className={`bmx-msg-in mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${
          note.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/[.07]" : "border-rose-400/25 bg-rose-400/[.07]"
        }`}>
          {note.kind === "ok" ? <Check size={14} className="mt-px shrink-0 text-emerald-600" /> : <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />}
          <p className="text-[11px] leading-relaxed text-biome-text">{note.text}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button onClick={save} disabled={busy !== null}
          className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-60">
          {busy === "save" ? <Loader2 size={14} className="bmx-spin" /> : <Check size={14} />} Save
        </button>

        <div className="flex items-end gap-2">
          <Field label="Send a test to">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="your@email.com" className={`${inputCls} w-[220px]`} />
          </Field>
          <button onClick={test} disabled={busy !== null || !testTo.trim()}
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-50">
            {busy === "test" ? <Loader2 size={13} className="bmx-spin" /> : <Send size={13} />} Test
          </button>
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-biome-muted">
        Sending needs the <span className="font-mono">nodemailer</span> package. If it isn&apos;t
        installed, the test will say so — run <span className="font-mono">npm install</span> in the
        project folder.
      </p>
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
