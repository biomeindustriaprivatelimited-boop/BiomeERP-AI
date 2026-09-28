/**
 * Developer-only: wipe business data for testing (server only)
 * -------------------------------------------------------------------
 * The app is being tested with real-looking data, and a clean slate is
 * needed between test rounds. This deletes the chosen modules' data from
 * the data folder — and ONLY those. What is never touched:
 *
 *   config/users.json         the logins (otherwise nobody can sign in)
 *   config/plants.json, organisation, holidays, number series, settings
 *   whatsapp/auth             the linked WhatsApp account
 *   mail / Drive / cloud credentials, backup schedule
 *   backups/                  so a wipe can always be undone
 *   runtime/, audit/          the wipe itself is recorded in the audit log
 *
 * Safety is enforced on the SERVER, not just on the screen:
 *   1. developer role only
 *   2. a preview must be requested first; it returns a token
 *   3. the wipe is refused until 10 seconds after that preview, and the
 *      token expires after 5 minutes
 *   4. the typed phrase DELETE must be sent
 *   5. a verified backup is taken first unless explicitly declined
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, bumpDataVersion } from "@/lib/dataRoot";

export interface WipeScope {
  id: string;
  label: string;
  help: string;
  /** Paths relative to the data root. Folders are removed whole. */
  targets: string[];
}

export const WIPE_SCOPES: WipeScope[] = [
  { id: "coordination", label: "Coordination trips", help: "Trading + manufacturing register, edit requests.", targets: ["coordination"] },
  { id: "whatsapp", label: "WhatsApp documents", help: "Filed supply sets, staging, the document ledger, learned chats. The WhatsApp login stays linked.", targets: ["whatsapp/inbox", "whatsapp/db", "whatsapp/staging", "config/known-chats.json"] },
  { id: "plant_sheets", label: "Plant biomass & transport sheets", help: "Rewari / Gangakhed entries and plant vendor lists, uploaded slips.", targets: ["config/plants", "plants"] },
  { id: "stock", label: "Plant stock", help: "Items, machines, GRNs, issues, invoices.", targets: ["stock"] },
  { id: "partners", label: "Vendor & client registrations", help: "Registrations with their KYC files, vendor and client masters.", targets: ["partners", "kyc", "config/vendors.json", "config/clients.json"] },
  { id: "po", label: "Purchase orders", help: "Vendor and client POs.", targets: ["po"] },
  { id: "imprest", label: "Imprest", help: "Holders, entries, budgets, bills.", targets: ["imprest"] },
  { id: "people", label: "Payroll, attendance & leave", help: "Employees, salary runs, attendance, leave.", targets: ["payroll", "attendance"] },
  { id: "work", label: "Work tasks, issues, forms, reports", help: "Autopilot tasks, workflows, issues, forms, saved reports, contracts.", targets: ["work", "issues", "forms", "contracts"] },
  { id: "misc", label: "Support, notices, company documents, mail log", help: "Tickets, announcements, company documents, communications log.", targets: ["support", "announcements", "company-documents", "config/company-documents.json", "communications"] },
];

/** Never deleted, whatever is selected. */
const PROTECTED = [
  "config/users.json", "whatsapp/auth", "backups", "runtime", "audit",
  "config/mail.json", "config/gdrive.json", "config/cloud-credentials.json", "config/cloud-service-account.json",
  "config/backup-schedule.json", "config/plants.json", "config/whatsapp-settings.json",
];

function sizeOf(p: string): { files: number; bytes: number } {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return { files: 1, bytes: st.size };
    let files = 0, bytes = 0;
    for (const e of fs.readdirSync(p)) {
      const s = sizeOf(path.join(p, e));
      files += s.files; bytes += s.bytes;
    }
    return { files, bytes };
  } catch { return { files: 0, bytes: 0 }; }
}

export function previewWipe(scopeIds: string[]) {
  const scopes = WIPE_SCOPES.filter((s) => scopeIds.includes(s.id));
  const items = scopes.flatMap((s) => s.targets.map((t) => {
    const full = path.join(paths.root, t);
    const exists = fs.existsSync(full);
    return { scope: s.id, path: t, exists, ...(exists ? sizeOf(full) : { files: 0, bytes: 0 }) };
  }));
  return { scopes: scopes.map((s) => s.label), items, files: items.reduce((n, i) => n + i.files, 0), bytes: items.reduce((n, i) => n + i.bytes, 0) };
}

/* ---- the countdown token, held in memory on the server ---- */
const TOKENS_KEY = "__biomeWipeTokens";
function tokens(): Map<string, { userId: string; scopes: string[]; issuedAt: number }> {
  const g = globalThis as any;
  if (!g[TOKENS_KEY]) g[TOKENS_KEY] = new Map();
  return g[TOKENS_KEY];
}

export const WIPE_WAIT_MS = 10_000;

export function issueWipeToken(userId: string, scopes: string[]): string {
  const t = crypto.randomBytes(16).toString("hex");
  tokens().set(t, { userId, scopes: [...scopes].sort(), issuedAt: Date.now() });
  return t;
}

export function checkWipeToken(token: string, userId: string, scopes: string[]): string | null {
  const rec = tokens().get(token);
  if (!rec || rec.userId !== userId) return "Preview the wipe first.";
  if (rec.scopes.join(",") !== [...scopes].sort().join(",")) return "The selection changed — preview again.";
  const age = Date.now() - rec.issuedAt;
  if (age < WIPE_WAIT_MS) return `Wait ${Math.ceil((WIPE_WAIT_MS - age) / 1000)} more second(s) and read the warning.`;
  if (age > 5 * 60_000) { tokens().delete(token); return "The preview expired — preview again."; }
  return null;
}

export function consumeWipeToken(token: string) { tokens().delete(token); }

export function performWipe(scopeIds: string[]): { removed: string[]; files: number } {
  const removed: string[] = [];
  let files = 0;
  const root = path.resolve(paths.root);
  for (const s of WIPE_SCOPES.filter((x) => scopeIds.includes(x.id))) {
    for (const t of s.targets) {
      if (PROTECTED.some((p) => t === p || t.startsWith(p + "/"))) continue;
      const full = path.resolve(root, t);
      if (!full.startsWith(root + path.sep)) continue; // never outside the data folder
      if (!fs.existsSync(full)) continue;
      files += sizeOf(full).files;
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(t);
    }
  }
  bumpDataVersion();
  return { removed, files };
}
