

// ─── Constants ────────────────────────────────────────────────────────────────

const ALARM_NAME = "focusTimerTick";

const DEFAULT_STATE = {
  isRunning: false,
  mode: "work",           // "work" | "break" | "longBreak"
  timeLeft: 25 * 60,      // seconds
  sessionCount: 0,        // completed work sessions
  workDuration: 25,       // minutes
  breakDuration: 5,       // minutes
  longBreakDuration: 15,  // minutes
  longBreakInterval: 4    // sessions before long break
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the current timer state from chrome.storage.local.
 * Falls back to DEFAULT_STATE if nothing is stored yet.
 */
async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get("timerState", (result) => {
      resolve(result.timerState || { ...DEFAULT_STATE });
    });
  });
}

/**
 * Save state back to chrome.storage.local.
 */
async function setState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ timerState: state }, resolve);
  });
}

/**
 * Send a browser notification to the user.
 */
function sendNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 2
  });
}

/**
 * Determine the next mode and timeLeft after a session ends.
 */
function getNextSession(state) {
  if (state.mode === "work") {
    const newCount = state.sessionCount + 1;
    const isLongBreak = newCount % state.longBreakInterval === 0;
    return {
      mode: isLongBreak ? "longBreak" : "break",
      timeLeft: isLongBreak
        ? state.longBreakDuration * 60
        : state.breakDuration * 60,
      sessionCount: newCount
    };
  } else {
    // break or longBreak → back to work
    return {
      mode: "work",
      timeLeft: state.workDuration * 60,
      sessionCount: state.sessionCount
    };
  }
}

// ─── Alarm Tick ───────────────────────────────────────────────────────────────

/**
 * Fired every minute by chrome.alarms.
 * We store a lastTick timestamp so we can calculate exact elapsed time
 * rather than assuming exactly 60 seconds per alarm (alarms can drift slightly).
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getState();
  if (!state.isRunning) return;

  // Calculate elapsed seconds since last tick
  const now = Date.now();
  const elapsed = state.lastTick ? Math.round((now - state.lastTick) / 1000) : 60;
  const newTimeLeft = Math.max(0, state.timeLeft - elapsed);

  if (newTimeLeft <= 0) {
    // Session ended — notify and move to next session
    const next = getNextSession(state);

    if (state.mode === "work") {
      sendNotification(
        "🍅 Focus session complete!",
        next.mode === "longBreak"
          ? `Great work! You've earned a ${state.longBreakDuration}-minute long break.`
          : `Nice job! Take a ${state.breakDuration}-minute break.`
      );
    } else {
      sendNotification(
        "☕ Break over!",
        "Time to focus. Start your next work session."
      );
    }

    await setState({
      ...state,
      ...next,
      isRunning: false,  // pause after each session ends — user must manually restart
      lastTick: null
    });

    // Stop the alarm until user restarts
    chrome.alarms.clear(ALARM_NAME);
  } else {
    // Still running — save updated time
    await setState({ ...state, timeLeft: newTimeLeft, lastTick: now });
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

/**
 * Listen for messages from popup.js.
 * Popup sends actions: "start", "pause", "reset", "skip", "updateSettings"
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  const state = await getState();

  switch (message.action) {

    case "start": {
      if (state.isRunning) return { ok: true };
      const now = Date.now();
      await setState({ ...state, isRunning: true, lastTick: now });
      // Alarm fires every 60 seconds; we use it as a heartbeat
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      return { ok: true };
    }

    case "pause": {
      if (!state.isRunning) return { ok: true };
      chrome.alarms.clear(ALARM_NAME);

      // Save exact remaining time at pause moment
      const now = Date.now();
      const elapsed = state.lastTick ? Math.round((now - state.lastTick) / 1000) : 0;
      const newTimeLeft = Math.max(0, state.timeLeft - elapsed);

      await setState({ ...state, isRunning: false, timeLeft: newTimeLeft, lastTick: null });
      return { ok: true };
    }

    case "reset": {
      chrome.alarms.clear(ALARM_NAME);
      await setState({
        ...state,
        isRunning: false,
        mode: "work",
        timeLeft: state.workDuration * 60,
        lastTick: null
      });
      return { ok: true };
    }

    case "skip": {
      // Skip to the next session without counting current as complete
      chrome.alarms.clear(ALARM_NAME);
      const next = getNextSession({ ...state, sessionCount: state.mode === "work" ? state.sessionCount + 1 : state.sessionCount });
      await setState({
        ...state,
        ...next,
        isRunning: false,
        lastTick: null,
        sessionCount: state.mode === "work" ? state.sessionCount + 1 : state.sessionCount
      });
      return { ok: true };
    }

    case "updateSettings": {
      const { workDuration, breakDuration, longBreakDuration, longBreakInterval } = message;
      chrome.alarms.clear(ALARM_NAME);
      await setState({
        ...state,
        isRunning: false,
        workDuration,
        breakDuration,
        longBreakDuration,
        longBreakInterval,
        mode: "work",
        timeLeft: workDuration * 60,
        lastTick: null
      });
      return { ok: true };
    }

    case "getState": {
      // If running, calculate current timeLeft including elapsed since last tick
      if (state.isRunning && state.lastTick) {
        const now = Date.now();
        const elapsed = Math.round((now - state.lastTick) / 1000);
        const liveTimeLeft = Math.max(0, state.timeLeft - elapsed);
        return { ...state, timeLeft: liveTimeLeft };
      }
      return state;
    }

    default:
      return { ok: false, error: "Unknown action" };
  }
}
