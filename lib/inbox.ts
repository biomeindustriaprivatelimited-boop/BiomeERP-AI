/**
 * Biome AI OS — Inbox intelligence (server only)
 * -------------------------------------------------------------------
 * Section 31: incoming email priority. Reads the company mailbox over
 * IMAP (same account as the SMTP settings — Gmail: imap.gmail.com with
 * the app password), classifies each message, extracts the required
 * action, deadline and the related vendor/client, and lets a person turn
 * it into a Work task with one press.
 *
 * Classification is rule-based and explainable: the words that fired
 * are shown next to the verdict. No mail is ever deleted, moved or
 * marked read by this module.
 */

import { loadMail, decrypt } from "@/lib/mailer";
import { loadPartners } from "@/lib/partners";
import { loadEmployees } from "@/lib/payroll";
import { paths, readJson } from "@/lib/dataRoot";

export interface InboxMessage {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  snippet: string;
  priority: "urgent" | "important" | "normal";
  reasons: string[];
  action: string;
  deadline: string | null;
  party: { type: string; name: string } | null;
}

const URGENT = ["urgent", "asap", "immediately", "today", "overdue", "legal notice", "final reminder", "stop supply", "penalty", "last date", "turant", "jaldi"];
const IMPORTANT = ["invoice", "payment", "gst", "purchase order", "po ", "tender", "deadline", "contract", "agreement", "renewal", "audit", "notice", "e-way", "challan", "kyc", "bank", "tds", "esic", "pf "];
const DATE_RE = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?|(?:by|before|till|until)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today))\b/i;

export function classify(m: { from: string; subject: string; text: string }): Pick<InboxMessage, "priority" | "reasons" | "action" | "deadline" | "party"> {
  const hay = `${m.subject} ${m.text}`.toLowerCase();
  const urgentHits = URGENT.filter((w) => hay.includes(w));
  const importantHits = IMPORTANT.filter((w) => hay.includes(w));
  const priority = urgentHits.length ? "urgent" : importantHits.length ? "important" : "normal";
  const reasons = [...urgentHits.map((w) => `"${w}"`), ...importantHits.slice(0, 3).map((w) => `"${w.trim()}"`)];

  const dl = hay.match(DATE_RE);
  const deadline = dl ? dl[0] : null;

  const action =
    /please (send|share|provide|submit)|kindly (send|share|provide|submit)|request(ed)? (for|to)/.test(hay) ? "Send / share what they asked for"
    : /pending|outstanding|due|payable|reminder/.test(hay) ? "Check the pending item and reply"
    : /approve|approval|confirm/.test(hay) ? "Approve or confirm"
    : /invoice|bill/.test(hay) ? "Verify the invoice against the supply set"
    : /meeting|call|discuss/.test(hay) ? "Schedule / attend"
    : "Read and reply";

  // Related party by sender address or name.
  const fromLower = m.from.toLowerCase();
  let party: InboxMessage["party"] = null;
  for (const p of loadPartners()) {
    if ((p.email && fromLower.includes(p.email.toLowerCase())) || hay.includes(p.name.toLowerCase())) { party = { type: p.kind === "transporter" ? "transporter" : "vendor", name: p.name }; break; }
  }
  if (!party) {
    try { for (const c of (readJson<{ clients: { name: string; shortName?: string }[] }>(paths.clientsFile, { clients: [] }).clients || [])) { if (hay.includes(c.name.toLowerCase()) || (c.shortName && hay.includes(c.shortName.toLowerCase()))) { party = { type: "client", name: c.name }; break; } } } catch { /* none */ }
  }
  if (!party) {
    try { for (const e of loadEmployees()) { if (e.email && fromLower.includes(e.email.toLowerCase())) { party = { type: "employee", name: e.name }; break; } } } catch { /* none */ }
  }
  return { priority, reasons, action, deadline, party };
}

export interface InboxConfig { host: string; port: number; secure: boolean; user: string; password: string; mailbox: string }

/** IMAP config derived from the mail settings; Gmail's IMAP host is implied. */
export function inboxConfig(): InboxConfig | null {
  const s = loadMail();
  if (!s.user || !s.passwordEnc) return null;
  const host = s.provider === "gmail" ? "imap.gmail.com"
    : s.provider === "outlook" || /office365\.com$|outlook\.com$/i.test(s.host || "") ? "outlook.office365.com"
    : (s.host || "").replace(/^smtp\./, "imap.");
  return { host, port: 993, secure: true, user: s.user, password: decrypt(s.passwordEnc), mailbox: "INBOX" };
}

export async function fetchInbox(limit = 40): Promise<{ ok: true; messages: InboxMessage[] } | { ok: false; error: string }> {
  const cfg = inboxConfig();
  if (!cfg) return { ok: false, error: "Email is not set up — add the account and app password in Settings → Mail." };
  let ImapFlow: any;
  try { ({ ImapFlow } = await import("imapflow")); } catch { return { ok: false, error: "The IMAP client is not installed (npm install imapflow)." }; }

  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.password }, logger: false });
  const messages: InboxMessage[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox);
    try {
      const total: number = client.mailbox?.exists || 0;
      if (total > 0) {
        const start = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${start}:${total}`, { uid: true, envelope: true, bodyStructure: false, source: { maxLength: 6000 } })) {
          const env = msg.envelope || {};
          const fromAddr = env.from?.[0]?.address || ""; const fromName = env.from?.[0]?.name || fromAddr;
          const raw = msg.source ? msg.source.toString("utf8") : "";
          // Plain-text-ish body: strip headers and tags, keep the first lines.
          const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n").replace(/<[^>]+>/g, " ").replace(/=\r?\n/g, "").replace(/\s+/g, " ").trim();
          const snippet = body.slice(0, 280);
          const cls = classify({ from: fromAddr, subject: env.subject || "", text: body.slice(0, 3000) });
          messages.push({ uid: msg.uid, from: fromAddr, fromName, subject: env.subject || "(no subject)", date: env.date ? new Date(env.date).toISOString() : new Date().toISOString(), snippet, ...cls });
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    return { ok: false, error: (err as Error).message || "Could not read the mailbox." };
  }
  const order = { urgent: 0, important: 1, normal: 2 } as const;
  messages.sort((a, b) => order[a.priority] - order[b.priority] || b.date.localeCompare(a.date));
  return { ok: true, messages };
}
