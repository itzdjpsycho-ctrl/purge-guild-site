// Runs in the renderer's isolated world (contextIsolation: true, no
// nodeIntegration) — exposes only the specific start/stop/restart/log API
// the UI needs, nothing else of Node/Electron.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("botControl", {
  start: () => ipcRenderer.invoke("bot:start"),
  stop: () => ipcRenderer.invoke("bot:stop"),
  restart: () => ipcRenderer.invoke("bot:restart"),
  getStatus: () => ipcRenderer.invoke("bot:get-status"),
  onLog: (callback) => ipcRenderer.on("bot:log", (_event, entry) => callback(entry)),
  onStatus: (callback) => ipcRenderer.on("bot:status", (_event, status) => callback(status)),
});
