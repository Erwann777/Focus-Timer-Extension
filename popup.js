
// ─── DOM refs ─────────────────────────────────────────────────────────────────

const timeDisplay    = document.getElementById("timeDisplay");
const modeLabel      = document.getElementById("modeLabel");
const ringFg         = document.getElementById("ringFg");
const sessionDots    = document.getElementById("sessionDots");

const pillWork       = document.getElementById("pillWork");
const pillBreak      = document.getElementById("pillBreak");
const pillLong       = document.getElementById("pillLong");

const btnStartPause  = document.getElementById("btnStartPause");
const btnReset       = document.getElementById("btnReset");
const btnSkip        = document.getElementById("btnSkip");

const settingsToggle = document.getElementById("settingsToggle");
const timerView      = document.getElementById("timerView");
const settingsView   = document.getElementById("settingsView");

const inputWork      = document.getElementById("inputWork");
const inputBreak     = document.getElementById("inputBreak");
const inputLong      = document.getElementById("inputLong");
const inputInterval  = document.getElementById("inputInterval");
const btnSave        = document.getElementById("btnSaveSettings");

// ─── Ring geometry ────────────────────────────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 70; // r=70 → ≈ 439.82

// ─── Format seconds → "MM:SS" ─────────────────────────────────────────────────

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─── Derive total session duration from state ──────────────────────────────────

function totalDuration(state) {
  if (state.mode === "work")      return state.workDuration * 60;
  if (state.mode === "break")     return state.breakDuration * 60;
  if (state.mode === "longBreak") return state.longBreakDuration * 60;
  return state.workDuration * 60;
}

// ─── Render UI from state ─────────────────────────────────────────────────────

function render(state) {
  // Time display
  timeDisplay.textContent = formatTime(state.timeLeft);

  // Mode label + body class for accent colour
  const modeMap = {
    work:      { label: "Focus",      bodyClass: "mode-work"  },
    break:     { label: "Short Break",bodyClass: "mode-break" },
    longBreak: { label: "Long Break", bodyClass: "mode-long"  }
  };
  const { label, bodyClass } = modeMap[state.mode] || modeMap.work;
  modeLabel.textContent = label;
  document.body.className = bodyClass;

  // Mode pills
  pillWork.className  = "pill" + (state.mode === "work"      ? " active-work"  : "");
  pillBreak.className = "pill" + (state.mode === "break"     ? " active-break" : "");
  pillLong.className  = "pill" + (state.mode === "longBreak" ? " active-long"  : "");

  // Progress ring
  const total    = totalDuration(state);
  const progress = total > 0 ? state.timeLeft / total : 1;
  ringFg.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  // Start/Pause button label
  btnStartPause.textContent = state.isRunning ? "Pause" : "Start";

  // Session dots (max 4 visible — one set of pomodoros)
  const interval = state.longBreakInterval || 4;
  sessionDots.innerHTML = "";
  for (let i = 0; i < interval; i++) {
    const dot = document.createElement("span");
    dot.className = "dot" + (i < (state.sessionCount % interval) ? " filled" : "");
    sessionDots.appendChild(dot);
  }

  // Populate settings fields
  inputWork.value     = state.workDuration;
  inputBreak.value    = state.breakDuration;
  inputLong.value     = state.longBreakDuration;
  inputInterval.value = state.longBreakInterval;
}

// ─── Send message to background.js ────────────────────────────────────────────

function sendAction(action, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...extra }, resolve);
  });
}

// ─── Fetch latest state and re-render ─────────────────────────────────────────

async function refreshState() {
  const state = await sendAction("getState");
  if (state) render(state);
}

// ─── Button listeners ─────────────────────────────────────────────────────────

btnStartPause.addEventListener("click", async () => {
  const state = await sendAction("getState");
  if (state.isRunning) {
    await sendAction("pause");
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  } else {
    await sendAction("start");
    if (!pollInterval) pollInterval = setInterval(refreshState, 1000);
  }
  await refreshState();
});

btnReset.addEventListener("click", async () => {
  await sendAction("reset");
  await refreshState();
});

btnSkip.addEventListener("click", async () => {
  await sendAction("skip");
  await refreshState();
});

// ─── Settings panel ───────────────────────────────────────────────────────────

settingsToggle.addEventListener("click", () => {
  const isOpen = !settingsView.classList.contains("hidden");
  timerView.classList.toggle("hidden", !isOpen);
  settingsView.classList.toggle("hidden", isOpen);
  settingsToggle.textContent = isOpen ? "⚙️" : "✕";
});

btnSave.addEventListener("click", async () => {
  const workDuration      = Math.max(1, parseInt(inputWork.value)     || 25);
  const breakDuration     = Math.max(1, parseInt(inputBreak.value)    || 5);
  const longBreakDuration = Math.max(1, parseInt(inputLong.value)     || 15);
  const longBreakInterval = Math.max(1, parseInt(inputInterval.value) || 4);

  await sendAction("updateSettings", {
    workDuration,
    breakDuration,
    longBreakDuration,
    longBreakInterval
  });

  // Switch back to timer view
  settingsView.classList.add("hidden");
  timerView.classList.remove("hidden");
  settingsToggle.textContent = "⚙️";

  await refreshState();
});

// ─── Number input +/− buttons ─────────────────────────────────────────────────

document.querySelectorAll(".num-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const delta    = parseInt(btn.dataset.delta);
    const input    = document.getElementById(targetId);
    const min      = parseInt(input.min) || 1;
    const max      = parseInt(input.max) || 99;
    const newVal   = Math.min(max, Math.max(min, parseInt(input.value) + delta));
    input.value = newVal;
  });
});

// ─── Live countdown while popup is open ───────────────────────────────────────
// Poll every second so the display ticks down in real-time
// (the background alarm fires every 60s, but we show live seconds via getState)

let pollInterval = null;

async function startPolling() {
  await refreshState();
  const state = await sendAction("getState");
  if (state && state.isRunning) {
    if (!pollInterval) pollInterval = setInterval(refreshState, 1000);
  }
}

// Stop polling when popup closes
window.addEventListener("unload", () => {
  if (pollInterval) clearInterval(pollInterval);
});



// ─── Init ─────────────────────────────────────────────────────────────────────

startPolling();
