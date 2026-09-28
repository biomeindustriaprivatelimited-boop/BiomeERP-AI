/**
 * Biome Platform — WhatsApp Agent
 * ===================================================================
 * Links ONE WhatsApp account to this PC by QR code (exactly like
 * WhatsApp Web / WhatsApp Desktop does), then quietly watches it in the
 * background. Every document or image that arrives is:
 *
 *      downloaded  ->  read by AI  ->  reference matched  ->  filed
 *
 * into  Documents/Biome Platform/whatsapp/inbox/<FY>/<Client>/<Ref>/
 *
 * It runs as its own small process so a WhatsApp reconnect, a slow AI
 * call, or a bad PDF can never take the main app down with it. The
 * Electron app starts and stops it automatically; in `npm run dev` you
 * start it yourself with `npm run whatsapp:agent`.
 *
 * SECURITY
 *   - Binds to 127.0.0.1 only. Nothing on your network can reach it.
 *   - Every request needs a token that is generated at startup and
 *     written to runtime/whatsapp-agent.json, which only this user
 *     account can read.
 *   - The WhatsApp session lives in whatsapp/auth/. Treat that folder
 *     like a password: anyone holding it can read the linked account.
 *     "Disconnect" in the app deletes it.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const { PATHS, ensureAllDirs, ensureDir } = require("./lib/paths");
const { parseReference } = require("./lib/reference");
const { classifyDocument, readLocally, DOC_TYPE_LABEL } = require("./lib/classify");
const learning = require("./lib/learning");
const sampleStore = require("./lib/samples");
const { planFiling, saveFile } = require("./lib/filing");
const store = require("./lib/store");
const { BUILD } = require("./lib/version");
const { ensureSeeded, loadClients, matchClient, loadPlants } = require("./lib/clients");
const { anchorDateFor, reanchorReference, reanchorAll } = require("./lib/anchor");
const staging = require("./lib/staging");
const patterns = require("./lib/patterns");
const { parseFileName, applyFileNameHints } = require("./lib/fileNameParser");
const verify = require("./lib/verify");

const HOST = "127.0.0.1";
const PORT = Number(process.env.BIOME_WA_AGENT_PORT || 4174);

// ---------------------------------------------------------------------
// Dependency check — fail loudly and usefully, not with a stack trace
// ---------------------------------------------------------------------
let makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  pino,
  QRCode;

try {
  const baileys = require("@whiskeysockets/baileys");
  makeWASocket = baileys.default || baileys.makeWASocket;
  ({
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
  } = baileys);
  pino = require("pino");
  QRCode = require("qrcode");
} catch (err) {
  const message =
    "The WhatsApp agent can't start because its packages aren't installed. " +
    "Open a terminal in the project folder and run `npm install`, then start the app again.";
  console.error(`\n[Biome WhatsApp Agent] ${message}\n(underlying error: ${err.message})\n`);

  // Leave a note on disk so the app can show the real reason instead of a
  // bare "agent not running" — that message sent people looking in the
  // wrong place entirely.
  try {
    const os = require("os");
    const p = require("path");
    const f = require("fs");
    const dir = p.join(
      (process.env.BIOME_DATA_ROOT || "").trim() ||
        (() => {
          try {
            const m = p.join(os.homedir(), ".biome-data-root");
            if (f.existsSync(m)) return f.readFileSync(m, "utf8").trim();
          } catch {}
          return p.join(os.homedir(), "Documents", "Biome Platform");
        })(),
      "runtime"
    );
    f.mkdirSync(dir, { recursive: true });
    f.writeFileSync(
      p.join(dir, "whatsapp-agent-error.json"),
      JSON.stringify(
        { at: new Date().toISOString(), reason: "MISSING_DEPENDENCIES", message, detail: err.message },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* best effort — the console message above is still there */
  }
  process.exit(1);
}

// ---------------------------------------------------------------------
// Environment: read .env.local the same way Next.js does
// ---------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

// ---------------------------------------------------------------------
// Settings + vendor master (owned by the Next app, read here)
// ---------------------------------------------------------------------
function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function settings() {
  const s = readJsonSafe(PATHS.settingsFile, {});
  return {
    companyCodes:
      Array.isArray(s.companyCodes) && s.companyCodes.length ? s.companyCodes : ["BDC", "BIPL"],
    /** Only handle messages from these chats (JIDs). Empty = all chats. */
    allowedChats: Array.isArray(s.allowedChats) ? s.allowedChats : [],
    watchAllChats: s.watchAllChats === true,
    /** Dedicated workflow scopes. A receiving/lab group can be monitored
     * without opening the whole sales-document scope. */
    receivingChats: Array.isArray(s.receivingChats) ? s.receivingChats : [],
    labChats: Array.isArray(s.labChats) ? s.labChats : [],
    /** Groups the agent may study in full — every message, not just media. */
    learnChats: Array.isArray(s.learnChats) ? s.learnChats : [],
    /** Ignore messages we ourselves sent from the linked phone. */
    // Defaults to FALSE: our own invoices are posted by us, and they are
    // the documents that carry the reference.
    ignoreOwnMessages: s.ignoreOwnMessages === true,
    autoProcess: s.autoProcess !== false,
  };
}

function vendors() {
  const v = readJsonSafe(PATHS.vendorsFile, { vendors: [] });
  return Array.isArray(v.vendors) ? v.vendors : [];
}

// ---------------------------------------------------------------------
// Agent state
// ---------------------------------------------------------------------
const state = {
  status: "disconnected", // disconnected | connecting | qr | connected | logged_out | error
  qrDataUrl: null,
  qrExpiresAt: null,
  me: null, // { id, name }
  lastError: null,
  lastEventAt: null,
  startedAt: new Date().toISOString(),
  processing: 0,
  queueDepth: 0,
};

let sock = null;
let reconnectTimer = null;
let intentionalLogout = false;

function log(...args) {
  console.log(`[Biome WhatsApp Agent ${new Date().toISOString()}]`, ...args);
}

function setStatus(next, extra = {}) {
  state.status = next;
  state.lastEventAt = new Date().toISOString();
  Object.assign(state, extra);
  log("status:", next, extra.lastError ? `(${extra.lastError})` : "");
}

// ---------------------------------------------------------------------
// WhatsApp connection
// ---------------------------------------------------------------------
async function connect() {
  if (sock) return; // already connected or connecting
  intentionalLogout = false;
  setStatus("connecting", { lastError: null, qrDataUrl: null });

  ensureDir(PATHS.waAuth);
  const logger = pino({ level: "silent" });
  const { state: authState, saveCreds } = await useMultiFileAuthState(PATHS.waAuth);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined; // Baileys falls back to its bundled version
  }

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger),
    },
    browser: ["Biome Platform", "Desktop", "1.0.0"],
    markOnlineOnConnect: false, // don't steal notifications from the phone
    // Off for normal running so linking doesn't re-file months of old
    // paperwork; switched on only for an explicit historical scan.
    syncFullHistory: backfill.active,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        // WhatsApp rotates the pairing QR roughly every 20 seconds.
        state.qrExpiresAt = new Date(Date.now() + 20000).toISOString();
        setStatus("qr");
      } catch (err) {
        setStatus("error", { lastError: `Could not render the QR code: ${err.message}` });
      }
    }

    if (connection === "open") {
      state.qrDataUrl = null;
      state.qrExpiresAt = null;
      state.me = sock?.user ? { id: sock.user.id, name: sock.user.name || sock.user.verifiedName || null } : null;
      setStatus("connected", { lastError: null });
      refreshGroupNames();
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      sock = null;

      if (intentionalLogout) {
        setStatus("disconnected", { qrDataUrl: null, me: null });
        return;
      }
      if (loggedOut) {
        // The phone unlinked us. The stored session is dead — clear it so
        // the next connect shows a fresh QR instead of failing forever.
        clearAuthFolder();
        setStatus("logged_out", {
          qrDataUrl: null,
          me: null,
          lastError: "This device was unlinked from WhatsApp. Scan the QR code again to reconnect.",
        });
        return;
      }

      setStatus("connecting", {
        lastError: lastDisconnect?.error?.message || "Connection dropped — retrying.",
      });
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connect().catch((err) => setStatus("error", { lastError: err.message }));
      }, 3000);
    }
  });

  // Historical messages arrive here rather than through messages.upsert.
  sock.ev.on("messaging-history.set", (payload) => {
    const messages = payload?.messages || [];
    for (const msg of messages) {
      backfill.seen += 1;
      rememberChat(msg);
      rememberChatText(msg);
      if (!withinBackfillRange(msg.messageTimestamp)) {
        backfill.skippedOutOfRange += 1;
        continue;
      }
      const before = queue.length;
      enqueue(msg);
      if (queue.length > before) backfill.queued += 1;
    }
    if (payload?.progress === 100 || payload?.isLatest) {
      backfill.finishedAt = new Date().toISOString();
      backfill.active = false;
      clearTimeout(backfillTimeout);
      log(`history sync finished: ${backfill.seen} messages seen, ${backfill.queued} documents queued`);
    }
  });

  // Group names arrive separately from messages.
  sock.ev.on("groups.upsert", (groups) => {
    for (const g of groups || []) {
      const existing = knownChats.get(g.id) || { jid: g.id, isGroup: true, messageCount: 0, documentCount: 0 };
      existing.name = g.subject || existing.name;
      existing.participantCount = g.participants?.length ?? existing.participantCount;
      knownChats.set(g.id, existing);
    }
    persistChats();
  });

  sock.ev.on("groups.update", (updates) => {
    for (const g of updates || []) {
      const existing = knownChats.get(g.id);
      if (existing && g.subject) {
        existing.name = g.subject;
        knownChats.set(g.id, existing);
      }
    }
    persistChats();
  });

  // On connect, Baileys hands over the full group list once.
  sock.ev.on("connection.update", async (update) => {
    if (update.connection !== "open") return;
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const g of Object.values(groups || {})) {
        const existing = knownChats.get(g.id) || { jid: g.id, isGroup: true, messageCount: 0, documentCount: 0, firstSeen: new Date().toISOString() };
        existing.name = g.subject || existing.name;
        existing.participantCount = g.participants?.length ?? 0;
        knownChats.set(g.id, existing);
      }
      persistChats();
      log(`found ${Object.keys(groups || {}).length} group(s)`);
      autoSelectSalesGroups();
      // Anything held while the agent was off is re-offered now, and again
      // every 20 minutes — so a vendor paper never waits on a human to
      // press a button once our document for that supply is filed.
      setTimeout(() => { try { sweepStaged({}); } catch {} }, 8000);
      if (!global.__biomeSweepTimer) {
        global.__biomeSweepTimer = setInterval(() => { try { sweepStaged({}); } catch {} }, 20 * 60 * 1000);
      }
    } catch (err) {
      log(`could not list groups: ${err.message}`);
    }
  });

  // Group subjects arrive here. Without this the picker would show raw
  // JIDs like "1203630...@g.us", which nobody can identify.
  sock.ev.on("groups.upsert", (groups) => {
    for (const g of groups || []) {
      const existing = knownChats.get(g.id) || { jid: g.id, isGroup: true, documentCount: 0, messageCount: 0, lastSeen: null };
      existing.name = g.subject || existing.name;
      existing.participants = (g.participants || []).length;
      knownChats.set(g.id, existing);
    }
  });

  sock.ev.on("groups.update", (updates) => {
    for (const g of updates || []) {
      const existing = knownChats.get(g.id);
      if (existing && g.subject) existing.name = g.subject;
    }
  });

  // On connect, ask for the full group list so the picker is populated
  // before any message arrives.
  sock.ev.on("connection.update", async (u) => {
    if (u.connection !== "open" || !sock) return;
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const g of Object.values(groups || {})) {
        const existing = knownChats.get(g.id) || { jid: g.id, isGroup: true, documentCount: 0, messageCount: 0, lastSeen: null };
        existing.name = g.subject || existing.name;
        existing.participants = (g.participants || []).length;
        knownChats.set(g.id, existing);
      }
      log(`loaded ${Object.keys(groups || {}).length} group(s) for selection`);
    } catch (err) {
      log(`could not list groups: ${err.message}`);
    }
  });

  sock.ev.on("messages.upsert", (payload) => {
    // "notify" = arrived while connected. "append" is NOT only history:
    // Baileys also delivers every message that arrived while this PC was
    // OFF (or the app closed) as "append" when it reconnects. Skipping
    // "append" silently lost every document sent overnight or during a
    // power cut. Recent appends (last 7 days) are processed; older ones
    // are left to an explicit historical scan. store.hasMessage() keeps a
    // re-delivered message from being filed twice.
    const cutoff = Date.now() / 1000 - 7 * 86400;
    for (const msg of payload.messages || []) {
      if (payload.type !== "notify" && Number(msg.messageTimestamp || 0) < cutoff) continue;
      rememberChat(msg);
      rememberChatText(msg); // capture "documents for JPL" style hints
      enqueue(msg);
    }
  });
}

/**
 * Coordinators announce a consignment in plain words around the files —
 * "@Govind documents for JPL", "ye Jhajjar ka hai", "vehicle HR47F0021".
 * That sentence often names the client when the documents themselves are
 * cropped or unlabelled, so we keep the last few text lines per chat and
 * feed them to the reader as context.
 */

let chatsSaveTimer = null;
function persistChats() {
  // Debounced: a busy group would otherwise write on every message.
  clearTimeout(chatsSaveTimer);
  chatsSaveTimer = setTimeout(() => {
    try {
      ensureDir(PATHS.configDir);
      fs.writeFileSync(
        path.join(PATHS.configDir, "known-chats.json"),
        JSON.stringify({ chats: [...knownChats.values()], updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
    } catch {
      /* the in-memory list still works this session */
    }
  }, 3000);
}

function loadKnownChats() {
  try {
    const file = path.join(PATHS.configDir, "known-chats.json");
    if (!fs.existsSync(file)) return;
    for (const c of JSON.parse(fs.readFileSync(file, "utf8")).chats || []) {
      knownChats.set(c.jid, c);
    }
  } catch {
    /* start empty */
  }
}

/**
 * Every chat we've seen traffic in, so the UI can offer a real list to
 * pick from instead of asking someone to type a WhatsApp JID.
 */
const knownChats = new Map(); // jid -> { jid, name, isGroup, lastSeen, documentCount }

function rememberChat(msg) {
  const jid = msg?.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const existing = knownChats.get(jid) || {
    jid,
    name: null,
    isGroup: jid.endsWith("@g.us"),
    lastSeen: null,
    documentCount: 0,
    messageCount: 0,
  };
  // Group subjects arrive separately; a participant's pushName is only
  // the sender's name, so it must not be used as the group's name.
  if (!existing.isGroup && msg.pushName) existing.name = msg.pushName;
  existing.lastSeen = new Date(Number(msg.messageTimestamp || 0) * 1000 || Date.now()).toISOString();
  existing.messageCount += 1;
  if (describeMedia(msg)) existing.documentCount += 1;
  knownChats.set(jid, existing);
}

/** Ask WhatsApp for the real names of every group this account is in. */
async function refreshGroupNames() {
  if (!sock) return;
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [jid, meta] of Object.entries(groups || {})) {
      const existing = knownChats.get(jid) || { jid, isGroup: true, documentCount: 0 };
      existing.name = meta.subject || existing.name;
      existing.participants = (meta.participants || []).length;
      knownChats.set(jid, existing);
    }
  } catch (err) {
    log("could not fetch group names:", err.message);
  }
}

const chatText = new Map(); // jid -> [{ text, at }]
const CHAT_TEXT_KEEP = 6;
const CHAT_TEXT_MAX_AGE_MS = 60 * 60 * 1000; // an hour

function plainTextOf(message) {
  const m = unwrap(message);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  ).trim();
}

function rememberChatText(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const text = plainTextOf(msg.message);
  if (!text || text.length > 500) return;
  const at = Number(msg.messageTimestamp || 0) * 1000 || Date.now();
  const list = chatText.get(jid) || [];
  list.push({ text, at, from: msg.pushName || null });
  while (list.length > CHAT_TEXT_KEEP) list.shift();
  chatText.set(jid, list);
}

/** The recent text hints for a chat, freshest first, as one block. */
function recentChatContext(jid) {
  const list = (chatText.get(jid) || []).filter((e) => Date.now() - e.at < CHAT_TEXT_MAX_AGE_MS);
  if (!list.length) return "";
  return list
    .slice(-CHAT_TEXT_KEEP)
    .reverse()
    .map((e) => (e.from ? `${e.from}: ${e.text}` : e.text))
    .join("\n");
}

async function disconnect({ forget }) {
  intentionalLogout = true;
  clearTimeout(reconnectTimer);
  try {
    if (sock && forget) await sock.logout();
    else if (sock) sock.end(undefined);
  } catch {
    // Logout can fail if the socket is already gone — that's fine.
  }
  sock = null;
  if (forget) clearAuthFolder();
  setStatus("disconnected", { qrDataUrl: null, qrExpiresAt: null, me: null, lastError: null });
}

function clearAuthFolder() {
  try {
    fs.rmSync(PATHS.waAuth, { recursive: true, force: true });
    ensureDir(PATHS.waAuth);
  } catch (err) {
    log("could not clear the auth folder:", err.message);
  }
}

// ---------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------

/** WhatsApp wraps media in several optional envelopes. Peel them off. */
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    else if (m.editedMessage) m = m.editedMessage.message;
    else break;
  }
  return m || {};
}

/**
 * The message this one was sent as a reply to, if any.
 *
 * Coordinators tag our invoice onto the vendor's invoice by replying to
 * it in the group. That reply is a deliberate statement that the two
 * belong to the same supply, and it is far more reliable than anything we
 * could infer from the page — so we capture it and use it to inherit a
 * reference when the document itself doesn't print one.
 */
function quotedMessageId(msg) {
  const m = unwrap(msg.message);
  for (const key of [
    "extendedTextMessage",
    "imageMessage",
    "documentMessage",
    "videoMessage",
  ]) {
    const ctx = m?.[key]?.contextInfo;
    if (ctx?.stanzaId) return ctx.stanzaId;
  }
  return null;
}

function describeMedia(msg) {
  const content = unwrap(msg.message);
  if (content.documentMessage) {
    const d = content.documentMessage;
    return {
      kind: "document",
      mimeType: d.mimetype || "application/octet-stream",
      fileName: d.fileName || "document",
      size: Number(d.fileLength || 0),
      caption: d.caption || "",
    };
  }
  if (content.imageMessage) {
    const i = content.imageMessage;
    return {
      kind: "image",
      mimeType: i.mimetype || "image/jpeg",
      fileName: `photo-${msg.key.id}.jpg`,
      size: Number(i.fileLength || 0),
      caption: i.caption || "",
    };
  }
  return null;
}

const queue = [];
let draining = false;

/**
 * Historical scan state. WhatsApp only hands over the history the LINKED
 * PHONE still holds, so how far back this reaches depends on that phone's
 * retention — it is not a guaranteed one-year window. Whatever does come
 * through is filtered to the requested date range and processed exactly
 * like a live message.
 */
let backfillTimeout = null;

const backfill = {
  active: false,
  fromDate: null,
  toDate: null,
  seen: 0,
  queued: 0,
  skippedOutOfRange: 0,
  startedAt: null,
  finishedAt: null,
  note: null,
};

function withinBackfillRange(tsSeconds) {
  if (!backfill.fromDate && !backfill.toDate) return true;
  const t = Number(tsSeconds || 0) * 1000;
  if (!t) return false;
  if (backfill.fromDate && t < new Date(backfill.fromDate).getTime()) return false;
  // Include the whole end day.
  if (backfill.toDate && t > new Date(backfill.toDate).getTime() + 86399999) return false;
  return true;
}

function enqueue(msg) {
  const cfg = settings();
  if (!msg?.key?.id) return;

  // Messages we sent ourselves are NOT skipped.
  //
  // This was the single most damaging default in the agent. Our own tax
  // invoices and delivery challans are posted to the group by us — they
  // arrive with fromMe set — and they are the only documents that carry
  // the coordination reference. Skipping them meant the one document the
  // entire matching design waits for never arrived, so vendor papers sat
  // in staging forever and no supply ever completed.
  //
  // The setting is kept for chats where it makes sense, but it now
  // defaults to false and never applies to a document.
  if (cfg.ignoreOwnMessages && msg.key.fromMe && !describeMedia(msg)) return;

  const jid = msg.key.remoteJid || "";
  if (jid === "status@broadcast") return; // WhatsApp Status posts
  const workflowChat = cfg.allowedChats.includes(jid) || cfg.receivingChats.includes(jid) || cfg.labChats.includes(jid);
  if (!cfg.watchAllChats && !workflowChat) return;

  const media = describeMedia(msg);
  if (!media) return; // plain text, sticker, call, etc.
  if (store.hasMessage(msg.key.id)) return; // already handled

  queue.push({ msg, media });
  state.queueDepth = queue.length;
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      state.queueDepth = queue.length;
      state.processing += 1;
      try {
        await handleMedia(job.msg, job.media);
      } catch (err) {
        log("failed to handle a message:", err.message);
        recordFailure(job, err);
      } finally {
        state.processing -= 1;
      }
    }
  } finally {
    draining = false;
  }
}

function senderOf(msg) {
  const jid = msg.key.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  return {
    chatJid: jid,
    isGroup,
    participantJid: isGroup ? msg.key.participant || null : jid,
    name: msg.pushName || null,
  };
}

/**
 * File a vendor document automatically when the evidence is beyond doubt.
 *
 * The threshold is 90, which cannot be reached on one signal alone — it
 * needs the vendor's document number AND the vehicle, or the vehicle AND
 * the quantity, or better. Three independent facts agreeing on the same
 * consignment is not a coincidence that happens.
 *
 * Everything auto-filed is recorded with WHY, and can be undone in one
 * click. That is the part that makes automation safe: the danger was
 * never a wrong match, it was a wrong match nobody could see.
 */
const AUTO_FILE_THRESHOLD = 90;

/**
 * A code shared by several vendors: pick the one the page names.
 * Returns null when the code is unique (nothing to resolve).
 */
function resolveSharedVendorCode(code, extracted, vendorList) {
  const owners = (vendorList || []).filter((v) => v.code === code);
  if (owners.length <= 1) return null;
  const hay = `${extracted?.vendorName || ""} ${extracted?.transcription || ""}`.toLowerCase();
  const hit = owners.find((v) => [v.name, ...(v.aliases || [])].some((n) => n && hay.includes(String(n).toLowerCase())));
  return hit ? { name: hit.name, ambiguous: false, candidates: owners.map((v) => v.name) } : { name: null, ambiguous: true, candidates: owners.map((v) => v.name) };
}

function autoFileFromSuggestion(recordId, extracted) {
  let suggestion = null;
  try {
    suggestion = store.suggestReference(extracted);
  } catch {
    return null;
  }
  const minimumConfidence = extracted?.documentType === "receiving" ? 85 : AUTO_FILE_THRESHOLD;
  if (!suggestion || suggestion.confidence < minimumConfidence) return null;

  const opts = {
    companyCodes: settings().companyCodes,
    vendorCodes: vendors().map((v) => v.code),
  };
  const reference = parseReference(suggestion.reference, opts);
  if (!reference) return null;

  const refRecord = {
    canonical: reference.canonical,
    companyCode: reference.companyCode,
    biomeDocNo: reference.biomeDocNo,
    vendorCode: reference.vendorCode,
    vendorDocNo: reference.vendorDocNo,
    confidence: reference.confidence,
  };

  // Writing the reference into the ledger is not enough — the FILE has
  // to move too. Without this the record claimed to belong to
  // BDC/899/TBS/43 while the document itself sat in an "Unmatched"
  // folder of its own, which is exactly what "har document alag folder
  // me" describes.
  const rec = store.byId(recordId);
  let movedTo = null;

  if (rec) {
    const source = locateFile(rec);
    if (source && fs.existsSync(source)) {
      try {
        const plan = planFiling({
          reference,
          supplyType: reference.plantCode ? "manufacturing" : "trading",
          extracted: {
            ...(rec.extracted || {}),
            // The supply's client and date come from OUR invoice, so the
            // whole set lands in one folder rather than each document
            // choosing a folder from its own page.
            clientName: rec.extracted?.clientName || suggestion.clientName || null,
            documentDate: suggestion.date || rec.extracted?.documentDate || null,
          },
          originalName: rec.originalName,
          mimeType: rec.mimeType,
          receivedAt: new Date(rec.receivedAt),
          senderName: rec.sender?.name || "WhatsApp",
          anchorDate: suggestion.date || null,
        });

        const saved = saveFile(plan, fs.readFileSync(source));
        movedTo = saved.filePath;

        // Remove the old copy only once the new one is safely written.
        if (path.resolve(source) !== path.resolve(saved.filePath)) {
          try {
            fs.unlinkSync(source);
            // Walk back up removing folders the move has emptied, so the
            // holding areas don't accumulate as empty shells. Stops at
            // the inbox itself, and at the first folder still in use.
            let dir = path.dirname(source);
            const stopAt = path.resolve(PATHS.inbox);
            while (
              path.resolve(dir).startsWith(stopAt) &&
              path.resolve(dir) !== stopAt &&
              fs.existsSync(dir) &&
              fs.readdirSync(dir).length === 0
            ) {
              fs.rmdirSync(dir);
              dir = path.dirname(dir);
            }
          } catch {
            /* a stray copy is better than a lost document */
          }
        }
      } catch (err) {
        log(`could not move "${rec.originalName}" into ${reference.canonical}: ${err.message}`);
      }
    }
  }

  store.update(recordId, {
    reference: refRecord,
    bucket: movedTo ? "filed" : rec?.bucket,
    filePath: movedTo || rec?.filePath || null,
    relativePath: movedTo ? path.relative(PATHS.inbox, movedTo) : rec?.relativePath || null,
    autoFiled: true,
    autoFiledAt: new Date().toISOString(),
    autoFiledConfidence: suggestion.confidence,
    autoFiledReasons: suggestion.reasons,
  });

  log(
    `auto-filed into ${reference.canonical} (${suggestion.confidence}%)` +
      (movedTo ? ` → ${path.relative(PATHS.inbox, movedTo)}` : " (ledger only — file not found)") +
      ` — ${suggestion.reasons.join("; ")}`
  );
  return suggestion;
}

function recordFailure(job, err) {
  const sender = senderOf(job.msg);

  // Even when the file itself couldn't be read — expired media, a broken
  // download — the filename usually still says what the document is.
  // Discarding that left hundreds of documents labelled "Unclassified"
  // when their names read "Delivery Note_BIPL_2026-27_624".
  let salvaged = null;
  try {
    const hints = parseFileName(job.media.fileName, {
      vendors: vendors(),
      companyCodes: settings().companyCodes,
    });
    if (hints.typeHint || hints.biomeDocNo || hints.vehicleNo) {
      salvaged = applyFileNameHints(
        { documentType: "other", confidence: 0, transcription: "", engine: "filename-only" },
        hints
      );
    }
  } catch {
    /* best effort — the failure is still recorded below */
  }

  store.append({
    id: `doc-${job.msg.key.id}`,
    messageId: job.msg.key.id,
    receivedAt: new Date(Number(job.msg.messageTimestamp || 0) * 1000 || Date.now()).toISOString(),
    sender,
    originalName: job.media.fileName,
    mimeType: job.media.mimeType,
    caption: job.media.caption,
    bucket: "unmatched",
    filePath: null,
    reference: null,
    extracted: salvaged,
    aiStatus: "error",
    aiMessage: err.message,
  });
}

/**
 * Move a staged vendor document into the folder our matching document
 * was just filed into, and mark it consumed so it drops out of staging.
 *
 * The filename still runs through planFiling (so a vendor tax invoice
 * and a bilty keep their own naming rules), but the FOLDER is forced to
 * match ours exactly — recomputing it from the vendor doc's own fields
 * risks landing one folder level off from our document (a slightly
 * different client spelling, a different date) and splitting one supply
 * across two places, which is the exact problem staging exists to avoid.
 */
/**
 * First run: nothing selected means nothing is processed — the screen says
 * "automatic processing is paused" and documents simply pile up in the
 * phone. The SOP says supply documents always arrive in the SALES group(s),
 * so when no chat has been chosen yet, every group whose name contains
 * "sales" is selected automatically. It only ever fills an EMPTY
 * selection; once anyone picks chats by hand, this never runs again.
 */
function autoSelectSalesGroups() {
  try {
    const cfg = settings();
    if (cfg.watchAllChats || cfg.allowedChats.length > 0) return;
    // Supply documents are posted in the SALES or SUPPLY group(s) — the
    // business calls it both. Only matching "sales" left a group named
    // "Biome Supply" unwatched, and with nothing watched nothing was ever
    // saved, with no error anywhere. If no group name matches, every
    // GROUP is watched (never personal chats) so documents are not lost;
    // the selection can be narrowed in WhatsApp → Chats at any time.
    const groups = [...knownChats.values()].filter((c) => c.isGroup);
    const named = groups
      .filter((c) => /sales?|supply|supplies|dispatch|document|docs|coordination|logistic|सेल्स|सप्लाई/i.test(String(c.name || "")))
      .map((c) => c.jid);
    const sales = named.length ? named : groups.map((c) => c.jid);
    if (!sales.length) {
      log("no chat selected and no WhatsApp group found yet — choose the supply group in WhatsApp → Chats");
      return;
    }
    if (!named.length) log("no group named sales/supply — watching every group until one is chosen in WhatsApp → Chats");
    const current = readJsonSafe(PATHS.settingsFile, {});
    fs.writeFileSync(
      PATHS.settingsFile,
      JSON.stringify({ ...current, allowedChats: sales, autoSelectedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
    log(`auto-selected ${sales.length} sales group(s): ${sales.map((j) => knownChats.get(j)?.name || j).join(", ")}`);
  } catch (err) {
    log(`auto-select of sales groups failed: ${err.message}`);
  }
}

/**
 * Flush the staging backlog.
 *
 * Staged vendor paperwork is released when OUR document for that supply
 * arrives. If our document arrived while the agent was off — or before
 * the matcher understood that vendor's layout — the staged paper sits
 * there forever, which is what "31 documents waiting to match" means.
 * This walks every filed document of ours and offers it to staging again.
 * It is safe to run repeatedly: markConsumed() removes anything matched.
 */
function sweepStaged({ limit = 500, logFn = log } = {}) {
  const opts = { companyCodes: settings().companyCodes, vendorCodes: vendors().map((v) => v.code) };
  const ours = store
    .all()
    .filter((r) => r.bucket === "filed" && r.reference && r.reference.canonical && r.filePath)
    .slice(-limit);

  let promoted = 0, examined = 0;
  for (const rec of ours) {
    const pendingNow = staging.pending();
    if (!pendingNow.length) break;
    const reference = parseReference(rec.reference.canonical, opts);
    if (!reference) continue;
    examined += 1;
    const targetDir = path.dirname(rec.filePath);
    const supplyType = reference.plantCode ? "manufacturing" : "trading";
    let matches = [];
    try {
      matches = staging.findMatches({ reference, extracted: rec.extracted, vendors: vendors(), plantAdjustmentKg: 0 });
    } catch { continue; }
    for (const m of matches) {
      const done = promoteStagedVendorDoc(m.entry, reference, targetDir, supplyType, logFn);
      if (done) promoted += 1;
    }
  }
  // Coordination trips are anchors too. A trip saved with its reference
  // (or with our doc no + vendor code + vendor doc no) says outright which
  // supply a vendor paper belongs to — the vendor paper must not wait for
  // our invoice to come through WhatsApp as well.
  let fromTrips = 0;
  try {
    for (const anchor of coordinationAnchors(opts)) {
      if (!staging.pending().length) break;
      let matches = [];
      try {
        matches = staging.findMatches({ reference: anchor.reference, extracted: anchor.extracted, vendors: vendors(), plantAdjustmentKg: 0 });
      } catch { continue; }
      if (!matches.length) continue;
      const plan = planFiling({
        reference: anchor.reference,
        supplyType: anchor.reference.plantCode ? "manufacturing" : "trading",
        extracted: { ...anchor.extracted, documentType: "biome_tax_invoice" },
        originalName: "anchor.pdf",
        mimeType: "application/pdf",
        receivedAt: new Date(anchor.extracted.documentDate || Date.now()),
        senderName: "Coordination",
      });
      for (const m of matches) {
        const done = promoteStagedVendorDoc(m.entry, anchor.reference, plan.dir, anchor.reference.plantCode ? "manufacturing" : "trading", logFn);
        if (done) { promoted += 1; fromTrips += 1; }
      }
    }
  } catch (err) {
    logFn(`coordination anchors skipped: ${err.message}`);
  }
  logFn(`staging sweep: ${promoted} document(s) filed (${fromTrips} via coordination trips) from ${examined} of our references; ${staging.pending().length} still waiting`);
  return { promoted, examined, fromTrips, stillWaiting: staging.pending().length };
}

/**
 * Coordination trips as matching anchors: the reference the coordinator
 * typed, or one composed from the trip (company / our doc / vendor code /
 * vendor doc), plus the trip's client, date, vehicle and weight.
 */
function coordinationAnchors(opts) {
  const f = readJsonSafe(path.join(PATHS.root, "coordination", "trips.json"), { trips: [] });
  const tail = (v) => { const m = String(v || "").toUpperCase().match(/(\d+)\s*$/); return m ? String(Number(m[1])) : ""; };
  const out = [];
  for (const t of Array.isArray(f.trips) ? f.trips : []) {
    if (t.status === "cancelled") continue;
    let text = String(t.referenceNo || "").trim();
    if (!text) {
      const our = tail(t.ourDocNo);
      const code = String(t.supplierCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const vend = tail(t.vendorInvoiceNo || t.vendorChallanNo);
      if (t.business === "trading" && our && code && vend) text = `${(opts.companyCodes || ["BDC"])[0]}/${our}/${code}/${vend}`;
    }
    if (!text) continue;
    const reference = parseReference(text, { ...opts, vendorCodes: [...(opts.vendorCodes || []), String(t.supplierCode || "").toUpperCase()] });
    if (!reference) continue;
    out.push({
      tripId: t.id,
      reference,
      extracted: {
        clientName: t.client || null,
        documentDate: t.ourDocDate || t.vehicleEntryDate || null,
        vehicleNo: t.vehicleNumber || null,
        biomeDocNo: t.ourDocNo || null,
        quantityKg: Number(t.vendorChallanWeight) || null,
        netWeight: Number(t.vendorChallanWeight) || null,
      },
    });
  }
  return out;
}

function promoteStagedVendorDoc(entry, reference, targetDir, supplyType, logFn = log) {
  try {
    const sourcePath = entry.filePath;
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      logFn(`could not bring in staged document ${entry.id}: its file is no longer in staging`);
      return null;
    }
    const namePlan = planFiling({
      reference,
      supplyType,
      extracted: entry.extracted,
      originalName: entry.fileName,
      mimeType: entry.mimeType,
      receivedAt: new Date(entry.receivedAt),
      senderName: entry.sender?.name || entry.sender?.chatJid || "Vendor",
    });
    const plan = { ...namePlan, dir: targetDir, bucket: "filed" };
    const buffer = fs.readFileSync(sourcePath);
    log(`[4/6] filing into: ${plan.bucket} — ${plan.dir.replace(PATHS.inbox, "…")}`);
  const saved = saveFile(plan, buffer);
  log(`[5/6] SAVED: ${path.relative(PATHS.inbox, saved.filePath)}`);

    // Remove the staging copy only once the filed copy is safely written.
    try {
      fs.unlinkSync(sourcePath);
      const dir = path.dirname(sourcePath);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* a stray staging copy is harmless once the filed copy exists */
    }

    staging.markConsumed(entry.id, reference.canonical, saved.filePath);
    store.update(entry.id, {
      bucket: "filed",
      filePath: saved.filePath,
      relativePath: path.relative(PATHS.inbox, saved.filePath),
      sha256: saved.sha256,
      reference: {
        canonical: reference.canonical,
        companyCode: reference.companyCode,
        biomeDocNo: reference.biomeDocNo,
        vendorCode: reference.vendorCode,
        vendorDocNo: reference.vendorDocNo,
      },
    });
    logFn(
      `matched staged "${entry.fileName}" to ${reference.canonical} -> ${path.relative(
        PATHS.inbox,
        saved.filePath
      )}`
    );
    return saved;
  } catch (err) {
    logFn(`could not bring in staged document ${entry.id}: ${err.message}`);
    return null;
  }
}

async function handleMedia(msg, media) {
  const receivedAt = new Date(
    Number(msg.messageTimestamp || 0) * 1000 || Date.now()
  );
  const sender = senderOf(msg);
  log(`incoming ${media.kind} "${media.fileName}" from ${sender.name || sender.chatJid}`);

  // 1. Download from WhatsApp's media servers.
  // WhatsApp expires media on its servers after a while, so a document
  // from an old chat may no longer be downloadable at all. That is a
  // limitation of the platform, not a failure worth hiding — record it
  // against the document so it's visible rather than silently absent.
  let buffer;
  try {
    buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
    );
  } catch (err) {
    log(`could not download "${media.fileName}": ${err.message}`);
    store.append({
      id: `doc-${msg.key.id}`,
      messageId: msg.key.id,
      receivedAt: receivedAt.toISOString(),
      sender,
      originalName: media.fileName,
      mimeType: media.mimeType,
      bucket: "unmatched",
      filePath: null,
      reference: null,
      extracted: (() => {
        try {
          const h = parseFileName(media.fileName, {
            vendors: vendors(),
            companyCodes: settings().companyCodes,
          });
          return h.typeHint || h.biomeDocNo
            ? applyFileNameHints(
                { documentType: "other", confidence: 0, transcription: "", engine: "filename-only" },
                h
              )
            : null;
        } catch {
          return null;
        }
      })(),
      aiStatus: "error",
      aiMessage:
        "WhatsApp could not send this file. Media from older chats often expires on their " +
        "servers — forward the document into the group again to bring it in.",
    });
    if (backfill.active) backfill.expired = (backfill.expired || 0) + 1;
    return null;
  }

  // ---- Duplicate check, before any reading happens ----
  //
  // These groups forward the same invoice several times a day. Hashing
  // the bytes catches every copy, whoever sent it and whatever they
  // named it — message ids don't, because each forward is a new message.
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const alreadyHave = store.findByHash(sha256);
  if (alreadyHave) {
    log(`skipped "${media.fileName}" — same file already handled as ${alreadyHave.originalName}`);
    return store.append({
      id: `doc-${msg.key.id}`,
      messageId: msg.key.id,
      receivedAt: receivedAt.toISOString(),
      sender,
      originalName: media.fileName,
      mimeType: media.mimeType,
      sizeBytes: buffer.length,
      sha256,
      bucket: "_Duplicate",
      filePath: null,
      duplicateOf: alreadyHave.id,
      duplicateOfPath: alreadyHave.relativePath || null,
      reference: alreadyHave.reference || null,
      extracted: null,
      aiStatus: "skipped",
      aiMessage: `Identical to "${alreadyHave.originalName}" received earlier.`,
    });
  }

  // 2. Read it, giving the AI the surrounding chat as context — the
  //    "documents for JPL" line that names the client the papers belong to.
  const vendorList = vendors();
  const cfg = settings();
  const chatContext = recentChatContext(sender.chatJid);
  log(`[1/6] read "${media.fileName}" (${(buffer.length / 1024).toFixed(0)} KB) from ${sender.name || "unknown"}`);

  const ai = await classifyDocument(buffer, media.mimeType, {
    geminiKey: process.env.GEMINI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
    clients: loadClients().map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
    chatContext,
    caption: media.caption,
    fileName: media.fileName,
    senderName: sender.name || null,
  });

  const extracted = ai.ok ? ai.data : null;

  // 2b. Has a person already TAUGHT us what this shape of document is?
  // Corrections outrank the classifier: a coordinator posts the same
  // document shapes to the same group month after month, and a human
  // saying "this is a weight slip" once should mean it stays one. The
  // learned type overrides when the rule is strong, and fills the gap
  // whenever the classifier came back empty or "other".
  const taught = learning.learnedType({ fileName: media.fileName, chatJid: sender.chatJid });
  if (taught && extracted) {
    const weak = !extracted.documentType || extracted.documentType === "other";
    if (taught.strong || weak) {
      if (extracted.documentType !== taught.documentType) {
        log(
          `learned rule ${taught.ruleId} says "${media.fileName}" is ${taught.documentType}` +
            (weak ? " (classifier had nothing better)" : ` (overriding ${extracted.documentType})`)
        );
      }
      extracted.documentType = taught.documentType;
      extracted.learnedRuleId = taught.ruleId;
    }
  }
  // A client/vendor spelling someone already mapped resolves instantly.
  if (extracted?.clientName) {
    const alias = learning.learnedName(extracted.clientName);
    if (alias?.clientName && alias.clientName !== extracted.clientName) {
      log(`learned alias: "${extracted.clientName}" → ${alias.clientName}`);
      extracted.clientName = alias.clientName;
    }
  }

  // 3. Find the coordination reference. Prefer what the AI reported; fall
  //    back to scanning the full transcription, which catches the cases
  //    where the reference box was cropped out of the AI's field summary.
  const opts = {
    companyCodes: cfg.companyCodes,
    vendorCodes: vendorList.map((v) => v.code),
    plantCodes: loadPlants().map((p) => p.code),
  };
  const replyTo = quotedMessageId(msg);
  let reference =
    (extracted?.referenceNo ? parseReference(extracted.referenceNo, opts) : null) ||
    (extracted?.transcription ? parseReference(extracted.transcription, opts) : null) ||
    (media.caption ? parseReference(media.caption, opts) : null) ||
    (chatContext ? parseReference(chatContext, opts) : null);

  // Nothing printed on the page? If this was sent as a reply to a document
  // we've already filed, the sender was tagging it onto that supply.
  let inheritedFrom = null;
  if (!reference && replyTo) {
    const quoted = store.all().find((d) => d.messageId === replyTo);
    if (quoted?.reference) {
      reference = { ...quoted.reference, score: quoted.reference.confidence ?? 0 };
      inheritedFrom = quoted.id;
      log(`inherited ${reference.canonical} from the message this replied to`);
    }
  }

  // ---- 3a. Shared vendor code (e.g. SGE used by three vendors) ----
  // The reference alone cannot say which one; the document's own text
  // usually can. Whichever vendor's name/alias appears on the page wins;
  // if none does, the set is flagged so a person confirms the vendor.
  if (reference?.vendorCode && extracted) {
    const shared = resolveSharedVendorCode(reference.vendorCode, extracted, vendorList);
    if (shared) {
      extracted.vendorName = shared.name || extracted.vendorName || null;
      extracted.vendorAmbiguous = shared.ambiguous ? shared.candidates : null;
      if (shared.ambiguous) log(`vendor code ${reference.vendorCode} is shared by ${shared.candidates.join(" / ")} — none named on the page; flagged for review`);
    }
  }

  // ---- 3b. Logical duplicate: same document, different bytes ----
  // A merged PDF's page and the single file sent later hash differently
  // but ARE the same invoice. Treating each as new is how one document
  // got counted two or three times. The document's own number decides.
  const logicalDup = store.findLogicalDuplicate(extracted?.documentType, extracted);
  if (logicalDup && !inheritedFrom) {
    log(`duplicate by identity — "${media.fileName}" is the same ${extracted?.documentType} as ${logicalDup.originalName}`);
    return store.append({
      id: `doc-${msg.key.id}`, messageId: msg.key.id, receivedAt: receivedAt.toISOString(), sender,
      originalName: media.fileName, mimeType: media.mimeType, sizeBytes: buffer.length, sha256,
      bucket: "_Duplicate", filePath: null, duplicateOf: logicalDup.id, duplicateOfPath: logicalDup.relativePath || null,
      reference: logicalDup.reference || reference || null, extracted,
      aiStatus: "skipped", aiMessage: `Same ${extracted?.documentType} as "${logicalDup.originalName}" (same document number) — not filed twice.`,
    });
  }

  // ---- 4. Decide: hold it, or file it and pull the set together ----
  //
  // Vendor paperwork is READ but not filed. On its own it can't say
  // which of our supplies it belongs to, and filing on a guess puts it
  // in the wrong client folder under the wrong reference. It waits in
  // staging until our own document names the supply.
  log(`[3/6] reference: ${reference ? reference.canonical : "none on this page"}`);

  const docType = extracted?.documentType || null;
  const isOurs =
    docType === "biome_tax_invoice" ||
    docType === "biome_delivery_challan" ||
    docType === "biome_eway_bill";

  // CLIENT RECEIVING: match by vehicle + client within 0..3 days and use
  // FIFO when the same truck has more than one supply in the window. A
  // receiving is a real supply document, so once matched it is filed into
  // that supply folder instead of being held with vendor paperwork.
  if (docType === "receiving") {
    let suggestion = null;
    try { suggestion = store.suggestReference(extracted); } catch {}
    const minimum = 85;
    if (suggestion && suggestion.confidence >= minimum) {
      const recRef = parseReference(suggestion.reference, opts);
      const plan = planFiling({
        reference: recRef,
        supplyType: recRef?.plantCode ? "manufacturing" : "trading",
        extracted,
        originalName: media.fileName,
        mimeType: media.mimeType,
        receivedAt,
        senderName: sender.name || sender.chatJid,
        anchorDate: suggestion.date || extracted?.documentDate || null,
      });
      const saved = saveFile(plan, buffer);
      const record = store.append({
        id: `doc-${msg.key.id}`, messageId: msg.key.id, receivedAt: receivedAt.toISOString(),
        sender, originalName: media.fileName, mimeType: media.mimeType, sizeBytes: buffer.length,
        sha256, caption: media.caption, bucket: "filed", filePath: saved.filePath,
        relativePath: path.relative(PATHS.inbox, saved.filePath),
        reference: recRef ? { canonical: recRef.canonical, companyCode: recRef.companyCode, biomeDocNo: recRef.biomeDocNo, vendorCode: recRef.vendorCode, vendorDocNo: recRef.vendorDocNo } : null,
        extracted, aiStatus: ai.ok ? "ok" : "skipped", aiMessage: ai.ok ? null : ai.message,
        autoFiled: true, autoFiledConfidence: suggestion.confidence, autoFiledReasons: suggestion.reasons,
      });
      log(`receiving matched FIFO to ${suggestion.reference} (${suggestion.confidence}%) -> ${path.relative(PATHS.inbox, saved.filePath)}`);
      return record;
    }
    // No safe match: put it in Review Queue, never into a guessed supply.
    const plan = planFiling({ reference: null, extracted, originalName: media.fileName, mimeType: media.mimeType, receivedAt, senderName: sender.name || sender.chatJid });
    const saved = saveFile(plan, buffer);
    return store.append({
      id: `doc-${msg.key.id}`, messageId: msg.key.id, receivedAt: receivedAt.toISOString(), sender,
      originalName: media.fileName, mimeType: media.mimeType, sizeBytes: buffer.length, sha256, caption: media.caption,
      bucket: "unmatched", filePath: saved.filePath, relativePath: path.relative(PATHS.inbox, saved.filePath),
      reference: null, extracted, aiStatus: ai.ok ? "ok" : "skipped", aiMessage: ai.ok ? null : ai.message,
      reviewRequired: true, reviewReason: suggestion ? `Receiving match confidence ${suggestion.confidence}% below ${minimum}%: ${(suggestion.reasons || []).join("; ")}` : "No safe vehicle/client/date match found.",
    });
  }

  // CLIENT LAB REPORT: never attach to one supply. The filing engine creates
  // Month -> Client -> first sample date To last sample date.
  if (docType === "lab_report") {
    const plan = planFiling({ reference: null, extracted, originalName: media.fileName, mimeType: media.mimeType, receivedAt, senderName: sender.name || sender.chatJid });
    const saved = saveFile(plan, buffer);
    return store.append({
      id: `doc-${msg.key.id}`, messageId: msg.key.id, receivedAt: receivedAt.toISOString(), sender,
      originalName: media.fileName, mimeType: media.mimeType, sizeBytes: buffer.length, sha256, caption: media.caption,
      bucket: "filed", filePath: saved.filePath, relativePath: path.relative(PATHS.inbox, saved.filePath),
      reference: null, extracted, aiStatus: ai.ok ? "ok" : "skipped", aiMessage: ai.ok ? null : ai.message,
      standalone: true, labReport: true,
    });
  }

  // A vendor paper that names a supply whose OWN document is already filed
  // goes straight into that supply's folder. The SOP is explicit: vendor
  // paperwork is read, not filed on its own — the folder is Month → Client
  // → OUR document date → Reference, and only our invoice/challan knows
  // those. So we never build the path from the vendor paper's fields (its
  // buyer is Biome and its date is the vendor's); we reuse the folder our
  // document already sits in. If ours has not arrived yet, the paper is
  // held below and released the moment it does (or by the sweep).
  if (!isOurs && reference && reference.canonical) {
    const ourFiled = store.all().find((r) =>
      r.bucket === "filed" && r.filePath && r.reference && r.reference.canonical === reference.canonical &&
      ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(r.extracted?.documentType)
    );
    if (ourFiled) {
      const targetDir = path.dirname(ourFiled.filePath);
      const namePlan = planFiling({
        reference,
        supplyType: reference.plantCode ? "manufacturing" : "trading",
        extracted,
        originalName: media.fileName,
        mimeType: media.mimeType,
        receivedAt,
        senderName: sender.name || sender.chatJid,
      });
      const saved = saveFile({ ...namePlan, dir: targetDir, bucket: "filed" }, buffer);
      const record = store.append({
        id: `doc-${msg.key.id}`, messageId: msg.key.id, receivedAt: receivedAt.toISOString(), sender,
        originalName: media.fileName, mimeType: media.mimeType, sizeBytes: buffer.length, sha256,
        caption: media.caption, bucket: "filed", filePath: saved.filePath,
        relativePath: path.relative(PATHS.inbox, saved.filePath),
        reference: {
          canonical: reference.canonical, companyCode: reference.companyCode,
          biomeDocNo: reference.biomeDocNo, vendorCode: reference.vendorCode,
          vendorDocNo: reference.vendorDocNo,
        },
        extracted, aiStatus: ai.ok ? "ok" : "skipped", aiMessage: ai.ok ? null : ai.message,
        autoFiled: true, autoFiledConfidence: 95,
        autoFiledReasons: [`Names ${reference.canonical}; our document for it is already filed — placed beside it`],
        replyToMessageId: quotedMessageId(msg),
      });
      log(`vendor ${docType || "document"} for ${reference.canonical} joined its supply -> ${path.relative(PATHS.inbox, saved.filePath)}`);
      return record;
    }
  }

  if (!isOurs) {
    const stagedId = `doc-${msg.key.id}`;
    staging.stage({
      id: stagedId,
      messageId: msg.key.id,
      buffer,
      fileName: media.fileName,
      mimeType: media.mimeType,
      receivedAt,
      sender,
      extracted,
      caption: media.caption,
    });

    const held = store.append({
      id: stagedId,
      messageId: msg.key.id,
      receivedAt: receivedAt.toISOString(),
      sender,
      originalName: media.fileName,
      mimeType: media.mimeType,
      sizeBytes: buffer.length,
      sha256,
      caption: media.caption,
      bucket: "_Staged",
      filePath: null,
      relativePath: null,
      reference: null,
      extracted,
      aiStatus: ai.ok ? "ok" : "skipped",
      aiMessage: ai.ok ? null : ai.message,
      replyToMessageId: quotedMessageId(msg),
    });

    if (docType && docType !== "other") {
      patterns.learn({
        fileName: media.fileName,
        senderName: sender.name,
        documentType: docType,
        vendorName: extracted?.vendorName,
        transcription: extracted?.transcription,
        pageCount: extracted?.pageCount,
      });
    }

    log(
      `held ${DOC_TYPE_LABEL[docType] || "document"} "${media.fileName}" ` +
        `(vehicle ${extracted?.vehicleNo || "?"}) — waiting for our invoice`
    );
    return held;
  }

  // ---- Ours. File it, then bring in everything it matches. ----
  //
  // Manufacturing supplies have no vendor and no coordination reference,
  // so they must not be filed as though a vendor invoice were merely
  // late — it is never coming.
  const supply = verify.detectSupplyType(
    [extracted, ...staging.pending().map((e) => e.extracted).filter(Boolean)],
    reference
  );

  const anchorDate = reference ? anchorDateFor(reference.canonical) : null;
  const plan = planFiling({
    reference,
    supplyType: supply.type,
    extracted,
    originalName: media.fileName,
    mimeType: media.mimeType,
    receivedAt,
    senderName: sender.name || sender.chatJid,
    anchorDate,
  });
  const saved = saveFile(plan, buffer);

  if (reference?.likelyTypo) log(`NOTE: ${reference.typoNote}`);

  // This document's own ledger row was never being written here — every
  // one of our tax invoices/challans/e-way bills threw "record is not
  // defined" right after saving, before it could be indexed. The file
  // landed on disk correctly, which is why it looked like nothing was
  // wrong until you tried to look the document up by reference or open
  // a vendor document that was waiting on it.
  const record = store.append({
    id: `doc-${msg.key.id}`,
    messageId: msg.key.id,
    receivedAt: receivedAt.toISOString(),
    sender,
    originalName: media.fileName,
    mimeType: media.mimeType,
    sizeBytes: buffer.length,
    sha256: saved.sha256,
    caption: media.caption,
    bucket: plan.bucket,
    filePath: saved.filePath,
    relativePath: path.relative(PATHS.inbox, saved.filePath),
    reference: reference
      ? {
          canonical: reference.canonical,
          companyCode: reference.companyCode,
          biomeDocNo: reference.biomeDocNo,
          vendorCode: reference.vendorCode,
          vendorDocNo: reference.vendorDocNo,
        }
      : null,
    extracted,
    aiStatus: ai.ok ? "ok" : "skipped",
    aiMessage: ai.ok ? null : ai.message,
    replyToMessageId: replyTo,
    inheritedReferenceFrom: inheritedFrom,
  });

  log(
    `filed as ${extracted ? DOC_TYPE_LABEL[extracted.documentType] : "unreviewed"} -> ${path.relative(
      PATHS.inbox,
      saved.filePath
    )}`
  );

  // ---- Bring in every staged vendor document this reference explains ----
  //
  // This is the other half of "hold vendor paperwork until our invoice
  // arrives": staging.findMatches() and staging.markConsumed() already
  // existed to do exactly this, but nothing was ever calling them — so
  // vendor documents read correctly, sat in staging correctly, and then
  // just stayed there forever. This is what actually reads your invoice's
  // reference number (e.g. BDC/871/AT/338) and pulls in the vendor's
  // paperwork it names, matching on vehicle number and weight as a check.
  if (reference) {
    // On a manufacturing reference, the third segment names OUR plant,
    // not a vendor — Gangakhed's paperwork is deliberately raised
    // 400-500 kg over the weighbridge figure, so its tolerance needs
    // that adjustment folded in or every single GKD supply reads as a
    // quantity mismatch. plantAdjustmentKg was defined in masterData and
    // read by scoreMatch, but nothing ever actually passed it in — so
    // the adjustment silently never applied.
    let plantAdjustmentKg = 0;
    if (reference.plantCode) {
      const plant = loadPlants().find(
        (p) => String(p.code || "").toUpperCase() === reference.plantCode
      );
      plantAdjustmentKg = Number(plant?.weightAdjustmentKg) || 0;
    }
    const vendorMatches = staging.findMatches({ reference, extracted, vendors: vendorList, plantAdjustmentKg });

    // A reply is a deliberate pairing by a person — trust it outright even
    // if field-matching alone wouldn't have cleared the score threshold.
    if (replyTo) {
      const repliedEntry = staging.findByMessageId(replyTo);
      if (repliedEntry && !vendorMatches.some((m) => m.entry.id === repliedEntry.id)) {
        vendorMatches.unshift({
          entry: repliedEntry,
          score: 100,
          reasons: ["this invoice was sent as a reply to that document"],
        });
      }
    }

    for (const match of vendorMatches) {
      promoteStagedVendorDoc(match.entry, reference, plan.dir, supply.type);
    }
    if (vendorMatches.length) {
      log(`matched ${vendorMatches.length} staged document(s) to ${reference.canonical}`);
    }

    // Pull any of our own previously-filed papers for this reference onto
    // this same folder too, in case one landed before this anchor date
    // was known.
    reanchorReference(reference.canonical, extracted?.documentDate || anchorDate, log);
  }

  // Our own invoice has just introduced a new reference, so documents
  // that arrived before it can now be placed.
  if (record.reference) {
    for (const other of store.all()) {
      if (other.reference || !other.extracted || other.id === record.id) continue;
      autoFileFromSuggestion(other.id, other.extracted);
    }
  }

  return record;
}

/** Re-run AI + filing on an already-downloaded file (used by the UI's
 *  "Re-scan" button after an API key is added or a vendor code is registered). */
/**
 * Find a document's bytes wherever they actually live.
 *
 * A staged vendor document has no `filePath` on its ledger row — its
 * file sits in the staging area under the staging index instead. Looking
 * only at `filePath` made Re-scan fail on every held document with
 * "the saved file is missing", which was wrong: the file was there all
 * along, just somewhere else.
 */
function locateFile(rec) {
  if (rec.filePath && fs.existsSync(rec.filePath)) return rec.filePath;

  const staged = staging.pending().find((e) => e.id === rec.id);
  if (staged?.filePath && fs.existsSync(staged.filePath)) return staged.filePath;

  return null;
}

async function reprocess(id) {
  const rec = store.byId(id);
  if (!rec) throw new Error("That document is not in the ledger.");

  const sourcePath = locateFile(rec);
  if (!sourcePath) {
    throw new Error(
      rec.bucket === "_Staged"
        ? "This document is being held but its file is no longer on disk — it may have been cleared from staging."
        : "The saved file is missing from disk — it may have been moved or deleted."
    );
  }

  const buffer = fs.readFileSync(sourcePath);
  const vendorList = vendors();
  const cfg = settings();
  const ai = await classifyDocument(buffer, rec.mimeType, {
    geminiKey: process.env.GEMINI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
  });
  if (!ai.ok) throw new Error(ai.message);

  const opts = { companyCodes: cfg.companyCodes, vendorCodes: vendorList.map((v) => v.code) };
  const reference =
    (ai.data.referenceNo ? parseReference(ai.data.referenceNo, opts) : null) ||
    (ai.data.transcription ? parseReference(ai.data.transcription, opts) : null) ||
    (rec.caption ? parseReference(rec.caption, opts) : null);

  const plan = planFiling({
    reference,
    extracted: ai.data,
    originalName: rec.originalName,
    mimeType: rec.mimeType,
    receivedAt: new Date(rec.receivedAt),
    senderName: rec.sender?.name || rec.sender?.chatJid || "Unknown",
  });
  const saved = saveFile(plan, buffer);

  // Remove the old copy only once the new one is safely written, and only
  // if it genuinely moved.
  if (saved.filePath !== rec.filePath) {
    try {
      fs.unlinkSync(rec.filePath);
    } catch {
      /* leaving a stray copy is better than throwing away the document */
    }
  }

  return store.update(id, {
    bucket: plan.bucket,
    filePath: saved.filePath,
    relativePath: path.relative(PATHS.inbox, saved.filePath),
    sha256: saved.sha256,
    referenceTypoNote: reference?.typoNote || null,
    reference: reference
      ? {
          canonical: reference.canonical,
          companyCode: reference.companyCode,
          biomeDocNo: reference.biomeDocNo,
          vendorCode: reference.vendorCode,
          vendorDocNo: reference.vendorDocNo,
          confidence: reference.score,
        }
      : null,
    extracted: ai.data,
    aiStatus: "ok",
    aiMessage: null,
  });
}

// ---------------------------------------------------------------------
// Local HTTP control API
// ---------------------------------------------------------------------
const TOKEN = crypto.randomBytes(24).toString("hex");

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // Phone PDFs of 5-10 MB are normal; as base64 they are a third larger.
      if (size > 40 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Request body was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const route = url.pathname.replace(/\/+$/, "") || "/";

  if (route === "/health") return json(res, 200, { ok: true, startedAt: state.startedAt });

  const provided = req.headers["x-agent-token"];
  if (provided !== TOKEN) return json(res, 401, { error: "Invalid or missing agent token." });

  try {
    if (route === "/status" && req.method === "GET") {
      return json(res, 200, {
        ...state,
        hasAiKey: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
        dataRoot: PATHS.root,
        inbox: PATHS.inbox,
        backfill,
        staging: staging.stats(),
        build: BUILD,
        stats: store.stats(),
      });
    }

    if (route === "/connect" && req.method === "POST") {
      connect().catch((err) => setStatus("error", { lastError: err.message }));
      return json(res, 200, { ok: true });
    }

    if (route === "/disconnect" && req.method === "POST") {
      const body = await readBody(req);
      await disconnect({ forget: body.forget === true });
      return json(res, 200, { ok: true });
    }

    if (route === "/undo-auto-file" && req.method === "POST") {
      // Put an auto-filed document back in the queue. One click, because
      // an automatic decision that is hard to reverse is not safe to make.
      const body = await readBody(req);
      const rec = body.id ? store.byId(body.id) : null;
      if (!rec) return json(res, 404, { error: "Document not found." });
      store.update(rec.id, {
        reference: null,
        autoFiled: false,
        autoFileUndone: true,
        autoFileUndoneAt: new Date().toISOString(),
      });
      log(`auto-filing undone for ${rec.originalName}`);
      return json(res, 200, { ok: true });
    }

    if (route === "/suggest-reference" && req.method === "GET") {
      // Which supply does this document belong to? Answered from the
      // invoices already filed, so the person doesn't have to look it up.
      const id = url.searchParams.get("id");
      const rec = id ? store.byId(id) : null;
      if (!rec) return json(res, 404, { error: "Document not found." });
      const suggestion = store.suggestReference(rec.extracted);
      return json(res, 200, { suggestion });
    }

    if (route === "/documents" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
      const bucket = url.searchParams.get("bucket");
      let docs = store.all();
      if (bucket) docs = docs.filter((d) => d.bucket === bucket);
      return json(res, 200, { documents: docs.slice(0, limit), total: docs.length });
    }

    if (route === "/sets" && req.method === "GET") {
      return json(res, 200, store.supplySets());
    }

    if (route === "/backfill" && req.method === "POST") {
      const body = await readBody(req);
      backfill.fromDate = body.fromDate || null;
      backfill.toDate = body.toDate || null;
      backfill.seen = 0;
      backfill.queued = 0;
      backfill.skippedOutOfRange = 0;
      backfill.startedAt = new Date().toISOString();
      backfill.finishedAt = null;
      backfill.active = true;
      backfill.startedFrom = "requested";
      backfill.note =
        "WhatsApp only shares the history the linked phone still holds, so how far back this reaches depends on that phone. Anything it does send within your date range is read and filed.";

      // WhatsApp pushes history when a device is FIRST linked. Asking an
      // already-linked session to replay it often returns nothing at all,
      // and the scan then sits at zero looking frozen. Give it a window,
      // then say so plainly instead of spinning.
      clearTimeout(backfillTimeout);
      backfillTimeout = setTimeout(() => {
        if (backfill.active && backfill.seen === 0) {
          backfill.active = false;
          backfill.finishedAt = new Date().toISOString();
          backfill.note =
            "WhatsApp sent no history. It normally only replays past messages when a device is linked for the FIRST time — for an already-linked account there is usually nothing to replay. To pull in old documents, either unlink and scan the QR code again, or forward the documents you need into the group.";
          log("history scan returned nothing — WhatsApp did not replay any messages");
        }
      }, 90000);

      // History sync is negotiated at connection time, so reconnect.
      log(`historical scan requested: ${backfill.fromDate || "any"} to ${backfill.toDate || "any"}`);
      try {
        if (sock) {
          intentionalLogout = false;
          sock.end(undefined);
          sock = null;
        }
      } catch {
        /* it may already be closed */
      }
      setTimeout(() => {
        connect().catch((err) => setStatus("error", { lastError: err.message }));
      }, 800);

      return json(res, 200, { ok: true, backfill });
    }

    if (route === "/backfill" && req.method === "GET") {
      return json(res, 200, { backfill });
    }

    if (route === "/backfill/stop" && req.method === "POST") {
      // A scan that finds nothing otherwise sits on "Scanning…" forever,
      // with no way out short of restarting the app.
      backfill.active = false;
      backfill.finishedAt = new Date().toISOString();
      backfill.note = "Stopped.";
      log("historical scan stopped by the user");
      return json(res, 200, { ok: true, backfill });
    }

    if (route === "/classify" && req.method === "POST") {
      // A human telling us what the AI couldn't read. Their answer is
      // authoritative — we file on it without second-guessing.
      const body = await readBody(req);
      const rec = body.id ? store.byId(body.id) : null;
      if (!rec) return json(res, 404, { error: "That document is not in the ledger." });
      const recPath = locateFile(rec);
      if (!recPath) {
        return json(res, 400, { error: "The saved file is missing from disk." });
      }

      const cfg = settings();
      const opts = { companyCodes: cfg.companyCodes, vendorCodes: vendors().map((v) => v.code) };
      const reference = body.referenceNo ? parseReference(body.referenceNo, opts) : rec.reference;
      if (body.referenceNo && !reference) {
        return json(res, 400, {
          error: `"${body.referenceNo}" isn't a readable reference. Use the printed form, e.g. BDC/786/MHI/44.`,
        });
      }

      const extracted = {
        ...(rec.extracted || {}),
        documentType: body.documentType || rec.extracted?.documentType || "other",
        clientName: body.clientName ?? rec.extracted?.clientName ?? null,
        documentDate: body.documentDate ?? rec.extracted?.documentDate ?? null,
        vehicleNo: body.vehicleNo ?? rec.extracted?.vehicleNo ?? null,
        biomeDocNo: body.biomeDocNo ?? rec.extracted?.biomeDocNo ?? null,
        vendorDocNo: body.vendorDocNo ?? rec.extracted?.vendorDocNo ?? null,
        referenceNo: reference ? reference.canonical : rec.extracted?.referenceNo ?? null,
        confidence: 100, // a person said so
      };

      const normalisedRef = reference
        ? {
            canonical: reference.canonical,
            companyCode: reference.companyCode,
            biomeDocNo: reference.biomeDocNo,
            vendorCode: reference.vendorCode,
            vendorDocNo: reference.vendorDocNo,
            confidence: 100,
          }
        : null;

      const anchorDate = normalisedRef ? anchorDateFor(normalisedRef.canonical) : null;
      const plan = planFiling({
        reference: normalisedRef,
        extracted,
        originalName: rec.originalName,
        mimeType: rec.mimeType,
        receivedAt: new Date(rec.receivedAt),
        senderName: rec.sender?.name || rec.sender?.chatJid || "Unknown",
        anchorDate,
      });

      const buffer = fs.readFileSync(recPath);
      const saved = saveFile(plan, buffer);
      if (saved.filePath !== recPath) {
        try {
          fs.unlinkSync(recPath);
        } catch {
          /* a stray copy beats a lost document */
        }
      }

      const updated = store.update(rec.id, {
        bucket: plan.bucket,
        filePath: saved.filePath,
        relativePath: path.relative(PATHS.inbox, saved.filePath),
        reference: normalisedRef,
        extracted,
        aiStatus: "manual",
        aiMessage: null,
        classifiedManuallyAt: new Date().toISOString(),
      });

      // If the person just told us this is OUR invoice, it sets the anchor
      // date for the whole set — pull the rest of the supply in behind it.
      let moved = 0;
      if (
        normalisedRef &&
        extracted.documentDate &&
        (extracted.documentType === "biome_tax_invoice" ||
          extracted.documentType === "biome_delivery_challan")
      ) {
        moved = reanchorReference(normalisedRef.canonical, extracted.documentDate, log);
      }

      // A person just told us the right answer. That is worth far more
      // than anything inferred, so it's recorded with heavy weight and
      // the same mistake shouldn't need correcting twice.
      patterns.learn(
        {
          fileName: rec.originalName,
          senderName: rec.sender?.name,
          documentType: extracted.documentType,
          vendorName: extracted.vendorName,
          clientName: extracted.clientName,
          transcription: rec.extracted?.transcription,
        },
        { corrected: true }
      );

      // And the chat-scoped shape rule: the same coordinator posts the
      // same document shapes to the same group month after month, so a
      // correction here decides the NEXT arrival before OCR even runs.
      learning.recordCorrection({
        fileName: rec.originalName,
        chatJid: rec.sender?.chatJid || null,
        senderJid: rec.sender?.jid || null,
        documentType: extracted.documentType,
        clientName: extracted.clientName || null,
        vendorCode: extracted.vendorCode || null,
        seenName: rec.extracted?.clientName || null,
      });

      return json(res, 200, { document: updated, movedWithIt: moved });
    }

    if (route === "/reanchor" && req.method === "POST") {
      // Manual sweep: re-file every reference onto its anchor date.
      const result = reanchorAll(log);
      return json(res, 200, { ok: true, ...result });
    }

    if (route === "/test" && req.method === "POST") {
      // Run the whole pipeline on one file and report EVERY step —
      // without WhatsApp, without saving anything.
      //
      // This exists because "it doesn't work" is not something anyone can
      // fix. This turns it into "step 3 failed, here is the message",
      // which is.
      const body = await readBody(req);
      if (!body.fileBase64) return json(res, 400, { error: "Send `fileBase64` and `fileName`." });

      const buffer = Buffer.from(body.fileBase64, "base64");
      const fileName = body.fileName || "test.pdf";
      const mimeType =
        body.mimeType ||
        (/\.pdf$/i.test(fileName)
          ? "application/pdf"
          : /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : /\.png$/i.test(fileName)
              ? "image/png"
              : "application/octet-stream");

      const steps = [];
      const step = (name, ok, detail, data) => {
        steps.push({ name, ok, detail, data });
        return ok;
      };

      const vendorList = vendors();
      const clientList = loadClients();
      const cfg = settings();

      step("File received", true, `${fileName} · ${(buffer.length / 1024).toFixed(0)} KB · ${mimeType}`);
      step(
        "Registries loaded",
        true,
        `${vendorList.length} vendor(s), ${clientList.length} client(s)`,
        vendorList.length === 0
          ? { warning: "No vendors registered — vendor codes can't be matched. Add them under Vendors." }
          : undefined
      );

      // ---- Read it ----
      let ai;
      try {
        ai = await classifyDocument(buffer, mimeType, {
          geminiKey: process.env.GEMINI_API_KEY,
          anthropicKey: process.env.ANTHROPIC_API_KEY,
          vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
          clients: clientList.map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
          companyCodes: cfg.companyCodes,
          fileName,
        });
      } catch (err) {
        step("Reading the document", false, err.message);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      if (!ai.ok) {
        step("Reading the document", false, ai.message || ai.reason);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      const ex = ai.data;
      const textLen = (ex.transcription || "").replace(/\s/g, "").length;
      step(
        "Text extracted",
        textLen > 40,
        textLen > 40
          ? `${textLen} characters read via ${ex.readMethod || ai.provider}`
          : `Only ${textLen} characters found — the page may be a scan this reader can't handle.`,
        { sample: (ex.transcription || "").slice(0, 600) }
      );

      step(
        "Document identified",
        ex.documentType !== "other",
        ex.documentType !== "other"
          ? `${DOC_TYPE_LABEL[ex.documentType] || ex.documentType} · ${ex.confidence}% confident`
          : "Could not tell what this document is.",
        {
          type: ex.documentType,
          confidence: ex.confidence,
          containedTypes: ex.containedDocumentTypes || [],
          engine: ai.provider,
          fileNameHints: ex.fileNameHints || [],
          learnedReasons: ex.learnedReasons || [],
        }
      );

      step("Fields extracted", true, "", {
        reference: ex.referenceNo,
        ourDocNo: ex.biomeDocNo,
        vendorDocNo: ex.vendorDocNo,
        vendor: ex.vendorName,
        client: ex.clientName,
        date: ex.documentDate,
        vehicle: ex.vehicleNo,
        grNumber: ex.grNumber,
        quantityKg: ex.quantityKg,
        netWeight: ex.netWeight,
        ewayBill: ex.ewayBillNo,
        amount: ex.totalAmount,
      });

      // ---- Reference ----
      const opts = { companyCodes: cfg.companyCodes, vendorCodes: vendorList.map((v) => v.code) };
      const reference =
        (ex.referenceNo ? parseReference(ex.referenceNo, opts) : null) ||
        (ex.transcription ? parseReference(ex.transcription, opts) : null);

      step(
        "Coordination reference",
        Boolean(reference),
        reference
          ? `${reference.canonical} → our doc ${reference.biomeDocNo}, vendor ${reference.vendorCode} doc ${reference.vendorDocNo}`
          : "None found. Expected only on OUR tax invoice or delivery challan — vendor papers never carry one.",
        reference || undefined
      );

      // ---- Client ----
      const client = matchClient(ex.clientName, clientList);
      step(
        "Client matched",
        Boolean(client),
        client
          ? `${client.name}`
          : ex.clientName
            ? `Read "${ex.clientName}" but no client in the list matches. Add an alias under Clients.`
            : "No consignee found on the page.",
      );

      // ---- Supply type ----
      const supply = verify.detectSupplyType([ex], reference);
      step("Supply type", supply.type !== "unknown", `${supply.type} — ${supply.reason}`);

      // ---- Where it would go ----
      const isOurs = ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(ex.documentType);
      const plan = planFiling({
        reference,
        supplyType: supply.type,
        extracted: ex,
        originalName: fileName,
        mimeType,
        receivedAt: new Date(),
        senderName: "Test",
        anchorDate: ex.documentDate,
      });

      const target = path.relative(PATHS.inbox, path.join(plan.dir, `${plan.baseName}${plan.ext}`));
      if (!isOurs && supply.type === "trading") {
        step(
          "What happens next",
          true,
          `This is a vendor document, so it would be HELD in staging until your invoice arrives. It would then be filed as:\n${target}`,
          { wouldStage: true, targetPath: target }
        );
      } else {
        step("Where it would be saved", plan.bucket === "filed", target, {
          bucket: plan.bucket,
          targetPath: target,
        });
      }

      const failed = steps.filter((s) => !s.ok);
      return json(res, 200, {
        steps,
        verdict: failed.length === 0 ? "ok" : "partial",
        problems: failed.map((f) => `${f.name}: ${f.detail}`),
        extracted: ex,
      });
    }

    if (route === "/chats" && req.method === "GET") {
      const cfg = settings();
      const chats = [...knownChats.values()]
        .sort((a, b) => (b.documentCount || 0) - (a.documentCount || 0) || String(b.lastSeen).localeCompare(String(a.lastSeen)))
        .map((c) => ({
          ...c,
          tracked: cfg.watchAllChats || cfg.allowedChats.includes(c.jid) || cfg.receivingChats.includes(c.jid) || cfg.labChats.includes(c.jid),
          watched: cfg.watchAllChats || cfg.allowedChats.includes(c.jid) || cfg.receivingChats.includes(c.jid) || cfg.labChats.includes(c.jid),
          selected: cfg.allowedChats.includes(c.jid),
          receivingSelected: cfg.receivingChats.includes(c.jid),
          labSelected: cfg.labChats.includes(c.jid),
          learnFrom: (cfg.learnChats || []).includes(c.jid),
        }));
      return json(res, 200, {
        chats,
        // An empty allowlist means "watch everything", which is rarely
        // what someone wants once they have more than a few groups.
        trackingAll: cfg.watchAllChats,
        watchingAll: cfg.watchAllChats,
        allowedChats: cfg.allowedChats,
        receivingChats: cfg.receivingChats,
        labChats: cfg.labChats,
        learnChats: cfg.learnChats || [],
      });
    }

    if (route === "/chats" && req.method === "POST") {
      const body = await readBody(req);
      const allowed = Array.isArray(body.allowedChats)
        ? body.allowedChats.map((j) => String(j).trim()).filter(Boolean)
        : [];
      const watchAll = body.watchAllChats === true;
      const receivingChats = Array.isArray(body.receivingChats)
        ? body.receivingChats.map((j) => String(j).trim()).filter(Boolean)
        : (Array.isArray(settings().receivingChats) ? settings().receivingChats : []);
      const labChats = Array.isArray(body.labChats)
        ? body.labChats.map((j) => String(j).trim()).filter(Boolean)
        : (Array.isArray(settings().labChats) ? settings().labChats : []);
      const learnChats = Array.isArray(body.learnChats)
        ? body.learnChats.map((j) => String(j).trim()).filter(Boolean)
        : (Array.isArray(settings().learnChats) ? settings().learnChats : []);
      const current = readJsonSafe(PATHS.settingsFile, {});
      ensureDir(PATHS.configDir);
      fs.writeFileSync(
        PATHS.settingsFile,
        JSON.stringify({ ...current, allowedChats: allowed, watchAllChats: watchAll, receivingChats, labChats, learnChats, updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      log(watchAll ? "now watching all chats" : allowed.length ? `now watching ${allowed.length} chat(s)` : "watching no chats until a scope is selected");
      return json(res, 200, { ok: true, allowedChats: allowed, trackingAll: watchAll, receivingChats, labChats, learnChats });
    }

    if (route === "/test" && req.method === "POST") {
      // Run the whole pipeline on one file and report EVERY step —
      // without WhatsApp, without saving anything.
      //
      // This exists because "it doesn't work" is not something anyone can
      // fix. This turns it into "step 3 failed, here is the message",
      // which is.
      const body = await readBody(req);
      if (!body.fileBase64) return json(res, 400, { error: "Send `fileBase64` and `fileName`." });

      const buffer = Buffer.from(body.fileBase64, "base64");
      const fileName = body.fileName || "test.pdf";
      const mimeType =
        body.mimeType ||
        (/\.pdf$/i.test(fileName)
          ? "application/pdf"
          : /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : /\.png$/i.test(fileName)
              ? "image/png"
              : "application/octet-stream");

      const steps = [];
      const step = (name, ok, detail, data) => {
        steps.push({ name, ok, detail, data });
        return ok;
      };

      const vendorList = vendors();
      const clientList = loadClients();
      const cfg = settings();

      step("File received", true, `${fileName} · ${(buffer.length / 1024).toFixed(0)} KB · ${mimeType}`);
      step(
        "Registries loaded",
        true,
        `${vendorList.length} vendor(s), ${clientList.length} client(s)`,
        vendorList.length === 0
          ? { warning: "No vendors registered — vendor codes can't be matched. Add them under Vendors." }
          : undefined
      );

      // ---- Read it ----
      let ai;
      try {
        ai = await classifyDocument(buffer, mimeType, {
          geminiKey: process.env.GEMINI_API_KEY,
          anthropicKey: process.env.ANTHROPIC_API_KEY,
          vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
          clients: clientList.map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
          companyCodes: cfg.companyCodes,
          fileName,
        });
      } catch (err) {
        step("Reading the document", false, err.message);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      if (!ai.ok) {
        step("Reading the document", false, ai.message || ai.reason);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      const ex = ai.data;
      const textLen = (ex.transcription || "").replace(/\s/g, "").length;
      step(
        "Text extracted",
        textLen > 40,
        textLen > 40
          ? `${textLen} characters read via ${ex.readMethod || ai.provider}`
          : `Only ${textLen} characters found — the page may be a scan this reader can't handle.`,
        { sample: (ex.transcription || "").slice(0, 600) }
      );

      step(
        "Document identified",
        ex.documentType !== "other",
        ex.documentType !== "other"
          ? `${DOC_TYPE_LABEL[ex.documentType] || ex.documentType} · ${ex.confidence}% confident`
          : "Could not tell what this document is.",
        {
          type: ex.documentType,
          confidence: ex.confidence,
          containedTypes: ex.containedDocumentTypes || [],
          engine: ai.provider,
          fileNameHints: ex.fileNameHints || [],
          learnedReasons: ex.learnedReasons || [],
        }
      );

      step("Fields extracted", true, "", {
        reference: ex.referenceNo,
        ourDocNo: ex.biomeDocNo,
        vendorDocNo: ex.vendorDocNo,
        vendor: ex.vendorName,
        client: ex.clientName,
        date: ex.documentDate,
        vehicle: ex.vehicleNo,
        grNumber: ex.grNumber,
        quantityKg: ex.quantityKg,
        netWeight: ex.netWeight,
        ewayBill: ex.ewayBillNo,
        amount: ex.totalAmount,
      });

      // ---- Reference ----
      const opts = { companyCodes: cfg.companyCodes, vendorCodes: vendorList.map((v) => v.code) };
      const reference =
        (ex.referenceNo ? parseReference(ex.referenceNo, opts) : null) ||
        (ex.transcription ? parseReference(ex.transcription, opts) : null);

      step(
        "Coordination reference",
        Boolean(reference),
        reference
          ? `${reference.canonical} → our doc ${reference.biomeDocNo}, vendor ${reference.vendorCode} doc ${reference.vendorDocNo}`
          : "None found. Expected only on OUR tax invoice or delivery challan — vendor papers never carry one.",
        reference || undefined
      );

      // ---- Client ----
      const client = matchClient(ex.clientName, clientList);
      step(
        "Client matched",
        Boolean(client),
        client
          ? `${client.name}`
          : ex.clientName
            ? `Read "${ex.clientName}" but no client in the list matches. Add an alias under Clients.`
            : "No consignee found on the page.",
      );

      // ---- Supply type ----
      const supply = verify.detectSupplyType([ex], reference);
      step("Supply type", supply.type !== "unknown", `${supply.type} — ${supply.reason}`);

      // ---- Where it would go ----
      const isOurs = ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(ex.documentType);
      const plan = planFiling({
        reference,
        supplyType: supply.type,
        extracted: ex,
        originalName: fileName,
        mimeType,
        receivedAt: new Date(),
        senderName: "Test",
        anchorDate: ex.documentDate,
      });

      const target = path.relative(PATHS.inbox, path.join(plan.dir, `${plan.baseName}${plan.ext}`));
      if (!isOurs && supply.type === "trading") {
        step(
          "What happens next",
          true,
          `This is a vendor document, so it would be HELD in staging until your invoice arrives. It would then be filed as:\n${target}`,
          { wouldStage: true, targetPath: target }
        );
      } else {
        step("Where it would be saved", plan.bucket === "filed", target, {
          bucket: plan.bucket,
          targetPath: target,
        });
      }

      const failed = steps.filter((s) => !s.ok);
      return json(res, 200, {
        steps,
        verdict: failed.length === 0 ? "ok" : "partial",
        problems: failed.map((f) => `${f.name}: ${f.detail}`),
        extracted: ex,
      });
    }

    if (route === "/chats" && req.method === "GET") {
      const cfg = settings();
      const list = [...knownChats.values()]
        .map((c) => ({
          ...c,
          selected: cfg.allowedChats.includes(c.jid),
          // A group with documents in it is almost certainly the one
          // they want, so surface that rather than making them guess.
          suggested: c.isGroup && c.documentCount > 0,
        }))
        .sort((a, b) => {
          if (a.selected !== b.selected) return a.selected ? -1 : 1;
          if (a.documentCount !== b.documentCount) return b.documentCount - a.documentCount;
          return String(b.lastSeen || "").localeCompare(String(a.lastSeen || ""));
        });
      return json(res, 200, {
        chats: list,
        watchingAll: cfg.allowedChats.length === 0,
        selectedCount: cfg.allowedChats.length,
      });
    }

    if (route === "/chats" && req.method === "POST") {
      const body = await readBody(req);
      const jids = Array.isArray(body.allowedChats) ? body.allowedChats.filter(Boolean) : [];
      const current = readJsonSafe(PATHS.settingsFile, {});
      ensureDir(PATHS.configDir);
      fs.writeFileSync(
        PATHS.settingsFile,
        JSON.stringify({ ...current, allowedChats: jids, updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      log(
        jids.length
          ? `now watching ${jids.length} chat(s) only`
          : "now watching every chat"
      );
      return json(res, 200, { ok: true, allowedChats: jids, watchingAll: jids.length === 0 });
    }

    if (route === "/test" && req.method === "POST") {
      // Run the whole pipeline on one file and report EVERY step —
      // without WhatsApp, without saving anything.
      //
      // This exists because "it doesn't work" is not something anyone can
      // fix. This turns it into "step 3 failed, here is the message",
      // which is.
      const body = await readBody(req);
      if (!body.fileBase64) return json(res, 400, { error: "Send `fileBase64` and `fileName`." });

      const buffer = Buffer.from(body.fileBase64, "base64");
      const fileName = body.fileName || "test.pdf";
      const mimeType =
        body.mimeType ||
        (/\.pdf$/i.test(fileName)
          ? "application/pdf"
          : /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : /\.png$/i.test(fileName)
              ? "image/png"
              : "application/octet-stream");

      const steps = [];
      const step = (name, ok, detail, data) => {
        steps.push({ name, ok, detail, data });
        return ok;
      };

      const vendorList = vendors();
      const clientList = loadClients();
      const cfg = settings();

      step("File received", true, `${fileName} · ${(buffer.length / 1024).toFixed(0)} KB · ${mimeType}`);
      step(
        "Registries loaded",
        true,
        `${vendorList.length} vendor(s), ${clientList.length} client(s)`,
        vendorList.length === 0
          ? { warning: "No vendors registered — vendor codes can't be matched. Add them under Vendors." }
          : undefined
      );

      // ---- Read it ----
      let ai;
      try {
        ai = await classifyDocument(buffer, mimeType, {
          geminiKey: process.env.GEMINI_API_KEY,
          anthropicKey: process.env.ANTHROPIC_API_KEY,
          vendors: vendorList.map((v) => ({ code: v.code, name: v.name })),
          clients: clientList.map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
          companyCodes: cfg.companyCodes,
          fileName,
        });
      } catch (err) {
        step("Reading the document", false, err.message);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      if (!ai.ok) {
        step("Reading the document", false, ai.message || ai.reason);
        return json(res, 200, { steps, verdict: "failed", failedAt: "reading" });
      }

      const ex = ai.data;
      const textLen = (ex.transcription || "").replace(/\s/g, "").length;
      step(
        "Text extracted",
        textLen > 40,
        textLen > 40
          ? `${textLen} characters read via ${ex.readMethod || ai.provider}`
          : `Only ${textLen} characters found — the page may be a scan this reader can't handle.`,
        { sample: (ex.transcription || "").slice(0, 600) }
      );

      step(
        "Document identified",
        ex.documentType !== "other",
        ex.documentType !== "other"
          ? `${DOC_TYPE_LABEL[ex.documentType] || ex.documentType} · ${ex.confidence}% confident`
          : "Could not tell what this document is.",
        {
          type: ex.documentType,
          confidence: ex.confidence,
          containedTypes: ex.containedDocumentTypes || [],
          engine: ai.provider,
          fileNameHints: ex.fileNameHints || [],
          learnedReasons: ex.learnedReasons || [],
        }
      );

      step("Fields extracted", true, "", {
        reference: ex.referenceNo,
        ourDocNo: ex.biomeDocNo,
        vendorDocNo: ex.vendorDocNo,
        vendor: ex.vendorName,
        client: ex.clientName,
        date: ex.documentDate,
        vehicle: ex.vehicleNo,
        grNumber: ex.grNumber,
        quantityKg: ex.quantityKg,
        netWeight: ex.netWeight,
        ewayBill: ex.ewayBillNo,
        amount: ex.totalAmount,
      });

      // ---- Reference ----
      const opts = { companyCodes: cfg.companyCodes, vendorCodes: vendorList.map((v) => v.code) };
      const reference =
        (ex.referenceNo ? parseReference(ex.referenceNo, opts) : null) ||
        (ex.transcription ? parseReference(ex.transcription, opts) : null);

      step(
        "Coordination reference",
        Boolean(reference),
        reference
          ? `${reference.canonical} → our doc ${reference.biomeDocNo}, vendor ${reference.vendorCode} doc ${reference.vendorDocNo}`
          : "None found. Expected only on OUR tax invoice or delivery challan — vendor papers never carry one.",
        reference || undefined
      );

      // ---- Client ----
      const client = matchClient(ex.clientName, clientList);
      step(
        "Client matched",
        Boolean(client),
        client
          ? `${client.name}`
          : ex.clientName
            ? `Read "${ex.clientName}" but no client in the list matches. Add an alias under Clients.`
            : "No consignee found on the page.",
      );

      // ---- Supply type ----
      const supply = verify.detectSupplyType([ex], reference);
      step("Supply type", supply.type !== "unknown", `${supply.type} — ${supply.reason}`);

      // ---- Where it would go ----
      const isOurs = ["biome_tax_invoice", "biome_delivery_challan", "biome_eway_bill"].includes(ex.documentType);
      const plan = planFiling({
        reference,
        supplyType: supply.type,
        extracted: ex,
        originalName: fileName,
        mimeType,
        receivedAt: new Date(),
        senderName: "Test",
        anchorDate: ex.documentDate,
      });

      const target = path.relative(PATHS.inbox, path.join(plan.dir, `${plan.baseName}${plan.ext}`));
      if (!isOurs && supply.type === "trading") {
        step(
          "What happens next",
          true,
          `This is a vendor document, so it would be HELD in staging until your invoice arrives. It would then be filed as:\n${target}`,
          { wouldStage: true, targetPath: target }
        );
      } else {
        step("Where it would be saved", plan.bucket === "filed", target, {
          bucket: plan.bucket,
          targetPath: target,
        });
      }

      const failed = steps.filter((s) => !s.ok);
      return json(res, 200, {
        steps,
        verdict: failed.length === 0 ? "ok" : "partial",
        problems: failed.map((f) => `${f.name}: ${f.detail}`),
        extracted: ex,
      });
    }

    if (route === "/chats" && req.method === "GET") {
      await refreshGroupNames();
      const cfg = settings();
      const chats = [...knownChats.values()]
        .map((c) => ({
          ...c,
          name: c.name || (c.isGroup ? "(unnamed group)" : c.jid.split("@")[0]),
          watched: cfg.allowedChats.length === 0 || cfg.allowedChats.includes(c.jid),
          // The UI reads `selected`; kept alongside `watched` so both
          // names work and neither side can silently drift again.
          selected: cfg.allowedChats.includes(c.jid),
          receivingSelected: cfg.receivingChats.includes(c.jid),
          labSelected: cfg.labChats.includes(c.jid),
          learnFrom: (cfg.learnChats || []).includes(c.jid),
        }))
        .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));

      return json(res, 200, {
        chats,
        // Empty allowedChats means "watch everything" — stated plainly so
        // nobody has to infer it from an empty list.
        watchingAll: cfg.allowedChats.length === 0,
        allowedChats: cfg.allowedChats,
        receivingChats: cfg.receivingChats,
        labChats: cfg.labChats,
        learnChats: cfg.learnChats || [],
      });
    }

    if (route === "/chats" && req.method === "POST") {
      const body = await readBody(req);
      const current = readJsonSafe(PATHS.settingsFile, {});
      const next = { ...current };

      if (Array.isArray(body.allowedChats)) next.allowedChats = body.allowedChats.filter(Boolean);
      if (Array.isArray(body.receivingChats)) next.receivingChats = body.receivingChats.filter(Boolean);
      if (Array.isArray(body.labChats)) next.labChats = body.labChats.filter(Boolean);
      if (Array.isArray(body.learnChats)) next.learnChats = body.learnChats.filter(Boolean);

      ensureDir(PATHS.configDir);
      fs.writeFileSync(
        PATHS.settingsFile,
        JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      log(
        `watching ${next.allowedChats?.length ? next.allowedChats.length + " chat(s)" : "all chats"}, ` +
          `learning from ${next.learnChats?.length || 0}`
      );
      return json(res, 200, { ok: true, allowedChats: next.allowedChats || [], learnChats: next.learnChats || [] });
    }

    if (route === "/patterns" && req.method === "GET") {
      return json(res, 200, patterns.summary());
    }

    if (route === "/documents" && req.method === "DELETE") {
      // Delete scanned document records, and optionally the files.
      // Three scopes because all three are things people actually need:
      // one bad scan, a whole day's mistake, or a clean slate.
      const body = await readBody(req);
      const { ids, from, to, bucket, deleteFiles } = body;
      const all = store.all();

      let targets = [];
      if (Array.isArray(ids) && ids.length) {
        targets = all.filter((d) => ids.includes(d.id));
      } else if (from || to) {
        targets = all.filter((d) => {
          const at = String(d.receivedAt || "").slice(0, 10);
          if (from && at < from) return false;
          if (to && at > to) return false;
          return true;
        });
      } else if (bucket) {
        targets = all.filter((d) => d.bucket === bucket);
      } else {
        return json(res, 400, {
          error: "Say what to delete: `ids`, a `from`/`to` date range, or a `bucket`.",
        });
      }

      let filesRemoved = 0;
      for (const doc of targets) {
        if (deleteFiles && doc.filePath) {
          try {
            if (fs.existsSync(doc.filePath)) {
              fs.unlinkSync(doc.filePath);
              filesRemoved += 1;
            }
            // Tidy the folder only if we just emptied it.
            const dir = path.dirname(doc.filePath);
            if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
          } catch (err) {
            log(`could not delete ${doc.filePath}: ${err.message}`);
          }
        }
        store.update(doc.id, { deleted: true, deletedAt: new Date().toISOString() });
      }

      return json(res, 200, {
        ok: true,
        recordsDeleted: targets.length,
        filesRemoved,
        keptOnDisk: deleteFiles ? 0 : targets.length,
      });
    }

    if (route === "/send" && req.method === "POST") {
      // Send a plain text message from the linked account — used for vendor
      // follow-ups (missing documents, pending credit notes, PO notices).
      // Text only, one recipient, and only when the app asks: the agent never
      // messages anyone on its own.
      const body = await readBody(req);
      if (!sock || state.status !== "connected") return json(res, 409, { error: "WhatsApp is not connected on the server." });
      const digits = String(body.to || "").replace(/\D/g, "");
      const number = digits.length === 10 ? `91${digits}` : digits;
      if (number.length < 11 || number.length > 15) return json(res, 400, { error: "Give a mobile number with country code, e.g. 9198XXXXXXXX." });
      const text = String(body.text || "").trim().slice(0, 4000);
      if (!text) return json(res, 400, { error: "Nothing to send." });
      try {
        const [exists] = await sock.onWhatsApp(number).catch(() => [null]);
        if (exists && exists.exists === false) return json(res, 404, { error: `${number} is not on WhatsApp.` });
        const jid = (exists && exists.jid) || `${number}@s.whatsapp.net`;
        const sent = await sock.sendMessage(jid, { text });
        log(`follow-up sent to ${number}`);
        return json(res, 200, { ok: true, id: sent?.key?.id || null, to: number });
      } catch (err) {
        return json(res, 500, { error: `WhatsApp refused the message: ${err.message}` });
      }
    }

    if (route === "/staged/sweep" && req.method === "POST") {
      // Re-offer every filed document of ours to the staging queue, so
      // paperwork held while the agent was off gets filed now.
      const result = sweepStaged({});
      return json(res, 200, result);
    }

    if (route === "/staged" && req.method === "GET") {
      // Vendor documents read and waiting for one of ours to claim them.
      return json(res, 200, {
        waiting: staging.pending().map((e) => ({
          id: e.id,
          fileName: e.fileName,
          receivedAt: e.receivedAt,
          stagedAt: e.stagedAt,
          sender: e.sender?.name || null,
          documentType: e.extracted?.documentType || null,
          containedTypes: e.extracted?.containedDocumentTypes || [],
          vehicleNo: e.match?.vehicleNo || null,
          vendorName: e.extracted?.vendorName || null,
          vendorDocNo: e.match?.vendorDocNo || null,
          netWeight: e.match?.netWeight || null,
        })),
        stale: staging.stale().length,
        stats: staging.stats(),
      });
    }

    if (route === "/clients" && req.method === "GET") {
      const { loadClients } = require("./lib/clients");
      return json(res, 200, { clients: loadClients() });
    }

    if (route === "/reprocess" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.id) return json(res, 400, { error: "An `id` is required." });
      const updated = await reprocess(body.id);
      return json(res, 200, { document: updated });
    }

    if (route === "/learning" && req.method === "GET") {
      return json(res, 200, { learning: learning.summary() });
    }

    /**
     * Teach with real documents. POST a labelled sample; the agent reads
     * it exactly the way it reads WhatsApp arrivals and keeps its
     * fingerprint. From then on, new arrivals that look like it ARE it.
     */
    if (route === "/samples" && req.method === "GET") {
      return json(res, 200, { samples: sampleStore.listSamples(), types: DOC_TYPE_LABEL });
    }

    if (route === "/samples" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.fileBase64 || !body.documentType) {
        return json(res, 400, { error: "Send `fileBase64`, `fileName` and `documentType`." });
      }
      if (!DOC_TYPE_LABEL[body.documentType]) {
        return json(res, 400, { error: `Unknown document type "${body.documentType}".` });
      }
      const buffer = Buffer.from(body.fileBase64, "base64");
      const fileName = body.fileName || "sample.pdf";
      const mimeType =
        body.mimeType ||
        (/\.pdf$/i.test(fileName) ? "application/pdf"
          : /\.(jpe?g)$/i.test(fileName) ? "image/jpeg"
          : /\.png$/i.test(fileName) ? "image/png"
          : "application/octet-stream");

      let text = "";
      try {
        const read = await readLocally(buffer, mimeType, fileName);
        text = read.text || "";
      } catch (err) {
        return json(res, 422, { error: `Could not read that file: ${err.message}` });
      }

      const result = sampleStore.addSample({
        documentType: body.documentType,
        label: body.label || null,
        fileName,
        text,
      });
      if (result.error) return json(res, 422, result);
      log(`taught a sample: ${DOC_TYPE_LABEL[body.documentType]} — "${result.sample.label}"`);
      return json(res, 200, { ...result, samples: sampleStore.listSamples() });
    }

    if (route === "/samples" && req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { error: "An `id` is required." });
      const removed = sampleStore.removeSample(id);
      return json(res, removed ? 200 : 404, removed ? { ok: true, samples: sampleStore.listSamples() } : { error: "Sample not found." });
    }

    if (route === "/file" && req.method === "GET") {
      /** Another ledger row for the same document that still has its bytes. */
      const findTwinWithBytes = (rec, id) => {
        const all = store.all();
        const me = rec || all.find((r) => r.id === id);
        if (!me) return null;
        const sameName = (a, b) =>
          a && b && String(a).toLowerCase() === String(b).toLowerCase();
        return (
          all.find(
            (r) =>
              r.id !== id &&
              r.filePath &&
              fs.existsSync(path.resolve(r.filePath)) &&
              ((me.sha256 && r.sha256 === me.sha256) || sameName(r.fileName, me.fileName))
          ) || null
        );
      };

      const id = url.searchParams.get("id");
      let rec = id ? store.byId(id) : null;

      // Staged documents are indexed separately and may carry no filePath
      // in the main ledger — or, if the ledger row hasn't been written for
      // some other reason, no ledger row at all. Either way, fall back to
      // the staging index by id rather than reporting the document
      // missing when its bytes are sitting right there in staging/.
      if (id && (!rec || !rec.filePath)) {
        const staged = staging.findById(id);
        if (staged?.filePath) {
          rec = rec
            ? { ...rec, filePath: staged.filePath, mimeType: staged.mimeType }
            : { filePath: staged.filePath, mimeType: staged.mimeType };
        }
      }
      // A re-shared document is often stored once and pointed at by
      // several ledger rows. When the row that was clicked has no bytes of
      // its own, fall back to another row carrying the same hash or the
      // same file name — the document IS there, just under a different row.
      if (id && (!rec || !rec.filePath || !fs.existsSync(path.resolve(rec.filePath)))) {
        const twin = findTwinWithBytes(rec, id);
        if (twin) rec = rec ? { ...rec, filePath: twin.filePath, mimeType: rec.mimeType || twin.mimeType } : twin;
      }
      if (!rec || !rec.filePath) return json(res, 404, { error: "Document not found." });

      // Serve only from folders this agent owns. Staging counts: vendor
      // documents now wait there until our invoice claims them, and they
      // were being refused — which is why documents stopped opening.
      const resolved = path.resolve(rec.filePath);
      const allowedRoots = [
        path.resolve(PATHS.inbox),
        path.resolve(staging.stagingDir()),
      ];
      const insideAllowed = allowedRoots.some(
        (root) => resolved === root || resolved.startsWith(root + path.sep)
      );
      if (!insideAllowed) {
        return json(res, 403, { error: "Refusing to serve a file outside the document folders." });
      }
      if (!fs.existsSync(resolved)) return json(res, 404, { error: "The file is no longer on disk." });

      const stat = fs.statSync(resolved);
      res.writeHead(200, {
        "Content-Type": rec.mimeType || "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `inline; filename="${path.basename(resolved).replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(resolved).pipe(res);
      return;
    }

    return json(res, 404, { error: `Unknown route: ${route}` });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
function writeHandshake() {
  ensureDir(path.dirname(PATHS.runtimeFile));
  fs.writeFileSync(
    PATHS.runtimeFile,
    JSON.stringify({ host: HOST, port: activePort, token: TOKEN, pid: process.pid, startedAt: state.startedAt }, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );
}

/**
 * Record why the agent died where the app can read it. Without this the
 * UI can only say "not running", which sends people looking in entirely
 * the wrong place.
 */
function writeCrashNote(reason, message, detail) {
  try {
    const dir = path.dirname(PATHS.runtimeFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "whatsapp-agent-error.json"),
      JSON.stringify({ at: new Date().toISOString(), reason, message, detail: detail || null }, null, 2),
      "utf8"
    );
  } catch {
    /* the console message is still there */
  }
}

function cleanup() {
  try {
    if (fs.existsSync(PATHS.runtimeFile)) fs.unlinkSync(PATHS.runtimeFile);
  } catch {
    /* best effort */
  }
}

// Boot steps that touch the disk can fail for reasons worth reporting —
// a read-only folder, a full disk, a corrupted ledger. Catch them here
// rather than dying with a stack trace nobody sees.
try {
  ensureAllDirs();
  ensureSeeded(); // writes the SOP client list on first run only
  loadKnownChats();
  store.load();
} catch (err) {
  writeCrashNote(
    "STORAGE_UNAVAILABLE",
    `The agent can't use its storage folder: ${err.message}. Check the folder exists and is writable, or change it in Settings.`,
    err.stack
  );
  console.error(`\n[Biome WhatsApp Agent] Storage failure: ${err.message}\n`);
  process.exit(1);
}

/**
 * A busy port used to kill the agent outright, which is what "Agent not
 * running" kept meaning: a previous copy still held 4174, the new one
 * hit EADDRINUSE and exited before it could report anything.
 *
 * Now it walks up to the next free port and writes the real one into the
 * handshake, so the app always finds it. Ports are an implementation
 * detail; nobody should have to think about them.
 */
let activePort = PORT;
const MAX_PORT_TRIES = 12;
let portTries = 0;

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    portTries += 1;
    if (portTries <= MAX_PORT_TRIES) {
      activePort = PORT + portTries;
      log(`port ${activePort - 1} is busy, trying ${activePort}`);
      setTimeout(() => server.listen(activePort, HOST), 120);
      return;
    }
    writeCrashNote(
      "PORTS_BUSY",
      `Ports ${PORT}–${PORT + MAX_PORT_TRIES} are all in use. Close any other copy of Biome that's still running, then start it again.`
    );
    console.error(`\n[Biome WhatsApp Agent] No free port between ${PORT} and ${PORT + MAX_PORT_TRIES}.\n`);
    process.exit(1);
  }
  writeCrashNote("SERVER_ERROR", `The agent's local server failed: ${err.message}`);
  console.error("[Biome WhatsApp Agent] Server error:", err.message);
});

/**
 * Prove the pipeline still works, every time the agent starts.
 *
 * Runs a known invoice through read → classify → reference → filing and
 * checks the answer. It is the closest thing to locking this behaviour:
 * a change that breaks document saving now announces itself on the next
 * start, instead of silently misfiling real paperwork.
 */
async function selfTest() {
  const SAMPLE =
    "TAX INVOICE e-Invoice\nAck Date : 1-Aug-26\nBIOME INDUSTRIA PRIVATE LIMITED\n" +
    "GSTIN/UIN: 06AAJCB1927H1ZS\nInvoice No. e-Way Bill No. Dated\n" +
    "BI-26-27-HR0840 342304109912 1-Aug-26\nOther References\nBDC/840/SAI/545\n" +
    "Consignee (Ship to)\nJhajjar Power Limited\nBill of Lading/LR-RR No.\n572 dt. 1-Aug-26\n" +
    "Motor Vehicle No.\nHR39C6382\nAgro Waste Pellet 44011010 33,995 KG";

  const checks = [];
  try {
    const ai = await classifyDocument(Buffer.from("x"), "application/pdf", {
      ocrText: SAMPLE,
      fileName: "Sales Haryana_BI-26-27-HR0840.pdf",
      vendors: vendors().map((v) => ({ code: v.code, name: v.name })),
      clients: loadClients().map((c) => ({ name: c.name, shortName: c.shortName, aliases: c.aliases })),
      companyCodes: settings().companyCodes,
      geminiKey: "",
      anthropicKey: "",
    });
    const ex = ai.ok ? ai.data : {};
    checks.push(["reads the document", ai.ok === true]);
    checks.push(["identifies our tax invoice", ex.documentType === "biome_tax_invoice"]);
    checks.push(["finds the reference", ex.referenceNo === "BDC/840/SAI/545"]);
    checks.push(["finds the vehicle", ex.vehicleNo === "HR39C6382"]);
    checks.push(["finds the Bill T number", String(ex.grNumber) === "572"]);
    checks.push(["takes the invoice date, not the PO date", ex.documentDate === "2026-08-01"]);
    checks.push(["matches the client", ex.clientName === "Jhajjar Power Limited"]);

    const ref = parseReference(ex.referenceNo || "", {
      companyCodes: settings().companyCodes,
      vendorCodes: vendors().map((v) => v.code),
      plantCodes: loadPlants().map((p) => p.code),
    });
    checks.push(["parses the reference", ref?.canonical === "BDC/840/SAI/545"]);

    const plan = planFiling({
      reference: ref,
      supplyType: ref?.supplyType,
      extracted: ex,
      originalName: "Sales Haryana_BI-26-27-HR0840.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      senderName: "self-test",
      anchorDate: ex.documentDate,
    });
    const target = path.join(plan.dir, plan.baseName);
    checks.push(["files under Month / Client / Reference", /August-2026/.test(target) && /Jhajjar Power Limited/.test(target) && /BDC_840_SAI_545/.test(target)]);
  } catch (err) {
    checks.push([`pipeline threw: ${err.message}`, false]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length === 0) {
    log(`self-test: all ${checks.length} checks passed — document saving is working`);
  } else {
    log("=".repeat(58));
    log(`SELF-TEST FAILED — ${failed.length} of ${checks.length} checks`);
    for (const [name] of failed) log(`   FAILED: ${name}`);
    log("Document saving will not work correctly until these pass.");
    log("=".repeat(58));
  }
  return { total: checks.length, failed: failed.map(([n]) => n) };
}

server.listen(activePort, HOST, () => {
  writeHandshake();
  // A previous failed start may have left a crash note — remove it now
  // that we're clearly up.
  try {
    const errFile = path.join(path.dirname(PATHS.runtimeFile), "whatsapp-agent-error.json");
    if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
  } catch {
    /* non-fatal */
  }
  selfTest();
  log(`listening on http://${HOST}:${activePort}`);
  log(`data root: ${PATHS.root}`);
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    log(
      "NOTE: no GEMINI_API_KEY / ANTHROPIC_API_KEY — documents are read with the built-in offline OCR " +
        "(free, no internet). A key is optional and only helps with unusual layouts."
    );
  }
  // If a session already exists from last time, come straight back up —
  // that's what makes this feel like a background service.
  const hasSession = fs.existsSync(path.join(PATHS.waAuth, "creds.json"));
  if (hasSession) {
    log("existing session found — reconnecting automatically");
    connect().catch((err) => setStatus("error", { lastError: err.message }));
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}
process.on("exit", cleanup);
process.on("uncaughtException", (err) => {
  // Keep the agent alive: one malformed message must not stop the watcher.
  log("uncaught exception (agent staying up):", err.stack || err.message);
});
process.on("unhandledRejection", (err) => {
  log("unhandled rejection (agent staying up):", err?.stack || err?.message || err);
});
