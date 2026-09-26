"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cloud, CloudOff, Loader2, AlertCircle, Check, Link2, Unlink,
  RefreshCw, HardDrive, FolderTree, ShieldCheck, ExternalLink, KeyRound, Upload,
} from "lucide-react";
import SetupGuide from "@/components/SetupGuide";

/**
 * Admin Cloud Storage.
 *
 * One Google account for the whole company, held by the server. Employee
 * machines never see a token — they talk to this server, which talks to
 * Drive. That is the whole security model, and it is stated on the page so
 * nobody wonders whether their own Google account is involved.
 */

interface Quota {
  total: number | null; used: number; available: number | null;
  usedLabel: string; totalLabel: string; availableLabel: string;
  percentUsed: number; sharedWithOtherServices: boolean;
}
interface Connection {
  accountEmail: string; accountName: string;
  rootFolderId: string | null; rootFolderName: string;
  connectedAt: string; connectedByName: string; lastError: string | null;
}

export default function CloudPage() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cloud/status", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setData(json);
      else setNote({ kind: "bad", text: json.error || `Failed (${res.status}).` });
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function connect() {
    setBusy("connect"); setNote(null);
    try {
      const res = await fetch("/api/cloud/connect", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      // Opened in this tab, not a popup — a blocked popup is the commonest
      // way an OAuth flow appears to do nothing at all.
      window.location.href = json.url;
    } catch (err) {
      setNote({ kind: "bad", text: (err as Error).message });
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Google Drive?\n\nThe files already uploaded stay in Drive — nothing is deleted. New documents simply stop syncing until you connect again.")) return;
    setBusy("disconnect"); setNote(null);
    try {
      const res = await fetch("/api/cloud/connect", { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status}).`);
      setNote({ kind: "ok", text: "Disconnected. Files already in Drive were left alone." });
      await load();
    } catch (err) { setNote({ kind: "bad", text: (err as Error).message }); }
    finally { setBusy(null); }
  }

  async function test() {
    setBusy("test"); setNote(null);
    try {
      const res = await fetch("/api/cloud/connect", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setNote(json.ok
        ? { kind: "ok", text: `Connection is good — signed in as ${json.account}.` }
        : { kind: "bad", text: json.error || "Google didn't accept the stored credentials." });
      await load();
    } catch (err) { setNote({ kind: "bad", text: (err as Error).message }); }
    finally { setBusy(null); }
  }

  if (!data) return <p className="text-[11.5px] text-biome-muted">Loading…</p>;

  const connection: Connection | null = data.connection;
  const quota: Quota | null = data.quota;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
          <Cloud size={19} className="text-biome-leaf" /> Cloud Storage
        </h1>
        <p className="mt-1 text-[11.5px] leading-relaxed text-biome-muted">
          One company Google account, connected here by the admin. Staff machines never hold Google
          credentials — documents go through this server.
        </p>
      </header>

      {note && (
        <div className={`bmx-msg-in flex items-start gap-2 rounded-2xl border px-4 py-3 ${
          note.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/[.07]" : "border-rose-400/25 bg-rose-400/[.07]"
        }`}>
          {note.kind === "ok"
            ? <Check size={15} className="mt-px shrink-0 text-emerald-600" />
            : <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />}
          <p className="text-[11.5px] leading-relaxed text-biome-text">{note.text}</p>
        </div>
      )}

      {/* ---- Not configured: the credentials come first ---- */}
      {!data.configured && (
        <SetupGuide
          title="Google credentials aren't set up yet"
          intro="This is a one-off, about ten minutes, and it happens in Google Cloud Console rather than here."
          steps={[
            { title: "Create a project in Google Cloud Console", detail: "console.cloud.google.com → new project. Any name.", done: false },
            { title: "Enable the Google Drive API", detail: "APIs & Services → Library → Google Drive API → Enable.", done: false },
            { title: "Configure the consent screen", detail: "External, add your Google address as a test user. The app only asks for files it creates itself.", done: false },
            { title: "Create an OAuth client (Web application)", detail: "Add the redirect URI exactly as printed below — Google rejects anything that differs by a character.", done: false },
            { title: "Paste the three values into .env.local and restart", detail: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI. They stay on the server and are never sent to a browser.", done: false },
          ]}
          footnote={
            <>Redirect URI to register:{" "}
              <span className="rounded bg-biome-bg px-1.5 py-0.5 font-mono text-biome-text">
                {typeof window !== "undefined" ? `${window.location.origin}/api/cloud/callback` : "/api/cloud/callback"}
              </span>
              {" "}— the full walkthrough is in CLOUD-SETUP.md at the project root.
            </>
          }
        />
      )}

      {/* ---- Connection ---- */}
      <section className="relative overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <span className="bmx-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
          style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
              connection ? "bg-emerald-500/12 text-emerald-600" : "bg-biome-bg text-biome-muted"
            }`}>
              {connection ? <Cloud size={19} /> : <CloudOff size={19} />}
            </span>
            <div>
              <p className="text-[13px] font-semibold text-biome-text">
                {connection ? connection.accountEmail : "No Google account connected"}
              </p>
              <p className="mt-0.5 text-[11px] text-biome-muted">
                {connection
                  ? `Connected by ${connection.connectedByName} on ${new Date(connection.connectedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                  : data.configured
                  ? "Connect the company Google account to start backing documents up."
                  : "Set the credentials up first."}
              </p>
              {connection?.lastError && (
                <p className="mt-1.5 text-[10.5px] text-rose-500">{connection.lastError}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {connection ? (
              <>
                <button onClick={test} disabled={busy !== null}
                  className="bmx-chip flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2.5 text-[11.5px] font-semibold text-biome-muted disabled:opacity-60">
                  {busy === "test" ? <Loader2 size={13} className="bmx-spin" /> : <RefreshCw size={13} />} Test
                </button>
                <button onClick={disconnect} disabled={busy !== null}
                  className="bmx-chip flex items-center gap-1.5 rounded-xl border border-rose-500/35 px-3.5 py-2.5 text-[11.5px] font-semibold text-rose-500 disabled:opacity-60">
                  <Unlink size={13} /> Disconnect
                </button>
              </>
            ) : (
              <button onClick={connect} disabled={busy !== null || !data.configured}
                className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
                {busy === "connect" ? <Loader2 size={14} className="bmx-spin" /> : <Link2 size={14} />} Connect Google Drive
              </button>
            )}
          </div>
        </div>
      </section>

      <ServiceAccountCard onChanged={load} />

      {/* ---- Quota ---- */}
      {quota && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
              <HardDrive size={15} className="text-biome-leaf" /> Storage
            </h2>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] ${
              data.status === "full" ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
              : data.status === "critical" ? "border-rose-500/30 bg-rose-500/[.07] text-rose-500"
              : data.status === "warning" ? "border-amber-500/35 bg-amber-500/10 text-amber-600"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
            }`}>
              {quota.percentUsed}% used
            </span>
          </div>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-biome-line">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.min(100, quota.percentUsed)}%`,
                background: quota.percentUsed >= 95
                  ? "linear-gradient(90deg,#f43f5e,#fb7185)"
                  : quota.percentUsed >= 75
                  ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                  : "linear-gradient(90deg,#1f7a4c,#34d399)",
              }}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            {[["Used", quota.usedLabel], ["Available", quota.availableLabel], ["Total", quota.totalLabel]].map(([label, value]) => (
              <div key={label}>
                <p className="text-[9.5px] font-bold uppercase tracking-[.13em] text-biome-muted">{label}</p>
                <p className="mt-0.5 font-mono text-[15px] font-semibold text-biome-text">{value}</p>
              </div>
            ))}
          </div>

          {quota.sharedWithOtherServices && (
            <p className="mt-3 text-[10.5px] leading-relaxed text-biome-muted">
              A personal Google account shares this space with Gmail and Photos, so the free space
              shown is not all available to documents. The figures come from Google directly — nothing
              here assumes 15 GB.
            </p>
          )}

          {quota.percentUsed >= 95 && (
            <div className="bmx-msg-in mt-3 rounded-xl border border-rose-500/30 bg-rose-500/[.07] px-3.5 py-2.5">
              <p className="text-[11.5px] font-semibold text-biome-text">Drive is nearly full</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
                At 100% uploads pause and queue. The ERP keeps working either way — a full Drive
                never stops anyone filing an entry.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---- Folder ---- */}
      {connection && (
        <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
            <FolderTree size={15} className="text-biome-leaf" /> Folder
          </h2>
          <p className="mt-1.5 text-[11px] leading-relaxed text-biome-muted">
            Documents are filed under <span className="font-mono text-biome-text">{connection.rootFolderName}</span> in
            the connected account, in one folder per kind — Invoices, Weight Slips, Employees,
            HR Documents and so on.
          </p>
          {connection.rootFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${connection.rootFolderId}`}
              target="_blank" rel="noreferrer"
              className="bmx-chip mt-3 inline-flex items-center gap-1.5 rounded-xl border border-biome-line px-3.5 py-2 text-[11.5px] font-semibold text-biome-muted"
            >
              <ExternalLink size={13} /> Open in Google Drive
            </a>
          )}
        </section>
      )}

      {/* ---- What this does and doesn't do ---- */}
      <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-biome-text">
          <ShieldCheck size={15} className="text-biome-leaf" /> How this behaves
        </h2>
        <ul className="mt-3 space-y-2">
          {[
            "Drive is a copy, not the record. The ERP database stays authoritative — deleting a document never deletes the invoice, employee or supply it belonged to.",
            "Deleting a document here moves the Drive copy to Trash, not to oblivion. It can be recovered.",
            "Deleting a document never deletes its history. Who created it, who approved it and who removed it stays in the audit log permanently.",
            "A cloud-side deletion is never mirrored back. If a file disappears from Drive, the local copy is kept and flagged for you to decide.",
            "If both copies changed since they last agreed, neither is overwritten — you choose which to keep, or keep both.",
            "The app only asks Google for files it created itself. It cannot read your personal documents, photos or mail.",
            "Cloud trouble never blocks the ERP. Work queues and goes up when the connection returns.",
          ].map((line) => (
            <li key={line} className="flex gap-2 text-[11px] leading-relaxed text-biome-muted">
              <Check size={13} className="mt-0.5 shrink-0 text-biome-leaf" /> {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ================= service account ================= */

/**
 * The no-browser way to connect Drive.
 *
 * The business asked to connect with an email address and password. Google
 * does not allow that — "Less secure app access" was withdrawn, and any
 * app posting a Google password is refused. There is no setting that
 * changes it, so saying so plainly on the screen is more use than a vague
 * error later.
 *
 * A service account is the nearest thing Google permits and is genuinely
 * better here: one JSON file, no consent screen, and it does not die when
 * somebody changes their Google password — which an OAuth token does.
 */
function ServiceAccountCard({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [keyJson, setKeyJson] = useState("");
  const [folderId, setFolderId] = useState("");
  const [clientEmail, setClientEmail] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cloud/service", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch { /* stays quiet */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Pull the address out of the key so it can be shown before connecting. */
  function readKey(text: string) {
    setKeyJson(text);
    setNote(null);
    try {
      const parsed = JSON.parse(text);
      setClientEmail(parsed.client_email || "");
    } catch { setClientEmail(""); }
  }

  async function connect() {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/cloud/service", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyJson, folderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status}).`);
      setNote({ kind: "ok", text: `Connected. ${json.foldersCreated || 0} folder(s) created inside "${json.connection.rootFolderName}".` });
      setKeyJson(""); setFolderId(""); setOpen(false);
      await load(); onChanged();
    } catch (err) { setNote({ kind: "bad", text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this service account?\n\nFiles already in Drive stay exactly where they are.")) return;
    setBusy(true);
    try {
      await fetch("/api/cloud/service", { method: "DELETE" });
      setNote({ kind: "ok", text: "Disconnected. Nothing in Drive was touched." });
      await load(); onChanged();
    } finally { setBusy(false); }
  }

  const connection = data?.connection;

  return (
    <section className="rounded-2xl border border-biome-line bg-biome-bgSoft p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            connection ? "bg-emerald-500/12 text-emerald-600" : "bg-biome-bg text-biome-muted"
          }`}>
            <KeyRound size={19} />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-biome-text">
              Connect without a browser — service account
            </h2>
            <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-biome-muted">
              One JSON file from Google, and the app connects by itself from then on. No consent
              screen, no password, and it does not stop working when you change your Google password.
            </p>
          </div>
        </div>
        {connection ? (
          <button onClick={disconnect} disabled={busy}
            className="bmx-chip flex items-center gap-1.5 rounded-xl border border-rose-500/35 px-3.5 py-2.5 text-[11.5px] font-semibold text-rose-500 disabled:opacity-60">
            <Unlink size={13} /> Disconnect
          </button>
        ) : (
          <button onClick={() => setOpen((v) => !v)}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white">
            <KeyRound size={14} /> {open ? "Close" : "Set it up"}
          </button>
        )}
      </div>

      {/* The honest bit, said once and clearly. */}
      <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[.07] px-4 py-3">
        <p className="text-[11.5px] font-semibold text-biome-text">
          Why there is no &ldquo;sign in with email and password&rdquo;
        </p>
        <p className="mt-1 text-[10.5px] leading-relaxed text-biome-muted">
          Google stopped allowing applications to sign in with a Google password — &ldquo;Less
          secure app access&rdquo; was withdrawn, and any app that tries is refused at their end.
          It is not a setting in this app and there is no way around it. The two things Google does
          permit are the browser sign-in above, or the service account here.
        </p>
      </div>

      {connection && (
        <div className="mt-4 rounded-xl border border-biome-line bg-biome-bg/50 px-4 py-3">
          <div className="grid gap-2 md:grid-cols-2">
            <Row2 label="Service account" value={connection.clientEmail} />
            <Row2 label="Folder" value={connection.rootFolderName} />
            <Row2 label="Connected by" value={connection.connectedByName} />
            <Row2 label="Status" value={data.ok ? "Working" : data.error || "Cannot reach the folder"} />
          </div>
          {!data.ok && data.error && (
            <p className="mt-2 text-[10.5px] leading-relaxed text-rose-500">{data.error}</p>
          )}
          {connection.rootFolderId && (
            <a href={`https://drive.google.com/drive/folders/${connection.rootFolderId}`}
              target="_blank" rel="noreferrer"
              className="bmx-chip mt-3 inline-flex items-center gap-1.5 rounded-xl border border-biome-line px-3 py-1.5 text-[11px] font-semibold text-biome-muted">
              <ExternalLink size={12} /> Open the folder
            </a>
          )}
        </div>
      )}

      {note && (
        <div className={`bmx-msg-in mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${
          note.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/[.07]" : "border-rose-400/25 bg-rose-400/[.07]"
        }`}>
          {note.kind === "ok"
            ? <Check size={14} className="mt-px shrink-0 text-emerald-600" />
            : <AlertCircle size={14} className="mt-px shrink-0 text-rose-500" />}
          <p className="text-[11px] leading-relaxed text-biome-text">{note.text}</p>
        </div>
      )}

      {open && !connection && (
        <div className="bmx-msg-in mt-4 space-y-4">
          <ol className="space-y-2">
            {[
              ["Open Google Cloud Console", "console.cloud.google.com → pick or create a project."],
              ["Enable the Google Drive API", "APIs & Services → Library → Google Drive API → Enable."],
              ["Create a service account", "IAM & Admin → Service Accounts → Create. Any name. No roles needed."],
              ["Download a JSON key", "Open it → Keys → Add key → Create new key → JSON. The file downloads."],
              ["Make a folder in your Drive and share it", "Right-click the folder → Share → paste the service account address → Editor → Send."],
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-3 rounded-xl border border-biome-line px-3.5 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-biome-line text-[10px] font-bold text-biome-muted">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[11.5px] font-semibold text-biome-text">{title}</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-biome-muted">{detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
              The JSON key file
            </p>
            <label className="bmx-chip inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-biome-line px-4 py-3 text-[11.5px] text-biome-muted hover:text-biome-text">
              <Upload size={14} /> {keyJson ? "Choose a different file" : "Choose the downloaded .json"}
              <input type="file" accept=".json,application/json" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) readKey(await f.text());
                }} />
            </label>
            <textarea
              rows={3}
              value={keyJson}
              onChange={(e) => readKey(e.target.value)}
              placeholder="…or paste the contents here"
              className={`${inputCls} mt-2 resize-y font-mono text-[10px]`}
            />
            {clientEmail && (
              <div className="mt-2 rounded-xl border border-biome-leaf/30 bg-biome-leaf/[.07] px-3.5 py-2.5">
                <p className="text-[10.5px] leading-relaxed text-biome-text">
                  Share your Drive folder with this address, as <strong>Editor</strong>:
                </p>
                <p className="mt-1 select-all break-all font-mono text-[11px] font-semibold text-biome-leaf">
                  {clientEmail}
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-biome-muted">
              The shared folder
            </p>
            <input value={folderId} onChange={(e) => setFolderId(e.target.value)}
              placeholder="Paste the folder link, e.g. https://drive.google.com/drive/folders/1A2b3C…"
              className={inputCls} />
            <p className="mt-1.5 text-[10px] leading-relaxed text-biome-muted">
              Open the folder in Drive and copy the address bar. A service account has no storage of
              its own, so the files live in your Drive and count against your quota.
            </p>
          </div>

          <button onClick={connect} disabled={busy || !keyJson.trim() || !folderId.trim()}
            className="bmx-btn flex items-center gap-2 rounded-xl bg-biome-leaf px-4 py-2.5 text-[11.5px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="bmx-spin" /> : <Link2 size={14} />} Connect
          </button>
        </div>
      )}
    </section>
  );
}

function Row2({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-biome-line/50 py-1 last:border-0">
      <span className="shrink-0 text-[10px] uppercase tracking-[.12em] text-biome-muted">{label}</span>
      <span className="truncate text-right text-[11px] text-biome-text">{value || "—"}</span>
    </div>
  );
}

const inputCls =
  "bmx-input w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2.5 text-[12px] text-biome-text outline-none";
