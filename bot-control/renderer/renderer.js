const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const restartBtn = document.getElementById("restartBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const logPanel = document.getElementById("logPanel");

const STATUS_LABELS = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  stopping: "Stopping…",
  crashed: "Crashed",
};

const MAX_LOG_LINES = 500;
let logCount = 0;

function applyStatus({ state, code, signal }) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = state === "crashed" && code !== undefined
    ? `Crashed (code ${code}${signal ? `, ${signal}` : ""})`
    : STATUS_LABELS[state] || state;

  startBtn.disabled = state === "starting" || state === "running" || state === "stopping";
  stopBtn.disabled = state === "stopped" || state === "crashed" || state === "stopping";
  restartBtn.disabled = state === "stopping";
}

function appendLog(line, isError) {
  const empty = logPanel.querySelector(".log-empty");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = isError ? "log-line error" : "log-line";
  div.textContent = line;
  logPanel.appendChild(div);
  logCount++;

  while (logCount > MAX_LOG_LINES) {
    logPanel.firstChild?.remove();
    logCount--;
  }

  logPanel.scrollTop = logPanel.scrollHeight;
}

startBtn.addEventListener("click", () => window.botControl.start());
stopBtn.addEventListener("click", () => window.botControl.stop());
restartBtn.addEventListener("click", () => {
  appendLog("Restarting the bot…");
  window.botControl.restart();
});

window.botControl.onStatus(applyStatus);
window.botControl.onLog(({ line, isError }) => appendLog(line, isError));

window.botControl.getStatus().then(applyStatus);
