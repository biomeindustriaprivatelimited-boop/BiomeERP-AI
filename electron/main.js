const { app, BrowserWindow, shell, ipcMain, session, Tray, Menu, dialog, Notification } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const net = require("./network");

/**
 * Keep the window painting. Windows' "native occlusion" check decides a
 * window is hidden when something sits over it (the taskbar weather
 * widget, a screen recorder, another app) and Chromium then stops drawing
 * frames and running animation callbacks. Page transitions froze half-way,
 * leaving the main area blank. A desktop ERP that someone keeps open all
 * day should never be throttled that way.
 */
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const PORT = 4173;
const WHATSAPP_AGENT_PORT = 4174;

/** Set on quit so the auto-restart below doesn't fight the shutdown. */
let quitting = false;
let serverProcess;
let whatsappAgentProcess;
let mainWindow;
let loadingWindow;

function appRootDir() {
  // When packaged, resources are unpacked next to the app under resources/app
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
}

/* ------------------------------------------------------------------ */
/* Server / client mode                                                */
/* ------------------------------------------------------------------ */
/**
 * One PC is THE SERVER; every other PC (and every phone) is a client of
 * it. All data lives on the server — a client PC holds nothing, so any
 * employee can sit at any machine and see the same books.
 *
 * The mode lives in a small JSON file in this installation's own profile
 * folder and is managed by the developer from Settings → Server & Sync
 * (the app relaunches itself to apply a change):
 *
 *   { "mode": "server" }
 *   { "mode": "client", "serverUrl": "http://192.168.1.10:4173" }
 *
 * SERVER mode starts the Next server and the WhatsApp agent locally, as
 * the app always has. Next listens on every interface, so clients on the
 * LAN reach it at http://<this-pc's-ip>:4173.
 *
 * CLIENT mode starts NOTHING locally. The window points at the server's
 * address; if the server is off or its app is not running, the client
 * shows a blocking "server offline" screen and keeps retrying — it never
 * falls back to working locally, because two machines each writing their
 * own truth for an afternoon is how a business ends up with two ledgers.
 */
function syncConfigFile() {
  return path.join(app.getPath("userData"), "sync-config.json");
}

/**
 * Mirror of lib/dataRoot.ts — only used to answer "does this PC already
 * hold Biome data?" before any server has started.
 */
function localDataRoot() {
  const override = (process.env.BIOME_DATA_ROOT || "").trim();
  if (override) return path.resolve(override);
  try {
    const marker = path.join(os.homedir(), ".biome-data-root");
    if (fs.existsSync(marker)) {
      const chosen = fs.readFileSync(marker, "utf8").trim();
      if (chosen) return path.resolve(chosen);
    }
  } catch (_) {}
  return path.join(os.homedir(), "Documents", "Biome Platform");
}

/**
 * True when this PC holds a real Biome user list. A list holding only the
 * untouched first-run "admin" account (still on its seeded password) does
 * not count: that is exactly what an earlier version left behind when it
 * silently turned a second PC into its own empty server.
 */
function hasLocalData() {
  try {
    const file = path.join(localDataRoot(), "config", "users.json");
    if (!fs.existsSync(file)) return false;
    const users = (JSON.parse(fs.readFileSync(file, "utf8")) || {}).users || [];
    if (!Array.isArray(users) || users.length === 0) return false;
    const onlySeed =
      users.length === 1 &&
      (users[0].username === "admin" || users[0].username === "developer") &&
      users[0].mustChangePassword === true;
    return !onlySeed;
  } catch (_) {
    // Unreadable file: assume it is real data rather than risk hiding a server.
    return true;
  }
}

/**
 * The PC's role.
 *
 * A fresh install used to start as a SERVER silently. On a second PC that
 * meant a brand-new, empty server with its own user list — so the user IDs
 * made on the real server PC "did not work" there. Now:
 *
 *   - a config file exists            → use it;
 *   - no file, but this PC has data   → it is the existing server (old
 *                                       installs keep working unchanged);
 *   - no file and no data             → a CLIENT that finds the server
 *                                       by itself (electron/network.js).
 */
function readSyncConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(syncConfigFile(), "utf8"));
    if (raw && raw.mode === "client") {
      const url = typeof raw.serverUrl === "string" && /^https?:\/\//.test(raw.serverUrl) ? raw.serverUrl.replace(/\/+$/, "") : "";
      return { mode: "client", serverUrl: url, manual: raw.manual === true };
    }
    if (raw && raw.mode === "server") return { mode: "server", serverUrl: "" };
  } catch (_) {
    /* no file yet */
  }
  if (hasLocalData()) {
    try { writeSyncConfig({ mode: "server" }); } catch (_) {}
    return { mode: "server", serverUrl: "" };
  }
  // A new PC is a CLIENT. It finds the server by itself (office network,
  // then the office static IP built into the app) — nothing to type.
  return { mode: "client", serverUrl: "" };
}

function writeSyncConfig(cfg) {
  fs.mkdirSync(path.dirname(syncConfigFile()), { recursive: true });
  fs.writeFileSync(syncConfigFile(), JSON.stringify(cfg, null, 2), "utf8");
}

const SYNC = readSyncConfig();

/** Where the window points: the local server, or the remote one. */
function appOrigin() {
  return SYNC.mode === "client" ? SYNC.serverUrl : `http://localhost:${PORT}`;
}

/**
 * Tailscale (the private network that joins PCs in different places)
 * hands out addresses in 100.64.0.0/10. Shown separately, because that is
 * the address a PC at ANOTHER location must use.
 */
function isTailscale(ip) {
  const [a, b] = String(ip).split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** This PC's LAN addresses — shown to the developer when setting clients up. */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")) {
        out.push(net.address);
      }
    }
  }
  return out;
}

/**
 * The key that signs sign-in sessions.
 *
 * Generated once per installation and kept in the user's own profile
 * folder rather than shipped in the build: a secret that is the same on
 * every machine is a secret anyone can use to forge a session for any
 * role. Regenerating it would sign everyone out, so it is written once
 * and read thereafter.
 */
function authSecret() {
  const file = path.join(app.getPath("userData"), "auth-secret");
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
  } catch (err) {
    console.error("Couldn't read the auth secret:", err);
  }

  const generated = crypto.randomBytes(48).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    // Worst case the secret lives only in memory: sessions then end when
    // the app closes, which is inconvenient but not insecure.
    console.error("Couldn't persist the auth secret:", err);
  }
  return generated;
}

/**
 * This installation's server id — lets a PC recognise its OWN server when
 * it reaches it through the office static IP, so it never "finds" itself.
 */
function serverId() {
  const file = path.join(app.getPath("userData"), "server-id");
  try {
    const v = fs.readFileSync(file, "utf8").trim();
    if (v) return v;
  } catch (_) {}
  const id = crypto.randomBytes(12).toString("hex");
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, id); } catch (_) {}
  return id;
}

/** True while the developer is signed in on this (server) PC — see lib/serverOwner.ts. */
function serverOwned() {
  try {
    return fs.existsSync(path.join(localDataRoot(), "config", "server-owner.json"));
  } catch (_) {
    return false;
  }
}

/**
 * The header that tells this PC's own server "this request comes from the
 * window on the server PC itself" (see lib/authToken.ts → serverPcToken).
 * Same HMAC, same secret, so only this installation can produce it.
 */
function serverPcToken() {
  return crypto.createHmac("sha256", authSecret()).update("biome-server-pc-v1").digest("base64url");
}

/**
 * Lets clients in. Windows Firewall blocks incoming connections to a new
 * program by default, so other PCs and phones could not reach port 4173
 * even with the right address. Adds one inbound rule, once, on the server
 * PC (Windows asks for permission the first time).
 */
function ensureFirewallRule() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const flag = path.join(app.getPath("userData"), "firewall-rules-v2");
  if (fs.existsSync(flag)) return;
  try {
    const check = spawn("netsh", ["advfirewall", "firewall", "show", "rule", "name=BiomeDiscovery"], { windowsHide: true });
    let out = "";
    check.stdout.on("data", (d) => (out += d));
    check.on("error", () => {});
    check.on("exit", (code) => {
      if (code === 0 && /BiomeDiscovery/i.test(out)) {
        try { fs.writeFileSync(flag, new Date().toISOString()); } catch (_) {}
        return;
      }
      // One Windows permission prompt for both rules: TCP 4173 (the app)
      // and UDP 4175 (so office PCs and phones find this server by themselves).
      const cmd =
        `/c netsh advfirewall firewall delete rule name=BiomeServer & ` +
        `netsh advfirewall firewall add rule name=BiomeServer dir=in action=allow protocol=TCP localport=${PORT} profile=any & ` +
        `netsh advfirewall firewall add rule name=BiomeDiscovery dir=in action=allow protocol=UDP localport=${net.DISCOVERY_PORT} profile=any`;
      const ps = spawn(
        "powershell.exe",
        ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Start-Process cmd -ArgumentList '${cmd}' -Verb RunAs -WindowStyle Hidden -Wait`],
        { windowsHide: true }
      );
      ps.on("error", () => {});
      ps.on("exit", (c) => {
        if (c === 0) { try { fs.writeFileSync(flag, new Date().toISOString()); } catch (_) {} }
      });
    });
  } catch (err) {
    console.error("Firewall rule:", err);
  }
}

/**
 * Child-process output goes to log files in the profile folder
 * (%APPDATA%\Biome\logs). The installed app has no console window, so
 * without these a crash left nothing behind to diagnose.
 */
function logStream(name) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    // Keep the file from growing forever: start fresh past 5 MB.
    try { if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + ".old"); } catch (_) {}
    const out = fs.createWriteStream(file, { flags: "a" });
    out.write(`\n===== ${new Date().toISOString()} start (app ${app.getVersion()}) =====\n`);
    return out;
  } catch (_) {
    return null;
  }
}

function pipeTo(child, name) {
  const out = logStream(name);
  for (const s of [child.stdout, child.stderr]) {
    if (!s) continue;
    s.on("data", (d) => {
      if (out) out.write(d);
      if (!app.isPackaged) process.stdout.write(d);
    });
  }
}

let serverRestarts = 0;
function startNextServer() {
  const root = appRootDir();
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

  // Run Next's CLI script through Electron's own bundled Node runtime
  // (ELECTRON_RUN_AS_NODE) so end users don't need Node.js installed.
  serverProcess = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
      BIOME_AUTH_SECRET: authSecret(),
      BIOME_SERVER_ID: serverId(),
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeTo(serverProcess, "server.log");

  serverProcess.on("error", (err) => {
    console.error("Failed to start the Biome server:", err);
  });

  // The server must not stay down: every PC on the network depends on it.
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (quitting) return;
    serverRestarts += 1;
    console.error(`Biome server exited with code ${code}; restarting (${serverRestarts}).`);
    setTimeout(startNextServer, Math.min(30000, 1500 * serverRestarts));
  });
}

/**
 * The WhatsApp watcher. Runs as its own process so a dropped WhatsApp
 * connection or a slow document read can never freeze the UI. Like the
 * Next server above, it runs on Electron's bundled Node, so end users
 * never have to install Node themselves.
 */
let whatsappRestarts = 0;
function startWhatsappAgent() {
  const root = appRootDir();
  const agentEntry = path.join(root, "whatsapp-agent", "agent.js");

  whatsappAgentProcess = spawn(process.execPath, [agentEntry], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
      BIOME_WA_AGENT_PORT: String(WHATSAPP_AGENT_PORT),
      // Same secret as the server, so the agent can read keys saved from Settings.
      BIOME_AUTH_SECRET: authSecret(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeTo(whatsappAgentProcess, "whatsapp-agent.log");

  whatsappAgentProcess.on("error", (err) => {
    console.error("Failed to start the WhatsApp agent:", err);
  });

  whatsappAgentProcess.on("exit", (code) => {
    whatsappAgentProcess = null;
    if (quitting || code === 0) return;
    // Bring it back, but give up after a few tries so a genuinely broken
    // install doesn't spin forever.
    // Quick retries first, then once a minute for as long as the app is
    // open — a document automation that silently stays off is the worst
    // outcome, and the page shows the reason from whatsapp-agent-error.json.
    whatsappRestarts += 1;
    const wait = whatsappRestarts <= 5 ? 2000 * whatsappRestarts : 60000;
    console.error(`WhatsApp agent exited with code ${code}; restarting in ${wait / 1000}s (attempt ${whatsappRestarts}).`);
    setTimeout(startWhatsappAgent, wait);
  });
}

function stopChildren() {
  quitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (whatsappAgentProcess) {
    // On Windows a plain kill() leaves the agent's headless Edge (WhatsApp
    // Web) running; end the whole process tree.
    if (process.platform === "win32" && whatsappAgentProcess.pid) {
      try { spawn("taskkill", ["/PID", String(whatsappAgentProcess.pid), "/T", "/F"], { windowsHide: true }); } catch (_) {}
    } else {
      whatsappAgentProcess.kill();
    }
    whatsappAgentProcess = null;
  }
}

/**
 * Waits until the app's server answers.
 *
 * In server mode this is the local boot (short, always succeeds); in
 * client mode it is the remote server and may take as long as it takes —
 * the loading window explains itself and never gives up, because "keep
 * showing offline until the server is back" IS the requested behaviour.
 */
function waitForServer(url, onReady, attempt = 0) {
  const req = http.get(`${url}/api/health`, (res) => {
    res.resume();
    if (res.statusCode && res.statusCode < 500) return onReady();
    retry();
  });
  req.on("error", retry);
  req.setTimeout(5000, () => {
    req.destroy();
    retry();
  });

  function retry() {
    if (quitting) return;
    if (SYNC.mode === "server" && attempt > 240) {
      console.error("Biome server did not respond in time.");
      return;
    }
    if (loadingWindow && !loadingWindow.isDestroyed() && attempt % 4 === 3) {
      loadingWindow.webContents
        .executeJavaScript(
          `document.body.dataset.offline = "1"; document.body.dataset.mode = ${JSON.stringify(SYNC.mode)}; var el = document.getElementById("biome-loading-note"); if (el) el.textContent = ${JSON.stringify(
            SYNC.mode === "client"
              ? `Waiting for the server at ${url} — check that the server PC is on and its Biome app is running.`
              : "Starting the local server…"
          )};`
        )
        .catch(() => {});
    }
    setTimeout(() => waitForServer(url, onReady, attempt + 1), SYNC.mode === "client" ? 3000 : 500);
  }
}

/* ------------------------------------------------------------------ */
/* Client: find the server by itself                                   */
/* ------------------------------------------------------------------ */

/** Writes a line on whichever window is showing the waiting screen. */
function showWaiting(text) {
  const js = `document.body.dataset.offline = "1"; document.body.dataset.mode = ${JSON.stringify(SYNC.mode)}; var el = document.getElementById("biome-loading-note"); if (el) el.textContent = ${JSON.stringify(text)};`;
  for (const w of [loadingWindow, mainWindow]) {
    try {
      if (w && !w.isDestroyed() && w.webContents.getURL().startsWith("file://")) w.webContents.executeJavaScript(js).catch(() => {});
    } catch (_) {}
  }
}

let clientSearching = false;
/**
 * Looks for the server — office network first, then the last address that
 * worked, then the office static IP built into the app — and keeps looking
 * every few seconds until it answers. Nobody types an address.
 */
async function connectClient(onFound) {
  if (clientSearching) return;
  clientSearching = true;
  let attempt = 0;
  while (!quitting) {
    // A server address someone set by hand is tried first; only if it does
    // not answer is the office network / built-in address used.
    let r = null;
    if (SYNC.manual && SYNC.serverUrl) {
      const p = await net.probe(SYNC.serverUrl).catch(() => null);
      if (p && p.ok) r = p;
    }
    if (!r) r = await net.findServer({ saved: SYNC.serverUrl }).catch(() => null);
    if (r) {
      if (r.url !== SYNC.serverUrl) {
        SYNC.serverUrl = r.url;
        // Remembered from now on; a hand-set address stays the first choice.
        try { writeSyncConfig({ mode: "client", serverUrl: r.url, auto: true, manual: SYNC.manual === true }); } catch (_) {}
      }
      clientSearching = false;
      onFound();
      return;
    }
    attempt += 1;
    showWaiting(
      attempt === 1
        ? "Connecting to the Biome server…"
        : "Server connection lost — the Biome server is not answering. Check that the server PC is on and the Biome app is open there. Reconnecting by itself…"
    );
    await new Promise((res) => setTimeout(res, attempt < 4 ? 2000 : 5000));
  }
  clientSearching = false;
}

/** Shows the waiting screen in the main window and reconnects (client only). */
function reconnectClient() {
  if (SYNC.mode !== "client" || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(__dirname, "loading.html")).then(() => {
    showWaiting("Server connection lost — reconnecting…");
  }).catch(() => {});
  connectClient(() => {
    recoveringMain = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(appOrigin());
  });
}

ipcMain.handle("biome:reconnect", () => {
  reconnectClient();
  return SYNC.mode === "client";
});

/* ------------------------------------------------------------------ */
/* Server: be findable, open the router, step aside if not the server  */
/* ------------------------------------------------------------------ */

let ROUTER = { checkedAt: null, ok: false, error: null, externalIp: null, internal: null };

async function openRouter() {
  const r = await net.openRouterPort(PORT).catch((e) => ({ ok: false, error: e.message }));
  ROUTER = { checkedAt: new Date().toISOString(), ...r };
  console.error(r.ok ? `Router: port ${PORT} forwarded to ${r.internal} (public ${r.externalIp || "?"})` : `Router: ${r.error}`);
}

/**
 * A PC running as a server WITHOUT the developer signed in, while another
 * Biome server WITH the developer signed in answers on the network or the
 * office static IP, is a PC that became a server by mistake. It turns
 * itself into a client of the real one (its own data stays on disk, unused).
 */
function myOwnerSince() {
  try {
    return JSON.parse(fs.readFileSync(path.join(localDataRoot(), "config", "server-owner.json"), "utf8")).since || null;
  } catch (_) {
    return null;
  }
}

/**
 * The server stays the server — even after the developer signs out here —
 * until the developer signs in on ANOTHER server PC that holds real company
 * data. Then this one (an older developer sign-in, or none) becomes a
 * client of the new one, so client PCs and phones are never left without
 * a server.
 */
async function stepAsideIfNotTheServer() {
  if (quitting || SYNC.mode !== "server") return;
  const real = await net.findServer({ excludeId: serverId(), ownedOnly: true }).catch(() => null);
  if (!real || !real.established) return;
  const mine = myOwnerSince();
  if (mine && (!real.ownerSince || String(real.ownerSince) <= String(mine))) return;
  console.error(`Another Biome server with the developer signed in is at ${real.url} — this PC becomes a client of it.`);
  try { writeSyncConfig({ mode: "client", serverUrl: real.url, auto: true }); } catch (_) { return; }
  quitting = true;
  app.relaunch();
  app.exit(0);
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 380,
    height: 250,
    frame: false,
    resizable: false,
    backgroundColor: "#0b1210",
    center: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.js") },
  });
  loadingWindow.loadFile(path.join(__dirname, "loading.html"));
}

/* ------------------------------------------------------------------ */
/* First-run / change-server setup                                     */
/* ------------------------------------------------------------------ */

let setupWindow;
let recoveringMain = false;
function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    autoHideMenuBar: true,
    title: "Connect Biome",
    backgroundColor: "#0b1210",
    icon: path.join(__dirname, "icon.png"),
    center: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, "setup.html"));
  setupWindow.on("closed", () => {
    setupWindow = null;
    // Closing the setup on a PC that has no role yet means "not now".
    /* the main window keeps running behind it */
  });
}

/** Normalises what a person types: "192.168.1.10" → "http://192.168.1.10:4173". */
function normaliseServerUrl(input) {
  let url = String(input || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    if (!u.port && u.protocol === "http:") u.port = String(PORT);
    return u.origin;
  } catch (_) {
    return "";
  }
}

/** Is a Biome server answering at this address? */
function probeServer(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const lib = url.startsWith("https:") ? require("https") : http;
      const req = lib.get(`${url}/api/health`, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            if (j && j.ok && j.startedAt) return finish({ ok: true });
          } catch (_) {}
          finish({ ok: false, error: `Something answered at ${url}, but it is not a Biome server.` });
        });
      });
      req.on("error", (e) => finish({ ok: false, error: `No answer from ${url} (${e.code || e.message}). Check the address, that the server PC is on with Biome running, and that both are on the same network (or Tailscale).` }));
      req.setTimeout(6000, () => { req.destroy(); finish({ ok: false, error: `No answer from ${url} within 6 seconds.` }); });
    } catch (e) {
      finish({ ok: false, error: e.message });
    }
  });
}

/** Setup IPC is only honoured from the app's own local pages, never from a server page. */
function fromLocalPage(evt) {
  try {
    const url = (evt.senderFrame && evt.senderFrame.url) || evt.sender.getURL();
    return url.startsWith("file://");
  } catch (_) {
    return false;
  }
}

ipcMain.handle("biome:setup:info", (evt) => {
  if (!fromLocalPage(evt)) return null;
  return { mode: SYNC.mode, serverUrl: SYNC.serverUrl, port: PORT, hasLocalData: hasLocalData() };
});

ipcMain.handle("biome:setup:test", async (evt, input) => {
  if (!fromLocalPage(evt)) return { ok: false, error: "Not allowed." };
  const url = normaliseServerUrl(input);
  if (!url) return { ok: false, error: "Type the server address, like 192.168.1.10 or http://100.101.102.103:4173" };
  const r = await probeServer(url);
  return { ...r, url };
});

ipcMain.handle("biome:setup:connect", async (evt, input) => {
  if (!fromLocalPage(evt)) return { ok: false, error: "Not allowed." };
  const url = normaliseServerUrl(input);
  if (!url) return { ok: false, error: "Type the server address first." };
  const r = await probeServer(url);
  if (!r.ok) return { ...r, url };
  try {
    // Typed by a person: kept and tried FIRST from now on, until someone
    // changes it again with "Connect to server".
    writeSyncConfig({ mode: "client", serverUrl: url, manual: true });
  } catch (err) {
    return { ok: false, error: `Could not save the setting: ${err.message}` };
  }
  setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 400);
  return { ok: true, url, restarting: true };
});

ipcMain.handle("biome:setup:makeServer", (evt) => {
  if (!fromLocalPage(evt)) return { ok: false, error: "Not allowed." };
  try {
    writeSyncConfig({ mode: "server" });
  } catch (err) {
    return { ok: false, error: `Could not save the setting: ${err.message}` };
  }
  setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 400);
  return { ok: true, restarting: true };
});

// Opening the setup window is harmless from any page — nothing changes
// until the person clicks Connect inside that local window. The login
// screen uses it so a PC set up wrongly can be pointed at the real server.
ipcMain.handle("biome:openSetup", () => {
  createSetupWindow();
  return true;
});

ipcMain.handle("biome:setup:open", (evt) => {
  if (!fromLocalPage(evt)) return false;
  createSetupWindow();
  return true;
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b1210",
    icon: path.join(__dirname, "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false,
      // No developer tools in the installed app: they would let anyone at
      // the PC read or remove the sign-in and lock cookies.
      devTools: !app.isPackaged,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(appOrigin());

  // A crashed or killed page (GPU driver reset, out of memory) comes back
  // by itself instead of leaving an empty window.
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("Renderer gone:", details && details.reason);
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    setTimeout(() => { try { mainWindow.loadURL(appOrigin()); } catch (_) {} }, 1000);
  });
  mainWindow.on("unresponsive", () => console.error("Window unresponsive"));

  // A client whose server vanished before the page could load (server PC
  // switched off, network gone) gets the waiting screen — with "Change
  // server address" — instead of Chromium's blank error page, and comes
  // back by itself the moment the server answers. Once a page IS loaded,
  // the in-page ServerGuard shows the "server not answering" block.
  mainWindow.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted by a newer navigation */) return;
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    if (String(url || "").startsWith("file://")) return;
    if (recoveringMain) return;
    recoveringMain = true;
    console.error(`Page failed to load (${code}) — waiting for the server.`);
    if (SYNC.mode === "client") return reconnectClient();
    mainWindow.loadFile(path.join(__dirname, "loading.html")).then(() => {
      mainWindow.webContents
        .executeJavaScript(
          `document.body.dataset.offline = "1"; document.body.dataset.mode = ${JSON.stringify(SYNC.mode)}; var el = document.getElementById("biome-loading-note"); if (el) el.textContent = ${JSON.stringify(
            SYNC.mode === "client"
              ? `Server connection lost (${SYNC.serverUrl}). Check that the server PC is on and its Biome app is running — this screen reconnects by itself.`
              : "The local server stopped — restarting it…"
          )};`
        )
        .catch(() => {});
    }).catch(() => {});
    waitForServer(appOrigin(), () => {
      recoveringMain = false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(appOrigin());
    });
  });

  mainWindow.once("ready-to-show", () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
    // Started with Windows: the server runs in the tray, no window pops up.
    if (!START_HIDDEN) mainWindow.show();
  });

  // SERVER PC: the X hides the window — the server keeps running in the
  // tray for every client PC and phone. Only "Stop server & quit" (tray)
  // stops it.
  // Windows is shutting down or signing out: let the window close.
  mainWindow.on("session-end", () => { quitting = true; });
  mainWindow.on("close", (e) => {
    if (SYNC.mode !== "server" || quitting) return;
    e.preventDefault();
    // Hidden to the tray = locked: whoever opens it from the tray needs
    // the MPIN or password. The server keeps running for every client.
    lockApp();
    mainWindow.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      try {
        if (tray && tray.displayBalloon) {
          tray.displayBalloon({ title: "Biome server is still running", content: "Client PCs and phones keep working. Right-click the Biome icon near the clock to open or stop it." });
        } else if (Notification.isSupported()) {
          new Notification({ title: "Biome server is still running", body: "Client PCs and phones keep working. Use the Biome tray icon to open or stop it." }).show();
        }
      } catch (_) {}
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Our own pages — including document previews at /api/... — must open
    // INSIDE the app. Handing them to the system browser was why
    // documents wouldn't open: the browser is a different session and
    // never sees the local server the way the app does.
    const origin = appOrigin();
    const isOurs =
      url.startsWith(origin) ||
      url.startsWith(`http://localhost:${PORT}`) ||
      url.startsWith(`http://127.0.0.1:${PORT}`);

    if (isOurs) {
      const viewer = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Document",
        autoHideMenuBar: true,
        backgroundColor: "#ffffff",
        webPreferences: { contextIsolation: true, devTools: !app.isPackaged },
      });
      viewer.loadURL(url);
      return { action: "deny" };
    }

    // Genuinely external links still go to the system browser.
    shell.openExternal(url);
    return { action: "deny" };
  });
}

/* ------------------------------------------------------------------ */
/* IPC — the Server & Sync card in Settings talks to this              */
/* ------------------------------------------------------------------ */

/**
 * The office's static (public) IP — what PCs and phones OUTSIDE the office
 * type to reach this server, the same way Remote Desktop reaches it. Kept
 * in its own small file so changing the server/client mode never loses it.
 */
function publicAddressFile() {
  return path.join(app.getPath("userData"), "public-address.json");
}
function readPublicAddress() {
  try {
    return String(JSON.parse(fs.readFileSync(publicAddressFile(), "utf8")).address || "");
  } catch (_) {
    return "";
  }
}

ipcMain.handle("biome:getSyncConfig", () => {
  const lan = lanAddresses();
  return {
    ...SYNC,
    port: PORT,
    lan,
    tailscale: lan.filter(isTailscale),
    publicAddress: readPublicAddress(),
    builtInAddresses: net.bakedAddresses(),
    router: ROUTER,
    owned: serverOwned(),
    configFile: syncConfigFile(),
  };
});

/** Asks a public echo service which IP the internet sees this office as. */
ipcMain.handle("biome:detectPublicIp", () => new Promise((resolve) => {
  const https = require("https");
  let done = false;
  const finish = (r) => { if (!done) { done = true; resolve(r); } };
  const req = https.get("https://api.ipify.org?format=json", (res) => {
    let body = "";
    res.on("data", (d) => (body += d));
    res.on("end", () => {
      try {
        const ip = JSON.parse(body).ip;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return finish({ ok: true, ip });
      } catch (_) {}
      finish({ ok: false, error: "Could not read the public IP." });
    });
  });
  req.on("error", (e) => finish({ ok: false, error: `No internet answer (${e.code || e.message}).` }));
  req.setTimeout(8000, () => { req.destroy(); finish({ ok: false, error: "No answer within 8 seconds." }); });
}));

ipcMain.handle("biome:setPublicAddress", (_evt, input) => {
  const raw = String(input || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (raw && !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(raw)) {
    return { ok: false, error: "Type only the IP or name, like 203.0.113.25" };
  }
  try {
    fs.mkdirSync(path.dirname(publicAddressFile()), { recursive: true });
    fs.writeFileSync(publicAddressFile(), JSON.stringify({ address: raw, updatedAt: new Date().toISOString() }, null, 2));
    return { ok: true, address: raw };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("biome:getAppInfo", () => ({ version: app.getVersion(), mode: SYNC.mode, serverUrl: SYNC.serverUrl }));

ipcMain.handle("biome:setSyncConfig", (_evt, cfg) => {
  const mode = cfg && cfg.mode === "client" ? "client" : "server";
  let serverUrl = "";
  if (mode === "client") {
    serverUrl = String(cfg.serverUrl || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s]+$/.test(serverUrl)) {
      return { ok: false, error: "Enter the server's address, like http://192.168.1.10:4173" };
    }
  }
  try {
    writeSyncConfig(mode === "client" ? { mode, serverUrl } : { mode });
  } catch (err) {
    return { ok: false, error: `Could not save the setting: ${err.message}` };
  }
  // Applying a mode change means starting or stopping local servers —
  // a clean relaunch is simpler and safer than juggling processes live.
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 400);
  return { ok: true, restarting: true };
});

/* ------------------------------------------------------------------ */

/**
 * A client PC holds no business data. The server already marks every
 * answer no-store; this also wipes Chromium's HTTP cache and any service
 * worker cache on this machine at start and at quit, so nothing from a
 * previous session can be dug out of the profile folder.
 */
function wipeClientCache() {
  if (SYNC.mode !== "client") return Promise.resolve();
  const ses = session.defaultSession;
  return Promise.all([
    ses.clearCache().catch(() => {}),
    ses.clearStorageData({ storages: ["cachestorage", "serviceworkers", "shadercache"] }).catch(() => {}),
  ]);
}

/* ------------------------------------------------------------------ */
/* Server PC: one instance, tray icon, start with Windows              */
/* ------------------------------------------------------------------ */

/** Launched by Windows at sign-in (see setLoginItemSettings below). */
const START_HIDDEN = process.argv.includes("--background");
let tray = null;
let trayHintShown = false;

// Two copies would fight over the server port. A second launch (double-
// clicking the shortcut while the server runs in the tray) just shows the
// window of the one already running.
const GOT_LOCK = app.requestSingleInstanceLock();
if (!GOT_LOCK) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function autoStartFile() {
  return path.join(app.getPath("userData"), "autostart.json");
}

/** Server PCs start with Windows by default; the tray checkbox turns it off. */
function autoStartWanted() {
  try {
    return JSON.parse(fs.readFileSync(autoStartFile(), "utf8")).on !== false;
  } catch (_) {
    return true;
  }
}

function applyAutoStart(on) {
  try { fs.writeFileSync(autoStartFile(), JSON.stringify({ on, at: new Date().toISOString() })); } catch (_) {}
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ["--background"] });
  } catch (err) {
    console.error("Auto-start:", err.message);
  }
}

/**
 * Lock the app on THIS PC (the server keeps serving everyone). Uses the
 * page's own sign-in, so it locks whoever is signed in here.
 */
function lockApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents
    .executeJavaScript(
      `fetch("/api/auth/lock",{method:"POST"}).then(function(r){ if (r.ok && location.pathname !== "/lock" && location.pathname !== "/login") location.href = "/lock"; }).catch(function(){})`
    )
    .catch(() => {});
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

function stopServerAndQuit() {
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Stop server", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Stop the Biome server?",
    message: "Stop the Biome server and quit?",
    detail: "Every client PC and phone will show “Server connection lost” until Biome is opened again on this PC.",
  });
  if (choice !== 0) return;
  quitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, "icon.png"));
  } catch (err) {
    console.error("Tray:", err.message);
    return;
  }
  tray.setToolTip("Biome server — running");
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Biome", click: showMainWindow },
        { label: "Lock Biome now", click: lockApp },
        { type: "separator" },
        { label: "Server is running — client PCs and phones are connected through this PC", enabled: false },
        {
          label: "Start the server with Windows",
          type: "checkbox",
          checked: autoStartWanted(),
          click: (item) => { applyAutoStart(item.checked); rebuild(); },
        },
        { type: "separator" },
        { label: "Stop server && quit", click: stopServerAndQuit },
      ])
    );
  rebuild();
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

app.whenReady().then(() => {
  if (!GOT_LOCK) return;
  // No application menu in the installed app: its shortcuts include
  // reload-and-bypass and "Toggle Developer Tools".
  if (app.isPackaged) Menu.setApplicationMenu(null);
  wipeClientCache();
  if (SYNC.mode === "server") {
    createTray();
    // Re-applied every start so a moved install keeps starting with Windows.
    applyAutoStart(autoStartWanted());
  }
  if (!(SYNC.mode === "server" && START_HIDDEN)) createLoadingWindow();
  if (SYNC.mode === "server") {
    // Mark every request from THIS window to its own server, so the
    // developer's sign-in here is recognised as "on the server PC" and kept.
    const token = serverPcToken();
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`http://localhost:${PORT}/*`, `http://127.0.0.1:${PORT}/*`] },
      (details, cb) => {
        details.requestHeaders["x-biome-server-pc"] = token;
        cb({ requestHeaders: details.requestHeaders });
      }
    );
    ensureFirewallRule();
    startNextServer();
    startWhatsappAgent();
    net.startDiscoveryResponder({ port: PORT, id: serverId() });
    // Ask the router to open the port (again every 30 minutes — some
    // routers forget mappings after a reboot).
    openRouter();
    setInterval(openRouter, 30 * 60 * 1000);
    setTimeout(stepAsideIfNotTheServer, 20000);
    setInterval(stepAsideIfNotTheServer, 5 * 60 * 1000);
    waitForServer(appOrigin(), createMainWindow);
  } else {
    connectClient(createMainWindow);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  // The server keeps running in the tray; only a client quits here.
  if (SYNC.mode === "server" && !quitting) return;
  stopChildren();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  wipeClientCache();
  stopChildren();
});
