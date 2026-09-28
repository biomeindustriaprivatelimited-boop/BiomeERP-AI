const { app, BrowserWindow, shell, ipcMain, session } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

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

function readSyncConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(syncConfigFile(), "utf8"));
    if (raw && raw.mode === "client" && typeof raw.serverUrl === "string" && /^https?:\/\//.test(raw.serverUrl)) {
      return { mode: "client", serverUrl: raw.serverUrl.replace(/\/+$/, "") };
    }
  } catch (_) {
    /* no file yet — first run is a server */
  }
  return { mode: "server", serverUrl: "" };
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
      PORT: String(PORT),
    },
    stdio: "inherit",
  });

  serverProcess.on("error", (err) => {
    console.error("Failed to start the Biome server:", err);
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
    },
    stdio: "inherit",
  });

  whatsappAgentProcess.on("error", (err) => {
    console.error("Failed to start the WhatsApp agent:", err);
  });

  whatsappAgentProcess.on("exit", (code) => {
    whatsappAgentProcess = null;
    if (quitting || code === 0) return;
    // Bring it back, but give up after a few tries so a genuinely broken
    // install doesn't spin forever.
    if (whatsappRestarts < 5) {
      whatsappRestarts += 1;
      console.error(
        `WhatsApp agent exited with code ${code}; restarting (attempt ${whatsappRestarts}/5).`
      );
      setTimeout(startWhatsappAgent, 2000 * whatsappRestarts);
    } else {
      console.error(
        "WhatsApp agent kept exiting — giving up. The WhatsApp Documents page will explain this."
      );
    }
  });
}

function stopChildren() {
  quitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (whatsappAgentProcess) {
    whatsappAgentProcess.kill();
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
          `document.body.dataset.offline = "1"; var el = document.getElementById("biome-loading-note"); if (el) el.textContent = ${JSON.stringify(
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

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    backgroundColor: "#0b1210",
    center: true,
    webPreferences: { contextIsolation: true },
  });
  loadingWindow.loadFile(path.join(__dirname, "loading.html"));
}

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
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(appOrigin());

  mainWindow.once("ready-to-show", () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
    mainWindow.show();
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
        webPreferences: { contextIsolation: true },
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

ipcMain.handle("biome:getSyncConfig", () => ({
  ...SYNC,
  port: PORT,
  lan: lanAddresses(),
  configFile: syncConfigFile(),
}));

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

app.whenReady().then(() => {
  wipeClientCache();
  createLoadingWindow();
  if (SYNC.mode === "server") {
    startNextServer();
    startWhatsappAgent();
  }
  waitForServer(appOrigin(), createMainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  stopChildren();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  wipeClientCache();
  stopChildren();
});
