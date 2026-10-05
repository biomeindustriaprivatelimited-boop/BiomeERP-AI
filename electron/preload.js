const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only bridge between the page and the desktop shell.
 *
 * All about one thing: whether this installation is THE SERVER or a client
 * of one. Nothing else crosses — the page has no general IPC, no fs, no
 * shell. The Server & Sync card in Settings uses biomeDesktop (developer
 * only). biomeSetup is used by the app's own local screens (setup.html,
 * loading.html); the main process refuses those calls from any page that
 * is not a local file, so a server page cannot re-point a client.
 */
contextBridge.exposeInMainWorld("biomeDesktop", {
  getSyncConfig: () => ipcRenderer.invoke("biome:getSyncConfig"),
  setSyncConfig: (cfg) => ipcRenderer.invoke("biome:setSyncConfig", cfg),
  // Version of THIS installed desktop app (not the server's), so the
  // update notice can tell whether this PC still needs the new installer.
  getAppInfo: () => ipcRenderer.invoke("biome:getAppInfo"),
  // Opens the local "Connect to the Biome server" window (login screen link).
  openSetup: () => ipcRenderer.invoke("biome:openSetup"),
  // Static IP (Settings → Server & Sync, developer only).
  detectPublicIp: () => ipcRenderer.invoke("biome:detectPublicIp"),
  setPublicAddress: (address) => ipcRenderer.invoke("biome:setPublicAddress", address),
  // Client PC: look for the server again (office network / static IP).
  reconnect: () => ipcRenderer.invoke("biome:reconnect"),
  // The server said this account is disabled (lib/accountGuard.ts): the
  // shell clears the app's own storage on this PC and shows the login page.
  accountDisabled: () => ipcRenderer.invoke("biome:accountDisabled"),
});

contextBridge.exposeInMainWorld("biomeSetup", {
  info: () => ipcRenderer.invoke("biome:setup:info"),
  test: (address) => ipcRenderer.invoke("biome:setup:test", address),
  connect: (address) => ipcRenderer.invoke("biome:setup:connect", address),
  makeServer: () => ipcRenderer.invoke("biome:setup:makeServer"),
  open: () => ipcRenderer.invoke("biome:setup:open"),
});
