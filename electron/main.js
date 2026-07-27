const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const PORT = 4173;
let serverProcess;
let mainWindow;
let loadingWindow;

function appRootDir() {
  // When packaged, resources are unpacked next to the app under resources/app
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
}

function startNextServer() {
  const root = appRootDir();
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

  // Run Next's CLI script through Electron's own bundled Node runtime
  // (ELECTRON_RUN_AS_NODE) so end users don't need Node.js installed.
  serverProcess = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });

  serverProcess.on("error", (err) => {
    console.error("Failed to start the Biome server:", err);
  });
}

function waitForServer(url, onReady, attempt = 0) {
  http
    .get(url, () => onReady())
    .on("error", () => {
      if (attempt > 120) {
        console.error("Biome server did not respond in time.");
        return;
      }
      setTimeout(() => waitForServer(url, onReady, attempt + 1), 500);
    });
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
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once("ready-to-show", () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createLoadingWindow();
  startNextServer();
  waitForServer(`http://localhost:${PORT}`, createMainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
