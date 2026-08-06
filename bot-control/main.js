// Electron main process for the Purge bot control panel. Owns the bot's
// child process lifecycle (start/stop/restart) and streams its stdout/stderr
// to the renderer. The bot itself (../bot) is unmodified — this just spawns
// `node src/index.js` with cwd set to bot/, exactly like bot/start-bot.bat
// does, so bot/.env still resolves normally via dotenv.
const { app, BrowserWindow, ipcMain, Notification } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const BOT_DIR = path.join(__dirname, "..", "bot");
// index.js's banner() (see bot/src/lib/console-ui.js) prints this on
// Events.ClientReady — a piped (non-TTY) child process gets plain text, no
// ANSI codes, so this plain substring match is all that's needed.
const LOGGED_IN_RE = /Logged in as/;

let win = null;
let botProcess = null;
// stopped | starting | running | stopping | crashed
let botState = "stopped";
let stopRequested = false;
let killTimer = null;

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function setState(state, extra) {
  botState = state;
  win?.webContents.send("bot:status", { state, ...extra });
}

function sendLog(line, isError) {
  win?.webContents.send("bot:log", { line, isError: Boolean(isError) });
}

function startBot() {
  if (botProcess) return;
  stopRequested = false;
  setState("starting");
  sendLog("Starting the bot…");

  try {
    botProcess = spawn("node", ["src/index.js"], { cwd: BOT_DIR, env: process.env });
  } catch (err) {
    setState("crashed", { reason: err.message });
    sendLog(`Failed to start: ${err.message}`, true);
    notify("Purge Bot failed to start", err.message);
    return;
  }

  botProcess.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line) continue;
      sendLog(line);
      if (botState !== "running" && LOGGED_IN_RE.test(line)) {
        setState("running");
        notify("Purge Bot is online", "Logged into Discord successfully.");
      }
    }
  });

  botProcess.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) sendLog(line, true);
    }
  });

  botProcess.on("error", (err) => {
    sendLog(`Process error: ${err.message}`, true);
  });

  botProcess.on("exit", (code, signal) => {
    botProcess = null;
    if (killTimer) { clearTimeout(killTimer); killTimer = null; }
    if (stopRequested) {
      setState("stopped");
      sendLog("Bot stopped.");
    } else {
      // Exited on its own (crash, bad token, etc.) — never got to "stopped"
      // via a user action, so this is unexpected regardless of what state
      // we were in (starting or running).
      setState("crashed", { code, signal });
      sendLog(`Bot exited unexpectedly (code ${code}${signal ? `, signal ${signal}` : ""}).`, true);
      notify("Purge Bot stopped unexpectedly", `Exit code ${code ?? "unknown"}`);
    }
  });
}

function stopBot() {
  if (!botProcess) return;
  stopRequested = true;
  setState("stopping");
  sendLog("Stopping the bot…");
  botProcess.kill();
  // Windows kill() already terminates forcefully, but keep a short fallback
  // for other platforms in case a graceful SIGTERM doesn't land.
  killTimer = setTimeout(() => botProcess?.kill("SIGKILL"), 5000);
}

function restartBot() {
  if (botProcess) {
    botProcess.once("exit", () => startBot());
    stopBot();
  } else {
    startBot();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: "#08060C",
    title: "Purge Bot Control",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.once("did-finish-load", () => setState(botState));
}

ipcMain.handle("bot:start", () => startBot());
ipcMain.handle("bot:stop", () => stopBot());
ipcMain.handle("bot:restart", () => restartBot());
ipcMain.handle("bot:get-status", () => ({ state: botState }));

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Closing the control panel takes the bot down with it — same mental model
// as closing the current console window.
app.on("before-quit", () => {
  if (botProcess) botProcess.kill("SIGKILL");
});
