/**
 * WhatsApp engine 2 — the real WhatsApp Web, driven in the PC's own browser.
 * -------------------------------------------------------------------------
 * The agent's first engine (Baileys) re-implements WhatsApp's protocol. In
 * groups WhatsApp has moved to "LID" addressing, a linked Baileys device
 * often cannot get the sender keys it needs, and group documents then
 * arrive as undecryptable stubs and silently vanish — the agent showed
 * "Watching" and filed nothing.
 *
 * This engine runs WhatsApp's OWN web client (whatsapp-web.js) inside
 * Microsoft Edge — present on every Windows 10/11 PC — or Chrome, headless
 * and with its own private profile. WhatsApp's code does the decryption, so
 * whatever WhatsApp Web shows, the agent receives.
 *
 * Every message is converted to the same shape the rest of the agent
 * already handles (key / message / messageTimestamp / pushName), so
 * classification, filing and supply sets are untouched. The original
 * message rides along as `__wweb` for the media download.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

/** Edge / Chrome / Chromium on this machine, or null. */
function findBrowser() {
  const env = (process.env.BIOME_BROWSER || "").trim();
  if (env && fs.existsSync(env)) return env;
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates =
    process.platform === "win32"
      ? [
          path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/opt/pw-browsers/chromium/chrome-linux/chrome"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  // Playwright's Chromium (development machines).
  try {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return null;
}

/** WhatsApp Web says "@c.us" for people; the agent (and Baileys) say "@s.whatsapp.net". */
function normJid(j) {
  const s = typeof j === "string" ? j : j && j._serialized ? j._serialized : String(j || "");
  return s.endsWith("@c.us") ? s.replace(/@c\.us$/, "@s.whatsapp.net") : s;
}

/** A whatsapp-web.js Message → the Baileys-shaped object the agent handles. */
function toAgentMessage(m) {
  const d = m._data || {};
  const chat = normJid((m.id && m.id.remote) || (m.fromMe ? m.to : m.from));
  const author = m.author ? normJid(m.author) : undefined;
  const quoted = d.quotedStanzaID ? { contextInfo: { stanzaId: d.quotedStanzaID } } : {};
  const caption = typeof d.caption === "string" ? d.caption : m.hasMedia ? m.body || "" : "";
  let message;
  if (m.type === "document") {
    message = {
      documentMessage: {
        mimetype: d.mimetype || "application/octet-stream",
        fileName: d.filename || m.body || "document",
        fileLength: d.size || 0,
        caption: caption && caption !== d.filename ? caption : "",
        ...quoted,
      },
    };
  } else if (m.type === "image") {
    message = { imageMessage: { mimetype: d.mimetype || "image/jpeg", fileLength: d.size || 0, caption, ...quoted } };
  } else if (m.type === "chat") {
    message = quoted.contextInfo ? { extendedTextMessage: { text: m.body || "", ...quoted } } : { conversation: m.body || "" };
  } else {
    message = { otherMessage: { type: m.type } };
  }
  const out = {
    key: { id: (m.id && m.id.id) || String(Date.now()), remoteJid: chat, participant: author, fromMe: Boolean(m.fromMe) },
    message,
    messageTimestamp: Number(m.timestamp || Math.floor(Date.now() / 1000)),
    pushName: d.notifyName || null,
  };
  Object.defineProperty(out, "__wweb", { value: m, enumerable: false });
  return out;
}

/** Downloads the media of a converted message. */
async function downloadWebMedia(msg, { log } = {}) {
  const m = msg && msg.__wweb;
  if (!m) throw new Error("not a WhatsApp Web message");
  // Right after a message arrives WhatsApp Web often has not fetched the
  // file yet and downloadMedia() returns nothing (or throws) — a document
  // posted from a phone on a slow network was then recorded as "expired"
  // although it was fine a few seconds later. Try a few times, waiting
  // longer each time, before calling it lost.
  const waits = [0, 3000, 8000, 20000];
  let lastErr = null;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    try {
      const media = await m.downloadMedia();
      if (media && media.data) return Buffer.from(media.data, "base64");
      lastErr = new Error("WhatsApp returned no file data");
    } catch (err) {
      lastErr = err;
    }
    if (log && i < waits.length - 1) log(`download attempt ${i + 1} for a ${m.type || "media"} message failed (${lastErr && lastErr.message}) — retrying`);
  }
  throw new Error(`WhatsApp could not deliver this file after ${waits.length} tries (${lastErr ? lastErr.message : "no data"}). Media from older chats may have expired — forward it into the group again.`);
}

/**
 * Starts the engine. `hooks`:
 *   log(text), onQr(qrString), onReady({ id, name }), onClosed({ loggedOut, reason }),
 *   onMessage(agentMsg), onGroups([{ jid, name, participants }])
 * Resolves { client, stop(forget), send(number, text), groups(), fetchHistory(jids, fromTs, toTs) }.
 */
async function startWebEngine({ dataDir, browserPath, hooks }) {
  const wweb = require("whatsapp-web.js");
  const { Client, LocalAuth } = wweb;
  fs.mkdirSync(dataDir, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "biome", dataPath: dataDir }),
    puppeteer: {
      executablePath: browserPath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--mute-audio",
      ],
    },
    // Our own posts (our invoices from the linked phone) matter as much as
    // anyone's — see message_create below.
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
  });

  const seen = new Set();
  function deliver(m) {
    try {
      const id = m && m.id && m.id._serialized;
      if (id) {
        if (seen.has(id)) return;
        seen.add(id);
        if (seen.size > 5000) seen.delete(seen.values().next().value);
      }
      if (m.isStatus || (m.from || "").endsWith("@broadcast")) return;
      hooks.onMessage(toAgentMessage(m));
    } catch (e) {
      hooks.log(`web engine: could not read a message: ${e.message}`);
    }
  }

  async function groups() {
    const chats = await client.getChats();
    return chats
      .filter((c) => c.isGroup)
      .map((c) => ({ jid: normJid(c.id), name: c.name || null, participants: (c.participants || []).length }));
  }

  client.on("qr", (qr) => hooks.onQr(qr));
  client.on("authenticated", () => hooks.log("web engine: signed in to WhatsApp Web"));
  client.on("auth_failure", (m) => hooks.onClosed({ loggedOut: true, reason: `sign-in failed: ${m}` }));
  client.on("ready", async () => {
    const info = client.info || {};
    hooks.onReady({ id: normJid(info.wid), name: info.pushname || null });
    try {
      hooks.onGroups(await groups());
    } catch (e) {
      hooks.log(`web engine: could not list groups: ${e.message}`);
    }
  });
  // message_create fires for every new message, including the ones sent
  // from the linked phone itself (our own invoices).
  client.on("message_create", deliver);
  client.on("message", deliver);
  client.on("group_join", async () => {
    try { hooks.onGroups(await groups()); } catch (_) {}
  });
  client.on("disconnected", (reason) => {
    hooks.onClosed({ loggedOut: /LOGOUT|UNPAIRED|CONFLICT/i.test(String(reason)), reason: String(reason) });
  });

  await client.initialize();

  return {
    client,
    groups,
    async stop(forget) {
      try {
        if (forget) await client.logout();
      } catch (_) {}
      try {
        await client.destroy();
      } catch (_) {}
    },
    async send(number, text) {
      const id = await client.getNumberId(number);
      if (!id) {
        const e = new Error(`${number} is not on WhatsApp.`);
        e.notFound = true;
        throw e;
      }
      return client.sendMessage(id._serialized, text);
    },
    /** Older messages of the chosen chats, for "Scan older chats". */
    async fetchHistory(jids, fromTs, toTs, limit = 1000) {
      let n = 0;
      for (const jid of jids) {
        const chat = await client.getChatById(jid.replace(/@s\.whatsapp\.net$/, "@c.us")).catch(() => null);
        if (!chat) continue;
        const msgs = await chat.fetchMessages({ limit }).catch(() => []);
        for (const m of msgs) {
          const t = Number(m.timestamp || 0);
          if (fromTs && t < fromTs) continue;
          if (toTs && t > toTs) continue;
          deliver(m);
          n += 1;
        }
      }
      return n;
    },
  };
}

module.exports = { findBrowser, startWebEngine, toAgentMessage, downloadWebMedia, normJid };
