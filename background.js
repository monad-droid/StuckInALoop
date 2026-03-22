const LOOP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // check every 30s
const TAB_SWITCH_WINDOW_MS = 15 * 60 * 1000; // track switches in last 15min
const MIN_TAB_SWITCHES = 5; // need at least this many switches to count as "looping"

let state = {
  lastTypingTime: Date.now(),
  tabSwitches: [], // timestamps of tab switches
  notifiedAt: 0, // last time we showed a notification (cooldown)
  enabled: true,
};

// Load persisted state
chrome.storage.local.get(["loopDetectorState", "enabled"], (result) => {
  if (result.enabled !== undefined) {
    state.enabled = result.enabled;
  }
  // Always reset lastTypingTime on service worker start
  state.lastTypingTime = Date.now();
});

// Track tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!state.enabled) return;
  state.tabSwitches.push(Date.now());
  pruneOldSwitches();
  checkForLoop();
});

// Track window focus changes (switching between browser windows)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!state.enabled) return;
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    state.tabSwitches.push(Date.now());
    pruneOldSwitches();
  }
});

// Listen for typing reports from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "typing") {
    state.lastTypingTime = Date.now();
    sendResponse({ ok: true });
  } else if (message.type === "getState") {
    const now = Date.now();
    pruneOldSwitches();
    sendResponse({
      enabled: state.enabled,
      timeSinceTyping: now - state.lastTypingTime,
      tabSwitchCount: state.tabSwitches.length,
      isInLoop: isInLoop(),
    });
  } else if (message.type === "setEnabled") {
    state.enabled = message.enabled;
    chrome.storage.local.set({ enabled: message.enabled });
    if (message.enabled) {
      // Reset when re-enabling
      state.lastTypingTime = Date.now();
      state.tabSwitches = [];
    }
    sendResponse({ ok: true });
  } else if (message.type === "dismiss") {
    // User acknowledged the alert — reset the timer
    state.lastTypingTime = Date.now();
    state.tabSwitches = [];
    state.notifiedAt = Date.now();
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async sendResponse
});

// Periodic check via alarms
chrome.alarms.create("loopCheck", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "loopCheck" && state.enabled) {
    checkForLoop();
  }
});

function pruneOldSwitches() {
  const cutoff = Date.now() - TAB_SWITCH_WINDOW_MS;
  state.tabSwitches = state.tabSwitches.filter((t) => t > cutoff);
}

function isInLoop() {
  const now = Date.now();
  const timeSinceTyping = now - state.lastTypingTime;
  pruneOldSwitches();

  return (
    timeSinceTyping >= LOOP_THRESHOLD_MS &&
    state.tabSwitches.length >= MIN_TAB_SWITCHES
  );
}

function checkForLoop() {
  if (!state.enabled) return;

  const now = Date.now();
  const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // don't re-notify within 5min

  if (isInLoop() && now - state.notifiedAt > NOTIFY_COOLDOWN_MS) {
    state.notifiedAt = now;
    triggerAlert();
  }
}

function triggerAlert() {
  const minutes = Math.round(
    (Date.now() - state.lastTypingTime) / 1000 / 60
  );

  // Show browser notification
  chrome.notifications.create("loop-alert-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "You're stuck in a loop!",
    message: `You've been switching tabs for ${minutes} minutes without typing anything. Take a breath — what did you actually want to do?`,
    priority: 2,
    requireInteraction: true,
  });

  // Also inject an overlay into the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "showOverlay", minutes });
    }
  });
}
