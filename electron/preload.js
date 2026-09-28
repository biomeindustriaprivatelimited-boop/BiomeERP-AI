const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only bridge between the page and the desktop shell.
 *
 * Two calls, both about one thing: whether this installation is THE
 * SERVER or a client of one. Nothing else crosses — the page has no
 * general IPC, no fs, no shell. The Server & Sync card in Settings is
 * the sole consumer, and it only renders for the developer.
 */
contextBridge.exposeInMainWorld("biomeDesktop", {
  getSyncConfig: () => ipcRenderer.invoke("biome:getSyncConfig"),
  setSyncConfig: (cfg) => ipcRenderer.invoke("biome:setSyncConfig", cfg),
  // Version of THIS installed desktop app (not the server's), so the
  // update notice can tell whether this PC still needs the new installer.
  getAppInfo: () => ipcRenderer.invoke("biome:getAppInfo"),
});
